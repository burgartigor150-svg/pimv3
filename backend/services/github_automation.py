from __future__ import annotations

import os
from typing import Any, Dict

import httpx


def github_config_status() -> Dict[str, Any]:
    token = (os.getenv("GITHUB_TOKEN", "") or "").strip()
    repo = (os.getenv("GITHUB_REPO", "") or "").strip()  # owner/repo
    return {
        "token_configured": bool(token),
        "repo_configured": bool(repo),
        "repo": repo,
        "ready": bool(token and repo and "/" in repo),
    }


def _headers() -> Dict[str, str]:
    token = (os.getenv("GITHUB_TOKEN", "") or "").strip()
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _repo() -> str:
    return (os.getenv("GITHUB_REPO", "") or "").strip()


async def create_pull_request(
    *,
    head_branch: str,
    base_branch: str = "main",
    title: str,
    body: str = "",
) -> Dict[str, Any]:
    st = github_config_status()
    if not st["ready"]:
        return {"ok": False, "error": "github_not_configured", "status": st}
    repo = _repo()
    url = f"https://api.github.com/repos/{repo}/pulls"
    payload = {
        "title": title,
        "head": head_branch,
        "base": base_branch,
        "body": body,
        "maintainer_can_modify": True,
    }
    async with httpx.AsyncClient(timeout=40.0) as client:
        res = await client.post(url, headers=_headers(), json=payload)
    if res.status_code in (200, 201):
        obj = res.json()
        return {
            "ok": True,
            "pr_number": obj.get("number"),
            "pr_url": obj.get("html_url"),
            "api_url": obj.get("url"),
            "status_code": res.status_code,
        }
    return {"ok": False, "error": f"github_pr_create_{res.status_code}", "response": res.text[:4000]}


async def merge_pull_request(pr_number: int, commit_title: str | None = None) -> Dict[str, Any]:
    st = github_config_status()
    if not st["ready"]:
        return {"ok": False, "error": "github_not_configured", "status": st}
    repo = _repo()
    url = f"https://api.github.com/repos/{repo}/pulls/{int(pr_number)}/merge"
    payload: Dict[str, Any] = {"merge_method": "squash"}
    if commit_title:
        payload["commit_title"] = commit_title
    async with httpx.AsyncClient(timeout=40.0) as client:
        res = await client.put(url, headers=_headers(), json=payload)
    if res.status_code in (200, 201):
        return {"ok": True, "status_code": res.status_code, "response": res.json()}
    return {"ok": False, "error": f"github_pr_merge_{res.status_code}", "response": res.text[:4000]}

