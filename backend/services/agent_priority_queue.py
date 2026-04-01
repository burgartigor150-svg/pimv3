"""
backend/services/agent_priority_queue.py

Priority-based task queue for PIMv3 agent workers.
Replaces FIFO with a Redis sorted-set queue where score encodes both
priority level and enqueue time so that equal-priority tasks are served FIFO.
"""

import os
import logging
import json
import time
from typing import Dict, Any, List, Optional

import redis

log = logging.getLogger(__name__)

_redis: redis.Redis = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

# Redis sorted set: score = priority * 1_000_000_000_000 + unix_ts_ms
# Lower score => dequeued first (lower priority number = more urgent)
_QUEUE_KEY = "agent:priority_queue"

# Legacy FIFO fallback list used by the old worker
_LEGACY_LIST_KEY = "agent_task:items"

PRIORITY_CRITICAL = 0
PRIORITY_HIGH = 1
PRIORITY_NORMAL = 2
PRIORITY_LOW = 3

_PRIORITY_NAMES: Dict[int, str] = {
    PRIORITY_CRITICAL: "critical",
    PRIORITY_HIGH: "high",
    PRIORITY_NORMAL: "normal",
    PRIORITY_LOW: "low",
}

_SCORE_MULTIPLIER = 1_000_000_000_000  # 1e12


def _score(priority: int, ts_ms: Optional[int] = None) -> float:
    """Compute the sorted-set score for a given priority and timestamp."""
    if ts_ms is None:
        ts_ms = int(time.time() * 1000)
    return float(priority * _SCORE_MULTIPLIER + ts_ms)


def _decode_score(score: float) -> Dict[str, Any]:
    """Reverse a sorted-set score back into priority and timestamp components."""
    score_int = int(score)
    priority = score_int // _SCORE_MULTIPLIER
    ts_ms = score_int % _SCORE_MULTIPLIER
    return {"priority": priority, "ts_ms": ts_ms}


def enqueue_task(task_id: str, priority: int = PRIORITY_NORMAL) -> Dict[str, Any]:
    """Add *task_id* to the priority sorted set.

    Score = priority * 1_000_000_000_000 + current_unix_ts_ms so that tasks
    with the same priority level are served FIFO by enqueue time.

    Returns ``{"ok": True, "position": N}`` where *N* is 0-based rank after
    insertion (0 = next to be dequeued).
    """
    if priority not in _PRIORITY_NAMES:
        log.warning("Unknown priority %d for task %s; defaulting to NORMAL", priority, task_id)
        priority = PRIORITY_NORMAL

    ts_ms = int(time.time() * 1000)
    computed_score = _score(priority, ts_ms)

    added = _redis.zadd(_QUEUE_KEY, {task_id: computed_score})
    position: int = _redis.zrank(_QUEUE_KEY, task_id) or 0

    log.info(
        "Enqueued task %s with priority=%s score=%.0f position=%d (added=%s)",
        task_id,
        _PRIORITY_NAMES.get(priority, str(priority)),
        computed_score,
        position,
        bool(added),
    )
    return {"ok": True, "position": position}


def dequeue_task() -> Optional[str]:
    """Pop the task with the lowest score (highest urgency, then oldest).

    Uses ``ZPOPMIN`` which is atomic.  Returns the *task_id* string or
    ``None`` when the queue is empty.
    """
    result: List[tuple] = _redis.zpopmin(_QUEUE_KEY, count=1)
    if not result:
        log.debug("Priority queue is empty")
        return None

    task_id, score = result[0]
    meta = _decode_score(score)
    log.info(
        "Dequeued task %s (priority=%s score=%.0f)",
        task_id,
        _PRIORITY_NAMES.get(meta["priority"], str(meta["priority"])),
        score,
    )
    return task_id


def peek_queue(limit: int = 20) -> List[Dict[str, Any]]:
    """Return the next *limit* tasks without removing them.

    Each entry::

        {
            "task_id": str,
            "priority": int,
            "priority_name": str,
            "queued_at_ts": int,   # unix seconds
            "position": int,       # 0-based
        }
    """
    entries: List[tuple] = _redis.zrange(_QUEUE_KEY, 0, limit - 1, withscores=True)
    tasks: List[Dict[str, Any]] = []
    for position, (task_id, score) in enumerate(entries):
        meta = _decode_score(score)
        priority = meta["priority"]
        tasks.append(
            {
                "task_id": task_id,
                "priority": priority,
                "priority_name": _PRIORITY_NAMES.get(priority, str(priority)),
                "queued_at_ts": meta["ts_ms"] // 1000,
                "position": position,
            }
        )
    return tasks


def requeue_with_priority(task_id: str, new_priority: int) -> Dict[str, Any]:
    """Change the priority of an already-queued task atomically.

    Removes the existing entry and re-adds it with a *fresh* timestamp so
    it goes to the back of the new priority bucket.

    Returns ``{"ok": True, "position": N}`` or ``{"ok": False, "reason": ...}``.
    """
    if new_priority not in _PRIORITY_NAMES:
        log.warning("Unknown priority %d requested for task %s", new_priority, task_id)
        new_priority = PRIORITY_NORMAL

    removed: int = _redis.zrem(_QUEUE_KEY, task_id)
    if not removed:
        log.warning("requeue_with_priority: task %s not found in queue", task_id)
        return {"ok": False, "reason": "task_not_found"}

    result = enqueue_task(task_id, priority=new_priority)
    log.info(
        "Requeued task %s with new priority=%s position=%d",
        task_id,
        _PRIORITY_NAMES.get(new_priority),
        result["position"],
    )
    return result


def get_queue_stats() -> Dict[str, Any]:
    """Return aggregate statistics about the current queue state.

    Returns::

        {
            "total_queued": int,
            "by_priority": {"critical": int, "high": int, "normal": int, "low": int},
            "oldest_task_ts": int | None,   # unix seconds of the oldest enqueued task
        }
    """
    total: int = _redis.zcard(_QUEUE_KEY)

    by_priority: Dict[str, int] = {name: 0 for name in _PRIORITY_NAMES.values()}

    all_entries: List[tuple] = _redis.zrange(_QUEUE_KEY, 0, -1, withscores=True)
    oldest_ts: Optional[int] = None

    for task_id, score in all_entries:
        meta = _decode_score(score)
        priority = meta["priority"]
        name = _PRIORITY_NAMES.get(priority, str(priority))
        by_priority[name] = by_priority.get(name, 0) + 1
        ts_s = meta["ts_ms"] // 1000
        if oldest_ts is None or ts_s < oldest_ts:
            oldest_ts = ts_s

    stats: Dict[str, Any] = {
        "total_queued": total,
        "by_priority": by_priority,
        "oldest_task_ts": oldest_ts,
    }
    log.debug("Queue stats: %s", stats)
    return stats


def remove_from_queue(task_id: str) -> bool:
    """Remove a specific task from the queue (e.g. when the task is cancelled).

    Returns ``True`` if the task was present and removed, ``False`` otherwise.
    """
    removed: int = _redis.zrem(_QUEUE_KEY, task_id)
    if removed:
        log.info("Removed task %s from priority queue", task_id)
    else:
        log.debug("remove_from_queue: task %s was not in queue", task_id)
    return bool(removed)


# ---------------------------------------------------------------------------
# Worker integration — patched replacement for the legacy FIFO dequeue
# ---------------------------------------------------------------------------

def get_next_task_id() -> Optional[str]:
    """Return the next task ID to process.

    Strategy:
    1. Try the priority sorted set first (``dequeue_task``).
    2. If the priority queue is empty, fall back to the legacy Redis list
       ``agent_task:items`` via ``LPOP`` so old-style enqueued tasks are not
       lost during migration.

    Returns the task ID string or ``None`` when both sources are empty.
    """
    task_id = dequeue_task()
    if task_id is not None:
        return task_id

    # Fallback: legacy FIFO list
    legacy_task_id: Optional[str] = _redis.lpop(_LEGACY_LIST_KEY)
    if legacy_task_id:
        log.info("Dequeued task %s from legacy FIFO list (fallback)", legacy_task_id)
    else:
        log.debug("Both priority queue and legacy list are empty")
    return legacy_task_id
