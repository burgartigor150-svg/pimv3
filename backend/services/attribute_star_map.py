from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from difflib import SequenceMatcher
from typing import Any, Dict, List, Tuple

import httpx

from backend.services.adapters import (
    get_adapter,
    megamarket_httpx_client,
    megamarket_request_headers,
)
from backend.services.agent_memory import get_agent_memory


_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")
_STAR_MAP_DIR = "/mnt/data/Pimv3/backend/data/attribute_star_map"
_STAR_MAP_SNAPSHOT = os.path.join(_STAR_MAP_DIR, "ozon_megamarket_star_map.json")
_STAR_MAP_MANUAL = os.path.join(_STAR_MAP_DIR, "manual_overrides.json")
_BUILD_JOBS: Dict[str, Dict[str, Any]] = {}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower().replace("ё", "е"))


def _tokens(s: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall(_norm(s)) if len(t) > 1}


def _sim(a: str, b: str) -> float:
    an = _norm(a)
    bn = _norm(b)
    if not an or not bn:
        return 0.0
    seq = SequenceMatcher(None, an, bn).ratio()
    at = _tokens(an)
    bt = _tokens(bn)
    jac = len(at & bt) / max(1, len(at | bt))
    if an in bn or bn in an:
        seq = max(seq, 0.82)
    return seq * 0.7 + jac * 0.3


def _pick_mm_candidate_categories(
    ozon_category_name: str,
    mm_categories: List[Dict[str, str]],
    k: int = 8,
) -> List[Dict[str, str]]:
    """
    Этапный матчинг категорий: для каждой категории Ozon берем несколько
    наиболее близких категорий MM, чтобы не обрабатывать весь MM за раз.
    """
    oz_name = str(ozon_category_name or "").strip()
    oz_tokens = _tokens(oz_name)
    scored: List[Tuple[float, Dict[str, str]]] = []
    for m in mm_categories or []:
        m_name = str(m.get("name") or "").strip()
        if not m_name:
            continue
        s = _sim(oz_name, m_name)
        if oz_tokens:
            mt = _tokens(m_name)
            jac = len(oz_tokens & mt) / max(1, len(oz_tokens | mt))
            s = s * 0.8 + jac * 0.2
        scored.append((s, m))
    scored.sort(key=lambda x: x[0], reverse=True)
    out = [m for s, m in scored[: max(1, int(k))] if s >= 0.05]
    if not out:
        out = [m for _, m in scored[: max(1, int(k // 2) or 1)]]
    return out


def _read_json(path: str, default: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path: str, obj: Any) -> None:
    os.makedirs(_STAR_MAP_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


def _build_tree_from_paths(items: List[Dict[str, str]], separator: str) -> List[Dict[str, Any]]:
    root: Dict[str, Any] = {"name": "__root__", "children": {}}
    for it in items or []:
        name = str(it.get("name") or "").strip()
        cid = str(it.get("id") or "").strip()
        if not name or not cid:
            continue
        parts = [p.strip() for p in name.split(separator) if p.strip()]
        node = root
        for idx, part in enumerate(parts):
            children = node.setdefault("children", {})
            if part not in children:
                children[part] = {"name": part, "children": {}}
            node = children[part]
            if idx == len(parts) - 1:
                node["category_id"] = cid
                node["full_path"] = name

    def _to_list(n: Dict[str, Any]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for k in sorted((n.get("children") or {}).keys()):
            c = (n.get("children") or {}).get(k) or {}
            out.append(
                {
                    "name": c.get("name"),
                    "category_id": c.get("category_id"),
                    "full_path": c.get("full_path"),
                    "children": _to_list(c),
                }
            )
        return out

    return _to_list(root)


async def _fetch_ozon_categories(api_key: str, client_id: str | None) -> List[Dict[str, str]]:
    import json as _j
    _cache_key = f"pim:ozon_cats:{client_id}"
    try:
        from backend.celery_worker import redis_client as _rc
        _cached = _rc.get(_cache_key)
        if _cached:
            return _j.loads(_cached)
    except Exception:
        pass
    headers = {
        "Client-Id": client_id or "",
        "Api-Key": api_key or "",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post("https://api-seller.ozon.ru/v1/description-category/tree", headers=headers)
        if res.status_code != 200:
            return []
        tree = res.json().get("result", []) or []
    out: List[Dict[str, str]] = []

    def walk(
        nodes: List[Dict[str, Any]],
        path: str,
        current_desc_id: str | None,
        current_desc_name: str | None,
    ) -> None:
        for n in nodes or []:
            if not isinstance(n, dict):
                continue
            name = str(n.get("category_name") or "").strip()
            type_name = str(n.get("type_name") or "").strip()
            cur = f"{path} / {name}".strip(" /") if path and name else (name or path)

            desc_id = current_desc_id
            desc_name = current_desc_name
            if n.get("description_category_id") is not None:
                desc_id = str(n.get("description_category_id"))
                desc_name = cur or desc_name

            type_id = n.get("type_id")
            if desc_id and type_id is not None:
                cat_id = f"{desc_id}_{type_id}"
                label = f"{(desc_name or cur).strip()} -> {type_name}".strip(" ->")
                out.append({"id": cat_id, "name": label})

            walk(n.get("children") or [], cur, desc_id, desc_name)

    walk(tree, "", None, None)
    uniq: Dict[str, Dict[str, str]] = {}
    for c in out:
        uniq[c["id"]] = c
    result = list(uniq.values())
    try:
        from backend.celery_worker import redis_client as _rc
        _rc.setex(_cache_key, 3600, _j.dumps(result, ensure_ascii=False))
    except Exception:
        pass
    return result


async def _fetch_mm_categories(api_key: str) -> List[Dict[str, str]]:
    import json as _j
    _mm_cache_key = f"pim:mm_cats:{api_key[:16]}"
    try:
        from backend.celery_worker import redis_client as _rc
        _cached = _rc.get(_mm_cache_key)
        if _cached:
            return _j.loads(_cached)
    except Exception:
        pass
    headers = megamarket_request_headers(api_key, for_post=False)
    async with megamarket_httpx_client(120.0) as client:
        res = await client.get(
            "https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/categoryTree/get",
            headers=headers,
        )
    if res.status_code != 200:
        return []
    tree = res.json().get("data", []) or []
    out: List[Dict[str, str]] = []

    def walk(nodes: List[Dict[str, Any]], path: str) -> None:
        for n in nodes or []:
            if not isinstance(n, dict):
                continue
            name = str(n.get("name") or "").strip()
            cur = f"{path} -> {name}".strip(" ->") if path else name
            children = n.get("children") or []
            lvl = n.get("level")
            is_leaf = not children
            if is_leaf:
                ok = True
                if lvl is not None:
                    try:
                        ok = int(lvl) == 6
                    except Exception:
                        ok = True
                if ok and n.get("id") is not None:
                    out.append({"id": str(n.get("id")), "name": cur})
            walk(children, cur)

    walk(tree, "")
    uniq: Dict[str, Dict[str, str]] = {}
    for c in out:
        uniq[c["id"]] = c
    mm_result = list(uniq.values())
    try:
        from backend.celery_worker import redis_client as _rc
        import json as _j
        _rc.setex(_mm_cache_key, 3600, _j.dumps(mm_result, ensure_ascii=False))
    except Exception:
        pass
    return mm_result



async def _fetch_yandex_categories(api_key: str, client_id: str | None = None) -> List[Dict[str, str]]:
    """Плоский список листовых категорий Яндекс.Маркет из POST /v2/categories/tree."""
    import json as _j
    _cache_key = f"pim:yandex_cats:{(api_key or '')[:16]}"
    try:
        from backend.celery_worker import redis_client as _rc
        _cached = _rc.get(_cache_key)
        if _cached:
            return _j.loads(_cached)
    except Exception:
        pass

    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if client_id:
        headers["Authorization"] = f"OAuth oauth_token={api_key}, oauth_client_id={client_id}"
    else:
        headers["Api-Key"] = api_key

    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(
            "https://api.partner.market.yandex.ru/v2/categories/tree",
            headers=headers,
            json={"language": "RU"},
        )
    if res.status_code != 200:
        return []
    js = res.json()
    if js.get("status") != "OK":
        return []
    root = js.get("result")
    if not isinstance(root, dict):
        return []

    out: List[Dict[str, str]] = []

    def walk(node: Any, path: str) -> None:
        if not isinstance(node, dict):
            return
        name = str(node.get("name") or "").strip()
        cid = node.get("id")
        cur = f"{path} / {name}".strip(" /") if path and name else (name or path)
        children = node.get("children")
        # leaf: children is None or empty list
        if not children:
            if cid is not None:
                out.append({"id": str(int(cid)), "name": cur})
            return
        for ch in (children or []):
            walk(ch, cur)

    walk(root, "")
    uniq: Dict[str, Dict[str, str]] = {c["id"]: c for c in out}
    result = list(uniq.values())
    try:
        from backend.celery_worker import redis_client as _rc
        _rc.setex(_cache_key, 3600, _j.dumps(result, ensure_ascii=False))
    except Exception:
        pass
    return result



async def _fetch_wb_categories(api_key: str) -> List[Dict[str, str]]:
    """Плоский список предметов (листовых категорий) Wildberries.
    Использует GET /content/v2/object/all с пагинацией по offset.
    id = subjectID — используется в /content/v2/object/charcs/{subjectId}.
    """
    import json as _j
    _cache_key = f"pim:wb_cats:{(api_key or '')[:16]}"
    try:
        from backend.celery_worker import redis_client as _rc
        _cached = _rc.get(_cache_key)
        if _cached:
            return _j.loads(_cached)
    except Exception:
        pass

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    result = []
    seen: set = set()
    offset = 0

    async with httpx.AsyncClient(timeout=60.0) as client:
        while True:
            res = await client.get(
                "https://content-api.wildberries.ru/content/v2/object/all",
                headers=headers,
                params={"limit": 1000, "offset": offset},
            )
            if res.status_code != 200:
                break
            data = res.json().get("data") or []
            for item in data:
                if not isinstance(item, dict):
                    continue
                sid = item.get("subjectID")
                if sid is None or str(sid) in seen:
                    continue
                seen.add(str(sid))
                parent = item.get("parentName", "")
                name = item.get("subjectName", "")
                full_name = f"{parent} / {name}".strip(" /") if parent else name
                result.append({"id": str(sid), "name": full_name})
            if len(data) < 1000:
                break
            offset += 1000

    uniq = {c["id"]: c for c in result}
    final = list(uniq.values())
    try:
        from backend.celery_worker import redis_client as _rc
        _rc.setex(_cache_key, 3600, _j.dumps(final, ensure_ascii=False))
    except Exception:
        pass
    return final


def _extract_schema_attributes(platform: str, category: Dict[str, str], schema: Dict[str, Any]) -> List[Dict[str, Any]]:
    attrs: List[Dict[str, Any]] = []
    for row in schema.get("attributes") or []:
        if not isinstance(row, dict):
            continue
        aid = str(row.get("id") or "").strip()
        name = str(row.get("name") or row.get("attributeName") or "").strip()
        if not name:
            continue
        opts = row.get("dictionary_options") or row.get("dictionaryValues") or row.get("dictionaryList") or []
        opt_names: List[str] = []
        for o in opts:
            if isinstance(o, dict):
                s = str(o.get("name") or "").strip()
                if s:
                    opt_names.append(s)
            else:
                s = str(o).strip()
                if s:
                    opt_names.append(s)
        attrs.append(
            {
                "platform": platform,
                "category_id": str(category.get("id") or ""),
                "category_name": str(category.get("name") or ""),
                "attribute_id": aid,
                "name": name,
                "value_type": str(row.get("valueTypeCode") or row.get("type") or ""),
                "is_required": bool(row.get("is_required") or row.get("isRequired")),
                "dictionary_size": len(opt_names),
                "dictionary_sample": opt_names[:30],
            }
        )
    return attrs


async def _collect_attrs_for_platform(
    *,
    platform: str,
    categories: List[Dict[str, str]],
    adapter: Any,
    max_categories: int | None,
    concurrency: int = 10,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    cats = categories[: max_categories] if max_categories and max_categories > 0 else categories
    sem = asyncio.Semaphore(max(1, int(concurrency)))
    attrs_all: List[Dict[str, Any]] = []
    failed: List[Dict[str, str]] = []

    async def one(cat: Dict[str, str]) -> None:
        async with sem:
            try:
                schema = await adapter.get_category_schema(str(cat["id"]))
                attrs_all.extend(_extract_schema_attributes(platform, cat, schema or {}))
            except Exception:
                failed.append({"id": str(cat.get("id", "")), "name": str(cat.get("name", ""))})

    await asyncio.gather(*(one(c) for c in cats))
    return attrs_all, failed


def _build_star_edges(
    ozon_attrs: List[Dict[str, Any]],
    mm_attrs: List[Dict[str, Any]],
    *,
    score_threshold: float = 0.58,
    top_k_per_ozon: int = 5,
) -> List[Dict[str, Any]]:
    mm_index: Dict[str, set[int]] = {}
    mm_tokens: List[set[str]] = []
    for i, m in enumerate(mm_attrs):
        tk = _tokens(m.get("name", ""))
        mm_tokens.append(tk)
        for t in tk:
            mm_index.setdefault(t, set()).add(i)

    edges: List[Dict[str, Any]] = []
    for o in ozon_attrs:
        o_name = str(o.get("name") or "")
        o_toks = _tokens(o_name)
        candidate_idx: set[int] = set()
        for t in o_toks:
            candidate_idx |= mm_index.get(t, set())
        if not candidate_idx:
            continue
        scored: List[Tuple[float, Dict[str, Any]]] = []
        for idx in candidate_idx:
            m = mm_attrs[idx]
            s = _sim(o_name, str(m.get("name") or ""))
            if s < score_threshold:
                continue
            scored.append((s, m))
        scored.sort(key=lambda x: x[0], reverse=True)
        for s, m in scored[: max(1, top_k_per_ozon)]:
            edges.append(
                {
                    "from_platform": "ozon",
                    "from_category_id": o.get("category_id"),
                    "from_attribute_id": o.get("attribute_id"),
                    "from_name": o_name,
                    "to_platform": "megamarket",
                    "to_category_id": m.get("category_id"),
                    "to_attribute_id": m.get("attribute_id"),
                    "to_name": m.get("name"),
                    "score": round(float(s), 4),
                    "reason": "semantic_name_similarity",
                }
            )
    return edges


def _search_snapshot_nodes(query: str, platform: str | None, limit: int) -> List[Dict[str, Any]]:
    snap = _read_json(_STAR_MAP_SNAPSHOT, {})
    q = str(query or "").strip()
    want = str(platform or "").strip().lower()
    rows = (snap.get("ozon_attributes_data") or []) + (snap.get("megamarket_attributes_data") or [])
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for a in rows:
        if not isinstance(a, dict):
            continue
        p = str(a.get("platform") or "").strip().lower()
        if want and p != want:
            continue
        nm = str(a.get("name") or "").strip()
        if not nm:
            continue
        if q:
            s = _sim(q, nm)
            if s < 0.1 and _norm(q) not in _norm(nm):
                continue
        else:
            s = 0.2
        scored.append((s, a))
    scored.sort(key=lambda x: x[0], reverse=True)
    out: List[Dict[str, Any]] = []
    for s, a in scored[:limit]:
        out.append(
            {
                "id": f"snap::{a.get('platform')}::{a.get('category_id')}::{a.get('attribute_id')}::{_norm(a.get('name') or '')}",
                "score": round(float(s), 4),
                "problem_text": f"{a.get('platform')} | {a.get('name')}",
                "action_summary": "attribute_star_node_snapshot",
                "result_status": "active",
                "sku": "",
                "category_id": str(a.get("category_id") or ""),
                "ts": int(snap.get("generated_at_ts") or 0),
                "metadata": a,
            }
        )
    return out


async def build_ozon_mm_attribute_star_map(
    *,
    ozon_api_key: str,
    ozon_client_id: str | None,
    mm_api_key: str,
    max_ozon_categories: int | None = None,
    max_mm_categories: int | None = None,
    edge_threshold: float = 0.58,
    progress_cb: Any | None = None,
) -> Dict[str, Any]:
    def _progress(stage: str, percent: int, message: str, extra: Dict[str, Any] | None = None) -> None:
        if not progress_cb:
            return
        try:
            progress_cb(
                {
                    "stage": stage,
                    "progress_percent": max(0, min(int(percent), 100)),
                    "message": message,
                    "extra": extra or {},
                    "updated_at_ts": int(time.time()),
                }
            )
        except Exception:
            pass

    started = int(time.time())
    _progress("fetch_ozon_categories", 5, "Загружаем категории Ozon")
    ozon_cats = await _fetch_ozon_categories(ozon_api_key, ozon_client_id)
    _progress("fetch_mm_categories", 12, "Загружаем категории Megamarket", {"ozon_categories": len(ozon_cats)})
    mm_cats = await _fetch_mm_categories(mm_api_key)
    if max_ozon_categories and max_ozon_categories > 0:
        ozon_cats = ozon_cats[: max_ozon_categories]
    if max_mm_categories and max_mm_categories > 0:
        mm_cats = mm_cats[: max_mm_categories]
    _progress("prepare_adapters", 18, "Подготавливаем адаптеры", {"mm_categories": len(mm_cats)})

    ozon_adapter = get_adapter("ozon", ozon_api_key, ozon_client_id, None, None)
    mm_adapter = get_adapter("megamarket", mm_api_key, None, None, None)
    _progress("phased_matching", 24, "Этапный матчинг категорий: Ozon -> MM")
    oz_attrs: List[Dict[str, Any]] = []
    mm_attrs_by_cat: Dict[str, List[Dict[str, Any]]] = {}
    mm_attr_cache: Dict[str, List[Dict[str, Any]]] = {}
    edges: List[Dict[str, Any]] = []
    oz_failed: List[Dict[str, str]] = []
    mm_failed_map: Dict[str, Dict[str, str]] = {}

    total_oz = max(1, len(ozon_cats))
    for idx, oz_cat in enumerate(ozon_cats, start=1):
        oz_id = str(oz_cat.get("id") or "")
        oz_name = str(oz_cat.get("name") or "")
        p = 24 + int((idx / total_oz) * 58)
        _progress(
            "phased_matching",
            p,
            f"Категория {idx}/{total_oz}: {oz_name}",
            {"ozon_category_id": oz_id, "ozon_category_name": oz_name},
        )

        try:
            oz_schema = await ozon_adapter.get_category_schema(oz_id)
            oz_cat_attrs = _extract_schema_attributes("ozon", oz_cat, oz_schema or {})
        except Exception:
            oz_cat_attrs = []
            oz_failed.append({"id": oz_id, "name": oz_name})
        if not oz_cat_attrs:
            continue
        oz_attrs.extend(oz_cat_attrs)

        mm_candidates = _pick_mm_candidate_categories(oz_name, mm_cats, k=8)
        mm_pool: List[Dict[str, Any]] = []
        for mm_cat in mm_candidates:
            mm_id = str(mm_cat.get("id") or "")
            mm_name = str(mm_cat.get("name") or "")
            if not mm_id:
                continue
            if mm_id not in mm_attr_cache:
                try:
                    mm_schema = await mm_adapter.get_category_schema(mm_id)
                    mm_attr_cache[mm_id] = _extract_schema_attributes("megamarket", mm_cat, mm_schema or {})
                except Exception:
                    mm_attr_cache[mm_id] = []
                    mm_failed_map[mm_id] = {"id": mm_id, "name": mm_name}
            if mm_attr_cache.get(mm_id):
                mm_attrs_by_cat[mm_id] = mm_attr_cache[mm_id]
                mm_pool.extend(mm_attr_cache[mm_id])

        if not mm_pool:
            continue
        seen_mm: set[str] = set()
        mm_unique: List[Dict[str, Any]] = []
        for m in mm_pool:
            key = f"{m.get('category_id')}::{m.get('attribute_id')}::{_norm(m.get('name') or '')}"
            if key in seen_mm:
                continue
            seen_mm.add(key)
            mm_unique.append(m)
        edges.extend(_build_star_edges(oz_cat_attrs, mm_unique, score_threshold=edge_threshold))

    mm_attrs: List[Dict[str, Any]] = []
    for vals in mm_attrs_by_cat.values():
        mm_attrs.extend(vals)
    mm_failed = list(mm_failed_map.values())
    _progress("build_edges", 82, "Семантические связи построены", {"edges": len(edges)})

    _progress("store_vectors", 82, "Сохраняем карту в векторную память", {"edges": len(edges)})
    ns_nodes = "attr_star_map_v1_nodes"
    ns_edges = "attr_star_map_v1_edges"
    memory_store_ok = True
    memory_store_error = ""
    try:
        memory = get_agent_memory()
        memory.clear_namespace(ns_nodes)
        memory.clear_namespace(ns_edges)

        for n in oz_attrs + mm_attrs:
            text = f"{n['platform']} | {n['name']} | {n['value_type']} | required={n['is_required']}"
            memory.add_case(
                namespace=ns_nodes,
                sku="",
                category_id=str(n.get("category_id", "")),
                problem_text=text,
                action_summary="attribute_star_node",
                result_status="active",
                metadata=n,
            )
        for e in edges:
            text = f"{e['from_name']} -> {e['to_name']} score={e['score']}"
            memory.add_case(
                namespace=ns_edges,
                sku="",
                category_id=str(e.get("from_category_id", "")),
                problem_text=text,
                action_summary="attribute_star_edge",
                result_status="active",
                metadata=e,
            )
    except Exception as mem_e:
        memory_store_ok = False
        memory_store_error = str(mem_e)

    _progress("write_snapshot", 96, "Сохраняем снапшот карты на диск")
    os.makedirs(_STAR_MAP_DIR, exist_ok=True)
    out_path = _STAR_MAP_SNAPSHOT
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at_ts": started,
                "ozon_categories_list": ozon_cats,
                "megamarket_categories_list": mm_cats,
                "ozon_category_tree": _build_tree_from_paths(ozon_cats, " / "),
                "megamarket_category_tree": _build_tree_from_paths(mm_cats, " -> "),
                "ozon_attributes_data": oz_attrs,
                "megamarket_attributes_data": mm_attrs,
                "ozon_categories": len(ozon_cats),
                "megamarket_categories": len(mm_cats),
                "ozon_attributes": len(oz_attrs),
                "megamarket_attributes": len(mm_attrs),
                "edges": edges,
                "ozon_failed_categories": oz_failed,
                "megamarket_failed_categories": mm_failed,
            },
            f,
            ensure_ascii=False,
        )

    result = {
        "ok": True,
        "generated_at_ts": started,
        "vector_namespaces": {"nodes": ns_nodes, "edges": ns_edges},
        "file_path": out_path,
        "stats": {
            "ozon_categories_total": len(ozon_cats),
            "mm_categories_total": len(mm_cats),
            "ozon_attributes_total": len(oz_attrs),
            "mm_attributes_total": len(mm_attrs),
            "edges_total": len(edges),
            "ozon_failed_categories": len(oz_failed),
            "mm_failed_categories": len(mm_failed),
            "memory_store_ok": memory_store_ok,
        },
    }
    if not memory_store_ok:
        result["stats"]["memory_store_error"] = memory_store_error[:500]
    _progress("completed", 100, "Сборка карты завершена", result.get("stats", {}))
    return result


def search_attribute_star_map(query: str, limit: int = 10) -> Dict[str, Any]:
    lim = max(1, min(int(limit or 10), 50))
    try:
        memory = get_agent_memory()
        node_hits = memory.search(namespace="attr_star_map_v1_nodes", query=query, limit=lim, score_threshold=0.2)
        auto_edge_hits = memory.search(namespace="attr_star_map_v1_edges", query=query, limit=lim, score_threshold=0.2)
        manual_edge_hits = memory.search(namespace="attr_star_map_v1_edges_manual", query=query, limit=lim, score_threshold=0.1)
        for h in manual_edge_hits:
            h["manual_override"] = True
            h["score"] = round(float(h.get("score") or 0.0) + 0.3, 4)
        all_edges = manual_edge_hits + auto_edge_hits
        all_edges.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
        return {"query": query, "node_hits": node_hits, "edge_hits": all_edges[:lim]}
    except Exception:
        snap = _read_json(_STAR_MAP_SNAPSHOT, {})
        qn = _norm(query or "")
        nodes = _search_snapshot_nodes(query, None, lim)
        manual = _read_json(_STAR_MAP_MANUAL, {"overrides": []})
        edges = []
        for e in (snap.get("edges") or []):
            if not isinstance(e, dict):
                continue
            if qn and qn not in _norm(e.get("from_name") or "") and qn not in _norm(e.get("to_name") or ""):
                continue
            row = dict(e)
            row["manual_override"] = False
            edges.append({"metadata": row, "score": float(row.get("score") or 0.0)})
        for m in manual.get("overrides") or []:
            if not isinstance(m, dict):
                continue
            if qn and qn not in _norm(m.get("from_name") or "") and qn not in _norm(m.get("to_name") or ""):
                continue
            row = dict(m)
            row["manual_override"] = True
            edges.append({"metadata": row, "score": float(row.get("score") or 0.0) + 0.3, "manual_override": True})
        edges.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
        return {"query": query, "node_hits": nodes, "edge_hits": edges[:lim], "source": "snapshot_fallback"}


def search_attribute_star_nodes(query: str, platform: str | None = None, limit: int = 40) -> Dict[str, Any]:
    q = str(query or "").strip() or "attribute"
    lim = max(1, min(int(limit or 40), 200))
    want = str(platform or "").strip().lower()
    try:
        memory = get_agent_memory()
        hits = memory.search(namespace="attr_star_map_v1_nodes", query=q, limit=lim * 3, score_threshold=0.12)
        out: List[Dict[str, Any]] = []
        for h in hits:
            meta = h.get("metadata") or {}
            p = str(meta.get("platform") or "").strip().lower()
            if want and p != want:
                continue
            out.append(h)
            if len(out) >= lim:
                break
        return {"query": q, "platform": want or None, "hits": out}
    except Exception:
        out = _search_snapshot_nodes(q, want or None, lim)
        return {"query": q, "platform": want or None, "hits": out, "source": "snapshot_fallback"}


def get_attribute_star_map_state(edge_limit: int = 300) -> Dict[str, Any]:
    snap = _read_json(_STAR_MAP_SNAPSHOT, {})
    manual = _read_json(_STAR_MAP_MANUAL, {"overrides": []})
    edges = (snap.get("edges") or [])[: max(1, min(int(edge_limit or 300), 3000))]
    overrides = manual.get("overrides") or []
    return {
        "snapshot_exists": bool(snap),
        "generated_at_ts": snap.get("generated_at_ts"),
        "stats": {
            "ozon_categories": snap.get("ozon_categories", 0),
            "megamarket_categories": snap.get("megamarket_categories", 0),
            "ozon_attributes": snap.get("ozon_attributes", 0),
            "megamarket_attributes": snap.get("megamarket_attributes", 0),
            "edges_total": len(snap.get("edges") or []),
            "manual_overrides_total": len(overrides),
            "categories_by_platform": {k: v for k, v in (snap.get("categories_by_platform") or {}).items()},
        },
        "edges_sample": edges,
        "manual_overrides": overrides[:500],
    }


def get_attribute_star_categories(platform: str) -> Dict[str, Any]:
    p = str(platform or "").strip().lower()
    snap = _read_json(_STAR_MAP_SNAPSHOT, {})
    if p not in {"ozon", "megamarket"}:
        return {"ok": False, "error": "platform must be ozon or megamarket"}
    if p == "ozon":
        return {
            "ok": True,
            "platform": p,
            "categories": snap.get("ozon_categories_list") or [],
            "tree": snap.get("ozon_category_tree") or [],
        }
    return {
        "ok": True,
        "platform": p,
        "categories": snap.get("megamarket_categories_list") or [],
        "tree": snap.get("megamarket_category_tree") or [],
    }


def get_attribute_star_category_attributes(platform: str, category_id: str, limit: int = 2000) -> Dict[str, Any]:
    p = str(platform or "").strip().lower()
    cid = str(category_id or "").strip()
    if p not in {"ozon", "megamarket"}:
        return {"ok": False, "error": "platform must be ozon or megamarket"}
    if not cid:
        return {"ok": False, "error": "category_id is required"}
    snap = _read_json(_STAR_MAP_SNAPSHOT, {})
    key = "ozon_attributes_data" if p == "ozon" else "megamarket_attributes_data"
    attrs = [a for a in (snap.get(key) or []) if str((a or {}).get("category_id") or "") == cid]
    lim = max(1, min(int(limit or 2000), 20000))
    return {"ok": True, "platform": p, "category_id": cid, "attributes": attrs[:lim], "total": len(attrs)}


def get_attribute_star_category_links(ozon_category_id: str, mm_category_id: str, limit: int = 1000) -> Dict[str, Any]:
    oz_cid = str(ozon_category_id or "").strip()
    mm_cid = str(mm_category_id or "").strip()
    if not oz_cid or not mm_cid:
        return {"ok": False, "error": "ozon_category_id and mm_category_id are required"}
    snap = _read_json(_STAR_MAP_SNAPSHOT, {})
    auto_edges = [
        e for e in (snap.get("edges") or [])
        if str((e or {}).get("from_category_id") or "") == oz_cid
        and str((e or {}).get("to_category_id") or "") == mm_cid
    ]
    manual = _read_json(_STAR_MAP_MANUAL, {"overrides": {}})
    manual_edges: List[Dict[str, Any]] = []
    for m in manual.get("overrides") or []:
        if not isinstance(m, dict):
            continue
        m_from = str(m.get("from_category_id") or "").strip()
        m_to = str(m.get("to_category_id") or "").strip()
        if m_from and m_to and (m_from != oz_cid or m_to != mm_cid):
            continue
        row = dict(m)
        row["manual_override"] = True
        manual_edges.append(row)
    all_edges = manual_edges + auto_edges
    all_edges.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
    lim = max(1, min(int(limit or 1000), 5000))
    return {
        "ok": True,
        "ozon_category_id": oz_cid,
        "megamarket_category_id": mm_cid,
        "edges": all_edges[:lim],
        "total": len(all_edges),
    }


def upsert_manual_vector_override(
    *,
    from_name: str,
    to_name: str,
    from_category_id: str | None = None,
    to_category_id: str | None = None,
    from_attribute_id: str | None = None,
    to_attribute_id: str | None = None,
    score: float = 1.0,
) -> Dict[str, Any]:
    f_name = str(from_name or "").strip()
    t_name = str(to_name or "").strip()
    if not f_name or not t_name:
        return {"ok": False, "error": "from_name and to_name are required"}

    item = {
        "id": f"{_norm(f_name)}::{_norm(t_name)}::{str(from_category_id or '')}::{str(to_category_id or '')}",
        "from_platform": "ozon",
        "from_name": f_name,
        "from_category_id": str(from_category_id or ""),
        "from_attribute_id": str(from_attribute_id or ""),
        "to_platform": "megamarket",
        "to_name": t_name,
        "to_category_id": str(to_category_id or ""),
        "to_attribute_id": str(to_attribute_id or ""),
        "score": round(max(0.0, min(float(score), 1.0)), 4),
        "reason": "manual_ui_override",
        "updated_at_ts": int(time.time()),
    }

    data = _read_json(_STAR_MAP_MANUAL, {"overrides": []})
    cur = [x for x in (data.get("overrides") or []) if isinstance(x, dict)]
    cur = [x for x in cur if str(x.get("id")) != item["id"]]
    cur.append(item)
    _write_json(_STAR_MAP_MANUAL, {"overrides": cur})

    try:
        memory = get_agent_memory()
        text = f"{item['from_name']} -> {item['to_name']} score={item['score']} manual"
        memory.add_case(
            namespace="attr_star_map_v1_edges_manual",
            sku="",
            category_id=item["from_category_id"],
            problem_text=text,
            action_summary="attribute_star_edge_manual",
            result_status="active",
            metadata=item,
        )
    except Exception:
        pass
    return {"ok": True, "override": item}


def delete_manual_vector_override(override_id: str) -> Dict[str, Any]:
    oid = str(override_id or "").strip()
    if not oid:
        return {"ok": False, "error": "override_id required"}
    data = _read_json(_STAR_MAP_MANUAL, {"overrides": []})
    cur = [x for x in (data.get("overrides") or []) if isinstance(x, dict)]
    nxt = [x for x in cur if str(x.get("id")) != oid]
    _write_json(_STAR_MAP_MANUAL, {"overrides": nxt})
    return {"ok": True, "deleted": len(cur) - len(nxt)}


async def _run_star_map_build_job(
    *,
    task_id: str,
    ozon_api_key: str,
    ozon_client_id: str | None,
    mm_api_key: str,
    max_ozon_categories: int | None,
    max_mm_categories: int | None,
    edge_threshold: float,
) -> None:
    _BUILD_JOBS[task_id] = {
        "task_id": task_id,
        "status": "running",
        "started_at_ts": int(time.time()),
        "finished_at_ts": None,
        "error": None,
        "result": None,
        "stage": "starting",
        "progress_percent": 1,
        "message": "Запуск сборки карты",
        "updated_at_ts": int(time.time()),
    }
    try:
        def _job_progress(state: Dict[str, Any]) -> None:
            _BUILD_JOBS[task_id]["stage"] = state.get("stage")
            _BUILD_JOBS[task_id]["progress_percent"] = state.get("progress_percent")
            _BUILD_JOBS[task_id]["message"] = state.get("message")
            _BUILD_JOBS[task_id]["updated_at_ts"] = state.get("updated_at_ts")
            _BUILD_JOBS[task_id]["progress_extra"] = state.get("extra") or {}

        result = await build_ozon_mm_attribute_star_map(
            ozon_api_key=ozon_api_key,
            ozon_client_id=ozon_client_id,
            mm_api_key=mm_api_key,
            max_ozon_categories=max_ozon_categories,
            max_mm_categories=max_mm_categories,
            edge_threshold=edge_threshold,
            progress_cb=_job_progress,
        )
        _BUILD_JOBS[task_id]["status"] = "completed"
        _BUILD_JOBS[task_id]["finished_at_ts"] = int(time.time())
        _BUILD_JOBS[task_id]["result"] = result
        _BUILD_JOBS[task_id]["stage"] = "completed"
        _BUILD_JOBS[task_id]["progress_percent"] = 100
        _BUILD_JOBS[task_id]["message"] = "Сборка карты завершена"
    except Exception as e:
        _BUILD_JOBS[task_id]["status"] = "failed"
        _BUILD_JOBS[task_id]["finished_at_ts"] = int(time.time())
        _BUILD_JOBS[task_id]["error"] = str(e)
        _BUILD_JOBS[task_id]["stage"] = "failed"
        _BUILD_JOBS[task_id]["message"] = "Сборка карты завершилась ошибкой"


def start_attribute_star_map_build(
    *,
    ozon_api_key: str,
    ozon_client_id: str | None,
    mm_api_key: str,
    max_ozon_categories: int | None = None,
    max_mm_categories: int | None = None,
    edge_threshold: float = 0.58,
) -> Dict[str, Any]:
    for job in _BUILD_JOBS.values():
        if str(job.get("status")) == "running":
            return {"ok": True, "task_id": job.get("task_id"), "status": "running", "already_running": True}

    task_id = str(uuid.uuid4())
    _BUILD_JOBS[task_id] = {
        "task_id": task_id,
        "status": "queued",
        "started_at_ts": int(time.time()),
        "finished_at_ts": None,
        "error": None,
        "result": None,
        "stage": "queued",
        "progress_percent": 0,
        "message": "Задача поставлена в очередь",
        "updated_at_ts": int(time.time()),
    }
    asyncio.create_task(
        _run_star_map_build_job(
            task_id=task_id,
            ozon_api_key=ozon_api_key,
            ozon_client_id=ozon_client_id,
            mm_api_key=mm_api_key,
            max_ozon_categories=max_ozon_categories,
            max_mm_categories=max_mm_categories,
            edge_threshold=edge_threshold,
        )
    )
    return {"ok": True, "task_id": task_id, "status": "queued"}


def get_attribute_star_map_build_status(task_id: str) -> Dict[str, Any]:
    tid = str(task_id or "").strip()
    if not tid:
        return {"ok": False, "error": "task_id required"}
    job = _BUILD_JOBS.get(tid)
    if not job:
        return {"ok": False, "error": "task not found"}
    return {"ok": True, **job}



# ─── Product attribute resolver ──────────────────────────────────────────────

def resolve_product_attributes(
    product_attrs: dict,
    mm_category_id: str,
    *,
    score_threshold: float = 0.45,
) -> dict:
    """
    Для конкретного товара и целевой категории MM возвращает готовый маппинг:
      { "MM-атрибут": <готовое значение или {"id": ..., "name": ...} для словарных полей> }

    Алгоритм:
    1. Берём все edges из снапшота где to_category_id == mm_category_id
    2. Для каждого edge ищем значение в product_attrs по from_name (+ нормализация)
    3. Если у edge есть value_mappings — ищем точное совпадение значения с oz_value
    4. Если mm_dictionary есть но value_mappings нет — fuzzy-match по словарю
    5. Если атрибут не словарный — берём значение как есть
    """
    snap = _read_json(_STAR_MAP_SNAPSHOT, {})
    edges = [
        e for e in (snap.get("edges") or [])
        if str(e.get("to_category_id") or "") == str(mm_category_id)
        and float(e.get("score") or 0) >= score_threshold
    ]

    if not edges:
        return {}

    # Нормализованный индекс атрибутов товара
    norm_attrs: dict[str, tuple[str, any]] = {}
    for k, v in (product_attrs or {}).items():
        norm_attrs[_norm(str(k))] = (k, v)

    def _find_source_value(from_name: str):
        """Ищет значение в атрибутах товара по имени атрибута-источника."""
        fn = _norm(from_name)
        # Точное совпадение
        if fn in norm_attrs:
            return norm_attrs[fn][1]
        # Частичное совпадение
        best_score, best_val = 0.0, None
        for nk, (ok, ov) in norm_attrs.items():
            s = _sim(fn, nk)
            if s > best_score:
                best_score, best_val = s, ov
        if best_score >= 0.72:
            return best_val
        return None

    def _match_dict_value(raw_value: any, value_mappings: list, mm_dictionary: list):
        """
        Сопоставляет сырое значение с словарём MM.
        MM API принимает строку (name), не id.
        Порядок: value_mappings от AI -> точное совпадение -> fuzzy -> substring.
        """
        if raw_value is None:
            return None
        raw_str = str(raw_value).strip()
        raw_n = _norm(raw_str)

        # 1. Готовые value_mappings от AI
        for vm in (value_mappings or []):
            if _norm(str(vm.get("oz_value") or "")) == raw_n:
                return str(vm.get("mm_name") or "")  # MM принимает строку

        # 2. Точное совпадение по словарю (без нормализации)
        for opt in (mm_dictionary or []):
            opt_name = str(opt.get("name") or "")
            if opt_name.lower() == raw_str.lower():
                return opt_name

        # 3. Fuzzy по именам словаря
        if not mm_dictionary:
            return None
        best_s, best_opt = 0.0, None
        for opt in mm_dictionary:
            opt_name = str(opt.get("name") or "")
            s = _sim(raw_n, _norm(opt_name))
            if s > best_s:
                best_s, best_opt = s, opt
        if best_s >= 0.72:
            return str(best_opt.get("name") or "")

        # 4. Substring match
        for opt in mm_dictionary:
            opt_n = _norm(str(opt.get("name") or ""))
            if raw_n in opt_n or opt_n in raw_n:
                return str(opt.get("name") or "")

        return None

    result: dict = {}
    seen_mm_attrs: set = set()

    # Сортируем по score — берём лучший edge для каждого MM-атрибута
    edges_sorted = sorted(edges, key=lambda e: float(e.get("score") or 0), reverse=True)

    for edge in edges_sorted:
        to_name = str(edge.get("to_name") or "").strip()
        if not to_name or to_name in seen_mm_attrs:
            continue

        from_name = str(edge.get("from_name") or "").strip()
        raw_val = _find_source_value(from_name)
        if raw_val is None:
            continue

        mm_dict = edge.get("mm_dictionary") or []
        value_maps = edge.get("value_mappings") or []

        if mm_dict:
            # Словарное поле — нужно точное значение из словаря
            matched = _match_dict_value(raw_val, value_maps, mm_dict)
            if matched:
                result[to_name] = matched
                seen_mm_attrs.add(to_name)
        else:
            # Свободное поле — берём значение напрямую
            result[to_name] = raw_val
            seen_mm_attrs.add(to_name)

    return result


def enrich_star_map_value_mappings(ai_key: str, *, limit_edges: int = 200) -> dict:
    """
    Пробегает по всем edges со словарями в снапшоте у которых нет value_mappings,
    запускает AI для каждого и дописывает результат обратно в снапшот.
    Вызывать однократно после автосборки.
    """
    import openai as _openai

    snap = _read_json(_STAR_MAP_SNAPSHOT, {})
    edges = snap.get("edges") or []
    needs_vm = [
        e for e in edges
        if (e.get("mm_dictionary") or [])
        and not (e.get("value_mappings") or [])
        and e.get("from_attribute_id")
    ]

    if not needs_vm:
        return {"ok": True, "enriched": 0, "message": "Все edges уже имеют value_mappings"}

    to_process = needs_vm[:limit_edges]
    client = _openai.OpenAI(api_key=ai_key, base_url="https://api.deepseek.com")
    enriched = 0

    for edge in to_process:
        oz_name = str(edge.get("from_name") or "")
        mm_name = str(edge.get("to_name") or "")
        mm_dict = edge.get("mm_dictionary") or []
        is_suggest = edge.get("mm_is_suggest")
        restrict = "" if is_suggest else "ВАЖНО: isSuggest=false — только значения из словаря MM, никаких выдумок."

        prompt = f"""Атрибут Ozon "{oz_name}" соответствует атрибуту Megamarket "{mm_name}".
Словарь Megamarket: {[{"id": o.get("id"), "name": o.get("name")} for o in mm_dict[:80]]}
{restrict}

Сопоставь возможные значения Ozon с вариантами из словаря MM.
Верни JSON массив: [{{"oz_value": "...", "mm_id": "...", "mm_name": "..."}}]
Только реальные смысловые совпадения. Если совпадений нет — верни []."""

        try:
            resp = client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=1500,
            )
            raw = resp.choices[0].message.content.strip()
            import re as _re, json as _json
            m = _re.search(r"\[.*\]", raw, _re.DOTALL)
            if m:
                vms = _json.loads(m.group())
                edge["value_mappings"] = vms
                enriched += 1
        except Exception:
            pass

    snap["edges"] = edges
    _write_json(_STAR_MAP_SNAPSHOT, snap)
    return {"ok": True, "enriched": enriched, "total_needed": len(needs_vm)}
