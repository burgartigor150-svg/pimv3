from __future__ import annotations

import json
import re
from typing import Any, Dict, List

import redis

from backend.services.ai_service import chat_json_with_retries


_URL_RE = re.compile(r"https?://[^\s)>\"]+")
_redis = redis.Redis.from_url("redis://localhost:6379/0", decode_responses=True)
_MP_ALIASES: Dict[str, List[str]] = {
    "wildberries": ["wildberries", "wildber", "wb", "вб", "вайлдбер", "ваилдбер", "вилдбер", "вайлдбериз", "вайлдберис", "вайлдбериc"],
    "ozon": ["ozon", "озон", "озн", "ozn"],
    "yandex": ["yandex", "яндекс", "яндекс маркет", "yandex market", "market", "маркет"],
    "megamarket": ["megamarket", "мегамаркет", "mega market", "сбермегамаркет"],
}


def _extract_urls(message: str) -> List[str]:
    urls: List[str] = []
    seen = set()
    for m in _URL_RE.findall(str(message or "")):
        u = m.strip().rstrip(".,;")
        if not u or u in seen:
            continue
        seen.add(u)
        urls.append(u)
    return urls


def _norm_text(text: str) -> str:
    low = str(text or "").lower()
    # keep deterministic lightweight normalization for typo-heavy russian messages
    low = low.replace("ё", "е")
    low = re.sub(r"[\"'`]+", " ", low)
    low = re.sub(r"\s+", " ", low).strip()
    return low


def _mentions_marketplace(low: str) -> bool:
    t = _norm_text(low)
    for aliases in _MP_ALIASES.values():
        if any(a in t for a in aliases):
            return True
    return False


def _marketplace_from_text(low: str) -> str:
    t = _norm_text(low)
    if any(a in t for a in _MP_ALIASES["wildberries"]):
        return "wildberries"
    if any(a in t for a in _MP_ALIASES["ozon"]):
        return "ozon"
    if any(a in t for a in _MP_ALIASES["yandex"]):
        return "yandex"
    if any(a in t for a in _MP_ALIASES["megamarket"]):
        return "megamarket"
    return ""


async def infer_contextual_task_command_with_llm(
    *,
    message: str,
    history: List[Dict[str, Any]] | None,
    ai_key: str,
) -> Dict[str, Any]:
    text = str(message or "").strip()
    if not text or not str(ai_key or "").strip():
        return {}
    prior = [x for x in (history or []) if isinstance(x, dict)][-12:]
    history_text = "\n".join(
        f"{str(m.get('role','user')).upper()}: {str(m.get('content',''))[:500]}"
        for m in prior
    )
    prompt = (
        "Определи, нужно ли СРАЗУ запускать задачу по контексту диалога (без лишних уточнений).\n"
        "Верни JSON:\n"
        "{\n"
        '  "should_start": true,\n'
        '  "confidence": 0.0,\n'
        '  "task_type": "api-integration|docs-ingest|design|backend",\n'
        '  "title": "short",\n'
        '  "description": "expanded intent",\n'
        '  "namespace": "docs:wildberries-api|docs:yandex-market|docs:ozon-api|docs:megamarket-api|docs:generic",\n'
        '  "web_query": "",\n'
        '  "validation_query": "",\n'
        '  "docs_urls": ["..."],\n'
        '  "reason": ""\n'
        "}\n"
        "Правила:\n"
        "- Если фраза краткая/эмоциональная/с опечатками, но по контексту это команда действия -> should_start=true.\n"
        "- Если это продолжение предыдущей команды (например 'так же как у мегамаркета') -> should_start=true.\n"
        "- clarify не делай на этом шаге; либо стартуем, либо should_start=false.\n"
        f"\nИстория:\n{history_text}\n"
        f"\nТекущее сообщение:\n{text}\n"
    )
    obj = await chat_json_with_retries(
        config_str=ai_key,
        role="runtime",
        temperature=0.1,
        messages=[
            {"role": "system", "content": "Return strict JSON object only."},
            {"role": "user", "content": prompt},
        ],
    )
    if not isinstance(obj, dict) or obj.get("_error"):
        return {}
    should_start = bool(obj.get("should_start", False))
    conf = float(obj.get("confidence") or 0.0)
    if not should_start or conf < 0.55:
        return {}
    return {
        "intent": "task_create",
        "task_type": str(obj.get("task_type") or "api-integration"),
        "title": str(obj.get("title") or (text[:120] or "Новая задача")),
        "description": str(obj.get("description") or text),
        "namespace": str(obj.get("namespace") or ""),
        "web_query": str(obj.get("web_query") or ""),
        "validation_query": str(obj.get("validation_query") or "authorization token create update list"),
        "docs_urls": obj.get("docs_urls") if isinstance(obj.get("docs_urls"), list) else _extract_urls(text),
        "max_web_results": 5,
    }


def _chat_state_key(user_id: str) -> str:
    return f"agent_chat:state:{user_id}"


def load_chat_state(user_id: str) -> Dict[str, Any]:
    raw = _redis.get(_chat_state_key(user_id))
    if not raw:
        return {"history": [], "active_task_id": ""}
    try:
        obj = json.loads(raw)
        if not isinstance(obj, dict):
            return {"history": [], "active_task_id": ""}
        return {
            "history": obj.get("history", []) if isinstance(obj.get("history"), list) else [],
            "active_task_id": str(obj.get("active_task_id") or ""),
        }
    except Exception:
        return {"history": [], "active_task_id": ""}


def save_chat_state(user_id: str, *, history: List[Dict[str, Any]], active_task_id: str = "") -> None:
    obj = {"history": (history or [])[-30:], "active_task_id": str(active_task_id or "")}
    _redis.set(_chat_state_key(user_id), json.dumps(obj, ensure_ascii=False), ex=60 * 60 * 24 * 14)


def infer_agent_task_from_text(message: str, extra_urls: List[str] | None = None) -> Dict[str, Any]:
    text = str(message or "").strip()
    low = _norm_text(text)
    tokens = [t for t in re.split(r"\s+", low) if t]
    urls = _extract_urls(text)
    for u in (extra_urls or []):
        su = str(u or "").strip()
        if su and su not in urls:
            urls.append(su)

    docs_words = any(x in low for x in ["дока", "документац", "прочитай", "изучи", "man", "docs", "док"])
    integration_words = any(x in low for x in ["подключ", "интеграц", "api", "ручк", "endpoint", "эндпоинт", "сделай", "добавь", "настрой"])
    design_words = any(x in low for x in ["дизайн", "ui", "ux", "интерфейс", "цвет", "кнопк", "страниц", "редизайн"])
    smalltalk_only = (
        len(tokens) <= 4
        and not urls
        and not docs_words
        and not integration_words
        and not design_words
        and any(x in low for x in ["привет", "здар", "hello", "hi", "добрый", "ок", "спасибо", "понял"])
    )

    if smalltalk_only:
        return {
            "intent": "smalltalk",
            "task_type": "",
            "title": "",
            "description": text,
            "namespace": "",
            "docs_urls": [],
            "web_query": "",
            "validation_query": "",
            "max_web_results": 5,
        }

    task_type = "backend"
    if urls or docs_words:
        task_type = "docs-ingest"
    elif design_words:
        task_type = "design"
    elif integration_words:
        task_type = "api-integration"

    namespace = "docs:generic"
    web_query = ""
    if any(a in low for a in _MP_ALIASES["wildberries"]):
        namespace = "docs:wildberries-api"
        web_query = "Wildberries API documentation"
    elif any(a in low for a in _MP_ALIASES["yandex"]):
        namespace = "docs:yandex-market"
        web_query = "Yandex Market API documentation"
    elif any(a in low for a in _MP_ALIASES["ozon"]):
        namespace = "docs:ozon-api"
        web_query = "Ozon Seller API documentation"
    elif any(a in low for a in _MP_ALIASES["megamarket"]):
        namespace = "docs:megamarket-api"
        web_query = "Megamarket API documentation"

    title = text[:120] if text else "Новая задача агенту"
    if len(title) < 8:
        title = "Новая задача агенту"

    validation_query = "authorization api key required fields"
    if any(a in low for a in _MP_ALIASES["wildberries"]):
        validation_query = "token authorization catalog card create update"

    return {
        "intent": "task",
        "task_type": task_type,
        "title": title,
        "description": text,
        "namespace": namespace if task_type == "docs-ingest" else "",
        "docs_urls": urls,
        "web_query": web_query if task_type == "docs-ingest" else "",
        "validation_query": validation_query if task_type == "docs-ingest" else "",
        "max_web_results": 5,
    }


async def route_message_with_llm(
    *,
    message: str,
    history: List[Dict[str, Any]] | None,
    ai_key: str,
) -> Dict[str, Any]:
    text = str(message or "").strip()
    prior = history or []
    # keep compact context window
    prior = [x for x in prior if isinstance(x, dict)][-10:]
    history_text = "\n".join(
        f"{str(m.get('role','user')).upper()}: {str(m.get('content',''))[:700]}"
        for m in prior
    )
    prompt = (
        "Ты интеллектуальный ассистент проекта PIM.Giper.fm (репозиторий pimv3). "
        "Понимай сообщение естественно, как живой помощник.\n"
        "Верни JSON:\n"
        "{\n"
        '  "intent": "smalltalk|task_create|task_status|clarify",\n'
        '  "task_type": "docs-ingest|api-integration|design|backend",\n'
        '  "title": "short title",\n'
        '  "description": "full user intent",\n'
        '  "namespace": "docs:wildberries-api|docs:yandex-market|docs:ozon-api|docs:megamarket-api|docs:generic",\n'
        '  "docs_urls": ["..."],\n'
        '  "web_query": "query",\n'
        '  "validation_query": "query",\n'
        '  "task_id": "",\n'
        '  "requires_clarification": false,\n'
        '  "clarification_question": "",\n'
        '  "blocker_level": "none|soft|hard"\n'
        "}\n"
        "Правила:\n"
        "- Если это приветствие/smalltalk без запроса действия -> intent=smalltalk.\n"
        "- Если пользователь явно просит сделать задачу -> intent=task_create.\n"
        "- Если формулировка короткая/грязная/с опечатками, но по смыслу это команда -> intent=task_create.\n"
        "- Если это продолжение контекста активной работы ('так же', 'по аналогии', 'как в прошлой задаче') -> intent=task_create.\n"
        "- Если пользователь спрашивает статус/что с задачей -> intent=task_status.\n"
        "- Если не хватает данных для запуска -> intent=clarify и задай 1 короткий вопрос.\n"
        "- Если пользователь просит 'подключить WB/Вайлдберис/Яндекс/Ozon/Мегамаркет' без деталей, НЕ тормози: запускай task_create (api-integration), а уточнение задай уже после старта в ответе.\n"
        "- Для docs по ВБ выбирай namespace docs:wildberries-api.\n"
        "- Для docs по Яндекс маркету выбирай namespace docs:yandex-market.\n"
        "- Если есть URL в сообщении, добавь в docs_urls.\n"
        f"\nИстория:\n{history_text}\n"
        f"\nТекущее сообщение пользователя:\n{text}\n"
    )
    obj = await chat_json_with_retries(
        config_str=ai_key,
        role="runtime",
        temperature=0.1,
        messages=[
            {"role": "system", "content": "Return strict JSON object only."},
            {"role": "user", "content": prompt},
        ],
    )
    if not isinstance(obj, dict) or obj.get("_error"):
        # fallback to previous deterministic parser
        det = infer_agent_task_from_text(text, [])
        if det.get("intent") == "smalltalk":
            return {"intent": "smalltalk"}
        return {
            "intent": "task_create",
            "task_type": det.get("task_type", "backend"),
            "title": det.get("title", text[:120] or "Новая задача"),
            "description": det.get("description", text),
            "namespace": det.get("namespace", ""),
            "docs_urls": det.get("docs_urls", []),
            "web_query": det.get("web_query", ""),
            "validation_query": det.get("validation_query", ""),
            "task_id": "",
            "requires_clarification": False,
            "clarification_question": "",
        }
    # normalize
    out = dict(obj)
    out["intent"] = str(out.get("intent") or "clarify")
    out["task_type"] = str(out.get("task_type") or "backend")
    out["title"] = str(out.get("title") or (text[:120] or "Новая задача"))
    out["description"] = str(out.get("description") or text)
    out["namespace"] = str(out.get("namespace") or "")
    out["docs_urls"] = out.get("docs_urls") if isinstance(out.get("docs_urls"), list) else []
    out["web_query"] = str(out.get("web_query") or "")
    out["validation_query"] = str(out.get("validation_query") or "")
    out["task_id"] = str(out.get("task_id") or "")
    out["requires_clarification"] = bool(out.get("requires_clarification", False))
    out["clarification_question"] = str(out.get("clarification_question") or "")
    out["blocker_level"] = str(out.get("blocker_level") or "none").strip().lower()
    # Guardrails to avoid over-clarification on clear integration intent.
    low = _norm_text(text)
    asks_integrate = any(x in low for x in ["подключ", "интегр", "настрой"])
    mentions_marketplace = _mentions_marketplace(low)
    if out["intent"] in {"clarify", "smalltalk"} and asks_integrate and mentions_marketplace:
        out["intent"] = "task_create"
        if out["task_type"] == "backend":
            out["task_type"] = "api-integration"
        if not out["title"].strip():
            out["title"] = text[:120] or "Интеграция маркетплейса"
    # Clarify only for hard blockers, otherwise default to task create.
    if out["intent"] == "clarify":
        has_blocker = bool(out["requires_clarification"]) and out["blocker_level"] == "hard"
        if not has_blocker:
            out["intent"] = "task_create"
            out["requires_clarification"] = False
            out["clarification_question"] = ""
    if out["intent"] == "smalltalk" and len(text.split()) >= 4:
        # Avoid drifting to chat-mode on short-but-actionable project phrases.
        out["intent"] = "task_create"
    return out


async def compose_assistant_reply_with_llm(
    *,
    ai_key: str,
    user_message: str,
    context: dict,
    history: list | None = None,
) -> str:
    """Полноценный Claude-уровень ответ с контекстом проекта и историей."""
    import subprocess, json as _json
    from openai import AsyncOpenAI

    system = (
        "Ты — AI-ассистент PIMv3 (PIM для маркетплейсов Ozon, WB, Яндекс, Мегамаркет).\n"
        "Стек: Python/FastAPI, React/TypeScript, PostgreSQL.\n"
        "Отвечай по-русски, кратко, код показывай сразу."
    )

    msgs = [{"role": "system", "content": system}]
    for m in (history or [])[-6:]:
        role = m.get("role", "user")
        cnt = m.get("content", "")
        if role in ("user", "assistant") and cnt:
            msgs.append({"role": role, "content": str(cnt)[:400]})

    ctx_note = ""
    intent = (context or {}).get("intent", "")
    if intent == "task_create":
        t = (context or {}).get("task", {})
        ctx_note = f" [Запущена задача: '{t.get('title','')}', id={t.get('task_id','')}, тип={t.get('task_type','')}]"
    elif intent == "task_status":
        t = (context or {}).get("task", {})
        logs = (context or {}).get("logs_tail", [])
        ctx_note = f" [Статус: {t.get('status','')}, этап: {t.get('stage','')}]"
        if logs:
            ctx_note += " Логи: " + "; ".join(str(l) for l in logs[-3:])

    msgs.append({"role": "user", "content": user_message + ctx_note})

    try:
        cfg = _json.loads(ai_key) if str(ai_key or "").strip().startswith("{") else {}
        api_key_val = cfg.get("api_key", ai_key)
        base_url = cfg.get("base_url", "https://api.deepseek.com")
        model = cfg.get("model", "deepseek-chat")
        client = AsyncOpenAI(api_key=api_key_val, base_url=base_url)
        resp = await client.chat.completions.create(
            model=model, messages=msgs, temperature=0.3, max_tokens=1500,
        )
        raw = (resp.choices[0].message.content or "").strip()
        # Strip <think>...</think> blocks from reasoning models like qwen3
        raw = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()
        return raw
    except Exception as e:
        return f"Ошибка LLM: {e}"


def build_user_reply(task: Dict[str, Any]) -> str:
    t = task.get("task", {}) if isinstance(task, dict) else {}
    task_id = str(t.get("task_id") or "")
    task_type = str(t.get("task_type") or "")
    title = str(t.get("title") or "")
    namespace = str(t.get("namespace") or "")
    lines = [
        "Принял задачу. Запускаю выполнение.",
        f"Тип: `{task_type}`",
        f"Название: {title}",
    ]
    if namespace:
        lines.append(f"Namespace: `{namespace}`")
    if task_id:
        lines.append(f"ID задачи: `{task_id}`")
    lines.append("Открой страницу `Agent Task Console` — там будут статусы и логи в реальном времени.")
    return "\n".join(lines)


def build_smalltalk_reply(user_text: str) -> str:
    t = str(user_text or "").strip()
    if any(x in t.lower() for x in ["привет", "hello", "hi", "здар", "добрый"]):
        return (
            "Привет. Да, понял тебя.\n"
            "Я не запускаю задачу на такие сообщения.\n"
            "Напиши, что именно сделать, например:\n"
            "`Вот дока по ВБ https://... прочитай и подключи API`"
        )
    return (
        "Понял.\n"
        "Чтобы запустить работу, напиши задачу простым текстом:"
        "\n`Подключи API ВБ, вот документация https://...`"
    )

