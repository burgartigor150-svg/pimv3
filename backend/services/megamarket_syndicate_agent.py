"""
Агент выгрузки Megamarket: ИИ в цикле вызывает инструменты по схеме и словарям категории.
"""
from __future__ import annotations

import copy
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from backend.services.adapters import MegamarketAdapter
from backend.services.ai_service import get_client_and_model
from backend.services.agent_memory import get_agent_memory
from backend.services.attribute_star_map import search_attribute_star_map
from backend.services.knowledge_hub import search_knowledge

_log = logging.getLogger("pim.megamarket_agent")

SYSTEM_PROMPT = """Ты агент заполнения карточки Megamarket. На каждый ход отвечай РОВНО одним JSON-объектом, без markdown.

Команды (поле "tool"):
- "get_schema" — инфомодель категории: id/name/is_required/valueTypeCode/isSuggest.
- "get_dictionary" — для enum: передай attribute_id, вернёт допустимые значения словаря.
- "analyze_source" — ГЛАВНЫЙ инструмент: анализирует ВСЕ исходные данные и показывает для каждого MM-атрибута из схемы лучший источник, значение и конвертацию. Вызывай ПОСЛЕ get_schema.
- "recall_memory" — поиск похожих кейсов из долговременной векторной памяти (ошибка→исправление→результат).
- "recall_star_map" — поиск в графе соответствий атрибутов Ozon→MM (векторная память semantic-map).
- "recall_docs" — поиск по базе знаний документации API и внутренних правил.
- "observe_state" — анализ текущего payload: покрытие, suspicious_fields, missing.
- "verify_evidence" — жёсткая проверка перед submit: блокирует выдуманные/неподтверждённые значения.
- "get_errors" — ошибки по карточке из MM API.
- "set_fields" — fields: { "Точное имя атрибута из схемы": значение }.
- "submit" — отправить текущий payload в API.
- "finish" — завершить.

ПРАВИЛА (соблюдать строго):
1) Цикл: get_schema → analyze_source → recall_star_map → recall_docs → recall_memory → set_fields → observe_state → verify_evidence → submit → get_errors → исправь → submit.
2) analyze_source уже всё сопоставил. Используй его результат как план заполнения.
3) observe_state и verify_evidence ОБЯЗАТЕЛЬНЫ перед submit. Если suspicious_fields/blockers не пуст — исправь ВСЕ до submit.
4) ЛОГИКА: если поле-флаг (Гриль, Конвекция, Программы...) = Нет/False — соответствующие численные поля (мощность, количество) должны быть 0 или пусты. observe_state укажет на такие противоречия.
5) ENUM: только значения из dictionary_options. Если нужно — уточни через get_dictionary.
6) ЧИСЛОВЫЕ поля: analyze_source показывает конвертацию (мм→см, г→кг). Integer поля — только целые числа без дроби.
7) НАЗВАНИЕ товара: бери из pim_attributes.full_name или pim_attributes.name. Это реальное название.
8) ИСТОЧНИК данных: если analyze_source не нашёл значение — поле оставь пустым, НЕ выдумывай.
9) Если set_fields вернул skipped или dependency_warnings — прочитай причину и исправь СРАЗУ же.
10) После каждого submit → get_errors → если есть ошибки → исправь конкретные поля → submit снова.
11) Используй recall_star_map и recall_docs для базы знаний, а recall_memory — чтобы не повторять старые ошибки.
"""


def _parse_model_json(raw: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    t = raw.strip()
    if t.startswith("```"):
        t = t.removeprefix("```json").removeprefix("```").strip()
        if t.endswith("```"):
            t = t[:-3].strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        return None


class MegamarketSyndicateAgent:
    def __init__(
        self,
        adapter: MegamarketAdapter,
        *,
        category_id: str,
        sku: str,
        name: str,
        pim: Dict[str, Any],
        initial_flat: Dict[str, Any],
        image_urls: Optional[List[str]] = None,
        allow_submit: bool = True,
        max_turns: int = 14,
        max_submit: int = 2,
    ):
        self.adapter = adapter
        self.category_id = str(category_id)
        self.sku = str(sku)
        self.name = str(name or "")
        self.pim = pim or {}
        self.working_flat: Dict[str, Any] = copy.deepcopy(initial_flat or {})
        self.working_flat["categoryId"] = self.category_id
        self.working_flat["offer_id"] = self.sku
        self.working_flat["name"] = self.name
        if image_urls:
            self.working_flat["Фото"] = image_urls
        self.allow_submit = allow_submit
        self.max_turns = max_turns
        self.max_submit = max_submit
        self.submit_count = 0
        self.trace: List[Dict[str, Any]] = []
        self._schema_rows: List[Dict[str, Any]] = []
        self._schema_by_name: Dict[str, Dict[str, Any]] = {}
        self._last_set_changes: List[Dict[str, Any]] = []
        self._last_set_skipped: List[Dict[str, Any]] = []
        self._last_dependency_warnings: List[Dict[str, Any]] = []
        self._last_errors: List[Dict[str, Any]] = []
        self._memory = get_agent_memory()
        self._memory_namespace = f"megamarket:category:{self.category_id}"

    def _snapshot_payload(self) -> Dict[str, Any]:
        return copy.deepcopy(self.working_flat)

    def _source_blob(self) -> str:
        src = self.pim or {}
        parts: List[str] = []
        for k, v in src.items():
            if str(k).startswith("__"):
                continue
            parts.append(str(k))
            if isinstance(v, (dict, list)):
                try:
                    parts.append(json.dumps(v, ensure_ascii=False))
                except Exception:
                    parts.append(str(v))
            else:
                parts.append(str(v))
        return " ".join(parts).lower()

    async def _tool_get_schema(self) -> Dict[str, Any]:
        sch = await self.adapter.get_category_schema(self.category_id)
        rows = sch.get("attributes") or []
        if not isinstance(rows, list):
            rows = []
        self._schema_rows = [r for r in rows if isinstance(r, dict)]
        self._schema_by_name = {}
        for r in self._schema_rows:
            nm = str(r.get("name") or "").strip()
            if nm:
                self._schema_by_name[nm] = r
        compact_rows: List[Dict[str, Any]] = []
        missing = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            d_opts = r.get("dictionary_options") or []
            d_preview = []
            for item in d_opts[:6]:
                if isinstance(item, dict):
                    d_preview.append({"id": item.get("id"), "value": item.get("name")})
                else:
                    d_preview.append({"value": str(item)})
            compact_rows.append(
                {
                    "id": r.get("id"),
                    "name": r.get("name"),
                    "is_required": bool(r.get("is_required")),
                    "valueTypeCode": r.get("valueTypeCode"),
                    "isSuggest": r.get("isSuggest"),
                    "is_multiple": r.get("is_multiple"),
                    "dictionary_count": len(d_opts),
                    "dictionary_preview": d_preview,
                }
            )
            if bool(r.get("is_required")):
                nm = str(r.get("name") or "")
                if nm and (nm not in self.working_flat or str(self.working_flat.get(nm) or "").strip() == ""):
                    missing.append(nm)
        return {
            "attributes": compact_rows,
            "attribute_count": len(compact_rows),
            "missing_required_names": missing,
        }

    def _tool_observe_state(self) -> Dict[str, Any]:
        if not self._schema_rows:
            return {
                "error": "schema_not_loaded",
                "hint": "call get_schema first",
            }
        req_total = 0
        req_filled = 0
        opt_total = 0
        opt_filled = 0
        missing_required: List[str] = []
        suspicious: List[Dict[str, Any]] = []

        for r in self._schema_rows:
            nm = str(r.get("name") or "").strip()
            if not nm:
                continue
            val = self.working_flat.get(nm)
            empty = val is None or (isinstance(val, str) and not val.strip()) or (isinstance(val, list) and len(val) == 0)
            is_req = bool(r.get("is_required"))
            if is_req:
                req_total += 1
                if empty:
                    missing_required.append(nm)
                else:
                    req_filled += 1
            else:
                opt_total += 1
                if not empty:
                    opt_filled += 1

            if empty:
                continue
            vt = str(r.get("valueTypeCode") or "").lower()
            nm_lower = nm.lower()

            if vt == "enum":
                opts = r.get("dictionary_options") or []
                if opts and isinstance(val, str):
                    normalized_opts = {
                        str(o.get("name") if isinstance(o, dict) else o).strip().lower()
                        for o in opts
                        if str(o.get("name") if isinstance(o, dict) else o).strip()
                    }
                    if normalized_opts and str(val).strip().lower() not in normalized_opts:
                        suspicious.append({"field": nm, "reason": "enum_value_not_in_dictionary", "value": val})
            elif vt in {"boolean", "bool"}:
                if str(val).strip().lower() not in {"true", "false", "1", "0", "да", "нет"}:
                    suspicious.append({"field": nm, "reason": "unexpected_boolean_value", "value": val})
            elif nm_lower in self._NAME_FIELDS and isinstance(val, str):
                if self._looks_like_junk_name(val):
                    suspicious.append({"field": nm, "reason": "name_looks_like_code_or_junk", "value": val,
                                       "suggestion": f"Используй: {self.name!r}"})
            elif vt in {"number", "integer", "float", "decimal"} or any(
                kw in nm_lower for kw in self._NUMERIC_FIELDS_KEYWORDS
            ):
                import re as _re2
                str_v = str(val).strip().replace(",", ".")
                try:
                    fv = float(str_v)
                    if fv > 100000 and any(kw in nm_lower for kw in {"мощн", "объ", "вес", "масс", "ширин", "высот", "глубин", "длин", "диам"}):
                        suspicious.append({"field": nm, "reason": "numeric_value_suspiciously_large", "value": val})
                except (ValueError, TypeError):
                    if isinstance(val, str) and not _re2.match(r'^[\d\.,\s]+$', str_v):
                        suspicious.append({"field": nm, "reason": "non_numeric_value_in_numeric_field", "value": val})

        # --- Автоматический анализ логических противоречий между полями ---
        # Смотрим на все заполненные поля и проверяем смысловые связи
        filled_fields = {
            nm: self.working_flat[nm]
            for r in self._schema_rows
            for nm in [str(r.get("name") or "").strip()]
            if nm and self.working_flat.get(nm) not in (None, "", [], {})
        }

        def _is_false(v: Any) -> bool:
            return str(v).lower().strip() in {"false", "нет", "no", "0"}

        def _is_true(v: Any) -> bool:
            return str(v).lower().strip() in {"true", "да", "yes", "1"}

        for fname, fval in filled_fields.items():
            fn_low = fname.lower()
            for cnt_name, cnt_val in filled_fields.items():
                cn_low = cnt_name.lower()
                # Паттерн: boolean=False но количество/мощность > 0
                if fn_low != cn_low and _is_false(fval):
                    # Ищем поле "количество X" или "мощность X" где X — часть имени boolean-поля
                    bool_tokens = set(fn_low.replace(",", "").split()) - {"и", "в", "на", "с", "по"}
                    cnt_tokens = set(cn_low.replace(",", "").split())
                    common = bool_tokens & cnt_tokens
                    if common and ("количество" in cn_low or "мощност" in cn_low or "число" in cn_low):
                        try:
                            num_v = float(str(cnt_val).replace(",", "."))
                            if num_v > 0:
                                suspicious.append({
                                    "field": cnt_name,
                                    "reason": "contradicts_boolean_field",
                                    "value": cnt_val,
                                    "conflict_with": f"'{fname}' = {fval!r} (т.е. нет/выключено)",
                                    "fix": f"Установи '{cnt_name}' = 0 или убери, раз '{fname}'=Нет",
                                })
                        except (ValueError, TypeError):
                            pass

        # Тип float отправляется как "1000.0" — MM ожидает целое для integer полей
        for r in self._schema_rows:
            nm = str(r.get("name") or "").strip()
            vt = str(r.get("valueTypeCode") or "").lower()
            if vt in {"integer", "int", "long"} and nm in self.working_flat:
                val = self.working_flat[nm]
                sv = str(val).strip()
                if "." in sv:
                    try:
                        f = float(sv)
                        if f == int(f):
                            suspicious.append({
                                "field": nm,
                                "reason": "integer_field_has_float_format",
                                "value": val,
                                "fix": f"Используй целое число: {int(f)}",
                            })
                            self.working_flat[nm] = int(f)
                    except (ValueError, TypeError):
                        pass

        coverage = round((req_filled / req_total) * 100, 2) if req_total else 100.0
        return {
            "required_total": req_total,
            "required_filled": req_filled,
            "required_coverage_percent": coverage,
            "optional_total": opt_total,
            "optional_filled": opt_filled,
            "missing_required_names": missing_required[:120],
            "suspicious_fields": suspicious[:120],
            "payload_field_count": len(self.working_flat.keys()),
        }

    def _tool_verify_evidence(self) -> Dict[str, Any]:
        """
        Панорамная проверка: перед submit не допускаем неподтверждённые/выдуманные поля.
        """
        obs = self._tool_observe_state()
        blockers: List[Dict[str, Any]] = []

        suspicious = obs.get("suspicious_fields", []) if isinstance(obs, dict) else []
        for s in suspicious:
            blockers.append(
                {
                    "type": "suspicious_field",
                    "field": s.get("field"),
                    "reason": s.get("reason"),
                    "value": s.get("value"),
                    "fix": s.get("suggestion") or s.get("fix") or "Исправь по подтвержденному источнику.",
                }
            )

        src_blob = self._source_blob()
        grill_evidence = any(t in src_blob for t in ("грил", "grill", "grill_power", "grill_type", "тип гриля"))

        # 1) Запрет "есть гриль" без явного подтверждения в источнике.
        for r in self._schema_rows:
            nm = str(r.get("name") or "").strip()
            if not nm:
                continue
            nm_l = nm.lower()
            if "грил" not in nm_l and "grill" not in nm_l:
                continue
            val = self.working_flat.get(nm)
            if val in (None, "", [], {}):
                continue
            val_l = str(val).strip().lower()
            positive = (
                val_l in {"true", "да", "yes", "1", "есть"}
                or "грил" in val_l
                or "grill" in val_l
                or any(ch.isdigit() for ch in val_l)
            )
            if positive and not grill_evidence:
                blockers.append(
                    {
                        "type": "unverified_grill_claim",
                        "field": nm,
                        "value": val,
                        "reason": "В source нет явного подтверждения гриля.",
                        "fix": "Убери/обнули grill-поля или поставь отрицательное значение, если это допускает схема.",
                    }
                )

        # 2) Запрет подмены кода производителя seller SKU / СП-кодом.
        for r in self._schema_rows:
            nm = str(r.get("name") or "").strip()
            if not nm or "код производителя" not in nm.lower():
                continue
            val = self.working_flat.get(nm)
            if val in (None, "", [], {}):
                continue
            sv = str(val).strip()
            if sv == self.sku or sv.upper().startswith("СП-"):
                blockers.append(
                    {
                        "type": "manufacturer_code_is_seller_sku",
                        "field": nm,
                        "value": val,
                        "reason": "Код производителя не может быть равен seller SKU.",
                        "fix": "Заполняй только реальным manufacturer_code/model_number из источника; иначе оставь пусто.",
                    }
                )

        return {
            "ok_to_submit": len(blockers) == 0,
            "blockers_count": len(blockers),
            "blockers": blockers[:100],
        }

    async def _tool_get_dictionary(self, attribute_id: int) -> Dict[str, Any]:
        if attribute_id <= 0:
            return {"error": "attribute_id must be > 0", "values": []}
        vals = await self.adapter.get_dictionary(self.category_id, str(attribute_id))
        return {"attribute_id": attribute_id, "values": vals[:80], "truncated": len(vals) > 80}

    async def _tool_get_errors(self) -> Dict[str, Any]:
        raw = await self.adapter.get_async_errors(self.sku)
        if not raw:
            self._last_errors = []
            return {"errors": []}
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                self._last_errors = parsed
                return {"errors": parsed}
            if isinstance(parsed, dict):
                self._last_errors = [parsed]
                return {"errors": [parsed]}
            self._last_errors = [{"message": str(parsed)}]
            return {"errors": [{"message": str(parsed)}]}
        except json.JSONDecodeError:
            self._last_errors = [{"message": raw}]
            return {"errors": [{"message": raw}]}

    def _tool_recall_memory(self, query: Any, limit: Any = 5) -> Dict[str, Any]:
        q = str(query or "").strip()
        if not q:
            q = json.dumps(
                {
                    "offer_id": self.sku,
                    "name": self.name,
                    "previous_mm_errors": self.pim.get("__mm_last_errors__", []),
                    "suspicious_fields": self._tool_observe_state().get("suspicious_fields", []),
                },
                ensure_ascii=False,
            )
        try:
            lim = max(1, min(int(limit), 10))
        except (TypeError, ValueError):
            lim = 5
        hits = self._memory.search(namespace=self._memory_namespace, query=q, limit=lim, score_threshold=0.2)
        return {"query": q[:800], "hits": hits, "count": len(hits)}

    def _tool_recall_star_map(self, query: Any, limit: Any = 8) -> Dict[str, Any]:
        q = str(query or "").strip()
        if not q:
            q = " ".join(
                [
                    str(self.name or ""),
                    json.dumps({k: v for k, v in self.pim.items() if not str(k).startswith("__")}, ensure_ascii=False)[:800],
                ]
            ).strip()
        try:
            lim = max(1, min(int(limit), 20))
        except (TypeError, ValueError):
            lim = 8
        return search_attribute_star_map(q, limit=lim)

    def _tool_recall_docs(self, query: Any, limit: Any = 8) -> Dict[str, Any]:
        q = str(query or "").strip() or f"megamarket api rules for {self.name}"
        try:
            lim = max(1, min(int(limit), 20))
        except (TypeError, ValueError):
            lim = 8
        mm_docs = search_knowledge("docs:megamarket-api", q, limit=lim).get("hits", [])
        qwen_docs = search_knowledge("docs:qwen-code", q, limit=max(3, lim // 2)).get("hits", [])
        return {"query": q, "hits": (mm_docs + qwen_docs)[:lim]}

    _NAME_FIELDS = {
        "наименование карточки", "название", "name", "full_name", "model_full",
        "наименование", "заголовок", "title",
    }
    # Поля, которые должны содержать числа
    _NUMERIC_FIELDS_KEYWORDS = {
        "мощность", "объем", "объём", "вместимость", "масса", "вес", "температура",
        "ширина", "высота", "глубина", "длина", "диаметр", "напряжение", "частота",
        "количество", "уровень", "скорость", "давление", "мощн", "litres", "watts",
    }

    @staticmethod
    def _looks_like_junk_name(val: str) -> bool:
        import re as _re
        s = val.strip()
        if len(s) < 4:
            return True
        if _re.match(r'^[\d\s\-\.\+,]+$', s):
            return True
        if _re.match(r'^-\d+$', s):
            return True
        # UUID-подобное
        if _re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-', s, _re.I):
            return True
        return False

    @staticmethod
    def _looks_like_code_in_text_field(val: str, field_name: str) -> Optional[str]:
        """Возвращает причину если значение похоже на код/артикул в текстовом поле."""
        import re as _re
        s = str(val).strip()
        # Числовой код в строковом поле
        if _re.match(r'^-?\d+(\.\d+)?$', s) and len(s) > 2:
            return f"значение '{s}' выглядит как число/код, не как текст для поля '{field_name}'"
        # Похоже на артикул (буква+цифры без пробелов, <15 символов)
        if _re.match(r'^[A-Z]{1,5}\d{3,}$', s):
            return f"значение '{s}' похоже на артикул/код модели, а не на описательный текст"
        return None

    def _tool_set_fields(self, fields: Any) -> Dict[str, Any]:
        if not isinstance(fields, dict):
            return {"ok": False, "error": "fields must be object"}
        import re as _re
        changes: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []
        for k, v in fields.items():
            if v is None:
                continue
            kk = str(k)
            kk_lower = kk.lower()

            # 1. Защита полей названия
            if kk_lower in self._NAME_FIELDS and isinstance(v, str):
                if self._looks_like_junk_name(v):
                    correct_name = self.name or self.working_flat.get("name") or self.working_flat.get("full_name")
                    skipped.append({
                        "field": kk,
                        "reason": "invalid_name_looks_like_code",
                        "value": v,
                        "suggestion": f"Используй настоящее название: {correct_name!r}",
                    })
                    continue

            # 2. Защита числовых полей — не ставим туда артикулы и коды
            sch = self._schema_by_name.get(kk)
            vt = str((sch or {}).get("valueTypeCode") or "").lower()

            # Запрет: не подставлять seller SKU в "Код производителя".
            if "код производителя" in kk_lower:
                v_s = str(v).strip()
                if v_s and (v_s == str(self.sku).strip() or v_s.upper().startswith("СП-")):
                    skipped.append({
                        "field": kk,
                        "reason": "manufacturer_code_cannot_be_seller_sku",
                        "value": v,
                        "suggestion": "Используй реальный manufacturer_code/model_number из source, а не SKU продавца.",
                    })
                    continue

            # Запрет выдумки "есть гриль": разрешаем positive-значения только при явном источнике.
            if "грил" in kk_lower:
                src_blob = self._source_blob()
                grill_evidence = any(token in src_blob for token in ("грил", "grill", "grill_power", "grill_type"))
                v_low = str(v).strip().lower()
                positive = (
                    v_low in {"true", "да", "yes", "1", "есть"}
                    or "грил" in v_low
                    or "grill" in v_low
                )
                if positive and not grill_evidence:
                    skipped.append({
                        "field": kk,
                        "reason": "grill_not_confirmed_in_source",
                        "value": v,
                        "suggestion": "В источнике нет подтверждения гриля. Не заполняй это поле положительным значением.",
                    })
                    continue

            if vt in {"number", "integer", "int", "long", "float", "decimal", "double"} or any(
                kw in kk_lower for kw in self._NUMERIC_FIELDS_KEYWORDS
            ):
                str_v = str(v).strip().replace(",", ".")
                try:
                    float_v = float(str_v)
                    if float_v > 100000 and any(kw in kk_lower for kw in {"мощн", "объ", "вес", "масс", "ширин", "высот", "глубин", "длин", "диам"}):
                        skipped.append({
                            "field": kk,
                            "reason": "numeric_value_looks_like_barcode_or_code",
                            "value": v,
                            "suggestion": f"Значение {v} слишком большое для поля '{kk}'. Используй реальное числовое значение из pim_attributes.",
                        })
                        continue
                    # Сохраняем правильный тип: integer → int, float → float
                    if vt in {"integer", "int", "long"}:
                        v = int(round(float_v))
                    else:
                        v = float_v
                except (ValueError, TypeError):
                    if isinstance(v, str) and not _re.match(r'^[\d\.,\s]+$', str_v):
                        skipped.append({
                            "field": kk,
                            "reason": "non_numeric_value_in_numeric_field",
                            "value": v,
                            "suggestion": f"Поле '{kk}' ожидает число. Найди числовое значение в pim_attributes.",
                        })
                        continue

            # 3. Защита строковых полей от кодов
            if vt in {"string", "text", ""} and isinstance(v, str) and sch is not None:
                reason = self._looks_like_code_in_text_field(v, kk)
                if reason:
                    skipped.append({
                        "field": kk,
                        "reason": "code_in_text_field",
                        "value": v,
                        "message": reason,
                        "suggestion": "Используй описательный текст из pim_attributes, а не коды/артикулы.",
                    })
                    continue

            # 4. Enum — только из словаря
            if sch is not None and vt == "enum":
                normalized = self.adapter._mm_normalize_enum_attribute_values(sch, v)
                if not normalized:
                    skipped.append({"field": kk, "reason": "enum_value_not_in_dictionary", "value": v})
                    continue
                v = normalized[0] if len(normalized) == 1 else normalized

            prev = self.working_flat.get(kk)
            self.working_flat[kk] = v
            changes.append({"field": kk, "before": prev, "after": v})

        # Проверка зависимостей после установки всех полей
        dependency_warnings = self._check_field_dependencies()
        self._last_set_changes = changes[:]
        self._last_set_skipped = skipped[:]
        self._last_dependency_warnings = dependency_warnings[:]

        return {
            "ok": True,
            "updated_keys": list(fields.keys()),
            "changes": changes[:60],
            "skipped": skipped[:60],
            "dependency_warnings": dependency_warnings,
        }

    def _check_field_dependencies(self) -> List[Dict[str, Any]]:
        """Проверяет противоречия между взаимосвязанными полями."""
        warnings: List[Dict[str, Any]] = []
        flat = self.working_flat

        def _bool_val(k: str) -> Optional[bool]:
            v = flat.get(k)
            if v is None:
                return None
            sv = str(v).lower().strip()
            if sv in {"true", "да", "yes", "1", "есть"}:
                return True
            if sv in {"false", "нет", "no", "0", "нет данных"}:
                return False
            return None

        def _num_val(k: str) -> Optional[float]:
            v = flat.get(k)
            if v is None:
                return None
            try:
                return float(str(v).replace(",", "."))
            except Exception:
                return None

        # Правило 1: если "Автоматические программы" = False/Нет → "Количество автоматических программ" должно быть 0/пусто
        for bool_key in ("Автоматические программы приготовления", "Автопрограммы"):
            bv = _bool_val(bool_key)
            if bv is False:
                for cnt_key in ("Количество автоматических программ приготовления", "Количество автопрограмм"):
                    nv = _num_val(cnt_key)
                    if nv is not None and nv > 0:
                        warnings.append({
                            "conflict": f"'{bool_key}'=Нет но '{cnt_key}'={nv}",
                            "fix": f"Установи '{cnt_key}'=0 или убери его, раз программ нет",
                        })
                        flat[cnt_key] = 0

        # Правило 2: если "Гриль" = False → мощность гриля должна быть пустой
        if _bool_val("Гриль") is False:
            for pw_key in ("Мощность гриля, Вт", "Мощность гриля"):
                if _num_val(pw_key) is not None:
                    warnings.append({
                        "conflict": f"'Гриль'=Нет но '{pw_key}' заполнено",
                        "fix": f"Убрано значение '{pw_key}' так как гриля нет",
                    })
                    flat.pop(pw_key, None)

        # Правило 3: если "Конвекция" = False → мощность конвекции должна быть пустой
        if _bool_val("Конвекция") is False:
            for pw_key in ("Мощность конвекции, Вт", "Мощность конвекции"):
                if _num_val(pw_key) is not None:
                    warnings.append({
                        "conflict": f"'Конвекция'=Нет но '{pw_key}' заполнено",
                        "fix": f"Убрано значение '{pw_key}' так как конвекции нет",
                    })
                    flat.pop(pw_key, None)

        # Правило 4: если "Поворотный стол" = False → диаметр должен быть пустым
        if _bool_val("Поворотный стол") is False or _bool_val("Без поворотного стола") is True:
            for d_key in ("Диаметр поворотного стола, см", "Диаметр поворотного стола"):
                if _num_val(d_key) is not None:
                    warnings.append({
                        "conflict": f"Поворотный стол=Нет но диаметр заполнен",
                        "fix": f"Убрано '{d_key}'",
                    })
                    flat.pop(d_key, None)

        return warnings

    def _tool_analyze_source(self) -> Dict[str, Any]:
        """
        Анализирует ВСЕ исходные данные (pim_attributes) и для каждого атрибута из схемы MM
        находит лучший источник значения, объясняет конвертацию и предлагает итоговое значение.
        Агент использует этот результат как план заполнения карточки.
        """
        import re as _re

        if not self._schema_rows:
            return {"error": "schema_not_loaded", "hint": "call get_schema first"}

        src = {k: v for k, v in self.pim.items() if not k.startswith("__") and v not in (None, "", [], {})}

        def _norm(s: str) -> str:
            return _re.sub(r"[^a-zа-яё0-9]", "", str(s).lower())

        def _to_num(v: Any) -> Optional[float]:
            try:
                return float(str(v).replace(",", ".").strip())
            except Exception:
                return None

        def _src_num(key: str) -> Optional[float]:
            return _to_num(src.get(key))

        def _find_in_src(keywords: List[str], fallback_keys: List[str] = []) -> Optional[Any]:
            """Ищет значение в src по ключевым словам."""
            kw_set = set(_norm(k) for k in keywords)
            best_score, best_val = 0, None
            for sk, sv in src.items():
                sk_n = _norm(sk)
                score = sum(1 for kw in kw_set if kw in sk_n)
                if score > best_score:
                    best_score, best_val = score, sv
            if best_val is not None:
                return best_val
            for k in fallback_keys:
                v = src.get(k)
                if v not in (None, "", [], {}):
                    return v
            return None

        analysis: List[Dict[str, Any]] = []
        star_candidates = self._tool_recall_star_map(
            query=json.dumps({"name": self.name, "pim": src}, ensure_ascii=False),
            limit=20,
        )
        edge_hits = star_candidates.get("edge_hits", []) if isinstance(star_candidates, dict) else []

        def _star_hint_for_mm_field(field_name: str) -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            fn = str(field_name or "").strip().lower()
            for h in edge_hits:
                meta = (h or {}).get("metadata") or {}
                to_name = str(meta.get("to_name") or "").strip().lower()
                if to_name and to_name == fn:
                    out.append(
                        {
                            "from_name": meta.get("from_name"),
                            "to_name": meta.get("to_name"),
                            "score": meta.get("score"),
                            "reason": meta.get("reason"),
                        }
                    )
            out.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
            return out[:3]

        for r in self._schema_rows:
            nm = str(r.get("name") or "").strip()
            if not nm:
                continue
            nm_n = _norm(nm)
            vt = str(r.get("valueTypeCode") or "").lower()
            is_req = bool(r.get("is_required"))
            already = self.working_flat.get(nm)
            if already not in (None, "", [], {}):
                analysis.append({"field": nm, "status": "already_set", "current_value": already})
                continue

            suggestion: Any = None
            source_key: str = ""
            explanation: str = ""
            needs_conversion: bool = False

            # --- Точные алиасы по типу и смыслу ---
            if nm_n in (_norm("Наименование карточки"), _norm("Название")):
                suggestion = src.get("full_name") or src.get("name") or self.name
                source_key = "full_name / name"
                explanation = "Название товара из полного наименования"

            elif nm_n == _norm("Бренд") or "бренд" in nm_n:
                suggestion = src.get("brand") or src.get("Бренд") or src.get("manufacturer")
                source_key = "brand"
                explanation = "Торговая марка"

            elif nm_n == _norm("Код товара продавца") or ("код" in nm_n and "товар" in nm_n):
                suggestion = self.sku
                source_key = "sku / offer_id"
                explanation = "Артикул продавца = offer_id"

            elif nm_n in (_norm("Цвет"), _norm("Основной цвет")):
                suggestion = src.get("color") or src.get("Цвет")
                source_key = "color"
                explanation = "Цвет из атрибутов"

            elif "мощност" in nm_n and ("микроволн" in nm_n or "свч" in nm_n):
                v = _src_num("microwave_power_w") or _src_num("power_w") or _src_num("power")
                suggestion = int(v) if v is not None else None
                source_key = "microwave_power_w"
                explanation = "Мощность микроволн в Вт (целое число)"

            elif "мощност" in nm_n and "грил" in nm_n:
                v = _src_num("grill_power_w")
                suggestion = int(v) if v is not None else None
                source_key = "grill_power_w"
                explanation = "Мощность гриля в Вт"

            elif "мощност" in nm_n and "конвекц" in nm_n:
                v = _src_num("convection_power_w")
                suggestion = int(v) if v is not None else None
                source_key = "convection_power_w"
                explanation = "Мощность конвекции в Вт"

            elif "мощност" in nm_n:
                v = _src_num("microwave_power_w") or _src_num("total_power_w") or _src_num("power_w")
                suggestion = int(v) if v is not None else None
                source_key = "microwave_power_w / power_w"
                explanation = "Мощность в Вт"

            elif "объем" in nm_n and ("л" in nm_n or "лит" in nm_n):
                v = _src_num("volume_liters") or _src_num("volume_l")
                suggestion = v
                source_key = "volume_liters"
                explanation = "Объём в литрах"

            elif "диаметр" in nm_n and "поворот" in nm_n:
                v = _src_num("turntable_diameter_cm")
                suggestion = v
                source_key = "turntable_diameter_cm"
                explanation = "Диаметр поворотного стола в см"

            elif "высот" in nm_n:
                raw = _src_num("height_mm")
                if raw is not None:
                    if "см" in nm_n and raw > 50:
                        suggestion = round(raw / 10, 1)
                        needs_conversion = True
                        explanation = f"height_mm={raw} мм → {suggestion} см"
                    else:
                        suggestion = raw
                        explanation = f"height_mm={raw} мм"
                source_key = "height_mm"

            elif "ширин" in nm_n:
                raw = _src_num("width_mm")
                if raw is not None:
                    if "см" in nm_n and raw > 50:
                        suggestion = round(raw / 10, 1)
                        needs_conversion = True
                        explanation = f"width_mm={raw} мм → {suggestion} см"
                    elif "упаков" in nm_n:
                        suggestion = raw
                        explanation = f"width_mm={raw} мм (упаковка)"
                    else:
                        suggestion = raw
                        explanation = f"width_mm={raw}"
                source_key = "width_mm"

            elif "глубин" in nm_n or ("длин" in nm_n and "упаков" not in nm_n):
                raw = _src_num("depth_mm")
                if raw is not None:
                    if "см" in nm_n and raw > 50:
                        suggestion = round(raw / 10, 1)
                        needs_conversion = True
                        explanation = f"depth_mm={raw} мм → {suggestion} см"
                    else:
                        suggestion = raw
                        explanation = f"depth_mm={raw} мм"
                source_key = "depth_mm"

            elif "длин" in nm_n and "упаков" in nm_n:
                raw = _src_num("depth_mm")
                suggestion = raw
                source_key = "depth_mm"
                explanation = f"depth_mm={raw} мм (длина упаковки)"

            elif "вес" in nm_n or "масс" in nm_n:
                raw = _src_num("product_weight_g") or _src_num("weight_g") or _src_num("weight")
                if raw is not None:
                    if raw > 100 and "кг" in nm_n:
                        suggestion = round(raw / 1000, 3)
                        needs_conversion = True
                        explanation = f"product_weight_g={raw} г → {suggestion} кг"
                    else:
                        suggestion = raw
                        explanation = f"product_weight_g={raw}"
                source_key = "product_weight_g"

            elif "управлен" in nm_n:
                suggestion = src.get("control_type") or src.get("Управление")
                source_key = "control_type"
                explanation = "Тип управления (Сенсорное / Кнопочное / Механическое)"

            elif ("тип" in nm_n and "установ" not in nm_n and "гриля" not in nm_n) and len(nm_n) <= 5:
                suggestion = src.get("type") or src.get("microwave_type")
                source_key = "type"
                explanation = "Тип микроволновки (Соло / Гриль / Конвекция)"

            elif "вид" in nm_n and len(nm_n) <= 5:
                suggestion = src.get("installation_type") or src.get("type")
                source_key = "installation_type / type"
                explanation = "Вид (встраиваемая / отдельностоящая)"

            elif "дисплей" in nm_n:
                v = src.get("led_display") or src.get("display") or src.get("features")
                if v:
                    suggestion = True
                source_key = "led_display"
                explanation = "bool: есть дисплей"

            elif "быстрый" in nm_n and "старт" in nm_n:
                feat = str(src.get("features") or src.get("one_button_control") or "").lower()
                suggestion = any(kw in feat for kw in ("быстр", "quick", "автостарт", "одн кноп"))
                source_key = "features / one_button_control"
                explanation = "bool: есть быстрый старт"

            elif "механизм" in nm_n and "двер" in nm_n:
                suggestion = src.get("door_opening_direction") or src.get("Направление открывания дверцы")
                source_key = "door_opening_direction"
                explanation = "Направление открывания дверцы"

            elif "материал" in nm_n and "внутр" in nm_n:
                suggestion = src.get("internal_coating") or src.get("internal_coating_material")
                source_key = "internal_coating"
                explanation = "Внутреннее покрытие камеры"

            elif "страна" in nm_n and "произв" in nm_n:
                suggestion = src.get("country_of_origin") or src.get("country")
                source_key = "country_of_origin"
                explanation = "Страна производства"

            elif "описани" in nm_n:
                suggestion = src.get("description") or src.get("full_name") or src.get("name")
                source_key = "description"
                explanation = "Описание товара"

            elif "гаранти" in nm_n:
                suggestion = src.get("warranty")
                source_key = "warranty"
                explanation = "Срок гарантии"

            else:
                # Fallback: ищем по совпадению токенов имени атрибута с ключами в src
                best_score, best_key, best_val = 0.0, "", None
                nm_tokens = set(_norm(nm).split())
                for sk, sv in src.items():
                    if sv in (None, "", [], {}):
                        continue
                    sk_tokens = set(_norm(sk).split())
                    if not sk_tokens:
                        continue
                    inter = len(nm_tokens & sk_tokens)
                    union = len(nm_tokens | sk_tokens)
                    score = inter / union if union else 0
                    if score > best_score:
                        best_score, best_key, best_val = score, sk, sv
                if best_score >= 0.4:
                    suggestion = best_val
                    source_key = best_key
                    explanation = f"Fuzzy match score={best_score:.2f}"
                else:
                    suggestion = None
                    source_key = ""
                    explanation = "Источник не найден"

            item: Dict[str, Any] = {
                "field": nm,
                "type": vt,
                "is_required": is_req,
                "suggested_value": suggestion,
                "source_key": source_key,
                "explanation": explanation,
            }
            hints = _star_hint_for_mm_field(nm)
            if hints:
                item["star_map_hints"] = hints
            if needs_conversion:
                item["conversion"] = explanation
            if vt == "enum" and suggestion is not None:
                opts = r.get("dictionary_options") or []
                if opts:
                    item["dictionary_preview"] = [
                        (o.get("name") if isinstance(o, dict) else str(o))
                        for o in opts[:8]
                    ]
                    item["hint"] = "Сверь suggested_value со словарём. Если нет точного совпадения — вызови get_dictionary для полного списка."
            if suggestion is None:
                item["action"] = "SKIP" if not is_req else "NEED_MANUAL_CHECK"
            else:
                item["action"] = "SET"

            analysis.append(item)

        can_set = [x for x in analysis if x.get("action") == "SET"]
        need_check = [x for x in analysis if x.get("action") == "NEED_MANUAL_CHECK"]
        skip = [x for x in analysis if x.get("action") == "SKIP"]
        already = [x for x in analysis if x.get("status") == "already_set"]

        return {
            "summary": {
                "ready_to_set": len(can_set),
                "need_manual_check": len(need_check),
                "skip_no_source": len(skip),
                "already_set": len(already),
            },
            "mapping": analysis,
            "star_map_used": True,
            "star_map_edges_considered": len(edge_hits),
            "instruction": (
                "Используй 'mapping' как план. Для полей с action=SET вызови set_fields с suggested_value. "
                "Для enum — сначала сверь со словарём через get_dictionary. "
                "Для NEED_MANUAL_CHECK — поле обязательное, источника нет, пропусти. "
                "После set_fields — submit → get_errors → исправь → submit."
            ),
        }

    async def _tool_submit(self) -> Dict[str, Any]:
        if not self.allow_submit:
            return {"ok": False, "error": "submit disabled"}
        if self.submit_count >= self.max_submit:
            return {"ok": False, "error": f"submit limit {self.max_submit}"}
        gate = self._tool_verify_evidence()
        if not gate.get("ok_to_submit", False):
            return {"ok": False, "error": "evidence_gate_blocked_submit", "gate": gate}
        self.submit_count += 1
        res = await self.adapter.push_product(self._snapshot_payload())
        code = int(res.get("status_code", 500))
        ok = code < 400
        response_excerpt = str(res.get("response", ""))[:1200]
        # Сохраняем кейс в векторную память: что сломалось, какие правки пробовали, к чему привело.
        try:
            problem_text = json.dumps(
                {
                    "previous_mm_errors": self.pim.get("__mm_last_errors__", []),
                    "runtime_mm_errors": self._last_errors,
                    "response_excerpt": response_excerpt,
                },
                ensure_ascii=False,
            )
            action_summary = json.dumps(
                {
                    "set_changes": self._last_set_changes[-20:],
                    "set_skipped": self._last_set_skipped[-20:],
                    "dependency_warnings": self._last_dependency_warnings[-20:],
                },
                ensure_ascii=False,
            )
            self._memory.add_case(
                namespace=self._memory_namespace,
                sku=self.sku,
                category_id=self.category_id,
                problem_text=problem_text,
                action_summary=action_summary,
                result_status="success" if ok else "failed",
                metadata={"http_status": code},
            )
        except Exception as mem_e:
            _log.debug("memory add_case failed: %s", mem_e)

        return {"ok": ok, "http_status": code, "response_excerpt": response_excerpt}

    async def run(self, ai_config: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        client, model_name = get_client_and_model(ai_config)
        sys_prompt = SYSTEM_PROMPT
        if not self.allow_submit:
            sys_prompt += "\n\nВ этом запуске submit запрещен. Используй get_schema/get_dictionary/set_fields/get_errors/finish."
        memory_bootstrap = self._tool_recall_memory(
            query=json.dumps(
                {
                    "offer_id": self.sku,
                    "name": self.name,
                    "previous_mm_errors": self.pim.get("__mm_last_errors__", []),
                },
                ensure_ascii=False,
            ),
            limit=5,
        )
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": sys_prompt},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "context": {
                                    "offer_id": self.sku,
                                    "name": self.name,
                                    "categoryId": self.category_id,
                                    "pim_attributes": {k: v for k, v in self.pim.items() if not k.startswith("__")},
                                    "current_flat_payload": self._snapshot_payload(),
                                    "memory_bootstrap": memory_bootstrap,
                                    **(
                                        {"previous_mm_errors": self.pim["__mm_last_errors__"]}
                                        if "__mm_last_errors__" in self.pim else {}
                                    ),
                                },
                                "instruction": (
                                    "ВАЖНО: карточка уже отправлялась на MM и получила ошибки (см. previous_mm_errors). "
                                    "Начни с observe_state, затем исправь именно те поля которые указаны в ошибках, "
                                    "после чего сделай submit."
                                ) if "__mm_last_errors__" in self.pim else "Начни с get_schema, затем analyze_source и recall_memory.",
                            },
                            ensure_ascii=False,
                        ),
                    },
        ]

        for turn in range(self.max_turns):
            try:
                resp = await client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    temperature=0.2,
                    response_format={"type": "json_object"},
                )
                raw = (resp.choices[0].message.content or "").strip()
            except Exception as e:
                self.trace.append({"turn": turn, "error": str(e)})
                break

            action = _parse_model_json(raw)
            if not action or "tool" not in action:
                self.trace.append({"turn": turn, "parse_error": True, "raw_excerpt": raw[:500]})
                messages.append({"role": "assistant", "content": raw[:2000]})
                messages.append({"role": "user", "content": "Верни JSON с tool: get_schema|analyze_source|recall_star_map|recall_docs|recall_memory|observe_state|verify_evidence|get_dictionary|get_errors|set_fields|submit|finish"})
                continue

            tool = str(action.get("tool", "")).strip().lower()
            self.trace.append({"turn": turn, "tool": tool, "args": {k: v for k, v in action.items() if k != "tool"}})
            if tool == "finish":
                break

            if tool == "get_schema":
                result = await self._tool_get_schema()
            elif tool == "analyze_source":
                result = self._tool_analyze_source()
            elif tool == "recall_memory":
                result = self._tool_recall_memory(action.get("query"), action.get("limit", 5))
            elif tool == "recall_star_map":
                result = self._tool_recall_star_map(action.get("query"), action.get("limit", 8))
            elif tool == "recall_docs":
                result = self._tool_recall_docs(action.get("query"), action.get("limit", 8))
            elif tool == "observe_state":
                result = self._tool_observe_state()
            elif tool == "verify_evidence":
                result = self._tool_verify_evidence()
            elif tool == "get_dictionary":
                try:
                    aid = int(action.get("attribute_id", 0))
                except (TypeError, ValueError):
                    aid = 0
                result = await self._tool_get_dictionary(aid)
            elif tool == "get_errors":
                result = await self._tool_get_errors()
            elif tool == "set_fields":
                result = self._tool_set_fields(action.get("fields"))
            elif tool == "submit":
                result = await self._tool_submit()
            else:
                result = {"error": f"unknown tool: {tool}"}
            if isinstance(result, dict):
                summary = {
                    "keys": list(result.keys())[:8],
                    "errors_count": len(result.get("errors", [])) if isinstance(result.get("errors"), list) else 0,
                    "updated_keys": result.get("updated_keys", [])[:12] if isinstance(result.get("updated_keys"), list) else [],
                    "http_status": result.get("http_status"),
                    "ok": result.get("ok"),
                }
                self.trace[-1]["result_summary"] = summary

            snap = self._snapshot_payload()
            compact_snap = {
                "categoryId": snap.get("categoryId"),
                "offer_id": snap.get("offer_id"),
                "name": snap.get("name"),
                "fields_count": len(snap.keys()),
                "sample_fields": {k: snap.get(k) for k in list(snap.keys())[:40]},
            }
            messages.append({"role": "assistant", "content": json.dumps(action, ensure_ascii=False)})
            messages.append({"role": "user", "content": json.dumps({"tool_result": result, "current_flat_payload": compact_snap}, ensure_ascii=False)})

        return self._snapshot_payload(), self.trace


async def run_megamarket_syndicate_agent(
    *,
    adapter: MegamarketAdapter,
    ai_config: str,
    category_id: str,
    sku: str,
    name: str,
    pim_attributes: Dict[str, Any],
    initial_flat: Dict[str, Any],
    image_urls: Optional[List[str]] = None,
    allow_agent_submit: bool = True,
) -> Dict[str, Any]:
    agent = MegamarketSyndicateAgent(
        adapter,
        category_id=category_id,
        sku=sku,
        name=name,
        pim=pim_attributes,
        initial_flat=initial_flat,
        image_urls=image_urls,
        allow_submit=allow_agent_submit,
    )
    payload, trace = await agent.run(ai_config)
    return {"mapped_payload": payload, "trace": trace, "submit_during_agent": agent.submit_count}

