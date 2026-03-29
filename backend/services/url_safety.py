"""
Ограничение исходящих запросов для /api/v1/media/proxy (защита от SSRF).
"""
import ipaddress
import os
import re
from urllib.parse import urlparse

_DEFAULT_SUFFIXES = (
    "ozon.ru",
    "ozone.ru",
    "wildberries.ru",
    "wbbasket.ru",
    "wb.ru",
    "megamarket.ru",
    "sbermegamarket.ru",
    "cdnimg.rzd.ru",
    "static-basket-01.wbbasket.ru",
    "basket-01.wbbasket.ru",
    "basket-02.wbbasket.ru",
)


def _allowed_suffixes() -> tuple[str, ...]:
    raw = os.getenv("IMAGE_PROXY_ALLOWED_HOST_SUFFIXES", "")
    if not raw.strip():
        return _DEFAULT_SUFFIXES
    parts = [p.strip().lower().lstrip(".") for p in raw.split(",") if p.strip()]
    return tuple(parts) if parts else _DEFAULT_SUFFIXES


def _host_is_private_ip(hostname: str) -> bool:
    if not hostname:
        return True
    try:
        ip = ipaddress.ip_address(hostname)
        return not ip.is_global
    except ValueError:
        return False


def is_safe_proxy_target(url: str) -> bool:
    """
    Разрешены только http/https, хост не link-local/private,
    и hostname оканчивается на один из суффиксов из allowlist (или ровно равен ему).
    """
    if not url or not isinstance(url, str):
        return False
    url = url.strip()
    if len(url) > 8192:
        return False
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    if host in ("localhost", "127.0.0.1", "::1", "0.0.0.0") or host.endswith(".localhost"):
        return False
    if _host_is_private_ip(host):
        return False
    # Запрет явных internal host patterns
    if re.match(r"^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)", host):
        return False
    suffixes = _allowed_suffixes()
    for suf in suffixes:
        if host == suf or host.endswith("." + suf):
            return True
    return False


def is_safe_proxy_target_final(url: str) -> bool:
    """Проверка финального URL после редиректов."""
    return is_safe_proxy_target(url)
