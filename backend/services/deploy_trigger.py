from __future__ import annotations

import os
from typing import Any, Dict

import httpx


async def trigger_deploy(event: Dict[str, Any]) -> Dict[str, Any]:
    webhook = (os.getenv("DEPLOY_WEBHOOK_URL", "") or "").strip()
    if not webhook:
        return {"ok": False, "error": "deploy_webhook_not_configured"}
    token = (os.getenv("DEPLOY_WEBHOOK_TOKEN", "") or "").strip()
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post(webhook, headers=headers, json=event or {})
    if 200 <= res.status_code < 300:
        return {"ok": True, "status_code": res.status_code, "response": res.text[:1000]}
    return {"ok": False, "error": f"deploy_webhook_{res.status_code}", "response": res.text[:2000]}

