"""
Агент выгрузки Ozon: ИИ в цикле вызывает инструменты (схема, словари, ошибки API, set_fields, submit).
Ответ модели — строго один JSON-объект за шаг.
"""
from __future__ import annotations

import copy
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from backend.services.adapters import OzonAdapter
from backend.services.ai_service import get_client_and_model

_log = logging.getLogger("pim.ozon_agent")

SYSTEM_PROMPT = """Ты агент заполнения карточки Ozon Seller из PIM. На каждый ход отвечай РОВНО одним JSON-объектом, без markdown и без текста вокруг.

Доступные команды (поле "tool"):
- "get_schema" — список атрибутов категории: id, name, type, dictionary_id, is_required.
- "get_dictionary" — нужны числа "dictionary_id" (из схемы). Вернёт варианты {id, value} для справочника.
- "get_errors" — асинхронные ошибки карточки по offer_id с Ozon API.
- "set_fields" — нужен объект "fields": ключ = точное имя атрибута из схемы (русское), значение = строка/число для витрины.
- "submit" — отправить текущий плоский payload в Ozon (лимит вызовов на сессию).
- "finish" — закончить работу агента.

Правила:
1) Сначала get_schema; для каждого обязательного (is_required) без значения в payload — заполни: для dictionary_id>0 вызови get_dictionary и выбери значение, близкое к данным товара; иначе осмысленная строка или число.
2) Числовые поля с диапазоном — бери допустимое число внутри типичного диапазона для бытовой техники, если в PIM нет цифры.
3) После заполнения вызови submit, затем get_errors; при ошибках исправь set_fields и снова submit (не больше двух submit подряд без новых данных).
4) Ключи в set_fields должны совпадать с "name" из get_schema.
5) Закончи tool "finish", когда ошибок нет или достигнут лимит submit."""


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


def _empty_val(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and not v.strip():
        return True
    if isinstance(v, list) and len(v) == 0:
        return True
    return False


class OzonSyndicateAgent:
    def __init__(
        self,
        adapter: OzonAdapter,
        *,
        category_id: str,
        sku: str,
        name: str,
        pim: Dict[str, Any],
        initial_flat: Dict[str, Any],
        image_urls: Optional[List[str]] = None,
        max_turns: int = 28,
        max_submit: int = 2,
        allow_submit: bool = True,
    ):
        self.adapter = adapter
        self.category_id = category_id
        self.sku = sku
        self.name = name
        self.pim = pim or {}
        self.working_flat: Dict[str, Any] = copy.deepcopy(initial_flat or {})
        self.working_flat["categoryId"] = category_id
        self.working_flat["offer_id"] = sku
        self.working_flat["name"] = name
        if image_urls:
            self.working_flat["Фото"] = image_urls
        self.max_turns = max_turns
        self.max_submit = max_submit
        self.allow_submit = allow_submit
        self.submit_count = 0
        self.trace: List[Dict[str, Any]] = []

    def _snapshot_payload(self) -> Dict[str, Any]:
        return copy.deepcopy(self.working_flat)

    def _missing_required_names(self, schema_rows: List[Dict[str, Any]]) -> List[str]:
        out: List[str] = []
        for r in schema_rows:
            if not r.get("is_required"):
                continue
            n = r.get("name")
            if not n:
                continue
            if _empty_val(self.working_flat.get(str(n))):
                out.append(str(n))
        return out

    async def _tool_get_schema(self) -> Dict[str, Any]:
        sch = await self.adapter.get_category_schema(self.category_id)
        rows: List[Dict[str, Any]] = []
        for r in sch.get("attributes") or []:
            if not isinstance(r, dict):
                continue
            did = r.get("dictionary_id") if r.get("dictionary_id") is not None else r.get("dictionaryId")
            try:
                d_int = int(did) if did is not None else 0
            except (TypeError, ValueError):
                d_int = 0
            rows.append(
                {
                    "id": r.get("id"),
                    "name": r.get("name"),
                    "type": r.get("type"),
                    "dictionary_id": d_int,
                    "is_required": bool(r.get("is_required") or r.get("required")),
                }
            )
        miss = self._missing_required_names(rows)
        return {
            "attributes": rows,
            "attribute_count": len(rows),
            "missing_required_names": miss,
            "payload_keys": sorted(str(k) for k in self.working_flat.keys()),
        }

    async def _tool_get_dictionary(self, dictionary_id: int) -> Dict[str, Any]:
        if dictionary_id <= 0:
            return {"error": "dictionary_id must be > 0", "values": []}
        vals = await self.adapter.get_dictionary(self.category_id, str(int(dictionary_id)))
        slim = []
        for x in (vals or [])[:200]:
            if isinstance(x, dict):
                slim.append({"id": x.get("id"), "value": x.get("value") or x.get("name")})
        return {"dictionary_id": dictionary_id, "values": slim, "truncated": len(vals or []) > 200}

    async def _tool_get_errors(self) -> Any:
        raw = await self.adapter.get_async_errors(self.sku)
        if not raw:
            return {"errors": []}
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return {"errors": data}
            if isinstance(data, dict):
                return {"errors": [data]}
        except json.JSONDecodeError:
            return {"errors": [{"message": raw}]}
        return {"errors": []}

    def _tool_set_fields(self, fields: Any) -> Dict[str, Any]:
        if not isinstance(fields, dict):
            return {"ok": False, "error": "fields must be an object"}
        for k, v in fields.items():
            if v is None:
                continue
            self.working_flat[str(k)] = v
        return {"ok": True, "updated_keys": list(fields.keys())}

    async def _tool_submit(self) -> Dict[str, Any]:
        if not self.allow_submit:
            return {"ok": False, "error": "submit disabled (dry run)"}
        if self.submit_count >= self.max_submit:
            return {"ok": False, "error": f"submit limit {self.max_submit}"}
        self.submit_count += 1
        res = await self.adapter.push_product(self._snapshot_payload())
        code = int(res.get("status_code", 500))
        body = (res.get("response") or "")[:1200]
        return {"ok": code < 400, "http_status": code, "response_excerpt": body, "submit_index": self.submit_count}

    async def run(self, ai_config: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        client, model_name = get_client_and_model(ai_config)
        sys_prompt = SYSTEM_PROMPT
        if not self.allow_submit:
            sys_prompt += '\n\nВ ЭТОМ ЗАПРОСЕ submit ЗАПРЕЩЁН. Не вызывай submit. Заполни поля и вызови finish.'
        ctx = {
            "offer_id": self.sku,
            "name": self.name,
            "categoryId": self.category_id,
            "pim_attributes": self.pim,
            "current_flat_payload": self._snapshot_payload(),
        }
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": sys_prompt},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "context": ctx,
                        "instruction": "Начни с get_schema. Цель: заполнить обязательные поля и успешно пройти проверку.",
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
                )
                raw = (resp.choices[0].message.content or "").strip()
            except Exception as e:
                self.trace.append({"turn": turn, "error": str(e)})
                break

            action = _parse_model_json(raw)
            if not action or "tool" not in action:
                self.trace.append({"turn": turn, "parse_error": True, "raw_excerpt": raw[:400]})
                messages.append({"role": "assistant", "content": raw[:2000]})
                messages.append(
                    {
                        "role": "user",
                        "content": "Неверный формат. Верни один JSON с полем tool: get_schema | get_dictionary | get_errors | set_fields | submit | finish",
                    }
                )
                continue

            tool = str(action.get("tool", "")).strip().lower()
            self.trace.append({"turn": turn, "tool": tool, "args": {k: v for k, v in action.items() if k != "tool"}})

            if tool == "finish":
                break

            result: Any
            if tool == "get_schema":
                result = await self._tool_get_schema()
            elif tool == "get_dictionary":
                try:
                    did = int(action.get("dictionary_id", 0))
                except (TypeError, ValueError):
                    did = 0
                result = await self._tool_get_dictionary(did)
            elif tool == "get_errors":
                result = await self._tool_get_errors()
            elif tool == "set_fields":
                result = self._tool_set_fields(action.get("fields"))
            elif tool == "submit":
                result = await self._tool_submit()
            else:
                result = {"error": f"unknown tool: {tool}"}

            messages.append({"role": "assistant", "content": json.dumps(action, ensure_ascii=False)})
            messages.append(
                {
                    "role": "user",
                    "content": json.dumps(
                        {"tool_result": result, "current_flat_payload": self._snapshot_payload()},
                        ensure_ascii=False,
                    ),
                }
            )

        return self._snapshot_payload(), self.trace


async def run_ozon_syndicate_agent(
    *,
    adapter: OzonAdapter,
    ai_config: str,
    category_id: str,
    sku: str,
    name: str,
    pim_attributes: Dict[str, Any],
    initial_flat: Dict[str, Any],
    image_urls: Optional[List[str]] = None,
    do_final_push: bool = True,
    allow_agent_submit: bool = True,
) -> Dict[str, Any]:
    agent = OzonSyndicateAgent(
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
    push_result: Optional[Dict[str, Any]] = None
    if do_final_push and agent.submit_count == 0:
        push_result = await adapter.push_product(payload)
    elif do_final_push and agent.submit_count > 0:
        push_result = {"skipped": True, "reason": "already_submitted_via_agent_tool"}
    return {
        "mapped_payload": payload,
        "trace": trace,
        "push": push_result,
        "submit_during_agent": agent.submit_count,
    }
