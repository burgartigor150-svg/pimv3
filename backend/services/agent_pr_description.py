"""
backend/services/agent_pr_description.py

Auto-generates PR descriptions using LLM based on git diff.
"""

import os
import logging
import json
import subprocess
import asyncio
from typing import Dict, Any, Optional

import httpx

log = logging.getLogger(__name__)

_MAX_DIFF_CHARS = 8000
_CHANGELOG_PATH = "/mnt/data/Pimv3/CHANGELOG.md"

_PR_SYSTEM_PROMPT = (
    "Ты — технический писатель. Сгенерируй описание Pull Request на русском языке "
    "строго в формате Markdown со следующими разделами:\n"
    "## Что сделано\n"
    "## Какие файлы изменены\n"
    "## Как проверить\n"
    "## Риски\n"
    "Отвечай только текстом описания, без лишних вступлений."
)

_CHANGELOG_SYSTEM_PROMPT = (
    "Сгенерируй одну строку для CHANGELOG.md в формате: '- feat: <краткое описание на английском>'. "
    "Только одна строка, без лишнего текста."
)


def _run_git(args: list[str], cwd: str) -> str:
    result = subprocess.run(
        ["git"] + args,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def _get_ai_config(ai_config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    defaults: Dict[str, Any] = {
        "base_url": os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "api_key": os.environ.get("OPENAI_API_KEY", ""),
        "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        "timeout": 60,
    }
    if ai_config:
        defaults.update(ai_config)
    return defaults


async def _call_llm(
    prompt: str,
    system: str,
    config: Dict[str, Any],
) -> str:
    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": config["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
    }
    url = config["base_url"].rstrip("/") + "/chat/completions"
    async with httpx.AsyncClient(timeout=config["timeout"]) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
    content: str = data["choices"][0]["message"]["content"]
    return content.strip()


def _append_to_changelog(entry: str, changelog_path: str = _CHANGELOG_PATH) -> None:
    entry_line = entry if entry.startswith("- ") else f"- {entry}"
    try:
        if os.path.exists(changelog_path):
            with open(changelog_path, "r", encoding="utf-8") as fh:
                existing = fh.read()
        else:
            existing = "# CHANGELOG\n\n"

        lines = existing.splitlines(keepends=True)
        insert_at = 0
        for i, line in enumerate(lines):
            if line.startswith("# ") or line.startswith("## "):
                insert_at = i + 1
                break

        lines.insert(insert_at, entry_line + "\n")
        with open(changelog_path, "w", encoding="utf-8") as fh:
            fh.writelines(lines)
        log.info("Appended CHANGELOG entry: %s", entry_line)
    except OSError as exc:
        log.warning("Could not write CHANGELOG at %s: %s", changelog_path, exc)


async def generate_pr_description(
    task_id: str,
    commit_hash: str,
    workspace_root: str = "/mnt/data/Pimv3",
    ai_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    1. Run `git show --stat {commit_hash}` and `git show {commit_hash}` (truncated to 8000 chars).
    2. Call LLM with prompt: generate PR description in Russian with sections:
       ## Что сделано
       ## Какие файлы изменены
       ## Как проверить
       ## Риски
    3. Also generate a CHANGELOG.md entry (one line, format: "- feat: ...").
    4. Append CHANGELOG entry to /mnt/data/Pimv3/CHANGELOG.md.
    Returns {"ok": True, "pr_description": str, "changelog_entry": str}
    """
    log.info("generate_pr_description called: task_id=%s commit=%s", task_id, commit_hash)

    try:
        stat_output = _run_git(["show", "--stat", commit_hash], cwd=workspace_root)
        diff_output = _run_git(["show", commit_hash], cwd=workspace_root)
    except RuntimeError as exc:
        log.error("Git error for task %s: %s", task_id, exc)
        return {"ok": False, "error": str(exc)}

    diff_truncated = diff_output[:_MAX_DIFF_CHARS]
    if len(diff_output) > _MAX_DIFF_CHARS:
        diff_truncated += "\n... [diff truncated] ..."

    user_prompt = (
        f"Коммит: {commit_hash}\n\n"
        f"Статистика изменений:\n{stat_output}\n\n"
        f"Diff (первые {_MAX_DIFF_CHARS} символов):\n{diff_truncated}"
    )

    config = _get_ai_config(ai_config)

    pr_description, changelog_entry = await asyncio.gather(
        _call_llm(user_prompt, _PR_SYSTEM_PROMPT, config),
        _call_llm(user_prompt, _CHANGELOG_SYSTEM_PROMPT, config),
    )

    _append_to_changelog(changelog_entry)

    log.info(
        "PR description generated for task %s (%d chars), changelog: %s",
        task_id,
        len(pr_description),
        changelog_entry,
    )
    return {
        "ok": True,
        "task_id": task_id,
        "commit_hash": commit_hash,
        "pr_description": pr_description,
        "changelog_entry": changelog_entry,
    }


async def update_pr_on_github(
    pr_number: int,
    description: str,
    workspace_root: str = "/mnt/data/Pimv3",
) -> Dict[str, Any]:
    """Update PR description via GitHub API using GITHUB_TOKEN env var."""
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        log.error("GITHUB_TOKEN is not set; cannot update PR #%d", pr_number)
        return {"ok": False, "error": "GITHUB_TOKEN environment variable is not set"}

    # Determine repo from git remote
    try:
        remote_url = _run_git(
            ["remote", "get-url", "origin"], cwd=workspace_root
        ).strip()
    except RuntimeError as exc:
        log.error("Cannot determine remote URL: %s", exc)
        return {"ok": False, "error": str(exc)}

    # Parse owner/repo from remote URL
    # Supports both SSH (git@github.com:owner/repo.git) and HTTPS forms
    repo_path: Optional[str] = None
    if remote_url.startswith("git@github.com:"):
        repo_path = remote_url.replace("git@github.com:", "").removesuffix(".git")
    elif "github.com" in remote_url:
        parts = remote_url.rstrip("/").split("github.com/")
        if len(parts) == 2:
            repo_path = parts[1].removesuffix(".git")

    if not repo_path:
        log.error("Cannot parse GitHub repo from remote URL: %s", remote_url)
        return {"ok": False, "error": f"Cannot parse GitHub repo from: {remote_url}"}

    api_url = f"https://api.github.com/repos/{repo_path}/pulls/{pr_number}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {"body": description}

    log.info("Updating GitHub PR #%d at %s", pr_number, api_url)
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.patch(api_url, headers=headers, json=payload)

    if response.status_code not in (200, 201):
        log.error(
            "GitHub API error %d for PR #%d: %s",
            response.status_code,
            pr_number,
            response.text[:500],
        )
        return {
            "ok": False,
            "error": f"GitHub API returned {response.status_code}",
            "details": response.text[:500],
        }

    log.info("PR #%d description updated successfully", pr_number)
    data = response.json()
    return {
        "ok": True,
        "pr_number": pr_number,
        "pr_url": data.get("html_url", ""),
        "repo": repo_path,
    }
