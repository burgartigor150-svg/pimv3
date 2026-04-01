"""
code_patch_agent.py — ReAct Tool Loop агент для генерации кода. v7

Архитектура: LLM получает инструменты и работает в цикле до 40 шагов.
Полное соответствие возможностям Claude Code внутри проекта.

v7 новое (поверх v6):
  - [#1]  Extended shell whitelist — alembic, pip install, npm install, git log/blame/show/stash/diff
  - [#2]  install_package tool — pip/npm установка с обновлением requirements.txt / package.json
  - [#3]  run_migration tool — создание и применение Alembic миграций
  - [#4]  TypeScript check (tsc --noEmit) в task_done рядом с mypy
  - [#5]  git_log и git_blame tools — история и аннотации коммитов
  - [#6]  read_image tool — описание изображений через vision API
  - [#7]  Retry with reflection — при неудаче LLM рефлексирует и повторяет (max 2 retry)
  - [#8]  Resume from checkpoint — resume_from_checkpoint() + resume_task_id параметр
  - [#9]  Task templates — шаблоны планов для типовых задач (adapter/endpoint/celery/schema)
  - [#10] Reviewer agent — асинхронное код-ревью после успешного task_done

v6 (сохранено):
  - [#1]  Dry-run mode — dry_run=True не пишет на диск, возвращает preview
  - [#2]  Scope enforcement — allowlist проверяет пути всех write-операций
  - [#3]  find_dependents — найти все файлы, импортирующие данный модуль
  - [#4]  Mypy check — после ruff запускает mypy, ошибки репортятся в summary
  - [#5]  Task decomposition — LLM декомпозирует задачу на параллельные подзадачи
  - [#6]  Streaming via Redis pub/sub — события агента в реальном времени
  - [#7]  CHANGELOG update — автоматически обновляет CHANGELOG.md после task_done
  - [#8]  Token budget awareness — отслеживает токены, сжимает историю при лимите

v5 (сохранено):
  - [#1]  glob_files — поиск файлов по паттерну (**/*adapter*.py)
  - [#2]  Параллельные tool calls — обрабатываем все вызовы за один шаг
  - [#3]  web_fetch — скачать документацию по URL прямо во время задачи
  - [#4]  git_diff / git_status — видеть накопленные изменения
  - [#5]  Память о прошлых задачах — похожие кейсы в контекст
  - [#6]  ask_user — пауза и вопрос пользователю при неоднозначности
  - [#7]  Scratchpad/thinking — первый шаг без tool_choice=required (план)
  - [#8]  move_file / delete_file — полные файловые операции
  - [#9]  Семантический поиск через knowledge hub
  - [#10] Субагенты для параллельных независимых подзадач

v4 (сохранено):
  - append_file, авто-retry, компрессия истории, baseline тесты,
    прогресс в Redis, checkpoint, ruff lint, ленивый контекст
"""
from __future__ import annotations

import ast
import asyncio
import base64
import datetime
import difflib
import fnmatch
import json
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import redis

log = logging.getLogger(__name__)

_WORKSPACE_ROOT = os.getenv("PIM_WORKSPACE_ROOT", "/mnt/data/Pimv3")
_MAX_FILE_READ_CHARS = 12_000
_MAX_SHELL_OUTPUT_CHARS = 6_000
_MAX_REACT_STEPS = 40

# [v7 #1] Extended shell whitelist
_ALLOWED_SHELL_PREFIXES = (
    "python3 -m pytest",
    "python3 -c",
    "python -m pytest",
    "npm run build",
    "npm run lint",
    "ruff check",
    "ruff format",
    "grep ",
    "find ",
    "ls ",
    "cat ",
    "head ",
    "tail ",
    "alembic upgrade",
    "alembic revision",
    "alembic downgrade",
    "alembic history",
    "alembic current",
    "pip install",
    "pip show",
    "npm install",
    "npm ci",
    "git log",
    "git blame",
    "git show",
    "git stash",
    "git stash pop",
    "git diff ",
)

_MAX_MESSAGES_BEFORE_COMPRESS = 40
_KEEP_RECENT_MESSAGES = 10

_redis_client: Optional[redis.Redis] = None


def _get_redis() -> Optional[redis.Redis]:
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = redis.Redis.from_url(
                os.getenv("REDIS_URL", "redis://localhost:6379/0"),
                decode_responses=True,
            )
            _redis_client.ping()
        except Exception:
            _redis_client = None
    return _redis_client


# ---------------------------------------------------------------------------
# [#6] Streaming via Redis pub/sub
# ---------------------------------------------------------------------------

def _publish_stream(task_id: str, event_type: str, data: Any) -> None:
    """[#6] Публикуем событие агента в Redis pub/sub для стриминга."""
    r = _get_redis()
    if r is None or not task_id:
        return
    try:
        import time
        msg = json.dumps({"type": event_type, "data": data, "ts": time.time()}, ensure_ascii=False)
        r.publish(f"agent:stream:{task_id}", msg)
        r.rpush(f"agent:stream_log:{task_id}", msg)
        r.ltrim(f"agent:stream_log:{task_id}", -200, -1)
        r.expire(f"agent:stream_log:{task_id}", 3600)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Схема инструментов
# ---------------------------------------------------------------------------

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the content of a file. Use this BEFORE editing any file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to project root"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "glob_files",
            "description": "Find files matching a glob pattern. Use to discover files by name pattern, e.g. '**/*adapter*.py', 'backend/services/*.py', 'backend/tests/test_*.py'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Glob pattern relative to project root, e.g. backend/services/**/*.py"},
                    "max_results": {"type": "integer", "description": "Max results to return (default 50)"}
                },
                "required": ["pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List files and directories at a path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory path relative to project root"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_code",
            "description": "Search for a pattern in project files using grep. Returns matching lines with context.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search pattern (literal string or regex)"},
                    "path": {"type": "string", "description": "Directory or file to search in (default: backend/)"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "semantic_search",
            "description": "Search the project knowledge base semantically. Use to find relevant documentation, past solutions, or code patterns by meaning rather than exact text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural language search query"},
                    "namespace": {"type": "string", "description": "Knowledge namespace to search (default: searches all)"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "Fetch a web page or API documentation URL. Use when the task references external documentation or API specs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to fetch"},
                    "max_chars": {"type": "integer", "description": "Max characters to return (default 8000)"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_dependents",
            "description": "Find all files that import a given module or file. Use before modifying a file to understand what else might break.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "file path to check (e.g. backend/models.py)"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create a new file or completely overwrite an existing one. Use for NEW files only.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to project root"},
                    "content": {"type": "string", "description": "Complete file content"}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": "Make a targeted edit by replacing an exact snippet. ALWAYS call read_file first.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to project root"},
                    "old_snippet": {"type": "string", "description": "EXACT text to replace — character-for-character match"},
                    "new_snippet": {"type": "string", "description": "Replacement text"}
                },
                "required": ["path", "old_snippet", "new_snippet"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "append_file",
            "description": "Append content to end of file, or after a specific pattern. Use for adding new routes/functions/imports.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to project root"},
                    "content": {"type": "string", "description": "Content to append"},
                    "after_pattern": {"type": "string", "description": "Insert after last occurrence of this pattern (optional)"}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "move_file",
            "description": "Move or rename a file. Also updates all import references in Python files.",
            "parameters": {
                "type": "object",
                "properties": {
                    "src": {"type": "string", "description": "Source path relative to project root"},
                    "dst": {"type": "string", "description": "Destination path relative to project root"}
                },
                "required": ["src", "dst"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file. Use with caution — only delete files you created or confirmed are safe to remove.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to project root"},
                    "reason": {"type": "string", "description": "Why this file is being deleted"}
                },
                "required": ["path", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_status",
            "description": "Show git status and diff of changes made so far in this task. Use to review what you've changed before finishing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "show_diff": {"type": "boolean", "description": "Whether to show the full diff (default true)"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_shell",
            "description": "Run a shell command. Allowed: pytest, python3 -c, npm run build/lint, ruff, grep, find, ls, alembic, pip install, npm install, git log/blame/show/stash/diff.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to run"}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user",
            "description": "Pause the task and ask the user a clarifying question. Use when the task is ambiguous and making the wrong assumption would waste significant work.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The question to ask"},
                    "context": {"type": "string", "description": "Why you need this information"}
                },
                "required": ["question"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "task_done",
            "description": "Signal task is complete. Call ONLY after tests pass and lint is clean.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Summary of what was implemented"},
                    "affected_files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Files created or modified"
                    },
                    "wrote_tests": {"type": "boolean", "description": "Whether tests were written"}
                },
                "required": ["summary", "affected_files"]
            }
        }
    },
    # [v7 #2] install_package tool
    {
        "type": "function",
        "function": {
            "name": "install_package",
            "description": "Install a Python or Node.js package and update requirements.txt or package.json. Use when you need a dependency that doesn't exist yet.",
            "parameters": {
                "type": "object",
                "properties": {
                    "package": {"type": "string", "description": "package name (e.g. httpx, celery[redis])"},
                    "package_type": {"type": "string", "description": "python or nodejs (default: python)"},
                    "dev": {"type": "boolean", "description": "install as dev dependency for nodejs (default: false)"}
                },
                "required": ["package"]
            }
        }
    },
    # [v7 #3] run_migration tool
    {
        "type": "function",
        "function": {
            "name": "run_migration",
            "description": "Create or apply Alembic database migration. Use after changing SQLAlchemy models.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "description": "one of: autogenerate, upgrade, downgrade, history, current"},
                    "message": {"type": "string", "description": "migration message for autogenerate (required when action=autogenerate)"},
                    "revision": {"type": "string", "description": "revision for upgrade/downgrade (default: head for upgrade, -1 for downgrade)"}
                },
                "required": ["action"]
            }
        }
    },
    # [v7 #5] git_log tool
    {
        "type": "function",
        "function": {
            "name": "git_log",
            "description": "Show recent git commit history for the repo or a specific file. Use to understand why code was written a certain way.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "optional file path to see history for"},
                    "limit": {"type": "integer", "description": "number of commits to show (default 15)"}
                }
            }
        }
    },
    # [v7 #5] git_blame tool
    {
        "type": "function",
        "function": {
            "name": "git_blame",
            "description": "Show git blame for a file — who changed each line and when. Use to understand the origin of specific code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "file path (required)"},
                    "start_line": {"type": "integer", "description": "optional start line number"},
                    "end_line": {"type": "integer", "description": "optional end line number"}
                },
                "required": ["path"]
            }
        }
    },
    # [v7 #6] read_image tool
    {
        "type": "function",
        "function": {
            "name": "read_image",
            "description": "Read and describe an image file (screenshot, diagram, mockup). Use when the task references a visual resource.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "image file path relative to project root"},
                    "question": {"type": "string", "description": "what to look for in the image (optional)"}
                },
                "required": ["path"]
            }
        }
    },
]


# ---------------------------------------------------------------------------
# [#2] Scope enforcement helper
# ---------------------------------------------------------------------------

def _check_scope(path: str, allowlist: List[str]) -> Optional[str]:
    """[#2] Проверяем, что path входит в allowlist (или в backend/tests/)."""
    if not allowlist:
        return None
    if path.startswith("backend/tests/"):
        return None
    if path in allowlist:
        return None
    preview = allowlist[:5]
    return (
        f"SCOPE ERROR: {path} is not in the task allowlist. "
        f"Allowed: {preview}. "
        f"If you need to modify this file, it must be added to the task scope."
    )


# ---------------------------------------------------------------------------
# [#3] find_dependents tool implementation
# ---------------------------------------------------------------------------

def _tool_find_dependents(path: str, workspace_root: str) -> str:
    """[#3] Найти все файлы, импортирующие данный модуль."""
    # Convert file path to module name: backend/models.py -> backend.models
    module_name = path.removesuffix(".py").replace("/", ".")

    try:
        base = Path(workspace_root)
        py_files = list(base.rglob("*.py"))
        skip = {"__pycache__", "venv", ".venv", "node_modules"}
        py_files = [f for f in py_files if not any(s in f.parts for s in skip)]

        pattern_from = f"from {module_name}"
        pattern_import = f"import {module_name}"

        results: List[str] = []
        for pyf in py_files:
            try:
                text = pyf.read_text(encoding="utf-8", errors="replace")
                matching_lines = []
                for lineno, line in enumerate(text.splitlines(), 1):
                    if pattern_from in line or pattern_import in line:
                        matching_lines.append(f"  line {lineno}: {line.strip()}")
                if matching_lines:
                    rel = str(pyf.relative_to(base))
                    results.append(f"{rel}:\n" + "\n".join(matching_lines))
            except Exception:
                continue

        if not results:
            return f"No files found importing '{module_name}' (from path: {path})"

        header = f"Files importing '{module_name}' ({len(results)} found):"
        return header + "\n\n" + "\n\n".join(results)
    except Exception as e:
        return f"ERROR find_dependents: {e}"


# ---------------------------------------------------------------------------
# Инструменты — реализация
# ---------------------------------------------------------------------------

def _tool_read_file(path: str, workspace_root: str) -> str:
    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal detected: {path}"
    if not abs_path.exists():
        return f"ERROR: file not found: {path}"
    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
        total = len(content)
        if total > _MAX_FILE_READ_CHARS:
            half = _MAX_FILE_READ_CHARS // 2
            content = (
                content[:half]
                + f"\n\n... [{total - _MAX_FILE_READ_CHARS} chars truncated] ...\n\n"
                + content[-half:]
            )
        return f"FILE: {path}\n```\n{content}\n```"
    except Exception as e:
        return f"ERROR reading {path}: {e}"


def _tool_glob_files(pattern: str, workspace_root: str, max_results: int = 50) -> str:
    """[#1] Поиск файлов по glob паттерну."""
    base = Path(workspace_root)
    try:
        matches = sorted(base.glob(pattern))
        # Исключаем мусор
        skip = {"__pycache__", "node_modules", ".git", "venv", ".venv", "dist", "build"}
        matches = [m for m in matches if not any(s in m.parts for s in skip)]
        if not matches:
            return f"No files matching '{pattern}'"
        result_lines = [f"Files matching '{pattern}' ({len(matches)} found):"]
        for m in matches[:max_results]:
            rel = m.relative_to(base)
            size = m.stat().st_size if m.is_file() else 0
            result_lines.append(f"  {rel}  ({size} bytes)" if size else f"  {rel}/")
        if len(matches) > max_results:
            result_lines.append(f"  ... and {len(matches) - max_results} more")
        return "\n".join(result_lines)
    except Exception as e:
        return f"ERROR: {e}"


def _tool_list_dir(path: str, workspace_root: str) -> str:
    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}"
    if not abs_path.exists():
        return f"ERROR: path not found: {path}"
    try:
        entries = sorted(abs_path.iterdir(), key=lambda p: (p.is_file(), p.name))
        lines = []
        for e in entries[:120]:
            prefix = "[dir]" if e.is_dir() else "[file]"
            lines.append(f"{prefix} {e.name}")
        total = sum(1 for _ in abs_path.iterdir())
        if total > 120:
            lines.append(f"... ({total - 120} more)")
        return f"DIR: {path}/\n" + "\n".join(lines)
    except Exception as e:
        return f"ERROR listing {path}: {e}"


def _tool_search_code(query: str, path: Optional[str], workspace_root: str) -> str:
    search_path = path or "backend"
    abs_search = _safe_resolve(search_path, workspace_root)
    if abs_search is None:
        return "ERROR: path traversal"
    try:
        result = subprocess.run(
            ["grep", "-rn", "--include=*.py", "--include=*.ts", "--include=*.tsx",
             "-l", query, str(abs_search)],
            capture_output=True, text=True, timeout=10
        )
        files = [f for f in (result.stdout or "").strip().splitlines() if f]
        if not files:
            return f"No matches for '{query}' in {search_path}"

        output_parts = [f"Found '{query}' in {len(files)} file(s):"]
        for f in files[:5]:
            rel = os.path.relpath(f, workspace_root)
            grep_ctx = subprocess.run(
                ["grep", "-n", query, f],
                capture_output=True, text=True, timeout=5
            )
            lines = (grep_ctx.stdout or "")[:800]
            output_parts.append(f"\n{rel}:\n{lines}")
        if len(files) > 5:
            output_parts.append(f"\n... and {len(files) - 5} more files")
        return "\n".join(output_parts)
    except Exception as e:
        return f"ERROR: {e}"


def _tool_semantic_search(query: str, namespace: Optional[str], workspace_root: str) -> str:
    """[#9] Семантический поиск через knowledge hub агента."""
    try:
        from backend.services.agent_memory import get_agent_memory
        mem = get_agent_memory()
        hits = mem.search(query=query, namespace=namespace or "", top_k=5)
        if not hits:
            # Попробуем через knowledge hub
            from backend.services.knowledge_hub import search_knowledge
            kb_hits = search_knowledge(query=query, namespace=namespace or "default", top_k=5)
            hits = kb_hits if isinstance(kb_hits, list) else []
        if not hits:
            return f"No semantic matches found for: '{query}'"
        lines = [f"Semantic search results for '{query}':"]
        for i, h in enumerate(hits[:5], 1):
            if isinstance(h, dict):
                src = h.get("source_uri") or h.get("title") or h.get("namespace") or "unknown"
                excerpt = str(h.get("content_excerpt") or h.get("action_summary") or "")[:500]
                score = h.get("score", "")
                lines.append(f"\n[{i}] {src} (score: {score})\n{excerpt}")
        return "\n".join(lines)
    except Exception as e:
        return f"ERROR semantic search: {e}"


def _tool_web_fetch(url: str, max_chars: int, workspace_root: str) -> str:
    """[#3] Скачать документацию по URL."""
    max_chars = max(1000, min(max_chars or 8000, 20000))
    try:
        import httpx
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; PIMv3-Agent/1.0)",
            "Accept": "text/html,text/plain,application/json",
        }
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            text = resp.text

        # Если HTML — убираем теги
        if "html" in content_type:
            text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL)
            text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.DOTALL)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s{3,}", "\n\n", text)
            text = text.strip()

        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n... [truncated, {len(text) - max_chars} more chars]"

        return f"URL: {url}\nStatus: {resp.status_code}\n\n{text}"
    except Exception as e:
        return f"ERROR fetching {url}: {e}"


def _tool_write_file(
    path: str,
    content: str,
    workspace_root: str,
    dry_run: bool = False,
    allowlist: Optional[List[str]] = None,
) -> Tuple[str, Optional[str]]:
    # [#2] Scope check
    scope_err = _check_scope(path, allowlist or [])
    if scope_err:
        return scope_err, None

    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}", None
    if path.endswith(".py"):
        ok, err = _validate_python_syntax(content, path)
        if not ok:
            return f"ERROR: syntax validation failed — {err}", None
        import_err = _check_new_imports(content, workspace_root)
        if import_err:
            return f"WARNING: unresolvable imports: {import_err}", None

    # [#1] Dry-run mode
    if dry_run:
        return f"DRY-RUN: would write {path} ({len(content)} chars)", path

    try:
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(content, encoding="utf-8")
        return f"OK: Written {path} ({len(content)} chars)", path
    except Exception as e:
        return f"ERROR writing {path}: {e}", None


def _tool_edit_file(
    path: str,
    old_snippet: str,
    new_snippet: str,
    workspace_root: str,
    dry_run: bool = False,
    allowlist: Optional[List[str]] = None,
) -> Tuple[str, Optional[str]]:
    # [#2] Scope check
    scope_err = _check_scope(path, allowlist or [])
    if scope_err:
        return scope_err, None

    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}", None
    if not abs_path.exists():
        return f"ERROR: file not found: {path}", None
    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"ERROR reading {path}: {e}", None

    count = content.count(old_snippet)
    if count == 0:
        old_norm = "\n".join(l.rstrip() for l in old_snippet.splitlines())
        content_norm = "\n".join(l.rstrip() for l in content.splitlines())
        if content_norm.count(old_norm) == 1:
            new_content = content_norm.replace(old_norm, new_snippet, 1)
        else:
            first_line = old_snippet.splitlines()[0][:60] if old_snippet else ""
            hint = ""
            if first_line:
                idx = content.find(first_line[:30])
                if idx != -1:
                    hint = f"\nNearby content:\n{content[max(0,idx-100):idx+200]}"
            return (
                f"ERROR: old_snippet not found in {path}.{hint}\n"
                f"IMPORTANT: Call read_file('{path}') to get exact content, then retry.",
                None
            )
    elif count > 1:
        return f"ERROR: old_snippet matches {count} times. Make it more specific.", None
    else:
        new_content = content.replace(old_snippet, new_snippet, 1)

    if path.endswith(".py"):
        ok, err = _validate_python_syntax(new_content, path)
        if not ok:
            return f"ERROR: syntax after edit — {err}", None

    # [#1] Dry-run mode
    if dry_run:
        return f"DRY-RUN: would edit {path}", path

    try:
        abs_path.write_text(new_content, encoding="utf-8")
        return f"OK: edited {path}", path
    except Exception as e:
        return f"ERROR writing {path}: {e}", None


def _tool_append_file(
    path: str,
    content: str,
    after_pattern: Optional[str],
    workspace_root: str,
    dry_run: bool = False,
    allowlist: Optional[List[str]] = None,
) -> Tuple[str, Optional[str]]:
    # [#2] Scope check
    scope_err = _check_scope(path, allowlist or [])
    if scope_err:
        return scope_err, None

    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}", None
    if not abs_path.exists():
        return f"ERROR: file not found: {path}", None
    try:
        existing = abs_path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"ERROR reading {path}: {e}", None

    if after_pattern:
        idx = existing.rfind(after_pattern)
        if idx == -1:
            return f"ERROR: after_pattern not found: '{after_pattern[:60]}'", None
        insert_pos = idx + len(after_pattern)
        new_content = existing[:insert_pos] + "\n" + content + existing[insert_pos:]
    else:
        sep = "\n" if existing.endswith("\n") else "\n\n"
        new_content = existing + sep + content

    if path.endswith(".py"):
        ok, err = _validate_python_syntax(new_content, path)
        if not ok:
            return f"ERROR: syntax after append — {err}", None

    # [#1] Dry-run mode
    if dry_run:
        return f"DRY-RUN: would append {len(content)} chars to {path}", path

    try:
        abs_path.write_text(new_content, encoding="utf-8")
        return f"OK: appended {len(content)} chars to {path}", path
    except Exception as e:
        return f"ERROR writing {path}: {e}", None


def _tool_move_file(
    src: str,
    dst: str,
    workspace_root: str,
    dry_run: bool = False,
    allowlist: Optional[List[str]] = None,
) -> Tuple[str, List[str]]:
    """[#8] Переместить/переименовать файл + обновить импорты."""
    # [#2] Scope check (check destination)
    scope_err = _check_scope(dst, allowlist or [])
    if scope_err:
        return scope_err, []

    abs_src = _safe_resolve(src, workspace_root)
    abs_dst = _safe_resolve(dst, workspace_root)
    if abs_src is None or abs_dst is None:
        return "ERROR: path traversal detected", []
    if not abs_src.exists():
        return f"ERROR: source not found: {src}", []

    # [#1] Dry-run mode
    if dry_run:
        return f"DRY-RUN: would move {src} → {dst}", [dst]

    try:
        abs_dst.parent.mkdir(parents=True, exist_ok=True)
        abs_src.rename(abs_dst)
    except Exception as e:
        return f"ERROR moving file: {e}", []

    affected = [dst]

    # Обновляем импорты в Python файлах
    if src.endswith(".py"):
        old_module = src.replace("/", ".").removesuffix(".py")
        new_module = dst.replace("/", ".").removesuffix(".py")
        updated = []
        try:
            py_files = list(Path(workspace_root).rglob("*.py"))
            skip = {"__pycache__", "venv", ".venv", "node_modules"}
            py_files = [f for f in py_files if not any(s in f.parts for s in skip)]
            for pyf in py_files:
                try:
                    text = pyf.read_text(encoding="utf-8", errors="replace")
                    new_text = text.replace(f"from {old_module}", f"from {new_module}")
                    new_text = new_text.replace(f"import {old_module}", f"import {new_module}")
                    if new_text != text:
                        pyf.write_text(new_text, encoding="utf-8")
                        updated.append(str(pyf.relative_to(workspace_root)))
                except Exception:
                    continue
        except Exception:
            pass
        if updated:
            affected.extend(updated)
            return f"OK: moved {src} → {dst}, updated imports in {len(updated)} file(s): {updated[:5]}", affected

    return f"OK: moved {src} → {dst}", affected


def _tool_delete_file(
    path: str,
    reason: str,
    workspace_root: str,
    dry_run: bool = False,
    allowlist: Optional[List[str]] = None,
) -> Tuple[str, str]:
    """[#8] Удалить файл."""
    # [#2] Scope check
    scope_err = _check_scope(path, allowlist or [])
    if scope_err:
        return scope_err, ""

    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}", ""
    if not abs_path.exists():
        return f"ERROR: file not found: {path}", ""
    # Запрещаем удалять критичные файлы
    protected = {"backend/main.py", "backend/models.py", "backend/database.py", "backend/schemas.py"}
    if path in protected:
        return f"ERROR: cannot delete protected file: {path}", ""

    # [#1] Dry-run mode
    if dry_run:
        return f"DRY-RUN: would delete {path} (reason: {reason})", path

    try:
        abs_path.unlink()
        return f"OK: deleted {path} (reason: {reason})", path
    except Exception as e:
        return f"ERROR deleting {path}: {e}", ""


def _tool_git_status(show_diff: bool, workspace_root: str) -> str:
    """[#4] Показать накопленные изменения."""
    try:
        status_res = subprocess.run(
            ["git", "status", "--short"],
            cwd=workspace_root, capture_output=True, text=True, timeout=10
        )
        output = f"## Git Status\n{status_res.stdout or '(clean)'}\n"

        if show_diff:
            diff_res = subprocess.run(
                ["git", "diff", "--stat"],
                cwd=workspace_root, capture_output=True, text=True, timeout=10
            )
            stat = (diff_res.stdout or "").strip()
            if stat:
                output += f"\n## Diff stat\n{stat}\n"
                # Показываем полный diff но ограниченный
                full_diff = subprocess.run(
                    ["git", "diff"],
                    cwd=workspace_root, capture_output=True, text=True, timeout=10
                )
                diff_text = (full_diff.stdout or "")[:6000]
                if diff_text:
                    output += f"\n## Full diff (truncated)\n{diff_text}"
        return output
    except Exception as e:
        return f"ERROR git status: {e}"


def _tool_run_shell(command: str, workspace_root: str) -> str:
    cmd_lower = command.strip().lower()
    allowed = any(cmd_lower.startswith(p.lower()) for p in _ALLOWED_SHELL_PREFIXES)
    if not allowed:
        return (
            f"ERROR: command not allowed: '{command}'\n"
            f"Allowed prefixes: {', '.join(_ALLOWED_SHELL_PREFIXES)}"
        )
    try:
        result = subprocess.run(
            command, shell=True, cwd=workspace_root,
            capture_output=True, text=True, timeout=120
        )
        stdout = (result.stdout or "")[-_MAX_SHELL_OUTPUT_CHARS:]
        stderr = (result.stderr or "")[-2000:]
        exit_code = result.returncode
        status = "PASSED" if exit_code == 0 else f"FAILED (exit {exit_code})"
        output = f"$ {command}\nStatus: {status}\n"
        if stdout:
            output += f"stdout:\n{stdout}\n"
        if stderr:
            output += f"stderr:\n{stderr}\n"
        return output
    except subprocess.TimeoutExpired:
        return f"ERROR: command timed out after 120s"
    except Exception as e:
        return f"ERROR running '{command}': {e}"


# ---------------------------------------------------------------------------
# [v7 #2] install_package tool implementation
# ---------------------------------------------------------------------------

def _tool_install_package(
    package: str,
    package_type: str,
    dev: bool,
    workspace_root: str,
) -> str:
    """[v7 #2] Установить Python или Node.js пакет."""
    package_type = (package_type or "python").lower().strip()

    if package_type == "nodejs":
        flag = "--save-dev" if dev else "--save"
        cmd = ["npm", "install", flag, package]
        try:
            result = subprocess.run(
                cmd, cwd=workspace_root,
                capture_output=True, text=True, timeout=120
            )
            if result.returncode != 0:
                return f"ERROR: {result.stderr or result.stdout}"
            return f"OK: installed {package} (nodejs, dev={dev})"
        except subprocess.TimeoutExpired:
            return "ERROR: npm install timed out after 120s"
        except Exception as e:
            return f"ERROR: {e}"
    else:
        # Python
        venv_python = str(Path(workspace_root) / "backend" / "venv" / "bin" / "python3")
        if not Path(venv_python).exists():
            venv_python = "python3"
        cmd_str = f"{venv_python} -m pip install {package}"
        try:
            result = subprocess.run(
                cmd_str, shell=True, cwd=workspace_root,
                capture_output=True, text=True, timeout=120
            )
            if result.returncode != 0:
                return f"ERROR: {result.stderr or result.stdout}"
            # Update requirements.txt if not already there
            req_path = Path(workspace_root) / "requirements.txt"
            if req_path.exists():
                req_content = req_path.read_text(encoding="utf-8")
                pkg_base = package.split("[")[0].split("==")[0].split(">=")[0].strip()
                if pkg_base.lower() not in req_content.lower():
                    req_path.write_text(req_content.rstrip() + f"\n{package}\n", encoding="utf-8")
            return f"OK: installed {package}"
        except subprocess.TimeoutExpired:
            return "ERROR: pip install timed out after 120s"
        except Exception as e:
            return f"ERROR: {e}"


# ---------------------------------------------------------------------------
# [v7 #3] run_migration tool implementation
# ---------------------------------------------------------------------------

def _tool_run_migration(
    action: str,
    message: Optional[str],
    revision: Optional[str],
    workspace_root: str,
) -> str:
    """[v7 #3] Создать или применить Alembic миграцию."""
    venv_alembic = str(Path(workspace_root) / "backend" / "venv" / "bin" / "alembic")
    if not Path(venv_alembic).exists():
        venv_alembic = "alembic"

    action = (action or "").strip().lower()

    if action == "autogenerate":
        msg = message or "auto"
        cmd = [venv_alembic, "revision", "--autogenerate", "-m", msg]
    elif action == "upgrade":
        rev = revision or "head"
        cmd = [venv_alembic, "upgrade", rev]
    elif action == "downgrade":
        rev = revision or "-1"
        cmd = [venv_alembic, "downgrade", rev]
    elif action == "history":
        cmd = [venv_alembic, "history"]
    elif action == "current":
        cmd = [venv_alembic, "current"]
    else:
        return f"ERROR: unknown action '{action}'. Use: autogenerate, upgrade, downgrade, history, current"

    try:
        result = subprocess.run(
            cmd, cwd=workspace_root,
            capture_output=True, text=True, timeout=60
        )
        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        combined = (stdout + "\n" + stderr).strip()
        status = "OK" if result.returncode == 0 else f"FAILED (exit {result.returncode})"

        if action == "autogenerate" and result.returncode == 0:
            if "Generating" in combined:
                return f"Status: {status}\nMigration created successfully.\n{combined}"
            else:
                return f"Status: {status}\nNote: No changes detected or migration created.\n{combined}"

        return f"Status: {status}\n{combined}"
    except subprocess.TimeoutExpired:
        return "ERROR: alembic command timed out after 60s"
    except Exception as e:
        return f"ERROR: {e}"


# ---------------------------------------------------------------------------
# [v7 #5] git_log and git_blame tool implementations
# ---------------------------------------------------------------------------

def _tool_git_log(path: Optional[str], limit: int, workspace_root: str) -> str:
    """[v7 #5] Показать историю коммитов."""
    limit = limit or 15
    cmd = ["git", "log", "--oneline", "--no-merges", f"-{limit}"]
    if path:
        abs_path = _safe_resolve(path, workspace_root)
        if abs_path is None:
            return f"ERROR: path traversal: {path}"
        cmd += ["--", str(abs_path)]
    try:
        result = subprocess.run(
            cmd, cwd=workspace_root,
            capture_output=True, text=True, timeout=15
        )
        output = (result.stdout or "").strip()
        if not output:
            return "No commits found."
        header = f"Git log (last {limit} commits)"
        if path:
            header += f" for {path}"
        return f"{header}:\n{output}"
    except Exception as e:
        return f"ERROR git log: {e}"


def _tool_git_blame(
    path: str,
    start_line: Optional[int],
    end_line: Optional[int],
    workspace_root: str,
) -> str:
    """[v7 #5] Показать git blame для файла."""
    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}"
    if not abs_path.exists():
        return f"ERROR: file not found: {path}"

    cmd = ["git", "blame"]
    if start_line is not None and end_line is not None:
        cmd += ["-L", f"{start_line},{end_line}"]
    elif start_line is not None:
        cmd += ["-L", f"{start_line},{start_line}"]
    cmd.append(str(abs_path))

    try:
        result = subprocess.run(
            cmd, cwd=workspace_root,
            capture_output=True, text=True, timeout=15
        )
        output = (result.stdout or result.stderr or "").strip()
        return output[:4000]
    except Exception as e:
        return f"ERROR git blame: {e}"


# ---------------------------------------------------------------------------
# [v7 #6] read_image tool implementation
# ---------------------------------------------------------------------------

def _tool_read_image(
    path: str,
    question: Optional[str],
    workspace_root: str,
    client: Any,
    model: str,
) -> str:
    """[v7 #6] Прочитать и описать изображение через vision API."""
    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}"
    if not abs_path.exists():
        return f"ERROR: file not found: {path}"

    ext = abs_path.suffix.lower().lstrip(".")
    allowed_exts = {"jpg", "jpeg", "png", "gif", "webp", "bmp"}
    if ext not in allowed_exts:
        return f"ERROR: not an image file (supported: {', '.join(allowed_exts)})"

    # Check file size
    size = abs_path.stat().st_size
    if size > 5 * 1024 * 1024:
        return f"ERROR: image too large ({size // 1024}KB > 5MB limit)"

    try:
        image_bytes = abs_path.read_bytes()
        b64 = base64.b64encode(image_bytes).decode("utf-8")
    except Exception as e:
        return f"ERROR reading image: {e}"

    mime_ext = "jpeg" if ext == "jpg" else ext
    text_prompt = question or "Describe this image in detail. If it shows code, UI, or error messages, transcribe them exactly."

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/{mime_ext};base64,{b64}"}},
                    {"type": "text", "text": text_prompt},
                ]
            }],
            max_tokens=1000,
        )
        return response.choices[0].message.content or "(no description)"
    except Exception as e:
        err_str = str(e)
        if "vision" in err_str.lower() or "image" in err_str.lower() or "multimodal" in err_str.lower():
            return f"ERROR: model does not support vision/images: {e}"
        return f"ERROR calling vision API: {e}"


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _safe_resolve(rel_path: str, workspace_root: str) -> Optional[Path]:
    try:
        base = Path(workspace_root).resolve()
        full = (base / rel_path).resolve()
        full.relative_to(base)
        return full
    except ValueError:
        return None


def _validate_python_syntax(code: str, file_path: str) -> Tuple[bool, str]:
    if not file_path.endswith(".py"):
        return True, ""
    try:
        ast.parse(code)
        return True, ""
    except SyntaxError as e:
        return False, f"SyntaxError line {e.lineno}: {e.msg}"


def _check_new_imports(code: str, workspace_root: str) -> str:
    errors = []
    for line in code.splitlines():
        line = line.strip()
        if not line.startswith("from backend.") and not line.startswith("import backend."):
            continue
        try:
            module = line.split()[1] if line.startswith("from ") else line.split()[1].split(".")[0]
            mod_path = module.replace(".", "/") + ".py"
            full = Path(workspace_root) / mod_path
            if not full.exists():
                pkg = Path(workspace_root) / module.replace(".", "/")
                if not pkg.exists():
                    errors.append(f"'{module}' not found")
        except Exception:
            continue
    return "; ".join(errors) if errors else ""


def _load_conventions(workspace_root: str) -> str:
    conv_path = Path(workspace_root) / "CONVENTIONS.md"
    if conv_path.exists():
        content = conv_path.read_text(encoding="utf-8")
        return f"\n## PROJECT CONVENTIONS\n{content[:3000]}\n"
    return ""


def _read_file_safe(path: str, max_chars: int = 6000) -> Optional[str]:
    try:
        content = Path(path).read_text(encoding="utf-8", errors="replace")
        if len(content) > max_chars:
            half = max_chars // 2
            content = content[:half] + "\n... [truncated] ...\n" + content[-half:]
        return content
    except Exception:
        return None


def _build_file_tree(workspace_root: str) -> str:
    try:
        result = subprocess.run(
            "find backend frontend/src -type f \\( -name '*.py' -o -name '*.ts' -o -name '*.tsx' \\) "
            "! -path '*/__pycache__/*' ! -path '*/node_modules/*' 2>/dev/null | sort | head -200",
            cwd=workspace_root, capture_output=True, text=True, timeout=10, shell=True
        )
        return f"## PROJECT FILE TREE\n{result.stdout[:4000]}"
    except Exception:
        return "## PROJECT FILE TREE\n(could not generate)"


def _list_tests(workspace_root: str) -> str:
    tests_dir = Path(workspace_root) / "backend" / "tests"
    if not tests_dir.exists():
        return ""
    files = sorted(tests_dir.glob("test_*.py"))
    if not files:
        return ""
    lines = [f"  - {f.name}" for f in files[:20]]
    return "## EXISTING TESTS\n" + "\n".join(lines) + "\nTests dir: backend/tests/"


def _run_baseline_tests(workspace_root: str) -> str:
    try:
        py = str(Path(workspace_root) / "backend" / "venv" / "bin" / "python3")
        if not Path(py).exists():
            py = "python3"
        result = subprocess.run(
            [py, "-m", "pytest", "backend/tests/", "-q", "--tb=line", "--no-header", "--timeout=30"],
            cwd=workspace_root, capture_output=True, text=True, timeout=60
        )
        output = ((result.stdout or "") + (result.stderr or ""))[-2000:]
        status = "PASSING" if result.returncode == 0 else "FAILING"
        return f"## BASELINE TEST STATUS: {status}\n{output}"
    except Exception as e:
        return f"## BASELINE TEST STATUS: unknown ({e})"


def _load_memory_context(task_description: str, workspace_root: str) -> str:
    """[#5] Загружаем похожие прошлые задачи из памяти агента."""
    try:
        from backend.services.agent_memory import get_agent_memory
        mem = get_agent_memory()
        hits = mem.search(query=task_description[:300], namespace="", top_k=3)
        if not hits:
            return ""
        lines = ["## SIMILAR PAST TASKS (for reference)"]
        for h in hits:
            if not isinstance(h, dict):
                continue
            problem = h.get("problem_text") or ""
            action = h.get("action_summary") or ""
            status = h.get("result_status") or ""
            if problem or action:
                lines.append(f"\nPast task ({status}): {problem[:200]}")
                if action:
                    lines.append(f"How it was solved: {action[:300]}")
        return "\n".join(lines) if len(lines) > 1 else ""
    except Exception:
        return ""


def _run_ruff_check(affected_files: List[str], workspace_root: str) -> Dict[str, Any]:
    py_files = [f for f in affected_files if f.endswith(".py")]
    if not py_files:
        return {"ok": True, "skipped": True}
    try:
        result = subprocess.run(
            ["ruff", "check", "--select=E,F,W", "--output-format=text"] + py_files,
            cwd=workspace_root, capture_output=True, text=True, timeout=30
        )
        issues = (result.stdout or "").strip()
        return {"ok": result.returncode == 0, "issues": issues[:2000] if issues else "", "files_checked": py_files}
    except FileNotFoundError:
        return {"ok": True, "skipped": True, "reason": "ruff not installed"}
    except Exception as e:
        return {"ok": True, "skipped": True, "reason": str(e)}


def _run_mypy_check(affected_files: List[str], workspace_root: str) -> Dict[str, Any]:
    """[#4] Запускаем mypy проверку после ruff."""
    py_files = [f for f in affected_files if f.endswith(".py")]
    if not py_files:
        return {"ok": True, "skipped": True}
    try:
        result = subprocess.run(
            ["mypy", "--ignore-missing-imports", "--no-error-summary"] + py_files,
            cwd=workspace_root, capture_output=True, text=True, timeout=60
        )
        issues = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        all_output = (issues + "\n" + stderr).strip()
        return {
            "ok": result.returncode == 0,
            "issues": all_output[:2000] if all_output else "",
            "files_checked": py_files,
        }
    except FileNotFoundError:
        return {"ok": True, "skipped": True, "reason": "mypy not installed"}
    except subprocess.TimeoutExpired:
        return {"ok": True, "skipped": True, "reason": "mypy timed out"}
    except Exception as e:
        return {"ok": True, "skipped": True, "reason": str(e)}


# ---------------------------------------------------------------------------
# [v7 #4] TypeScript check
# ---------------------------------------------------------------------------

def _run_tsc_check(affected_files: List[str], workspace_root: str) -> Dict[str, Any]:
    """[v7 #4] Запускаем tsc --noEmit для TypeScript файлов."""
    ts_files = [f for f in affected_files if f.endswith((".ts", ".tsx"))]
    if not ts_files:
        return {"ok": True, "skipped": True}
    try:
        result = subprocess.run(
            ["npx", "tsc", "--noEmit", "--pretty", "false"],
            cwd=workspace_root, capture_output=True, text=True, timeout=60
        )
        issues = (result.stdout or result.stderr or "").strip()
        return {"ok": result.returncode == 0, "issues": issues[:2000], "files_checked": ts_files}
    except FileNotFoundError:
        return {"ok": True, "skipped": True, "reason": "npx not found"}
    except Exception as e:
        return {"ok": True, "skipped": True, "reason": str(e)}


def _update_changelog(
    workspace_root: str,
    task_id: str,
    task_title: str,
    affected_files: List[str],
    summary: str,
) -> None:
    """[#7] Обновляем CHANGELOG.md — добавляем запись в начало файла."""
    try:
        changelog_path = Path(workspace_root) / "CHANGELOG.md"

        # Проверяем размер файла — пропускаем если > 50KB
        if changelog_path.exists():
            size = changelog_path.stat().st_size
            if size > 50 * 1024:
                log.info("CHANGELOG.md > 50KB, skipping update")
                return
            existing = changelog_path.read_text(encoding="utf-8", errors="replace")
        else:
            existing = ""

        date_str = datetime.date.today().isoformat()
        entry = (
            f"## {date_str} — {task_title}\n"
            f"- Task: {task_id}\n"
            f"- Files: {affected_files}\n"
            f"- {summary[:200]}\n\n"
        )
        new_content = entry + existing
        changelog_path.write_text(new_content, encoding="utf-8")
        log.info(f"CHANGELOG.md updated for task {task_id}")
    except Exception:
        pass  # Silently skip on any error


def _compress_messages(messages: List[Dict], keep_recent: int = _KEEP_RECENT_MESSAGES) -> List[Dict]:
    if len(messages) <= keep_recent + 2:
        return messages
    system_msg = messages[0]
    first_user = messages[1]
    recent = messages[-keep_recent:]
    middle = messages[2:-keep_recent]
    if not middle:
        return messages

    summary_lines = ["[COMPRESSED HISTORY]"]
    tool_counts: Dict[str, int] = {}
    written_files: List[str] = []

    for m in middle:
        if m.get("role") == "assistant":
            for tc in (m.get("tool_calls") or []):
                name = tc.get("function", {}).get("name", "")
                tool_counts[name] = tool_counts.get(name, 0) + 1
        elif m.get("role") == "tool":
            content = str(m.get("content", ""))
            if content.startswith("OK:"):
                parts = content.split(" ")
                if len(parts) > 2:
                    written_files.append(parts[2])

    summary_lines.append(f"Tools used: {dict(tool_counts)}")
    if written_files:
        summary_lines.append(f"Files modified so far: {list(set(written_files))}")

    return [system_msg, first_user, {"role": "user", "content": "\n".join(summary_lines)}] + recent


def _save_checkpoint(task_id: str, step: int, affected_files: List[str]) -> None:
    r = _get_redis()
    if r is None or not task_id:
        return
    try:
        import time
        r.hset(f"agent:checkpoint:{task_id}", mapping={
            "step": str(step),
            "affected_files": json.dumps(affected_files),
            "ts": str(time.time()),
        })
        r.expire(f"agent:checkpoint:{task_id}", 3600)
    except Exception:
        pass


def _update_progress(task_id: str, step: int, max_steps: int, tool_name: str, progress_callback: Optional[Callable]) -> None:
    if not task_id:
        return
    pct = 55 + int((step / max_steps) * 35)
    r = _get_redis()
    if r:
        try:
            import time
            r.hset(f"agent_task:{task_id}", mapping={
                "progress_percent": str(pct),
                "stage": f"react_step_{step}_{tool_name}",
                "updated_at_ts": str(int(time.time())),
            })
        except Exception:
            pass
    if progress_callback:
        try:
            progress_callback(step=step, tool=tool_name, progress=pct)
        except Exception:
            pass


def _pause_for_user_question(task_id: str, question: str, context: str) -> str:
    """[#6] Ставим задачу на паузу и записываем вопрос в Redis."""
    r = _get_redis()
    if r and task_id:
        try:
            import time
            r.hset(f"agent_task:{task_id}", mapping={
                "status": "waiting_user",
                "stage": "waiting_clarification",
                "clarification_question": question,
                "clarification_context": context[:500],
                "updated_at_ts": str(int(time.time())),
            })
        except Exception:
            pass
    return f"PAUSED: Waiting for user answer to: {question}"


async def _wait_for_user_answer(task_id: str, timeout: int = 300) -> Optional[str]:
    """Ждём ответа пользователя через Redis (до timeout секунд)."""
    if not task_id:
        return None
    r = _get_redis()
    if r is None:
        return None
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            answer = r.hget(f"agent_task:{task_id}", "clarification_answer")
            if answer:
                # Очищаем вопрос и ответ
                r.hdel(f"agent_task:{task_id}", "clarification_question", "clarification_answer")
                r.hset(f"agent_task:{task_id}", mapping={"status": "running", "stage": "react_resumed"})
                return answer
        except Exception:
            pass
        await asyncio.sleep(2)
    return None


# ---------------------------------------------------------------------------
# [#5] Task decomposition before react loop
# ---------------------------------------------------------------------------

async def _decompose_task(
    client: Any,
    model: str,
    title: str,
    description: str,
) -> List[Dict]:
    """[#5] Декомпозируем задачу на параллельные подзадачи через LLM."""
    system_prompt = (
        "You decompose software tasks. "
        "Return JSON array of subtasks or empty array if task is simple enough for one agent."
    )
    user_prompt = (
        f"Task: {title}\n{description}\n"
        'Return JSON: [{"title": ..., "description": ..., "type": "backend|frontend|test"}] or []'
    )
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.0,
            max_tokens=1000,
        )
        raw = (response.choices[0].message.content or "").strip()
        # Extract JSON array from response
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if not match:
            return []
        subtasks = json.loads(match.group(0))
        if not isinstance(subtasks, list):
            return []
        # Validate each subtask has required fields
        valid = []
        for s in subtasks:
            if isinstance(s, dict) and s.get("title") and s.get("description"):
                valid.append(s)
        return valid
    except Exception as e:
        log.info(f"Task decomposition failed: {e}")
        return []


# ---------------------------------------------------------------------------
# [v7 #7] Reflect on failure
# ---------------------------------------------------------------------------

async def _reflect_on_failure(
    client: Any,
    model: str,
    task_title: str,
    task_description: str,
    error: str,
    steps_log: List[str],
    workspace_root: str,
) -> str:
    """[v7 #7] LLM рефлексирует над неудачей и предлагает другой подход."""
    steps_summary = "\n".join(steps_log[-20:]) if steps_log else "(no steps)"
    prompt = (
        f"A coding agent just failed this task: {task_title}\n"
        f"Error: {error}\n"
        f"Steps taken:\n{steps_summary}\n\n"
        f"What went wrong and what should the agent do differently to succeed?"
    )
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are an expert software engineering mentor."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=500,
        )
        reflection = (response.choices[0].message.content or "").strip()
        return reflection[:1000]
    except Exception as e:
        log.info(f"Reflection call failed: {e}")
        return ""


# ---------------------------------------------------------------------------
# [v7 #9] Task templates
# ---------------------------------------------------------------------------

_TASK_TEMPLATES = {
    "new_adapter": """## TASK TEMPLATE: New Marketplace Adapter
1. Read backend/services/adapters.py to understand MarketplaceAdapter base class
2. Create backend/services/adapters/{name}_adapter.py implementing all required methods
3. Register adapter in backend/services/adapter_registry.py
4. Add connection config to backend/models.py if needed
5. Create tests in backend/tests/test_{name}_adapter.py
6. Update frontend connection form if UI needed""",

    "new_endpoint": """## TASK TEMPLATE: New API Endpoint
1. Add Pydantic schema to backend/schemas.py
2. Add route to backend/main.py with proper auth via Depends(get_current_user)
3. Implement business logic in appropriate service file
4. Write test in backend/tests/
5. Update frontend API client in frontend/src/lib/api.ts if needed""",

    "new_celery_task": """## TASK TEMPLATE: New Celery Task
1. Add async helper function _async_{name}()
2. Wrap in sync @celery_app.task calling asyncio.run(_async_{name}())
3. Add to backend/celery_worker.py before if __name__ == "__main__"
4. Add API endpoint to trigger task if needed
5. Write test verifying task is registered""",

    "schema_change": """## TASK TEMPLATE: Database Schema Change
1. Modify backend/models.py with the new field/table
2. Run: run_migration(action="autogenerate", message="describe change")
3. Run: run_migration(action="upgrade")
4. Update related Pydantic schemas in backend/schemas.py
5. Update any affected service code
6. Write migration rollback test""",
}


def _get_task_template(task_type: str, title: str) -> str:
    """[v7 #9] Вернуть шаблон плана по типу задачи или ключевым словам в заголовке."""
    # If explicit task_type matches
    if task_type in _TASK_TEMPLATES:
        return _TASK_TEMPLATES[task_type]

    title_lower = title.lower()
    if "adapter" in title_lower:
        return _TASK_TEMPLATES["new_adapter"]
    if any(kw in title_lower for kw in ("endpoint", "route", "api")):
        return _TASK_TEMPLATES["new_endpoint"]
    if any(kw in title_lower for kw in ("celery", "task", "worker")):
        return _TASK_TEMPLATES["new_celery_task"]
    if any(kw in title_lower for kw in ("model", "migration", "schema", "column", "table")):
        return _TASK_TEMPLATES["schema_change"]
    return ""


# ---------------------------------------------------------------------------
# [v7 #10] Reviewer agent
# ---------------------------------------------------------------------------

async def _run_reviewer_agent(
    client: Any,
    model: str,
    affected_files: List[str],
    workspace_root: str,
    task_summary: str,
) -> Dict[str, Any]:
    """[v7 #10] Асинхронное код-ревью изменённых файлов после task_done."""
    file_contents_parts = []
    for path in affected_files[:5]:
        abs_path = _safe_resolve(path, workspace_root)
        if abs_path is None or not abs_path.exists():
            continue
        try:
            content = abs_path.read_text(encoding="utf-8", errors="replace")
            if len(content) > 8000:
                content = content[:8000] + "\n... [truncated]"
            file_contents_parts.append(f"### {path}\n```\n{content}\n```")
        except Exception:
            continue

    if not file_contents_parts:
        return {"ok": True, "review": "No files to review.", "has_issues": False}

    file_contents = "\n\n".join(file_contents_parts)
    user_prompt = f"Review these changes for task: {task_summary}\n\n{file_contents}"

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a strict code reviewer. Find bugs, missing edge cases, "
                        "security issues, and convention violations. Be specific."
                    ),
                },
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=1500,
        )
        review_text = (response.choices[0].message.content or "").strip()
        issue_keywords = ("bug", "error", "missing", "vulnerable", "issue", "problem", "should", "must")
        has_issues = any(kw in review_text.lower() for kw in issue_keywords)
        return {"ok": True, "review": review_text, "has_issues": has_issues}
    except Exception as e:
        return {"ok": False, "review": f"Reviewer error: {e}", "has_issues": False}


# ---------------------------------------------------------------------------
# Субагенты для параллельных подзадач  [#10]
# ---------------------------------------------------------------------------

async def _run_subagent(
    *,
    subtask_title: str,
    subtask_description: str,
    client: Any,
    model: str,
    workspace_root: str,
    conventions: str,
    task_id: str,
    dry_run: bool = False,
    allowlist: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """[#10] Запускает независимый ReAct-цикл для подзадачи."""
    log.info(f"Subagent starting: {subtask_title}")
    file_tree = _build_file_tree(workspace_root)
    tests_list = _list_tests(workspace_root)
    return await _react_agent_loop(
        client=client,
        model=model,
        task_title=subtask_title,
        task_description=subtask_description,
        task_type="backend",
        workspace_root=workspace_root,
        conventions=conventions,
        knowledge_context="",
        file_tree=file_tree,
        tests_list=tests_list,
        baseline_tests="",
        memory_context="",
        task_id=f"{task_id}:sub:{subtask_title[:20]}",
        max_steps=20,
        progress_callback=None,
        is_subagent=True,
        dry_run=dry_run,
        allowlist=allowlist or [],
    )


# ---------------------------------------------------------------------------
# ReAct Tool Loop — ЯДРО АГЕНТА
# ---------------------------------------------------------------------------

async def _react_agent_loop(
    *,
    client: Any,
    model: str,
    task_title: str,
    task_description: str,
    task_type: str,
    workspace_root: str,
    conventions: str,
    knowledge_context: str,
    file_tree: str,
    tests_list: str,
    baseline_tests: str,
    memory_context: str,
    task_id: str = "",
    max_steps: int = _MAX_REACT_STEPS,
    progress_callback: Optional[Callable] = None,
    is_subagent: bool = False,
    dry_run: bool = False,
    allowlist: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    ReAct (Reasoning + Acting) цикл.
    Шаг 0: thinking (tool_choice=auto) — агент пишет план
    Шаги 1+: tool_choice=required — агент действует

    v6: dry_run, allowlist, streaming, token budget awareness
    v7: tsc check, install_package, run_migration, git_log, git_blame,
        read_image, task templates injected into user_message
    """
    allowlist = allowlist or []
    subagent_note = "\nYou are a subagent. Focus only on your specific subtask." if is_subagent else ""

    # [v7 #9] Inject task template if available
    task_template = _get_task_template(task_type, task_title)
    template_section = f"\n\n{task_template}" if task_template else ""

    system_prompt = f"""You are an expert software engineer working on PIMv3 — a Python/FastAPI + React/TypeScript PIM system for Russian e-commerce marketplaces (Ozon, Wildberries, Yandex Market, Megamarket).{subagent_note}

## TOOLS AVAILABLE
- read_file: read any file before editing
- glob_files: find files by pattern (e.g. **/*adapter*.py)
- list_dir: explore directory structure
- search_code: grep search in source files
- semantic_search: find relevant docs/code by meaning
- web_fetch: fetch external API documentation URLs
- find_dependents: find all files importing a given module
- write_file: create NEW files only
- edit_file: targeted edit (ALWAYS read_file first)
- append_file: add to end of file or after a pattern
- move_file: rename/move file + auto-update imports
- delete_file: delete a file (use carefully)
- git_status: see accumulated changes so far
- git_log: show commit history for repo or file
- git_blame: show who changed each line
- run_shell: pytest, ruff, npm build, alembic, pip install, npm install
- ask_user: pause and ask a clarifying question
- install_package: install Python/Node.js package + update requirements.txt/package.json
- run_migration: create/apply Alembic migrations
- read_image: describe an image file (screenshot, diagram, mockup)
- task_done: finish (only after tests pass + lint clean)

## WORKFLOW
1. PLAN — first message: write your implementation plan as text (no tool call yet)
2. EXPLORE — use glob_files and search_code to find relevant files
3. READ — read_file on files you will modify
4. IMPLEMENT — edit_file / append_file / write_file
5. TEST — run: python3 -m pytest backend/tests/ -q --tb=short
6. FIX — if tests fail, read the error, fix root cause
7. LINT — run: ruff check --select=E,F,W <changed_files>
8. DONE — call task_done

## RULES
- edit_file: ALWAYS read_file first. If ERROR, immediately read_file again and retry.
- parallel reads: you can call multiple read_file in parallel by outputting multiple tool calls
- write tests for every new feature in backend/tests/test_<feature>.py
- ask_user if the task is genuinely ambiguous (not enough info to proceed correctly)
- git_status to review changes before task_done
- semantic_search to find how similar problems were solved before
- find_dependents before modifying shared modules to understand impact{conventions}

{knowledge_context}
{memory_context}
{file_tree}
{tests_list}
{baseline_tests}
"""

    user_message = f"""Task: {task_title}

{task_description}{template_section}

Start with your implementation plan (no tool call), then proceed step by step."""

    messages: List[Dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    affected_files: List[str] = []
    deleted_files: List[str] = []
    steps_log: List[str] = []
    last_tool_was_error = False
    thinking_done = False  # [#7] первый шаг — plan без tool_choice

    # [#8] Token budget tracking
    total_tokens_used = 0

    for step in range(max_steps):
        # [#8] Token-aware compression: aggressive at high usage
        if total_tokens_used > 100000 or step > 30:
            aggressive_keep = 5
            if len(messages) > aggressive_keep + 2:
                messages = _compress_messages(messages, keep_recent=aggressive_keep)
                log.info(f"Step {step}: aggressive compression (tokens={total_tokens_used})")
        elif len(messages) > _MAX_MESSAGES_BEFORE_COMPRESS:
            messages = _compress_messages(messages)
            log.info(f"Step {step}: compressed history to {len(messages)} messages")

        # [#8] Add step-limit warning
        extra_user_msg: Optional[str] = None
        if step > 35:
            extra_user_msg = (
                "WARNING: approaching step limit. "
                "Finish the current subtask and call task_done soon."
            )

        # [#7] Первый шаг — thinking/planning без принудительного tool call
        use_tool_choice: Any = "required"
        if not thinking_done and step == 0:
            use_tool_choice = "auto"

        # Inject step warning into messages temporarily if needed
        if extra_user_msg:
            messages_to_send = messages + [{"role": "user", "content": extra_user_msg}]
        else:
            messages_to_send = messages

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages_to_send,
                tools=TOOLS_SCHEMA,
                tool_choice=use_tool_choice,
                temperature=0.1,
                max_tokens=4000,
            )
        except Exception as e:
            log.error(f"ReAct step {step} LLM error: {e}")
            _publish_stream(task_id, "error", {"message": str(e)})
            return {"ok": False, "error": f"llm_error_at_step_{step}: {e}"}

        # [#8] Track token usage
        if hasattr(response, "usage") and response.usage is not None:
            step_tokens = getattr(response.usage, "total_tokens", 0) or 0
            total_tokens_used += step_tokens

        msg = response.choices[0].message
        tool_calls = msg.tool_calls or []
        content_text = msg.content or ""

        # Шаг 0 без tool calls — план записан, продолжаем
        if step == 0 and not tool_calls and content_text:
            thinking_done = True
            log.info(f"Step 0 plan: {content_text[:200]}")
            messages.append({"role": "assistant", "content": content_text})
            messages.append({"role": "user", "content": "Good plan. Now proceed with implementation using the tools."})
            steps_log.append("Step 0: planning")
            continue

        thinking_done = True

        if not tool_calls:
            messages.append({"role": "assistant", "content": content_text})
            messages.append({"role": "user", "content": "Use one of the provided tools. If done, call task_done."})
            continue

        # [#2] Параллельные tool calls — обрабатываем ВСЕ за один шаг
        # Сначала записываем assistant message со всеми tool calls
        messages.append({
            "role": "assistant",
            "content": content_text or None,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in tool_calls
            ],
        })

        _update_progress(task_id, step, max_steps, tool_calls[0].function.name, progress_callback)
        steps_log.append(f"Step {step}: {[tc.function.name for tc in tool_calls]}")

        task_done_called = False
        ask_user_called = False
        has_error = False

        for tc in tool_calls:
            tool_name = tc.function.name
            try:
                tool_args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                tool_args = {}

            log.info(f"  Tool: {tool_name}({list(tool_args.keys())})")

            # [#6] Publish tool call event
            _publish_stream(task_id, "tool_call", {
                "step": step,
                "tool": tool_name,
                "args_summary": list(tool_args.keys()),
            })

            tool_result = ""
            is_write_op = False

            if tool_name == "read_file":
                tool_result = _tool_read_file(tool_args.get("path", ""), workspace_root)

            elif tool_name == "glob_files":
                tool_result = _tool_glob_files(
                    tool_args.get("pattern", ""),
                    workspace_root,
                    tool_args.get("max_results", 50),
                )

            elif tool_name == "list_dir":
                tool_result = _tool_list_dir(tool_args.get("path", ""), workspace_root)

            elif tool_name == "search_code":
                tool_result = _tool_search_code(
                    tool_args.get("query", ""),
                    tool_args.get("path"),
                    workspace_root,
                )

            elif tool_name == "semantic_search":
                tool_result = _tool_semantic_search(
                    tool_args.get("query", ""),
                    tool_args.get("namespace"),
                    workspace_root,
                )

            elif tool_name == "web_fetch":
                tool_result = _tool_web_fetch(
                    tool_args.get("url", ""),
                    tool_args.get("max_chars", 8000),
                    workspace_root,
                )

            elif tool_name == "find_dependents":
                # [#3] find_dependents
                tool_result = _tool_find_dependents(
                    tool_args.get("path", ""),
                    workspace_root,
                )

            elif tool_name == "write_file":
                msg_str, affected = _tool_write_file(
                    tool_args.get("path", ""),
                    tool_args.get("content", ""),
                    workspace_root,
                    dry_run=dry_run,
                    allowlist=allowlist,
                )
                tool_result = msg_str
                if affected and affected not in affected_files:
                    affected_files.append(affected)
                    is_write_op = True

            elif tool_name == "edit_file":
                msg_str, affected = _tool_edit_file(
                    tool_args.get("path", ""),
                    tool_args.get("old_snippet", ""),
                    tool_args.get("new_snippet", ""),
                    workspace_root,
                    dry_run=dry_run,
                    allowlist=allowlist,
                )
                tool_result = msg_str
                if affected and affected not in affected_files:
                    affected_files.append(affected)
                    is_write_op = True

            elif tool_name == "append_file":
                msg_str, affected = _tool_append_file(
                    tool_args.get("path", ""),
                    tool_args.get("content", ""),
                    tool_args.get("after_pattern"),
                    workspace_root,
                    dry_run=dry_run,
                    allowlist=allowlist,
                )
                tool_result = msg_str
                if affected and affected not in affected_files:
                    affected_files.append(affected)
                    is_write_op = True

            elif tool_name == "move_file":
                msg_str, mv_affected = _tool_move_file(
                    tool_args.get("src", ""),
                    tool_args.get("dst", ""),
                    workspace_root,
                    dry_run=dry_run,
                    allowlist=allowlist,
                )
                tool_result = msg_str
                for f in mv_affected:
                    if f not in affected_files:
                        affected_files.append(f)
                        is_write_op = True

            elif tool_name == "delete_file":
                msg_str, del_path = _tool_delete_file(
                    tool_args.get("path", ""),
                    tool_args.get("reason", ""),
                    workspace_root,
                    dry_run=dry_run,
                    allowlist=allowlist,
                )
                tool_result = msg_str
                if del_path:
                    deleted_files.append(del_path)
                    is_write_op = True

            elif tool_name == "git_status":
                tool_result = _tool_git_status(
                    tool_args.get("show_diff", True), workspace_root
                )

            elif tool_name == "git_log":
                # [v7 #5]
                tool_result = _tool_git_log(
                    tool_args.get("path"),
                    tool_args.get("limit", 15),
                    workspace_root,
                )

            elif tool_name == "git_blame":
                # [v7 #5]
                tool_result = _tool_git_blame(
                    tool_args.get("path", ""),
                    tool_args.get("start_line"),
                    tool_args.get("end_line"),
                    workspace_root,
                )

            elif tool_name == "run_shell":
                tool_result = _tool_run_shell(tool_args.get("command", ""), workspace_root)

            elif tool_name == "install_package":
                # [v7 #2]
                tool_result = _tool_install_package(
                    tool_args.get("package", ""),
                    tool_args.get("package_type", "python"),
                    bool(tool_args.get("dev", False)),
                    workspace_root,
                )

            elif tool_name == "run_migration":
                # [v7 #3]
                tool_result = _tool_run_migration(
                    tool_args.get("action", ""),
                    tool_args.get("message"),
                    tool_args.get("revision"),
                    workspace_root,
                )

            elif tool_name == "read_image":
                # [v7 #6]
                tool_result = _tool_read_image(
                    tool_args.get("path", ""),
                    tool_args.get("question"),
                    workspace_root,
                    client,
                    model,
                )

            elif tool_name == "ask_user":
                question = tool_args.get("question", "")
                context = tool_args.get("context", "")
                _pause_for_user_question(task_id, question, context)
                log.info(f"Agent asks user: {question}")
                # Ждём ответа (до 5 минут)
                answer = await _wait_for_user_answer(task_id, timeout=300)
                if answer:
                    tool_result = f"User answered: {answer}"
                else:
                    tool_result = "User did not respond in time. Proceed with best assumption."
                ask_user_called = True

            elif tool_name == "task_done":
                summary = tool_args.get("summary", "")
                done_files = tool_args.get("affected_files", [])
                wrote_tests = tool_args.get("wrote_tests", False)
                all_affected = list(set(affected_files + done_files))

                # Ruff lint check
                lint_result = _run_ruff_check(all_affected, workspace_root)
                if not lint_result.get("ok") and not lint_result.get("skipped"):
                    lint_issues = lint_result.get("issues", "")
                    log.info(f"Step {step}: ruff issues, asking agent to fix")
                    tool_result = (
                        f"LINT CHECK FAILED:\n{lint_issues}\n\n"
                        f"Fix all lint errors, then call task_done again."
                    )
                    has_error = True
                else:
                    # [#4] Mypy check (non-blocking — just report)
                    mypy_result = _run_mypy_check(all_affected, workspace_root)
                    mypy_note = ""
                    if not mypy_result.get("skipped") and not mypy_result.get("ok"):
                        mypy_issues = mypy_result.get("issues", "")
                        mypy_note = f"\nMypy warnings:\n{mypy_issues}"
                        log.info(f"Step {step}: mypy issues (non-blocking): {mypy_issues[:200]}")

                    # [v7 #4] TypeScript check (non-blocking — just report)
                    tsc_result = _run_tsc_check(all_affected, workspace_root)
                    tsc_note = ""
                    if not tsc_result.get("skipped") and not tsc_result.get("ok"):
                        tsc_issues = tsc_result.get("issues", "")
                        tsc_note = f"\nTypeScript warnings:\n{tsc_issues}"
                        log.info(f"Step {step}: tsc issues (non-blocking): {tsc_issues[:200]}")

                    log.info(f"task_done after {step} steps. Files: {all_affected}")
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": "Task marked as done.",
                    })

                    # [#7] Update CHANGELOG
                    _update_changelog(
                        workspace_root=workspace_root,
                        task_id=task_id,
                        task_title=task_title,
                        affected_files=all_affected,
                        summary=summary,
                    )

                    # [#6] Publish completed event
                    _publish_stream(task_id, "completed", {
                        "summary": summary,
                        "files": all_affected,
                    })

                    # [#1] Dry-run response
                    if dry_run:
                        return {
                            "ok": True,
                            "proposal": {
                                "dry_run": True,
                                "applied_directly": False,
                                "affected_files": all_affected,
                                "deleted_files": deleted_files,
                                "plan": steps_log,
                                "summary": summary,
                                "wrote_tests": wrote_tests,
                                "steps": step + 1,
                                "steps_log": steps_log,
                                "lint": lint_result,
                                "mypy": mypy_result,
                                "tsc": tsc_result,
                            },
                        }

                    return {
                        "ok": True,
                        "proposal": {
                            "patch_unified_diff": "",
                            "affected_files": all_affected,
                            "deleted_files": deleted_files,
                            "applied_directly": True,
                            "summary": summary + mypy_note + tsc_note,
                            "wrote_tests": wrote_tests,
                            "steps": step + 1,
                            "steps_log": steps_log,
                            "lint": lint_result,
                            "mypy": mypy_result,
                            "tsc": tsc_result,
                        },
                    }
                task_done_called = True
            else:
                tool_result = f"ERROR: unknown tool '{tool_name}'"

            # Checkpoint после каждой записи
            if is_write_op and task_id:
                _save_checkpoint(task_id, step, affected_files)

            # Добавляем результат в историю
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": str(tool_result)[:8000],
            })

            # [#6] Publish tool result event
            _publish_stream(task_id, "tool_result", {
                "step": step,
                "tool": tool_name,
                "result_preview": str(tool_result)[:200],
            })

            # [#1] Авто-подсказка при ошибке edit/append
            tool_result_str = str(tool_result)
            if tool_name in ("edit_file", "append_file") and tool_result_str.startswith("ERROR:"):
                has_error = True
                if not last_tool_was_error:
                    messages.append({
                        "role": "user",
                        "content": (
                            f"The {tool_name} failed. IMMEDIATELY call read_file('{tool_args.get('path', '')}') "
                            f"to get the exact current content, then retry."
                        ),
                    })

        last_tool_was_error = has_error and not is_write_op

    log.warning(f"ReAct loop exceeded {max_steps} steps without task_done")
    _publish_stream(task_id, "error", {"message": f"max_steps_{max_steps}_exceeded"})
    return {
        "ok": False,
        "error": f"max_steps_{max_steps}_exceeded",
        "partial": {"affected_files": affected_files, "steps_log": steps_log},
    }


# ---------------------------------------------------------------------------
# [v7 #8] Resume from checkpoint — standalone function
# ---------------------------------------------------------------------------

def resume_from_checkpoint(task_id: str, workspace_root: str = _WORKSPACE_ROOT) -> Dict[str, Any]:
    """[v7 #8] Читаем checkpoint из Redis и возвращаем состояние для продолжения."""
    r = _get_redis()
    if r is None:
        return {"ok": False, "error": "redis not available"}
    key = f"agent:checkpoint:{task_id}"
    data = r.hgetall(key)
    if not data:
        return {"ok": False, "error": "no checkpoint found"}
    return {
        "ok": True,
        "step": int(data.get("step", 0)),
        "affected_files": json.loads(data.get("affected_files", "[]")),
        "ts": float(data.get("ts", 0)),
    }


# ---------------------------------------------------------------------------
# Основная точка входа
# ---------------------------------------------------------------------------

async def generate_code_patch_proposal(
    *,
    ai_config: str,
    rewrite_plan: Dict[str, Any],
    allowlist_files: List[str],
    workspace_root: str = _WORKSPACE_ROOT,
    task_id: str = "",
    progress_callback: Optional[Callable] = None,
    dry_run: bool = False,
    allowlist: Optional[List[str]] = None,
    max_retries: int = 2,
    resume_task_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Главная функция агента. Запускает ReAct Tool Loop v7.

    Args:
        dry_run: если True, файлы не записываются на диск (preview mode)
        allowlist: список разрешённых путей для записи (пустой = без ограничений)
        max_retries: максимальное число повторных попыток при неудаче (v7 #7)
        resume_task_id: task_id для восстановления из checkpoint (v7 #8)
    """
    from backend.services.ai_service import get_client_and_model

    try:
        client, model = get_client_and_model(ai_config, role="code")
    except Exception as e:
        return {"ok": False, "error": f"ai_client_init_failed: {e}"}

    summary = rewrite_plan.get("summary", {})
    task_type = str(summary.get("task_type") or "backend")
    title = str(summary.get("title") or "")
    description = str(summary.get("description") or "")
    hypotheses = rewrite_plan.get("hypotheses", [])
    if hypotheses:
        description = str(hypotheses[0].get("proposed_change") or description)

    if not title and not description:
        return {"ok": False, "error": "empty_task_description"}

    effective_allowlist = allowlist or allowlist_files or []

    # [v7 #8] Resume from checkpoint if requested
    if resume_task_id:
        checkpoint = resume_from_checkpoint(resume_task_id, workspace_root)
        if checkpoint.get("ok"):
            step = checkpoint["step"]
            prev_files = checkpoint["affected_files"]
            resume_note = (
                f"\n\nRESUME: Previously completed {step} steps and modified {prev_files}. "
                f"Continue from where you left off."
            )
            description = description + resume_note
            log.info(f"Resuming task {resume_task_id} from step {step}, files: {prev_files}")
        else:
            log.info(f"Could not load checkpoint for {resume_task_id}: {checkpoint.get('error')}")
            prev_files = []

    conventions = _load_conventions(workspace_root)
    knowledge_context = _build_knowledge_context(rewrite_plan)
    file_tree = _build_file_tree(workspace_root)
    tests_list = _list_tests(workspace_root)
    baseline_tests = _run_baseline_tests(workspace_root)
    memory_context = _load_memory_context(description or title, workspace_root)  # [#5]

    # [#5] Task decomposition — try to split into parallel subtasks
    subtasks = await _decompose_task(client, model, title, description)

    if len(subtasks) >= 2:
        log.info(f"Decomposed into {len(subtasks)} subtasks: {[s['title'] for s in subtasks]}")
        subagent_tasks = [
            _run_subagent(
                subtask_title=s["title"],
                subtask_description=s["description"],
                client=client,
                model=model,
                workspace_root=workspace_root,
                conventions=conventions,
                task_id=task_id,
                dry_run=dry_run,
                allowlist=effective_allowlist,
            )
            for s in subtasks
        ]
        results = await asyncio.gather(*subagent_tasks, return_exceptions=True)

        # Merge results from all subagents
        merged_affected: List[str] = []
        merged_deleted: List[str] = []
        merged_steps_log: List[str] = []
        all_ok = True
        errors = []

        for i, res in enumerate(results):
            if isinstance(res, Exception):
                all_ok = False
                errors.append(f"Subagent {i} exception: {res}")
                continue
            if not isinstance(res, dict):
                continue
            if not res.get("ok"):
                all_ok = False
                errors.append(f"Subagent {i} failed: {res.get('error', 'unknown')}")
            proposal = res.get("proposal", {})
            for f in proposal.get("affected_files", []):
                if f not in merged_affected:
                    merged_affected.append(f)
            for f in proposal.get("deleted_files", []):
                if f not in merged_deleted:
                    merged_deleted.append(f)
            merged_steps_log.extend(proposal.get("steps_log", []))

        return {
            "ok": all_ok,
            "proposal": {
                "patch_unified_diff": "",
                "affected_files": merged_affected,
                "deleted_files": merged_deleted,
                "applied_directly": not dry_run,
                "dry_run": dry_run,
                "summary": f"Decomposed into {len(subtasks)} subtasks. Errors: {errors}" if errors else f"Completed {len(subtasks)} subtasks.",
                "steps_log": merged_steps_log,
                "subtasks": len(subtasks),
            },
            "errors": errors if errors else None,
        }

    # Single agent path — with retry + reflection [v7 #7]
    current_description = description
    retry_count = 0

    while True:
        result = await _react_agent_loop(
            client=client,
            model=model,
            task_title=title,
            task_description=current_description,
            task_type=task_type,
            workspace_root=workspace_root,
            conventions=conventions,
            knowledge_context=knowledge_context,
            file_tree=file_tree,
            tests_list=tests_list,
            baseline_tests=baseline_tests,
            memory_context=memory_context,
            task_id=task_id,
            progress_callback=progress_callback,
            dry_run=dry_run,
            allowlist=effective_allowlist,
        )

        if result.get("ok"):
            # [v7 #10] Run reviewer agent after successful task
            proposal = result.get("proposal", {})
            all_affected = proposal.get("affected_files", [])
            task_summary = proposal.get("summary", title)
            try:
                review_result = await _run_reviewer_agent(
                    client=client,
                    model=model,
                    affected_files=all_affected,
                    workspace_root=workspace_root,
                    task_summary=task_summary,
                )
                result["code_review"] = review_result
                if review_result.get("has_issues"):
                    log.warning(
                        f"Reviewer found potential issues: "
                        f"{review_result.get('review', '')[:200]}"
                    )
            except Exception as e:
                log.info(f"Reviewer agent error (non-fatal): {e}")
                result["code_review"] = {"ok": False, "review": str(e), "has_issues": False}
            return result

        # Task failed
        error = result.get("error", "unknown error")
        partial = result.get("partial", {})
        steps_log = partial.get("steps_log", [])

        if retry_count >= max_retries:
            log.warning(f"Task failed after {retry_count} retries: {error}")
            return result

        # [v7 #7] Reflect on failure and retry
        log.info(f"Task failed (attempt {retry_count + 1}/{max_retries}): {error}. Reflecting...")
        reflection = await _reflect_on_failure(
            client=client,
            model=model,
            task_title=title,
            task_description=current_description,
            error=error,
            steps_log=steps_log,
            workspace_root=workspace_root,
        )

        if reflection:
            current_description = (
                current_description
                + f"\n\n## REFLECTION FROM PREVIOUS ATTEMPT (attempt {retry_count + 1})\n"
                + reflection
            )
            log.info(f"Retrying with reflection: {reflection[:200]}")
        else:
            log.info("No reflection obtained, retrying without modification")

        retry_count += 1


def _build_knowledge_context(rewrite_plan: Dict[str, Any]) -> str:
    hits_by_ns = rewrite_plan.get("knowledge_hits", {})
    if not hits_by_ns:
        return ""
    parts = ["## RELEVANT DOCUMENTATION"]
    for ns, hits in hits_by_ns.items():
        for h in (hits or [])[:2]:
            if isinstance(h, dict) and h.get("content_excerpt"):
                src = h.get("source_uri") or h.get("title") or ns
                parts.append(f"\nSource: {src}\n{h['content_excerpt'][:1000]}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Утилиты применения патчей (обратная совместимость)
# ---------------------------------------------------------------------------

def _validate_file_paths(edit_ops: List[Dict], workspace_root: str) -> Tuple[bool, str]:
    for op in edit_ops:
        rel_path = op.get("file_path", "")
        if not rel_path:
            return False, "edit_op missing file_path"
        if _safe_resolve(rel_path, workspace_root) is None:
            return False, f"Path traversal: {rel_path}"
        is_new = op.get("new_file", False)
        if not is_new and not (Path(workspace_root) / rel_path).exists():
            return False, f"File does not exist: {rel_path}"
    return True, ""


def _build_diff_from_edit_ops(edit_ops: List[Dict], workspace_root: str) -> Tuple[str, List[str]]:
    all_diffs = []
    affected = []
    for op in edit_ops:
        rel_path = op.get("file_path", "")
        old_snip = op.get("old_snippet", "")
        new_snip = op.get("new_snippet", "")
        is_new_file = op.get("new_file", False)
        abs_path = Path(workspace_root) / rel_path
        if is_new_file:
            old_content = ""
        else:
            if not abs_path.exists():
                continue
            old_content = abs_path.read_text(encoding="utf-8", errors="replace")
        if old_snip and not is_new_file:
            if old_content.count(old_snip) == 0:
                s1 = "\n".join(l.rstrip() for l in old_snip.splitlines())
                s2 = "\n".join(l.rstrip() for l in old_content.splitlines())
                if s2.count(s1) == 1:
                    new_content = s2.replace(s1, new_snip)
                else:
                    continue
            else:
                new_content = old_content.replace(old_snip, new_snip, 1)
        elif is_new_file:
            new_content = new_snip
        else:
            new_content = new_snip
        old_lines = old_content.splitlines(keepends=True)
        new_lines = new_content.splitlines(keepends=True)
        diff = list(difflib.unified_diff(old_lines, new_lines, fromfile=f"a/{rel_path}", tofile=f"b/{rel_path}", lineterm=""))
        if diff:
            all_diffs.append("\n".join(diff))
            affected.append(rel_path)
    return "\n".join(all_diffs), affected


def _apply_edit_ops_directly(edit_ops: List[Dict], workspace_root: str) -> Tuple[bool, str]:
    ok, err = _validate_file_paths(edit_ops, workspace_root)
    if not ok:
        return False, f"Path validation failed: {err}"
    applied = []
    for i, op in enumerate(edit_ops):
        rel_path = op.get("file_path", "")
        old_snip = op.get("old_snippet", "")
        new_snip = op.get("new_snippet", "")
        is_new_file = op.get("new_file", False)
        abs_path = Path(workspace_root) / rel_path
        try:
            if is_new_file:
                syn_ok, syn_err = _validate_python_syntax(new_snip, rel_path)
                if not syn_ok:
                    return False, syn_err
                abs_path.parent.mkdir(parents=True, exist_ok=True)
                abs_path.write_text(new_snip, encoding="utf-8")
                applied.append(rel_path)
                continue
            if not abs_path.exists():
                return False, f"Op[{i}] file not found: {rel_path}"
            content = abs_path.read_text(encoding="utf-8", errors="replace")
            if not old_snip:
                abs_path.write_text(new_snip, encoding="utf-8")
                applied.append(rel_path)
                continue
            count = content.count(old_snip)
            if count == 0:
                s1 = "\n".join(l.rstrip() for l in old_snip.splitlines())
                s2 = "\n".join(l.rstrip() for l in content.splitlines())
                if s2.count(s1) == 1:
                    new_content = s2.replace(s1, new_snip)
                else:
                    return False, f"Op[{i}] snippet not found in {rel_path}"
            elif count > 1:
                return False, f"Op[{i}] snippet ambiguous in {rel_path}"
            else:
                new_content = content.replace(old_snip, new_snip, 1)
            syn_ok, syn_err = _validate_python_syntax(new_content, rel_path)
            if not syn_ok:
                return False, syn_err
            abs_path.write_text(new_content, encoding="utf-8")
            applied.append(rel_path)
        except Exception as e:
            return False, f"Op[{i}] error: {e}"
    return True, f"Applied {len(applied)} ops"


def apply_patch(patch_content: str, repo_path: str) -> Tuple[bool, str]:
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.patch', delete=False) as f:
            f.write(patch_content)
            patch_file = f.name
        result = subprocess.run(['git', 'apply', '--check', patch_file], cwd=repo_path, capture_output=True, text=True)
        if result.returncode != 0:
            os.unlink(patch_file)
            return False, f"Patch check failed: {result.stderr}"
        result = subprocess.run(['git', 'apply', patch_file], cwd=repo_path, capture_output=True, text=True)
        os.unlink(patch_file)
        if result.returncode != 0:
            return False, f"Patch apply failed: {result.stderr}"
        return True, ""
    except Exception as e:
        return False, str(e)


def apply_fallback_edit_ops(edit_ops: List[Dict], repo_path: str) -> Tuple[bool, str]:
    return _apply_edit_ops_directly(edit_ops, repo_path)


def run_code_patch_agent(task_id: str, patch_content: str, repo_path: str) -> Dict:
    success, error = apply_patch(patch_content, repo_path)
    if success:
        return {"status": "success", "message": "Patch applied successfully"}
    log.warning(f"Patch apply failed: {error}, attempting fallback")
    edit_ops = []
    lines = patch_content.split('\n')
    current_file = None
    old_lines_acc: List[str] = []
    new_lines_acc: List[str] = []
    for line in lines:
        if line.startswith('--- '):
            current_file = line[4:].strip()
        elif line.startswith('+++ '):
            continue
        elif line.startswith('@@'):
            if current_file and (old_lines_acc or new_lines_acc):
                edit_ops.append({'file_path': current_file, 'old_snippet': '\n'.join(old_lines_acc), 'new_snippet': '\n'.join(new_lines_acc)})
                old_lines_acc, new_lines_acc = [], []
        elif line.startswith('-'):
            old_lines_acc.append(line[1:])
        elif line.startswith('+'):
            new_lines_acc.append(line[1:])
        else:
            if old_lines_acc or new_lines_acc:
                old_lines_acc.append(line)
                new_lines_acc.append(line)
    if current_file and (old_lines_acc or new_lines_acc):
        edit_ops.append({'file_path': current_file, 'old_snippet': '\n'.join(old_lines_acc), 'new_snippet': '\n'.join(new_lines_acc)})
    if not edit_ops:
        return {"status": "error", "message": error}
    success2, err2 = apply_fallback_edit_ops(edit_ops, repo_path)
    if success2:
        return {"status": "success_fallback", "message": "Applied via fallback"}
    return {"status": "error", "message": f"Both failed. Patch: {error}. Fallback: {err2}"}
