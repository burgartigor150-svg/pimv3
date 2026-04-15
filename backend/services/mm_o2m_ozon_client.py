from typing import Any, Dict, Optional

import requests

OZON_API_URL = "https://api-seller.ozon.ru"


def get_headers(
    creds: Optional[Dict[str, Any]] = None,
    default_client_id: Optional[str] = None,
    default_api_key: Optional[str] = None,
) -> Dict[str, str]:
    client_id = creds.get("client_id") if creds else default_client_id
    api_key = creds.get("api_key") if creds else default_api_key
    return {
        "Client-Id": client_id,
        "Api-Key": api_key,
        "Content-Type": "application/json",
    }


def post(
    path_or_url: str,
    payload: Dict[str, Any],
    creds: Optional[Dict[str, Any]] = None,
    timeout: int = 30,
    default_client_id: Optional[str] = None,
    default_api_key: Optional[str] = None,
):
    absolute = path_or_url.startswith("http://") or path_or_url.startswith("https://")
    url = path_or_url if absolute else f"{OZON_API_URL}{path_or_url}"
    return requests.post(
        url,
        headers=get_headers(creds, default_client_id, default_api_key),
        json=payload,
        timeout=timeout,
    )
