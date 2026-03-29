from __future__ import annotations

import json
from typing import Any, Dict, List

from backend.services.ai_service import chat_json_with_retries


async def generate_code_patch_proposal(
    *,
    ai_config: str,
    rewrite_plan: Dict[str, Any],
    allowlist_files: List[str],
) -> Dict[str, Any]:
    """
    Генерация proposal для патча кода (без немедленного применения).
    """
    system_prompt = (
        "You are a code patch planner.\n"
        "Return strict JSON with keys: title, rationale, affected_files, patch_unified_diff.\n"
        "Respect allowlist_files; do not propose files outside allowlist."
    )
    payload = {
        "rewrite_plan": rewrite_plan,
        "allowlist_files": allowlist_files,
    }
    obj = await chat_json_with_retries(
        config_str=ai_config,
        role="code",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        temperature=0.0,
        max_retries=3,
    )
    if "_error" in obj:
        return {
            "ok": False,
            "error": obj.get("_error"),
            "proposal": {},
        }
    affected = obj.get("affected_files", [])
    if not isinstance(affected, list):
        affected = []
    safe_affected = [f for f in affected if f in set(allowlist_files)]
    return {
        "ok": True,
        "proposal": {
            "title": str(obj.get("title", "Self-rewrite proposal"))[:300],
            "rationale": str(obj.get("rationale", ""))[:4000],
            "affected_files": safe_affected,
            "patch_unified_diff": str(obj.get("patch_unified_diff", ""))[:60000],
        },
    }

