"""Download external product images to local storage and replace URLs."""
import os
import hashlib
import asyncio
import httpx
from typing import List, Optional

UPLOADS_DIR = "uploads"
_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36"}


def _is_local(url: str) -> bool:
    return url.startswith("/api/v1/uploads/") or url.startswith("/uploads/")


def _guess_ext(content_type: str, url: str) -> str:
    ct = content_type.lower()
    if "webp" in ct: return "webp"
    if "png" in ct: return "png"
    if "gif" in ct: return "gif"
    if "jpeg" in ct or "jpg" in ct: return "jpg"
    u = url.lower().split("?")[0]
    for ext in ("webp", "png", "gif", "jpg", "jpeg"):
        if u.endswith(ext):
            return "jpg" if ext == "jpeg" else ext
    return "jpg"


async def download_image(url: str) -> Optional[str]:
    """Download one image, save to uploads/, return local URL or None."""
    if not url or not url.strip():
        return None
    url = url.strip()
    if _is_local(url):
        return url

    os.makedirs(UPLOADS_DIR, exist_ok=True)
    key = hashlib.sha1(url.encode()).hexdigest()[:24]

    # Check if already downloaded (any extension)
    for ext in ("jpg", "webp", "png", "gif"):
        fname = f"img_{key}.{ext}"
        if os.path.exists(os.path.join(UPLOADS_DIR, fname)):
            return f"/api/v1/uploads/{fname}"

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, max_redirects=5) as client:
            r = await client.get(url, headers=_HEADERS)
            if r.status_code != 200:
                return None
            body = r.content
            if len(body) < 64:
                return None
            ct = r.headers.get("content-type", "")
            if ct and "image" not in ct.lower():
                return None
            ext = _guess_ext(ct, str(r.url))
            fname = f"img_{key}.{ext}"
            fpath = os.path.join(UPLOADS_DIR, fname)
            with open(fpath, "wb") as f:
                f.write(body)
            return f"/api/v1/uploads/{fname}"
    except Exception:
        return None


async def download_product_images(images: List[str]) -> List[str]:
    """Download all external images concurrently, return list of local URLs (skip failures)."""
    if not images:
        return []
    tasks = [download_image(url) for url in images]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    local = []
    for orig, result in zip(images, results):
        if isinstance(result, str):
            local.append(result)
        else:
            local.append(orig)  # keep original if download failed
    return local
