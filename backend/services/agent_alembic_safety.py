"""
backend/services/agent_alembic_safety.py

Checks Alembic migrations for safety before applying.
"""

import os
import logging
import re
import subprocess
from typing import Dict, Any, List
from pathlib import Path

log = logging.getLogger(__name__)

# Patterns that indicate risky operations
_DROP_PATTERN = re.compile(
    r"\b(drop_table|drop_column|op\.drop_table|op\.drop_column|DROP\s+TABLE|DROP\s+COLUMN)\b",
    re.IGNORECASE,
)
_RAW_SQL_PATTERN = re.compile(
    r"\bop\.execute\s*\(|text\s*\(|connection\.execute\s*\(",
    re.IGNORECASE,
)
_NOT_NULL_PATTERN = re.compile(
    r"nullable\s*=\s*False",
    re.IGNORECASE,
)
_SERVER_DEFAULT_PATTERN = re.compile(
    r"server_default\s*=",
    re.IGNORECASE,
)
_ADD_COLUMN_PATTERN = re.compile(
    r"\bop\.add_column\s*\(",
    re.IGNORECASE,
)
_DOWNGRADE_PASS_PATTERN = re.compile(
    r"def\s+downgrade\s*\([^)]*\)\s*:\s*\n\s*(pass\s*\n|#[^\n]*\n\s*pass\s*\n)",
    re.DOTALL,
)
_DOWNGRADE_DEF_PATTERN = re.compile(
    r"def\s+downgrade\s*\([^)]*\)\s*:",
)


def _run(args: List[str], cwd: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def find_pending_migrations(workspace_root: str = "/mnt/data/Pimv3") -> List[str]:
    """Run `alembic history -r current:head` to find unapplied migrations.
    Returns list of revision IDs."""
    log.info("Finding pending migrations in %s", workspace_root)
    result = _run(
        ["alembic", "history", "-r", "current:head"],
        cwd=workspace_root,
    )
    if result.returncode != 0:
        log.error("alembic history failed: %s", result.stderr.strip())
        raise RuntimeError(f"alembic history failed: {result.stderr.strip()}")

    revision_ids: List[str] = []
    # Each line looks like:  <rev> -> <rev> (head), ...  or  <rev>, ...
    rev_line_pattern = re.compile(r"^([a-f0-9]+)\s+(?:->|,|\()")
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("("):
            continue
        match = rev_line_pattern.match(line)
        if match:
            revision_ids.append(match.group(1))
        else:
            # Fallback: grab first hex token on the line
            token_match = re.match(r"^([a-f0-9]{8,})", line)
            if token_match:
                revision_ids.append(token_match.group(1))

    log.info("Found %d pending migration(s): %s", len(revision_ids), revision_ids)
    return revision_ids


def check_migration_safety(migration_file: str) -> Dict[str, Any]:
    """Read a migration .py file and analyze:
    - Is there a downgrade() function that does something (not just pass)?
    - Are there any DROP TABLE / DROP COLUMN operations?
    - Are there NOT NULL constraints added to existing columns without defaults?
    - Are there any raw SQL operations?
    Returns {"ok": True, "safe": bool, "warnings": List[str], "blockers": List[str]}
    safe=False if blockers is non-empty.
    """
    warnings: List[str] = []
    blockers: List[str] = []

    try:
        source = Path(migration_file).read_text(encoding="utf-8")
    except OSError as exc:
        log.error("Cannot read migration file %s: %s", migration_file, exc)
        return {
            "ok": False,
            "safe": False,
            "warnings": [],
            "blockers": [f"Cannot read file: {exc}"],
        }

    # Check for meaningful downgrade
    has_downgrade_def = bool(_DOWNGRADE_DEF_PATTERN.search(source))
    has_downgrade_pass = bool(_DOWNGRADE_PASS_PATTERN.search(source))
    if has_downgrade_def and has_downgrade_pass:
        warnings.append("downgrade() exists but only contains `pass` — rollback not implemented")
    elif not has_downgrade_def:
        warnings.append("No downgrade() function found — rollback not possible")

    # Check DROP operations
    drop_matches = _DROP_PATTERN.findall(source)
    if drop_matches:
        unique_drops = sorted(set(m.lower() for m in drop_matches))
        blockers.append(
            f"Destructive operations detected: {', '.join(unique_drops)}. "
            "Verify this is intentional and data has been backed up."
        )

    # Check NOT NULL without server_default on add_column
    add_column_blocks = re.findall(
        r"op\.add_column\s*\([^)]+\)",
        source,
        re.DOTALL,
    )
    for block in add_column_blocks:
        is_not_null = bool(_NOT_NULL_PATTERN.search(block))
        has_default = bool(_SERVER_DEFAULT_PATTERN.search(block))
        if is_not_null and not has_default:
            blockers.append(
                "NOT NULL column added to an existing table without server_default — "
                "will fail on non-empty tables."
            )
            break  # Report once

    # Check raw SQL
    if _RAW_SQL_PATTERN.search(source):
        warnings.append(
            "Raw SQL execution detected (op.execute / connection.execute / text()). "
            "Review manually to ensure idempotency and compatibility."
        )

    is_safe = len(blockers) == 0
    log.info(
        "Migration %s — safe=%s, warnings=%d, blockers=%d",
        migration_file,
        is_safe,
        len(warnings),
        len(blockers),
    )
    return {
        "ok": True,
        "file": migration_file,
        "safe": is_safe,
        "warnings": warnings,
        "blockers": blockers,
    }


def _find_migration_file(workspace_root: str, revision_id: str) -> str:
    """Locate the .py file for a given Alembic revision ID."""
    migrations_dir = Path(workspace_root) / "alembic" / "versions"
    if not migrations_dir.exists():
        # Try common alternative paths
        for candidate in [
            Path(workspace_root) / "migrations" / "versions",
            Path(workspace_root) / "backend" / "alembic" / "versions",
        ]:
            if candidate.exists():
                migrations_dir = candidate
                break

    for path in migrations_dir.glob("*.py"):
        if revision_id in path.stem:
            return str(path)
    raise FileNotFoundError(
        f"Migration file for revision {revision_id} not found in {migrations_dir}"
    )


def check_all_pending_migrations(workspace_root: str = "/mnt/data/Pimv3") -> Dict[str, Any]:
    """Find all pending migrations, check each for safety.
    Returns {"ok": True, "total": N, "safe": N, "unsafe": N, "results": [...]}"""
    log.info("check_all_pending_migrations: workspace=%s", workspace_root)

    try:
        revision_ids = find_pending_migrations(workspace_root)
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc), "total": 0, "safe": 0, "unsafe": 0, "results": []}

    results: List[Dict[str, Any]] = []
    safe_count = 0
    unsafe_count = 0

    for rev_id in revision_ids:
        try:
            migration_file = _find_migration_file(workspace_root, rev_id)
        except FileNotFoundError as exc:
            log.warning("Could not find migration file for %s: %s", rev_id, exc)
            entry: Dict[str, Any] = {
                "ok": False,
                "revision_id": rev_id,
                "safe": False,
                "warnings": [],
                "blockers": [str(exc)],
            }
            results.append(entry)
            unsafe_count += 1
            continue

        check = check_migration_safety(migration_file)
        check["revision_id"] = rev_id
        results.append(check)
        if check.get("safe"):
            safe_count += 1
        else:
            unsafe_count += 1

    return {
        "ok": True,
        "total": len(revision_ids),
        "safe": safe_count,
        "unsafe": unsafe_count,
        "results": results,
    }


def run_migration_with_backup(workspace_root: str = "/mnt/data/Pimv3") -> Dict[str, Any]:
    """
    1. Check safety of pending migrations.
    2. If any blockers: abort with explanation.
    3. Create pg_dump backup (using DATABASE_URL env).
    4. Run `alembic upgrade head`.
    Returns {"ok": bool, "safety_check": dict, "backup_path": str, "migration_output": str}
    """
    log.info("run_migration_with_backup: workspace=%s", workspace_root)

    safety_check = check_all_pending_migrations(workspace_root)

    if not safety_check.get("ok"):
        return {
            "ok": False,
            "safety_check": safety_check,
            "backup_path": "",
            "migration_output": "",
            "error": "Safety check failed: " + safety_check.get("error", "unknown error"),
        }

    if safety_check["total"] == 0:
        log.info("No pending migrations found")
        return {
            "ok": True,
            "safety_check": safety_check,
            "backup_path": "",
            "migration_output": "No pending migrations.",
        }

    if safety_check["unsafe"] > 0:
        blockers_summary: List[str] = []
        for result in safety_check["results"]:
            for blocker in result.get("blockers", []):
                blockers_summary.append(
                    f"[{result.get('revision_id', 'unknown')}] {blocker}"
                )
        error_msg = (
            f"{safety_check['unsafe']} unsafe migration(s) detected. Aborting. "
            f"Blockers: {'; '.join(blockers_summary)}"
        )
        log.error(error_msg)
        return {
            "ok": False,
            "safety_check": safety_check,
            "backup_path": "",
            "migration_output": "",
            "error": error_msg,
        }

    # Create pg_dump backup
    database_url = os.environ.get("DATABASE_URL", "")
    backup_path = ""
    if database_url:
        import datetime

        timestamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        backup_dir = Path(workspace_root) / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = str(backup_dir / f"pre_migration_{timestamp}.dump")

        log.info("Creating pg_dump backup at %s", backup_path)
        dump_result = _run(
            ["pg_dump", "--format=custom", f"--file={backup_path}", database_url],
            cwd=workspace_root,
            timeout=300,
        )
        if dump_result.returncode != 0:
            log.error("pg_dump failed: %s", dump_result.stderr.strip())
            return {
                "ok": False,
                "safety_check": safety_check,
                "backup_path": "",
                "migration_output": "",
                "error": f"pg_dump failed: {dump_result.stderr.strip()}",
            }
        log.info("Backup created: %s", backup_path)
    else:
        log.warning("DATABASE_URL not set; skipping pg_dump backup")

    # Run alembic upgrade head
    log.info("Running alembic upgrade head")
    upgrade_result = _run(
        ["alembic", "upgrade", "head"],
        cwd=workspace_root,
        timeout=120,
    )
    migration_output = upgrade_result.stdout + upgrade_result.stderr

    if upgrade_result.returncode != 0:
        log.error("alembic upgrade head failed: %s", migration_output.strip())
        return {
            "ok": False,
            "safety_check": safety_check,
            "backup_path": backup_path,
            "migration_output": migration_output,
            "error": "alembic upgrade head failed",
        }

    log.info("Migrations applied successfully")
    return {
        "ok": True,
        "safety_check": safety_check,
        "backup_path": backup_path,
        "migration_output": migration_output,
    }
