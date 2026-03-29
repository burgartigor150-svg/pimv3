from __future__ import annotations

import json
import re
from typing import Any, Dict, List


def _as_list(v: Any) -> List[Any]:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _source_blob(ozon_source_full: Dict[str, Any], mm_card: Dict[str, Any]) -> str:
    parts: List[str] = []
    for src in (ozon_source_full or {}, mm_card or {}, (mm_card or {}).get("attributes") or {}):
        if not isinstance(src, dict):
            continue
        for k, v in src.items():
            parts.append(str(k))
            if isinstance(v, (dict, list)):
                try:
                    parts.append(json.dumps(v, ensure_ascii=False))
                except Exception:
                    parts.append(str(v))
            else:
                parts.append(str(v))
    return " ".join(parts).lower()


def _is_positive(v: Any) -> bool:
    s = str(v).strip().lower()
    return s in {"true", "1", "да", "yes", "есть"} or bool(re.search(r"\d", s))


async def verify_megamarket_payload_full_picture(
    *,
    adapter: Any,
    sku: str,
    category_id: str,
    payload: Dict[str, Any],
    target_schema: Dict[str, Any],
    ozon_source_full: Dict[str, Any],
    mm_card: Dict[str, Any],
    evidence_contract: Dict[str, Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """
    Жёсткий верификатор перед push:
    - проверяет required
    - проверяет enum строго по словарю
    - блокирует неподтвержденные "гриль" утверждения
    - блокирует подмену "кода производителя" seller SKU/СП-кодом
    """
    rows = (target_schema or {}).get("attributes") or []
    schema_rows = [r for r in rows if isinstance(r, dict)]
    schema_by_name = {str(r.get("name") or "").strip(): r for r in schema_rows if str(r.get("name") or "").strip()}

    blockers: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    evidence_contract = evidence_contract or {}

    src_blob = _source_blob(ozon_source_full or {}, mm_card or {})
    grill_evidence = any(t in src_blob for t in ("грил", "grill", "grill_type", "grill_power", "тип гриля"))

    # 1) required
    for r in schema_rows:
        if not bool(r.get("is_required")):
            continue
        nm = str(r.get("name") or "").strip()
        val = payload.get(nm)
        empty = val is None or (isinstance(val, str) and not val.strip()) or (isinstance(val, list) and len(val) == 0)
        if empty:
            blockers.append(
                {
                    "type": "missing_required",
                    "field": nm,
                    "reason": "Обязательное поле пустое.",
                    "fix": "Заполни строго из подтвержденного источника или дождись уточнения из ошибок MM.",
                }
            )

    # 2) строгая проверка enum
    for field, val in payload.items():
        sch = schema_by_name.get(str(field))
        if not sch:
            continue
        vt = str(sch.get("valueTypeCode") or "").lower()
        if vt != "enum":
            continue
        normalized = adapter._mm_normalize_enum_attribute_values(sch, _as_list(val))
        if not normalized:
            blockers.append(
                {
                    "type": "enum_not_in_dictionary",
                    "field": field,
                    "value": val,
                    "reason": "Значение не найдено в dictionary_options.",
                    "fix": "Выбери только из словаря MM для этого атрибута.",
                }
            )

    # 3) бездоказательный гриль
    for field, val in payload.items():
        f = str(field).lower()
        if "грил" not in f and "grill" not in f:
            continue
        if val in (None, "", [], {}):
            continue
        if _is_positive(val) and not grill_evidence:
            blockers.append(
                {
                    "type": "unverified_grill_claim",
                    "field": field,
                    "value": val,
                    "reason": "В полном контексте Ozon/MM нет подтверждения наличия гриля.",
                    "fix": "Убери/обнули grill-поля, не отправляй неподтвержденные claims.",
                }
            )

    # 4) код производителя != seller SKU
    for field, val in payload.items():
        f = str(field).lower()
        if "код производителя" not in f:
            continue
        sv = str(val or "").strip()
        if not sv:
            continue
        if sv == str(sku).strip() or sv.upper().startswith("СП-"):
            blockers.append(
                {
                    "type": "manufacturer_code_is_seller_sku",
                    "field": field,
                    "value": val,
                    "reason": "Код производителя подменён seller SKU/СП-кодом.",
                    "fix": "Оставь пустым или заполни только реальным manufacturer_code/model_number.",
                }
            )

    # 5) числовая санитарная проверка
    for field, val in payload.items():
        sch = schema_by_name.get(str(field))
        if not sch:
            continue
        vt = str(sch.get("valueTypeCode") or "").lower()
        if vt not in {"number", "integer", "float", "decimal", "int", "long"}:
            continue
        s = str(val).strip().replace(",", ".")
        if not s:
            continue
        try:
            fv = float(s)
            if fv > 1_000_000:
                blockers.append(
                    {
                        "type": "numeric_unrealistic",
                        "field": field,
                        "value": val,
                        "reason": "Слишком большое значение для товарного атрибута.",
                        "fix": "Проверь что это не код/штрихкод в числовом поле.",
                    }
                )
        except Exception:
            warnings.append({"type": "non_numeric_value", "field": field, "value": val})

    # 6) evidence-контракт: сильные утверждения с низкой уверенностью блокируем
    risky_tokens = ("грил", "конвекц", "инвертор", "код производителя", "страна", "тип")
    for field, val in payload.items():
        if val in (None, "", [], {}):
            continue
        ev = evidence_contract.get(str(field), {})
        conf = float(ev.get("confidence", 0.0) or 0.0)
        src = str(ev.get("source_path", "unknown"))
        f_low = str(field).lower()
        if any(t in f_low for t in risky_tokens) and (conf < 0.55 or src == "unknown"):
            blockers.append(
                {
                    "type": "weak_evidence_for_risky_field",
                    "field": field,
                    "value": val,
                    "reason": f"Недостаточная доказательная база (confidence={conf}, source={src}).",
                    "fix": "Убери поле или подтверди его из Ozon/MM источника.",
                }
            )

    return {
        "ok_to_push": len(blockers) == 0,
        "blockers_count": len(blockers),
        "blockers": blockers[:120],
        "warnings": warnings[:120],
        "schema_attribute_count": len(schema_rows),
        "payload_field_count": len(payload.keys()),
        "category_id": str(category_id),
    }

