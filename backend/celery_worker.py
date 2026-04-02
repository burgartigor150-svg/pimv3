import asyncio
import json
import redis
import os
import re
import time
from typing import Any, Dict, List, Tuple
from celery import Celery
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from backend import models
from backend.database import DATABASE_URL
from backend.services.adapters import get_adapter
from backend.services.ai_service import categorize_and_extract, map_schema_to_marketplace
from backend.services.completeness_engine import calculate_completeness
from backend.services.telemetry import append_task_event
from backend.services.evidence_contract import build_evidence_contract
from backend.services.attribute_star_map import (
    build_ozon_mm_attribute_star_map,
    get_attribute_star_map_state,
)
from backend.services.autonomous_improve import (
    record_failure_and_maybe_trigger,
    run_incident_pipeline,
)

_broker = os.getenv("CELERY_BROKER_URL", os.getenv("REDIS_URL", "redis://localhost:6379/0"))
_backend = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

celery_app = Celery(
    "pim_tasks",
    broker=_broker,
    backend=_backend,
)

redis_client = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)


def _sanitize_manufacturer_fields(payload: Dict[str, Any], seller_sku: str) -> Dict[str, Any]:
    out = dict(payload or {})
    seller = str(seller_sku or "").strip()
    for fk in list(out.keys()):
        fn = str(fk).lower()
        if (
            "код производителя" in fn
            or "артикул производителя" in fn
            or "manufacturerno" in fn
            or "manufacturer_code" in fn
            or "manufacturercode" in fn
        ):
            sv = str(out.get(fk) or "").strip()
            if sv == seller or sv.upper().startswith("СП-"):
                out.pop(fk, None)
    return out


def _apply_mm_deterministic_prefill(
    payload: Dict[str, Any],
    *,
    sku: str,
    product_name: str,
    images: List[str],
    ozon_source_full: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Deterministic Ozon->MM prefill:
    fills only explicit, verifiable fields and never invents values.
    """
    out = dict(payload or {})

    def _is_empty(v: Any) -> bool:
        return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, list) and len(v) == 0)

    def _put_if_empty(key: str, value: Any) -> None:
        if value in (None, "", [], {}):
            return
        if key not in out or _is_empty(out.get(key)):
            out[key] = value

    out["offer_id"] = sku
    _put_if_empty("Артикул (SKU)", sku)
    _put_if_empty("Код товара продавца", sku)
    if product_name:
        _put_if_empty("Наименование карточки", product_name)
        _put_if_empty("name", product_name)
        _put_if_empty("full_name", product_name)
    if images:
        _put_if_empty("Фото", images)
        _put_if_empty("images", images)

    src = ozon_source_full or {}
    # Stable direct aliases where source meaning is unambiguous.
    direct_aliases = {
        "brand": ["Бренд"],
        "description": ["Описание товара"],
        "volume_liters": ["Объем, л"],
        "microwave_power_w": ["Мощность микроволн, Вт"],
        "control_type": ["Управление"],
        "color": ["Цвет"],
        "country_of_origin": ["Страна-производитель"],
        "door_opening_direction": ["Механизм открывания дверцы"],
    }
    for src_key, dst_keys in direct_aliases.items():
        v = src.get(src_key)
        if v in (None, "", [], {}):
            continue
        for dk in dst_keys:
            _put_if_empty(dk, v)

    # Authoritative source-backed fields: always prefer explicit OZON source.
    if src.get("type") not in (None, "", [], {}):
        out["Тип"] = src.get("type")
        out["Вид"] = src.get("type")
    if src.get("country_of_origin") not in (None, "", [], {}):
        out["Страна-производитель"] = src.get("country_of_origin")
    if src.get("smart_inverter") not in (None, "", [], {}):
        out["Инверторное управление мощностью"] = src.get("smart_inverter")

    # Deterministic dimension conversion from mm->cm.
    def _to_float(v: Any) -> float | None:
        try:
            return float(str(v).replace(",", ".").strip())
        except Exception:
            return None

    width_mm = _to_float(src.get("width_mm"))
    height_mm = _to_float(src.get("height_mm"))
    depth_mm = _to_float(src.get("depth_mm"))
    if width_mm is not None:
        _put_if_empty("Ширина, см", round(width_mm / 10.0, 1))
        _put_if_empty("Ширина (упаковки)", round(width_mm / 10.0, 1))
    if height_mm is not None:
        _put_if_empty("Высота, см", round(height_mm / 10.0, 1))
        _put_if_empty("Высота (упаковки)", round(height_mm / 10.0, 1))
    if depth_mm is not None:
        _put_if_empty("Глубина, см", round(depth_mm / 10.0, 1))
        _put_if_empty("Длина (упаковки)", round(depth_mm / 10.0, 1))
    return out


@celery_app.task(name="sync_product_to_marketplace")
def sync_product_to_marketplace(
    product_id: str,
    connection_id: str,
    evidence_contract: Dict[str, Any] = None,
) -> Dict[str, Any]:
    """
    Celery task to sync a single product to a marketplace connection.
    Uses deterministic prefill and attribute star mapping.
    """
    return asyncio.run(_sync_product_async(product_id, connection_id, evidence_contract))


async def _sync_product_async(
    product_id: str,
    connection_id: str,
    evidence_contract=None,
):
    try:
        engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
        async_session = async_sessionmaker(engine, expire_on_commit=False)

        async with async_session() as session:
            # Fetch product
            product_result = await session.execute(
                select(models.Product).where(models.Product.id == product_id)
            )
            product = product_result.scalar_one_or_none()
            if not product:
                return {"status": "error", "message": f"Product {product_id} not found"}

            # Fetch connection
            connection_result = await session.execute(
                select(models.MarketplaceConnection).where(
                    models.MarketplaceConnection.id == connection_id
                )
            )
            connection = connection_result.scalar_one_or_none()
            if not connection:
                return {"status": "error", "message": f"Connection {connection_id} not found"}

            # Get adapter for marketplace type
            adapter = get_adapter(connection.type)
            if not adapter:
                return {"status": "error", "message": f"No adapter for type {connection.type}"}

            # Build payload using deterministic prefill
            ozon_source = product.attributes_data or {}
            images = []  # Would come from product.images in real implementation
            payload = _apply_mm_deterministic_prefill(
                {},
                sku=product.sku,
                product_name=product.name,
                images=images,
                ozon_source_full=ozon_source,
            )

            # Apply attribute star mapping if available
            star_map_state = get_attribute_star_map_state()
            if star_map_state and star_map_state.get("ozon_to_mm"):
                mapped = build_ozon_mm_attribute_star_map(ozon_source, star_map_state["ozon_to_mm"])
                payload.update(mapped)

            # Sanitize manufacturer fields
            payload = _sanitize_manufacturer_fields(payload, product.sku)

            # Sync to marketplace
            result = adapter.sync_product(
                connection_data={
                    "api_key": connection.api_key,
                    "client_id": connection.client_id,
                    "store_id": connection.store_id,
                    "warehouse_id": connection.warehouse_id,
                },
                product_data=payload,
            )

            # Update completeness score
            new_score = calculate_completeness(payload)
            product.completeness_score = new_score
            await session.commit()

            # Record telemetry
            append_task_event(
                task_name="sync_product_to_marketplace",
                product_id=product_id,
                connection_id=connection_id,
                status="success",
                details={"score": new_score, "result": result},
            )

            return {
                "status": "success",
                "product_id": product_id,
                "connection_id": connection_id,
                "completeness_score": new_score,
                "result": result,
            }

    except Exception as e:
        # Record failure and potentially trigger autonomous improvement
        record_failure_and_maybe_trigger(
            task_name="sync_product_to_marketplace",
            error=str(e),
            context={"product_id": product_id, "connection_id": connection_id},
        )
        return {
            "status": "error",
            "message": f"Sync failed: {str(e)}",
            "product_id": product_id,
            "connection_id": connection_id,
        }


@celery_app.task(name="batch_sync_products")
def batch_sync_products(product_ids: List[str], connection_id: str) -> Dict[str, Any]:
    """
    Celery task to sync multiple products to a marketplace connection.
    """
    results = []
    for product_id in product_ids:
        result = sync_product_to_marketplace(product_id, connection_id)
        results.append(result)
    return {
        "status": "completed",
        "total": len(product_ids),
        "results": results,
    }


@celery_app.task(name="trigger_autonomous_improvement")
def trigger_autonomous_improvement(incident_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Celery task to run the autonomous improvement pipeline for an incident.
    """
    return run_incident_pipeline(incident_data)




@celery_app.task(name="process_single_sku_task")
def process_single_sku_task(sku: str, connection_id: str, ai_key: str = "", task_id: str = "") -> dict:
    """Celery task: синдицировать один SKU на маркетплейс."""
    return asyncio.run(_async_process_single_sku(sku, connection_id, ai_key, task_id))


async def _async_process_single_sku(sku: str, connection_id: str, ai_key: str, task_id: str) -> dict:
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy.future import select
    from backend.services.megamarket_syndicate_agent import run_megamarket_syndicate_agent
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        result = await session.execute(select(models.Product).where(models.Product.sku == sku))
        product = result.scalar_one_or_none()
        if not product:
            return {"ok": False, "error": f"Product {sku} not found"}
        conn_result = await session.execute(
            select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == connection_id)
        )
        conn = conn_result.scalar_one_or_none()
        if not conn:
            return {"ok": False, "error": f"Connection {connection_id} not found"}
    result = await run_megamarket_syndicate_agent(
        product_id=str(product.id),
        connection_id=connection_id,
        ai_config=ai_key,
        task_id=task_id,
    )
    await engine.dispose()
    return result


@celery_app.task(name="build_attribute_star_map_task")
def build_attribute_star_map_task(
    task_id: str,
    ozon_api_key: str,
    ozon_client_id: str | None,
    mm_api_key: str,
    max_ozon_categories: int | None = None,
    max_mm_categories: int | None = None,
    edge_threshold: float = 0.58,
) -> dict:
    """Celery task: построить семантическую карту атрибутов."""
    from backend.services.attribute_star_map import build_ozon_mm_attribute_star_map

    def _progress_cb(info: dict) -> None:
        try:
            key = f"task:star_map_build:{task_id}"
            redis_client.hset(key, mapping={
                "status": "running",
                "stage": info.get("stage", ""),
                "progress_percent": info.get("progress_percent", 0),
                "message": info.get("message", ""),
                "updated_at_ts": int(info.get("updated_at_ts", 0)),
            })
        except Exception:
            pass

    try:
        result = asyncio.run(build_ozon_mm_attribute_star_map(
            ozon_api_key=ozon_api_key,
            ozon_client_id=ozon_client_id,
            mm_api_key=mm_api_key,
            max_ozon_categories=max_ozon_categories,
            max_mm_categories=max_mm_categories,
            edge_threshold=edge_threshold,
            progress_cb=_progress_cb,
        ))
        key = f"task:star_map_build:{task_id}"
        redis_client.hset(key, mapping={
            "status": "done",
            "stage": "done",
            "progress_percent": 100,
            "message": "Карта атрибутов успешно построена",
            "finished_at_ts": int(__import__("time").time()),
        })
        return result
    except Exception as exc:
        key = f"task:star_map_build:{task_id}"
        redis_client.hset(key, mapping={
            "status": "error",
            "stage": "error",
            "progress_percent": 0,
            "message": str(exc),
            "error": str(exc),
            "finished_at_ts": int(__import__("time").time()),
        })
        raise



@celery_app.task(name="auto_build_star_map_from_products")
def auto_build_star_map_from_products_task(task_id: str, ai_key: str) -> dict:
    """Автосборка карты: берём категории из товаров PIM -> ищем в Ozon -> ищем похожие в MM -> строим маппинг."""
    import time, json, re
    from difflib import SequenceMatcher

    def _progress(stage, pct, msg):
        try:
            redis_client.hset(f"task:star_map_build:{task_id}", mapping={
                "status": "running", "stage": stage,
                "progress_percent": max(0, min(int(pct), 99)),
                "message": msg, "updated_at_ts": int(time.time()),
            })
        except Exception:
            pass

    def _done(msg):
        redis_client.hset(f"task:star_map_build:{task_id}", mapping={
            "status": "done", "stage": "done", "progress_percent": 100,
            "message": msg, "finished_at_ts": int(time.time()),
        })

    def _error(msg):
        redis_client.hset(f"task:star_map_build:{task_id}", mapping={
            "status": "error", "stage": "error", "progress_percent": 0,
            "message": msg, "error": msg, "finished_at_ts": int(time.time()),
        })

    def _norm(s):
        return re.sub(r"\s+", " ", str(s or "").strip().lower().replace("ё", "е"))

    def _sim(a, b):
        an, bn = _norm(a), _norm(b)
        if not an or not bn: return 0.0
        seq = SequenceMatcher(None, an, bn).ratio()
        tok_a = set(re.findall(r"[a-zA-Zа-яА-ЯёЁ0-9]+", an))
        tok_b = set(re.findall(r"[a-zA-Zа-яА-ЯёЁ0-9]+", bn))
        jac = len(tok_a & tok_b) / max(1, len(tok_a | tok_b))
        if an in bn or bn in an: seq = max(seq, 0.82)
        return seq * 0.65 + jac * 0.35

    try:
        from backend.database import AsyncSessionLocal
        from backend.models import MarketplaceConnection, Category
        from backend.services.adapters import get_adapter
        from backend.services.attribute_star_map import (
            _fetch_ozon_categories, _fetch_mm_categories,
            _read_json, _write_json, _STAR_MAP_SNAPSHOT,
        )
        from openai import OpenAI
        from sqlalchemy import select as sa_select

        _progress("init", 2, "Инициализация...")

        # ── 1. Get connections ────────────────────────────────────────────
        async def _get_conns():
            async with AsyncSessionLocal() as db:
                oz = await db.execute(sa_select(MarketplaceConnection).where(MarketplaceConnection.type == "ozon"))
                mm = await db.execute(sa_select(MarketplaceConnection).where(MarketplaceConnection.type == "megamarket"))
                oz_list = [c for c in oz.scalars().all() if "test" not in (c.api_key or "").lower()]
                mm_list = [c for c in mm.scalars().all() if "test" not in (c.api_key or "").lower()]
                return oz_list, mm_list

        oz_conns, mm_conns = asyncio.run(_get_conns())
        if not oz_conns or not mm_conns:
            _error("Нет активных подключений Ozon или Megamarket")
            return {}

        oz_conn = oz_conns[0]
        mm_conn = mm_conns[0]

        # ── 2. Get PIM categories (only those with products) ──────────────
        _progress("load_pim_cats", 5, "Загружаем категории из товаров PIM...")

        async def _get_pim_cats():
            async with AsyncSessionLocal() as db:
                r = await db.execute(sa_select(Category).where(Category.id.in_(
                    sa_select(Category.id).join(
                        __import__("backend.models", fromlist=["Product"]).Product,
                        __import__("backend.models", fromlist=["Product"]).Product.category_id == Category.id
                    )
                )))
                return r.scalars().all()

        # Simplified: just get all categories with names
        async def _get_cat_names():
            from backend.database import engine
            from sqlalchemy import text
            async with engine.connect() as conn:
                r = await conn.execute(text("""
                    SELECT DISTINCT c.name FROM categories c
                    INNER JOIN products p ON p.category_id = c.id
                    WHERE c.name IS NOT NULL AND c.name NOT LIKE 'Cat_%' AND c.name NOT LIKE 'CatVisible_%'
                """))
                return [row[0] for row in r]

        pim_cat_names = asyncio.run(_get_cat_names())
        if not pim_cat_names:
            _error("В PIM нет товаров с категориями")
            return {}
        _progress("load_pim_cats", 8, f"Найдено {len(pim_cat_names)} категорий в PIM: {', '.join(pim_cat_names[:5])}")

        # ── 3. Fetch all Ozon + MM categories ────────────────────────────
        _progress("fetch_ozon", 10, "Загружаем полное дерево Ozon...")
        ozon_all = asyncio.run(_fetch_ozon_categories(oz_conn.api_key, oz_conn.client_id))
        _progress("fetch_mm", 18, f"Загружаем полное дерево Megamarket... (Ozon: {len(ozon_all)} кат.)")
        mm_all = asyncio.run(_fetch_mm_categories(mm_conn.api_key))
        _progress("ai_match_cats", 25, f"Ozon: {len(ozon_all)}, MM: {len(mm_all)}. AI подбирает нужные категории...")

        # ── 4. AI: match PIM category names -> Ozon leaf categories ──────
        ai_client = OpenAI(api_key=ai_key, base_url="https://api.deepseek.com")

        def _ai_find_categories(pim_names, platform_cats, platform_name, max_candidates=15):
            """AI выбирает из списка категорий МП те, что соответствуют PIM."""
            # Pre-filter by similarity to reduce prompt size
            scored = []
            for pc in platform_cats:
                best = max((_sim(pn, pc["name"]) for pn in pim_names), default=0)
                if best > 0.15:
                    scored.append((best, pc))
            scored.sort(key=lambda x: -x[0])
            top = [c for _, c in scored[:120]]

            prompt = f"""У нас есть интернет-магазин с категориями: {pim_names}

Из списка категорий {platform_name} выбери те, которые ТОЧНО соответствуют нашим категориям.
Список категорий {platform_name} (первые совпадения по названию):
{json.dumps([{{"id": c["id"], "name": c["name"]}} for c in top], ensure_ascii=False, indent=None)}

Верни JSON массив объектов ТОЛЬКО совпадающих категорий:
[{{"id": "...", "name": "...", "pim_category": "..."}}]

Правила:
- Выбирай только листовые категории (самые конкретные)
- Одна PIM категория может соответствовать нескольким категориям {platform_name}
- Не придумывай категории которых нет в списке
- Максимум {max_candidates} результатов"""

            try:
                resp = ai_client.chat.completions.create(
                    model="deepseek-chat",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1, max_tokens=3000,
                )
                raw = resp.choices[0].message.content.strip()
                m = re.search(r"\[.*\]", raw, re.DOTALL)
                if m:
                    return json.loads(m.group())
            except Exception as e:
                pass
            # Fallback: similarity only
            return [{"id": c["id"], "name": c["name"], "pim_category": ""} for _, c in scored[:max_candidates]]

        _progress("ai_ozon_cats", 30, "AI выбирает категории Ozon...")
        matched_ozon = _ai_find_categories(pim_cat_names, ozon_all, "Ozon", max_candidates=20)
        _progress("ai_mm_cats", 42, f"Найдено {len(matched_ozon)} категорий Ozon. AI выбирает категории Megamarket...")
        matched_mm = _ai_find_categories(pim_cat_names, mm_all, "Megamarket", max_candidates=20)
        _progress("build_attrs", 52, f"Выбрано: Ozon={len(matched_ozon)}, MM={len(matched_mm)}. Загружаем атрибуты...")

        # ── 5. Build attribute maps for each Ozon x MM pair ──────────────
        oz_adapter = get_adapter("ozon", oz_conn.api_key, oz_conn.client_id, None, None)
        mm_adapter = get_adapter("megamarket", mm_conn.api_key, None, None, None)

        snap = _read_json(_STAR_MAP_SNAPSHOT, {
            "edges": [], "ozon_categories_list": [], "megamarket_categories_list": [],
            "ozon_attributes_data": [], "megamarket_attributes_data": [],
        })

        all_edges = list(snap.get("edges") or [])
        oz_cats_list = list(snap.get("ozon_categories_list") or [])
        mm_cats_list = list(snap.get("megamarket_categories_list") or [])
        oz_attrs_data = list(snap.get("ozon_attributes_data") or [])
        mm_attrs_data = list(snap.get("megamarket_attributes_data") or [])

        total_pairs = len(matched_ozon)
        for oz_idx, oz_cat in enumerate(matched_ozon):
            pct = 52 + int((oz_idx / max(1, total_pairs)) * 40)
            oz_name = oz_cat.get("name", "")
            _progress("build_attrs", pct, f"[{oz_idx+1}/{total_pairs}] Ozon: {oz_name.split('->[-1]').strip() if '->' in oz_name else oz_name}")

            try:
                oz_schema = asyncio.run(oz_adapter.get_category_schema(str(oz_cat["id"])))
                oz_attrs = oz_schema.get("attributes") or []
            except Exception:
                continue

            # Find best MM match for this Ozon category
            pim_cat = oz_cat.get("pim_category", "")
            best_mm = None
            best_score = 0.0
            for mc in matched_mm:
                s = _sim(oz_name, mc["name"])
                if pim_cat:
                    s = max(s, _sim(pim_cat, mc.get("pim_category", "")))
                if s > best_score:
                    best_score, best_mm = s, mc

            if not best_mm:
                # Fallback: first MM cat
                best_mm = matched_mm[0] if matched_mm else None
            if not best_mm:
                continue

            try:
                mm_schema = asyncio.run(mm_adapter.get_category_schema(str(best_mm["id"])))
                mm_attrs = mm_schema.get("attributes") or []
            except Exception:
                continue

            # Build edges
            for oz_a in oz_attrs:
                oz_aname = str(oz_a.get("name") or "")
                best_edge_score, best_mm_a = 0.0, None
                for mm_a in mm_attrs:
                    mm_aname = str(mm_a.get("name") or "")
                    s = _sim(oz_aname, mm_aname)
                    if s > best_edge_score:
                        best_edge_score, best_mm_a = s, mm_a
                if best_mm_a and best_edge_score >= 0.42:
                    mm_opts = best_mm_a.get("dictionary_options") or []
                    all_edges.append({
                        "from_platform": "ozon",
                        "from_category_id": str(oz_cat["id"]),
                        "from_attribute_id": str(oz_a.get("id") or oz_a.get("attribute_id") or ""),
                        "from_name": oz_aname,
                        "to_platform": "megamarket",
                        "to_category_id": str(best_mm["id"]),
                        "to_attribute_id": str(best_mm_a.get("id") or ""),
                        "to_name": str(best_mm_a.get("name") or ""),
                        "score": round(best_edge_score, 3),
                        "method": "auto",
                        "mm_is_required": best_mm_a.get("is_required", False),
                        "mm_type": best_mm_a.get("type") or best_mm_a.get("valueTypeCode", ""),
                        "mm_is_suggest": best_mm_a.get("isSuggest"),
                        "mm_dictionary": mm_opts,
                        "value_mappings": [],
                    })

            # Update categories lists
            if not any(c.get("id") == str(oz_cat["id"]) for c in oz_cats_list):
                oz_cats_list.append({"id": str(oz_cat["id"]), "name": oz_name})
            if not any(c.get("id") == str(best_mm["id"]) for c in mm_cats_list):
                mm_cats_list.append({"id": str(best_mm["id"]), "name": best_mm.get("name", "")})

            # Update attrs data
            oz_attrs_data = [a for a in oz_attrs_data if str(a.get("category_id") or "") != str(oz_cat["id"])]
            for a in oz_attrs:
                oz_attrs_data.append({**a, "category_id": str(oz_cat["id"])})
            mm_attrs_data = [a for a in mm_attrs_data if str(a.get("category_id") or "") != str(best_mm["id"])]
            for a in mm_attrs:
                mm_attrs_data.append({**a, "category_id": str(best_mm["id"])})

        # ── 6. Save snapshot ──────────────────────────────────────────────
        import time as _t
        snap.update({
            "edges": all_edges,
            "ozon_categories_list": oz_cats_list,
            "megamarket_categories_list": mm_cats_list,
            "ozon_attributes_data": oz_attrs_data,
            "megamarket_attributes_data": mm_attrs_data,
            "ozon_categories": len(oz_cats_list),
            "megamarket_categories": len(mm_cats_list),
            "ozon_attributes": len(oz_attrs_data),
            "megamarket_attributes": len(mm_attrs_data),
            "generated_at_ts": int(_t.time()),
        })
        _write_json(_STAR_MAP_SNAPSHOT, snap)
        _done(f"Готово: {len(oz_cats_list)} кат. Ozon, {len(mm_cats_list)} кат. MM, {len(all_edges)} связей атрибутов")
        return {"edges": len(all_edges), "ozon_cats": len(oz_cats_list), "mm_cats": len(mm_cats_list)}

    except Exception as exc:
        import traceback
        _error(f"{str(exc)}: {traceback.format_exc()[-300:]}")
        raise


@celery_app.task(name="run_self_improve_incident_task")
def run_self_improve_incident_task(incident_id: str, ai_key: str = "") -> dict:
    """Celery task: запустить пайплайн самоисправления."""
    from backend.services.autonomous_improve import run_incident_pipeline
    return asyncio.run(run_incident_pipeline(incident_id=incident_id, ai_key=ai_key))

if __name__ == "__main__":
    celery_app.start()
