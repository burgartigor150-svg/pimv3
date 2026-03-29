from __future__ import annotations

import subprocess
from typing import Any, Dict, List


def run_tests(workspace_root: str, commands: List[List[str]] | None = None) -> Dict[str, Any]:
    cmds = commands or [
        ["python3", "-m", "pytest", "backend/test_ozon_flat_import.py", "-q"],
    ]
    results: List[Dict[str, Any]] = []
    all_ok = True
    for cmd in cmds:
        p = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True, check=False)
        ok = p.returncode == 0
        if not ok:
            all_ok = False
        results.append(
            {
                "cmd": " ".join(cmd),
                "ok": ok,
                "code": p.returncode,
                "stdout": (p.stdout or "")[-6000:],
                "stderr": (p.stderr or "")[-6000:],
            }
        )
    return {"ok": all_ok, "results": results}

