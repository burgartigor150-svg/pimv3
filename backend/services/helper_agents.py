from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Dict, List

import redis

_redis = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)


def _key(helper_id: str) -> str:
    return f"helper_agent:{helper_id}"


def create_helper_agent(
    *,
    name: str,
    role: str,
    goal: str,
    tools: List[str] | None = None,
    created_by: str = "system@agent",
    parent_task_id: str = "",
) -> Dict[str, Any]:
    helper_id = str(uuid.uuid4())
    now = int(time.time())
    obj = {
        "helper_id": helper_id,
        "name": str(name or "").strip() or "Helper Agent",
        "role": str(role or "").strip() or "assistant",
        "goal": str(goal or "").strip(),
        "tools": tools or [],
        "created_by": str(created_by or "system@agent"),
        "parent_task_id": str(parent_task_id or ""),
        "status": "idle",
        "created_at_ts": now,
        "updated_at_ts": now,
    }
    mapping: Dict[str, str] = {}
    for k, v in obj.items():
        if isinstance(v, (dict, list)):
            mapping[k] = json.dumps(v, ensure_ascii=False)
        else:
            mapping[k] = str(v)
    _redis.hset(_key(helper_id), mapping=mapping)
    _redis.expire(_key(helper_id), 60 * 60 * 24 * 30)
    _redis.lpush("helper_agent:items", helper_id)
    _redis.ltrim("helper_agent:items", 0, 999)
    return {"ok": True, "helper": obj}


def get_helper_agent(helper_id: str) -> Dict[str, Any]:
    raw = _redis.hgetall(_key(helper_id)) or {}
    if not raw:
        return {"ok": False, "error": "helper not found"}
    item: Dict[str, Any] = dict(raw)
    if isinstance(item.get("tools"), str) and str(item.get("tools")).startswith("["):
        try:
            item["tools"] = json.loads(str(item.get("tools")))
        except Exception:
            item["tools"] = []
    for k in ("created_at_ts", "updated_at_ts"):
        try:
            item[k] = int(str(item.get(k, "0")) or 0)
        except Exception:
            item[k] = 0
    return {"ok": True, "helper": item}


def list_helper_agents(limit: int = 200) -> Dict[str, Any]:
    ids = _redis.lrange("helper_agent:items", 0, max(0, int(limit) - 1)) or []
    out: List[Dict[str, Any]] = []
    for i in ids:
        got = get_helper_agent(i)
        if got.get("ok"):
            out.append(got["helper"])
    return {"ok": True, "helpers": out}


def auto_spawn_helpers_for_task(
    *,
    task_type: str,
    task_id: str,
    title: str,
    description: str,
    created_by: str,
) -> Dict[str, Any]:
    tt = str(task_type or "").strip().lower()
    templates: List[Dict[str, Any]]
    if tt == "design":
        templates = [
            {"name": "UX Analyst", "role": "analyst", "goal": "Разобрать UX-требования и критерии готовности", "tools": ["knowledge", "web"]},
            {"name": "UI Implementer", "role": "frontend_dev", "goal": "Внести изменения в UI и стили", "tools": ["code", "tests"]},
            {"name": "UI Verifier", "role": "qa", "goal": "Проверить, что UI изменился без регрессий", "tools": ["tests", "quality_gate"]},
        ]
    elif tt == "api-integration":
        templates = [
            {"name": "API Analyst", "role": "analyst", "goal": "Разобрать API docs и auth/limits", "tools": ["knowledge", "web", "context7"]},
            {"name": "Backend Integrator", "role": "backend_dev", "goal": "Реализовать интеграцию и ручки", "tools": ["code", "tests"]},
            {"name": "Contract Verifier", "role": "qa", "goal": "Проверить контракт и ошибки API", "tools": ["tests", "quality_gate"]},
        ]
    else:
        templates = [
            {"name": "Task Analyst", "role": "analyst", "goal": "Декомпозировать задачу и риски", "tools": ["knowledge"]},
            {"name": "Code Implementer", "role": "backend_dev", "goal": "Внести рабочие кодовые изменения", "tools": ["code", "tests"]},
            {"name": "Verifier", "role": "qa", "goal": "Проверить сборку, тесты и качество", "tools": ["tests", "quality_gate"]},
        ]

    created: List[Dict[str, Any]] = []
    for t in templates:
        obj = create_helper_agent(
            name=t["name"],
            role=t["role"],
            goal=f"{t['goal']} | task={title[:120]} | {description[:220]}",
            tools=t.get("tools", []),
            created_by=created_by,
            parent_task_id=task_id,
        )
        if obj.get("ok"):
            created.append(obj["helper"])
    return {"ok": True, "task_id": task_id, "helpers": created}

