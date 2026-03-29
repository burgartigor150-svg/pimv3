from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List


def build_self_rewrite_plan(events: List[Dict[str, Any]], max_hypotheses: int = 5) -> Dict[str, Any]:
    """
    Анализирует telemetry events и формирует гипотезы для патча кода.
    """
    blocker_types: Counter[str] = Counter()
    blocker_fields: Counter[str] = Counter()
    stage_counter: Counter[str] = Counter()
    for ev in events or []:
        if ev.get("event_type") != "blocker":
            continue
        payload = ev.get("payload", {}) if isinstance(ev.get("payload"), dict) else {}
        stage = str(payload.get("stage", "unknown"))
        stage_counter[stage] += 1
        for b in payload.get("blockers", []) or []:
            if not isinstance(b, dict):
                continue
            blocker_types[str(b.get("type", "unknown"))] += 1
            if b.get("field"):
                blocker_fields[str(b.get("field"))] += 1

    top_types = blocker_types.most_common(max_hypotheses)
    top_fields = blocker_fields.most_common(max_hypotheses)
    top_stages = stage_counter.most_common(max_hypotheses)
    hypotheses: List[Dict[str, Any]] = []
    for bt, cnt in top_types:
        hypotheses.append(
            {
                "problem_type": bt,
                "count": cnt,
                "proposed_change": f"Усилить обработку для blocker типа '{bt}' в mapper/reviewer/verifier.",
            }
        )
    return {
        "summary": {
            "events_analyzed": len(events or []),
            "top_blocker_types": top_types,
            "top_blocker_fields": top_fields,
            "top_stages": top_stages,
        },
        "hypotheses": hypotheses,
    }

