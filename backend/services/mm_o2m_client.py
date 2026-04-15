from typing import Any, Dict, Optional

import requests

MM_API_URL = "https://api.megamarket.tech/api/merchantIntegration/assortment/v1"


def get_headers(
    creds: Optional[Dict[str, Any]] = None,
    default_token: Optional[str] = None,
) -> Dict[str, str]:
    token = creds.get("api_key") if creds else default_token
    return {
        "X-Merchant-Token": token,
        "Content-Type": "application/json",
    }


def post(
    path_or_url: str,
    payload: Dict[str, Any],
    creds: Optional[Dict[str, Any]] = None,
    timeout: int = 60,
    default_token: Optional[str] = None,
):
    absolute = path_or_url.startswith("http://") or path_or_url.startswith("https://")
    url = path_or_url if absolute else f"{MM_API_URL}{path_or_url}"
    return requests.post(
        url,
        headers=get_headers(creds, default_token),
        json=payload,
        timeout=timeout,
    )
