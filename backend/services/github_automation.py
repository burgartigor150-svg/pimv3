from __future__ import annotations

import os
import re
import subprocess
import json
from typing import Any, Dict

import httpx


def _run(cmd: list[str], cwd: str | None = None) -> Dict[str, Any]:
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)
        return {
            "ok": p.returncode == 0,
            "code": p.returncode,
            "stdout": (p.stdout or "").strip(),
            "stderr": (p.stderr or "").strip(),
        }
    except Exception as e:
        return {"ok": False, "code": -1, "stdout": "", "stderr": str(e)}


def _parse_repo_from_remote(url: str) -> str:
    u = str(url or "").strip()
    if not u:
        return ""
    path = ""
    if u.startswith("git@github.com:"):
        path = u.split(":", 1)[1]
    elif "github.com/" in u:
        path = u.split("github.com/", 1)[1]
    path = path.strip().strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    if "/" not in path:
        return ""
    return path


def _repo(workspace_root: str = "/mnt/data/Pimv3") -> str:
    env_repo = (os.getenv("GITHUB_REPO", "") or "").strip()
    if env_repo and "/" in env_repo:
        return env_repo
    r = _run(["git", "remote", "get-url", "origin"], cwd=workspace_root)
    if not r["ok"]:
        return ""
    return _parse_repo_from_remote(r.get("stdout", ""))


def github_config_status(workspace_root: str = "/mnt/data/Pimv3") -> Dict[str, Any]:
    token = (os.getenv("GITHUB_TOKEN", "") or "").strip()
    repo = _repo(workspace_root)
    gh = _run(["gh", "auth", "status"])
    gh_available = gh.get("code", -1) != -1
    gh_authenticated = bool(gh_available and gh.get("ok"))
    ready_token = bool(token and repo and "/" in repo)
    ready_ssh = bool(gh_authenticated and repo and "/" in repo)
    return {
        "token_configured": bool(token),
        "repo_configured": bool(repo and "/" in repo),
        "repo": repo,
        "gh_available": gh_available,
        "gh_authenticated": gh_authenticated,
        "mode": "token_api" if ready_token else ("ssh_gh" if ready_ssh else "not_ready"),
        "ready": bool(ready_token or ready_ssh),
    }


def _headers() -> Dict[str, str]:
    token = (os.getenv("GITHUB_TOKEN", "") or "").strip()
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def create_pull_request(
    *,
    head_branch: str,
    base_branch: str = "main",
    title: str,
    body: str = "",
    workspace_root: str = "/mnt/data/Pimv3",
) -> Dict[str, Any]:
    st = github_config_status(workspace_root)
    if not st["ready"]:
        return {"ok": False, "error": "github_not_configured", "status": st}
    repo = _repo(workspace_root)
    if st.get("mode") == "ssh_gh":
        create = _run(
            [
                "gh",
                "pr",
                "create",
                "--repo",
                repo,
                "--head",
                str(head_branch or ""),
                "--base",
                str(base_branch or "main"),
                "--title",
                str(title or ""),
                "--body",
                str(body or ""),
            ],
            cwd=workspace_root,
        )
        if not create["ok"] and "already exists" not in (create.get("stderr", "").lower()):
            return {"ok": False, "error": "gh_pr_create_failed", "detail": create}
        view = _run(
            ["gh", "pr", "view", str(head_branch or ""), "--repo", repo, "--json", "number,url"],
            cwd=workspace_root,
        )
        if not view["ok"]:
            return {"ok": False, "error": "gh_pr_view_failed", "detail": view}
        try:
            obj = json.loads(view.get("stdout", "") or "{}")
            return {
                "ok": True,
                "pr_number": obj.get("number"),
                "pr_url": obj.get("url"),
                "mode": "ssh_gh",
            }
        except Exception:
            m = re.search(r"https://github\.com/\S+/pull/\d+", view.get("stdout", "") or "")
            return {
                "ok": True,
                "pr_number": None,
                "pr_url": m.group(0) if m else "",
                "mode": "ssh_gh",
            }

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
            "mode": "token_api",
            "status_code": res.status_code,
        }
    return {"ok": False, "error": f"github_pr_create_{res.status_code}", "response": res.text[:4000]}


async def merge_pull_request(
    pr_number: int,
    commit_title: str | None = None,
    workspace_root: str = "/mnt/data/Pimv3",
) -> Dict[str, Any]:
    st = github_config_status(workspace_root)
    if not st["ready"]:
        return {"ok": False, "error": "github_not_configured", "status": st}
    repo = _repo(workspace_root)
    if st.get("mode") == "ssh_gh":
        merge = _run(
            [
                "gh",
                "pr",
                "merge",
                str(int(pr_number)),
                "--squash",
                "--repo",
                repo,
            ],
            cwd=workspace_root,
        )
        if merge["ok"]:
            return {"ok": True, "mode": "ssh_gh", "detail": merge}
        return {"ok": False, "error": "gh_pr_merge_failed", "detail": merge}

    url = f"https://api.github.com/repos/{repo}/pulls/{int(pr_number)}/merge"
    payload: Dict[str, Any] = {"merge_method": "squash"}
    if commit_title:
        payload["commit_title"] = commit_title
    async with httpx.AsyncClient(timeout=40.0) as client:
        res = await client.put(url, headers=_headers(), json=payload)
    if res.status_code in (200, 201):
        return {"ok": True, "mode": "token_api", "status_code": res.status_code, "response": res.json()}
    return {"ok": False, "error": f"github_pr_merge_{res.status_code}", "response": res.text[:4000]}

