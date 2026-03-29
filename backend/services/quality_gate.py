from __future__ import annotations

import ast
import subprocess
from pathlib import Path
from typing import Dict, List


def run_quality_gate(
    *,
    workspace_root: str,
    changed_files: List[str],
    run_frontend_build: bool = False,
) -> Dict[str, object]:
    """
    Базовый quality gate для self-rewrite:
    - AST check по измененным .py
    - опционально frontend build
    """
    root = Path(workspace_root)
    errors: List[str] = []
    checked_py: List[str] = []
    for rel in changed_files or []:
        p = root / rel
        if p.suffix != ".py" or not p.exists():
            continue
        try:
            ast.parse(p.read_text(encoding="utf-8"))
            checked_py.append(rel)
        except Exception as e:
            errors.append(f"{rel}: AST error: {e}")

    build_ok = True
    if run_frontend_build:
        try:
            proc = subprocess.run(
                ["npm", "run", "build"],
                cwd=str(root / "frontend"),
                capture_output=True,
                text=True,
                timeout=240,
                check=False,
            )
            build_ok = proc.returncode == 0
            if not build_ok:
                errors.append(f"frontend build failed: {proc.stdout[-1200:]} {proc.stderr[-1200:]}")
        except Exception as e:
            build_ok = False
            errors.append(f"frontend build exception: {e}")

    return {
        "ok": len(errors) == 0 and build_ok,
        "checked_python_files": checked_py,
        "errors": errors[:50],
    }

