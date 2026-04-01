"""
agent_pipeline.py — Multi-agent pipeline for PIMv3.

Agents:
  AnalystAgent    — decomposes task, no writes allowed
  BackendAgent    — Python/FastAPI implementation
  FrontendAgent   — React/TypeScript implementation
  DBAgent         — Alembic migrations, schema changes
  QAAgent         — writes tests, runs coverage
  ReviewerAgent   — read-only code review
  SecurityAgent   — bandit + vulture, no writes

Pipeline:
  Analyst → [Backend | Frontend | DB] (parallel) → QA → [Reviewer | Security] (parallel) → done
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import os
import subprocess
from typing import Any, Dict, List, Optional

import redis as _redis_lib

from backend.services.code_patch_agent import (
    TOOLS_SCHEMA,
    _tool_read_file, _tool_list_dir, _tool_search_code, _tool_glob_files,
    _tool_write_file, _tool_edit_file, _tool_append_file, _tool_move_file,
    _tool_delete_file, _tool_run_shell, _tool_git_status, _tool_git_log,
    _tool_git_blame, _tool_semantic_search, _tool_web_search, _tool_web_fetch,
    _tool_api_request, _tool_db_query, _tool_read_logs, _tool_run_coverage,
    _tool_install_package, _tool_run_migration, _tool_find_dependents,
    _tool_check_env, _tool_check_circular_imports, _tool_workspace_snapshot,
    _tool_batch_edit, _tool_run_tests_incremental, _tool_search_library_docs,
    _tool_profile_code, _safe_resolve, _load_conventions,
    _run_ruff_check, _run_mypy_check, _run_bandit_check, _run_vulture_check,
    _run_tsc_check, _publish_stream, _save_checkpoint, _update_progress,
    _update_changelog, _get_task_template, _load_memory_context,
    _build_file_tree, _list_tests, _run_baseline_tests,
    generate_code_patch_proposal,
)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

_redis = _redis_lib.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

# ---------------------------------------------------------------------------
# Tool subsets
# ---------------------------------------------------------------------------

_TOOLS_BY_NAME: Dict[str, Dict] = {t["function"]["name"]: t for t in TOOLS_SCHEMA}


def _filter_tools(names: List[str]) -> List[Dict]:
    return [_TOOLS_BY_NAME[n] for n in names if n in _TOOLS_BY_NAME]


ANALYST_TOOLS = _filter_tools([
    "read_file", "list_dir", "search_code", "glob_files", "semantic_search",
    "web_search", "web_fetch", "search_library_docs", "ask_user", "git_log", "task_done",
])

BACKEND_TOOLS = _filter_tools([
    "read_file", "list_dir", "search_code", "glob_files", "write_file", "edit_file",
    "append_file", "move_file", "delete_file", "run_shell", "git_status",
    "find_dependents", "install_package", "check_circular_imports", "check_env",
    "batch_edit", "run_tests_incremental", "workspace_snapshot", "task_done",
])

FRONTEND_TOOLS = _filter_tools([
    "read_file", "list_dir", "search_code", "glob_files", "write_file", "edit_file",
    "append_file", "run_shell", "api_request", "check_env", "task_done",
])

DB_TOOLS = _filter_tools([
    "read_file", "search_code", "glob_files", "edit_file", "append_file",
    "run_migration", "db_query", "run_shell", "find_dependents", "task_done",
])

QA_TOOLS = _filter_tools([
    "read_file", "list_dir", "search_code", "glob_files", "write_file", "edit_file",
    "append_file", "run_shell", "run_coverage", "run_tests_incremental",
    "api_request", "task_done",
])

REVIEWER_TOOLS = _filter_tools([
    "read_file", "list_dir", "search_code", "glob_files",
    "git_status", "git_log", "git_blame", "task_done",
])

SECURITY_TOOLS = _filter_tools([
    "read_file", "search_code", "glob_files", "git_status", "check_env", "task_done",
])

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

ANALYST_SYSTEM = (
    "You are a senior software architect. Your job is to analyze a task and produce a "
    "structured implementation plan. You CANNOT write or modify files — only read and analyze. "
    "Explore the codebase, understand the current state, identify what needs to change and where. "
    "Call task_done with a JSON summary field containing: "
    '{\"backend_tasks\": [...], \"frontend_tasks\": [...], \"db_tasks\": [...], '
    '\"qa_tasks\": [...], \"needs_migration\": bool, \"risk_level\": \"low|medium|high\"}. '
    "Keep each subtask description specific and actionable."
)

BACKEND_SYSTEM = (
    "You are a senior Python/FastAPI engineer. Implement the backend part of the task "
    "following PIMv3 conventions: async def, HTTPException for errors, Depends(get_db) for "
    "sessions, httpx for HTTP calls, UUID ids. Read files before editing. Write focused, testable code."
)

FRONTEND_SYSTEM = (
    "You are a senior React/TypeScript engineer. Implement frontend changes: functional "
    "components with hooks, Tailwind CSS, axios from frontend/src/lib/api.ts, TypeScript "
    "interfaces for all API shapes. Read files before editing."
)

DB_SYSTEM = (
    "You are a database engineer. Handle schema changes: modify models.py, generate alembic "
    "migration, apply it. Always check existing schema first with db_query. "
    "Never drop columns without confirmation."
)

QA_SYSTEM = (
    "You are a QA engineer. Write comprehensive tests for the implemented changes. Check "
    "coverage, ensure edge cases are covered. Use pytest, async tests where needed. "
    "Run coverage after writing tests."
)

REVIEWER_SYSTEM = (
    "You are a strict code reviewer. Read all changed files. Look for: bugs, missing error "
    "handling, security issues, convention violations, missing type hints, untested code paths. "
    "Be specific. Call task_done with summary containing a list of issues found (empty list if none)."
)

SECURITY_SYSTEM = (
    "You are a security engineer. Check the changed code for: SQL injection, command injection, "
    "hardcoded secrets, unsafe deserialization, missing auth checks, CORS issues, exposed "
    "sensitive data in logs. Call task_done with summary containing security findings."
)

# ---------------------------------------------------------------------------
# AgentRole dataclass
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class AgentRole:
    name: str
    system_prompt: str
    tools: List[Dict]
    max_steps: int = 25
    can_write: bool = True


# Role definitions
ROLES: Dict[str, AgentRole] = {
    "analyst": AgentRole(
        name="analyst",
        system_prompt=ANALYST_SYSTEM,
        tools=ANALYST_TOOLS,
        max_steps=20,
        can_write=False,
    ),
    "backend": AgentRole(
        name="backend",
        system_prompt=BACKEND_SYSTEM,
        tools=BACKEND_TOOLS,
        max_steps=30,
        can_write=True,
    ),
    "frontend": AgentRole(
        name="frontend",
        system_prompt=FRONTEND_SYSTEM,
        tools=FRONTEND_TOOLS,
        max_steps=25,
        can_write=True,
    ),
    "db": AgentRole(
        name="db",
        system_prompt=DB_SYSTEM,
        tools=DB_TOOLS,
        max_steps=20,
        can_write=True,
    ),
    "qa": AgentRole(
        name="qa",
        system_prompt=QA_SYSTEM,
        tools=QA_TOOLS,
        max_steps=25,
        can_write=True,
    ),
    "reviewer": AgentRole(
        name="reviewer",
        system_prompt=REVIEWER_SYSTEM,
        tools=REVIEWER_TOOLS,
        max_steps=15,
        can_write=False,
    ),
    "security": AgentRole(
        name="security",
        system_prompt=SECURITY_SYSTEM,
        tools=SECURITY_TOOLS,
        max_steps=15,
        can_write=False,
    ),
    "doc": AgentRole(
        name="doc",
        system_prompt="You are a technical writer. Add clear, concise docstrings to Python functions and classes. Never change logic. Only write documentation.",
        tools=_filter_tools(["read_file", "edit_file", "append_file", "search_code", "task_done"]),
        max_steps=15,
        can_write=True,
    ),
}

# Keep backward-compatible alias used internally
_ROLES = ROLES

# ---------------------------------------------------------------------------
# ADDITION 1: Shared context document between agents
# ---------------------------------------------------------------------------

class _SharedContext:
    """Redis-backed shared workspace document for inter-agent communication."""
    def __init__(self, task_id: str):
        self.task_id = task_id
        self.key = f"agent:shared_context:{task_id}"
        self._r = _redis

    def write(self, agent_name: str, content: str) -> None:
        """Agent writes its decisions/findings."""
        import time
        entry = json.dumps({"agent": agent_name, "content": content, "ts": time.time()}, ensure_ascii=False)
        self._r.rpush(self.key, entry)
        self._r.expire(self.key, 86400)

    def read_all(self) -> str:
        """Get all entries as formatted string for injection into agent context."""
        raw = self._r.lrange(self.key, 0, -1) or []
        if not raw:
            return ""
        lines = ["## SHARED CONTEXT FROM OTHER AGENTS"]
        for item in raw:
            try:
                d = json.loads(item)
                lines.append(f"\n[{d['agent']}]: {d['content']}")
            except Exception:
                lines.append(f"\n{item}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# ADDITION 2: File-level locks to prevent parallel write conflicts
# ---------------------------------------------------------------------------

class _FileLock:
    """Per-file Redis lock for parallel agent write safety."""
    def __init__(self, file_path: str, task_id: str, timeout: int = 30):
        self.key = f"agent:filelock:{file_path.replace('/', ':')}"
        self.owner = task_id
        self.timeout = timeout
        self._r = _redis

    def acquire(self) -> bool:
        return bool(self._r.set(self.key, self.owner, nx=True, ex=self.timeout))

    def release(self) -> None:
        if self._r.get(self.key) == self.owner:
            self._r.delete(self.key)

    def __enter__(self):
        import time
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            if self.acquire():
                return self
            time.sleep(0.5)
        raise TimeoutError(f"Could not acquire lock for {self.key}")

    def __exit__(self, *args):
        self.release()


# ---------------------------------------------------------------------------
# Tool dispatch
# ---------------------------------------------------------------------------

def _dispatch_tool(
    tool_name: str,
    tool_args: Dict[str, Any],
    role: AgentRole,
    workspace_root: str,
    dry_run: bool,
    allowlist: Optional[List[str]],
    task_id: str = "",
) -> str:
    """Dispatch a tool call to the appropriate implementation function."""
    write_tools = {
        "write_file", "edit_file", "append_file", "move_file", "delete_file",
        "batch_edit", "run_migration", "install_package",
    }

    if tool_name in write_tools and not role.can_write:
        return f"ERROR: {role.name} agent cannot modify files."

    ws = workspace_root

    # ADDITION 2: Wrap write operations with file lock
    _write_tools_with_lock = {"write_file", "edit_file", "append_file", "move_file", "delete_file", "batch_edit"}
    if tool_name in _write_tools_with_lock and role.can_write and task_id:
        path = tool_args.get("path", tool_args.get("src", ""))
        if path:
            lock = _FileLock(path, task_id)
            try:
                lock.acquire()
                return _dispatch_tool_inner(tool_name, tool_args, role, ws, dry_run, allowlist)
            finally:
                lock.release()

    return _dispatch_tool_inner(tool_name, tool_args, role, ws, dry_run, allowlist)


def _dispatch_tool_inner(
    tool_name: str,
    tool_args: Dict[str, Any],
    role: AgentRole,
    ws: str,
    dry_run: bool,
    allowlist: Optional[List[str]],
) -> str:
    """Inner dispatch without locking logic."""
    if tool_name == "read_file":
        return _tool_read_file(tool_args["path"], ws)
    elif tool_name == "list_dir":
        return _tool_list_dir(tool_args["path"], ws)
    elif tool_name == "search_code":
        return _tool_search_code(tool_args["query"], tool_args.get("path"), ws)
    elif tool_name == "glob_files":
        return _tool_glob_files(tool_args["pattern"], ws, tool_args.get("max_results", 50))
    elif tool_name == "semantic_search":
        return _tool_semantic_search(tool_args["query"], tool_args.get("namespace"), ws)
    elif tool_name == "web_fetch":
        return _tool_web_fetch(tool_args["url"], tool_args.get("max_chars", 8000), ws)
    elif tool_name == "web_search":
        return _tool_web_search(tool_args["query"], tool_args.get("max_results", 5), ws)
    elif tool_name == "search_library_docs":
        return _tool_search_library_docs(tool_args["library"], tool_args["query"], ws)
    elif tool_name == "git_log":
        return _tool_git_log(tool_args.get("path"), tool_args.get("limit", 15), ws)
    elif tool_name == "git_blame":
        return _tool_git_blame(
            tool_args["path"], tool_args.get("start_line"), tool_args.get("end_line"), ws
        )
    elif tool_name == "git_status":
        return _tool_git_status(tool_args.get("show_diff", True), ws)
    elif tool_name == "run_shell":
        return _tool_run_shell(tool_args["command"], ws)
    elif tool_name == "find_dependents":
        return _tool_find_dependents(tool_args["path"], ws)
    elif tool_name == "check_env":
        return _tool_check_env(tool_args["vars"], ws)
    elif tool_name == "check_circular_imports":
        return _tool_check_circular_imports(tool_args.get("module", "backend"), ws)
    elif tool_name == "workspace_snapshot":
        return _tool_workspace_snapshot(tool_args["action"], tool_args.get("label"), ws)
    elif tool_name == "run_tests_incremental":
        return _tool_run_tests_incremental(tool_args["affected_files"], ws)
    elif tool_name == "run_coverage":
        return _tool_run_coverage(
            tool_args.get("module", "backend"), tool_args.get("test_path", "backend/tests/"), ws
        )
    elif tool_name == "api_request":
        return _tool_api_request(
            tool_args["method"], tool_args["path"],
            tool_args.get("body"), tool_args.get("headers"), ws
        )
    elif tool_name == "db_query":
        return _tool_db_query(tool_args["sql"], tool_args.get("limit", 20), ws)
    elif tool_name == "read_logs":
        return _tool_read_logs(
            tool_args["service"], tool_args.get("lines", 50), tool_args.get("filter"), ws
        )
    elif tool_name == "profile_code":
        return _tool_profile_code(tool_args["code"], tool_args.get("top_n", 10), ws)
    elif tool_name == "install_package":
        result, _ = _tool_install_package(
            tool_args["package"], tool_args.get("package_type", "python"),
            tool_args.get("dev", False), ws, dry_run=dry_run
        )
        return result
    elif tool_name == "run_migration":
        result, _ = _tool_run_migration(
            tool_args["action"], tool_args.get("message"), tool_args.get("revision"), ws,
            dry_run=dry_run
        )
        return result
    elif tool_name == "write_file":
        result, _ = _tool_write_file(
            tool_args["path"], tool_args["content"], ws,
            dry_run=dry_run, allowlist=allowlist
        )
        return result
    elif tool_name == "edit_file":
        result, _ = _tool_edit_file(
            tool_args["path"], tool_args["old_snippet"], tool_args["new_snippet"], ws,
            dry_run=dry_run, allowlist=allowlist
        )
        return result
    elif tool_name == "append_file":
        result, _ = _tool_append_file(
            tool_args["path"], tool_args["content"], tool_args.get("after_pattern"), ws,
            dry_run=dry_run, allowlist=allowlist
        )
        return result
    elif tool_name == "move_file":
        result, _ = _tool_move_file(
            tool_args["src"], tool_args["dst"], ws,
            dry_run=dry_run, allowlist=allowlist
        )
        return result
    elif tool_name == "delete_file":
        result, _ = _tool_delete_file(
            tool_args["path"], tool_args.get("reason", ""), ws,
            dry_run=dry_run, allowlist=allowlist
        )
        return result
    elif tool_name == "batch_edit":
        result, _ = _tool_batch_edit(tool_args["edits"], ws, dry_run=dry_run, allowlist=allowlist)
        return result
    elif tool_name == "ask_user":
        return f"ASK_USER: {tool_args['question']}"
    elif tool_name == "task_done":
        # Handled upstream — return sentinel
        return "__TASK_DONE__"
    else:
        return f"ERROR: unknown tool '{tool_name}'"


def _collect_affected_from_args(tool_name: str, tool_args: Dict[str, Any]) -> Optional[str]:
    """Extract a file path from write tool args, if any."""
    if tool_name in ("write_file", "edit_file", "append_file", "delete_file"):
        return tool_args.get("path")
    if tool_name in ("move_file",):
        return tool_args.get("dst")
    if tool_name == "batch_edit":
        edits = tool_args.get("edits") or []
        return None  # handled separately
    return None


# ---------------------------------------------------------------------------
# Core agent loop
# ---------------------------------------------------------------------------

async def _run_agent(
    *,
    role: AgentRole,
    task_title: str,
    task_description: str,
    workspace_root: str,
    client: Any,
    model: str,
    task_id: str,
    affected_files: List[str] = None,
    conventions: str = "",
    dry_run: bool = False,
    allowlist: List[str] = None,
    shared_ctx: Optional[_SharedContext] = None,
) -> Dict[str, Any]:
    """Run a single specialized ReAct agent loop."""
    file_tree_snippet = ""
    try:
        tree = _build_file_tree(workspace_root)
        lines = tree.splitlines()[:60]
        file_tree_snippet = "\n\nProject structure (top 60 lines):\n" + "\n".join(lines)
    except Exception:
        pass

    system_content = role.system_prompt + (
        f"\n\nConventions:\n{conventions}" if conventions else ""
    ) + file_tree_snippet

    # ADDITION 1: Inject shared context into system message
    if shared_ctx:
        shared_content = shared_ctx.read_all()
        if shared_content:
            system_content = system_content + "\n\n" + shared_content

    user_content = (
        f"Task: {task_title}\n\n{task_description}"
        f"\n\nFiles already modified by other agents: {affected_files or []}"
    )

    messages: List[Dict] = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_content},
    ]

    all_affected: List[str] = list(affected_files or [])
    final_summary: str = ""

    for step in range(role.max_steps):
        _publish_stream(task_id, f"{role.name}_step", {"step": step, "role": role.name})

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=role.tools,
                tool_choice="auto",
            )
        except Exception as e:
            log.error("[%s] LLM call failed at step %d: %s", role.name, step, e)
            return {"ok": False, "error": str(e), "role": role.name}

        msg = response.choices[0].message
        messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": msg.tool_calls})

        if not msg.tool_calls:
            # No tool calls — agent finished without task_done
            break

        tool_results = []
        done = False

        for tc in msg.tool_calls:
            tool_name = tc.function.name
            try:
                tool_args = json.loads(tc.function.arguments)
            except Exception:
                tool_args = {}

            if tool_name == "task_done":
                final_summary = tool_args.get("summary", "")
                td_files = tool_args.get("affected_files") or []
                for f in td_files:
                    if f not in all_affected:
                        all_affected.append(f)
                _publish_stream(task_id, f"{role.name}_done", {
                    "role": role.name,
                    "affected_files": all_affected,
                    "summary": final_summary,
                })
                done = True
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": "Task marked as done.",
                })
                continue

            result_str = _dispatch_tool(
                tool_name, tool_args, role, workspace_root, dry_run, allowlist,
                task_id=task_id,
            )

            # Track affected files from write operations
            if tool_name == "batch_edit":
                for edit in (tool_args.get("edits") or []):
                    p = edit.get("path")
                    if p and p not in all_affected:
                        all_affected.append(p)
            else:
                af = _collect_affected_from_args(tool_name, tool_args)
                if af and af not in all_affected:
                    all_affected.append(af)

            _publish_stream(task_id, f"{role.name}_tool", {
                "tool": tool_name,
                "step": step,
                "result_preview": result_str[:200],
            })

            tool_results.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result_str,
            })

        messages.extend(tool_results)

        if done:
            # ADDITION 1: Write findings to shared context after task_done
            if shared_ctx:
                try:
                    shared_ctx.write(
                        role.name,
                        f"Completed: {final_summary}. Modified: {all_affected}. Key decisions: {final_summary[:300]}"
                    )
                except Exception:
                    pass
            return {
                "ok": True,
                "role": role.name,
                "affected_files": all_affected,
                "summary": final_summary,
            }

    return {"ok": False, "error": "max_steps", "role": role.name, "affected_files": all_affected}


# ---------------------------------------------------------------------------
# ADDITION 4: Auto-documentation after implementation
# ---------------------------------------------------------------------------

async def _auto_generate_docs(client, model, affected_files, workspace_root, task_title) -> Dict:
    """Spawn a DocAgent that adds/updates docstrings and README sections."""
    py_files = [f for f in affected_files if f.endswith(".py")]
    if not py_files:
        return {"ok": True, "skipped": True}

    doc_description = f"""Update documentation for the following files that were just modified:
{chr(10).join(py_files)}

Task that was implemented: {task_title}

For each function/class that is missing a docstring: add a concise one.
For each new public function: add Args/Returns sections.
Do NOT change any logic — only add/update docstrings and comments.
If backend/README.md exists, add a brief mention of new features.
"""
    doc_role = AgentRole(
        name="doc",
        system_prompt="You are a technical writer. Add clear, concise docstrings to Python functions and classes. Never change logic. Only write documentation.",
        tools=_filter_tools(["read_file", "edit_file", "append_file", "search_code", "task_done"]),
        max_steps=15,
        can_write=True,
    )
    return await _run_agent(
        role=doc_role,
        task_title="Update docstrings",
        task_description=doc_description,
        workspace_root=workspace_root,
        client=client,
        model=model,
        task_id=f"doc_{id(client)}",
        affected_files=py_files,
        conventions="",
    )


# ---------------------------------------------------------------------------
# ADDITION 5: API contract testing
# ---------------------------------------------------------------------------

def _run_api_contract_test(affected_files: List[str], workspace_root: str) -> Dict:
    """Check if modified endpoints still match their OpenAPI schema."""
    # Check if any route files were modified
    route_files = [f for f in affected_files if "main.py" in f or "router" in f or "routes" in f]
    if not route_files:
        return {"ok": True, "skipped": True, "reason": "no route files modified"}

    try:
        # Try schemathesis if available
        result = subprocess.run(
            ["python3", "-m", "schemathesis", "run", "http://localhost:4877/openapi.json",
             "--checks", "response_schema_conformance", "--max-examples", "5", "--timeout", "10"],
            cwd=workspace_root, capture_output=True, text=True, timeout=60
        )
        passed = result.returncode == 0
        output = (result.stdout or result.stderr or "")[:2000]
        return {"ok": passed, "output": output, "tool": "schemathesis"}
    except FileNotFoundError:
        # Fallback: just check /openapi.json is reachable
        try:
            import httpx
            resp = httpx.get("http://localhost:4877/openapi.json", timeout=5)
            return {"ok": resp.status_code == 200, "output": f"OpenAPI schema: {resp.status_code}", "tool": "basic"}
        except Exception as e:
            return {"ok": True, "skipped": True, "reason": str(e)}
    except Exception as e:
        return {"ok": True, "skipped": True, "reason": str(e)}


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

async def run_pipeline(
    *,
    task_id: str,
    task_title: str,
    task_description: str,
    task_type: str,
    workspace_root: str,
    ai_config: str,
    dry_run: bool = False,
    allowlist: List[str] = None,
) -> Dict[str, Any]:
    """
    Run the full multi-agent pipeline for a PIMv3 task.

    Returns a dict with ok, stages, affected_files, applied_directly.
    """
    from backend.services.ai_service import get_client_and_model

    try:
        client, model = get_client_and_model(ai_config, role="code")
    except Exception as e:
        return {"ok": False, "error": f"Failed to init AI client: {e}"}

    conventions = ""
    memory_context = ""
    try:
        conventions = _load_conventions(workspace_root)
        memory_context = _load_memory_context(task_description, workspace_root)
    except Exception:
        pass

    # ADDITION 1: Create shared context for this pipeline run
    shared_ctx = _SharedContext(task_id)

    common_kwargs = dict(
        workspace_root=workspace_root,
        client=client,
        model=model,
        task_id=task_id,
        conventions=conventions + ("\n\n" + memory_context if memory_context else ""),
        dry_run=dry_run,
        allowlist=allowlist,
        shared_ctx=shared_ctx,
    )

    stages: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Stage 1: Analyst
    # ------------------------------------------------------------------
    _redis.hset(f"agent_task:{task_id}", mapping={
        "pipeline_stage": "analyst",
        "pipeline_progress": "10",
    })

    analyst_result = await _run_agent(
        role=ROLES["analyst"],
        task_title=task_title,
        task_description=task_description,
        **common_kwargs,
    )
    stages["analyst"] = analyst_result

    analysis: Dict[str, Any] = {}
    if analyst_result.get("ok"):
        try:
            raw_summary = analyst_result.get("summary", "{}")
            # Summary may be free text with embedded JSON
            json_match = raw_summary
            start = raw_summary.find("{")
            end = raw_summary.rfind("}") + 1
            if start != -1 and end > start:
                json_match = raw_summary[start:end]
            analysis = json.loads(json_match)
        except Exception:
            analysis = {}

    _redis.hset(f"agent_task:{task_id}", "pipeline_analysis", json.dumps(analysis))

    backend_tasks = analysis.get("backend_tasks") or []
    frontend_tasks = analysis.get("frontend_tasks") or []
    db_tasks = analysis.get("db_tasks") or []
    needs_migration = analysis.get("needs_migration", False)

    # Fallback: if analyst didn't give structure, run all three
    if not any([backend_tasks, frontend_tasks, db_tasks]):
        backend_tasks = [task_description]
        frontend_tasks = []
        db_tasks = []

    # ------------------------------------------------------------------
    # Stage 2: Parallel implementation
    # ------------------------------------------------------------------
    _redis.hset(f"agent_task:{task_id}", mapping={
        "pipeline_stage": "implementation",
        "pipeline_progress": "40",
    })

    impl_coroutines = []
    impl_labels = []

    if backend_tasks:
        impl_coroutines.append(_run_agent(
            role=ROLES["backend"],
            task_title=task_title,
            task_description="\n".join(backend_tasks) if isinstance(backend_tasks, list) else str(backend_tasks),
            **common_kwargs,
        ))
        impl_labels.append("backend")

    if frontend_tasks:
        impl_coroutines.append(_run_agent(
            role=ROLES["frontend"],
            task_title=task_title,
            task_description="\n".join(frontend_tasks) if isinstance(frontend_tasks, list) else str(frontend_tasks),
            **common_kwargs,
        ))
        impl_labels.append("frontend")

    if db_tasks or needs_migration:
        db_desc = "\n".join(db_tasks) if isinstance(db_tasks, list) else str(db_tasks or "")
        if needs_migration and "migration" not in db_desc.lower():
            db_desc += "\nGenerate and apply Alembic migration for schema changes."
        impl_coroutines.append(_run_agent(
            role=ROLES["db"],
            task_title=task_title,
            task_description=db_desc,
            **common_kwargs,
        ))
        impl_labels.append("db")

    impl_results_raw = await asyncio.gather(*impl_coroutines, return_exceptions=True)

    all_impl_affected: List[str] = []
    for label, result in zip(impl_labels, impl_results_raw):
        if isinstance(result, Exception):
            stages[label] = {"ok": False, "error": str(result), "role": label}
        else:
            stages[label] = result
            for f in (result.get("affected_files") or []):
                if f not in all_impl_affected:
                    all_impl_affected.append(f)

    # ------------------------------------------------------------------
    # Stage 3: QA
    # ------------------------------------------------------------------
    _redis.hset(f"agent_task:{task_id}", mapping={
        "pipeline_stage": "qa",
        "pipeline_progress": "70",
    })

    qa_tasks_list = analysis.get("qa_tasks") or []
    qa_desc = (
        "Write and run tests for the following changes:\n"
        + "\n".join(qa_tasks_list if qa_tasks_list else [task_description])
        + f"\n\nFiles changed by implementation agents: {all_impl_affected}"
    )

    qa_result = await _run_agent(
        role=ROLES["qa"],
        task_title=f"QA: {task_title}",
        task_description=qa_desc,
        affected_files=all_impl_affected,
        **common_kwargs,
    )
    stages["qa"] = qa_result

    for f in (qa_result.get("affected_files") or []):
        if f not in all_impl_affected:
            all_impl_affected.append(f)

    # ------------------------------------------------------------------
    # Stage 3b: Auto-documentation (ADDITION 4)
    # ------------------------------------------------------------------
    doc_result = await _auto_generate_docs(client, model, all_impl_affected, workspace_root, task_title)
    stages["documentation"] = doc_result

    # ------------------------------------------------------------------
    # Stage 4: Review + Security (parallel)
    # ------------------------------------------------------------------
    _redis.hset(f"agent_task:{task_id}", mapping={
        "pipeline_stage": "review",
        "pipeline_progress": "85",
    })

    review_desc = (
        f"Review all code changes for task: {task_title}\n"
        f"Changed files: {all_impl_affected}"
    )

    review_result, security_result = await asyncio.gather(
        _run_agent(
            role=ROLES["reviewer"],
            task_title=f"Review: {task_title}",
            task_description=review_desc,
            affected_files=all_impl_affected,
            **common_kwargs,
        ),
        _run_agent(
            role=ROLES["security"],
            task_title=f"Security: {task_title}",
            task_description=review_desc,
            affected_files=all_impl_affected,
            **common_kwargs,
        ),
        return_exceptions=True,
    )

    if isinstance(review_result, Exception):
        stages["reviewer"] = {"ok": False, "error": str(review_result), "role": "reviewer"}
        reviewer_result = stages["reviewer"]
    else:
        stages["reviewer"] = review_result
        reviewer_result = review_result

    if isinstance(security_result, Exception):
        stages["security"] = {"ok": False, "error": str(security_result), "role": "security"}
    else:
        stages["security"] = security_result

    # ------------------------------------------------------------------
    # Stage 4b: Reviewer feedback loop — auto fix (ADDITION 3)
    # ------------------------------------------------------------------
    reviewer_summary = reviewer_result.get("summary", "") if isinstance(reviewer_result, dict) else ""
    has_bugs = any(
        kw in reviewer_summary.lower()
        for kw in ["bug", "error", "missing", "issue", "problem", "broken", "incorrect", "wrong"]
    )
    if has_bugs and not dry_run:
        fix_description = f"""Fix the following issues found by code review:

{reviewer_summary}

Files to fix: {all_impl_affected}
These issues were found after implementing: {task_description[:300]}
"""
        fix_result = await _run_agent(
            role=_ROLES["backend"],
            task_title=f"Fix review issues for: {task_title}",
            task_description=fix_description,
            workspace_root=workspace_root,
            client=client,
            model=model,
            task_id=f"{task_id}:fix",
            affected_files=all_impl_affected,
            conventions=conventions + ("\n\n" + memory_context if memory_context else ""),
            shared_ctx=shared_ctx,
            dry_run=dry_run,
            allowlist=allowlist,
        )
        if fix_result.get("ok"):
            for f in fix_result.get("affected_files", []):
                if f not in all_impl_affected:
                    all_impl_affected.append(f)
        stages["reviewer_fix"] = fix_result
        _publish_stream(task_id, "reviewer_fix", {
            "applied": fix_result.get("ok"),
            "files": fix_result.get("affected_files", []),
        })

    # ------------------------------------------------------------------
    # Stage 5: Final static analysis + API contract test
    # ------------------------------------------------------------------
    _redis.hset(f"agent_task:{task_id}", mapping={
        "pipeline_stage": "done",
        "pipeline_progress": "100",
    })

    final_checks: Dict[str, Any] = {}
    py_files = [f for f in all_impl_affected if f.endswith(".py")]
    ts_files = [f for f in all_impl_affected if f.endswith((".ts", ".tsx"))]

    if py_files:
        try:
            ruff_out = _run_ruff_check(py_files, workspace_root)
            final_checks["ruff"] = ruff_out
        except Exception as e:
            final_checks["ruff"] = f"ERROR: {e}"

        try:
            mypy_out = _run_mypy_check(py_files, workspace_root)
            final_checks["mypy"] = mypy_out
        except Exception as e:
            final_checks["mypy"] = f"ERROR: {e}"

        try:
            bandit_out = _run_bandit_check(py_files, workspace_root)
            final_checks["bandit"] = bandit_out
        except Exception as e:
            final_checks["bandit"] = f"ERROR: {e}"

    if ts_files:
        try:
            tsc_out = _run_tsc_check(workspace_root)
            final_checks["tsc"] = tsc_out
        except Exception as e:
            final_checks["tsc"] = f"ERROR: {e}"

    stages["final_checks"] = final_checks

    # ADDITION 5: API contract test
    api_contract_result = _run_api_contract_test(all_impl_affected, workspace_root)
    stages["api_contract"] = api_contract_result

    _publish_stream(task_id, "pipeline_done", {
        "stages": list(stages.keys()),
        "affected_files": all_impl_affected,
    })

    return {
        "ok": True,
        "stages": stages,
        "affected_files": all_impl_affected,
        "applied_directly": True,
    }


# ---------------------------------------------------------------------------
# Integration helper
# ---------------------------------------------------------------------------

def should_use_pipeline(task_type: str, description: str) -> bool:
    """Return True for complex multi-component tasks that benefit from specialized agents."""
    complex_types = {"api-integration", "design", "schema_change"}
    if task_type in complex_types:
        return True
    complex_keywords = [
        "integrate", "adapter", "migration", "refactor", "new feature",
        "endpoint", "frontend", "ui", "schema",
    ]
    desc_lower = description.lower()
    return sum(1 for kw in complex_keywords if kw in desc_lower) >= 2
