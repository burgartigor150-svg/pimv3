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

# Файлы, которые всегда читаем для понимания архитектуры проекта
_CORE_CONTEXT_FILES = [
    "backend/main.py",
    "backend/models.py",
    "backend/schemas.py",
    "backend/services/adapters.py",
    "backend/services/ai_service.py",
    "backend/database.py",
    "frontend/src/lib/api.ts",
]

# Максимальный размер одного файла в промпт (chars)
_MAX_FILE_CHARS = 6000
# Максимум файлов в контексте LLM
_MAX_CONTEXT_FILES = 18
# Максимум символов всего кодового контекста
_MAX_CODE_CONTEXT_CHARS = 80_000


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _read_file_safe(path: str, max_chars: int = _MAX_FILE_CHARS) -> Optional[str]:
    try:
        content = Path(path).read_text(encoding="utf-8", errors="replace")
        if len(content) > max_chars:
            half = max_chars // 2
            content = content[:half] + f"\n... [truncated {len(content) - max_chars} chars] ...\n" + content[-half:]
        return content
    except Exception:
        return None


def _score_file_relevance(file_path: str, keywords: List[str]) -> float:
    """Простой скоринг релевантности файла по ключевым словам в пути."""
    path_lower = file_path.lower()
    score = 0.0
    for kw in keywords:
        kw_lower = kw.lower()
        if kw_lower in path_lower:
            score += 2.0
        # частичное совпадение
        for part in path_lower.replace("/", " ").replace("_", " ").split():
            if kw_lower in part:
                score += 0.5
    # бонус за ключевые файлы
    if "adapter" in path_lower or "service" in path_lower:
        score += 1.0
    if "main.py" in path_lower or "routes" in path_lower:
        score += 0.5
    return score


def _extract_keywords(rewrite_plan: Dict[str, Any]) -> List[str]:
    """Извлекаем ключевые слова из плана задачи для выбора релевантных файлов."""
    words: List[str] = []
    summary = rewrite_plan.get("summary", {})
    for field in ("title", "description", "task_type", "proposed_change"):
        val = str(summary.get(field) or "")
        words.extend(val.lower().split())
    for h in rewrite_plan.get("hypotheses", []):
        words.extend(str(h.get("proposed_change") or "").lower().split())
        words.extend(str(h.get("problem_type") or "").lower().split())
    # убираем стоп-слова
    stop = {"и", "в", "на", "с", "по", "для", "не", "это", "the", "a", "an", "to", "of", "in", "for", "with"}
    return [w.strip(".,():") for w in words if len(w) > 3 and w not in stop]


def _select_relevant_files(
    allowlist: List[str],
    keywords: List[str],
    workspace_root: str,
    max_files: int = _MAX_CONTEXT_FILES,
) -> List[str]:
    """Выбираем наиболее релевантные файлы из allowlist."""
    scored = []
    for rel_path in allowlist:
        abs_path = str(Path(workspace_root) / rel_path)
        if not Path(abs_path).exists():
            continue
        # пропускаем мелкие/__pycache__/тесты-заглушки
        if "__pycache__" in rel_path or ".pyc" in rel_path:
            continue
        score = _score_file_relevance(rel_path, keywords)
        scored.append((score, rel_path))

    scored.sort(key=lambda x: -x[0])
    # всегда включаем core-файлы если они в allowlist
    core_set = set(_CORE_CONTEXT_FILES)
    selected = []
    for _, fp in scored:
        if fp in core_set or (selected.__len__() < max_files):
            selected.append(fp)
        if len(selected) >= max_files:
            break
    return selected


def _build_code_context(
    selected_files: List[str],
    workspace_root: str,
) -> str:
    """Читаем выбранные файлы и формируем блок кода для промпта."""
    parts = []
    total_chars = 0
    for rel_path in selected_files:
        abs_path = str(Path(workspace_root) / rel_path)
        content = _read_file_safe(abs_path)
        if content is None:
            continue
        block = f"### FILE: {rel_path}\n```\n{content}\n```\n"
        if total_chars + len(block) > _MAX_CODE_CONTEXT_CHARS:
            break
        parts.append(block)
        total_chars += len(block)
    return "\n".join(parts)


def _build_knowledge_context(rewrite_plan: Dict[str, Any]) -> str:
    """Форматируем hits из базы знаний в текст для промпта."""
    hits_by_ns = rewrite_plan.get("knowledge_hits", {})
    if not hits_by_ns:
        return ""
    parts = ["### RELEVANT DOCUMENTATION EXCERPTS"]
    for ns, hits in hits_by_ns.items():
        if not hits:
            continue
        parts.append(f"\n#### Namespace: {ns}")
        for h in hits[:3]:
            if not isinstance(h, dict):
                continue
            src = h.get("source_uri") or h.get("title") or ""
            excerpt = h.get("content_excerpt") or ""
            if excerpt:
                parts.append(f"Source: {src}\n{excerpt[:1200]}\n")
    return "\n".join(parts)


def _build_diff_from_edit_ops(edit_ops: List[Dict], workspace_root: str) -> Tuple[str, List[str]]:
    """
    Строим unified diff из списка edit_ops {file_path, old_snippet, new_snippet}.
    Возвращает (unified_diff_text, affected_files).
    """
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
                log.warning(f"File not found for diff: {rel_path}")
                continue
            old_content = abs_path.read_text(encoding="utf-8", errors="replace")

        if old_snip and not is_new_file:
            if old_content.count(old_snip) == 0:
                # пробуем с нормализацией пробелов
                old_snip_stripped = "\n".join(l.rstrip() for l in old_snip.splitlines())
                old_content_stripped = "\n".join(l.rstrip() for l in old_content.splitlines())
                if old_content_stripped.count(old_snip_stripped) == 1:
                    new_content = old_content_stripped.replace(old_snip_stripped, new_snip)
                else:
                    log.warning(f"Snippet not found in {rel_path}, skipping op")
                    continue
            else:
                new_content = old_content.replace(old_snip, new_snip, 1)
        elif is_new_file:
            new_content = new_snip
        else:
            new_content = new_snip  # full file replacement

        old_lines = old_content.splitlines(keepends=True)
        new_lines = new_content.splitlines(keepends=True)
        diff = list(difflib.unified_diff(
            old_lines, new_lines,
            fromfile=f"a/{rel_path}",
            tofile=f"b/{rel_path}",
            lineterm="",
        ))
        if diff:
            all_diffs.append("\n".join(diff))
            affected.append(rel_path)

    return "\n".join(all_diffs), affected


def _apply_edit_ops_directly(edit_ops: List[Dict], workspace_root: str) -> Tuple[bool, str]:
    """Прямое применение edit_ops без diff (fallback)."""
    applied = []
    for i, op in enumerate(edit_ops):
        rel_path = op.get("file_path", "")
        old_snip = op.get("old_snippet", "")
        new_snip = op.get("new_snippet", "")
        is_new_file = op.get("new_file", False)
        abs_path = Path(workspace_root) / rel_path

        try:
            if is_new_file:
                abs_path.parent.mkdir(parents=True, exist_ok=True)
                abs_path.write_text(new_snip, encoding="utf-8")
                applied.append(rel_path)
                continue

            if not abs_path.exists():
                return False, f"Op[{i}] file not found: {rel_path}"

            content = abs_path.read_text(encoding="utf-8", errors="replace")
            if not old_snip:
                # полная замена файла
                abs_path.write_text(new_snip, encoding="utf-8")
                applied.append(rel_path)
                continue

            count = content.count(old_snip)
            if count == 0:
                # попытка с нормализацией
                old_stripped = "\n".join(l.rstrip() for l in old_snip.splitlines())
                content_stripped = "\n".join(l.rstrip() for l in content.splitlines())
                if content_stripped.count(old_stripped) == 1:
                    new_content = content_stripped.replace(old_stripped, new_snip)
                    abs_path.write_text(new_content, encoding="utf-8")
                    applied.append(rel_path)
                    continue
                return False, f"Op[{i}] snippet not found in {rel_path}"
            if count > 1:
                return False, f"Op[{i}] snippet ambiguous ({count} matches) in {rel_path}"

            new_content = content.replace(old_snip, new_snip, 1)
            abs_path.write_text(new_content, encoding="utf-8")
            applied.append(rel_path)
        except Exception as e:
            return False, f"Op[{i}] error: {e}"

    return True, f"Applied {len(applied)} ops"


# ---------------------------------------------------------------------------
# Основная функция — ЯДРО АГЕНТА
# ---------------------------------------------------------------------------

async def generate_code_patch_proposal(
    *,
    ai_config: str,
    rewrite_plan: Dict[str, Any],
    allowlist_files: List[str],
    workspace_root: str = _WORKSPACE_ROOT,
) -> Dict[str, Any]:
    """
    Генерирует патч кода для выполнения задачи.

    Алгоритм:
    1. Извлекаем ключевые слова из задачи
    2. Выбираем наиболее релевантные файлы кодобазы
    3. Читаем их содержимое
    4. Фаза 1 (LLM): планирование — какие файлы менять и как
    5. Фаза 2 (LLM): генерация — конкретные изменения кода
    6. Строим unified diff через difflib
    7. Применяем изменения
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
    proposed_change = str(hypotheses[0].get("proposed_change") or description) if hypotheses else description

    if not title and not description:
        return {"ok": False, "error": "empty_task_description"}

    # --- Выбор релевантных файлов ---
    keywords = _extract_keywords(rewrite_plan)
    selected_files = _select_relevant_files(allowlist_files, keywords, workspace_root)

    # Всегда добавляем core-файлы (если существуют)
    for cf in _CORE_CONTEXT_FILES:
        if cf not in selected_files and Path(workspace_root, cf).exists():
            selected_files.append(cf)

    code_context = _build_code_context(selected_files, workspace_root)
    knowledge_context = _build_knowledge_context(rewrite_plan)

    # --- Получаем дерево файлов проекта для ориентирования LLM ---
    try:
        tree_result = subprocess.run(
            ["find", "backend", "frontend/src", "-type", "f",
             "(", "-name", "*.py", "-o", "-name", "*.ts", "-o", "-name", "*.tsx", ")",
             "-not", "-path", "*/__pycache__/*", "-not", "-path", "*/node_modules/*"],
            cwd=workspace_root, capture_output=True, text=True, timeout=10
        )
        file_tree = tree_result.stdout[:4000]
    except Exception:
        file_tree = "\n".join(allowlist_files[:80])

    # -----------------------------------------------------------------------
    # ФАЗА 1 — Планирование: LLM решает какие файлы менять и что делать
    # -----------------------------------------------------------------------
    plan_system = """You are a senior software engineer working on a Python/FastAPI + React/TypeScript project called PIMv3 — a product information management system for Russian e-commerce marketplaces (Ozon, Wildberries, Yandex Market, Megamarket).

Your job: analyze the task and produce a clear implementation plan.

Return ONLY valid JSON (no markdown):
{
  "plan_summary": "one paragraph description of what you will implement",
  "files_to_modify": [
    {"path": "backend/services/adapters.py", "reason": "add new adapter class", "action": "modify"},
    {"path": "backend/services/new_service.py", "reason": "new service file", "action": "create"}
  ],
  "implementation_steps": ["step 1 description", "step 2 description"]
}

Rules:
- Use EXISTING patterns from the codebase (same style, imports, error handling)
- Prefer modifying existing files over creating new ones
- File paths are relative to project root /mnt/data/Pimv3
- Maximum 6 files to change
"""

    plan_user = f"""TASK: {title}

DESCRIPTION:
{description}

PROPOSED CHANGE:
{proposed_change}

PROJECT FILE TREE:
{file_tree}

{knowledge_context}

EXISTING CODE CONTEXT (most relevant files):
{code_context[:40000]}
"""

    try:
        plan_resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": plan_system},
                {"role": "user", "content": plan_user},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        plan_raw = (plan_resp.choices[0].message.content or "").strip()
        if plan_raw.startswith("```"):
            plan_raw = plan_raw.split("```")[1]
            if plan_raw.startswith("json"):
                plan_raw = plan_raw[4:]
        plan_data = json.loads(plan_raw)
    except Exception as e:
        log.warning(f"Plan phase failed: {e}")
        plan_data = {
            "plan_summary": description,
            "files_to_modify": [],
            "implementation_steps": [description],
        }

    files_to_modify = plan_data.get("files_to_modify", [])
    plan_summary = plan_data.get("plan_summary", description)

    # Читаем точно те файлы, которые LLM хочет изменить
    targeted_context_parts = []
    for fm in files_to_modify[:6]:
        fp = fm.get("path", "")
        action = fm.get("action", "modify")
        if action == "create":
            targeted_context_parts.append(f"### FILE TO CREATE: {fp}\n(New file — provide full content)\n")
        else:
            content = _read_file_safe(str(Path(workspace_root) / fp), max_chars=10000)
            if content:
                targeted_context_parts.append(f"### EXISTING FILE: {fp}\n```\n{content}\n```\n")

    targeted_context = "\n".join(targeted_context_parts)

    # -----------------------------------------------------------------------
    # ФАЗА 2 — Генерация кода
    # -----------------------------------------------------------------------
    gen_system = """You are a senior software engineer. Generate the actual code changes needed to implement the task.

Return ONLY valid JSON (no markdown):
{
  "edit_ops": [
    {
      "file_path": "backend/services/adapters.py",
      "new_file": false,
      "old_snippet": "EXACT existing code to replace (copy-paste from file, preserve indentation)",
      "new_snippet": "new code to put in place of old_snippet"
    },
    {
      "file_path": "backend/services/new_service.py",
      "new_file": true,
      "old_snippet": "",
      "new_snippet": "FULL FILE CONTENT here"
    }
  ]
}

CRITICAL RULES:
1. old_snippet must be an EXACT copy from the existing file (same whitespace, same indentation)
2. old_snippet should be a focused block — not the entire file (unless file is small <50 lines)
3. new_snippet must follow the existing code style and patterns of the project
4. For new files: set new_file=true, old_snippet="", new_snippet=<full file content>
5. Imports go at top of file — add them in a separate edit_op targeting the imports section
6. Use async/await patterns (FastAPI async everywhere)
7. Russian comments are fine (existing codebase uses Russian)
8. Maximum 8 edit_ops total
"""

    gen_user = f"""TASK: {title}

IMPLEMENTATION PLAN:
{plan_summary}

Steps:
{chr(10).join(f"- {s}" for s in plan_data.get("implementation_steps", []))}

{knowledge_context}

TARGETED FILES TO CHANGE:
{targeted_context}

ADDITIONAL CODEBASE CONTEXT:
{code_context[:30000]}

Generate edit_ops to implement this task completely and correctly.
"""

    try:
        gen_resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": gen_system},
                {"role": "user", "content": gen_user},
            ],
            temperature=0.05,
            response_format={"type": "json_object"},
            max_tokens=8000,
        )
        gen_raw = (gen_resp.choices[0].message.content or "").strip()
        if gen_raw.startswith("```"):
            gen_raw = gen_raw.split("```")[1]
            if gen_raw.startswith("json"):
                gen_raw = gen_raw[4:]
        gen_data = json.loads(gen_raw)
    except Exception as e:
        return {"ok": False, "error": f"code_generation_failed: {e}"}

    edit_ops = gen_data.get("edit_ops", [])
    if not edit_ops:
        return {"ok": False, "error": "llm_returned_empty_edit_ops"}

    # -----------------------------------------------------------------------
    # Строим unified diff из edit_ops
    # -----------------------------------------------------------------------
    patch_text, affected_files = _build_diff_from_edit_ops(edit_ops, workspace_root)

    if not patch_text.strip() and affected_files:
        # diff пустой — возможно файлы новые (create), применяем напрямую
        ok, err = _apply_edit_ops_directly(edit_ops, workspace_root)
        if not ok:
            return {"ok": False, "error": f"direct_apply_failed: {err}"}
        affected_files = [op["file_path"] for op in edit_ops if op.get("file_path")]
        return {
            "ok": True,
            "proposal": {
                "patch_unified_diff": "",
                "affected_files": affected_files,
                "applied_directly": True,
                "edit_ops": edit_ops,
            },
        }

    if not patch_text.strip():
        # Fallback: пробуем применить напрямую через edit_ops
        ok, err = _apply_edit_ops_directly(edit_ops, workspace_root)
        if not ok:
            return {"ok": False, "error": f"no_diff_and_direct_apply_failed: {err}"}
        affected_files = [op["file_path"] for op in edit_ops if op.get("file_path")]
        return {
            "ok": True,
            "proposal": {
                "patch_unified_diff": "",
                "affected_files": affected_files,
                "applied_directly": True,
                "edit_ops": edit_ops,
            },
        }

    return {
        "ok": True,
        "proposal": {
            "patch_unified_diff": patch_text,
            "affected_files": affected_files,
            "edit_ops": edit_ops,
            "plan": plan_data,
        },
    }


# ---------------------------------------------------------------------------
# Существующие функции (без изменений)
# ---------------------------------------------------------------------------

def apply_patch(patch_content: str, repo_path: str) -> Tuple[bool, str]:
    """Apply a unified diff patch to the repository."""
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
    """Apply fallback edit operations directly to files."""
    ok, err = _apply_edit_ops_directly(edit_ops, repo_path)
    return ok, err


def run_code_patch_agent(task_id: str, patch_content: str, repo_path: str) -> Dict:
    """Main function to apply a patch with fallback to edit operations."""
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
