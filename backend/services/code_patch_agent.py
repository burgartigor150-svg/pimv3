"""
code_patch_agent.py — ReAct Tool Loop агент для генерации кода.

Архитектура: LLM получает 7 инструментов и работает в цикле до 30 шагов.
На каждом шаге LLM:
  1. Читает нужные файлы (read_file, list_dir, search_code)
  2. Пишет/редактирует код (write_file, edit_file)
  3. Запускает тесты и видит реальный вывод (run_shell)
  4. Сам исправляет ошибки если тесты упали
  5. Завершает когда всё готово (task_done)
"""
from __future__ import annotations

import ast
import difflib
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger(__name__)

_WORKSPACE_ROOT = os.getenv("PIM_WORKSPACE_ROOT", "/mnt/data/Pimv3")
_MAX_FILE_READ_CHARS = 12_000
_MAX_SHELL_OUTPUT_CHARS = 6_000
_MAX_REACT_STEPS = 30

# Белый список разрешённых команд для run_shell
_ALLOWED_SHELL_PREFIXES = (
    "python3 -m pytest",
    "python3 -c",
    "python -m pytest",
    "npm run build",
    "npm run lint",
    "grep ",
    "find ",
    "ls ",
    "cat ",
    "head ",
    "tail ",
)

# Файлы ядра — всегда включаем в начальный контекст
_CORE_CONTEXT_FILES = [
    "backend/main.py",
    "backend/models.py",
    "backend/schemas.py",
    "backend/services/adapters.py",
    "backend/services/ai_service.py",
    "backend/database.py",
    "frontend/src/lib/api.ts",
]

_MAX_FILE_CHARS = 6000
_MAX_CONTEXT_FILES = 15
_MAX_CODE_CONTEXT_CHARS = 60_000


# ---------------------------------------------------------------------------
# Инструменты агента
# ---------------------------------------------------------------------------

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the content of a file. Use this BEFORE editing any file to see its current state.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to project root (e.g. backend/services/adapters.py)"
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List files and directories at a path. Use to explore project structure.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path relative to project root"
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_code",
            "description": "Search for a pattern in project files using grep. Use to find class definitions, function signatures, import statements.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search pattern (literal string or regex)"
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory or file to search in (default: backend/)"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create a new file or completely overwrite an existing one. Use for NEW files. For editing existing files, prefer edit_file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to project root"
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete file content to write"
                    }
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": "Make a targeted edit to an existing file by replacing an exact snippet. Always read_file first to get the exact current content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to project root"
                    },
                    "old_snippet": {
                        "type": "string",
                        "description": "EXACT text to replace — must match character-for-character including whitespace"
                    },
                    "new_snippet": {
                        "type": "string",
                        "description": "New text to insert in place of old_snippet"
                    }
                },
                "required": ["path", "old_snippet", "new_snippet"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_shell",
            "description": "Run a shell command and see its output. Allowed: pytest, python3 -c, npm run build/lint, grep, find, ls. Use to run tests and verify your changes work.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to run"
                    }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "task_done",
            "description": "Signal that the task is complete. Call this ONLY after verifying that tests pass. Provide a summary of what was implemented.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Summary of what was implemented"
                    },
                    "affected_files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of files that were created or modified"
                    },
                    "wrote_tests": {
                        "type": "boolean",
                        "description": "Whether new tests were written for the implementation"
                    }
                },
                "required": ["summary", "affected_files"]
            }
        }
    }
]


# ---------------------------------------------------------------------------
# Исполнение инструментов
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
            prefix = "📁" if e.is_dir() else "📄"
            lines.append(f"{prefix} {e.name}")
        if len(list(abs_path.iterdir())) > 120:
            lines.append("... (truncated)")
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

        # Показываем контекст из первых 5 файлов
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


def _tool_write_file(path: str, content: str, workspace_root: str) -> Tuple[str, Optional[str]]:
    """Returns (message, affected_file_or_None)"""
    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}", None

    # [FIX-2] Синтакс до записи
    if path.endswith(".py"):
        ok, err = _validate_python_syntax(content, path)
        if not ok:
            return f"ERROR: syntax validation failed — {err}\nFix the syntax error before writing.", None

    # [FIX-6] Проверка импортов
    if path.endswith(".py"):
        import_err = _check_new_imports(content, workspace_root)
        if import_err:
            return f"WARNING: unresolvable imports detected: {import_err}\nMake sure all imports exist.", None

    try:
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(content, encoding="utf-8")
        action = "Created" if not abs_path.exists() else "Written"
        return f"OK: {action} {path} ({len(content)} chars)", path
    except Exception as e:
        return f"ERROR writing {path}: {e}", None


def _tool_edit_file(path: str, old_snippet: str, new_snippet: str, workspace_root: str) -> Tuple[str, Optional[str]]:
    """Returns (message, affected_file_or_None)"""
    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}", None
    if not abs_path.exists():
        return f"ERROR: file not found: {path}. Use write_file to create new files.", None

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"ERROR reading {path}: {e}", None

    count = content.count(old_snippet)
    if count == 0:
        # Попытка с нормализацией пробелов
        old_norm = "\n".join(l.rstrip() for l in old_snippet.splitlines())
        content_norm = "\n".join(l.rstrip() for l in content.splitlines())
        if content_norm.count(old_norm) == 1:
            new_content = content_norm.replace(old_norm, new_snippet, 1)
        else:
            # Показываем похожие строки для диагностики
            first_line = old_snippet.splitlines()[0][:60] if old_snippet else ""
            hint = ""
            if first_line:
                idx = content.find(first_line[:30])
                if idx != -1:
                    hint = f"\nNearby content found at char {idx}:\n{content[max(0,idx-100):idx+200]}"
            return (
                f"ERROR: old_snippet not found in {path} (0 matches).{hint}\n"
                f"Use read_file('{path}') to get the EXACT current content, then retry.",
                None
            )
    elif count > 1:
        return f"ERROR: old_snippet matches {count} times in {path}. Make it more specific.", None
    else:
        new_content = content.replace(old_snippet, new_snippet, 1)

    # [FIX-2] Синтакс до записи
    if path.endswith(".py"):
        ok, err = _validate_python_syntax(new_content, path)
        if not ok:
            return f"ERROR: syntax validation failed after edit — {err}\nFix the syntax before applying.", None

    try:
        abs_path.write_text(new_content, encoding="utf-8")
        lines_changed = abs(len(new_snippet.splitlines()) - len(old_snippet.splitlines()))
        return f"OK: edited {path} (+/-{lines_changed} lines)", path
    except Exception as e:
        return f"ERROR writing {path}: {e}", None


def _tool_run_shell(command: str, workspace_root: str) -> str:
    # [FIX] Белый список команд
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
        return f"ERROR: command timed out after 120s: {command}"
    except Exception as e:
        return f"ERROR running '{command}': {e}"


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _safe_resolve(rel_path: str, workspace_root: str) -> Optional[Path]:
    """Защита от path traversal. Возвращает None если путь за пределами workspace."""
    try:
        base = Path(workspace_root).resolve()
        full = (base / rel_path).resolve()
        full.relative_to(base)  # бросит ValueError если за пределами
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
    """Проверяем что новые from backend.* импорты указывают на существующие модули."""
    errors = []
    for line in code.splitlines():
        line = line.strip()
        if not line.startswith("from backend.") and not line.startswith("import backend."):
            continue
        # Извлекаем модуль
        try:
            if line.startswith("from "):
                module = line.split()[1]
            else:
                module = line.split()[1].split(".")[0]
            # backend.services.foo → backend/services/foo.py
            mod_path = module.replace(".", "/") + ".py"
            full = Path(workspace_root) / mod_path
            if not full.exists():
                # Может быть пакет (папка)
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


def _read_file_safe(path: str, max_chars: int = _MAX_FILE_CHARS) -> Optional[str]:
    try:
        content = Path(path).read_text(encoding="utf-8", errors="replace")
        if len(content) > max_chars:
            half = max_chars // 2
            content = content[:half] + f"\n... [truncated] ...\n" + content[-half:]
        return content
    except Exception:
        return None


def _build_initial_context(workspace_root: str, task_type: str, description: str) -> str:
    """Строим начальный контекст из core-файлов + дерево проекта."""
    parts = []

    # Дерево файлов
    try:
        result = subprocess.run(
            ["find", "backend", "frontend/src", "-type", "f",
             "-name", "*.py", "-o", "-name", "*.ts", "-o", "-name", "*.tsx",
             "-not", "-path", "*/__pycache__/*", "-not", "-path", "*/node_modules/*"],
            cwd=workspace_root, capture_output=True, text=True, timeout=10
        )
        tree = result.stdout[:3000]
        parts.append(f"## PROJECT FILE TREE\n{tree}")
    except Exception:
        pass

    # Core файлы
    total_chars = 0
    for rel in _CORE_CONTEXT_FILES:
        if total_chars > _MAX_CODE_CONTEXT_CHARS:
            break
        abs_p = Path(workspace_root) / rel
        content = _read_file_safe(str(abs_p))
        if content:
            block = f"\n## FILE: {rel}\n```\n{content}\n```\n"
            parts.append(block)
            total_chars += len(block)

    return "\n".join(parts)


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
    initial_context: str,
    max_steps: int = _MAX_REACT_STEPS,
) -> Dict[str, Any]:
    """
    ReAct (Reasoning + Acting) цикл.
    LLM выбирает инструмент → выполняем → результат назад в LLM → следующий шаг.
    """
    system_prompt = f"""You are an expert software engineer working on PIMv3 — a Python/FastAPI + React/TypeScript product information management system for Russian e-commerce marketplaces (Ozon, Wildberries, Yandex Market, Megamarket).

You have access to tools to explore and modify the codebase. Work like a skilled developer:
1. EXPLORE first — read relevant files before making changes
2. PLAN your changes — understand what exists before modifying
3. IMPLEMENT incrementally — make focused, targeted changes
4. VERIFY — run tests after each significant change
5. FIX issues — if tests fail, read the error, understand the root cause, fix it
6. Call task_done only when tests pass

WORKFLOW:
- Start by reading key files to understand the current structure
- Search for existing patterns you should follow
- Make changes using edit_file (for existing files) or write_file (for new files)
- After implementing, run: python3 -m pytest backend/tests/ -q --tb=short
- If tests fail, read the error and fix the specific issue
- Write tests for new code when appropriate
- Call task_done when everything works{conventions}

{knowledge_context}

## INITIAL CODEBASE CONTEXT
{initial_context}
"""

    user_message = f"""Task: {task_title}

{task_description}

Start by exploring the relevant parts of the codebase, then implement the task step by step.
Run tests when you're done to verify everything works correctly."""

    messages: List[Dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    affected_files: List[str] = []
    steps_log: List[str] = []

    for step in range(max_steps):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=TOOLS_SCHEMA,
                tool_choice="required",
                temperature=0.1,
                max_tokens=4000,
            )
        except Exception as e:
            log.error(f"ReAct step {step} LLM error: {e}")
            return {"ok": False, "error": f"llm_error_at_step_{step}: {e}"}

        msg = response.choices[0].message
        tool_calls = msg.tool_calls

        if not tool_calls:
            # Если LLM ответил текстом без tool call — подталкиваем
            content = msg.content or ""
            log.warning(f"Step {step}: no tool call, content: {content[:200]}")
            messages.append({"role": "assistant", "content": content})
            messages.append({
                "role": "user",
                "content": "You must use one of the provided tools. If the task is complete, call task_done."
            })
            continue

        # Берём первый tool call
        tc = tool_calls[0]
        tool_name = tc.function.name
        try:
            tool_args = json.loads(tc.function.arguments or "{}")
        except json.JSONDecodeError:
            tool_args = {}

        log.info(f"ReAct step {step}: {tool_name}({list(tool_args.keys())})")
        steps_log.append(f"Step {step}: {tool_name}")

        # Добавляем вызов инструмента в историю
        messages.append({
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tool_name, "arguments": tc.function.arguments},
                }
            ],
        })

        # Выполняем инструмент
        tool_result = ""
        if tool_name == "read_file":
            tool_result = _tool_read_file(tool_args.get("path", ""), workspace_root)

        elif tool_name == "list_dir":
            tool_result = _tool_list_dir(tool_args.get("path", ""), workspace_root)

        elif tool_name == "search_code":
            tool_result = _tool_search_code(
                tool_args.get("query", ""),
                tool_args.get("path"),
                workspace_root,
            )

        elif tool_name == "write_file":
            msg_str, affected = _tool_write_file(
                tool_args.get("path", ""),
                tool_args.get("content", ""),
                workspace_root,
            )
            tool_result = msg_str
            if affected and affected not in affected_files:
                affected_files.append(affected)

        elif tool_name == "edit_file":
            msg_str, affected = _tool_edit_file(
                tool_args.get("path", ""),
                tool_args.get("old_snippet", ""),
                tool_args.get("new_snippet", ""),
                workspace_root,
            )
            tool_result = msg_str
            if affected and affected not in affected_files:
                affected_files.append(affected)

        elif tool_name == "run_shell":
            tool_result = _tool_run_shell(tool_args.get("command", ""), workspace_root)

        elif tool_name == "task_done":
            summary = tool_args.get("summary", "")
            done_files = tool_args.get("affected_files", [])
            wrote_tests = tool_args.get("wrote_tests", False)
            # Объединяем с тем что реально изменили
            all_affected = list(set(affected_files + done_files))
            log.info(f"ReAct task_done after {step} steps. Files: {all_affected}")
            return {
                "ok": True,
                "proposal": {
                    "patch_unified_diff": "",
                    "affected_files": all_affected,
                    "applied_directly": True,
                    "summary": summary,
                    "wrote_tests": wrote_tests,
                    "steps": step + 1,
                    "steps_log": steps_log,
                },
            }
        else:
            tool_result = f"ERROR: unknown tool '{tool_name}'"

        # Добавляем результат в историю
        messages.append({
            "role": "tool",
            "tool_call_id": tc.id,
            "content": str(tool_result)[:8000],
        })

    # Превышен лимит шагов
    log.warning(f"ReAct loop exceeded {max_steps} steps without task_done")
    return {
        "ok": False,
        "error": f"max_steps_{max_steps}_exceeded",
        "partial": {
            "affected_files": affected_files,
            "steps_log": steps_log,
        },
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
    max_retries: int = 3,
) -> Dict[str, Any]:
    """
    Главная функция агента. Запускает ReAct Tool Loop.

    Вместо одноразовой генерации кода, LLM итеративно:
    - читает файлы, исследует структуру
    - пишет/редактирует код
    - запускает тесты и видит реальный вывод
    - сам исправляет ошибки
    - завершает когда тесты зелёные
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

    conventions = _load_conventions(workspace_root)
    knowledge_context = _build_knowledge_context(rewrite_plan)
    initial_context = _build_initial_context(workspace_root, task_type, description)

    return await _react_agent_loop(
        client=client,
        model=model,
        task_title=title,
        task_description=description,
        task_type=task_type,
        workspace_root=workspace_root,
        conventions=conventions,
        knowledge_context=knowledge_context,
        initial_context=initial_context,
    )


# ---------------------------------------------------------------------------
# Утилиты применения патчей (используются извне)
# ---------------------------------------------------------------------------

def _validate_file_paths(edit_ops: List[Dict], workspace_root: str) -> Tuple[bool, str]:
    for op in edit_ops:
        rel_path = op.get("file_path", "")
        if not rel_path:
            return False, "edit_op missing file_path"
        if _safe_resolve(rel_path, workspace_root) is None:
            return False, f"Path traversal detected: {rel_path}"
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
                old_snip_stripped = "\n".join(l.rstrip() for l in old_snip.splitlines())
                old_content_stripped = "\n".join(l.rstrip() for l in old_content.splitlines())
                if old_content_stripped.count(old_snip_stripped) == 1:
                    new_content = old_content_stripped.replace(old_snip_stripped, new_snip)
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
        diff = list(difflib.unified_diff(
            old_lines, new_lines,
            fromfile=f"a/{rel_path}", tofile=f"b/{rel_path}", lineterm="",
        ))
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
                syn_ok, syn_err = _validate_python_syntax(new_snip, rel_path)
                if not syn_ok:
                    return False, syn_err
                abs_path.write_text(new_snip, encoding="utf-8")
                applied.append(rel_path)
                continue

            count = content.count(old_snip)
            if count == 0:
                old_stripped = "\n".join(l.rstrip() for l in old_snip.splitlines())
                content_stripped = "\n".join(l.rstrip() for l in content.splitlines())
                if content_stripped.count(old_stripped) == 1:
                    new_content = content_stripped.replace(old_stripped, new_snip)
                    syn_ok, syn_err = _validate_python_syntax(new_content, rel_path)
                    if not syn_ok:
                        return False, syn_err
                    abs_path.write_text(new_content, encoding="utf-8")
                    applied.append(rel_path)
                    continue
                return False, f"Op[{i}] snippet not found in {rel_path}"
            if count > 1:
                return False, f"Op[{i}] snippet ambiguous ({count} matches) in {rel_path}"

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

        result = subprocess.run(
            ['git', 'apply', '--check', patch_file],
            cwd=repo_path, capture_output=True, text=True,
        )
        if result.returncode != 0:
            os.unlink(patch_file)
            return False, f"Patch check failed: {result.stderr}"

        result = subprocess.run(
            ['git', 'apply', patch_file],
            cwd=repo_path, capture_output=True, text=True,
        )
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

    log.warning(f"Patch apply failed: {error}, attempting fallback edit ops")
    edit_ops = []
    lines = patch_content.split('\n')
    current_file = None
    old_lines: List[str] = []
    new_lines: List[str] = []

    for line in lines:
        if line.startswith('--- '):
            current_file = line[4:].strip()
        elif line.startswith('+++ '):
            continue
        elif line.startswith('@@'):
            if current_file and (old_lines or new_lines):
                edit_ops.append({
                    'file_path': current_file,
                    'old_snippet': '\n'.join(old_lines),
                    'new_snippet': '\n'.join(new_lines),
                })
                old_lines, new_lines = [], []
        elif line.startswith('-'):
            old_lines.append(line[1:])
        elif line.startswith('+'):
            new_lines.append(line[1:])
        else:
            if old_lines or new_lines:
                old_lines.append(line)
                new_lines.append(line)

    if current_file and (old_lines or new_lines):
        edit_ops.append({
            'file_path': current_file,
            'old_snippet': '\n'.join(old_lines),
            'new_snippet': '\n'.join(new_lines),
        })

    success, error = apply_fallback_edit_ops(edit_ops, repo_path)
    if success:
        return {"status": "success", "message": "Fallback edit ops applied successfully"}
    return {"status": "error", "error": error}
