from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

import redis

from backend.services.knowledge_hub import (
    discover_web_urls,
    ingest_local_markdown_file,
    ingest_url_to_knowledge,
    list_knowledge,
    search_knowledge,
)
from backend.services.team_orchestrator import (
    add_task,
    create_plan,
    init_state_machine,
    request_admin_approval,
)
from backend.services.code_patch_agent import generate_code_patch_proposal
from backend.services.git_branch_manager import create_incident_branch, commit_all_changes, push_branch
from backend.services.github_automation import create_pull_request
from backend.services.quality_gate import run_quality_gate
from backend.services.test_orchestrator import run_tests
from backend.services.helper_agents import auto_spawn_helpers_for_task

_redis = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)

_GIT_LOCK_KEY = "agent:git_execution_lock"
_GIT_LOCK_TTL = 900  # 15 минут — максимальное время одной задачи
_GIT_BIN = shutil.which("git") or "/usr/bin/git"


def context7_is_connected() -> bool:
    # Runtime MCP mount in Cursor host.
    if Path("/home/igun2/.cursor/projects/mnt-data-Pimv3/mcps/context7").exists():
        return True
    # Project-level Cursor MCP configuration.
    cfg = Path("/mnt/data/Pimv3/.cursor/mcp.json")
    if cfg.exists():
        try:
            obj = json.loads(cfg.read_text(encoding="utf-8"))
            servers = obj.get("mcpServers", {}) if isinstance(obj, dict) else {}
            if isinstance(servers, dict) and "context7" in servers:
                return True
        except Exception:
            pass
    return False


def _task_key(task_id: str) -> str:
    return f"agent_task:{task_id}"


def _task_log_key(task_id: str) -> str:
    return f"agent_task:{task_id}:logs"


def _task_team_key(task_id: str) -> str:
    return f"agent_task:{task_id}:team"


def _set_task(task_id: str, data: Dict[str, Any]) -> None:
    payload: Dict[str, str] = {}
    for k, v in (data or {}).items():
        if isinstance(v, (dict, list)):
            payload[k] = json.dumps(v, ensure_ascii=False)
        elif v is None:
            payload[k] = ""
        else:
            payload[k] = str(v)
    _redis.hset(_task_key(task_id), mapping=payload)
    _redis.expire(_task_key(task_id), 60 * 60 * 24 * 30)


def _append_log(task_id: str, message: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {message}"
    _redis.rpush(_task_log_key(task_id), line)
    _redis.ltrim(_task_log_key(task_id), -500, -1)
    _redis.expire(_task_log_key(task_id), 60 * 60 * 24 * 30)


def _append_team_message(task_id: str, role: str, text: str, kind: str = "note") -> None:
    row = {
        "ts": int(time.time()),
        "role": str(role or "agent"),
        "kind": str(kind or "note"),
        "text": str(text or "")[:2000],
    }
    _redis.rpush(_task_team_key(task_id), json.dumps(row, ensure_ascii=False))
    _redis.ltrim(_task_team_key(task_id), -500, -1)
    _redis.expire(_task_team_key(task_id), 60 * 60 * 24 * 30)


def set_task_control_state(task_id: str, state: str) -> Dict[str, Any]:
    st = str(state or "").strip().lower()
    if st not in {"running", "paused"}:
        return {"ok": False, "error": "invalid_state"}
    now = int(time.time())
    data: Dict[str, Any] = {"control_state": st, "updated_at_ts": now}
    if st == "paused":
        data["status"] = "paused"
        _append_team_message(task_id, "project_manager", "Ставлю задачу на паузу.", kind="pause")
    else:
        data["status"] = "running"
        _append_team_message(task_id, "project_manager", "Возобновляю выполнение задачи.", kind="resume")
    _set_task(task_id, data)
    return {"ok": True, "task_id": task_id, "control_state": st}


def _get_task_meta(task_id: str) -> Dict[str, Any]:
    raw = _redis.hgetall(_task_key(task_id)) or {}
    return dict(raw)


def _is_task_paused(task_id: str) -> bool:
    raw = _get_task_meta(task_id)
    status = str(raw.get("status") or "").strip().lower()
    control = str(raw.get("control_state") or "").strip().lower()
    return status == "paused" or control == "paused"


async def _wait_if_paused(task_id: str) -> None:
    while _is_task_paused(task_id):
        await asyncio.sleep(1.0)


def create_agent_task(
    *,
    task_type: str,
    title: str,
    description: str,
    requested_by: str,
    namespace: str | None = None,
    docs_urls: List[str] | None = None,
    local_paths: List[str] | None = None,
    validation_query: str | None = None,
    web_query: str | None = None,
    max_web_results: int = 5,
) -> Dict[str, Any]:
    task_id = str(uuid.uuid4())
    now = int(time.time())
    obj = {
        "task_id": task_id,
        "task_type": str(task_type or "backend"),
        "title": str(title or "").strip(),
        "description": str(description or "").strip(),
        "requested_by": str(requested_by or "unknown"),
        "status": "queued",
        "stage": "created",
        "namespace": str(namespace or "").strip(),
        "docs_urls": docs_urls or [],
        "local_paths": local_paths or [],
        "validation_query": str(validation_query or "").strip(),
        "web_query": str(web_query or "").strip(),
        "max_web_results": max(1, int(max_web_results or 5)),
        "created_at_ts": now,
        "updated_at_ts": now,
        "result": {},
        "plan_id": "",
    }
    _set_task(task_id, obj)
    _redis.lpush("agent_task:items", task_id)
    _redis.ltrim("agent_task:items", 0, 499)
    _append_log(task_id, f"Task created: {obj['task_type']} | {obj['title']}")
    return {"ok": True, "task": obj}


def list_agent_tasks(limit: int = 100) -> Dict[str, Any]:
    ids = _redis.lrange("agent_task:items", 0, max(0, int(limit) - 1)) or []
    out: List[Dict[str, Any]] = []
    for i in ids:
        raw = _redis.hgetall(_task_key(i)) or {}
        if not raw:
            continue
        item: Dict[str, Any] = dict(raw)
        for k in ("docs_urls", "local_paths", "result"):
            v = item.get(k)
            if isinstance(v, str) and v.startswith(("[", "{")):
                try:
                    item[k] = json.loads(v)
                except Exception:
                    pass
        for k in ("created_at_ts", "updated_at_ts"):
            try:
                item[k] = int(str(item.get(k, "0")) or 0)
            except Exception:
                item[k] = 0
        out.append(item)
    return {"ok": True, "tasks": out}


def get_agent_task(task_id: str) -> Dict[str, Any]:
    raw = _redis.hgetall(_task_key(task_id)) or {}
    if not raw:
        return {"ok": False, "error": "task not found"}
    item: Dict[str, Any] = dict(raw)
    for k in ("docs_urls", "local_paths", "result"):
        v = item.get(k)
        if isinstance(v, str) and v.startswith(("[", "{")):
            try:
                item[k] = json.loads(v)
            except Exception:
                pass
    for k in ("created_at_ts", "updated_at_ts"):
        try:
            item[k] = int(str(item.get(k, "0")) or 0)
        except Exception:
            item[k] = 0
    logs = _redis.lrange(_task_log_key(task_id), -300, -1) or []
    team_raw = _redis.lrange(_task_team_key(task_id), -300, -1) or []
    team_messages: List[Dict[str, Any]] = []
    for line in team_raw:
        s = str(line or "").strip()
        if not s:
            continue
        try:
            team_messages.append(json.loads(s))
        except Exception:
            continue
    return {"ok": True, "task": item, "logs": logs, "team_messages": team_messages}


def _plan_template_for_task(task_type: str) -> List[Dict[str, str]]:
    tt = str(task_type or "").strip().lower()
    if tt == "design":
        return [
            {"role": "project_pim", "title": "Сформулировать дизайн-цель", "details": "Определить KPI UX и ограничения"},
            {"role": "analyst", "title": "Собрать UX-требования", "details": "Референсы, pain points, acceptance criteria"},
            {"role": "designer", "title": "Подготовить дизайн-спецификацию", "details": "Структура, компоненты, визуальный стиль"},
            {"role": "frontend_dev", "title": "Реализовать UI изменения", "details": "Внести правки в интерфейс"},
        ]
    if tt == "api-integration":
        return [
            {"role": "project_pim", "title": "Определить область интеграции API", "details": "Какие endpoints и сценарии нужны"},
            {"role": "analyst", "title": "Собрать требования и ограничения API", "details": "Auth, rate limits, dictionary rules"},
            {"role": "backend_dev", "title": "Реализовать адаптер и ручки", "details": "Подключить API и валидацию"},
            {"role": "frontend_dev", "title": "Добавить UI для управления интеграцией", "details": "Формы, статусы, ошибки"},
        ]
    if tt == "docs-ingest":
        return [
            {"role": "analyst", "title": "Проверить источники документации", "details": "Проверка URL, разделов и полноты"},
            {"role": "backend_dev", "title": "Загрузить docs в knowledge namespace", "details": "ingest + validate + attach"},
        ]
    return [
        {"role": "project_manager", "title": "Разбить задачу на подзадачи", "details": "Подготовить roadmap"},
        {"role": "analyst", "title": "Собрать требования и риски", "details": "Определить критерии готовности"},
        {"role": "backend_dev", "title": "Реализовать backend часть", "details": "Код и тесты"},
        {"role": "frontend_dev", "title": "Реализовать frontend часть", "details": "UI/UX и отображение статусов"},
    ]


def _standard_dev_queue(task_type: str) -> List[Dict[str, Any]]:
    tt = str(task_type or "").strip().lower()
    if tt == "docs-ingest":
        return [
            {"id": "discovery", "owner_role": "analyst", "title": "Сбор источников", "tools": ["knowledge", "web", "context7"]},
            {"id": "ingest", "owner_role": "backend_dev", "title": "Ингест в namespace", "tools": ["knowledge", "code"]},
            {"id": "validate", "owner_role": "qa", "title": "Валидация индекса", "tools": ["tests", "quality_gate"]},
            {"id": "handoff", "owner_role": "project_manager", "title": "Финальный отчёт", "tools": ["reporting"]},
        ]
    if tt == "design":
        return [
            {"id": "analysis", "owner_role": "analyst", "title": "UX анализ и требования", "tools": ["knowledge", "web"]},
            {"id": "design", "owner_role": "designer", "title": "Дизайн-решение", "tools": ["design", "knowledge"]},
            {"id": "implement", "owner_role": "frontend_dev", "title": "Реализация UI", "tools": ["code", "tests"]},
            {"id": "verify", "owner_role": "qa", "title": "Проверка без регрессий", "tools": ["tests", "quality_gate"]},
            {"id": "handoff", "owner_role": "project_manager", "title": "PR и результат", "tools": ["git", "reporting"]},
        ]
    return [
        {"id": "analysis", "owner_role": "analyst", "title": "Анализ и декомпозиция", "tools": ["knowledge", "web", "context7"]},
        {"id": "implement", "owner_role": "backend_dev", "title": "Кодирование и интеграция", "tools": ["code", "git"]},
        {"id": "test", "owner_role": "qa", "title": "Тесты и quality gate", "tools": ["tests", "quality_gate"]},
        {"id": "release", "owner_role": "project_manager", "title": "Commit/Push/PR и отчёт", "tools": ["git", "github"]},
    ]


def _queue_begin(task_id: str, queue: List[Dict[str, Any]]) -> None:
    _set_task(task_id, {"dev_queue": queue, "queue_index": 0})
    if not queue:
        return
    first = queue[0]
    _set_task(
        task_id,
        {
            "queue_owner_role": str(first.get("owner_role") or ""),
            "queue_item_id": str(first.get("id") or ""),
            "queue_item_title": str(first.get("title") or ""),
            "queue_item_tools": list(first.get("tools") or []),
        },
    )
    _append_team_message(
        task_id,
        "project_manager",
        f"Очередь разработки запущена. Текущий этап: {first.get('title')} ({first.get('owner_role')}).",
        kind="queue",
    )


def _queue_step(task_id: str, queue: List[Dict[str, Any]], step_id: str, done_note: str) -> None:
    idx = -1
    for i, s in enumerate(queue):
        if str(s.get("id")) == str(step_id):
            idx = i
            break
    if idx < 0:
        return
    step = queue[idx]
    _set_task(
        task_id,
        {
            "queue_index": idx,
            "queue_owner_role": str(step.get("owner_role") or ""),
            "queue_item_id": str(step.get("id") or ""),
            "queue_item_title": str(step.get("title") or ""),
            "queue_item_tools": list(step.get("tools") or []),
        },
    )
    _append_team_message(
        task_id,
        str(step.get("owner_role") or "agent"),
        f"Беру этап: {step.get('title')}. Инструменты: {', '.join(step.get('tools') or [])}",
        kind="queue",
    )
    _append_team_message(task_id, str(step.get("owner_role") or "agent"), done_note, kind="queue_done")


def _run(cmd: List[str], cwd: str) -> Dict[str, Any]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)
    return {
        "ok": p.returncode == 0,
        "code": p.returncode,
        "stdout": (p.stdout or "")[-5000:],
        "stderr": (p.stderr or "")[-5000:],
        "cmd": " ".join(cmd),
    }


def _git_is_clean(workspace_root: str) -> bool:
    st = _run([_GIT_BIN, "status", "--porcelain"], cwd=workspace_root)
    if not st["ok"]:
        return False
    return not bool((st.get("stdout") or "").strip())


def _git_stash(workspace_root: str) -> Dict[str, Any]:
    """[FIX-1] Сохраняем текущее состояние в stash перед применением патча."""
    r = _run([_GIT_BIN, "stash", "push", "-u", "-m", "agent_pre_patch_stash"], cwd=workspace_root)
    return {"ok": r["ok"], "stdout": r.get("stdout", ""), "stderr": r.get("stderr", "")}


def _git_stash_pop(workspace_root: str) -> Dict[str, Any]:
    """[FIX-1] Восстанавливаем состояние из stash (откат при провале)."""
    r = _run([_GIT_BIN, "stash", "pop"], cwd=workspace_root)
    return {"ok": r["ok"], "stdout": r.get("stdout", ""), "stderr": r.get("stderr", "")}


def _git_reset_hard(workspace_root: str) -> Dict[str, Any]:
    """[FIX-1] Жёсткий откат к HEAD если stash не помог."""
    r = _run([_GIT_BIN, "checkout", "."], cwd=workspace_root)
    _run([_GIT_BIN, "clean", "-fd"], cwd=workspace_root)
    return {"ok": r["ok"]}


def _acquire_git_lock(task_id: str) -> bool:
    """[FIX-4] Захватываем Redis-лок — только один агент работает с git одновременно."""
    return bool(_redis.set(_GIT_LOCK_KEY, task_id, nx=True, ex=_GIT_LOCK_TTL))


def _release_git_lock(task_id: str) -> None:
    """[FIX-4] Освобождаем лок если он принадлежит этой задаче."""
    current = _redis.get(_GIT_LOCK_KEY)
    if current == task_id:
        _redis.delete(_GIT_LOCK_KEY)


def _allowlist_for_task_type(task_type: str, workspace_root: str = "/mnt/data/Pimv3") -> List[str]:
    tt = str(task_type or "").strip().lower()
    root = Path(workspace_root)
    out: List[str] = []
    if tt == "design":
        for p in (root / "frontend" / "src").rglob("*"):
            if p.is_file() and p.suffix in {".tsx", ".ts", ".css"}:
                out.append(str(p.relative_to(root)))
    elif tt == "api-integration":
        for p in (root / "backend").rglob("*.py"):
            out.append(str(p.relative_to(root)))
        for p in (root / "frontend" / "src").rglob("*"):
            if p.is_file() and p.suffix in {".tsx", ".ts"}:
                out.append(str(p.relative_to(root)))
    else:
        for p in (root / "backend").rglob("*.py"):
            out.append(str(p.relative_to(root)))
        for p in (root / "frontend" / "src").rglob("*"):
            if p.is_file() and p.suffix in {".tsx", ".ts", ".css"}:
                out.append(str(p.relative_to(root)))
    # keep deterministic and compact
    out = sorted(set(out))
    return out[:1200]


def _knowledge_namespaces_for_task(task_type: str, description: str) -> List[str]:
    tt = str(task_type or "").strip().lower()
    low = str(description or "").lower()
    base = ["docs:qwen-code", "docs:megamarket-api", "docs:ozon-api", "docs:yandex-market", "docs:wildberries-api", "docs:generic"]
    if tt == "api-integration":
        if "wildberries" in low or "wb" in low or "вб" in low or "вайлдбер" in low:
            return ["docs:wildberries-api", "docs:qwen-code", "docs:generic"]
        if "yandex" in low or "яндекс" in low or "маркет" in low:
            return ["docs:yandex-market", "docs:qwen-code", "docs:generic"]
        if "ozon" in low or "озон" in low:
            return ["docs:ozon-api", "docs:qwen-code", "docs:generic"]
        if "megamarket" in low or "мегамаркет" in low:
            return ["docs:megamarket-api", "docs:qwen-code", "docs:generic"]
    return base


def _retrieve_knowledge_context(task_type: str, title: str, description: str) -> Dict[str, Any]:
    q = f"{title}\n{description}".strip()[:1200]
    namespaces = _knowledge_namespaces_for_task(task_type, description)
    hits_by_ns: Dict[str, Any] = {}
    all_hits: List[Dict[str, Any]] = []
    for ns in namespaces:
        try:
            got = search_knowledge(ns, q, limit=3)
            hits = got.get("hits", []) if isinstance(got, dict) else []
        except Exception:
            hits = []
        compact = []
        for h in hits[:3]:
            if not isinstance(h, dict):
                continue
            compact.append(
                {
                    "source_uri": str(h.get("source_uri") or ""),
                    "title": str(h.get("title") or ""),
                    "score": float(h.get("score") or 0.0),
                    "content_excerpt": str(h.get("content_excerpt") or "")[:800],
                }
            )
            all_hits.append(compact[-1])
        hits_by_ns[ns] = compact
    return {"query": q, "namespaces": namespaces, "hits_by_namespace": hits_by_ns, "hits_total": len(all_hits)}


def _apply_unified_diff(workspace_root: str, diff_text: str) -> Dict[str, Any]:
    patch = str(diff_text or "").strip()
    if not patch:
        return {"ok": False, "error": "empty_patch"}
    p = subprocess.run(
        [_GIT_BIN, "apply", "--index", "-"],
        cwd=workspace_root,
        input=patch,
        capture_output=True,
        text=True,
        check=False,
    )
    if p.returncode == 0:
        return {"ok": True, "code": 0, "stdout": (p.stdout or "")[-3000:], "stderr": (p.stderr or "")[-3000:]}
    # fallback without index
    p2 = subprocess.run(
        [_GIT_BIN, "apply", "-"],
        cwd=workspace_root,
        input=patch,
        capture_output=True,
        text=True,
        check=False,
    )
    return {
        "ok": p2.returncode == 0,
        "code": p2.returncode,
        "stdout": (p2.stdout or "")[-3000:],
        "stderr": ((p.stderr or "") + "\n" + (p2.stderr or ""))[-5000:],
    }


async def run_agent_task(task_id: str, ai_key: str = "") -> Dict[str, Any]:
    got = get_agent_task(task_id)
    if not got.get("ok"):
        return got
    task = got["task"]
    tt = str(task.get("task_type") or "backend").strip().lower()
    dev_queue = _standard_dev_queue(tt)
    now = int(time.time())
    _set_task(task_id, {"status": "running", "control_state": "running", "stage": "plan_setup", "progress_percent": 5, "eta_seconds": 180, "updated_at_ts": now})
    _append_log(task_id, "Creating team plan and role tasks")
    _append_team_message(task_id, "project_manager", "Принял задачу. Запускаю планирование и распределение ролей.")

    plan = create_plan(topic=str(task.get("title") or "Agent Task"), created_by=str(task.get("requested_by") or "system@agent"))
    plan_id = (((plan or {}).get("plan") or {}).get("plan_id") or "")
    if plan_id:
        init_state_machine(plan_id)
        for row in _plan_template_for_task(tt):
            add_task(plan_id, row["role"], row["title"], row["details"])
            _append_team_message(task_id, row["role"], f"Получил подзадачу: {row['title']}", kind="task")
        _set_task(task_id, {"plan_id": plan_id})
        _append_log(task_id, f"Plan created: {plan_id}")
        _append_team_message(task_id, "project_manager", f"План создан: {plan_id}")
    _queue_begin(task_id, dev_queue)

    result: Dict[str, Any] = {"task_type": tt, "plan_id": plan_id}
    context7_connected = context7_is_connected()
    result["context7_connected"] = context7_connected
    if not context7_connected:
        _append_log(task_id, "Context7 MCP is not connected in this runtime")

    _set_task(task_id, {"stage": "helpers_spawn", "progress_percent": 15, "eta_seconds": 160, "updated_at_ts": int(time.time())})
    await _wait_if_paused(task_id)
    spawned = auto_spawn_helpers_for_task(
        task_type=tt,
        task_id=task_id,
        title=str(task.get("title") or ""),
        description=str(task.get("description") or ""),
        created_by=str(task.get("requested_by") or "system@agent"),
    )
    result["helpers"] = spawned.get("helpers", [])
    _append_log(task_id, f"Spawned helpers: {len(result['helpers'])}")
    for h in result["helpers"]:
        _append_team_message(
            task_id,
            str(h.get("role") or "helper"),
            f"Я подключён как помощник '{h.get('name')}'. Цель: {h.get('goal')}",
            kind="join",
        )

    if tt == "docs-ingest":
        _queue_step(task_id, dev_queue, "discovery", "Источники собраны, передаю в backend на ингест.")
        ns = str(task.get("namespace") or "").strip() or "docs:yandex-market"
        urls = task.get("docs_urls") if isinstance(task.get("docs_urls"), list) else []
        paths = task.get("local_paths") if isinstance(task.get("local_paths"), list) else []
        q = str(task.get("validation_query") or "").strip() or "authorization"
        web_query = str(task.get("web_query") or "").strip()
        max_web_results = max(1, int(task.get("max_web_results") or 5))
        _set_task(task_id, {"stage": "docs_ingest", "namespace": ns, "progress_percent": 35, "eta_seconds": 120, "updated_at_ts": int(time.time())})
        await _wait_if_paused(task_id)
        _append_log(task_id, f"Docs ingest started for namespace: {ns}")
        _append_team_message(task_id, "analyst", f"Начинаю сбор документации в namespace {ns}.")

        discovered_urls: List[str] = []
        if (not urls) and web_query:
            _append_log(task_id, f"Web discovery query: {web_query}")
            _append_team_message(task_id, "analyst", f"Ищу релевантные ссылки по запросу: {web_query}")
            found = await discover_web_urls(web_query, limit=max_web_results)
            discovered_urls = found.get("urls", []) if isinstance(found.get("urls"), list) else []
            urls = discovered_urls
            _append_log(task_id, f"Web discovered URLs: {len(discovered_urls)}")
            _append_team_message(task_id, "analyst", f"Нашёл ссылок: {len(discovered_urls)}")

        ingested_urls: List[Dict[str, Any]] = []
        for u in urls:
            await _wait_if_paused(task_id)
            su = str(u or "").strip()
            if not su:
                continue
            _append_log(task_id, f"Ingest URL: {su}")
            _append_team_message(task_id, "backend_dev", f"Загружаю документацию: {su}")
            try:
                ingested_urls.append(await ingest_url_to_knowledge(namespace=ns, url=su, title=f"API Docs: {su}"))
            except Exception as e:
                ingested_urls.append({"ok": False, "url": su, "error": str(e)})
                _append_log(task_id, f"Ingest URL failed: {e}")
                _append_team_message(task_id, "backend_dev", f"Ошибка загрузки URL: {e}", kind="error")

        ingested_files: List[Dict[str, Any]] = []
        for p in paths:
            sp = str(p or "").strip()
            if not sp:
                continue
            _append_log(task_id, f"Ingest file: {sp}")
            try:
                ingested_files.append(ingest_local_markdown_file(namespace=ns, path=sp, title=f"API Docs: {sp}"))
            except Exception as e:
                ingested_files.append({"ok": False, "path": sp, "error": str(e)})
                _append_log(task_id, f"Ingest file failed: {e}")
        _queue_step(task_id, dev_queue, "ingest", "Ингест завершен, передаю в QA на проверку индекса.")

        _set_task(task_id, {"stage": "docs_validate", "progress_percent": 75, "eta_seconds": 45, "updated_at_ts": int(time.time())})
        await _wait_if_paused(task_id)
        _append_log(task_id, f"Validating docs index with query: {q}")
        _append_team_message(task_id, "qa", f"Проверяю индекс знаний по запросу: {q}")
        try:
            hits = search_knowledge(ns, q, limit=5)
        except Exception as e:
            hits = {"hits": [], "error": str(e)}
            _append_log(task_id, f"Search knowledge failed: {e}")
        try:
            sources = list_knowledge(ns, limit=50)
        except Exception as e:
            sources = {"sources": [], "error": str(e)}
            _append_log(task_id, f"List knowledge failed: {e}")
        result.update(
            {
                "namespace": ns,
                "ingested_urls": ingested_urls,
                "ingested_files": ingested_files,
                "validation_query": q,
                "validation_hits": hits.get("hits", []),
                "sources_count": len(sources.get("sources", [])),
                "discovered_urls": discovered_urls,
            }
        )
        _queue_step(task_id, dev_queue, "validate", "Проверка индекса завершена, передаю PM на отчёт.")
        _queue_step(task_id, dev_queue, "handoff", "Финальный отчёт сформирован.")
    else:
        workspace_root = "/mnt/data/Pimv3"
        _queue_step(task_id, dev_queue, "analysis", "Анализ завершен, передаю в разработку.")
        if not ai_key:
            _set_task(task_id, {"status": "failed", "stage": "failed_no_ai_key", "updated_at_ts": int(time.time())})
            _append_log(task_id, "Execution failed: AI key is missing")
            _append_team_message(task_id, "project_manager", "Не могу выполнить задачу: не настроен AI ключ.", kind="error")
            return {"ok": False, "error": "ai_key_missing", "task_id": task_id}
        if not _git_is_clean(workspace_root):
            _set_task(task_id, {"status": "failed", "stage": "failed_dirty_worktree", "updated_at_ts": int(time.time())})
            _append_log(task_id, "Execution blocked: git working tree is not clean")
            _append_team_message(task_id, "project_manager", "Остановлено: рабочее дерево git не чистое.", kind="error")
            return {"ok": False, "error": "dirty_worktree", "task_id": task_id}

        # [FIX-4] Захватываем Redis-лок — один агент работает с git одновременно
        if not _acquire_git_lock(task_id):
            owner = _redis.get(_GIT_LOCK_KEY) or "unknown"
            _set_task(task_id, {"status": "failed", "stage": "failed_git_lock", "updated_at_ts": int(time.time())})
            _append_log(task_id, f"Git lock busy, held by task {owner}")
            _append_team_message(task_id, "project_manager", f"Другая задача ({owner}) сейчас работает с репозиторием. Попробуй позже.", kind="error")
            return {"ok": False, "error": "git_lock_busy", "lock_owner": owner}

        _append_log(task_id, f"Git lock acquired by {task_id}")

        _set_task(task_id, {"stage": "execution_branch", "progress_percent": 25, "eta_seconds": 240, "updated_at_ts": int(time.time())})
        await _wait_if_paused(task_id)
        br = create_incident_branch(workspace_root, task_id)
        _append_log(task_id, f"Branch: {json.dumps(br, ensure_ascii=False)[:700]}")
        _append_team_message(task_id, "backend_dev", "Создаю рабочую git-ветку под задачу.")
        if not br.get("ok"):
            _set_task(task_id, {"status": "failed", "stage": "failed_branch", "updated_at_ts": int(time.time())})
            return {"ok": False, "error": "branch_failed", "detail": br}

        allowlist = _allowlist_for_task_type(tt, workspace_root)
        _set_task(task_id, {"stage": "execution_retrieve_context", "progress_percent": 30, "eta_seconds": 225, "updated_at_ts": int(time.time())})
        await _wait_if_paused(task_id)
        know = _retrieve_knowledge_context(tt, str(task.get("title") or ""), str(task.get("description") or ""))
        result["knowledge_context"] = know
        _append_team_message(task_id, "analyst", f"Подтянул контекст из базы знаний, источников: {int(know.get('hits_total') or 0)}")
        rewrite_plan = {
            "summary": {
                "task_type": tt,
                "title": str(task.get("title") or ""),
                "description": str(task.get("description") or ""),
                "knowledge_query": know.get("query"),
                "knowledge_hits_total": int(know.get("hits_total") or 0),
            },
            "hypotheses": [
                {
                    "problem_type": f"agent_task:{tt}",
                    "count": 1,
                    "proposed_change": str(task.get("description") or ""),
                }
            ],
            "knowledge_hits": know.get("hits_by_namespace", {}),
        }

        _set_task(task_id, {"stage": "execution_patch_proposal", "progress_percent": 40, "eta_seconds": 210, "updated_at_ts": int(time.time())})
        await _wait_if_paused(task_id)
        _append_team_message(task_id, "backend_dev", "Генерирую патч кода по задаче.")
        proposal = await generate_code_patch_proposal(ai_config=ai_key, rewrite_plan=rewrite_plan, allowlist_files=allowlist)
        result["proposal"] = proposal
        if not proposal.get("ok"):
            _set_task(task_id, {"status": "failed", "stage": "failed_patch_proposal", "updated_at_ts": int(time.time()), "result": result})
            _append_log(task_id, f"Patch proposal failed: {proposal.get('error')}")
            _append_team_message(task_id, "backend_dev", "Не удалось сгенерировать патч.", kind="error")
            return {"ok": False, "error": "patch_proposal_failed", "proposal": proposal}

        prop = proposal.get("proposal", {}) if isinstance(proposal.get("proposal"), dict) else {}
        applied_directly = bool(prop.get("applied_directly"))
        patch_text = str(prop.get("patch_unified_diff") or "")
        changed_files = prop.get("affected_files", []) if isinstance(prop.get("affected_files"), list) else []

        if applied_directly:
            # ReAct-агент уже записал файлы напрямую — пропускаем apply
            _append_log(task_id, f"ReAct agent applied changes directly to {len(changed_files)} file(s), skipping patch apply step")
            _append_team_message(task_id, "backend_dev", f"Агент применил изменения напрямую ({len(changed_files)} файлов).")
            result["apply_patch"] = {"ok": True, "applied_directly": True}
        elif not patch_text.strip():
            _set_task(task_id, {"status": "failed", "stage": "failed_empty_patch", "updated_at_ts": int(time.time()), "result": result})
            _append_log(task_id, "Patch proposal returned empty patch")
            return {"ok": False, "error": "empty_patch"}
        else:
            _set_task(task_id, {"stage": "execution_apply_patch", "progress_percent": 55, "eta_seconds": 170, "updated_at_ts": int(time.time())})
            await _wait_if_paused(task_id)
            _append_team_message(task_id, "backend_dev", "Применяю изменения к репозиторию.")

            # [FIX-1] Stash перед применением — чтобы можно было откатиться
            stash_result = _git_stash(workspace_root)
            _append_log(task_id, f"Git stash before patch: ok={stash_result.get('ok')}")

            ap = _apply_unified_diff(workspace_root, patch_text)
            result["apply_patch"] = ap
            _append_log(task_id, f"Apply patch result: ok={ap.get('ok')}")
            if not ap.get("ok"):
                # Откатываем stash
                _git_stash_pop(workspace_root)
                _release_git_lock(task_id)
                _set_task(task_id, {"status": "failed", "stage": "failed_apply_patch", "updated_at_ts": int(time.time()), "result": result})
                return {"ok": False, "error": "apply_patch_failed", "apply": ap}
        _set_task(task_id, {"stage": "execution_tests", "progress_percent": 68, "eta_seconds": 130, "updated_at_ts": int(time.time())})
        await _wait_if_paused(task_id)
        _queue_step(task_id, dev_queue, "implement", "Разработка завершена, передаю в QA.")
        _append_team_message(task_id, "qa", "Запускаю тесты.")
        tests = run_tests(workspace_root)
        result["tests"] = tests
        _append_log(task_id, f"Tests: ok={tests.get('ok')}")

        _set_task(task_id, {"stage": "execution_quality_gate", "progress_percent": 80, "eta_seconds": 95, "updated_at_ts": int(time.time())})
        await _wait_if_paused(task_id)
        _append_team_message(task_id, "qa", "Проверяю quality gate и сборку.")
        gate = run_quality_gate(workspace_root=workspace_root, changed_files=changed_files, run_frontend_build=(tt == "design"))
        result["quality_gate"] = gate
        _append_log(task_id, f"Quality gate: ok={gate.get('ok')}")

        if not tests.get("ok") or not gate.get("ok"):
            # [FIX-1] Откатываем изменения через stash pop
            _append_team_message(task_id, "qa", "Тесты или quality gate упали — откатываю изменения.", kind="error")
            _git_reset_hard(workspace_root)
            pop = _git_stash_pop(workspace_root)
            _append_log(task_id, f"Rollback via stash pop: ok={pop.get('ok')}")
            _release_git_lock(task_id)
            _set_task(task_id, {"status": "failed", "stage": "failed_tests_or_gate", "updated_at_ts": int(time.time()), "result": result})
            return {"ok": False, "error": "tests_or_gate_failed", "result": result}
        _queue_step(task_id, dev_queue, "test", "Тесты и quality gate пройдены, передаю PM на релиз.")

        _set_task(task_id, {"stage": "execution_commit", "progress_percent": 88, "eta_seconds": 70, "updated_at_ts": int(time.time())})
        await _wait_if_paused(task_id)
        _append_team_message(task_id, "backend_dev", "Фиксирую изменения в git и пушу ветку.")
        cm = commit_all_changes(workspace_root, f"auto: agent task {task_id} ({tt})")
        result["git_commit"] = cm
        if not cm.get("ok"):
            _set_task(task_id, {"status": "failed", "stage": "failed_git_commit", "updated_at_ts": int(time.time()), "result": result})
            return {"ok": False, "error": "git_commit_failed", "detail": cm}

        branch = str(br.get("branch") or "")
        ps = push_branch(workspace_root, branch)
        result["git_push"] = ps
        _append_log(task_id, f"Git push: ok={ps.get('ok')}")
        if not ps.get("ok"):
            _set_task(task_id, {"status": "failed", "stage": "failed_git_push", "updated_at_ts": int(time.time()), "result": result})
            return {"ok": False, "error": "git_push_failed", "detail": ps}

        _set_task(task_id, {"stage": "execution_pr", "progress_percent": 95, "eta_seconds": 30, "updated_at_ts": int(time.time())})
        await _wait_if_paused(task_id)
        _append_team_message(task_id, "project_manager", "Открываю Pull Request с результатом.")
        pr = await create_pull_request(
            head_branch=branch,
            base_branch="main",
            title=f"auto: agent task {task_id} ({tt})",
            body=f"Auto-generated execution for task `{task_id}`\n\nType: `{tt}`\nTitle: {task.get('title') or ''}",
            workspace_root=workspace_root,
        )
        result["github_pr"] = pr
        _append_log(task_id, f"PR create: ok={pr.get('ok')} url={pr.get('pr_url', '')}")
        _queue_step(task_id, dev_queue, "release", "PR сформирован и передан на ревью.")

    _set_task(
        task_id,
        {
            "status": "completed",
            "stage": "completed",
            "control_state": "running",
            "progress_percent": 100,
            "eta_seconds": 0,
            "updated_at_ts": int(time.time()),
            "result": result,
        },
    )
    _release_git_lock(task_id)  # [FIX-4] освобождаем лок при успехе
    _append_log(task_id, "Task completed")
    _append_team_message(task_id, "project_manager", "Задача завершена. Отчёт и логи готовы.", kind="done")

    # Сохраняем успешный кейс в память агента для будущих задач
    try:
        from backend.services.agent_memory import get_agent_memory
        mem = get_agent_memory()
        mem.add_case(
            namespace=str(task.get("namespace") or "default"),
            sku=str(task_id),
            category_id=str(tt),
            problem_text=str(task.get("description") or task.get("title") or "")[:500],
            action_summary=str(rewrite_plan or "")[:500],
            result_status="success",
            metadata={"task_type": tt, "changed_files": changed_files},
        )
        _append_log(task_id, "Saved success case to agent memory")
    except Exception as _mem_err:
        _append_log(task_id, f"Memory save skipped: {_mem_err}")

    return {"ok": True, "task_id": task_id, "result": result}


def run_agent_task_in_background(task_id: str, ai_key: str = "") -> None:
    try:
        asyncio.run(run_agent_task(task_id, ai_key=ai_key))
    except Exception as e:
        _release_git_lock(task_id)  # [FIX-4] освобождаем лок при любом падении
        _set_task(
            task_id,
            {
                "status": "failed",
                "stage": "failed",
                "updated_at_ts": int(time.time()),
                "result": {"error": str(e)},
            },
        )
        _append_log(task_id, f"Task failed: {e}")

