"""
backend/services/agent_cron.py

Cron/scheduler service for the autonomous coding agent (PIMv3).
Stores job definitions in Redis and fires agent tasks on schedule.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import redis

# ---------------------------------------------------------------------------
# Infrastructure
# ---------------------------------------------------------------------------

log = logging.getLogger(__name__)

_redis_client: Optional[redis.Redis] = None


def _get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _redis_client = redis.Redis.from_url(url, decode_responses=True)
        log.debug("Redis client initialised from %s", url)
    return _redis_client


# ---------------------------------------------------------------------------
# Redis key helpers
# ---------------------------------------------------------------------------

_KEY_JOB_HASH = "agent:cron:{job_id}"   # Hash for a single job
_KEY_ALL_JOBS  = "agent:cron:all"        # List of all job_ids
_KEY_META      = "agent:cron:meta"       # Hash for service-level metadata


def _job_key(job_id: str) -> str:
    return f"agent:cron:{job_id}"


# ---------------------------------------------------------------------------
# Cron expression parser
# ---------------------------------------------------------------------------

def _parse_cron_next_run(
    cron_expr: str,
    from_ts: Optional[int] = None,
) -> int:
    """Parse a 5-field cron expression and return the next Unix timestamp.

    Supported syntax per field:
        *          — any value
        <number>   — exact match

    Fields (left to right): minute  hour  day-of-month  month  day-of-week
    Day-of-week: 0 = Sunday … 6 = Saturday.
    """
    if from_ts is None:
        from_ts = int(time.time())

    fields = cron_expr.strip().split()
    if len(fields) != 5:
        raise ValueError(
            f"Invalid cron expression {cron_expr!r}: expected 5 fields, got {len(fields)}"
        )

    f_minute, f_hour, f_dom, f_month, f_dow = fields

    def _matches(field: str, value: int) -> bool:
        if field == "*":
            return True
        return int(field) == value

    # Start searching from the *next* minute so we never re-fire immediately.
    # We advance by 60-second steps for up to 4 years (≈ 2 097 600 minutes).
    candidate = (from_ts // 60 + 1) * 60  # round up to next minute boundary
    limit = from_ts + 60 * 60 * 24 * 365 * 4

    while candidate <= limit:
        dt = datetime.fromtimestamp(candidate, tz=timezone.utc)
        dow = dt.weekday()  # Monday=0 … Sunday=6  →  convert to 0=Sun … 6=Sat
        dow_cron = (dow + 1) % 7

        if (
            _matches(f_minute, dt.minute)
            and _matches(f_hour,   dt.hour)
            and _matches(f_dom,    dt.day)
            and _matches(f_month,  dt.month)
            and _matches(f_dow,    dow_cron)
        ):
            return candidate

        candidate += 60  # advance one minute

    raise RuntimeError(
        f"Could not find next run for cron expression {cron_expr!r} within 4 years"
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def create_cron_job(
    *,
    name: str,
    cron_expr: str,
    task_type: str,
    title: str,
    description: str,
    requested_by: str = "cron",
    enabled: bool = True,
) -> Dict[str, Any]:
    """Create a cron job.

    Stores job data in Redis hash ``agent:cron:<job_id>`` and appends
    ``job_id`` to the ``agent:cron:all`` list.

    Returns the newly created job dict.
    """
    r = _get_redis()
    now = int(time.time())
    job_id = str(uuid.uuid4())

    next_run_ts = _parse_cron_next_run(cron_expr, from_ts=now)

    job: Dict[str, Any] = {
        "job_id":       job_id,
        "name":         name,
        "cron_expr":    cron_expr,
        "task_type":    task_type,
        "title":        title,
        "description":  description,
        "requested_by": requested_by,
        "enabled":      "1" if enabled else "0",
        "created_ts":   str(now),
        "next_run_ts":  str(next_run_ts),
        "last_run_ts":  "0",
        "run_count":    "0",
    }

    key = _job_key(job_id)
    r.hset(key, mapping=job)
    r.rpush(_KEY_ALL_JOBS, job_id)

    log.info(
        "Cron job created: job_id=%s name=%s cron=%r next_run=%s",
        job_id, name, cron_expr,
        datetime.fromtimestamp(next_run_ts, tz=timezone.utc).isoformat(),
    )

    return _deserialise_job(job)


def _deserialise_job(raw: Dict[str, str]) -> Dict[str, Any]:
    """Convert the raw Redis hash (all strings) to a typed dict."""
    return {
        "job_id":       raw.get("job_id", ""),
        "name":         raw.get("name", ""),
        "cron_expr":    raw.get("cron_expr", ""),
        "task_type":    raw.get("task_type", ""),
        "title":        raw.get("title", ""),
        "description":  raw.get("description", ""),
        "requested_by": raw.get("requested_by", "cron"),
        "enabled":      raw.get("enabled", "0") == "1",
        "created_ts":   int(raw.get("created_ts", "0")),
        "next_run_ts":  int(raw.get("next_run_ts", "0")),
        "last_run_ts":  int(raw.get("last_run_ts", "0")),
        "run_count":    int(raw.get("run_count", "0")),
    }


def list_cron_jobs() -> List[Dict[str, Any]]:
    """Return all cron jobs stored in Redis, in insertion order."""
    r = _get_redis()
    job_ids: List[str] = r.lrange(_KEY_ALL_JOBS, 0, -1)  # type: ignore[assignment]

    jobs: List[Dict[str, Any]] = []
    for job_id in job_ids:
        raw: Dict[str, str] = r.hgetall(_job_key(job_id))  # type: ignore[assignment]
        if raw:
            jobs.append(_deserialise_job(raw))
        else:
            log.warning("Cron job %s listed in index but hash missing — skipping", job_id)

    log.debug("list_cron_jobs: returning %d jobs", len(jobs))
    return jobs


def delete_cron_job(job_id: str) -> Dict[str, Any]:
    """Delete a cron job by ID.

    Removes the hash and the entry from the all-jobs list.
    Returns the deleted job dict (or an error dict if not found).
    """
    r = _get_redis()
    key = _job_key(job_id)
    raw: Dict[str, str] = r.hgetall(key)  # type: ignore[assignment]

    if not raw:
        log.warning("delete_cron_job: job_id=%s not found", job_id)
        return {"error": "not_found", "job_id": job_id}

    job = _deserialise_job(raw)
    r.delete(key)
    r.lrem(_KEY_ALL_JOBS, 0, job_id)

    log.info("Cron job deleted: job_id=%s name=%s", job_id, job.get("name"))
    return job


def enable_cron_job(job_id: str, enabled: bool) -> Dict[str, Any]:
    """Enable or disable a cron job.

    Returns the updated job dict (or an error dict if not found).
    """
    r = _get_redis()
    key = _job_key(job_id)

    if not r.exists(key):
        log.warning("enable_cron_job: job_id=%s not found", job_id)
        return {"error": "not_found", "job_id": job_id}

    r.hset(key, "enabled", "1" if enabled else "0")

    # If re-enabling, refresh next_run so it doesn't fire immediately for a
    # stale timestamp that has long passed.
    if enabled:
        cron_expr: str = r.hget(key, "cron_expr")  # type: ignore[assignment]
        next_run_ts = _parse_cron_next_run(cron_expr)
        r.hset(key, "next_run_ts", str(next_run_ts))

    raw: Dict[str, str] = r.hgetall(key)  # type: ignore[assignment]
    job = _deserialise_job(raw)

    log.info(
        "Cron job %s: job_id=%s name=%s",
        "enabled" if enabled else "disabled",
        job_id,
        job.get("name"),
    )
    return job


# ---------------------------------------------------------------------------
# Scheduler tick
# ---------------------------------------------------------------------------

def check_and_fire_cron_jobs() -> List[str]:
    """Check all enabled cron jobs and fire those whose ``next_run_ts`` <= now.

    For each due job:
    1. Creates an agent task via :func:`create_agent_task`.
    2. Increments ``run_count`` and updates ``last_run_ts`` / ``next_run_ts``.

    Returns a list of fired ``job_id`` strings.
    """
    # Import here to avoid circular imports at module load time.
    from backend.services.agent_task_console import create_agent_task  # type: ignore[import]

    r = _get_redis()
    now = int(time.time())
    fired: List[str] = []

    job_ids: List[str] = r.lrange(_KEY_ALL_JOBS, 0, -1)  # type: ignore[assignment]

    for job_id in job_ids:
        key = _job_key(job_id)
        raw: Dict[str, str] = r.hgetall(key)  # type: ignore[assignment]

        if not raw:
            log.warning("check_and_fire_cron_jobs: hash missing for job_id=%s", job_id)
            continue

        if raw.get("enabled", "0") != "1":
            continue

        next_run_ts = int(raw.get("next_run_ts", "0"))
        if next_run_ts > now:
            continue

        # ---- Fire -------------------------------------------------------
        task_id: Optional[str] = None
        try:
            task = create_agent_task(
                task_type=raw.get("task_type", ""),
                title=raw.get("title", ""),
                description=raw.get("description", ""),
                requested_by=raw.get("requested_by", "cron"),
            )
            task_id = task.get("task_id")
            log.info(
                "Cron job fired: job_id=%s name=%s task_id=%s",
                job_id, raw.get("name"), task_id,
            )
        except Exception:
            log.exception(
                "Failed to create agent task for cron job_id=%s name=%s",
                job_id, raw.get("name"),
            )

        # ---- Update Redis -----------------------------------------------
        new_next_run = _parse_cron_next_run(raw.get("cron_expr", "* * * * *"), from_ts=now)
        run_count = int(raw.get("run_count", "0")) + 1

        r.hset(key, mapping={
            "last_run_ts":  str(now),
            "next_run_ts":  str(new_next_run),
            "run_count":    str(run_count),
        })

        fired.append(job_id)

    # Record last scheduler check timestamp
    r.hset(_KEY_META, "last_check_ts", str(now))

    if fired:
        log.info("check_and_fire_cron_jobs: fired %d job(s): %s", len(fired), fired)
    else:
        log.debug("check_and_fire_cron_jobs: no jobs due (checked %d total)", len(job_ids))

    return fired


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

def get_cron_status() -> Dict[str, Any]:
    """Return a summary dict with totals, enabled count, last check, next jobs."""
    r = _get_redis()
    jobs = list_cron_jobs()

    total = len(jobs)
    enabled_count = sum(1 for j in jobs if j["enabled"])

    meta: Dict[str, str] = r.hgetall(_KEY_META)  # type: ignore[assignment]
    last_check_ts = int(meta.get("last_check_ts", "0"))

    now = int(time.time())
    upcoming = sorted(
        [j for j in jobs if j["enabled"] and j["next_run_ts"] > 0],
        key=lambda j: j["next_run_ts"],
    )[:5]

    next_jobs = [
        {
            "job_id":      j["job_id"],
            "name":        j["name"],
            "next_run_ts": j["next_run_ts"],
            "next_run_iso": datetime.fromtimestamp(
                j["next_run_ts"], tz=timezone.utc
            ).isoformat(),
            "seconds_until": max(0, j["next_run_ts"] - now),
        }
        for j in upcoming
    ]

    status: Dict[str, Any] = {
        "total_jobs":    total,
        "enabled_jobs":  enabled_count,
        "disabled_jobs": total - enabled_count,
        "last_check_ts": last_check_ts,
        "last_check_iso": (
            datetime.fromtimestamp(last_check_ts, tz=timezone.utc).isoformat()
            if last_check_ts
            else None
        ),
        "next_jobs": next_jobs,
    }

    log.debug("get_cron_status: %s", status)
    return status


# ---------------------------------------------------------------------------
# Default jobs — registered once on first import
# ---------------------------------------------------------------------------

_DEFAULT_JOBS: List[Dict[str, Any]] = [
    {
        "name":        "conventions-auto-update",
        "cron_expr":   "0 */6 * * *",
        "task_type":   "conventions_update",
        "title":       "Auto-update CONVENTIONS.md",
        "description": "Periodically regenerate CONVENTIONS.md from current codebase patterns.",
    },
    {
        "name":        "metrics-cleanup",
        "cron_expr":   "0 2 * * *",
        "task_type":   "metrics_cleanup",
        "title":       "Cleanup old agent metrics",
        "description": "Remove stale agent metric records older than the retention window.",
    },
    {
        "name":        "todo-scan",
        "cron_expr":   "0 9 * * 1",
        "task_type":   "todo_scan",
        "title":       "Scan codebase for TODO/FIXME",
        "description": "Scan entire codebase for TODO/FIXME comments and create a report task.",
    },
]

_DEFAULTS_REGISTERED_KEY = "agent:cron:defaults_registered"


def _register_default_jobs() -> None:
    """Register default cron jobs if they have not been registered yet.

    Uses a Redis key as a guard so that jobs are only inserted once across
    all process restarts / replica startups.
    """
    r = _get_redis()

    # Atomic guard: only the first caller (across all replicas) proceeds.
    registered = r.setnx(_DEFAULTS_REGISTERED_KEY, "1")
    if not registered:
        log.debug("Default cron jobs already registered — skipping")
        return

    log.info("Registering %d default cron jobs", len(_DEFAULT_JOBS))
    for spec in _DEFAULT_JOBS:
        try:
            create_cron_job(
                name=spec["name"],
                cron_expr=spec["cron_expr"],
                task_type=spec["task_type"],
                title=spec["title"],
                description=spec["description"],
                requested_by="system",
                enabled=True,
            )
        except Exception:
            log.exception("Failed to register default cron job %r", spec.get("name"))


# Run at import time (no Redis call if already registered).
try:
    _register_default_jobs()
except Exception:
    log.exception("Unexpected error while registering default cron jobs")
