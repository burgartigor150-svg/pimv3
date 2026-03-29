from __future__ import annotations

import json
from typing import Any, Dict, Tuple


FIELD_ALIASES: Dict[str, list[str]] = {
    "тип": ["type", "microwave_type", "installation_type"],
    "страна-производитель": ["country_of_origin", "country"],
    "инверторное управление мощностью": ["smart_inverter", "inverter"],
    "код товара продавца": ["offer_id", "sku"],
    "артикул (sku)": ["offer_id", "sku"],
    "наименование карточки": ["name", "full_name"],
    "описание товара": ["description"],
    "мощность микроволн, вт": ["microwave_power_w", "power_w"],
    "объем, л": ["volume_liters", "volume_l"],
    "управление": ["control_type"],
    "цвет": ["color"],
    "механизм открывания дверцы": ["door_opening_direction", "door_handle_type"],
}


def _stringify(v: Any) -> str:
    if isinstance(v, (dict, list)):
        try:
            return json.dumps(v, ensure_ascii=False)
        except Exception:
            return str(v)
    return str(v)


def _pick_source_for_field(
    field_name: str,
    value: Any,
    ozon_source_full: Dict[str, Any],
    mm_card: Dict[str, Any],
) -> Tuple[str, str, float]:
    """Возвращает (source_path, evidence_excerpt, confidence)."""
    fn = str(field_name or "").strip()
    if not fn:
        return "unknown", "", 0.0

    sources = [
        ("ozon", ozon_source_full or {}),
        ("mm_card", mm_card or {}),
        ("mm_attributes", (mm_card or {}).get("attributes") or {}),
    ]

    val_s = _stringify(value).strip().lower()
    fn_low = fn.lower()

    def _norm(s: str) -> str:
        return "".join(ch for ch in str(s).lower().replace("ё", "е") if ch.isalnum() or ch == "_")

    # 1) Exact key
    for src_name, src in sources:
        if not isinstance(src, dict):
            continue
        if fn in src:
            raw = src.get(fn)
            return f"{src_name}.{fn}", _stringify(raw)[:260], 1.0

    # 1.1) Alias key lookup (RU field -> known EN/raw keys)
    for alias in FIELD_ALIASES.get(fn_low, []):
        for src_name, src in sources:
            if not isinstance(src, dict):
                continue
            if alias in src:
                raw = src.get(alias)
                return f"{src_name}.{alias}", _stringify(raw)[:260], 0.95

    # 2) Exact value match
    for src_name, src in sources:
        if not isinstance(src, dict):
            continue
        for k, v in src.items():
            if _stringify(v).strip().lower() == val_s and val_s:
                return f"{src_name}.{k}", _stringify(v)[:260], 0.92

    # 2.1) Soft value inclusion match for strings
    if val_s:
        for src_name, src in sources:
            if not isinstance(src, dict):
                continue
            for k, v in src.items():
                sv = _stringify(v).strip().lower()
                if not sv:
                    continue
                if val_s in sv or sv in val_s:
                    return f"{src_name}.{k}", _stringify(v)[:260], 0.86

    # 3) Fuzzy key overlap
    field_tokens = {t for t in _norm(fn_low).replace("_", " ").split() if len(t) > 2}
    for src_name, src in sources:
        if not isinstance(src, dict):
            continue
        for k, v in src.items():
            k_low = _norm(k)
            key_tokens = {t for t in k_low.replace("_", " ").split() if len(t) > 2}
            common = field_tokens & key_tokens
            if common:
                return f"{src_name}.{k}", _stringify(v)[:260], 0.7

    return "unknown", "", 0.0


def build_evidence_contract(
    *,
    payload: Dict[str, Any],
    ozon_source_full: Dict[str, Any],
    mm_card: Dict[str, Any],
) -> Dict[str, Dict[str, Any]]:
    """
    Единый контракт evidence для всех заполненных полей payload.
    """
    out: Dict[str, Dict[str, Any]] = {}
    for k, v in (payload or {}).items():
        if str(k).startswith("__"):
            continue
        if v in (None, "", [], {}):
            continue
        source_path, excerpt, confidence = _pick_source_for_field(k, v, ozon_source_full, mm_card)
        out[str(k)] = {
            "source_path": source_path,
            "evidence_excerpt": excerpt,
            "confidence": round(float(confidence), 3),
            "decision_reason": "matched_from_full_context" if source_path != "unknown" else "no_direct_match_found",
        }
    return out

