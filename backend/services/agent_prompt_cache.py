import os
import logging
import json
import time
import hashlib
from typing import Dict, Any, Optional, List

import redis

logger = logging.getLogger(__name__)

_redis = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)
_CACHE_PREFIX = "agent:prompt_cache:"
_STATS_KEY = "agent:prompt_cache:stats"
DEFAULT_TTL = int(os.getenv("PROMPT_CACHE_TTL", str(3600 * 24)))  # 24 hours


def _cache_key(messages: List[Dict], model: str, max_tokens: int) -> str:
    """Generate deterministic cache key from messages + model + max_tokens using MD5."""
    payload = json.dumps({"messages": messages, "model": model, "max_tokens": max_tokens}, sort_keys=True)
    digest = hashlib.md5(payload.encode("utf-8")).hexdigest()
    return f"{_CACHE_PREFIX}{digest}"


def get_cached_response(
    messages: List[Dict[str, str]],
    model: str,
    max_tokens: int = 4096,
) -> Optional[Dict[str, Any]]:
    """Check Redis cache. Returns cached API response dict or None.
    Increments cache hit stats."""
    key = _cache_key(messages, model, max_tokens)
    try:
        raw = _redis.get(key)
        if raw is None:
            _redis.hincrby(_STATS_KEY, "misses", 1)
            return None
        _redis.hincrby(_STATS_KEY, "hits", 1)
        logger.debug("Cache hit for key %s", key)
        return json.loads(raw)
    except redis.RedisError as exc:
        logger.warning("Redis error during cache get: %s", exc)
        _redis.hincrby(_STATS_KEY, "misses", 1)
        return None


def cache_response(
    messages: List[Dict[str, str]],
    model: str,
    response: Dict[str, Any],
    max_tokens: int = 4096,
    ttl: int = DEFAULT_TTL,
) -> None:
    """Store LLM response in Redis with TTL.
    Increments cache store stats."""
    key = _cache_key(messages, model, max_tokens)
    try:
        _redis.setex(key, ttl, json.dumps(response))
        _redis.hincrby(_STATS_KEY, "stores", 1)
        logger.debug("Cached response at key %s (ttl=%ds)", key, ttl)
    except redis.RedisError as exc:
        logger.warning("Redis error during cache set: %s", exc)


def should_cache(messages: List[Dict[str, str]]) -> bool:
    """Decide if this request should be cached.
    Don't cache if: last message contains file paths that change often,
    or if message total length < 100 chars (trivial),
    or if message contains 'time', 'now', 'current date'."""
    if not messages:
        return False

    total_text = " ".join(m.get("content", "") for m in messages)

    if len(total_text) < 100:
        return False

    lower_total = total_text.lower()
    volatile_phrases = ("time", "now", "current date")
    for phrase in volatile_phrases:
        if phrase in lower_total:
            return False

    last_content = messages[-1].get("content", "")
    # Heuristic: contains a filesystem path segment
    if "/" in last_content or "\\" in last_content:
        # Only skip if it looks like an absolute or relative file path token
        import re
        if re.search(r"(?:^|[\s\"'])(?:/[\w./\-]+|\.{1,2}/[\w./\-]+)", last_content):
            return False

    return True


async def cached_llm_call(
    client,  # httpx.AsyncClient
    api_url: str,
    headers: Dict[str, str],
    messages: List[Dict[str, str]],
    model: str = "deepseek-chat",
    max_tokens: int = 4096,
    temperature: float = 0.0,
    bypass_cache: bool = False,
) -> Dict[str, Any]:
    """Drop-in wrapper for LLM API calls with caching.
    1. If should_cache and not bypass_cache: check cache, return if hit
    2. Otherwise: make real API call
    3. Cache the response if should_cache
    Returns standard OpenAI-compatible response dict."""
    use_cache = should_cache(messages) and not bypass_cache

    if use_cache:
        cached = get_cached_response(messages, model, max_tokens)
        if cached is not None:
            return cached

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    response = await client.post(api_url, headers=headers, json=payload)
    response.raise_for_status()
    result: Dict[str, Any] = response.json()

    if use_cache:
        cache_response(messages, model, result, max_tokens)

    return result


def get_cache_stats() -> Dict[str, Any]:
    """Return: hits, misses, hit_rate_pct, total_keys, estimated_tokens_saved."""
    try:
        raw = _redis.hgetall(_STATS_KEY)
    except redis.RedisError as exc:
        logger.warning("Redis error fetching stats: %s", exc)
        raw = {}

    hits = int(raw.get("hits", 0))
    misses = int(raw.get("misses", 0))
    stores = int(raw.get("stores", 0))
    total_requests = hits + misses
    hit_rate_pct = round(hits / total_requests * 100, 2) if total_requests > 0 else 0.0

    try:
        key_count = len(_redis.keys(f"{_CACHE_PREFIX}*"))
    except redis.RedisError:
        key_count = 0

    # Rough estimate: average LLM response ~1 000 tokens saved per cache hit
    estimated_tokens_saved = hits * 1000

    return {
        "hits": hits,
        "misses": misses,
        "stores": stores,
        "hit_rate_pct": hit_rate_pct,
        "total_keys": key_count,
        "estimated_tokens_saved": estimated_tokens_saved,
    }


def clear_cache(pattern: str = "*") -> int:
    """Clear cache keys matching pattern. Returns count deleted."""
    full_pattern = f"{_CACHE_PREFIX}{pattern}"
    try:
        keys = _redis.keys(full_pattern)
        if not keys:
            return 0
        deleted = _redis.delete(*keys)
        logger.info("Cleared %d cache keys matching %s", deleted, full_pattern)
        return deleted
    except redis.RedisError as exc:
        logger.warning("Redis error during cache clear: %s", exc)
        return 0
