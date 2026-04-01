"""backend/services/agent_self_improve.py

After every IMPROVE_EVERY_N completed tasks, analyzes failure/success patterns
and rewrites the agent's system prompt via an LLM call.
"""

import os
import logging
import json
import time
import asyncio
from typing import Dict, Any, List, Optional

import redis
import httpx

log = logging.getLogger(__name__)

_redis = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

_PROMPT_KEY = "agent:system_prompt:current"
_IMPROVE_COUNTER_KEY = "agent:self_improve:count"
_IMPROVE_LOG_KEY = "agent:self_improve:log"

IMPROVE_EVERY_N = 10


# ---------------------------------------------------------------------------
# Synchronous helpers
# ---------------------------------------------------------------------------

def _get_base_system_prompt() -> str:
    """Return the hardcoded base system prompt for the coding agent.

    Describes role, style conventions and tool-usage hints that serve as the
    starting point before any LLM-driven improvements.
    """
    return (
        "You are a senior Python / TypeScript developer working inside the PIMv3 "
        "project (FastAPI backend, React + Tailwind frontend, PostgreSQL + Redis).\n\n"
        "STYLE:\n"
        "- Use async/await throughout; never block the event loop.\n"
        "- FastAPI route handlers must declare proper response_model and status_code.\n"
        "- Database access via SQLAlchemy 2.x async sessions; never use raw queries "
        "unless unavoidable.\n"
        "- All public functions and methods must carry full type hints.\n"
        "- Use structlog or stdlib logging (log = logging.getLogger(__name__)); "
        "no print().\n\n"
        "CONVENTIONS (from CONVENTIONS.md):\n"
        "- File names: snake_case for Python, kebab-case for TS/TSX.\n"
        "- Pydantic v2 models for request/response schemas.\n"
        "- Tailwind utility classes only; no inline style attributes.\n"
        "- Redis keys follow the pattern  <domain>:<entity>:<id>.\n\n"
        "TOOLS:\n"
        "- Prefer read_file / write_file over shell commands.\n"
        "- After every code change run the project's test suite via run_tests.\n"
        "- When uncertain about an API surface, search the codebase before guessing.\n"
    )


def get_current_system_prompt() -> str:
    """Return the current system prompt from Redis, or the base prompt if unset."""
    stored: Optional[str] = _redis.get(_PROMPT_KEY)
    if stored:
        log.debug("Loaded system prompt from Redis (%d chars)", len(stored))
        return stored
    log.debug("No stored system prompt found; returning base prompt")
    return _get_base_system_prompt()


def increment_task_counter() -> int:
    """Increment the completed-task counter and return the new value."""
    new_count: int = _redis.incr(_IMPROVE_COUNTER_KEY)
    log.debug("Task counter incremented to %d", new_count)
    return new_count


def should_run_improvement() -> bool:
    """Return True when the completed-task counter has reached IMPROVE_EVERY_N."""
    raw: Optional[str] = _redis.get(_IMPROVE_COUNTER_KEY)
    count = int(raw) if raw else 0
    return count >= IMPROVE_EVERY_N


def get_improvement_log() -> List[Dict[str, Any]]:
    """Return the last 10 improvement log entries (newest first)."""
    raw_entries: List[str] = _redis.lrange(_IMPROVE_LOG_KEY, 0, 9)
    entries: List[Dict[str, Any]] = []
    for raw in raw_entries:
        try:
            entries.append(json.loads(raw))
        except json.JSONDecodeError:
            log.warning("Could not parse improvement log entry: %s", raw[:120])
    return entries


# ---------------------------------------------------------------------------
# Async core
# ---------------------------------------------------------------------------

async def analyze_and_improve(
    ai_config: Dict[str, Any],
    workspace_root: str = "/mnt/data/Pimv3",
) -> Dict[str, Any]:
    """Analyse recent task results and ask the LLM to produce a better system prompt.

    Steps:
    1. Pull the last 20 task-metric IDs from ``agent:metrics:all`` and fetch each record.
    2. Partition into successes and failures; extract error patterns from failures.
    3. Send the current system prompt + failure summary to the LLM and request an
       improved version (≤ 2 000 chars).
    4. Persist the new prompt in Redis under ``_PROMPT_KEY``.
    5. Reset the improvement counter to 0.
    6. Append a log entry to ``_IMPROVE_LOG_KEY`` (capped at 20 entries).

    Returns a summary dict with keys: ok, improved, old_len, new_len, failures_analyzed.
    """
    log.info("Starting self-improvement cycle (workspace=%s)", workspace_root)

    # -- 1. Fetch recent task metrics ----------------------------------------
    metric_ids: List[str] = _redis.lrange("agent:metrics:all", -20, -1)
    tasks: List[Dict[str, Any]] = []
    for tid in metric_ids:
        raw = _redis.get(f"agent:metrics:{tid}")
        if raw:
            try:
                tasks.append(json.loads(raw))
            except json.JSONDecodeError:
                log.warning("Skipping unparse-able metric for task %s", tid)

    if not tasks:
        log.warning("No task metrics available; skipping improvement")
        _redis.set(_IMPROVE_COUNTER_KEY, 0)
        return {"ok": True, "improved": False, "reason": "no_metrics"}

    # -- 2. Partition successes / failures ------------------------------------
    successes = [t for t in tasks if t.get("status") == "success"]
    failures = [t for t in tasks if t.get("status") != "success"]

    error_patterns: List[str] = []
    for f in failures:
        err = f.get("error") or f.get("stderr") or ""
        if err:
            # Keep a concise excerpt to stay within prompt limits
            error_patterns.append(err[:300])

    log.info(
        "Metrics loaded: total=%d successes=%d failures=%d",
        len(tasks),
        len(successes),
        len(failures),
    )

    # -- 3. LLM call ---------------------------------------------------------
    current_prompt = get_current_system_prompt()
    old_len = len(current_prompt)

    failure_block = (
        "\n".join(f"- {e}" for e in error_patterns[:10])
        if error_patterns
        else "(none)"
    )

    user_message = (
        f"Current system prompt ({old_len} chars):\n"
        f"```\n{current_prompt}\n```\n\n"
        f"Recent failure patterns ({len(failures)} failures):\n"
        f"{failure_block}\n\n"
        "Rewrite the system prompt to prevent these failures while keeping all "
        "correct guidance. The new prompt MUST be under 2000 characters. "
        "Return ONLY the new prompt text, nothing else."
    )

    api_url: str = ai_config.get("api_url", "https://api.openai.com/v1/chat/completions")
    api_key: str = ai_config.get("api_key", os.getenv("OPENAI_API_KEY", ""))
    model: str = ai_config.get("model", "gpt-4o-mini")

    improved_prompt: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are a prompt-engineering expert. "
                                "Improve agent system prompts based on observed failure patterns."
                            ),
                        },
                        {"role": "user", "content": user_message},
                    ],
                    "max_tokens": 700,
                    "temperature": 0.3,
                },
            )
            response.raise_for_status()
            data = response.json()
            improved_prompt = (
                data["choices"][0]["message"]["content"].strip()
            )
    except httpx.HTTPStatusError as exc:
        log.error("LLM request failed with HTTP %d: %s", exc.response.status_code, exc)
        _redis.set(_IMPROVE_COUNTER_KEY, 0)
        return {"ok": False, "improved": False, "error": str(exc)}
    except httpx.RequestError as exc:
        log.error("LLM request error: %s", exc)
        _redis.set(_IMPROVE_COUNTER_KEY, 0)
        return {"ok": False, "improved": False, "error": str(exc)}

    if not improved_prompt or len(improved_prompt) < 50:
        log.warning("LLM returned suspiciously short prompt; keeping existing one")
        _redis.set(_IMPROVE_COUNTER_KEY, 0)
        return {"ok": True, "improved": False, "reason": "llm_output_too_short"}

    # Enforce hard length cap
    if len(improved_prompt) > 2000:
        improved_prompt = improved_prompt[:2000]
        log.warning("Truncated LLM prompt to 2000 chars")

    new_len = len(improved_prompt)

    # -- 4. Persist new prompt -----------------------------------------------
    _redis.set(_PROMPT_KEY, improved_prompt)
    log.info("Saved improved system prompt (%d → %d chars)", old_len, new_len)

    # -- 5. Reset counter ----------------------------------------------------
    _redis.set(_IMPROVE_COUNTER_KEY, 0)

    # -- 6. Append log entry (cap at 20) -------------------------------------
    log_entry = json.dumps(
        {
            "ts": int(time.time()),
            "old_len": old_len,
            "new_len": new_len,
            "tasks_analyzed": len(tasks),
            "failures_analyzed": len(failures),
            "successes": len(successes),
        }
    )
    _redis.lpush(_IMPROVE_LOG_KEY, log_entry)
    _redis.ltrim(_IMPROVE_LOG_KEY, 0, 19)

    return {
        "ok": True,
        "improved": True,
        "old_len": old_len,
        "new_len": new_len,
        "failures_analyzed": len(failures),
    }


async def run_self_improvement_if_needed(
    ai_config: Dict[str, Any],
) -> Dict[str, Any]:
    """Increment the completed-task counter and, if the threshold is reached,
    run a full self-improvement cycle.

    Intended to be called at the end of every task-completion handler.
    """
    new_count = increment_task_counter()
    log.debug("run_self_improvement_if_needed: counter=%d threshold=%d", new_count, IMPROVE_EVERY_N)

    if new_count < IMPROVE_EVERY_N:
        return {"ok": True, "improved": False, "counter": new_count}

    log.info("Improvement threshold reached (%d tasks); starting cycle", new_count)
    result = await analyze_and_improve(ai_config)
    result["counter_before"] = new_count
    return result
