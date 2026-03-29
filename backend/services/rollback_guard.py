from __future__ import annotations

import time
from pathlib import Path
from typing import Dict, List


def backup_files(workspace_root: str, files: List[str]) -> Dict[str, str]:
    root = Path(workspace_root)
    backup_root = root / "backend" / "data" / "self_rewrite_backups" / str(int(time.time()))
    backup_root.mkdir(parents=True, exist_ok=True)
    mapping: Dict[str, str] = {}
    for rel in files or []:
        src = root / rel
        if not src.exists() or not src.is_file():
            continue
        dst = backup_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())
        mapping[rel] = str(dst)
    return mapping


def restore_files(workspace_root: str, backup_map: Dict[str, str]) -> None:
    root = Path(workspace_root)
    for rel, backup_abs in (backup_map or {}).items():
        src = Path(backup_abs)
        dst = root / rel
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(src.read_bytes())

