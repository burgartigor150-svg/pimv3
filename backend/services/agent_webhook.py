"""backend/services/agent_webhook.py

GitHub webhook handler that auto-creates agent tasks.
"""

import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

import redis

log = logging.getLogger(__name__)

_redis = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

_WEBHOOK_SECRET: str = os.getenv("GITHUB_WEBHOOK_SECRET", "")
_EVENTS_KEY = "agent:webhook:events"
_EVENTS_CAP = 100


def _create_agent_task(
    title: str,
    description: str,
    task_type: str,
    requested_by: str = "github_webhook",
) -> str:
    """Persist an agent task in Redis and return the task_id."""
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


def verify_github_signature(payload_bytes: bytes, signature_header: str) -> bool:
    """Verify X-Hub-Signature-256 header.

    Returns True if the signature is valid or if no webhook secret is configured.
    Returns False if a secret is configured but the signature is missing or invalid.
    """
    if not _WEBHOOK_SECRET:
        log.debug("verify_github_signature: no secret configured, skipping verification")
        return True

    if not signature_header:
        log.warning("verify_github_signature: signature header missing")
        return False

    expected_prefix = "sha256="
    if not signature_header.startswith(expected_prefix):
        log.warning("verify_github_signature: unexpected signature format")
        return False

    provided_digest = signature_header[len(expected_prefix):]
    mac = hmac.new(_WEBHOOK_SECRET.encode(), msg=payload_bytes, digestmod=hashlib.sha256)
    expected_digest = mac.hexdigest()

    valid = hmac.compare_digest(provided_digest, expected_digest)
    if not valid:
        log.warning("verify_github_signature: signature mismatch")
    return valid


def handle_push_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Handle a GitHub push event.

    For each commit, inspects added/modified/removed files:
      - If any .py files changed, creates a backend task.
      - If any .ts or .tsx files changed, creates a frontend task.

    Returns {"ok": True, "tasks_created": <int>}
    """
    ref: str = payload.get("ref", "")
    branch = ref.split("/")[-1] if ref else "unknown"

    commits: List[Dict[str, Any]] = payload.get("commits", [])
    head_commit: Optional[Dict[str, Any]] = payload.get("head_commit")
    commit_msg: str = (head_commit or {}).get("message", "").splitlines()[0] if head_commit else "no message"

    py_files: List[str] = []
    ts_files: List[str] = []

    for commit in commits:
        for changed_file in commit.get("added", []) + commit.get("modified", []) + commit.get("removed", []):
            if changed_file.endswith(".py"):
                py_files.append(changed_file)
            elif changed_file.endswith(".ts") or changed_file.endswith(".tsx"):
                ts_files.append(changed_file)

    tasks_created = 0

    if py_files:
        title = f"Review push to {branch}: {commit_msg}"
        description = (
            f"A push was made to branch '{branch}'.\n\n"
            f"Commit message: {commit_msg}\n\n"
            f"Changed Python files ({len(py_files)}):\n"
            + "\n".join(f"  - {f}" for f in py_files[:50])
        )
        try:
            _create_agent_task(
                title=title,
                description=description,
                task_type="backend",
            )
            tasks_created += 1
        except redis.RedisError as exc:
            log.error("handle_push_event: failed to create backend task: %s", exc)

    if ts_files:
        title = f"Review push to {branch}: {commit_msg}"
        description = (
            f"A push was made to branch '{branch}'.\n\n"
            f"Commit message: {commit_msg}\n\n"
            f"Changed TypeScript files ({len(ts_files)}):\n"
            + "\n".join(f"  - {f}" for f in ts_files[:50])
        )
        try:
            _create_agent_task(
                title=title,
                description=description,
                task_type="frontend",
            )
            tasks_created += 1
        except redis.RedisError as exc:
            log.error("handle_push_event: failed to create frontend task: %s", exc)

    log.info("handle_push_event: branch=%s tasks_created=%d", branch, tasks_created)
    return {"ok": True, "tasks_created": tasks_created}


def handle_pull_request_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Handle a GitHub pull_request event (opened/synchronize/reopened).

    Creates a QA agent task with PR details.

    Returns {"ok": True, "tasks_created": <int>}
    """
    action: str = payload.get("action", "")
    if action not in ("opened", "synchronize", "reopened"):
        log.info("handle_pull_request_event: ignoring action=%r", action)
        return {"ok": True, "tasks_created": 0}

    pr: Dict[str, Any] = payload.get("pull_request", {})
    pr_number: int = pr.get("number", 0)
    pr_title: str = pr.get("title", "untitled")
    pr_body: str = pr.get("body") or ""
    base_branch: str = pr.get("base", {}).get("ref", "unknown")
    head_branch: str = pr.get("head", {}).get("ref", "unknown")
    changed_files: int = pr.get("changed_files", 0)
    html_url: str = pr.get("html_url", "")

    title = f"Review PR #{pr_number}: {pr_title}"
    description = (
        f"Pull request #{pr_number} was {action}.\n\n"
        f"Title: {pr_title}\n"
        f"Branch: {head_branch} → {base_branch}\n"
        f"Changed files: {changed_files}\n"
        f"URL: {html_url}\n\n"
        f"Description:\n{pr_body[:2000]}"
    )

    tasks_created = 0
    try:
        _create_agent_task(
            title=title,
            description=description,
            task_type="qa",
        )
        tasks_created = 1
    except redis.RedisError as exc:
        log.error("handle_pull_request_event: failed to create QA task: %s", exc)
        return {"ok": False, "tasks_created": 0, "error": str(exc)}

    log.info("handle_pull_request_event: pr=#%d action=%r tasks_created=%d", pr_number, action, tasks_created)
    return {"ok": True, "tasks_created": tasks_created}


def handle_webhook(
    event_type: str,
    payload: Dict[str, Any],
    signature: str = "",
) -> Dict[str, Any]:
    """Route an incoming GitHub webhook to the appropriate handler.

    Stores the event in the Redis list agent:webhook:events (capped to 100).

    Supported events: push, pull_request.
    Returns the handler result or {"ok": False, "error": "unsupported event"}.
    """
    # Record event (trim to cap)
    event_record = json.dumps(
        {
            "event_type": event_type,
            "ts": time.time(),
            "payload_keys": list(payload.keys()),
        }
    )
    try:
        _redis.lpush(_EVENTS_KEY, event_record)
        _redis.ltrim(_EVENTS_KEY, 0, _EVENTS_CAP - 1)
    except redis.RedisError as exc:
        log.warning("handle_webhook: failed to store event record: %s", exc)

    _HANDLERS = {
        "push": handle_push_event,
        "pull_request": handle_pull_request_event,
    }

    handler = _HANDLERS.get(event_type)
    if handler is None:
        log.info("handle_webhook: unsupported event_type=%r", event_type)
        return {"ok": False, "error": "unsupported event"}

    log.info("handle_webhook: routing event_type=%r", event_type)
    return handler(payload)


def get_webhook_stats() -> Dict[str, Any]:
    """Return the last 10 webhook events from Redis."""
    try:
        raw_events: List[str] = _redis.lrange(_EVENTS_KEY, 0, 9)
    except redis.RedisError as exc:
        log.error("get_webhook_stats: Redis error: %s", exc)
        return {"ok": False, "events": [], "error": str(exc)}

    events: List[Dict[str, Any]] = []
    for raw in raw_events:
        try:
            events.append(json.loads(raw))
        except json.JSONDecodeError as exc:
            log.warning("get_webhook_stats: failed to parse event record: %s", exc)

    return {"ok": True, "events": events}
