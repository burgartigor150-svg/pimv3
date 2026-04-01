"""backend/services/agent_todo_scanner.py

Scans codebase for TODO/FIXME/HACK/XXX comments and auto-creates agent tasks.
"""

import hashlib
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import redis

log = logging.getLogger(__name__)

_redis = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

_SCAN_LOCK_KEY = "agent:todo_scanner:lock"
_SEEN_KEY = "agent:todo_scanner:seen"
_STATS_KEY = "agent:todo_scanner:stats"

_LOCK_TIMEOUT_SECONDS = 120

_PY_PATTERN = re.compile(r"#\s*(TODO|FIXME|HACK|XXX)[:\s]+(.*)")
_TS_PATTERN = re.compile(r"//\s*(TODO|FIXME|HACK|XXX)[:\s]+(.*)")


def _get_pattern_for_ext(ext: str) -> Optional[re.Pattern]:
    if ext == ".py":
        return _PY_PATTERN
    if ext in (".ts", ".tsx"):
        return _TS_PATTERN
    return None


def _make_seen_key(rel_path: str, line: int, text: str) -> str:
    raw = f"{rel_path}:{line}:{text}"
    return hashlib.md5(raw.encode()).hexdigest()


def _create_agent_task(
    title: str,
    description: str,
    task_type: str,
    requested_by: str,
) -> str:
    """Create an agent task entry in Redis and return the task_id."""
    task_id = str(uuid.uuid4())
    task: Dict[str, Any] = {
        "id": task_id,
        "title": title,
        "description": description,
        "type": task_type,
        "requested_by": requested_by,
        "created_at": time.time(),
        "status": "pending",
    }
    key = f"agent:tasks:{task_id}"
    _redis.hset(key, mapping={k: str(v) for k, v in task.items()})
    _redis.lpush("agent:tasks:queue", task_id)
    log.info("Created agent task id=%s title=%r", task_id, title)
    return task_id


def scan_todos(
    workspace_root: str = "/mnt/data/Pimv3",
    extensions: Optional[List[str]] = None,
    exclude_dirs: Optional[List[str]] = None,
    patterns: Optional[List[str]] = None,
    auto_create_tasks: bool = True,
    requested_by: str = "todo_scanner",
) -> Dict[str, Any]:
    """Scan workspace for TODO/FIXME/HACK/XXX comments.

    For each found comment NOT in the seen set:
      - Adds to seen set (Redis SADD)
      - If auto_create_tasks: creates an agent task via _create_agent_task()

    Returns a dict:
        {
            "ok": True,
            "found": <int>,
            "new": <int>,
            "tasks_created": <int>,
            "items": [{"file": str, "line": int, "kind": str, "text": str, "task_id": str|None}, ...],
        }

    Uses a Redis lock to prevent concurrent scans.
    """
    if extensions is None:
        extensions = [".py", ".ts", ".tsx"]
    if exclude_dirs is None:
        exclude_dirs = ["venv", "node_modules", "__pycache__", ".git", "dist", "build"]
    if patterns is None:
        patterns = ["TODO", "FIXME", "HACK", "XXX"]

    # Acquire distributed lock
    lock_value = str(uuid.uuid4())
    acquired = _redis.set(_SCAN_LOCK_KEY, lock_value, nx=True, ex=_LOCK_TIMEOUT_SECONDS)
    if not acquired:
        log.warning("scan_todos: another scan is already in progress, aborting")
        return {
            "ok": False,
            "error": "scan already in progress",
            "found": 0,
            "new": 0,
            "tasks_created": 0,
            "items": [],
        }

    log.info("scan_todos: starting scan in %s", workspace_root)
    found: int = 0
    new: int = 0
    tasks_created: int = 0
    items: List[Dict[str, Any]] = []

    root = Path(workspace_root)
    exclude_set = set(exclude_dirs)
    patterns_set = set(patterns)

    try:
        for dirpath, dirnames, filenames in os.walk(root):
            # Prune excluded directories in-place
            dirnames[:] = [d for d in dirnames if d not in exclude_set]

            for filename in filenames:
                suffix = Path(filename).suffix
                if suffix not in extensions:
                    continue

                pattern = _get_pattern_for_ext(suffix)
                if pattern is None:
                    continue

                filepath = Path(dirpath) / filename
                try:
                    rel_path = str(filepath.relative_to(root))
                except ValueError:
                    rel_path = str(filepath)

                try:
                    lines = filepath.read_text(encoding="utf-8", errors="replace").splitlines()
                except OSError as exc:
                    log.warning("scan_todos: cannot read %s: %s", filepath, exc)
                    continue

                for lineno, line_text in enumerate(lines, start=1):
                    match = pattern.search(line_text)
                    if not match:
                        continue

                    kind: str = match.group(1)
                    text: str = match.group(2).strip()

                    if kind not in patterns_set:
                        continue

                    found += 1
                    seen_key = _make_seen_key(rel_path, lineno, text)

                    item: Dict[str, Any] = {
                        "file": rel_path,
                        "line": lineno,
                        "kind": kind,
                        "text": text,
                        "task_id": None,
                    }

                    already_seen = _redis.sismember(_SEEN_KEY, seen_key)
                    if already_seen:
                        items.append(item)
                        continue

                    _redis.sadd(_SEEN_KEY, seen_key)
                    new += 1

                    if auto_create_tasks:
                        title = f"[{kind}] {text[:80]}"
                        description = (
                            f"Found in {rel_path}:{lineno}\n\n"
                            f"Original comment: {kind}: {text}\n\n"
                            f"Please resolve this {kind}."
                        )
                        task_type = "backend" if suffix == ".py" else "frontend"
                        try:
                            task_id = _create_agent_task(
                                title=title,
                                description=description,
                                task_type=task_type,
                                requested_by=requested_by,
                            )
                            item["task_id"] = task_id
                            tasks_created += 1
                        except redis.RedisError as exc:
                            log.error("scan_todos: failed to create task for %s:%d: %s", rel_path, lineno, exc)

                    items.append(item)

        # Persist scan stats
        _redis.hset(
            _STATS_KEY,
            mapping={
                "last_scan_ts": str(time.time()),
                "last_scan_found": str(found),
                "total_seen": str(_redis.scard(_SEEN_KEY)),
            },
        )
        log.info(
            "scan_todos: finished — found=%d new=%d tasks_created=%d",
            found,
            new,
            tasks_created,
        )
        return {
            "ok": True,
            "found": found,
            "new": new,
            "tasks_created": tasks_created,
            "items": items,
        }
    except Exception as exc:
        log.exception("scan_todos: unexpected error: %s", exc)
        return {
            "ok": False,
            "error": str(exc),
            "found": found,
            "new": new,
            "tasks_created": tasks_created,
            "items": items,
        }
    finally:
        # Release lock only if we still hold it
        current = _redis.get(_SCAN_LOCK_KEY)
        if current == lock_value:
            _redis.delete(_SCAN_LOCK_KEY)


def get_scan_stats() -> Dict[str, Any]:
    """Return scan statistics: total_seen, last_scan_ts, last_scan_found."""
    raw = _redis.hgetall(_STATS_KEY)
    return {
        "total_seen": int(raw.get("total_seen", 0)),
        "last_scan_ts": float(raw.get("last_scan_ts", 0)),
        "last_scan_found": int(raw.get("last_scan_found", 0)),
    }


def clear_seen_todos() -> Dict[str, Any]:
    """Clear the seen set so all TODOs can be re-processed on next scan."""
    deleted_count = _redis.scard(_SEEN_KEY)
    _redis.delete(_SEEN_KEY)
    log.info("clear_seen_todos: cleared %d entries", deleted_count)
    return {"ok": True, "cleared": deleted_count}
