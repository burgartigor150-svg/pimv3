"""
agent_conventions.py — Auto-learn project conventions from agent task history.

Analyzes completed task patterns and updates CONVENTIONS.md with new rules
discovered from the codebase evolution.
"""

import asyncio
import json
import logging
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import redis

logger = logging.getLogger(__name__)

_redis = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

_METRICS_ALL_KEY = "agent:metrics:all"
_CONVENTIONS_LAST_UPDATE_KEY = "agent:conventions:last_update"
_24H_SECONDS = 24 * 3600


def collect_recent_patterns(workspace_root: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Collect recent code change patterns from successful tasks."""
    task_ids: List[str] = _redis.lrange(_METRICS_ALL_KEY, 0, limit - 1) or []
    patterns: List[Dict[str, Any]] = []

    for task_id in task_ids:
        metrics_raw = _redis.hgetall(f"agent:metrics:{task_id}") or {}
        if str(metrics_raw.get("status", "")) != "success":
            continue

        task_raw = _redis.hgetall(f"agent_task:{task_id}") or {}
        task_type = str(metrics_raw.get("task_type", "unknown"))

        affected_files_raw = task_raw.get("affected_files", "[]")
        try:
            affected_files: List[str] = json.loads(affected_files_raw) if isinstance(affected_files_raw, str) else (affected_files_raw or [])
        except Exception:
            affected_files = []

        python_files = [f for f in affected_files if isinstance(f, str) and f.endswith(".py")]
        sampled_files = python_files[:3]

        diff_samples: List[str] = []
        for filepath in sampled_files:
            abs_path = os.path.join(workspace_root, filepath)
            try:
                proc = subprocess.run(
                    ["git", "show", f"HEAD:{filepath}"],
                    cwd=workspace_root,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if proc.returncode == 0 and proc.stdout:
                    diff_samples.append(proc.stdout[:2000])
            except Exception as exc:
                logger.debug("git show failed for %s: %s", filepath, exc)

        if diff_samples or sampled_files:
            patterns.append({
                "task_type": task_type,
                "files": sampled_files,
                "diff_sample": "\n---\n".join(diff_samples),
            })

    return patterns


def extract_patterns_with_llm(client: Any, model: str, patterns: List[Dict[str, Any]]) -> str:
    """Use LLM to extract coding conventions from collected patterns."""
    if not patterns:
        return ""

    patterns_text = json.dumps(patterns, ensure_ascii=False, indent=2)[:8000]

    prompt = (
        "Analyze these code changes from a FastAPI/React project. "
        "Extract 3-5 NEW coding conventions or patterns that appear consistently. "
        "Format as markdown bullet points. "
        "Focus on: error handling patterns, import conventions, naming patterns, test patterns. "
        "Do NOT repeat obvious things.\n\n"
        f"Code changes:\n{patterns_text}"
    )

    async def _call_llm() -> str:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a senior software engineer analyzing code patterns. Be concise and specific."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=600,
            temperature=0.2,
        )
        return (response.choices[0].message.content or "").strip()

    try:
        result = asyncio.run(_call_llm())
    except RuntimeError:
        # Already inside an event loop
        loop = asyncio.get_event_loop()
        result = loop.run_until_complete(_call_llm())

    return result[:1500]


def update_conventions_file(workspace_root: str, new_conventions: str) -> bool:
    """Append new conventions to CONVENTIONS.md, avoiding duplicates."""
    if not new_conventions or not new_conventions.strip():
        return False

    conventions_path = Path(workspace_root) / "CONVENTIONS.md"

    existing_content = ""
    if conventions_path.exists():
        try:
            existing_content = conventions_path.read_text(encoding="utf-8")
        except Exception as exc:
            logger.error("Failed to read CONVENTIONS.md: %s", exc)
            return False

    # Rough duplicate check: look for significant overlap
    new_lines = [line.strip() for line in new_conventions.splitlines() if line.strip() and not line.startswith("#")]
    overlap_count = sum(1 for line in new_lines if line and line in existing_content)
    if new_lines and overlap_count / len(new_lines) > 0.6:
        logger.info("New conventions largely overlap with existing content; skipping.")
        return False

    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    section_header = f"\n\n## Auto-learned Patterns (updated {date_str})\n\n"
    updated_content = existing_content + section_header + new_conventions.strip() + "\n"

    try:
        conventions_path.write_text(updated_content, encoding="utf-8")
        return True
    except Exception as exc:
        logger.error("Failed to write CONVENTIONS.md: %s", exc)
        return False


async def run_conventions_update(
    workspace_root: str,
    ai_config: Dict[str, Any],
    force: bool = False,
) -> Dict[str, Any]:
    """Main entry point: collect patterns, extract rules, update CONVENTIONS.md."""
    if not force:
        last_update_raw = _redis.get(_CONVENTIONS_LAST_UPDATE_KEY)
        if last_update_raw:
            try:
                last_update_ts = int(last_update_raw)
                import time
                if time.time() - last_update_ts < _24H_SECONDS:
                    return {"ok": True, "updated": False, "new_rules_count": 0, "reason": "updated_recently"}
            except (ValueError, TypeError):
                pass

    patterns = collect_recent_patterns(workspace_root, limit=20)
    if not patterns:
        return {"ok": True, "updated": False, "new_rules_count": 0, "reason": "no_patterns_found"}

    client = ai_config.get("client")
    model = str(ai_config.get("model", "deepseek-chat"))

    new_conventions = extract_patterns_with_llm(client, model, patterns)
    if not new_conventions:
        return {"ok": True, "updated": False, "new_rules_count": 0, "reason": "llm_returned_empty"}

    updated = update_conventions_file(workspace_root, new_conventions)

    import time
    _redis.set(_CONVENTIONS_LAST_UPDATE_KEY, int(time.time()))

    new_rules_count = len([
        line for line in new_conventions.splitlines()
        if line.strip().startswith("-") or line.strip().startswith("*")
    ])

    return {"ok": True, "updated": updated, "new_rules_count": new_rules_count}
