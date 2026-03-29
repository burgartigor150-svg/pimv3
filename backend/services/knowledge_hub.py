from __future__ import annotations

import re
import time
from typing import Any, Dict, List

import httpx

from backend.services.agent_memory import get_agent_memory


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _html_to_text(html: str) -> str:
    txt = _TAG_RE.sub(" ", html or "")
    return _WS_RE.sub(" ", txt).strip()


def _chunk_text(text: str, chunk_size: int = 3000, overlap: int = 350) -> List[str]:
    s = str(text or "").strip()
    if not s:
        return []
    out: List[str] = []
    i = 0
    while i < len(s):
        out.append(s[i : i + chunk_size])
        if i + chunk_size >= len(s):
            break
        i += max(1, chunk_size - overlap)
    return out


async def ingest_url_to_knowledge(
    *,
    namespace: str,
    url: str,
    title: str | None = None,
    metadata: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        res = await client.get(url)
    if res.status_code >= 400:
        return {"ok": False, "error": f"http_{res.status_code}"}
    text = _html_to_text(res.text)
    chunks = _chunk_text(text)
    mem = get_agent_memory()
    ids: List[str] = []
    for idx, c in enumerate(chunks):
        ids.append(
            mem.upsert_knowledge_doc(
                namespace=namespace,
                source_uri=f"{url}#chunk-{idx+1}",
                title=(title or url),
                content=c,
                metadata={
                    "source_url": url,
                    "chunk_index": idx + 1,
                    "chunks_total": len(chunks),
                    **(metadata or {}),
                },
            )
        )
    return {"ok": True, "url": url, "chunks": len(chunks), "ids": ids[:20]}


def search_knowledge(namespace: str, query: str, limit: int = 8) -> Dict[str, Any]:
    mem = get_agent_memory()
    hits = mem.search_knowledge(namespace=namespace, query=query, limit=limit, score_threshold=0.12)
    return {"ok": True, "namespace": namespace, "query": query, "hits": hits}


def list_knowledge(namespace: str, limit: int = 200) -> Dict[str, Any]:
    mem = get_agent_memory()
    rows = mem.list_knowledge_sources(namespace=namespace, limit=limit)
    return {"ok": True, "namespace": namespace, "sources": rows}


async def bootstrap_qwen_commands_knowledge() -> Dict[str, Any]:
    urls = [
        "https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/",
    ]
    done: List[Dict[str, Any]] = []
    started = int(time.time())
    for u in urls:
        done.append(await ingest_url_to_knowledge(namespace="docs:qwen-code", url=u, title="Qwen Code Commands"))
    return {"ok": True, "started_at_ts": started, "items": done}


def ingest_local_markdown_file(*, namespace: str, path: str, title: str | None = None) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    chunks = _chunk_text(text)
    mem = get_agent_memory()
    ids: List[str] = []
    for idx, c in enumerate(chunks):
        ids.append(
            mem.upsert_knowledge_doc(
                namespace=namespace,
                source_uri=f"file://{path}#chunk-{idx+1}",
                title=title or path,
                content=c,
                metadata={"source_file": path, "chunk_index": idx + 1, "chunks_total": len(chunks)},
            )
        )
    return {"ok": True, "path": path, "chunks": len(chunks), "ids": ids[:20]}

