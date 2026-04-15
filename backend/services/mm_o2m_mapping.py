import asyncio
import hashlib
import json
import re
from difflib import SequenceMatcher
from typing import Any, Dict, Optional

from backend.services import mm_o2m_client as mm_client
from backend.services import mm_o2m_importer as o2m_importer
from backend.services.mm_o2m_knowledge import knowledge_store


def to_plain_dict(model):
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def mm_post(endpoint: str, payload: dict, mm_creds: Optional[dict] = None, timeout: int = 60):
    return mm_client.post(endpoint, payload, mm_creds, timeout=timeout, default_token=o2m_importer.MEGAMARKET_TOKEN)


def _extract_error_messages(card: Dict[str, Any]) -> list[str]:
    errors = (card.get("errors") or card.get("validationErrors") or card.get("errorList") or [])
    messages: list[str] = []
    for err in errors:
        if isinstance(err, dict):
            messages.append(err.get("message") or err.get("description") or err.get("text") or str(err))
        elif isinstance(err, str):
            messages.append(err)
    for err in card.get("exportError", []) or []:
        if isinstance(err, dict):
            code = err.get("code")
            msg = err.get("message") or err.get("description") or err.get("text") or str(err)
            messages.append(f"[export code:{code}] {msg}" if code is not None else str(msg))
        elif isinstance(err, str):
            messages.append(err)
    for attr_err in card.get("attributesErrors", []) or []:
        if not isinstance(attr_err, dict):
            continue
        attr_name = attr_err.get("attributeName") or "Unknown attribute"
        attr_id = attr_err.get("attributeId")
        attr_value = attr_err.get("value")
        code = attr_err.get("code")
        msg = attr_err.get("message") or attr_err.get("description") or ""
        line = f"[attr:{attr_name} id:{attr_id}"
        if attr_value is not None:
            line += f" value:{attr_value}"
        line += "]"
        if code is not None:
            line += f" code:{code}"
        if msg:
            line += f" {msg}"
        messages.append(line)
    moderation = card.get("moderationMessage") or card.get("moderationComment")
    if moderation:
        messages.append(str(moderation))
    if not messages:
        top = card.get("message") or card.get("description") or ""
        if top:
            messages.append(top)
    return messages


def _extract_error_entries(card: Dict[str, Any]) -> list[dict]:
    return [{"message": m} for m in _extract_error_messages(card) if m]


def _is_transient_export500(card: Dict[str, Any]) -> bool:
    export_errors = card.get("exportError", []) or []
    if not export_errors:
        return False
    for err in export_errors:
        if not isinstance(err, dict):
            return False
        code = str(err.get("code", "")).strip()
        msg = str(err.get("message") or err.get("description") or "").lower()
        if code != "500":
            return False
        if "техническая ошибка" not in msg and "technical" not in msg:
            return False
    return True


def _extract_structured_attribute_errors(card: Dict[str, Any]) -> list[dict]:
    out = []
    for attr_err in card.get("attributesErrors", []) or []:
        if not isinstance(attr_err, dict):
            continue
        out.append(
            {
                "attribute_id": attr_err.get("attributeId"),
                "attribute_name": attr_err.get("attributeName"),
                "value": attr_err.get("value"),
                "code": str(attr_err.get("code")) if attr_err.get("code") is not None else "",
                "message": attr_err.get("message") or attr_err.get("description") or "",
            }
        )
    return out


def _build_schema_index(cat_id: int, mm_creds: Optional[dict]) -> dict[int, dict]:
    schema = o2m_importer.get_mm_category_schema(cat_id, mm_creds)
    idx: dict[int, dict] = {}
    for section in ("contentAttributes", "masterAttributes"):
        for attr in schema.get(section, []) or []:
            aid = attr.get("attributeId")
            if aid is None:
                continue
            try:
                normalized = dict(attr)
                normalized["__section"] = section
                idx[int(aid)] = normalized
            except Exception:
                continue
    return idx


def _dictionary_text(item: Any) -> Optional[str]:
    if isinstance(item, dict):
        for key in ("value", "name", "title", "displayName", "label"):
            val = item.get(key)
            if val is not None and str(val).strip():
                return str(val).strip()
        return None
    if item is None:
        return None
    text = str(item).strip()
    return text or None


def _best_dictionary_value(bad_value: Optional[str], dictionary_list: list) -> Optional[str]:
    candidates = []
    for item in dictionary_list or []:
        text = _dictionary_text(item)
        if text:
            candidates.append(text)
    if not candidates:
        return None
    if not bad_value:
        return None
    probe = _normalize_dictionary_probe(bad_value)
    if not probe:
        return None

    def score(candidate: str) -> float:
        cand = _normalize_dictionary_probe(candidate)
        seq = SequenceMatcher(None, probe, cand).ratio()
        probe_tokens = set(probe.replace("/", " ").split())
        cand_tokens = set(cand.replace("/", " ").split())
        if not probe_tokens or not cand_tokens:
            token_score = 0.0
        else:
            token_score = len(probe_tokens & cand_tokens) / max(len(probe_tokens), len(cand_tokens))
        return seq * 0.7 + token_score * 0.3

    return max(candidates, key=score)


def _normalize_dictionary_probe(value: Any) -> str:
    text = str(value or "").strip().lower().replace("ё", "е")
    return re.sub(r"\s+", " ", text)


def _exact_dictionary_value(value: Any, dictionary_list: list) -> Optional[str]:
    probe = _normalize_dictionary_probe(value)
    if not probe:
        return None
    for item in dictionary_list or []:
        text = _dictionary_text(item)
        if text and _normalize_dictionary_probe(text) == probe:
            return text
    return None


def _split_multi_value_candidates(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    parts = re.split(r"\s*,\s*|\s*;\s*|\s*\|\s*|\s+/\s+", text)
    out = []
    for p in parts:
        t = p.strip()
        if t and t not in out:
            out.append(t)
    return out


def _get_dictionary_values(attr_schema: dict) -> list:
    if not isinstance(attr_schema, dict):
        return []
    return attr_schema.get("dictionaryList") or attr_schema.get("dictionaryValues") or []


def _is_bool_attr(attr_schema: dict) -> bool:
    value_type = str((attr_schema or {}).get("valueTypeCode") or "").strip().lower()
    return value_type in {"bool", "boolean"} or "bool" in value_type


def _apply_forced_mapping_fixes(mapped, forced_attr_values: dict[int, Any], blocked_photo_urls: set[str]):
    if forced_attr_values:
        existing = {int(attr.attributeId): attr for attr in mapped.contentAttributes}
        for attr_id, forced in forced_attr_values.items():
            if forced is None:
                continue
            if isinstance(forced, str) and not forced.strip():
                continue
            if isinstance(forced, bool):
                fixed_value = "true" if forced else "false"
            else:
                fixed_value = str(forced)
            if attr_id in existing:
                existing[attr_id].values = [o2m_importer.MMAttributeValue(value=fixed_value)]
            else:
                mapped.contentAttributes.append(
                    o2m_importer.MMAttribute(
                        attributeId=attr_id,
                        values=[o2m_importer.MMAttributeValue(value=fixed_value)],
                    )
                )
    if blocked_photo_urls and mapped.images:
        mapped.images = [url for url in mapped.images if url not in blocked_photo_urls]


def _error_signature(error_text: Optional[str]) -> str:
    if not error_text:
        return ""
    return " ".join(str(error_text).lower().split())[:500]


def _extract_required_attr_names_from_messages(messages: list[str]) -> list[str]:
    names: list[str] = []
    for msg in messages or []:
        if not msg:
            continue
        text = str(msg).strip()
        if "обязательный атрибут" not in text.lower():
            continue
        m = re.match(r"\s*([^:]{1,120})\s*:\s*это обязательный атрибут", text, flags=re.IGNORECASE)
        if m:
            name = m.group(1).strip()
            if name and name not in names:
                names.append(name)
    return names


def _extract_ozon_attr_values_map(ozon_product: dict) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    attrs = ((ozon_product or {}).get("attributes") or {}).get("attributes") or []
    for a in attrs:
        raw_id = a.get("id")
        if raw_id is None:
            continue
        try:
            aid = int(raw_id)
        except Exception:
            continue
        vals = []
        for v in a.get("values", []) or []:
            if isinstance(v, dict):
                val = v.get("value")
                if val is None:
                    val = v.get("dictionary_value")
                if val is None:
                    val = v.get("name")
            else:
                val = v
            if val is None:
                continue
            text = str(val).strip()
            if text:
                vals.append(text)
        if vals:
            out[aid] = vals
    return out


def _first_number(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"\d+(?:[.,]\d+)?", str(text))
    if not m:
        return None
    return m.group(0).replace(",", ".")


def _coerce_float_string(value: Any) -> Optional[str]:
    num = _first_number(None if value is None else str(value))
    if not num:
        return None
    try:
        f = float(num)
    except Exception:
        return None
    # Keep compact canonical representation accepted by MM.
    return f"{f:g}"


def _coerce_int_string(value: Any) -> Optional[str]:
    num = _first_number(None if value is None else str(value))
    if not num:
        return None
    try:
        return str(int(round(float(num))))
    except Exception:
        return None


def _derive_required_values_from_ozon(
    missing_attrs: dict[int, dict],
    ozon_attr_values: dict[int, list[str]],
) -> dict[int, Any]:
    if not missing_attrs:
        return {}

    def pick(oz_id: int) -> Optional[str]:
        vals = ozon_attr_values.get(oz_id) or []
        return vals[0] if vals else None

    inferred: dict[int, Any] = {}
    for mm_attr_id, meta in missing_attrs.items():
        name = str((meta or {}).get("attribute_name") or "").lower()
        value: Optional[Any] = None

        if mm_attr_id == 12792 or "объем" in name:
            value = _first_number(pick(6378))
        elif mm_attr_id == 5347 or "мощность микроволн" in name:
            value = _first_number(pick(4781))
        elif mm_attr_id == 20864 or "управление" in name:
            value = pick(4793) or pick(10798)
        elif mm_attr_id == 19508 or "механизм открывания дверцы" in name:
            value = pick(4897)
        elif mm_attr_id == 18546 or name == "цвет":
            value = pick(10096)
        elif mm_attr_id == 26914 or name == "тип":
            value = pick(9015)
        elif mm_attr_id == 24022 or "высота встраивания" in name:
            value = _first_number(pick(4788))
        elif mm_attr_id == 11461 or "ширина встраивания" in name:
            value = _first_number(pick(4733))
        elif mm_attr_id == 13930 or "глубина встраивания" in name:
            value = _first_number(pick(4790))
        elif mm_attr_id == 1283 or name == "дисплей":
            feats = " ".join(ozon_attr_values.get(4796) or []).lower()
            value = ("дисплей" in feats) if feats else None
        elif mm_attr_id == 30313 or "быстрый старт" in name:
            modes = " ".join(ozon_attr_values.get(4768) or []).lower()
            value = ("быстр" in modes) if modes else None
        elif mm_attr_id == 18239 or name == "вид":
            src = pick(22390) or pick(10797) or ""
            low = src.lower()
            if "встраива" in low:
                value = "Встраиваемая"
            elif src:
                value = src

        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        inferred[mm_attr_id] = value
    return inferred


def _mapping_signature(mapped) -> str:
    mapped_dict = to_plain_dict(mapped)
    key_payload = {
        "selected_brand": mapped_dict.get("selected_brand"),
        "name": mapped_dict.get("name"),
        "barcode": mapped_dict.get("barcode"),
        "weight": mapped_dict.get("weight"),
        "height": mapped_dict.get("height"),
        "width": mapped_dict.get("width"),
        "depth": mapped_dict.get("depth"),
        "contentAttributes": mapped_dict.get("contentAttributes", []),
    }
    raw = json.dumps(key_payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _merge_attribute_lists(new_attrs: list[dict], existing_attrs: list[dict], blocked_photo_urls: Optional[set[str]] = None) -> list[dict]:
    def normalize_values(values: Any) -> list[Any]:
        out = []
        if not isinstance(values, list):
            return out
        for item in values:
            val = item.get("value") if isinstance(item, dict) else item
            if val is None:
                continue
            if isinstance(val, bool):
                out.append(val)
                continue
            txt = str(val).strip()
            if txt:
                out.append(txt)
        return out

    new_ids = {int(a.get("attributeId")) for a in new_attrs if a.get("attributeId") is not None}
    merged = []
    for attr in new_attrs:
        attr_id = attr.get("attributeId")
        if attr_id is None:
            continue
        norm_id = int(attr_id)
        values = normalize_values(attr.get("values"))
        if norm_id == 18 and blocked_photo_urls:
            values = [v for v in values if v not in blocked_photo_urls]
        if values:
            merged.append({"attributeId": norm_id, "values": values})
    for attr in existing_attrs or []:
        attr_id = attr.get("attributeId")
        if attr_id is None:
            continue
        try:
            norm_id = int(attr_id)
        except Exception:
            continue
        if norm_id in new_ids:
            continue
        values = normalize_values(attr.get("values"))
        if norm_id == 18 and blocked_photo_urls:
            values = [v for v in values if v not in blocked_photo_urls]
        if values:
            merged.append({"attributeId": norm_id, "values": values})
    return merged


def _coerce_bool_value(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "y", "да", "д", "истина"}:
        return True
    if text in {"false", "0", "no", "n", "нет", "н", "ложь"}:
        return False
    return None


def _sanitize_payload_by_schema(
    payload: dict,
    cat_id: int,
    mm_creds: Optional[dict],
    blocked_photo_urls: Optional[set[str]] = None,
    preserve_unknown_attr_ids: Optional[set[int]] = None,
) -> dict:
    schema = o2m_importer.get_mm_category_schema(cat_id, mm_creds) or {}
    schema_items = (schema.get("contentAttributes", []) or []) + (schema.get("masterAttributes", []) or [])
    schema_index: dict[int, dict] = {}
    for item in schema_items:
        aid = item.get("attributeId")
        if aid is None:
            continue
        try:
            schema_index[int(aid)] = item
        except Exception:
            continue

    card = (payload.get("cards") or [{}])[0]

    def sanitize_attr_list(items: list[dict]) -> list[dict]:
        sanitized = []
        for attr in items or []:
            raw_id = attr.get("attributeId")
            if raw_id is None:
                continue
            try:
                attr_id = int(raw_id)
            except Exception:
                continue
            attr_schema = schema_index.get(attr_id)
            if not attr_schema:
                # Keep attributes that MM explicitly demanded in getError even if infomodel is inconsistent.
                if preserve_unknown_attr_ids and attr_id in preserve_unknown_attr_ids:
                    values = attr.get("values") or []
                    norm_values = []
                    for v in values:
                        val = v.get("value") if isinstance(v, dict) else v
                        if val is None:
                            continue
                        text = str(val).strip()
                        if text:
                            norm_values.append(text)
                    if norm_values:
                        sanitized.append({"attributeId": attr_id, "values": norm_values})
                continue

            values = attr.get("values") or []
            norm_values = []
            for v in values:
                val = v.get("value") if isinstance(v, dict) else v
                if val is None:
                    continue
                norm_values.append(val)

            # Remove blocked invalid photos
            if attr_id == 18 and blocked_photo_urls:
                norm_values = [v for v in norm_values if str(v) not in blocked_photo_urls]

            value_type = str(attr_schema.get("valueTypeCode") or "").lower()
            is_multiple = bool(attr_schema.get("isMultiple"))
            dictionary_list = _get_dictionary_values(attr_schema)

            if _is_bool_attr(attr_schema):
                bool_values = []
                for v in norm_values:
                    cv = _coerce_bool_value(v)
                    if cv is not None:
                        # MM CardSave parser expects string values in the "values" array.
                        bool_values.append("true" if cv else "false")
                norm_values = bool_values[:1]
            elif value_type == "enum" and dictionary_list:
                enum_values = []
                for v in norm_values:
                    if is_multiple:
                        candidates = _split_multi_value_candidates(v) or [str(v)]
                        for item in candidates:
                            chosen = _exact_dictionary_value(item, dictionary_list) or _best_dictionary_value(item, dictionary_list)
                            if chosen and chosen not in enum_values:
                                enum_values.append(chosen)
                    else:
                        # For single-value enums keep one canonical dictionary value.
                        chosen = _exact_dictionary_value(v, dictionary_list) or _best_dictionary_value(v, dictionary_list)
                        if chosen:
                            enum_values.append(chosen)
                norm_values = enum_values
            elif value_type in {"float", "double", "decimal", "number"}:
                num_values = []
                for v in norm_values:
                    cv = _coerce_float_string(v)
                    if cv is not None:
                        num_values.append(cv)
                norm_values = num_values[:1] if not is_multiple else num_values
            elif value_type in {"int", "integer", "long"}:
                num_values = []
                for v in norm_values:
                    cv = _coerce_int_string(v)
                    if cv is not None:
                        num_values.append(cv)
                norm_values = num_values[:1] if not is_multiple else num_values
            else:
                norm_values = [str(v).strip() for v in norm_values if str(v).strip()]

            # Barcode must be 8/12/13 digits; otherwise remove to avoid MM code 3024.
            if attr_id == 39:
                fixed = []
                for v in norm_values:
                    s = "".join(ch for ch in str(v) if ch.isdigit())
                    if len(s) in {8, 12, 13}:
                        fixed.append(s)
                norm_values = fixed[:1]

            if not norm_values:
                continue
            sanitized.append({"attributeId": attr_id, "values": norm_values})
        return sanitized

    card["masterAttributes"] = sanitize_attr_list(card.get("masterAttributes", []))
    card["contentAttributes"] = sanitize_attr_list(card.get("contentAttributes", []))

    if blocked_photo_urls and isinstance(card.get("photos"), list):
        card["photos"] = [p for p in card["photos"] if str(p) not in blocked_photo_urls]

    return payload


def _missing_required_attrs_in_payload(card: dict, schema_index: dict[int, dict]) -> list[dict]:
    attrs_map: dict[int, list[Any]] = {}
    for section in ("masterAttributes", "contentAttributes"):
        for attr in card.get(section, []) or []:
            raw_id = attr.get("attributeId")
            if raw_id is None:
                continue
            try:
                aid = int(raw_id)
            except Exception:
                continue
            values = attr.get("values") or []
            attrs_map[aid] = values if isinstance(values, list) else []

    missing: list[dict] = []
    for aid, sch in (schema_index or {}).items():
        # Precheck only content required attrs.
        # Master/system fields (e.g. seller code) can be represented differently by MM and cause false positives.
        if sch.get("__section") != "contentAttributes":
            continue
        if not sch.get("isRequired"):
            continue
        vals = attrs_map.get(aid, [])
        has_value = False
        for v in vals:
            val = v.get("value") if isinstance(v, dict) else v
            if val is None:
                continue
            if str(val).strip() != "":
                has_value = True
                break
        if not has_value:
            missing.append(
                {
                    "attribute_id": aid,
                    "attribute_name": sch.get("attributeName") or f"ID:{aid}",
                    "value_type": sch.get("valueTypeCode"),
                }
            )
    return missing


def _fetch_existing_card_attrs(offer_id: str, mm_creds: Optional[dict]) -> dict:
    payload = {"filter": {"offerId": [offer_id]}, "sorting": {"fieldName": "goodsId", "order": "asc"}, "targetFields": "all"}
    try:
        res = mm_post("/card/getAttributes", payload, mm_creds, 60)
        if res.status_code != 200:
            return {"masterAttributes": [], "contentAttributes": []}
        cards = res.json().get("data", {}).get("cards", [])
        if not cards:
            return {"masterAttributes": [], "contentAttributes": []}
        card = next((c for c in cards if c.get("offerId") == offer_id), cards[0])
        return {"masterAttributes": card.get("masterAttributes", []) or [], "contentAttributes": card.get("contentAttributes", []) or []}
    except Exception:
        return {"masterAttributes": [], "contentAttributes": []}


def _build_payload_preserving_existing_attrs(
    mapped,
    cat_id: int,
    offer_id: str,
    merchant_id: Optional[str],
    mm_creds: Optional[dict],
    blocked_photo_urls: Optional[set[str]] = None,
    preserve_unknown_attr_ids: Optional[set[int]] = None,
) -> dict:
    payload = o2m_importer.create_payload(mapped, cat_id, offer_id, merchant_id=merchant_id)
    existing = _fetch_existing_card_attrs(offer_id, mm_creds)
    card = payload.get("cards", [{}])[0]
    if blocked_photo_urls:
        card["photos"] = [p for p in card.get("photos", []) if p not in blocked_photo_urls]
    card["masterAttributes"] = _merge_attribute_lists(
        card.get("masterAttributes", []),
        existing.get("masterAttributes", []),
        blocked_photo_urls=blocked_photo_urls,
    )
    card["contentAttributes"] = _merge_attribute_lists(
        card.get("contentAttributes", []),
        existing.get("contentAttributes", []),
        blocked_photo_urls=blocked_photo_urls,
    )
    return _sanitize_payload_by_schema(
        payload,
        cat_id,
        mm_creds,
        blocked_photo_urls=blocked_photo_urls,
        preserve_unknown_attr_ids=preserve_unknown_attr_ids,
    )


def map_ai(query: str, search_type: str, ozon_creds: Optional[dict], mm_creds: Optional[dict], mm_categories_cache: dict):
    ozon_product = o2m_importer.get_ozon_product(query, search_type, ozon_creds=ozon_creds)
    cat_id = o2m_importer.ai_select_category(ozon_product, mm_categories_cache)
    mapped = o2m_importer.ai_map_product(ozon_product, cat_id, mm_creds=mm_creds)
    return {
        "mapped": to_plain_dict(mapped),
        "categoryId": cat_id,
        "categoryPath": mm_categories_cache.get(str(cat_id)),
        "offerId": ozon_product.get("internal_code") or ozon_product["core_info"].get("offer_id"),
    }


def _compact_dictionary_values(raw_list: list[Any]) -> list[str]:
    out: list[str] = []
    for item in raw_list or []:
        text = _dictionary_text(item)
        if text and text not in out:
            out.append(text)
        if len(out) >= 200:
            break
    return out


def _build_suspect_attrs(mapped, schema: dict, ozon_product: dict) -> list[dict]:
    ozon_data = {
        "name": (ozon_product.get("core_info") or {}).get("name"),
        "attributes": [
            {
                "name": a.get("name", ""),
                "values": [v.get("value") if isinstance(v, dict) else v for v in a.get("values", [])],
            }
            for a in ((ozon_product.get("attributes") or {}).get("attributes", []) or [])
        ],
    }
    evidence_blob, evidence_tokens = o2m_importer._build_ozon_evidence(ozon_data)

    schema_index: Dict[int, dict] = {}
    for section in ("contentAttributes", "masterAttributes"):
        for item in schema.get(section, []) or []:
            aid = item.get("attributeId")
            if aid is None:
                continue
            try:
                row = dict(item)
                row["__section"] = section
                schema_index[int(aid)] = row
            except Exception:
                continue

    suspects: list[dict] = []
    for attr in mapped.contentAttributes or []:
        try:
            aid = int(attr.attributeId)
        except Exception:
            continue
        sch = schema_index.get(aid, {})
        value_type = str(sch.get("valueTypeCode") or "").lower()
        if value_type in {"float", "double", "decimal", "number", "int", "integer", "long", "bool", "boolean"}:
            continue

        bad_values = []
        for v in attr.values or []:
            raw = v.value if hasattr(v, "value") else v
            if raw is None:
                continue
            txt = str(raw).strip()
            if not txt:
                continue
            if not o2m_importer._is_value_supported_by_ozon(txt, evidence_blob, evidence_tokens):
                bad_values.append(txt)

        if not bad_values:
            continue

        suspects.append(
            {
                "attributeId": aid,
                "attributeName": attr.attributeName or sch.get("attributeName") or f"Attribute {aid}",
                "valueTypeCode": sch.get("valueTypeCode"),
                "isRequired": bool(sch.get("isRequired")),
                "isMultiple": bool(sch.get("isMultiple")),
                "currentValues": bad_values,
                "dictionaryList": _compact_dictionary_values(sch.get("dictionaryList") or sch.get("dictionaryValues") or []),
            }
        )
    return suspects


def build_mapping_review(query: str, search_type: str, ozon_creds: Optional[dict], mm_creds: Optional[dict], mm_categories_cache: dict) -> dict:
    ozon_product = o2m_importer.get_ozon_product(query, search_type, ozon_creds=ozon_creds)
    cat_id = o2m_importer.ai_select_category(ozon_product, mm_categories_cache)
    mapped = o2m_importer.ai_map_product(ozon_product, cat_id, mm_creds=mm_creds)
    schema = o2m_importer.get_mm_category_schema(cat_id, mm_creds) or {}

    missing_raw = o2m_importer._missing_required_content_attrs(mapped, schema)
    missing = []
    for attr in missing_raw:
        missing.append(
            {
                "attributeId": attr.get("attributeId"),
                "attributeName": attr.get("attributeName") or f"Attribute {attr.get('attributeId')}",
                "valueTypeCode": attr.get("valueTypeCode"),
                "isMultiple": bool(attr.get("isMultiple")),
                "dictionaryList": _compact_dictionary_values(attr.get("dictionaryList") or attr.get("dictionaryValues") or []),
            }
        )
    suspects = _build_suspect_attrs(mapped, schema, ozon_product)

    return {
        "mapped": to_plain_dict(mapped),
        "categoryId": cat_id,
        "categoryPath": mm_categories_cache.get(str(cat_id)),
        "offerId": ozon_product.get("internal_code") or ozon_product["core_info"].get("offer_id"),
        "missingRequired": missing,
        "suspectAttrs": suspects,
    }


def upload_to_mm(mapped_data: dict, category_id: int, offer_id: str, mm_creds: Optional[dict]):
    mapped = o2m_importer.MMProductMapping(**mapped_data)
    merchant_id = mm_creds.get("merchant_id") if mm_creds else None
    payload = _build_payload_preserving_existing_attrs(mapped, category_id, offer_id, merchant_id, mm_creds)
    res = mm_post("/card/save", payload, mm_creds, 60)
    return res.json()


def verify_status(offer_ids: list[str], mm_creds: Optional[dict]):
    if not offer_ids:
        return {"data": {"cardsInfo": []}}
    payload_get = {"filter": {"offerId": offer_ids}, "limit": len(offer_ids)}
    res_get = mm_post("/card/get", payload_get, mm_creds, 60)
    cards_info = res_get.json().get("data", {}).get("cardsInfo", [])
    payload_err = {"filter": {"offerId": offer_ids}, "pagination": {"limit": 50, "offset": 0}}
    res_err = mm_post("/card/getError", payload_err, mm_creds, 60)
    errors_info = res_err.json().get("data", {}).get("cards", [])
    error_map = {}
    for entry in errors_info:
        offer_id = entry.get("offerId")
        if offer_id:
            error_map[offer_id] = _extract_error_entries(entry)
    for card in cards_info:
        card["errors"] = error_map.get(card.get("offerId", ""), [])
    return {"cards": cards_info}


async def process_single_card(
    q: str,
    search_type: str,
    task,
    ozon_creds: Optional[dict],
    mm_creds: Optional[dict],
    merchant_id: Optional[str],
    self_correct: bool,
    max_attempts: int,
    semaphore: asyncio.Semaphore,
    mm_categories_cache: dict,
):
    async with semaphore:
        worker_info = {"offer_id": q, "status": "Waiting in queue"}
        task.active_workers.append(worker_info)
        try:
            worker_info["status"] = "Fetching Ozon data..."
            ozon_product = await asyncio.to_thread(o2m_importer.get_ozon_product, q, search_type, ozon_creds=ozon_creds)
            worker_info["status"] = "Checking Category Memory..."
            cached_id = knowledge_store.find_remembered_category(ozon_product["core_info"].get("name", ""))
            if cached_id:
                cat_id = int(cached_id)
                await asyncio.sleep(0.5)
            else:
                worker_info["status"] = "AI Category Selection..."
                cat_id = await asyncio.to_thread(o2m_importer.ai_select_category, ozon_product, mm_categories_cache)

            error_feedback = None
            success = False
            last_error_sig = ""
            same_error_hits = 0
            stuck_on_same_error = False
            attempt_history = []
            forced_attr_values: dict[int, Any] = {}
            blocked_photo_urls: set[str] = set()
            schema_index: Optional[dict[int, dict]] = None
            required_from_mm_errors: dict[int, dict] = {}
            ozon_attr_values = _extract_ozon_attr_values_map(ozon_product)
            force_recategorize = False

            def should_stop_on_repeated_error(current_error: Optional[str]) -> bool:
                nonlocal last_error_sig, same_error_hits
                sig = _error_signature(current_error)
                if not sig:
                    return False
                if sig == last_error_sig:
                    same_error_hits += 1
                else:
                    same_error_hits = 0
                    last_error_sig = sig
                return same_error_hits >= 2

            for attempt in range(max_attempts):
                try:
                    if attempt > 0 and force_recategorize:
                        worker_info["status"] = f"Re-selecting category ({attempt+1})..."
                        cat_id = await asyncio.to_thread(o2m_importer.ai_select_category, ozon_product, mm_categories_cache, False)
                        force_recategorize = False
                    worker_info["status"] = f"AI Mapping ({attempt+1}/{max_attempts})..."
                    mapped = await asyncio.wait_for(
                        asyncio.to_thread(
                            o2m_importer.ai_map_product,
                            ozon_product,
                            cat_id,
                            mm_creds=mm_creds,
                            error_feedback=error_feedback,
                            attempt_history=attempt_history,
                        ),
                        timeout=180,
                    )
                    _apply_forced_mapping_fixes(mapped, forced_attr_values, blocked_photo_urls)
                    # Deterministic fallback: fill MM-required fields from known Ozon attribute ids.
                    if required_from_mm_errors:
                        inferred = _derive_required_values_from_ozon(required_from_mm_errors, ozon_attr_values)
                        if inferred:
                            forced_attr_values.update(inferred)
                            _apply_forced_mapping_fixes(mapped, forced_attr_values, blocked_photo_urls)
                    current_mapping_sig = _mapping_signature(mapped)

                    worker_info["status"] = f"Uploading ({attempt+1})..."
                    payload = _build_payload_preserving_existing_attrs(
                        mapped,
                        cat_id,
                        q,
                        merchant_id,
                        mm_creds,
                        blocked_photo_urls=blocked_photo_urls,
                        preserve_unknown_attr_ids=set(required_from_mm_errors.keys()) if required_from_mm_errors else None,
                    )
                    if schema_index is None:
                        schema_index = _build_schema_index(cat_id, mm_creds)
                    card = (payload.get("cards") or [{}])[0]
                    missing_required = _missing_required_attrs_in_payload(card, schema_index)
                    if missing_required:
                        missing_names = ", ".join([m.get("attribute_name", "") for m in missing_required[:12]])
                        error_feedback = f"Precheck missing required attrs: {missing_names}"
                        attempt_history.append(
                            {
                                "attempt": attempt + 1,
                                "error": error_feedback,
                                "mapping_signature": current_mapping_sig,
                            }
                        )
                        if len(missing_required) >= 5:
                            force_recategorize = True
                        if should_stop_on_repeated_error(error_feedback):
                            stuck_on_same_error = True
                            break
                        continue
                    res = await asyncio.to_thread(mm_post, "/card/save", payload, mm_creds, 60)

                    if res.status_code == 200:
                        save_data = res.json().get("data", {})
                        save_error_cards = save_data.get("errorCards", [])
                        if save_error_cards:
                            msgs = []
                            for ec in save_error_cards:
                                msgs.extend(_extract_error_messages(ec))
                            error_feedback = "; ".join(msgs) or f"Upload sync error: {str(save_error_cards[0])[:200]}"
                            attempt_history.append({"attempt": attempt + 1, "error": error_feedback, "mapping_signature": current_mapping_sig})
                            if should_stop_on_repeated_error(error_feedback):
                                stuck_on_same_error = True
                                break
                            continue

                        if not self_correct:
                            success = True
                            break

                        worker_info["status"] = "Waiting MM validation..."
                        validation_error_handled = False
                        validation_status = "UNKNOWN"
                        for probe in range(8):
                            await asyncio.sleep(12 if probe == 0 else 15)
                            err_res = await asyncio.to_thread(
                                mm_post, "/card/getError", {"filter": {"offerId": [q]}, "pagination": {"limit": 1, "offset": 0}}, mm_creds, 30
                            )
                            err_data = err_res.json().get("data", {}).get("cards", [])

                            status_res = await asyncio.to_thread(mm_post, "/card/get", {"filter": {"offerId": [q]}, "limit": 1}, mm_creds, 30)
                            cards_info = status_res.json().get("data", {}).get("cardsInfo", [])
                            if cards_info:
                                status_obj = cards_info[0].get("status", {}) or {}
                                validation_status = status_obj.get("code") or status_obj.get("name") or validation_status

                            if not err_data:
                                if validation_status in {"ACTIVE", "MODERATION", "READY"}:
                                    success = True
                                    if attempt > 0:
                                        await asyncio.to_thread(
                                            knowledge_store.save_experience, cat_id, error_feedback, f"Self-corrected in attempt {attempt+1}"
                                        )
                                    break
                                # still in processing pipeline, keep waiting/polling
                                if validation_status in {"PROCESSING", "CHECKING", "CHANGES_REVIEW", "UNKNOWN", "ERROR"}:
                                    continue
                                continue

                            raw_card = err_data[0]
                        if _is_transient_export500(raw_card):
                            # MM intermittent backend issue, retry submit without marking as repeated mapping failure.
                            error_feedback = "Megamarket transient export 500, retrying"
                            attempt_history.append({"attempt": attempt + 1, "error": error_feedback, "mapping_signature": current_mapping_sig})
                            await asyncio.sleep(8)
                            continue
                            structured = _extract_structured_attribute_errors(raw_card)
                            missing_required_names: list[str] = []
                            if structured:
                                if schema_index is None:
                                    schema_index = _build_schema_index(cat_id, mm_creds)
                                missing_required_count = 0
                                for item in structured:
                                    attr_id = item.get("attribute_id")
                                    code = item.get("code")
                                    bad_value = item.get("value")
                                    if attr_id is None:
                                        continue
                                    try:
                                        attr_id = int(attr_id)
                                    except Exception:
                                        continue
                                    if code == "3013":
                                        dict_values = _get_dictionary_values(schema_index.get(attr_id, {}) or {})
                                        chosen = _exact_dictionary_value(bad_value, dict_values) or _best_dictionary_value(bad_value, dict_values)
                                        if chosen:
                                            forced_attr_values[attr_id] = chosen
                                    if code == "3004":
                                        schema_attr = schema_index.get(attr_id, {}) or {}
                                        if _is_bool_attr(schema_attr):
                                            coerced = _coerce_bool_value(bad_value)
                                            if coerced is not None:
                                                forced_attr_values[attr_id] = coerced
                                    if attr_id == 18 and code == "6" and bad_value:
                                        blocked_photo_urls.add(str(bad_value))
                                    if code == "2001" and attr_id not in forced_attr_values:
                                        required_from_mm_errors[attr_id] = {
                                            "attribute_name": item.get("attribute_name"),
                                            "code": code,
                                        }
                                        missing_required_count += 1
                                        if attr_id == 30313:
                                            forced_attr_values[attr_id] = "Да"
                                if missing_required_count >= 5:
                                    force_recategorize = True

                            messages = _extract_error_messages(raw_card)
                            low_messages = [str(m).lower() for m in messages]
                            if any(("ракурс основного фото" in m) or ("на основном фото укажите продаваемый товар" in m) for m in low_messages):
                                if mapped.images:
                                    blocked_photo_urls.add(str(mapped.images[0]))
                            missing_required_names = _extract_required_attr_names_from_messages(messages)
                            if len(missing_required_names) >= 3:
                                force_recategorize = True
                            error_feedback = "; ".join(messages) if messages else f"Validation failed: {str(raw_card)[:200]}"
                            attempt_history.append({"attempt": attempt + 1, "error": error_feedback, "mapping_signature": current_mapping_sig})
                            validation_error_handled = True
                            break

                        if success:
                            break
                        if validation_error_handled:
                            if should_stop_on_repeated_error(error_feedback):
                                stuck_on_same_error = True
                                break
                            continue

                        error_feedback = f"MM validation timeout after polling. Last status: {validation_status}"
                        attempt_history.append({"attempt": attempt + 1, "error": error_feedback, "mapping_signature": current_mapping_sig})
                        if should_stop_on_repeated_error(error_feedback):
                            stuck_on_same_error = True
                            break
                        continue

                    error_feedback = f"HTTP {res.status_code}: {res.text}"
                    attempt_history.append({"attempt": attempt + 1, "error": error_feedback, "mapping_signature": current_mapping_sig})
                    if should_stop_on_repeated_error(error_feedback):
                        stuck_on_same_error = True
                        break

                except asyncio.TimeoutError:
                    error_feedback = "AI mapping timeout after 180s"
                    attempt_history.append({"attempt": attempt + 1, "error": error_feedback, "mapping_signature": ""})
                    if should_stop_on_repeated_error(error_feedback):
                        stuck_on_same_error = True
                        break
                except Exception as exc:
                    error_feedback = str(exc).strip() or f"{type(exc).__name__}: empty error message"
                    if should_stop_on_repeated_error(error_feedback):
                        stuck_on_same_error = True
                        break

            if success:
                task.success += 1
                worker_info["status"] = "✅ Done!"
                task.results.insert(0, {"query": q, "status": "ok"})
            else:
                task.failed += 1
                worker_info["status"] = "❌ Failed"
                msg = (
                    f"Stopped: repeated same error. Last error: {error_feedback}"
                    if stuck_on_same_error
                    else f"Failed after {max_attempts} attempts. Last error: {error_feedback or 'Unknown error'}"
                )
                task.results.insert(0, {"query": q, "status": "error", "message": msg})
        except Exception as exc:
            task.failed += 1
            worker_info["status"] = "❌ Error"
            task.results.insert(0, {"query": q, "status": "error", "message": f"Setup failed: {str(exc)}"})
        finally:
            task.processed += 1
            await asyncio.sleep(2)
            try:
                task.active_workers.remove(worker_info)
            except ValueError:
                pass


async def process_bulk_upload(task, queries: list[str], search_type: str, ozon_creds: Optional[dict], mm_creds: Optional[dict], self_correct: bool, mm_categories_cache: dict):
    merchant_id = mm_creds.get("merchant_id") if mm_creds else None
    semaphore = asyncio.Semaphore(4 if self_correct else 8)
    max_attempts = 3 if self_correct else 1
    tasks = [
        process_single_card(q, search_type, task, ozon_creds, mm_creds, merchant_id, self_correct, max_attempts, semaphore, mm_categories_cache)
        for q in queries
    ]
    await asyncio.gather(*tasks)
    task.is_completed = True


async def process_bulk_draft(task, queries: list[str], search_type: str, ozon_creds: Optional[dict], mm_creds: Optional[dict], mm_categories_cache: dict):
    semaphore = asyncio.Semaphore(6)

    async def _worker(q: str):
        worker_info = {"offer_id": q, "status": "Draft mapping queued"}
        task.active_workers.append(worker_info)
        try:
            worker_info["status"] = "Building draft..."
            review = await asyncio.to_thread(build_mapping_review, q, search_type, ozon_creds, mm_creds, mm_categories_cache)
            missing_count = len(review.get("missingRequired") or [])
            suspect_count = len(review.get("suspectAttrs") or [])
            needs_review = (missing_count + suspect_count) > 0
            if needs_review:
                task.results.insert(
                    0,
                    {
                        "query": q,
                        "status": "needs_review",
                        "message": f"Нужно проверить: обязательных пустых {missing_count}, сомнительных {suspect_count}",
                        "review": review,
                    },
                )
            else:
                task.results.insert(
                    0,
                    {
                        "query": q,
                        "status": "ready",
                        "message": "Готово к выгрузке без ручной правки",
                        "review": review,
                    },
                )
            task.success += 1
        except Exception as exc:
            task.failed += 1
            task.results.insert(0, {"query": q, "status": "error", "message": str(exc)})
        finally:
            task.processed += 1
            try:
                task.active_workers.remove(worker_info)
            except ValueError:
                pass

    async def _bound(q: str):
        async with semaphore:
            await _worker(q)

    await asyncio.gather(*[_bound(q) for q in queries])
    task.is_completed = True


async def process_auto_repair(task, ozon_creds: dict, mm_creds: dict, mm_categories_cache: dict):
    merchant_id = mm_creds.get("merchant_id")
    try:
        payload_err = {"filter": {}, "pagination": {"limit": 100, "offset": 0}}
        res_err = mm_post("/card/getError", payload_err, mm_creds, 60)
        error_cards = res_err.json().get("data", {}).get("cards", [])
        task.total = len(error_cards)
        if not error_cards:
            task.is_completed = True
            return
        semaphore = asyncio.Semaphore(4)
        sub_tasks = [
            process_single_card(
                card["offerId"], "offer_id", task, ozon_creds, mm_creds, merchant_id, True, 3, semaphore, mm_categories_cache
            )
            for card in error_cards
        ]
        await asyncio.gather(*sub_tasks)
    except Exception as exc:
        task.results.append({"query": "GLOBAL", "status": "error", "message": str(exc)})
    task.is_completed = True


def _build_resubmit_payload_from_existing_card(card: dict, merchant_id: Optional[str]) -> Optional[dict]:
    if not isinstance(card, dict):
        return None
    category_id = card.get("categoryId")
    if category_id is None:
        return None
    allowed_keys = [
        "offerId",
        "name",
        "brand",
        "description",
        "manufacturerNo",
        "photos",
        "package",
        "masterAttributes",
        "contentAttributes",
        "barcodes",
        "series",
        "videos",
    ]
    card_payload = {k: card.get(k) for k in allowed_keys if k in card}
    if not card_payload.get("offerId"):
        return None
    payload = {"categoryId": int(category_id), "cards": [card_payload]}
    if merchant_id:
        try:
            payload["merchantId"] = int(merchant_id)
        except Exception:
            pass
    return payload


async def process_retry_technical_errors(task, mm_creds: dict):
    merchant_id = mm_creds.get("merchant_id") if mm_creds else None
    try:
        offer_ids: list[str] = []
        seen: set[str] = set()
        offset = 0
        while True:
            res_err = mm_post("/card/getError", {"filter": {}, "pagination": {"limit": 100, "offset": offset}}, mm_creds, 60)
            cards = res_err.json().get("data", {}).get("cards", [])
            if not cards:
                break
            for card in cards:
                offer_id = card.get("offerId")
                if not offer_id or offer_id in seen:
                    continue
                if _is_transient_export500(card):
                    seen.add(offer_id)
                    offer_ids.append(offer_id)
            if len(cards) < 100:
                break
            offset += 100

        task.total = len(offer_ids)
        if not offer_ids:
            task.is_completed = True
            return

        semaphore = asyncio.Semaphore(6)

        async def _worker(offer_id: str):
            worker_info = {"offer_id": offer_id, "status": "Resubmit queued"}
            task.active_workers.append(worker_info)
            try:
                worker_info["status"] = "Fetching existing MM card..."
                res_attrs = await asyncio.to_thread(
                    mm_post,
                    "/card/getAttributes",
                    {"filter": {"offerId": [offer_id]}, "sorting": {"fieldName": "goodsId", "order": "asc"}, "targetFields": "all"},
                    mm_creds,
                    60,
                )
                cards = res_attrs.json().get("data", {}).get("cards", [])
                card = next((c for c in cards if c.get("offerId") == offer_id), cards[0] if cards else None)
                payload = _build_resubmit_payload_from_existing_card(card or {}, merchant_id)
                if not payload:
                    task.failed += 1
                    task.results.insert(0, {"query": offer_id, "status": "error", "message": "Cannot build resubmit payload"})
                    return

                worker_info["status"] = "Re-submitting unchanged card..."
                res_save = await asyncio.to_thread(mm_post, "/card/save", payload, mm_creds, 60)
                if res_save.status_code != 200:
                    task.failed += 1
                    task.results.insert(0, {"query": offer_id, "status": "error", "message": f"HTTP {res_save.status_code}: {res_save.text[:240]}"})
                    return

                data = res_save.json().get("data", {})
                error_cards = data.get("errorCards", [])
                if error_cards:
                    msgs = []
                    for ec in error_cards:
                        msgs.extend(_extract_error_messages(ec))
                    task.failed += 1
                    task.results.insert(0, {"query": offer_id, "status": "error", "message": "; ".join(msgs)[:280] or "Resubmit rejected"})
                    return

                task.success += 1
                task.results.insert(0, {"query": offer_id, "status": "ok", "message": "Переотправлено без изменений"})
            except Exception as exc:
                task.failed += 1
                task.results.insert(0, {"query": offer_id, "status": "error", "message": str(exc)})
            finally:
                task.processed += 1
                try:
                    task.active_workers.remove(worker_info)
                except ValueError:
                    pass

        async def _bound_worker(offer_id: str):
            async with semaphore:
                await _worker(offer_id)

        await asyncio.gather(*[_bound_worker(oid) for oid in offer_ids])
    except Exception as exc:
        task.results.append({"query": "GLOBAL", "status": "error", "message": str(exc)})
    task.is_completed = True
