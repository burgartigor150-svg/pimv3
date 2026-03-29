from __future__ import annotations

import json
import time
import uuid
from typing import Any, Dict, List

import redis

_redis = redis.Redis.from_url("redis://localhost:6379/0", decode_responses=True)

ROLES = [
    "project_pim",
    "project_manager",
    "analyst",
    "frontend_dev",
    "backend_dev",
    "designer",
]

STATE_CHAIN = [
    "project_pim",
    "project_manager",
    "analyst",
    "backend_dev",
    "frontend_dev",
    "designer",
]


def _key_plan(plan_id: str) -> str:
    return f"team:plan:{plan_id}"


def _key_approval(approval_id: str) -> str:
    return f"team:approval:{approval_id}"


def create_plan(topic: str, created_by: str) -> Dict[str, Any]:
    pid = str(uuid.uuid4())
    obj = {
        "plan_id": pid,
        "topic": str(topic or "").strip(),
        "created_by": created_by,
        "created_at_ts": int(time.time()),
        "status": "active",
        "roles": ROLES,
        "questions": [],
        "tasks": [],
        "dialog_log": [],
    }
    _redis.set(_key_plan(pid), json.dumps(obj, ensure_ascii=False))
    _redis.lpush("team:plans", pid)
    _redis.ltrim("team:plans", 0, 199)
    return {"ok": True, "plan": obj}


def get_plan(plan_id: str) -> Dict[str, Any]:
    raw = _redis.get(_key_plan(plan_id))
    if not raw:
        return {"ok": False, "error": "plan not found"}
    return {"ok": True, "plan": json.loads(raw)}


def add_task(plan_id: str, role: str, title: str, details: str = "") -> Dict[str, Any]:
    got = get_plan(plan_id)
    if not got.get("ok"):
        return got
    plan = got["plan"]
    t = {
        "id": str(uuid.uuid4()),
        "role": role,
        "title": title,
        "details": details,
        "status": "pending",
        "created_at_ts": int(time.time()),
    }
    plan["tasks"].append(t)
    _redis.set(_key_plan(plan_id), json.dumps(plan, ensure_ascii=False))
    return {"ok": True, "task": t, "plan_id": plan_id}


def add_question(plan_id: str, asked_by: str, question: str) -> Dict[str, Any]:
    got = get_plan(plan_id)
    if not got.get("ok"):
        return got
    plan = got["plan"]
    q = {
        "id": str(uuid.uuid4()),
        "asked_by": asked_by,
        "question": question,
        "answer": "",
        "status": "open",
        "ts": int(time.time()),
    }
    plan["questions"].append(q)
    _redis.set(_key_plan(plan_id), json.dumps(plan, ensure_ascii=False))
    return {"ok": True, "question": q}


def answer_question(plan_id: str, question_id: str, answer: str, answered_by: str) -> Dict[str, Any]:
    got = get_plan(plan_id)
    if not got.get("ok"):
        return got
    plan = got["plan"]
    found = None
    for q in plan.get("questions", []):
        if str(q.get("id")) == str(question_id):
            q["answer"] = answer
            q["answered_by"] = answered_by
            q["status"] = "answered"
            q["answered_at_ts"] = int(time.time())
            found = q
            break
    _redis.set(_key_plan(plan_id), json.dumps(plan, ensure_ascii=False))
    if not found:
        return {"ok": False, "error": "question not found"}
    return {"ok": True, "question": found}


def init_state_machine(plan_id: str) -> Dict[str, Any]:
    got = get_plan(plan_id)
    if not got.get("ok"):
        return got
    plan = got["plan"]
    plan["state_machine"] = {
        "current": STATE_CHAIN[0],
        "chain": STATE_CHAIN,
        "history": [{"state": STATE_CHAIN[0], "ts": int(time.time()), "note": "initialized"}],
    }
    _redis.set(_key_plan(plan_id), json.dumps(plan, ensure_ascii=False))
    return {"ok": True, "state_machine": plan["state_machine"]}


def advance_state_machine(plan_id: str, note: str = "") -> Dict[str, Any]:
    got = get_plan(plan_id)
    if not got.get("ok"):
        return got
    plan = got["plan"]
    sm = plan.get("state_machine") or {}
    chain = sm.get("chain") or STATE_CHAIN
    cur = str(sm.get("current") or chain[0])
    try:
        idx = chain.index(cur)
    except ValueError:
        idx = 0
    nxt = chain[min(idx + 1, len(chain) - 1)]
    sm["current"] = nxt
    hist = sm.get("history") or []
    hist.append({"state": nxt, "ts": int(time.time()), "note": note})
    sm["history"] = hist
    plan["state_machine"] = sm
    _redis.set(_key_plan(plan_id), json.dumps(plan, ensure_ascii=False))
    return {"ok": True, "state_machine": sm}


def request_admin_approval(action: str, payload: Dict[str, Any], requested_by: str) -> Dict[str, Any]:
    aid = str(uuid.uuid4())
    obj = {
        "approval_id": aid,
        "action": action,
        "payload": payload or {},
        "requested_by": requested_by,
        "status": "pending",
        "created_at_ts": int(time.time()),
    }
    _redis.set(_key_approval(aid), json.dumps(obj, ensure_ascii=False))
    _redis.lpush("team:approvals", aid)
    _redis.ltrim("team:approvals", 0, 499)
    return {"ok": True, "approval": obj}


def list_approvals(limit: int = 100) -> Dict[str, Any]:
    ids = _redis.lrange("team:approvals", 0, max(0, int(limit) - 1)) or []
    out: List[Dict[str, Any]] = []
    for i in ids:
        raw = _redis.get(_key_approval(i))
        if not raw:
            continue
        try:
            out.append(json.loads(raw))
        except Exception:
            continue
    return {"ok": True, "approvals": out}


def decide_approval(approval_id: str, decision: str, admin_email: str) -> Dict[str, Any]:
    raw = _redis.get(_key_approval(approval_id))
    if not raw:
        return {"ok": False, "error": "approval not found"}
    obj = json.loads(raw)
    d = str(decision or "").strip().lower()
    if d not in {"approved", "rejected"}:
        return {"ok": False, "error": "decision must be approved/rejected"}
    obj["status"] = d
    obj["decided_by"] = admin_email
    obj["decided_at_ts"] = int(time.time())
    _redis.set(_key_approval(approval_id), json.dumps(obj, ensure_ascii=False))
    return {"ok": True, "approval": obj}


def find_approval(action: str, predicate: Dict[str, Any] | None = None, status: str = "approved") -> Dict[str, Any]:
    pred = predicate or {}
    rows = list_approvals(limit=500).get("approvals", [])
    for a in rows:
        if str(a.get("action")) != str(action):
            continue
        if str(a.get("status")) != str(status):
            continue
        payload = a.get("payload", {}) if isinstance(a.get("payload"), dict) else {}
        ok = True
        for k, v in pred.items():
            if str(payload.get(k)) != str(v):
                ok = False
                break
        if ok:
            return {"ok": True, "approval": a}
    return {"ok": False, "error": "approval_not_found"}


def get_approval(approval_id: str) -> Dict[str, Any]:
    raw = _redis.get(_key_approval(str(approval_id)))
    if not raw:
        return {"ok": False, "error": "approval not found"}
    try:
        return {"ok": True, "approval": json.loads(raw)}
    except Exception:
        return {"ok": False, "error": "invalid approval payload"}

