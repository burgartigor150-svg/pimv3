from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import time
from typing import Any, Dict, List

_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")


def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _hash_embed(text: str, dim: int = 256) -> List[float]:
    vec = [0.0] * dim
    tokens = _TOKEN_RE.findall(_norm_text(text))
    if not tokens:
        return vec
    for tok in tokens:
        h = hashlib.sha1(tok.encode("utf-8")).digest()
        idx = int.from_bytes(h[:2], "big") % dim
        sign = -1.0 if (h[2] & 1) else 1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return float(sum(x * y for x, y in zip(a, b)))


class AgentVectorMemory:
    """
    Локальная векторная БД без внешних сервисов:
    - SQLite хранит вектора и payload
    - поиск: cosine similarity по всем кейсам namespace
    """

    def __init__(self, *, path: str, dim: int = 256):
        self.path = path
        self.dim = dim
        self._lock = threading.Lock()
        os.makedirs(self.path, exist_ok=True)
        self.db_path = os.path.join(self.path, "agent_memory.sqlite3")
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.db_path, check_same_thread=False)
        con.execute("PRAGMA journal_mode=WAL;")
        return con

    def _init_db(self) -> None:
        with self._conn() as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS memory_cases (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL,
                    sku TEXT,
                    category_id TEXT,
                    problem_text TEXT,
                    action_summary TEXT,
                    result_status TEXT,
                    metadata_json TEXT,
                    vector_json TEXT NOT NULL,
                    ts INTEGER NOT NULL
                )
                """
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_memory_namespace_ts ON memory_cases(namespace, ts DESC)")
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS knowledge_docs (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL,
                    source_uri TEXT NOT NULL,
                    title TEXT,
                    content TEXT NOT NULL,
                    metadata_json TEXT,
                    vector_json TEXT NOT NULL,
                    ts INTEGER NOT NULL
                )
                """
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_knowledge_namespace_ts ON knowledge_docs(namespace, ts DESC)")

    def add_case(
        self,
        *,
        namespace: str,
        sku: str,
        category_id: str,
        problem_text: str,
        action_summary: str,
        result_status: str,
        metadata: Dict[str, Any] | None = None,
    ) -> str:
        ts = int(time.time())
        point_id = hashlib.sha1(
            f"{namespace}|{sku}|{category_id}|{ts}|{(problem_text or '')[:120]}".encode("utf-8")
        ).hexdigest()
        text = f"{namespace}\n{problem_text}\n{action_summary}\n{result_status}"
        vec = _hash_embed(text, self.dim)
        with self._lock:
            with self._conn() as con:
                con.execute(
                    """
                    INSERT OR REPLACE INTO memory_cases
                    (id, namespace, sku, category_id, problem_text, action_summary, result_status, metadata_json, vector_json, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        point_id,
                        namespace,
                        str(sku or ""),
                        str(category_id or ""),
                        problem_text or "",
                        action_summary or "",
                        result_status or "",
                        json.dumps(metadata or {}, ensure_ascii=False),
                        json.dumps(vec, ensure_ascii=False),
                        ts,
                    ),
                )
        return point_id

    def search(
        self,
        *,
        namespace: str,
        query: str,
        limit: int = 5,
        score_threshold: float = 0.2,
    ) -> List[Dict[str, Any]]:
        qv = _hash_embed(f"{namespace}\n{query}", self.dim)
        with self._lock:
            with self._conn() as con:
                rows = con.execute(
                    """
                    SELECT id, sku, category_id, problem_text, action_summary, result_status, metadata_json, vector_json, ts
                    FROM memory_cases
                    WHERE namespace = ?
                    ORDER BY ts DESC
                    LIMIT 500
                    """,
                    (namespace,),
                ).fetchall()
        scored: List[Dict[str, Any]] = []
        for row in rows:
            rid, sku, cat, problem, action, status, meta_json, vec_json, ts = row
            try:
                vec = json.loads(vec_json)
                score = _cosine(qv, vec)
            except Exception:
                continue
            if score < score_threshold:
                continue
            try:
                meta = json.loads(meta_json) if meta_json else {}
            except Exception:
                meta = {}
            scored.append(
                {
                    "id": rid,
                    "score": score,
                    "problem_text": problem or "",
                    "action_summary": action or "",
                    "result_status": status or "",
                    "sku": sku or "",
                    "category_id": cat or "",
                    "ts": ts,
                    "metadata": meta,
                }
            )
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[: max(1, min(limit, 20))]

    def clear_namespace(self, namespace: str) -> int:
        ns = str(namespace or "").strip()
        if not ns:
            return 0
        with self._lock:
            with self._conn() as con:
                cur = con.execute("DELETE FROM memory_cases WHERE namespace = ?", (ns,))
                return int(cur.rowcount or 0)

    def upsert_knowledge_doc(
        self,
        *,
        namespace: str,
        source_uri: str,
        title: str,
        content: str,
        metadata: Dict[str, Any] | None = None,
    ) -> str:
        ts = int(time.time())
        ns = str(namespace or "").strip()
        src = str(source_uri or "").strip()
        body = str(content or "").strip()
        ttl = str(title or "").strip()
        if not ns or not src or not body:
            raise ValueError("namespace, source_uri, content are required")
        point_id = hashlib.sha1(f"{ns}|{src}|{ttl}".encode("utf-8")).hexdigest()
        vec = _hash_embed(f"{ttl}\n{body}", self.dim)
        with self._lock:
            with self._conn() as con:
                con.execute(
                    """
                    INSERT OR REPLACE INTO knowledge_docs
                    (id, namespace, source_uri, title, content, metadata_json, vector_json, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        point_id,
                        ns,
                        src,
                        ttl,
                        body,
                        json.dumps(metadata or {}, ensure_ascii=False),
                        json.dumps(vec, ensure_ascii=False),
                        ts,
                    ),
                )
        return point_id

    def search_knowledge(
        self,
        *,
        namespace: str,
        query: str,
        limit: int = 8,
        score_threshold: float = 0.15,
    ) -> List[Dict[str, Any]]:
        qv = _hash_embed(f"{namespace}\n{query}", self.dim)
        with self._lock:
            with self._conn() as con:
                rows = con.execute(
                    """
                    SELECT id, source_uri, title, content, metadata_json, vector_json, ts
                    FROM knowledge_docs
                    WHERE namespace = ?
                    ORDER BY ts DESC
                    LIMIT 1200
                    """,
                    (namespace,),
                ).fetchall()
        scored: List[Dict[str, Any]] = []
        for row in rows:
            rid, src, title, content, meta_json, vec_json, ts = row
            try:
                vec = json.loads(vec_json)
                score = _cosine(qv, vec)
            except Exception:
                continue
            if score < score_threshold:
                continue
            try:
                meta = json.loads(meta_json) if meta_json else {}
            except Exception:
                meta = {}
            scored.append(
                {
                    "id": rid,
                    "score": score,
                    "source_uri": src or "",
                    "title": title or "",
                    "content_excerpt": (content or "")[:1500],
                    "metadata": meta,
                    "ts": ts,
                }
            )
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[: max(1, min(limit, 50))]

    def list_knowledge_sources(self, *, namespace: str, limit: int = 200) -> List[Dict[str, Any]]:
        with self._lock:
            with self._conn() as con:
                rows = con.execute(
                    """
                    SELECT id, source_uri, title, ts
                    FROM knowledge_docs
                    WHERE namespace = ?
                    ORDER BY ts DESC
                    LIMIT ?
                    """,
                    (namespace, max(1, min(int(limit), 2000))),
                ).fetchall()
        return [
            {"id": r[0], "source_uri": r[1] or "", "title": r[2] or "", "ts": r[3]}
            for r in rows
        ]


_MEMORY_SINGLETON: AgentVectorMemory | None = None


def get_agent_memory() -> AgentVectorMemory:
    global _MEMORY_SINGLETON
    if _MEMORY_SINGLETON is None:
        data_path = os.getenv("AGENT_VECTOR_DB_PATH", "/mnt/data/Pimv3/backend/data/vector_memory")
        try:
            candidate = AgentVectorMemory(path=data_path)
            # Verify DB is writable at runtime; readonly mounts may pass init but fail on first write.
            test_ns = "__healthcheck__"
            candidate.add_case(
                namespace=test_ns,
                sku="",
                category_id="",
                problem_text="healthcheck",
                action_summary="healthcheck",
                result_status="ok",
                metadata={"k": "v"},
            )
            candidate.clear_namespace(test_ns)
            _MEMORY_SINGLETON = candidate
        except Exception:
            fallback_path = os.getenv("AGENT_VECTOR_DB_FALLBACK_PATH", "/tmp/pimv3_vector_memory")
            _MEMORY_SINGLETON = AgentVectorMemory(path=fallback_path)
    return _MEMORY_SINGLETON

