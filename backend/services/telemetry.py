from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List

import redis


_redis = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)


def _telemetry_dir() -> Path:
    p = Path(os.getenv("AGENT_TELEMETRY_DIR", "/mnt/data/Pimv3/backend/data/telemetry"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def append_task_event(task_id: str, event_type: str, payload: Dict[str, Any]) -> None:
    event = {
        "ts": int(time.time()),
        "event_type": event_type,
        "payload": payload or {},
    }
    line = json.dumps(event, ensure_ascii=False)
    try:
        key = f"task:{task_id}:events"
        _redis.rpush(key, line)
        _redis.ltrim(key, -400, -1)
    except Exception:
        pass
    try:
        fp = _telemetry_dir() / f"{task_id}.jsonl"
        with fp.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def get_task_events(task_id: str, tail: int = 200) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        raw = _redis.lrange(f"task:{task_id}:events", -max(1, int(tail)), -1) or []
        for x in raw:
            try:
                obj = json.loads(x)
                if isinstance(obj, dict):
                    out.append(obj)
            except Exception:
                continue
    except Exception:
        pass
    return out

