"""
backend/services/agent_perf_regression.py

Performance regression detection for PIMv3 agent task completions.
Runs pytest, parses per-test timing, compares against a rolling baseline
stored in Redis, and reports regressions above a configurable threshold.
"""

import os
import logging
import json
import time
import subprocess
import re
from typing import Dict, Any, List, Optional
from pathlib import Path

import redis

log = logging.getLogger(__name__)

_redis: redis.Redis = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

# Redis hash: test_name -> duration_seconds (float stored as string)
_BASELINE_KEY = "agent:perf:baseline"
# Redis list of JSON snapshot strings (newest at head)
_HISTORY_KEY = "agent:perf:history"

_HISTORY_CAP = 50

# Regex matching pytest verbose timing lines produced by -v or --tb=no -q
# Examples:
#   PASSED backend/tests/test_foo.py::test_bar (0.23s)
#   FAILED backend/tests/test_foo.py::test_bar (1.05s)
_TIMING_RE = re.compile(
    r"(?:PASSED|FAILED|ERROR)\s+(\S+::[\w\[\]\-]+)\s+\((\d+(?:\.\d+)?)s\)"
)

# Weights for rolling baseline update: w_old * old + w_new * new
_BASELINE_WEIGHT_OLD = 0.8
_BASELINE_WEIGHT_NEW = 0.2


def run_timed_tests(
    workspace_root: str = "/mnt/data/Pimv3",
    test_path: str = "backend/tests",
    timeout: int = 120,
) -> Dict[str, Any]:
    """Run pytest with ``--tb=no -v`` and parse per-test timing output.

    Pytest's ``-v`` flag emits lines like::

        PASSED backend/tests/test_foo.py::test_bar (0.23s)

    which are parsed by :data:`_TIMING_RE`.

    Args:
        workspace_root: Absolute path to the project root.
        test_path: Path relative to *workspace_root* where tests live.
        timeout: Maximum seconds to let pytest run before killing it.

    Returns::

        {
            "ok": True,
            "results": {"test_name": duration_float, ...},
            "total_seconds": float,
        }

    On subprocess error or timeout the dict contains ``"ok": False`` and an
    ``"error"`` key with a human-readable description.
    """
    abs_test_path = str(Path(workspace_root) / test_path)
    cmd: List[str] = [
        "python", "-m", "pytest",
        abs_test_path,
        "--tb=no",
        "-v",
        "-q",
    ]

    log.info("Running timed tests: %s (timeout=%ds)", " ".join(cmd), timeout)
    start = time.monotonic()

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=workspace_root,
        )
    except subprocess.TimeoutExpired:
        log.error("pytest timed out after %ds", timeout)
        return {"ok": False, "error": f"pytest timed out after {timeout}s", "results": {}, "total_seconds": 0.0}
    except FileNotFoundError as exc:
        log.error("pytest not found: %s", exc)
        return {"ok": False, "error": str(exc), "results": {}, "total_seconds": 0.0}

    elapsed = time.monotonic() - start
    output = proc.stdout + "\n" + proc.stderr

    results: Dict[str, float] = {}
    for match in _TIMING_RE.finditer(output):
        test_name = match.group(1)
        duration = float(match.group(2))
        results[test_name] = duration

    if not results:
        log.warning(
            "No timing data parsed from pytest output (returncode=%d). "
            "Output snippet: %s",
            proc.returncode,
            output[:400],
        )

    log.info(
        "Parsed %d test timings in %.2fs (pytest returncode=%d)",
        len(results),
        elapsed,
        proc.returncode,
    )

    return {
        "ok": True,
        "results": results,
        "total_seconds": round(elapsed, 3),
        "pytest_returncode": proc.returncode,
    }


def update_baseline(results: Dict[str, float]) -> None:
    """Update the Redis baseline with fresh test timings using a rolling average.

    Formula: ``new_baseline = 0.8 * old_baseline + 0.2 * current``

    For tests not yet in the baseline the current duration is stored directly.

    Args:
        results: Mapping of test name to measured duration in seconds.
    """
    if not results:
        log.debug("update_baseline called with empty results; nothing to do")
        return

    existing: Dict[str, str] = _redis.hgetall(_BASELINE_KEY)
    updates: Dict[str, float] = {}

    for test_name, current_s in results.items():
        if test_name in existing:
            old_s = float(existing[test_name])
            blended = _BASELINE_WEIGHT_OLD * old_s + _BASELINE_WEIGHT_NEW * current_s
        else:
            blended = current_s
        updates[test_name] = round(blended, 6)

    # HSET accepts a mapping directly
    _redis.hset(_BASELINE_KEY, mapping={k: str(v) for k, v in updates.items()})
    log.info("Updated baseline for %d tests", len(updates))


def check_regression(
    results: Dict[str, float],
    threshold_pct: float = 20.0,
) -> Dict[str, Any]:
    """Compare *results* against the stored baseline.

    A *regression* is any test whose current duration exceeds the baseline by
    more than *threshold_pct* percent.  An *improvement* is any test that is
    more than *threshold_pct* percent faster than the baseline.

    Tests with no baseline entry are skipped (not treated as regressions).

    Args:
        results: Mapping of test name to measured duration in seconds.
        threshold_pct: Percentage delta that triggers a regression/improvement flag.

    Returns::

        {
            "ok": bool,           # False if any regression found
            "regressions": [...],
            "improvements": [...],
            "summary": str,
        }

    Each regression/improvement entry::

        {"test": str, "baseline_s": float, "current_s": float, "delta_pct": float}
    """
    baseline_raw: Dict[str, str] = _redis.hgetall(_BASELINE_KEY)
    baseline: Dict[str, float] = {k: float(v) for k, v in baseline_raw.items()}

    regressions: List[Dict[str, Any]] = []
    improvements: List[Dict[str, Any]] = []

    for test_name, current_s in results.items():
        if test_name not in baseline:
            log.debug("No baseline for %s; skipping regression check", test_name)
            continue

        baseline_s = baseline[test_name]
        if baseline_s <= 0:
            log.debug("Baseline for %s is zero/negative; skipping", test_name)
            continue

        delta_pct = (current_s - baseline_s) / baseline_s * 100.0
        entry: Dict[str, Any] = {
            "test": test_name,
            "baseline_s": round(baseline_s, 6),
            "current_s": round(current_s, 6),
            "delta_pct": round(delta_pct, 2),
        }

        if delta_pct > threshold_pct:
            regressions.append(entry)
        elif delta_pct < -threshold_pct:
            improvements.append(entry)

    ok = len(regressions) == 0
    summary_parts: List[str] = [
        f"{len(results)} tests measured",
        f"{len(regressions)} regressions",
        f"{len(improvements)} improvements",
    ]
    if regressions:
        worst = max(regressions, key=lambda r: r["delta_pct"])
        summary_parts.append(
            f"worst regression: {worst['test']} +{worst['delta_pct']:.1f}%"
        )
    summary = "; ".join(summary_parts)

    log.info("Regression check complete: %s", summary)

    return {
        "ok": ok,
        "regressions": regressions,
        "improvements": improvements,
        "summary": summary,
    }


def run_regression_check(
    workspace_root: str = "/mnt/data/Pimv3",
    threshold_pct: float = 20.0,
    update_baseline_on_pass: bool = True,
) -> Dict[str, Any]:
    """Full regression-detection pipeline.

    Steps:

    1. Run ``pytest`` and collect per-test timings via :func:`run_timed_tests`.
    2. Compare timings to the stored baseline via :func:`check_regression`.
    3. If no regressions and *update_baseline_on_pass* is ``True``, update the
       baseline with :func:`update_baseline`.
    4. Persist a JSON snapshot to the history list (capped at
       :data:`_HISTORY_CAP` entries).

    Returns the merged result dict from both steps, adding a ``"run_ts"`` key
    (unix timestamp) and ``"baseline_updated"`` boolean.
    """
    run_ts = int(time.time())

    # Step 1: run tests
    run_result = run_timed_tests(workspace_root=workspace_root)
    if not run_result.get("ok"):
        log.error("run_timed_tests failed: %s", run_result.get("error"))
        snapshot = {**run_result, "run_ts": run_ts, "baseline_updated": False}
        _push_history_snapshot(snapshot)
        return snapshot

    results: Dict[str, float] = run_result.get("results", {})

    # Step 2: check regressions
    regression_result = check_regression(results, threshold_pct=threshold_pct)

    baseline_updated = False
    if regression_result["ok"] and update_baseline_on_pass and results:
        update_baseline(results)
        baseline_updated = True

    combined: Dict[str, Any] = {
        **run_result,
        **regression_result,
        "run_ts": run_ts,
        "baseline_updated": baseline_updated,
        "threshold_pct": threshold_pct,
    }

    _push_history_snapshot(combined)
    return combined


def _push_history_snapshot(snapshot: Dict[str, Any]) -> None:
    """Push *snapshot* to the head of the history list and trim to cap."""
    serialized = json.dumps(snapshot, default=str)
    pipe = _redis.pipeline()
    pipe.lpush(_HISTORY_KEY, serialized)
    pipe.ltrim(_HISTORY_KEY, 0, _HISTORY_CAP - 1)
    pipe.execute()
    log.debug("Pushed perf snapshot to history (capped at %d)", _HISTORY_CAP)


def get_perf_history(limit: int = 10) -> List[Dict[str, Any]]:
    """Return the last *limit* regression-check snapshots (newest first).

    Args:
        limit: Maximum number of snapshots to return.

    Returns:
        List of snapshot dicts as originally produced by :func:`run_regression_check`.
    """
    raw_entries: List[str] = _redis.lrange(_HISTORY_KEY, 0, limit - 1)
    history: List[Dict[str, Any]] = []
    for raw in raw_entries:
        try:
            history.append(json.loads(raw))
        except json.JSONDecodeError as exc:
            log.warning("Failed to parse perf history entry: %s", exc)
    log.debug("Retrieved %d perf history entries", len(history))
    return history
