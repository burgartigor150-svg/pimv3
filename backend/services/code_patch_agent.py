"""
code_patch_agent.py — ReAct Tool Loop агент для генерации кода.

Архитектура: LLM получает 8 инструментов и работает в цикле до 30 шагов.
На каждом шаге LLM:
  1. Читает нужные файлы (read_file, list_dir, search_code)
  2. Пишет/редактирует код (write_file, edit_file, append_file)
  3. Запускает тесты и видит реальный вывод (run_shell)
  4. Сам исправляет ошибки если тесты упали
  5. Завершает когда всё готово (task_done)

Улучшения v4:
  - [#1] Авто-retry при edit_file ERROR: системное сообщение после ошибки
  - [#2] Инструмент append_file для добавления в конец файла
  - [#3] Компрессия истории сообщений при переполнении
  - [#4] Явные инструкции по написанию тестов в промпте
  - [#5] Baseline pytest перед стартом агента
  - [#6] Progress callback для обновления Redis
  - [#7] Ленивая загрузка контекста (только дерево файлов + тесты в начале)
  - [#8] Список тестов в системном промпте
  - [#9] Checkpoint в Redis после каждого write/edit
  - [#10] Ruff lint после task_done
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
from typing import Any, Callable, Dict, List, Optional, Tuple

import redis

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
    "ruff check",
    "ruff format",
    "grep ",
    "find ",
    "ls ",
    "cat ",
    "head ",
    "tail ",
)

# Максимальное количество сообщений до компрессии
_MAX_MESSAGES_BEFORE_COMPRESS = 40
# Сколько последних сообщений оставляем нетронутыми при компрессии
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
            "description": "Create a new file or completely overwrite an existing one. Use for NEW files only. For editing existing files, prefer edit_file or append_file.",
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
            "description": "Make a targeted edit to an existing file by replacing an exact snippet. ALWAYS call read_file first to get the exact current content before editing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to project root"
                    },
                    "old_snippet": {
                        "type": "string",
                        "description": "EXACT text to replace — must match character-for-character including whitespace and indentation"
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
            "name": "append_file",
            "description": "Append content to the end of an existing file, or after a specific pattern. Use for adding new routes, functions, imports without rewriting the whole file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to project root"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to append"
                    },
                    "after_pattern": {
                        "type": "string",
                        "description": "Optional: insert AFTER the last occurrence of this pattern. If omitted, appends to end of file."
                    }
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_shell",
            "description": "Run a shell command and see its output. Allowed: pytest, python3 -c, npm run build/lint, ruff, grep, find, ls. Use to run tests and verify your changes work.",
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


def _tool_write_file(path: str, content: str, workspace_root: str) -> Tuple[str, Optional[str]]:
    """Returns (message, affected_file_or_None)"""
    abs_path = _safe_resolve(path, workspace_root)
    if abs_path is None:
        return f"ERROR: path traversal: {path}", None

    if path.endswith(".py"):
        ok, err = _validate_python_syntax(content, path)
        if not ok:
            return f"ERROR: syntax validation failed — {err}\nFix the syntax error before writing.", None
        import_err = _check_new_imports(content, workspace_root)
        if import_err:
            return f"WARNING: unresolvable imports detected: {import_err}\nMake sure all imports exist.", None

    try:
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(content, encoding="utf-8")
        return f"OK: Written {path} ({len(content)} chars)", path
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
            first_line = old_snippet.splitlines()[0][:60] if old_snippet else ""
            hint = ""
            if first_line:
                idx = content.find(first_line[:30])
                if idx != -1:
                    hint = f"\nNearby content found at char {idx}:\n{content[max(0,idx-100):idx+200]}"
            return (
                f"ERROR: old_snippet not found in {path} (0 matches).{hint}\n"
                f"IMPORTANT: Call read_file('{path}') first to get the EXACT current content, then retry edit_file with the correct snippet.",
                None
            )
    elif count > 1:
        return f"ERROR: old_snippet matches {count} times in {path}. Make the snippet more specific (include more context lines).", None
    else:
        new_content = content.replace(old_snippet, new_snippet, 1)

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


def _tool_append_file(path: str, content: str, after_pattern: Optional[str], workspace_root: str) -> Tuple[str, Optional[str]]:
    """Append content to file, optionally after a specific pattern."""
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
            return (
                f"ERROR: after_pattern not found in {path}: '{after_pattern[:60]}'\n"
                f"Appending to end of file instead — retry without after_pattern or use edit_file.",
                None
            )
        insert_pos = idx + len(after_pattern)
        new_content = existing[:insert_pos] + "\n" + content + existing[insert_pos:]
    else:
        separator = "\n" if existing.endswith("\n") else "\n\n"
        new_content = existing + separator + content

    if path.endswith(".py"):
        ok, err = _validate_python_syntax(new_content, path)
        if not ok:
            return f"ERROR: syntax validation failed after append — {err}", None

    try:
        abs_path.write_text(new_content, encoding="utf-8")
        return f"OK: appended {len(content)} chars to {path}", path
    except Exception as e:
        return f"ERROR writing {path}: {e}", None


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
    """Проверяем что новые from backend.* импорты указывают на существующие модули."""
    errors = []
    for line in code.splitlines():
        line = line.strip()
        if not line.startswith("from backend.") and not line.startswith("import backend."):
            continue
        try:
            if line.startswith("from "):
                module = line.split()[1]
            else:
                module = line.split()[1].split(".")[0]
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
            content = content[:half] + f"\n... [truncated] ...\n" + content[-half:]
        return content
    except Exception:
        return None


def _build_file_tree(workspace_root: str) -> str:
    """[#7] Только дерево файлов — контекст подгружается лениво через read_file."""
    try:
        result = subprocess.run(
            ["find", "backend", "frontend/src", "-type", "f",
             "(", "-name", "*.py", "-o", "-name", "*.ts", "-o", "-name", "*.tsx", ")",
             "-not", "-path", "*/__pycache__/*", "-not", "-path", "*/node_modules/*"],
            cwd=workspace_root, capture_output=True, text=True, timeout=10, shell=False
        )
        # fallback с shell=True если find не поддерживает скобки
        if result.returncode != 0:
            result = subprocess.run(
                "find backend frontend/src -type f \\( -name '*.py' -o -name '*.ts' -o -name '*.tsx' \\) "
                "! -path '*/__pycache__/*' ! -path '*/node_modules/*' 2>/dev/null | sort | head -200",
                cwd=workspace_root, capture_output=True, text=True, timeout=10, shell=True
            )
        tree = result.stdout[:4000]
        return f"## PROJECT FILE TREE\n{tree}"
    except Exception:
        return "## PROJECT FILE TREE\n(could not generate)"


def _list_tests(workspace_root: str) -> str:
    """[#8] Список существующих тест-файлов."""
    tests_dir = Path(workspace_root) / "backend" / "tests"
    if not tests_dir.exists():
        return ""
    files = sorted(tests_dir.glob("test_*.py"))
    if not files:
        return ""
    lines = [f"  - {f.name}" for f in files[:20]]
    return "## EXISTING TESTS\n" + "\n".join(lines) + f"\nTests directory: backend/tests/"


def _run_baseline_tests(workspace_root: str) -> str:
    """[#5] Прогоняем тесты до старта агента — показываем baseline."""
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


def _run_ruff_check(affected_files: List[str], workspace_root: str) -> Dict[str, Any]:
    """[#10] Запускаем ruff на изменённых файлах после task_done."""
    py_files = [f for f in affected_files if f.endswith(".py")]
    if not py_files:
        return {"ok": True, "skipped": True}
    try:
        result = subprocess.run(
            ["ruff", "check", "--select=E,F,W", "--output-format=text"] + py_files,
            cwd=workspace_root, capture_output=True, text=True, timeout=30
        )
        issues = (result.stdout or "").strip()
        passed = result.returncode == 0
        return {"ok": passed, "issues": issues[:2000] if issues else "", "files_checked": py_files}
    except FileNotFoundError:
        return {"ok": True, "skipped": True, "reason": "ruff not installed"}
    except Exception as e:
        return {"ok": True, "skipped": True, "reason": str(e)}


def _compress_messages(messages: List[Dict], keep_recent: int = _KEEP_RECENT_MESSAGES) -> List[Dict]:
    """[#3] Компрессия истории: схлопываем старые tool results в краткий summary."""
    if len(messages) <= keep_recent + 2:  # +2 для system + первого user
        return messages

    system_msg = messages[0]  # system всегда первый
    first_user = messages[1]  # task description
    recent = messages[-keep_recent:]
    middle = messages[2:-keep_recent]

    if not middle:
        return messages

    # Собираем краткий summary средней части
    summary_lines = ["[COMPRESSED HISTORY — earlier steps summary:]"]
    tool_counts: Dict[str, int] = {}
    written_files: List[str] = []
    errors: List[str] = []

    for m in middle:
        role = m.get("role", "")
        if role == "assistant":
            tcs = m.get("tool_calls") or []
            for tc in tcs:
                name = tc.get("function", {}).get("name", "")
                tool_counts[name] = tool_counts.get(name, 0) + 1
        elif role == "tool":
            content = str(m.get("content", ""))
            if content.startswith("OK: Written") or content.startswith("OK: edited") or content.startswith("OK: appended"):
                # Извлекаем имя файла
                parts = content.split(" ")
                if len(parts) > 2:
                    written_files.append(parts[2])
            elif content.startswith("ERROR:"):
                errors.append(content[:100])

    summary_lines.append(f"Tools called: {dict(tool_counts)}")
    if written_files:
        summary_lines.append(f"Files modified: {list(set(written_files))}")
    if errors:
        summary_lines.append(f"Errors encountered (resolved): {errors[:3]}")

    compressed_msg = {
        "role": "user",
        "content": "\n".join(summary_lines),
    }

    return [system_msg, first_user, compressed_msg] + recent


def _save_checkpoint(task_id: str, step: int, affected_files: List[str]) -> None:
    """[#9] Сохраняем checkpoint в Redis после каждого write/edit."""
    r = _get_redis()
    if r is None:
        return
    try:
        key = f"agent:checkpoint:{task_id}"
        r.hset(key, mapping={
            "step": str(step),
            "affected_files": json.dumps(affected_files),
            "ts": str(__import__("time").time()),
        })
        r.expire(key, 3600)
    except Exception:
        pass


def _update_progress(task_id: str, step: int, max_steps: int, tool_name: str, progress_callback: Optional[Callable]) -> None:
    """[#6] Обновляем прогресс в Redis и вызываем callback."""
    if not task_id:
        return
    # Прогресс от 55% до 90% в рамках шагов агента
    pct = 55 + int((step / max_steps) * 35)
    r = _get_redis()
    if r:
        try:
            r.hset(f"agent_task:{task_id}", mapping={
                "progress_percent": str(pct),
                "stage": f"react_step_{step}_{tool_name}",
                "updated_at_ts": str(int(__import__("time").time())),
            })
        except Exception:
            pass
    if progress_callback:
        try:
            progress_callback(step=step, tool=tool_name, progress=pct)
        except Exception:
            pass


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
    task_id: str = "",
    max_steps: int = _MAX_REACT_STEPS,
    progress_callback: Optional[Callable] = None,
) -> Dict[str, Any]:
    """
    ReAct (Reasoning + Acting) цикл.
    LLM выбирает инструмент → выполняем → результат назад в LLM → следующий шаг.
    """
    system_prompt = f"""You are an expert software engineer working on PIMv3 — a Python/FastAPI + React/TypeScript product information management system for Russian e-commerce marketplaces (Ozon, Wildberries, Yandex Market, Megamarket).

You have access to tools to explore and modify the codebase. Work like a skilled developer:
1. EXPLORE first — read relevant files before making changes
2. PLAN your changes — understand what exists before modifying
3. IMPLEMENT incrementally — use edit_file for existing files, write_file for new files, append_file for adding new functions/routes
4. TEST — run tests after each significant change: python3 -m pytest backend/tests/ -q --tb=short
5. FIX issues — if tests fail, read the error carefully, find the root cause, fix it
6. LINT — after implementation run: ruff check --select=E,F,W <your_files>
7. Call task_done only when tests pass and lint is clean

TOOL USAGE RULES:
- edit_file: ALWAYS call read_file first on the file you want to edit. Use exact content from read_file output.
- append_file: use to add new routes/functions/imports without touching existing code
- If edit_file returns ERROR about old_snippet not found: immediately call read_file again and retry with exact content
- write_file: only for NEW files, never overwrite existing important files

TEST WRITING:
- For every new feature or function, write a test in backend/tests/
- Test file naming: test_<feature_name>.py
- Use pytest with async support where needed
- Run your test before calling task_done{conventions}

{knowledge_context}

{file_tree}

{tests_list}

{baseline_tests}
"""

    user_message = f"""Task: {task_title}

{task_description}

Start by exploring the relevant parts of the codebase, then implement the task step by step.
Remember to write tests and run them before calling task_done."""

    messages: List[Dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    affected_files: List[str] = []
    steps_log: List[str] = []
    last_tool_was_error = False

    for step in range(max_steps):
        # [#3] Компрессия истории при переполнении
        if len(messages) > _MAX_MESSAGES_BEFORE_COMPRESS:
            messages = _compress_messages(messages)
            log.info(f"ReAct step {step}: compressed message history to {len(messages)} messages")

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
            content = msg.content or ""
            log.warning(f"Step {step}: no tool call, content: {content[:200]}")
            messages.append({"role": "assistant", "content": content})
            messages.append({
                "role": "user",
                "content": "You must use one of the provided tools. If the task is complete, call task_done."
            })
            continue

        tc = tool_calls[0]
        tool_name = tc.function.name
        try:
            tool_args = json.loads(tc.function.arguments or "{}")
        except json.JSONDecodeError:
            tool_args = {}

        log.info(f"ReAct step {step}: {tool_name}({list(tool_args.keys())})")
        steps_log.append(f"Step {step}: {tool_name}")

        # [#6] Обновляем прогресс
        _update_progress(task_id, step, max_steps, tool_name, progress_callback)

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
        is_write_op = False

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
                is_write_op = True

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
                is_write_op = True

        elif tool_name == "append_file":
            msg_str, affected = _tool_append_file(
                tool_args.get("path", ""),
                tool_args.get("content", ""),
                tool_args.get("after_pattern"),
                workspace_root,
            )
            tool_result = msg_str
            if affected and affected not in affected_files:
                affected_files.append(affected)
                is_write_op = True

        elif tool_name == "run_shell":
            tool_result = _tool_run_shell(tool_args.get("command", ""), workspace_root)

        elif tool_name == "task_done":
            summary = tool_args.get("summary", "")
            done_files = tool_args.get("affected_files", [])
            wrote_tests = tool_args.get("wrote_tests", False)
            all_affected = list(set(affected_files + done_files))

            # [#10] Запускаем ruff на изменённых файлах
            lint_result = _run_ruff_check(all_affected, workspace_root)
            if not lint_result.get("ok") and not lint_result.get("skipped"):
                # Есть lint-ошибки — возвращаем агенту чтобы исправил
                lint_issues = lint_result.get("issues", "")
                log.info(f"ReAct step {step}: ruff found issues, asking agent to fix")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": (
                        f"LINT CHECK FAILED before task_done:\n{lint_issues}\n\n"
                        f"Fix all lint errors, then call task_done again."
                    ),
                })
                steps_log.append(f"Step {step}: ruff_issues_found")
                continue

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
                    "lint": lint_result,
                },
            }
        else:
            tool_result = f"ERROR: unknown tool '{tool_name}'"

        # [#9] Checkpoint после каждой записи
        if is_write_op and task_id:
            _save_checkpoint(task_id, step, affected_files)

        # Добавляем результат в историю
        messages.append({
            "role": "tool",
            "tool_call_id": tc.id,
            "content": str(tool_result)[:8000],
        })

        # [#1] Авто-подсказка при ошибке edit_file: следующий шаг должен быть read_file
        tool_result_str = str(tool_result)
        if tool_name in ("edit_file", "append_file") and tool_result_str.startswith("ERROR:"):
            if not last_tool_was_error:  # избегаем бесконечного цикла подсказок
                messages.append({
                    "role": "user",
                    "content": (
                        f"The {tool_name} failed. You MUST call read_file('{tool_args.get('path', '')}') "
                        f"to get the current exact content of the file, then retry the edit with the correct snippet."
                    ),
                })
                last_tool_was_error = True
        else:
            last_tool_was_error = False

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
    task_id: str = "",
    progress_callback: Optional[Callable] = None,
) -> Dict[str, Any]:
    """
    Главная функция агента. Запускает ReAct Tool Loop.

    Вместо одноразовой генерации кода, LLM итеративно:
    - читает файлы, исследует структуру
    - пишет/редактирует код
    - запускает тесты и видит реальный вывод
    - сам исправляет ошибки
    - завершает когда тесты зелёные и lint чистый
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

    # [#7] Только дерево файлов — core файлы подгружаются лениво через read_file
    file_tree = _build_file_tree(workspace_root)
    # [#8] Список тестов
    tests_list = _list_tests(workspace_root)
    # [#5] Baseline тесты
    baseline_tests = _run_baseline_tests(workspace_root)

    return await _react_agent_loop(
        client=client,
        model=model,
        task_title=title,
        task_description=description,
        task_type=task_type,
        workspace_root=workspace_root,
        conventions=conventions,
        knowledge_context=knowledge_context,
        file_tree=file_tree,
        tests_list=tests_list,
        baseline_tests=baseline_tests,
        task_id=task_id,
        progress_callback=progress_callback,
    )


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

    if not edit_ops:
        return {"status": "error", "message": error}

    success, err2 = apply_fallback_edit_ops(edit_ops, repo_path)
    if success:
        return {"status": "success_fallback", "message": "Applied via fallback edit ops"}
    return {"status": "error", "message": f"Both methods failed. Patch: {error}. Fallback: {err2}"}
