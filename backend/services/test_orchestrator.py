from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Dict, List


def run_tests(workspace_root: str, commands: List[List[str]] | None = None) -> Dict[str, Any]:
    """
    Запускает тесты проекта. Если commands не переданы — находит все тесты автоматически.
    """
    py = "python3"
    venv_py = Path(workspace_root) / "backend" / "venv" / "bin" / "python3"
    if venv_py.exists():
        py = str(venv_py)

    if commands:
        cmds = commands
    else:
        # Автоматически находим тесты: сначала tests/, потом отдельные test_-файлы
        tests_dir = Path(workspace_root) / "backend" / "tests"
        if tests_dir.exists() and any(tests_dir.glob("test_*.py")):
            cmds = [[py, "-m", "pytest", "backend/tests/", "-q", "--tb=short"]]
        else:
            # fallback: запускаем только файлы из pytest.ini
            cmds = [[py, "-m", "pytest", "-q", "--tb=short"]]

    results: List[Dict[str, Any]] = []
    all_ok = True
    for cmd in cmds:
        p = subprocess.run(
            cmd, cwd=workspace_root, capture_output=True, text=True, check=False, timeout=120
        )
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
