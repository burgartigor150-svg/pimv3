"""
agent_metrics.py — Metrics and observability for the PIMv3 agent system.

Tracks per-task: tokens used, steps taken, duration, success rate,
cost estimate, agent type, tools called.
Provides: dashboard data, cost estimation before run, historical stats.
"""

import os
import json
import time
import logging
import statistics
from typing import Any, Dict, List, Optional

import redis

logger = logging.getLogger(__name__)

_redis = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

_METRICS_KEY_PREFIX = "agent:metrics:"
_METRICS_ALL_KEY = "agent:metrics:all"
_90_DAYS_SECONDS = 90 * 24 * 3600
_COST_PER_TOKEN = 0.000002  # deepseek pricing

_DEFAULT_TOKEN_ESTIMATES: Dict[str, int] = {
    "backend": 5000,
    "api-integration": 12000,
    "design": 8000,
    "schema_change": 6000,
}


def _task_metrics_key(task_id: str) -> str:
    return f"{_METRICS_KEY_PREFIX}{task_id}"


def record_task_metrics(
    task_id: str,
    task_type: str,
    status: str,
    steps: int,
    total_tokens: int,
    duration_seconds: int,
    tools_used: List[Any],
    agent_count: int = 1,
) -> None:
    """Store task metrics in Redis hash and track in the global list."""
    cost_usd = total_tokens * _COST_PER_TOKEN
    ts = int(time.time())

    key = _task_metrics_key(task_id)
    mapping: Dict[str, str] = {
        "task_id": str(task_id),
        "task_type": str(task_type),
        "status": str(status),
        "steps": str(steps),
        "total_tokens": str(total_tokens),
        "duration_seconds": str(duration_seconds),
        "tools_used": json.dumps(tools_used if isinstance(tools_used, list) else []),
        "agent_count": str(agent_count),
        "ts": str(ts),
        "cost_usd": str(round(cost_usd, 8)),
    }

    pipe = _redis.pipeline()
    pipe.hset(key, mapping=mapping)
    pipe.expire(key, _90_DAYS_SECONDS)
    pipe.lpush(_METRICS_ALL_KEY, task_id)
    pipe.ltrim(_METRICS_ALL_KEY, 0, 499)
    pipe.execute()


def get_task_metrics(task_id: str) -> Dict[str, Any]:
    """Retrieve metrics for a single task from Redis."""
    key = _task_metrics_key(task_id)
    raw = _redis.hgetall(key)
    if not raw:
        return {"ok": False, "error": "not found"}

    result: Dict[str, Any] = dict(raw)
    try:
        result["tools_used"] = json.loads(raw.get("tools_used", "[]"))
    except Exception:
        result["tools_used"] = []

    for int_field in ("steps", "total_tokens", "duration_seconds", "agent_count", "ts"):
        if int_field in result:
            try:
                result[int_field] = int(result[int_field])
            except (ValueError, TypeError):
                result[int_field] = 0

    for float_field in ("cost_usd",):
        if float_field in result:
            try:
                result[float_field] = float(result[float_field])
            except (ValueError, TypeError):
                result[float_field] = 0.0

    result["ok"] = True
    return result


def get_metrics_summary(limit: int = 100) -> Dict[str, Any]:
    """Compute aggregate statistics over the last `limit` tasks."""
    task_ids: List[str] = _redis.lrange(_METRICS_ALL_KEY, 0, limit - 1) or []

    all_metrics: List[Dict[str, Any]] = []
    for tid in task_ids:
        m = get_task_metrics(tid)
        if m.get("ok"):
            all_metrics.append(m)

    total_tasks = len(all_metrics)
    if total_tasks == 0:
        return {
            "total_tasks": 0,
            "success_rate": 0.0,
            "avg_steps": 0.0,
            "avg_tokens": 0.0,
            "avg_duration_seconds": 0.0,
            "total_cost_usd": 0.0,
            "most_used_tools": [],
            "tasks_by_type": {},
            "failure_reasons": [],
        }

    successes = sum(1 for m in all_metrics if m.get("status") == "success")
    success_rate = round(successes / total_tasks * 100, 2)

    steps_list = [m.get("steps", 0) for m in all_metrics]
    tokens_list = [m.get("total_tokens", 0) for m in all_metrics]
    duration_list = [m.get("duration_seconds", 0) for m in all_metrics]
    total_cost = sum(m.get("cost_usd", 0.0) for m in all_metrics)

    avg_steps = round(statistics.mean(steps_list), 2) if steps_list else 0.0
    avg_tokens = round(statistics.mean(tokens_list), 2) if tokens_list else 0.0
    avg_duration = round(statistics.mean(duration_list), 2) if duration_list else 0.0

    tool_counts: Dict[str, int] = {}
    for m in all_metrics:
        for tool in m.get("tools_used", []):
            tool_name = str(tool) if not isinstance(tool, str) else tool
            tool_counts[tool_name] = tool_counts.get(tool_name, 0) + 1
    most_used_tools = sorted(tool_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    most_used_tools_list = [{"tool": t, "count": c} for t, c in most_used_tools]

    tasks_by_type: Dict[str, int] = {}
    for m in all_metrics:
        tt = m.get("task_type", "unknown")
        tasks_by_type[tt] = tasks_by_type.get(tt, 0) + 1

    failure_reasons: List[str] = []
    for m in all_metrics:
        if m.get("status") == "failed":
            reason = m.get("error", m.get("task_type", "unknown"))
            failure_reasons.append(str(reason))

    return {
        "total_tasks": total_tasks,
        "success_rate": success_rate,
        "avg_steps": avg_steps,
        "avg_tokens": avg_tokens,
        "avg_duration_seconds": avg_duration,
        "total_cost_usd": round(total_cost, 6),
        "most_used_tools": most_used_tools_list,
        "tasks_by_type": tasks_by_type,
        "failure_reasons": failure_reasons,
    }


def estimate_task_cost(task_type: str, description: str) -> Dict[str, Any]:
    """Estimate cost and resource usage for a task before running it."""
    task_ids: List[str] = _redis.lrange(_METRICS_ALL_KEY, 0, 499) or []

    similar: List[Dict[str, Any]] = []
    for tid in task_ids:
        m = get_task_metrics(tid)
        if m.get("ok") and m.get("task_type") == task_type and m.get("status") == "success":
            similar.append(m)

    if similar:
        n = len(similar)
        avg_tokens = statistics.mean([m.get("total_tokens", 0) for m in similar])
        avg_steps = statistics.mean([m.get("steps", 0) for m in similar])
        avg_duration = statistics.mean([m.get("duration_seconds", 0) for m in similar])
        estimated_cost = avg_tokens * _COST_PER_TOKEN
        confidence = "high" if n >= 10 else ("medium" if n >= 3 else "low")
        return {
            "estimated_tokens": round(avg_tokens),
            "estimated_steps": round(avg_steps),
            "estimated_duration_seconds": round(avg_duration),
            "estimated_cost_usd": round(estimated_cost, 6),
            "confidence": confidence,
            "based_on_samples": n,
        }

    # Fallback defaults
    default_tokens = _DEFAULT_TOKEN_ESTIMATES.get(task_type, 7000)
    default_steps = 5
    default_duration = 120
    estimated_cost = default_tokens * _COST_PER_TOKEN

    return {
        "estimated_tokens": default_tokens,
        "estimated_steps": default_steps,
        "estimated_duration_seconds": default_duration,
        "estimated_cost_usd": round(estimated_cost, 6),
        "confidence": "low",
        "based_on_samples": 0,
    }


def get_agent_dashboard() -> Dict[str, Any]:
    """Return a full dashboard payload for the agent monitoring UI."""
    summary = get_metrics_summary(limit=100)

    recent_ids: List[str] = _redis.lrange(_METRICS_ALL_KEY, 0, 9) or []
    recent_tasks: List[Dict[str, Any]] = []
    for tid in recent_ids:
        m = get_task_metrics(tid)
        if m.get("ok"):
            recent_tasks.append({
                "task_id": m.get("task_id"),
                "task_type": m.get("task_type"),
                "status": m.get("status"),
                "cost_usd": m.get("cost_usd"),
                "ts": m.get("ts"),
            })

    # Hourly task counts over the last 24 hours
    now = int(time.time())
    cutoff = now - 24 * 3600
    all_ids: List[str] = _redis.lrange(_METRICS_ALL_KEY, 0, 499) or []
    hourly_counts: Dict[str, int] = {}
    for tid in all_ids:
        m = get_task_metrics(tid)
        if not m.get("ok"):
            continue
        ts = m.get("ts", 0)
        if ts < cutoff:
            continue
        hour_label = str(int((ts - cutoff) // 3600))
        hourly_counts[hour_label] = hourly_counts.get(hour_label, 0) + 1

    hourly_tasks = [{"hour": h, "count": c} for h, c in sorted(hourly_counts.items(), key=lambda x: int(x[0]))]

    total_tracked = _redis.llen(_METRICS_ALL_KEY) or 0
    try:
        _redis.ping()
        redis_status = "ok"
    except Exception:
        redis_status = "error"

    return {
        "summary": summary,
        "recent_tasks": recent_tasks,
        "hourly_tasks": hourly_tasks,
        "health": {
            "redis": redis_status,
            "total_tasks_tracked": total_tracked,
        },
    }
