from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Dict, List

import redis

from backend.services.agent_memory import get_agent_memory
from backend.services.code_patch_agent import generate_code_patch_proposal
from backend.services.git_branch_manager import commit_all_changes, create_incident_branch
from backend.services.kpi_guard import compute_task_kpis, should_auto_stop_self_rewrite
from backend.services.quality_gate import run_quality_gate
from backend.services.rollback_guard import backup_files
from backend.services.self_rewrite_planner import build_self_rewrite_plan
from backend.services.team_orchestrator import (
    request_admin_approval,
    create_plan,
    add_task,
    find_approval,
    init_state_machine,
    advance_state_machine,
)
from backend.services.telemetry import append_task_event, get_task_events
from backend.services.test_orchestrator import run_tests

_redis = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)

FAIL_THRESHOLD = int(os.getenv("SELF_IMPROVE_FAIL_THRESHOLD", "3"))
FAIL_WINDOW_SEC = int(os.getenv("SELF_IMPROVE_FAIL_WINDOW_SEC", "3600"))


def _incident_key(incident_id: str) -> str:
    return f"self_improve:incident:{incident_id}"


def _incident_log_key(incident_id: str) -> str:
    return f"self_improve:incident:{incident_id}:logs"


def _set_incident(incident_id: str, data: Dict[str, Any]) -> None:
    payload = {}
    for k, v in (data or {}).items():
        if isinstance(v, (dict, list)):
            payload[k] = json.dumps(v, ensure_ascii=False)
        elif v is None:
            payload[k] = ""
        else:
            payload[k] = str(v)
    _redis.hset(_incident_key(incident_id), mapping=payload)
    _redis.expire(_incident_key(incident_id), 60 * 60 * 24 * 30)


def _append_incident_log(incident_id: str, msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    _redis.rpush(_incident_log_key(incident_id), line)
    _redis.ltrim(_incident_log_key(incident_id), -400, -1)
    _redis.expire(_incident_log_key(incident_id), 60 * 60 * 24 * 30)


def list_incidents(limit: int = 100) -> Dict[str, Any]:
    ids = _redis.lrange("self_improve:incidents", 0, max(0, int(limit) - 1)) or []
    out: List[Dict[str, Any]] = []
    for i in ids:
        raw = _redis.hgetall(_incident_key(i)) or {}
        if not raw:
            continue
        item = dict(raw)
        for nk in ("created_at_ts", "updated_at_ts"):
            try:
                item[nk] = int(str(item.get(nk, "0")) or 0)
            except Exception:
                item[nk] = 0
        out.append(item)
    return {"ok": True, "incidents": out}


def get_incident(incident_id: str) -> Dict[str, Any]:
    raw = _redis.hgetall(_incident_key(incident_id)) or {}
    if not raw:
        return {"ok": False, "error": "incident not found"}
    logs = _redis.lrange(_incident_log_key(incident_id), -300, -1) or []
    out = dict(raw)
    for nk in ("created_at_ts", "updated_at_ts"):
        try:
            out[nk] = int(str(out.get(nk, "0")) or 0)
        except Exception:
            out[nk] = 0
    return {"ok": True, "incident": out, "logs": logs}


def record_failure_and_maybe_trigger(
    *,
    sku: str,
    task_id: str,
    error_excerpt: str,
    ai_key: str | None = None,
) -> Dict[str, Any]:
    now = int(time.time())
    k = f"self_improve:failstreak:{sku}"
    _redis.zadd(k, {str(now): now})
    _redis.zremrangebyscore(k, 0, now - FAIL_WINDOW_SEC)
    cnt = int(_redis.zcard(k) or 0)
    _redis.expire(k, FAIL_WINDOW_SEC * 2)
    if cnt < FAIL_THRESHOLD:
        return {"triggered": False, "streak": cnt}

    incident_id = str(uuid.uuid4())
    incident = {
        "incident_id": incident_id,
        "sku": sku,
        "task_id": task_id,
        "status": "queued",
        "stage": "triggered_by_repeated_failures",
        "created_at_ts": now,
        "updated_at_ts": now,
        "streak": cnt,
        "error_excerpt": (error_excerpt or "")[:1200],
        "branch": "",
    }
    _set_incident(incident_id, incident)
    _redis.lpush("self_improve:incidents", incident_id)
    _redis.ltrim("self_improve:incidents", 0, 499)
    _append_incident_log(incident_id, f"Triggered by repeated failures: streak={cnt}")
    append_task_event(task_id, "self_improve_triggered", {"incident_id": incident_id, "sku": sku, "streak": cnt})
    _redis.delete(k)
    return {"triggered": True, "incident_id": incident_id}


async def run_incident_pipeline(
    *,
    incident_id: str,
    ai_key: str,
    workspace_root: str = "/mnt/data/Pimv3",
) -> Dict[str, Any]:
    got = get_incident(incident_id)
    if not got.get("ok"):
        return got
    incident = got["incident"]
    task_id = str(incident.get("task_id") or "")
    _set_incident(incident_id, {"status": "running", "stage": "planning", "updated_at_ts": int(time.time())})
    _append_incident_log(incident_id, "Collecting telemetry and planning rewrite")

    events = get_task_events(task_id, tail=500)
    rewrite_plan = build_self_rewrite_plan(events, max_hypotheses=8)
    kpis = compute_task_kpis(events)
    stop = should_auto_stop_self_rewrite(kpis)
    if stop.get("stop"):
        _set_incident(incident_id, {"status": "blocked", "stage": "kpi_guard", "updated_at_ts": int(time.time()), "kpi_guard": stop})
        _append_incident_log(incident_id, f"KPI guard stop: {json.dumps(stop, ensure_ascii=False)}")
        return {"ok": False, "reason": "kpi_guard", "guard": stop}

    _set_incident(incident_id, {"stage": "team_state_machine", "updated_at_ts": int(time.time())})
    plan_obj = create_plan(topic=f"Auto self-improve incident {incident_id}", created_by="system@agent")
    pid = (((plan_obj or {}).get("plan") or {}).get("plan_id") or "")
    if pid:
        init_state_machine(pid)
        add_task(pid, "project_pim", "Проанализировать причины провалов", f"incident={incident_id}")
        advance_state_machine(pid, "project_pim scoped issue")
        add_task(pid, "project_manager", "Назначить реализацию фикса", f"incident={incident_id}")
        advance_state_machine(pid, "project_manager dispatched work")
        add_task(pid, "analyst", "Сформулировать гипотезы и критерии проверки", f"incident={incident_id}")
        advance_state_machine(pid, "analyst prepared hypotheses")
        add_task(pid, "backend_dev", "Внести кодовые правки", f"incident={incident_id}")
        advance_state_machine(pid, "backend patching")
        add_task(pid, "frontend_dev", "Проверить влияние на UI", f"incident={incident_id}")
        advance_state_machine(pid, "frontend check")
        add_task(pid, "designer", "Проверить UX регрессии", f"incident={incident_id}")
        advance_state_machine(pid, "designer validation")
        _set_incident(incident_id, {"team_plan_id": pid})

    _set_incident(incident_id, {"stage": "git_branch", "updated_at_ts": int(time.time())})
    br = create_incident_branch(workspace_root, incident_id)
    if br.get("ok"):
        _set_incident(incident_id, {"branch": br.get("branch", "")})
    _append_incident_log(incident_id, f"Branch step: {json.dumps(br, ensure_ascii=False)[:800]}")

    _set_incident(incident_id, {"stage": "patch_proposal", "updated_at_ts": int(time.time())})
    proposal = await generate_code_patch_proposal(
        ai_config=ai_key,
        rewrite_plan=rewrite_plan,
        allowlist_files=[
            "backend/celery_worker.py",
            "backend/services/megamarket_syndicate_agent.py",
            "backend/services/megamarket_reviewer_agent.py",
            "backend/services/megamarket_verifier_agent.py",
            "backend/services/adapters.py",
            "backend/services/ai_service.py",
            "backend/main.py",
            "backend/services/autonomous_improve.py",
        ],
    )
    _set_incident(incident_id, {"proposal": proposal, "updated_at_ts": int(time.time())})
    _append_incident_log(incident_id, f"Proposal ready: ok={proposal.get('ok')}")

    affected = ((proposal.get("proposal") or {}).get("affected_files") or []) if isinstance(proposal, dict) else []
    backup_map = backup_files(workspace_root, affected)

    _set_incident(incident_id, {"stage": "tests", "updated_at_ts": int(time.time())})
    tests = run_tests(workspace_root)
    _set_incident(incident_id, {"tests": tests})
    _append_incident_log(incident_id, f"Tests done: ok={tests.get('ok')}")

    _set_incident(incident_id, {"stage": "quality_gate", "updated_at_ts": int(time.time())})
    gate = run_quality_gate(workspace_root=workspace_root, changed_files=affected, run_frontend_build=False)
    _set_incident(incident_id, {"quality_gate": gate})
    _append_incident_log(incident_id, f"Quality gate: ok={gate.get('ok')}")

    if not tests.get("ok") or not gate.get("ok"):
        _set_incident(
            incident_id,
            {
                "status": "failed",
                "stage": "rollback",
                "updated_at_ts": int(time.time()),
                "rollback_backup_count": len(backup_map),
            },
        )
        _append_incident_log(incident_id, "Pipeline failed, rollback guard kept backups")
        mem = get_agent_memory()
        mem.upsert_knowledge_doc(
            namespace="incidents:self-improve",
            source_uri=f"incident://{incident_id}",
            title=f"Incident {incident_id} failed",
            content=json.dumps({"incident": incident, "tests": tests, "gate": gate}, ensure_ascii=False),
            metadata={"status": "failed"},
        )
        return {"ok": False, "incident_id": incident_id, "tests": tests, "gate": gate}

    _set_incident(incident_id, {"stage": "admin_gate", "updated_at_ts": int(time.time())})
    approval = request_admin_approval(
        "auto_git_promote",
        {"incident_id": incident_id, "branch": br.get("branch", ""), "task_id": task_id},
        requested_by="system@agent",
    )
    _set_incident(incident_id, {"approval": approval})
    _append_incident_log(incident_id, "Requested admin approval for auto-promote")

    approved = find_approval("auto_git_promote", {"incident_id": incident_id}, status="approved")
    if not approved.get("ok"):
        _set_incident(
            incident_id,
            {
                "status": "pending_admin_approval",
                "stage": "admin_gate_wait",
                "updated_at_ts": int(time.time()),
            },
        )
        _append_incident_log(incident_id, "Waiting admin approval before git commit/promotion")
        return {"ok": True, "incident_id": incident_id, "status": "pending_admin_approval"}

    commit = commit_all_changes(workspace_root, f"auto: self-improve incident {incident_id}")
    _set_incident(incident_id, {"git_commit": commit, "updated_at_ts": int(time.time())})
    _append_incident_log(incident_id, f"Local commit result: ok={commit.get('ok')}")

    _set_incident(incident_id, {"status": "completed", "stage": "completed", "updated_at_ts": int(time.time())})
    mem = get_agent_memory()
    mem.upsert_knowledge_doc(
        namespace="incidents:self-improve",
        source_uri=f"incident://{incident_id}",
        title=f"Incident {incident_id} completed",
        content=json.dumps({"incident": incident, "tests": tests, "gate": gate, "commit": commit}, ensure_ascii=False),
        metadata={"status": "completed"},
    )
    return {"ok": True, "incident_id": incident_id}

