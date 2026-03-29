from __future__ import annotations

import json
from typing import Any, Dict, List

from backend.services.ai_service import chat_json_with_retries


def _is_critical_critic_blocker(blocker: Any) -> bool:
    txt = str(blocker).strip().lower()
    if not txt:
        return False
    if ("manufacturer" in txt or "производител" in txt) and ("sku" in txt or "сп-" in txt):
        return True
    if ("грил" in txt or "grill" in txt) and ("no evidence" in txt or "нет подтверждения" in txt):
        return True
    if "явное противоречие" in txt or "direct contradiction" in txt:
        return True
    return False


def _safe_json(raw: str) -> Dict[str, Any]:
    t = (raw or "").strip()
    if t.startswith("```json"):
        t = t[7:]
    if t.startswith("```"):
        t = t[3:]
    if t.endswith("```"):
        t = t[:-3]
    try:
        obj = json.loads(t.strip())
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


async def ai_critic_megamarket_payload(
    *,
    ai_config: str,
    sku: str,
    category_id: str,
    payload: Dict[str, Any],
    target_schema: Dict[str, Any],
    evidence_contract: Dict[str, Dict[str, Any]],
    last_errors: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Adversarial critic: атакует payload на противоречия/галлюцинации до deterministic verifier.
    """
    system_prompt = (
        "You are an adversarial QA critic for marketplace payload safety.\n"
        "Find contradictions, fabricated claims, weak evidence fields, wrong enum-like text, and code-in-text mistakes.\n"
        "Return strict JSON with keys: pass, blockers, suggested_patch, critique_summary.\n"
        "If evidence confidence is low and claim is strong, add blocker."
    )
    compact_schema = []
    for r in (target_schema or {}).get("attributes") or []:
        if isinstance(r, dict):
            compact_schema.append(
                {
                    "name": r.get("name"),
                    "type": r.get("valueTypeCode"),
                    "required": bool(r.get("is_required")),
                }
            )
    payload_obj = {
        "sku": sku,
        "category_id": category_id,
        "payload": payload,
        "schema": compact_schema,
        "evidence_contract": evidence_contract,
        "last_errors": last_errors or [],
    }
    obj = await chat_json_with_retries(
        config_str=ai_config,
        role="runtime",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(payload_obj, ensure_ascii=False)},
        ],
        temperature=0.0,
        max_retries=3,
    )
    if "_error" in obj:
        return {
            "pass": False,
            "blockers": [{"type": "critic_failed", "reason": str(obj.get('_error'))}],
            "suggested_patch": {},
            "critique_summary": "critic api failure",
        }
    if not isinstance(obj, dict):
        obj = {}
    blockers = obj.get("blockers", [])
    patch = obj.get("suggested_patch", {})
    if not isinstance(blockers, list):
        blockers = [{"type": "invalid_critic_output", "reason": "blockers must be list"}]
    blockers = [b for b in blockers if _is_critical_critic_blocker(b)]
    if not isinstance(patch, dict):
        patch = {}
    # Ground truth for gate is filtered blocker list; avoid boolean drift.
    return {
        "pass": len(blockers) == 0,
        "blockers": blockers[:50],
        "suggested_patch": patch,
        "critique_summary": str(obj.get("critique_summary", ""))[:2000],
    }

