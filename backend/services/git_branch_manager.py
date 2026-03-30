from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List


_GIT_BIN = shutil.which("git") or "/usr/bin/git"


def _run(cmd: List[str], cwd: str) -> Dict[str, Any]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)
    return {
        "ok": p.returncode == 0,
        "code": p.returncode,
        "stdout": (p.stdout or "")[-4000:],
        "stderr": (p.stderr or "")[-4000:],
        "cmd": " ".join(cmd),
    }


def git_repo_ready(workspace_root: str) -> bool:
    return (Path(workspace_root) / ".git").exists()


def create_incident_branch(workspace_root: str, incident_id: str) -> Dict[str, Any]:
    if not git_repo_ready(workspace_root):
        return {"ok": False, "error": "git_repo_not_found", "branch": ""}
    branch = f"auto/fix-{incident_id[:12]}"
    checkout = _run([_GIT_BIN, "checkout", "-B", branch], cwd=workspace_root)
    if not checkout["ok"]:
        return {"ok": False, "error": "branch_checkout_failed", "branch": branch, "detail": checkout}
    return {"ok": True, "branch": branch, "detail": checkout}


def commit_all_changes(workspace_root: str, message: str) -> Dict[str, Any]:
    if not git_repo_ready(workspace_root):
        return {"ok": False, "error": "git_repo_not_found"}
    author_name = (os.getenv("AUTO_GIT_AUTHOR_NAME", "") or "").strip() or "PIM Auto Agent"
    author_email = (os.getenv("AUTO_GIT_AUTHOR_EMAIL", "") or "").strip() or "pim-auto@local"
    add = _run([_GIT_BIN, "add", "."], cwd=workspace_root)
    if not add["ok"]:
        return {"ok": False, "error": "git_add_failed", "detail": add}
    commit = _run(
        [_GIT_BIN, "-c", f"user.name={author_name}", "-c", f"user.email={author_email}", "commit", "-m", message],
        cwd=workspace_root,
    )
    if (not commit["ok"]) and ("nothing to commit" in (commit.get("stdout", "") + " " + commit.get("stderr", "")).lower()):
        commit = _run(
            [
                _GIT_BIN,
                "-c",
                f"user.name={author_name}",
                "-c",
                f"user.email={author_email}",
                "commit",
                "--allow-empty",
                "-m",
                message,
            ],
            cwd=workspace_root,
        )
    if not commit["ok"]:
        return {"ok": False, "error": "git_commit_failed", "detail": commit}
    return {"ok": True, "detail": commit}


def get_current_branch(workspace_root: str) -> Dict[str, Any]:
    if not git_repo_ready(workspace_root):
        return {"ok": False, "error": "git_repo_not_found", "branch": ""}
    out = _run([_GIT_BIN, "rev-parse", "--abbrev-ref", "HEAD"], cwd=workspace_root)
    if not out["ok"]:
        return {"ok": False, "error": "git_rev_parse_failed", "detail": out, "branch": ""}
    return {"ok": True, "branch": (out.get("stdout", "").strip() or "")}


def push_branch(workspace_root: str, branch: str, remote: str = "origin") -> Dict[str, Any]:
    if not git_repo_ready(workspace_root):
        return {"ok": False, "error": "git_repo_not_found"}
    b = str(branch or "").strip()
    if not b:
        return {"ok": False, "error": "branch_required"}
    push = _run([_GIT_BIN, "push", "-u", remote, b], cwd=workspace_root)
    if not push["ok"]:
        return {"ok": False, "error": "git_push_failed", "detail": push}
    return {"ok": True, "detail": push}

