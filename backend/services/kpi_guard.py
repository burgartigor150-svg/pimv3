from __future__ import annotations

from typing import Any, Dict, List


def compute_task_kpis(events: List[Dict[str, Any]]) -> Dict[str, float]:
    total_events = len(events or [])
    blocker_events = 0
    verified_fields = 0
    all_fields = 0
    moderation_events = 0
    cycle_values: List[int] = []
    for ev in events or []:
        et = ev.get("event_type")
        p = ev.get("payload", {}) if isinstance(ev.get("payload"), dict) else {}
        if et == "blocker":
            blocker_events += 1
        if et == "field_decision":
            evc = p.get("evidence_contract", {}) if isinstance(p.get("evidence_contract"), dict) else {}
            all_fields += len(evc)
            verified_fields += sum(1 for _, x in evc.items() if isinstance(x, dict) and float(x.get("confidence", 0.0) or 0.0) >= 0.6)
            if p.get("cycle") is not None:
                try:
                    cycle_values.append(int(p.get("cycle")))
                except Exception:
                    pass
        if et == "moderation_transition":
            moderation_events += 1
    hallucination_block_rate = (blocker_events / total_events) if total_events else 0.0
    verified_field_coverage = (verified_fields / all_fields) if all_fields else 0.0
    cycles_to_moderation_p95 = float(max(cycle_values) if cycle_values else 0.0)
    return {
        "hallucination_block_rate": round(hallucination_block_rate, 4),
        "verified_field_coverage": round(verified_field_coverage, 4),
        "cycles_to_moderation_p95": round(cycles_to_moderation_p95, 2),
        "moderation_transitions": float(moderation_events),
    }


def should_auto_stop_self_rewrite(kpis: Dict[str, float]) -> Dict[str, Any]:
    reasons: List[str] = []
    if float(kpis.get("verified_field_coverage", 0.0)) < 0.35:
        reasons.append("verified_field_coverage below threshold 0.35")
    if float(kpis.get("hallucination_block_rate", 0.0)) > 0.5:
        reasons.append("hallucination_block_rate above threshold 0.50")
    if float(kpis.get("cycles_to_moderation_p95", 0.0)) > 20:
        reasons.append("cycles_to_moderation_p95 above threshold 20")
    return {"stop": len(reasons) > 0, "reasons": reasons}


def canary_gate_ok(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Canary gate: автоприменение допускаем только если в истории были успешные переходы в модерацию.
    """
    transitions = 0
    recent_blockers = 0
    for ev in events or []:
        et = ev.get("event_type")
        if et == "moderation_transition":
            transitions += 1
        elif et == "blocker":
            recent_blockers += 1
    ok = transitions > 0 and recent_blockers < 50
    reasons = []
    if transitions == 0:
        reasons.append("no moderation_transition events in telemetry")
    if recent_blockers >= 50:
        reasons.append("too many blockers for canary apply")
    return {"ok": ok, "reasons": reasons, "moderation_transitions": transitions, "blockers": recent_blockers}

