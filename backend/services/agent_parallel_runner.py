"""backend/services/agent_parallel_runner.py

Runs multiple independent agent tasks concurrently using asyncio, with a
semaphore-based concurrency cap and Redis-backed slot tracking.
"""

import os
import logging
import json
import time
import asyncio
from typing import Dict, Any, List, Optional

import redis

log = logging.getLogger(__name__)

_redis = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

_PARALLEL_LOCK_PREFIX = "agent:parallel:slot:"
MAX_PARALLEL_TASKS: int = int(os.getenv("AGENT_MAX_PARALLEL", "3"))

# Key patterns used by the wider agent system
_TASK_STATUS_PREFIX = "agent:task:"
_PRIORITY_QUEUE_KEY = "agent:queue:priority"
_FILELOCK_PREFIX = "agent:filelock:"
_TODAY_RUN_KEY = "agent:parallel:runs:{date}"


# ---------------------------------------------------------------------------
# Lazy import helper (avoids circular imports at module load time)
# ---------------------------------------------------------------------------

def _get_run_agent_task():  # type: ignore[return]
    """Import run_agent_task lazily to avoid circular dependencies."""
    from backend.services.agent_task_console import run_agent_task  # noqa: PLC0415
    return run_agent_task


def _get_check_task_dependencies():  # type: ignore[return]
    """Import check_task_dependencies lazily."""
    from backend.services.agent_task_console import check_task_dependencies  # noqa: PLC0415
    return check_task_dependencies


# ---------------------------------------------------------------------------
# Synchronous helpers
# ---------------------------------------------------------------------------

def get_running_tasks() -> List[str]:
    """Return the list of task IDs whose Redis status record says ``running``."""
    running: List[str] = []
    # Scan all task status keys; pattern: agent:task:<id>:status
    cursor = 0
    pattern = f"{_TASK_STATUS_PREFIX}*:status"
    while True:
        cursor, keys = _redis.scan(cursor, match=pattern, count=200)
        for key in keys:
            val = _redis.get(key)
            if val == "running":
                # Extract task_id from  agent:task:<id>:status
                parts = key.split(":")
                if len(parts) >= 3:
                    running.append(parts[2])
        if cursor == 0:
            break
    log.debug("get_running_tasks: found %d running tasks", len(running))
    return running


def _get_locked_files() -> set:
    """Return the set of file paths currently held by agent file-locks."""
    locked: set = set()
    cursor = 0
    while True:
        cursor, keys = _redis.scan(cursor, match=f"{_FILELOCK_PREFIX}*", count=200)
        for key in keys:
            # key = agent:filelock:<file_path>
            locked.add(key[len(_FILELOCK_PREFIX):])
        if cursor == 0:
            break
    return locked


def _get_task_files(task_id: str) -> List[str]:
    """Return the list of files a task intends to modify (from its metadata)."""
    raw = _redis.get(f"{_TASK_STATUS_PREFIX}{task_id}:meta")
    if not raw:
        return []
    try:
        meta: Dict[str, Any] = json.loads(raw)
        return meta.get("files", [])
    except json.JSONDecodeError:
        return []


def can_run_parallel(task_id: str) -> bool:
    """Return True if a new parallel slot is available and there are no file-lock conflicts.

    A slot is available when the number of currently running tasks is below
    ``MAX_PARALLEL_TASKS``.  File-lock conflicts are checked by comparing the
    task's declared file list against ``agent:filelock:*`` keys.
    """
    running = get_running_tasks()
    if len(running) >= MAX_PARALLEL_TASKS:
        log.debug(
            "can_run_parallel(%s): no slots (running=%d max=%d)",
            task_id,
            len(running),
            MAX_PARALLEL_TASKS,
        )
        return False

    # Check file-lock conflicts
    task_files = set(_get_task_files(task_id))
    if task_files:
        locked_files = _get_locked_files()
        conflicts = task_files & locked_files
        if conflicts:
            log.debug(
                "can_run_parallel(%s): file-lock conflict on %s",
                task_id,
                conflicts,
            )
            return False

    return True


def get_parallel_stats() -> Dict[str, Any]:
    """Return a snapshot of parallel-runner statistics.

    Keys:
    - max_parallel: configured concurrency cap
    - currently_running: number of tasks in ``running`` state right now
    - total_run_today: counter of tasks launched today
    """
    running = get_running_tasks()
    today = time.strftime("%Y-%m-%d")
    raw_today = _redis.get(_TODAY_RUN_KEY.format(date=today))
    total_today = int(raw_today) if raw_today else 0

    return {
        "max_parallel": MAX_PARALLEL_TASKS,
        "currently_running": len(running),
        "total_run_today": total_today,
    }


# ---------------------------------------------------------------------------
# Async core
# ---------------------------------------------------------------------------

async def _run_single_task(
    task_id: str,
    ai_key: str,
    semaphore: asyncio.Semaphore,
) -> Dict[str, Any]:
    """Acquire the semaphore and execute one task, returning a normalised result dict."""
    async with semaphore:
        log.info("Starting task %s", task_id)
        slot_key = f"{_PARALLEL_LOCK_PREFIX}{task_id}"
        today = time.strftime("%Y-%m-%d")
        today_key = _TODAY_RUN_KEY.format(date=today)

        # Mark slot as active
        _redis.set(slot_key, "active", ex=3600)
        _redis.incr(today_key)
        # Set TTL on the daily counter if it was just created
        if _redis.ttl(today_key) < 0:
            _redis.expire(today_key, 86400)

        started_at = time.monotonic()
        try:
            run_agent_task = _get_run_agent_task()
            result: Dict[str, Any] = await run_agent_task(
                task_id=task_id,
                ai_key=ai_key,
            )
            elapsed = round(time.monotonic() - started_at, 2)
            log.info("Task %s finished in %.2fs status=%s", task_id, elapsed, result.get("status"))
            result.setdefault("task_id", task_id)
            result.setdefault("elapsed_s", elapsed)
            return result
        except Exception as exc:  # noqa: BLE001
            elapsed = round(time.monotonic() - started_at, 2)
            log.exception("Task %s raised an unhandled exception after %.2fs", task_id, elapsed)
            return {
                "task_id": task_id,
                "status": "error",
                "error": str(exc),
                "elapsed_s": elapsed,
            }
        finally:
            _redis.delete(slot_key)


async def run_tasks_parallel(
    task_ids: List[str],
    ai_key: str = "",
    max_concurrent: Optional[int] = None,
) -> Dict[str, Any]:
    """Run multiple tasks concurrently, bounded by a semaphore.

    Args:
        task_ids: Ordered list of task IDs to execute.
        ai_key: API key forwarded to the underlying task runner.
        max_concurrent: Override for the concurrency cap (defaults to
            ``MAX_PARALLEL_TASKS``).

    Returns:
        A dict with keys ``ok``, ``results`` (mapping task_id → result),
        ``total``, ``succeeded``, and ``failed``.
    """
    if not task_ids:
        log.warning("run_tasks_parallel called with empty task list")
        return {"ok": True, "results": {}, "total": 0, "succeeded": 0, "failed": 0}

    cap = max_concurrent if max_concurrent is not None else MAX_PARALLEL_TASKS
    cap = max(1, cap)
    semaphore = asyncio.Semaphore(cap)

    log.info(
        "run_tasks_parallel: scheduling %d tasks with concurrency cap %d",
        len(task_ids),
        cap,
    )

    coros = [_run_single_task(tid, ai_key, semaphore) for tid in task_ids]
    raw_results: List[Dict[str, Any]] = await asyncio.gather(*coros, return_exceptions=False)

    results: Dict[str, Any] = {}
    succeeded = 0
    failed = 0
    for res in raw_results:
        tid = res.get("task_id", "unknown")
        results[tid] = res
        if res.get("status") in ("success", "completed", "done"):
            succeeded += 1
        else:
            failed += 1

    log.info(
        "run_tasks_parallel complete: total=%d succeeded=%d failed=%d",
        len(task_ids),
        succeeded,
        failed,
    )
    return {
        "ok": True,
        "results": results,
        "total": len(task_ids),
        "succeeded": succeeded,
        "failed": failed,
    }


async def run_pending_queue_parallel(
    ai_key: str = "",
    max_batch: int = 5,
) -> Dict[str, Any]:
    """Dequeue up to ``max_batch`` tasks from the priority queue and run eligible ones.

    Eligibility requires:
    - Task dependencies are satisfied (via ``check_task_dependencies``).
    - A parallel slot is available (via ``can_run_parallel``).

    Returns a summary dict describing how many tasks were started/skipped.
    """
    check_task_dependencies = _get_check_task_dependencies()

    # Pull candidate IDs from the sorted-set priority queue (highest score first)
    candidates: List[str] = _redis.zrevrange(_PRIORITY_QUEUE_KEY, 0, max_batch * 2 - 1)

    eligible: List[str] = []
    skipped_deps: List[str] = []
    skipped_slots: List[str] = []

    for task_id in candidates:
        if len(eligible) >= max_batch:
            break
        # Check dependency satisfaction
        try:
            deps_ok: bool = await check_task_dependencies(task_id)
        except Exception as exc:  # noqa: BLE001
            log.warning("Dependency check failed for %s: %s", task_id, exc)
            skipped_deps.append(task_id)
            continue

        if not deps_ok:
            skipped_deps.append(task_id)
            continue

        if not can_run_parallel(task_id):
            skipped_slots.append(task_id)
            continue

        # Remove from queue before starting (prevents double-scheduling)
        _redis.zrem(_PRIORITY_QUEUE_KEY, task_id)
        eligible.append(task_id)

    if not eligible:
        log.info(
            "run_pending_queue_parallel: nothing eligible "
            "(skipped_deps=%d skipped_slots=%d)",
            len(skipped_deps),
            len(skipped_slots),
        )
        return {
            "ok": True,
            "started": 0,
            "eligible": [],
            "skipped_deps": skipped_deps,
            "skipped_slots": skipped_slots,
        }

    log.info("run_pending_queue_parallel: starting %d tasks", len(eligible))
    run_result = await run_tasks_parallel(eligible, ai_key=ai_key)

    return {
        "ok": True,
        "started": len(eligible),
        "eligible": eligible,
        "skipped_deps": skipped_deps,
        "skipped_slots": skipped_slots,
        "run_result": run_result,
    }
