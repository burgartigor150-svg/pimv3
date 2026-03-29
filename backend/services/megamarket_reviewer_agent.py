from __future__ import annotations

import json
from typing import Any, Dict, List

from backend.services.ai_service import chat_json_with_retries


def _payload_manufacturer_values(payload: Dict[str, Any]) -> List[str]:
    vals: List[str] = []
    for k, v in (payload or {}).items():
        key = str(k).strip().lower()
        if (
            key in {"manufacturerno", "manufacturer_code", "manufacturercode"}
            or "артикул производителя" in key
            or "код производителя" in key
        ):
            s = str(v or "").strip()
            if s:
                vals.append(s)
    return vals


def _is_critical_reviewer_blocker(blocker: Any) -> bool:
    """
    Reviewer is advisory-first. Keep only truly critical blockers here.
    Everything else goes to deterministic verifier and MM async errors loop.
    """
    txt = str(blocker).strip().lower()
    if not txt:
        return False
    if ("manufacturer" in txt or "производител" in txt) and ("sku" in txt or "сп-" in txt):
        return True
    if ("грил" in txt or "grill" in txt) and ("no evidence" in txt or "нет подтверждения" in txt):
        return True
    if "явное противоречие" in txt:
        return True
    return False


def _compact_schema(target_schema: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in (target_schema or {}).get("attributes") or []:
        if not isinstance(r, dict):
            continue
        opts = r.get("dictionary_options") or []
        out.append(
            {
                "id": r.get("id"),
                "name": r.get("name"),
                "is_required": bool(r.get("is_required")),
                "valueTypeCode": r.get("valueTypeCode"),
                "dictionary_preview": [
                    (o.get("name") if isinstance(o, dict) else str(o)) for o in opts[:10]
                ],
            }
        )
    return out


def _safe_json_loads(raw: str) -> Dict[str, Any]:
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


async def ai_review_megamarket_payload_full_picture(
    *,
    ai_config: str,
    sku: str,
    category_id: str,
    payload: Dict[str, Any],
    target_schema: Dict[str, Any],
    ozon_source_full: Dict[str, Any],
    mm_card: Dict[str, Any],
    last_errors: List[Dict[str, Any]],
    evidence_contract: Dict[str, Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """
    Второй умный агент-ревьюер:
    проверяет payload в полном контексте Ozon+MM+Schema и выдаёт блокеры/точечные patch.
    """
    system_prompt = (
        "You are a strict Megamarket payload reviewer.\n"
        "Goal: block hallucinations and unsupported claims.\n"
        "Rules:\n"
        "1) Use only provided evidence from OZON full data + MM card + schema.\n"
        "2) If a claim has no evidence, add blocker.\n"
        "3) Do not invent values. Prefer keeping value unchanged over destructive nulling.\n"
        "4) IMPORTANT: schema.dictionary_preview is NOT full dictionary. NEVER block only because value is absent in preview.\n"
        "5) Manufacturer code must never equal seller SKU like 'СП-*', but check this ONLY if explicit field exists "
        "(manufacturerNo/manufacturer_code/Артикул производителя/Код производителя).\n"
        "6) Return JSON only with keys: ok_to_push, blockers, suggested_patch, confidence, rationale."
    )
    user_payload = {
        "sku": sku,
        "category_id": category_id,
        "payload": payload,
        "schema": _compact_schema(target_schema),
        "ozon_source_full": ozon_source_full or {},
        "mm_card": mm_card or {},
        "last_errors": last_errors or [],
        "evidence_contract": evidence_contract or {},
    }

    obj = await chat_json_with_retries(
        config_str=ai_config,
        role="runtime",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
        temperature=0.1,
        max_retries=3,
    )
    if "_error" in obj:
        return {
            "ok_to_push": False,
            "blockers": [{"type": "ai_reviewer_failed", "reason": str(obj.get('_error'))}],
            "suggested_patch": {},
            "confidence": 0.0,
            "rationale": "reviewer API failure",
        }
    if not isinstance(obj, dict):
        obj = {}
    blockers = obj.get("blockers", [])
    patch = obj.get("suggested_patch", {})
    if not isinstance(blockers, list):
        blockers = [{"type": "invalid_reviewer_output", "reason": "blockers must be list"}]
    if not isinstance(patch, dict):
        patch = {}

    # Enforce deterministic reviewer guard:
    # manufacturer SKU blocker is valid only for explicit manufacturer fields in outgoing payload.
    manufacturer_values = _payload_manufacturer_values(payload)
    has_bad_mfr = any(v == str(sku).strip() or v.upper().startswith("СП-") for v in manufacturer_values)
    filtered_blockers: List[Any] = []
    for b in blockers:
        txt = str(b).lower()
        # Keep only critical blockers on reviewer stage.
        if not _is_critical_reviewer_blocker(b):
            continue
        is_mfr_block = ("manufacturer" in txt or "производител" in txt) and ("sku" in txt or "сп-" in txt)
        if is_mfr_block and not has_bad_mfr:
            continue
        # dictionary_preview is explicitly informational and must not be a hard blocker.
        if "dictionary_preview" in txt and ("not in" in txt or "не в" in txt):
            continue
        # Required field completeness is enforced by deterministic verifier;
        # reviewer keeps only hallucination-oriented blockers.
        if (
            "missing required schema fields" in txt
            or "missing required schema field" in txt
            or "missing required attribute" in txt
            or "отсутствуют обязательные поля" in txt
        ):
            continue
        # Evidence sufficiency is also enforced downstream by deterministic verifier
        # against actual evidence_contract; suppress reviewer broad false-positives.
        if (
            "missing evidence" in txt
            or "has no evidence in provided data" in txt
            or "lack evidence" in txt
            or "недостаточно подтверждений" in txt
            or "недостаточно доказательств" in txt
        ):
            continue
        filtered_blockers.append(b)
    blockers = filtered_blockers

    # Never allow reviewer patch to set manufacturer code to seller SKU / СП-*.
    for pk in list(patch.keys()):
        pkey = str(pk).strip().lower()
        if (
            pkey in {"manufacturerno", "manufacturer_code", "manufacturercode"}
            or "артикул производителя" in pkey
            or "код производителя" in pkey
        ):
            pv = str(patch.get(pk) or "").strip()
            if pv and (pv == str(sku).strip() or pv.upper().startswith("СП-")):
                patch.pop(pk, None)

    # Ground truth for gate is blocker list after deterministic filtering.
    # If blockers are empty, do not fail only due model boolean drift.
    ok_to_push = len(blockers) == 0
    return {
        "ok_to_push": ok_to_push,
        "blockers": blockers[:50],
        "suggested_patch": patch,
        "confidence": float(obj.get("confidence", 0.0) or 0.0),
        "rationale": str(obj.get("rationale", ""))[:2000],
    }

