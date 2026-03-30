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


if __name__ == "__main__":
    celery_app.start()

    weight_g = _to_float(src.get("product_weight_g") or src.get("weight_g"))
    if weight_g is not None:
        _put_if_empty("Вес (упаковки)", round(weight_g, 0))

    # Null/blank keys should be dropped before verifier/push.
    out = {k: v for k, v in out.items() if not _is_empty(v)}
    return _sanitize_manufacturer_fields(out, sku)


def _merge_non_empty_patch(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base or {})
    for k, v in (patch or {}).items():
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if isinstance(v, list) and len(v) == 0:
            continue
        if isinstance(v, dict) and len(v) == 0:
            continue
        out[k] = v
    return out


def _append_task_log(task_id: str, line: str) -> None:
    try:
        ts = time.strftime("%H:%M:%S")
        msg = f"[{ts}] {line}"
        key = f"task:{task_id}:logs"
        redis_client.rpush(key, msg)
        # Храним только последние 300 строк, чтобы не раздувать Redis.
        redis_client.ltrim(key, -300, -1)
        append_task_event(task_id, "task_log", {"line": line[:3000]})
    except Exception:
        pass


def _emit_mm_agent_trace(task_id: str, sku: str, cycle: int, trace: Any) -> None:
    """Печатает в консоль общение агента и подставленные поля."""
    try:
        turns = trace if isinstance(trace, list) else []
        print(f"[MM-AGENT][task={task_id}][sku={sku}][cycle={cycle}] turns={len(turns)}")
        _append_task_log(task_id, f"[MM-AGENT][sku={sku}][cycle={cycle}] turns={len(turns)}")
        for t in turns[-20:]:
            tool = str((t or {}).get("tool", ""))
            args = (t or {}).get("args", {}) if isinstance(t, dict) else {}
            summary = (t or {}).get("result_summary", {}) if isinstance(t, dict) else {}
            if tool == "set_fields":
                fields = args.get("fields", {}) if isinstance(args, dict) else {}
                line = json.dumps(fields, ensure_ascii=False)
                print(f"[MM-AGENT][set_fields] {line[:2000]}")
                _append_task_log(task_id, f"[MM-AGENT][set_fields][sku={sku}][cycle={cycle}] {line[:1200]}")
            elif tool in {"observe_state", "verify_evidence", "get_errors", "submit", "analyze_source", "recall_memory", "recall_star_map"}:
                line = json.dumps({"tool": tool, "args": args, "result": summary}, ensure_ascii=False)
                print(f"[MM-AGENT][tool] {line[:1500]}")
                _append_task_log(task_id, f"[MM-AGENT][tool][sku={sku}][cycle={cycle}] {line[:1000]}")
    except Exception as e:
        print(f"[MM-AGENT][trace_error] {e}")
        _append_task_log(task_id, f"[MM-AGENT][trace_error][sku={sku}][cycle={cycle}] {e}")


async def _maybe_autobuild_star_map(
    *,
    db: Any,
    mm_api_key: str,
    task_id: str,
) -> None:
    """
    Автосбор star-map: агент должен иметь карту даже без ручного запуска из UI.
    Перестраиваем только если снапшот отсутствует или устарел (>24ч).
    """
    try:
        state = get_attribute_star_map_state(edge_limit=1)
        ts = int(state.get("generated_at_ts") or 0)
        now = int(time.time())
        if ts > 0 and (now - ts) < 24 * 60 * 60:
            return
    except Exception:
        pass

    try:
        oz_conn_res = await db.execute(
            select(models.MarketplaceConnection).where(models.MarketplaceConnection.type == "ozon")
        )
        oz_conn = oz_conn_res.scalars().first()
        if not oz_conn:
            _append_task_log(task_id, "[STAR-MAP] skip: ozon connection not found")
            return
        _append_task_log(task_id, "[STAR-MAP] building auto map for agent memory...")
        res = await build_ozon_mm_attribute_star_map(
            ozon_api_key=oz_conn.api_key,
            ozon_client_id=oz_conn.client_id,
            mm_api_key=mm_api_key,
            max_ozon_categories=None,
            max_mm_categories=None,
            edge_threshold=0.58,
        )
        _append_task_log(task_id, f"[STAR-MAP] ready: {json.dumps(res.get('stats', {}), ensure_ascii=False)}")
    except Exception as e:
        _append_task_log(task_id, f"[STAR-MAP] auto build failed: {e}")


async def _fetch_ozon_full_context(db: Any, sku: str) -> Tuple[Dict[str, Any], List[str]]:
    """Возвращает максимально полный контекст из Ozon по SKU (full-ingest) и фото."""
    source_flat: Dict[str, Any] = {}
    images: List[str] = []
    try:
        ozon_conns_res = await db.execute(
            select(models.MarketplaceConnection).where(models.MarketplaceConnection.type == "ozon")
        )
        ozon_conns = ozon_conns_res.scalars().all()
    except Exception:
        ozon_conns = []
    for oz_conn in ozon_conns:
        try:
            oz_adapter = get_adapter("ozon", oz_conn.api_key, oz_conn.client_id, oz_conn.store_id, None)
            oz_data = await oz_adapter.pull_product(sku)
            if oz_data and isinstance(oz_data, dict):
                source_flat = oz_data.get("_ozon_source_flat") or oz_data
                images = oz_data.get("images") or (oz_data.get("primary_image") and [oz_data["primary_image"]]) or []
                if not images:
                    for k in ("images360", "images_urls"):
                        v = oz_data.get(k)
                        if isinstance(v, list) and v:
                            images = v
                            break
                break
        except Exception:
            continue
    return source_flat, images

async def async_process_single_sku(sku: str, connection_id: str, ai_key: str, task_id: str):
    local_engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    LocalSession = async_sessionmaker(local_engine, expire_on_commit=False)
    
    try:
        async with LocalSession() as db:
            conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == connection_id))
            db_conn = conn_res.scalars().first()
            if not db_conn:
                redis_client.incr(f"task:{task_id}:failed")
                redis_client.incr(f"task:{task_id}:processed")
                _maybe_trigger_self_improve_from_failure(
                    sku=str(offer_id),
                    task_id=task_id,
                    error_excerpt="mm_autofix_connection_not_found",
                    ai_key=ai_key,
                )
                return
                
            adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
            
            attrs_res = await db.execute(select(models.Attribute))
            active_attrs = attrs_res.scalars().all()

            existing_res = await db.execute(select(models.Product).where(models.Product.sku == sku))
            db_prod = existing_res.scalars().first()
                
            pulled_data = await adapter.pull_product(sku)
            if not pulled_data:
                redis_client.incr(f"task:{task_id}:failed")
                redis_client.incr(f"task:{task_id}:processed")
                return
        
            images = []
            if db_conn.type == "ozon":
                images = [pulled_data.get("primary_image")] + pulled_data.get("images", [])
                images = [img for img in images if img]
            elif db_conn.type == "wildberries":
                photos = pulled_data.get("photos", [])
                images = [p.get("big") or p.get("tm") for p in photos]
                images = [img for img in images if img]
                
            name = pulled_data.get("name", pulled_data.get("title", f"Imported {sku}"))
            
            mp_context = f"Marketplace: {db_conn.name} ({db_conn.type})"
            ai_result = await categorize_and_extract(json.dumps(pulled_data, ensure_ascii=False), active_attrs, ai_key, mp_context)
            
            categories_path = ai_result.get("categories", [])
            if not categories_path:
                categories_path = ["Общие (Разобрать)"]
                
            parent_id = None
            for cat_name in categories_path:
                cat_res = await db.execute(select(models.Category).where(
                    models.Category.name == cat_name,
                    models.Category.parent_id == parent_id
                ))
                db_cat = cat_res.scalars().first()
                if not db_cat:
                    db_cat = models.Category(name=cat_name, parent_id=parent_id)
                    db.add(db_cat)
                    await db.commit()
                    await db.refresh(db_cat)
                parent_id = db_cat.id
                
            new_attrs = ai_result.get("attributes", {})
            if not isinstance(new_attrs, dict):
                new_attrs = {}
            if db_conn.type == "ozon":
                src_flat = pulled_data.get("_ozon_source_flat")
                if isinstance(src_flat, dict):
                    for k, v in src_flat.items():
                        if v in (None, "", [], {}):
                            continue
                        if k not in new_attrs or new_attrs.get(k) in (None, "", [], {}):
                            new_attrs[k] = v
                    new_attrs["__ozon_source_flat"] = src_flat
                src_raw = pulled_data.get("_ozon_raw")
                if isinstance(src_raw, dict):
                    new_attrs["__ozon_raw"] = src_raw
            
            new_schema = ai_result.get("new_schema_attributes", [])
            for attr in new_schema:
                existing_attr = await db.execute(select(models.Attribute).where(models.Attribute.code == attr["code"]))
                if not existing_attr.scalars().first():
                    db_attr = models.Attribute(
                        code=attr["code"],
                        name=attr.get("name", attr["code"]).capitalize(),
                        type=attr.get("type", "string"),
                        is_required=False,
                        category_id=parent_id,
                        connection_id=db_conn.id if attr.get("is_marketplace_specific") else None
                    )
                    db.add(db_attr)
            await db.commit()

            score = calculate_completeness(new_attrs, [a for a in active_attrs if a.is_required])

            if db_prod:
                db_prod.name = name
                db_prod.category_id = parent_id
                db_prod.attributes_data = new_attrs
                db_prod.images = images[:5]
                db_prod.completeness_score = score
            else:
                db_prod = models.Product(
                    sku=sku,
                    name=name,
                    category_id=parent_id,
                    attributes_data=new_attrs,
                    images=images[:5],
                    completeness_score=score
                )
            db.add(db_prod)
            await db.commit()
            
            redis_client.incr(f"task:{task_id}:success")
            redis_client.incr(f"task:{task_id}:processed")
            redis_client.set(f"task:{task_id}:current_sku", sku)

    except Exception as e:
        redis_client.incr(f"task:{task_id}:failed")
        redis_client.incr(f"task:{task_id}:processed")
        print(f"Error processing {sku}: {e}")

@celery_app.task
def process_single_sku_task(sku: str, connection_id: str, ai_key: str, task_id: str):
    asyncio.run(async_process_single_sku(sku, connection_id, ai_key, task_id))

async def async_process_single_syndicate(product_id: str, connection_id: str, ai_key: str, task_id: str):
    local_engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    LocalSession = async_sessionmaker(local_engine, expire_on_commit=False)
    
    try:
        async with LocalSession() as db:
            prod_res = await db.execute(select(models.Product).where(models.Product.id == product_id))
            db_prod = prod_res.scalars().first()
            
            conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == connection_id))
            db_conn = conn_res.scalars().first()
            
            if not db_prod or not db_conn:
                redis_client.incr(f"task:{task_id}:failed")
                redis_client.incr(f"task:{task_id}:processed")
                return
                
            redis_client.set(f"task:{task_id}:current_sku", f"Syn: {db_prod.sku}")
            
            adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
            from backend.services.ai_service import generate_category_query, select_best_category, fix_mapping_errors

            # ===== MEGAMARKET: полноценный агент (тот же что в UI) =====
            if db_conn.type == 'megamarket':
                from backend.services.megamarket_syndicate_agent import run_megamarket_syndicate_agent
                from backend.services.megamarket_verifier_agent import verify_megamarket_payload_full_picture
                from backend.services.megamarket_reviewer_agent import ai_review_megamarket_payload_full_picture
                from backend.services.megamarket_critic_agent import ai_critic_megamarket_payload

                # Подтягиваем уже существующую карточку с MM для categoryId
                mm_existing: dict = {}
                try:
                    pulled = await adapter.pull_product(db_prod.sku)
                    if pulled and isinstance(pulled, dict):
                        mm_existing = pulled
                except Exception:
                    pass

                # Определяем категорию
                best_cat_id = None
                if mm_existing:
                    mm_attrs_tmp = mm_existing.get("attributes") or {}
                    mm_cat = (mm_attrs_tmp.get("categoryId") or mm_existing.get("categoryId") or "")
                    if mm_cat:
                        best_cat_id = str(mm_cat)
                if not best_cat_id:
                    pim_attrs_tmp = db_prod.attributes_data or {}
                    search_query = await generate_category_query(pim_attrs_tmp, ai_key)
                    found_cats = await adapter.search_categories(search_query)
                    if found_cats:
                        cat_sel = await select_best_category(pim_attrs_tmp, found_cats, ai_key)
                        best_cat_id = cat_sel.get("category_id")
                if not best_cat_id:
                    redis_client.incr(f"task:{task_id}:failed")
                    redis_client.set(f"task:{task_id}:error", f"{db_prod.sku}: не удалось определить категорию MM")
                    redis_client.incr(f"task:{task_id}:processed")
                    return

                # Полный контекст из Ozon (не опираемся только на PIM)
                ozon_source_flat, ozon_images = await _fetch_ozon_full_context(db, db_prod.sku)
                target_schema = {}
                try:
                    target_schema = await adapter.get_category_schema(str(best_cat_id))
                except Exception:
                    target_schema = {}

                # Собираем фото
                base = os.getenv("PUBLIC_API_BASE_URL", "").strip().rstrip("/")
                imgs: list = []
                for im in (db_prod.images or []):
                    s = str(im).strip()
                    if s.startswith("http"):
                        imgs.append(s)
                    elif s.startswith("/") and base:
                        imgs.append(base + s)
                if not imgs and mm_existing:
                    mm_ph = (mm_existing.get("attributes") or {}).get("photos") or mm_existing.get("photos") or []
                    imgs = [str(p) for p in mm_ph if str(p).startswith("http")]
                if not imgs and ozon_images:
                    imgs = [str(p) for p in ozon_images if str(p).startswith("http")]

                # Запускаем полноценный MM-агент — тот же что при синдикации из UI
                redis_client.set(f"task:{task_id}:current_sku", f"Syn {db_prod.sku} (MM Agent)")
                pim_attrs = dict(db_prod.attributes_data or {})
                if ozon_source_flat:
                    # Ozon как источник истины: обогащаем PIM полным full-ingest
                    pim_attrs.update(ozon_source_flat)
                pim_attrs["Артикул (SKU)"] = db_prod.sku
                initial_flat = dict(pim_attrs)
                initial_flat["categoryId"] = best_cat_id
                # Явно задаём правильное название из PIM чтобы агент не выдумывал
                if db_prod.name:
                    initial_flat["Наименование карточки"] = db_prod.name
                    initial_flat["name"] = db_prod.name
                    initial_flat["full_name"] = db_prod.name

                last_errors: list = []
                current_flat = dict(initial_flat)
                succeeded = False

                async def _wait_mm_moderation_or_errors(offer_id: str, wait_seconds: int = 180, step_seconds: int = 8):
                    """Ждём, пока карточка перейдёт в модерацию/активна или появятся async-ошибки."""
                    waited = 0
                    last_status = ""
                    while waited < wait_seconds:
                        await asyncio.sleep(step_seconds)
                        waited += step_seconds

                        async_err = await adapter.get_async_errors(offer_id)
                        if async_err:
                            try:
                                parsed = json.loads(async_err) if isinstance(async_err, str) else async_err
                                if not isinstance(parsed, list):
                                    parsed = [parsed]
                            except Exception:
                                parsed = [{"message": str(async_err)}]
                            return "errors", parsed, last_status

                        try:
                            card_now = await adapter.pull_product(offer_id)
                        except Exception:
                            card_now = {}
                        if isinstance(card_now, dict):
                            st = card_now.get("status")
                            if isinstance(st, dict):
                                st = st.get("code") or st.get("name") or st.get("value")
                            st_text = str(st or "").strip()
                            if st_text:
                                last_status = st_text
                                st_norm = st_text.upper()
                                if any(x in st_norm for x in ("MODER", "CHECK", "ACTIVE", "APPROV")):
                                    return "ok", [], last_status
                    return "pending", [], last_status

                cycle = 0
                await _maybe_autobuild_star_map(
                    db=db,
                    mm_api_key=db_conn.api_key,
                    task_id=task_id,
                )
                while not succeeded:
                    cycle += 1
                    redis_client.set(f"task:{task_id}:current_sku", f"Syn {db_prod.sku} (MM Agent цикл {cycle})")

                    # Передаём агенту текущий payload + ошибки предыдущей попытки
                    cycle_flat = dict(current_flat)
                    if last_errors:
                        cycle_flat["__mm_last_errors__"] = last_errors

                    agent_out = await run_megamarket_syndicate_agent(
                        adapter=adapter,
                        ai_config=ai_key,
                        category_id=str(best_cat_id),
                        sku=db_prod.sku,
                        name=db_prod.name or db_prod.sku,
                        pim_attributes=pim_attrs,
                        initial_flat=cycle_flat,
                        image_urls=imgs or None,
                        allow_agent_submit=False,
                    )

                    final_payload = agent_out.get("mapped_payload") or cycle_flat
                    final_payload["offer_id"] = db_prod.sku
                    final_payload["categoryId"] = best_cat_id
                    final_payload = _apply_mm_deterministic_prefill(
                        final_payload,
                        sku=db_prod.sku,
                        product_name=(db_prod.name or db_prod.sku),
                        images=imgs or [],
                        ozon_source_full=ozon_source_flat or {},
                    )
                    current_flat = dict(final_payload)
                    _emit_mm_agent_trace(task_id, db_prod.sku, cycle, agent_out.get("trace"))
                    mm_fresh = mm_existing
                    try:
                        pulled_now = await adapter.pull_product(db_prod.sku)
                        if isinstance(pulled_now, dict) and pulled_now:
                            mm_fresh = pulled_now
                    except Exception:
                        pass

                    evidence_contract = build_evidence_contract(
                        payload=final_payload,
                        ozon_source_full=ozon_source_flat,
                        mm_card=mm_fresh,
                    )
                    append_task_event(
                        task_id,
                        "field_decision",
                        {"sku": db_prod.sku, "cycle": cycle, "evidence_contract": evidence_contract},
                    )

                    ai_review = await ai_review_megamarket_payload_full_picture(
                        ai_config=ai_key,
                        sku=db_prod.sku,
                        category_id=str(best_cat_id),
                        payload=final_payload,
                        target_schema=target_schema,
                        ozon_source_full=ozon_source_flat,
                        mm_card=mm_fresh,
                        last_errors=last_errors,
                        evidence_contract=evidence_contract,
                    )
                    if not ai_review.get("ok_to_push", False):
                        blk2 = ai_review.get("blockers", [])[:8]
                        _append_task_log(task_id, f"[MM-AI-REVIEW][sku={db_prod.sku}][cycle={cycle}] BLOCKED {json.dumps(blk2, ensure_ascii=False)[:1200]}")
                        append_task_event(task_id, "blocker", {"stage": "ai_review", "sku": db_prod.sku, "cycle": cycle, "blockers": blk2})
                        last_errors = [{"message": f"AI reviewer blocked submit: {json.dumps(blk2, ensure_ascii=False)}"}]
                        continue
                    patch = ai_review.get("suggested_patch", {}) if isinstance(ai_review, dict) else {}
                    if isinstance(patch, dict) and patch:
                        final_payload = _merge_non_empty_patch(final_payload, patch)
                        final_payload = _apply_mm_deterministic_prefill(
                            final_payload,
                            sku=db_prod.sku,
                            product_name=(db_prod.name or db_prod.sku),
                            images=imgs or [],
                            ozon_source_full=ozon_source_flat or {},
                        )
                        current_flat = dict(final_payload)
                        _append_task_log(task_id, f"[MM-AI-REVIEW][sku={db_prod.sku}][cycle={cycle}] patch={json.dumps(patch, ensure_ascii=False)[:1000]}")

                    ai_critic = await ai_critic_megamarket_payload(
                        ai_config=ai_key,
                        sku=db_prod.sku,
                        category_id=str(best_cat_id),
                        payload=final_payload,
                        target_schema=target_schema,
                        evidence_contract=evidence_contract,
                        last_errors=last_errors,
                    )
                    critic_patch = ai_critic.get("suggested_patch", {}) if isinstance(ai_critic, dict) else {}
                    if isinstance(critic_patch, dict) and critic_patch:
                        final_payload = _merge_non_empty_patch(final_payload, critic_patch)
                        final_payload = _apply_mm_deterministic_prefill(
                            final_payload,
                            sku=db_prod.sku,
                            product_name=(db_prod.name or db_prod.sku),
                            images=imgs or [],
                            ozon_source_full=ozon_source_flat or {},
                        )
                        current_flat = dict(final_payload)
                        _append_task_log(task_id, f"[MM-AI-CRITIC][sku={db_prod.sku}][cycle={cycle}] patch={json.dumps(critic_patch, ensure_ascii=False)[:1000]}")
                    if not ai_critic.get("pass", False):
                        blk3 = ai_critic.get("blockers", [])[:8]
                        _append_task_log(task_id, f"[MM-AI-CRITIC][sku={db_prod.sku}][cycle={cycle}] BLOCKED {json.dumps(blk3, ensure_ascii=False)[:1200]}")
                        append_task_event(task_id, "blocker", {"stage": "ai_critic", "sku": db_prod.sku, "cycle": cycle, "blockers": blk3})
                        last_errors = [{"message": f"AI critic blocked submit: {json.dumps(blk3, ensure_ascii=False)}"}]
                        continue

                    verify = await verify_megamarket_payload_full_picture(
                        adapter=adapter,
                        sku=db_prod.sku,
                        category_id=str(best_cat_id),
                        payload=final_payload,
                        target_schema=target_schema,
                        ozon_source_full=ozon_source_flat,
                        mm_card=mm_fresh,
                        evidence_contract=evidence_contract,
                    )
                    if not verify.get("ok_to_push", False):
                        blk = verify.get("blockers", [])[:8]
                        print(f"[MM-VERIFIER][task={task_id}][sku={db_prod.sku}][cycle={cycle}] BLOCKED {json.dumps(blk, ensure_ascii=False)[:3000]}")
                        _append_task_log(task_id, f"[MM-VERIFIER][sku={db_prod.sku}][cycle={cycle}] BLOCKED {json.dumps(blk, ensure_ascii=False)[:1200]}")
                        append_task_event(task_id, "blocker", {"stage": "deterministic_verifier", "sku": db_prod.sku, "cycle": cycle, "blockers": blk})
                        last_errors = [{"message": f"Verifier blocked submit: {json.dumps(blk, ensure_ascii=False)}"}]
                        continue

                    print(f"[MM-PUSH][task={task_id}][sku={db_prod.sku}][cycle={cycle}] payload={json.dumps(final_payload, ensure_ascii=False)[:5000]}")
                    _append_task_log(task_id, f"[MM-PUSH][sku={db_prod.sku}][cycle={cycle}] payload={json.dumps(final_payload, ensure_ascii=False)[:1200]}")
                    res = await adapter.push_product(final_payload)
                    if int(res.get("status_code", 500)) < 400:
                        redis_client.set(f"task:{task_id}:current_sku", f"Syn {db_prod.sku} (MM: ожидание цикл {cycle})")
                        settle, parsed_errors, status_text = await _wait_mm_moderation_or_errors(db_prod.sku)
                        if settle == "ok":
                            _append_task_log(task_id, f"[MM-STATUS][sku={db_prod.sku}][cycle={cycle}] moved_to={status_text or 'unknown'}")
                            append_task_event(task_id, "moderation_transition", {"sku": db_prod.sku, "cycle": cycle, "status": status_text or "unknown"})
                            succeeded = True
                            break
                        if settle == "errors":
                            _append_task_log(task_id, f"[MM-STATUS][sku={db_prod.sku}][cycle={cycle}] errors={json.dumps(parsed_errors[:5], ensure_ascii=False)[:1000]}")
                            append_task_event(task_id, "mm_error", {"sku": db_prod.sku, "cycle": cycle, "errors": parsed_errors[:5]})
                            last_errors = parsed_errors
                        else:
                            _append_task_log(task_id, f"[MM-STATUS][sku={db_prod.sku}][cycle={cycle}] pending_status={status_text or 'unknown'}")
                            last_errors = [{"message": f"MM status still pending: {status_text or 'unknown'}"}]
                    else:
                        # HTTP-ошибка push — тоже передаём агенту
                        err_text = str(res.get("response", ""))
                        _append_task_log(task_id, f"[MM-PUSH][sku={db_prod.sku}][cycle={cycle}] http_error={err_text[:800]}")
                        last_errors = [{"message": err_text[:500]}]

                redis_client.set(f"task:{task_id}:current_sku", f"Syn {db_prod.sku} (Успешно)")
                redis_client.incr(f"task:{task_id}:success")

                redis_client.incr(f"task:{task_id}:processed")
                return
            # ===== КОНЕЦ MM-ветки =====

            # Остальные маркетплейсы (Ozon, WB, Yandex) — старый путь
            target_schema = {}
            best_cat_id = None
            search_query = await generate_category_query(db_prod.attributes_data, ai_key)
            found_categories = await adapter.search_categories(search_query)
            if found_categories:
                cat_select = await select_best_category(db_prod.attributes_data, found_categories, ai_key)
                best_cat_id = cat_select.get("category_id")
                if best_cat_id:
                    target_schema = await adapter.get_category_schema(str(best_cat_id))

            mapping_result = await map_schema_to_marketplace(db_prod.attributes_data, db_conn.type, target_schema, ai_key)
            mapped_payload = mapping_result.get("mapped_payload", mapping_result)

            if best_cat_id and db_conn.type in ("yandex", "ozon"):
                mapped_payload["categoryId"] = best_cat_id

            if db_conn.type == 'ozon':
                mapped_payload["offer_id"] = db_prod.sku
                mapped_payload["name"] = db_prod.name
                mapped_payload["images"] = db_prod.images or []

            max_attempts = 3
            attempts = 0
            while attempts < max_attempts:
                attempts += 1
                res = await adapter.push_product(mapped_payload)

                if db_conn.type == "ozon" and int(res.get("status_code", 500)) < 400:
                    redis_client.set(f"task:{task_id}:current_sku", f"Syn {db_prod.sku} (Ozon validation poll)")
                    await asyncio.sleep(12)
                    async_error = await adapter.get_async_errors(db_prod.sku)
                    if async_error:
                        res["status_code"] = 400
                        res["response"] = async_error

                if int(res.get("status_code", 500)) >= 400:
                    api_error = res.get('response', 'Unknown error')
                    if attempts < max_attempts:
                        redis_client.set(f"task:{task_id}:current_sku", f"Syn {db_prod.sku} (AI Fix {attempts})")
                        fixed = await fix_mapping_errors(mapped_payload, api_error, target_schema, ai_key)
                        if isinstance(fixed, dict):
                            if best_cat_id and not fixed.get("categoryId"):
                                fixed["categoryId"] = best_cat_id
                            if db_prod.sku and not fixed.get("offer_id"):
                                fixed["offer_id"] = db_prod.sku
                            mapped_payload = fixed
                    else:
                        redis_client.incr(f"task:{task_id}:failed")
                        redis_client.set(f"task:{task_id}:error", f"Сбой (после {attempts} попыток AI): {api_error}")
                        _maybe_trigger_self_improve_from_failure(
                            sku=str(db_prod.sku),
                            task_id=task_id,
                            error_excerpt=str(api_error)[:1000],
                            ai_key=ai_key,
                        )
                        break
                else:
                    redis_client.set(f"task:{task_id}:current_sku", f"Syn {db_prod.sku} (Успешно)")
                    if db_conn.type == "megamarket_unused":
                        loc = getattr(db_conn, "warehouse_id", None) or os.getenv("MEGAMARKET_DEFAULT_LOCATION_ID", "").strip()
                        ad = db_prod.attributes_data or {}
                        if loc and hasattr(adapter, "update_price_by_offer_id"):
                            if ad.get("mm_price_rubles") is not None:
                                try:
                                    await adapter.update_price_by_offer_id(
                                        loc, str(db_prod.sku)[:35], float(ad["mm_price_rubles"])
                                    )
                                except (TypeError, ValueError):
                                    pass
                            if ad.get("mm_stock_quantity") is not None:
                                try:
                                    await adapter.update_stock_by_offer_id(
                                        loc, str(db_prod.sku)[:35], int(ad["mm_stock_quantity"])
                                    )
                                except (TypeError, ValueError):
                                    pass
                    redis_client.incr(f"task:{task_id}:success")
                    break
            
            redis_client.incr(f"task:{task_id}:processed")

    except Exception as e:
        redis_client.incr(f"task:{task_id}:failed")
        redis_client.incr(f"task:{task_id}:processed")
        redis_client.set(f"task:{task_id}:error", str(e))
        try:
            sku_fallback = str(product_id)
        except Exception:
            sku_fallback = "unknown"
        _maybe_trigger_self_improve_from_failure(
            sku=sku_fallback,
            task_id=task_id,
            error_excerpt=str(e)[:1000],
            ai_key=ai_key,
        )
        print(f"Error syndicating {product_id}: {e}")

@celery_app.task
def process_single_syndicate_task(product_id: str, connection_id: str, ai_key: str, task_id: str):
    asyncio.run(async_process_single_syndicate(product_id, connection_id, ai_key, task_id))


async def async_mm_offer_id_autofix(offer_id: str, connection_id: str, ai_key: str, task_id: str):
    """
    Автоисправление карточки MM по offerId без локального Product.
    Источники данных (в порядке приоритета):
    1. Ozon — если есть подключение и карточка найдена по тому же SKU (full-ingest).
    2. MM — данные уже существующей карточки с ошибками.
    """
    local_engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    LocalSession = async_sessionmaker(local_engine, expire_on_commit=False)

    try:
        async with LocalSession() as db:
            conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == connection_id))
            db_conn = conn_res.scalars().first()
            if not db_conn:
                redis_client.incr(f"task:{task_id}:failed")
                redis_client.incr(f"task:{task_id}:processed")
                return

            redis_client.set(f"task:{task_id}:current_sku", f"MM-fix: {offer_id}")
            adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
            from backend.services.megamarket_verifier_agent import verify_megamarket_payload_full_picture
            from backend.services.megamarket_reviewer_agent import ai_review_megamarket_payload_full_picture
            from backend.services.megamarket_critic_agent import ai_critic_megamarket_payload

            # --- Шаг 1: Ищем данные в Ozon по тому же SKU ---
            ozon_source_flat: dict = {}
            ozon_images: list = []
            redis_client.set(f"task:{task_id}:current_sku", f"MM-fix {offer_id}: ищем в Ozon...")
            ozon_source_flat, ozon_images = await _fetch_ozon_full_context(db, offer_id)

            # --- Шаг 2: Данные существующей карточки из MM ---
            mm_card: dict = {}
            try:
                pulled = await adapter.pull_product(offer_id)
                if pulled and isinstance(pulled, dict):
                    mm_card = pulled
            except Exception:
                pass

            mm_attrs = mm_card.get("attributes") or {}
            best_cat_id = str(
                mm_attrs.get("categoryId") or mm_card.get("categoryId") or mm_card.get("goodsCategoryId") or ""
            ).strip()

            if not best_cat_id:
                redis_client.incr(f"task:{task_id}:failed")
                redis_client.set(f"task:{task_id}:error", f"{offer_id}: categoryId не найден ни в MM, ни в Ozon")
                redis_client.incr(f"task:{task_id}:processed")
                _maybe_trigger_self_improve_from_failure(
                    sku=str(offer_id),
                    task_id=task_id,
                    error_excerpt="mm_autofix_category_not_found",
                    ai_key=ai_key,
                )
                return

            target_schema = {}
            try:
                target_schema = await adapter.get_category_schema(best_cat_id)
            except Exception:
                pass

            # --- Шаг 3: Запускаем полноценный MM-агент (тот же что в UI) ---
            # Источник данных: Ozon (приоритет) или mm_card как fallback
            pim_attributes: dict = {}
            if ozon_source_flat:
                pim_attributes = dict(ozon_source_flat)
            else:
                pim_attributes = {
                    "name": mm_attrs.get("name") or mm_card.get("name") or offer_id,
                    "brand": mm_attrs.get("brand") or mm_card.get("brand") or "",
                    "description": mm_attrs.get("description") or mm_card.get("description") or "",
                }
            pim_attributes["Артикул (SKU)"] = offer_id

            # Фото — Ozon или MM
            photos_src = ozon_images or mm_attrs.get("photos") or mm_card.get("photos") or []
            photos_clean = [str(p) for p in photos_src if str(p).startswith("http")]
            if photos_clean:
                pim_attributes["Фото"] = photos_clean
                pim_attributes["images"] = photos_clean

            # Штрихкод
            barcodes_raw = (
                pim_attributes.get("barcodes") or pim_attributes.get("Штрихкод")
                or mm_attrs.get("barcodes") or mm_card.get("barcodes") or []
            )
            if isinstance(barcodes_raw, list) and barcodes_raw:
                pim_attributes["Штрихкод"] = barcodes_raw[0]
            elif isinstance(barcodes_raw, str) and barcodes_raw:
                pim_attributes["Штрихкод"] = barcodes_raw

            initial_flat = dict(pim_attributes)
            initial_flat["categoryId"] = best_cat_id

            from backend.services.megamarket_syndicate_agent import run_megamarket_syndicate_agent

            product_name = (
                pim_attributes.get("name") or pim_attributes.get("Наименование карточки")
                or pim_attributes.get("full_name") or offer_id
            )

            last_errors: list = []
            current_flat = dict(initial_flat)
            succeeded = False

            async def _wait_mm_moderation_or_errors(offer: str, wait_seconds: int = 180, step_seconds: int = 8):
                waited = 0
                last_status = ""
                while waited < wait_seconds:
                    await asyncio.sleep(step_seconds)
                    waited += step_seconds

                    async_err = await adapter.get_async_errors(offer)
                    if async_err:
                        try:
                            parsed = json.loads(async_err) if isinstance(async_err, str) else async_err
                            if not isinstance(parsed, list):
                                parsed = [parsed]
                        except Exception:
                            parsed = [{"message": str(async_err)}]
                        return "errors", parsed, last_status

                    try:
                        card_now = await adapter.pull_product(offer)
                    except Exception:
                        card_now = {}
                    if isinstance(card_now, dict):
                        st = card_now.get("status")
                        if isinstance(st, dict):
                            st = st.get("code") or st.get("name") or st.get("value")
                        st_text = str(st or "").strip()
                        if st_text:
                            last_status = st_text
                            st_norm = st_text.upper()
                            if any(x in st_norm for x in ("MODER", "CHECK", "ACTIVE", "APPROV")):
                                return "ok", [], last_status
                return "pending", [], last_status

            cycle = 0
            while not succeeded:
                cycle += 1
                redis_client.set(f"task:{task_id}:current_sku", f"MM-fix {offer_id} (Агент цикл {cycle})")

                cycle_flat = dict(current_flat)
                if last_errors:
                    cycle_flat["__mm_last_errors__"] = last_errors

                agent_out = await run_megamarket_syndicate_agent(
                    adapter=adapter,
                    ai_config=ai_key,
                    category_id=str(best_cat_id),
                    sku=offer_id,
                    name=str(product_name),
                    pim_attributes=pim_attributes,
                    initial_flat=cycle_flat,
                    image_urls=photos_clean or None,
                    allow_agent_submit=False,
                )

                final_payload = agent_out.get("mapped_payload") or cycle_flat
                final_payload["offer_id"] = offer_id
                final_payload["categoryId"] = best_cat_id
                final_payload = _apply_mm_deterministic_prefill(
                    final_payload,
                    sku=offer_id,
                    product_name=str(product_name),
                    images=photos_clean or [],
                    ozon_source_full=ozon_source_flat or {},
                )
                current_flat = dict(final_payload)
                _emit_mm_agent_trace(task_id, offer_id, cycle, agent_out.get("trace"))
                mm_fresh = mm_card
                try:
                    pulled_now = await adapter.pull_product(offer_id)
                    if isinstance(pulled_now, dict) and pulled_now:
                        mm_fresh = pulled_now
                except Exception:
                    pass

                evidence_contract = build_evidence_contract(
                    payload=final_payload,
                    ozon_source_full=ozon_source_flat,
                    mm_card=mm_fresh,
                )
                append_task_event(
                    task_id,
                    "field_decision",
                    {"sku": offer_id, "cycle": cycle, "evidence_contract": evidence_contract},
                )

                ai_review = await ai_review_megamarket_payload_full_picture(
                    ai_config=ai_key,
                    sku=offer_id,
                    category_id=str(best_cat_id),
                    payload=final_payload,
                    target_schema=target_schema,
                    ozon_source_full=ozon_source_flat,
                    mm_card=mm_fresh,
                    last_errors=last_errors,
                    evidence_contract=evidence_contract,
                )
                if not ai_review.get("ok_to_push", False):
                    blk2 = ai_review.get("blockers", [])[:8]
                    _append_task_log(task_id, f"[MM-AI-REVIEW][sku={offer_id}][cycle={cycle}] BLOCKED {json.dumps(blk2, ensure_ascii=False)[:1200]}")
                    append_task_event(task_id, "blocker", {"stage": "ai_review", "sku": offer_id, "cycle": cycle, "blockers": blk2})
                    last_errors = [{"message": f"AI reviewer blocked submit: {json.dumps(blk2, ensure_ascii=False)}"}]
                    continue
                patch = ai_review.get("suggested_patch", {}) if isinstance(ai_review, dict) else {}
                if isinstance(patch, dict) and patch:
                    final_payload = _merge_non_empty_patch(final_payload, patch)
                    final_payload = _apply_mm_deterministic_prefill(
                        final_payload,
                        sku=offer_id,
                        product_name=str(product_name),
                        images=photos_clean or [],
                        ozon_source_full=ozon_source_flat or {},
                    )
                    current_flat = dict(final_payload)
                    _append_task_log(task_id, f"[MM-AI-REVIEW][sku={offer_id}][cycle={cycle}] patch={json.dumps(patch, ensure_ascii=False)[:1000]}")

                ai_critic = await ai_critic_megamarket_payload(
                    ai_config=ai_key,
                    sku=offer_id,
                    category_id=str(best_cat_id),
                    payload=final_payload,
                    target_schema=target_schema,
                    evidence_contract=evidence_contract,
                    last_errors=last_errors,
                )
                critic_patch = ai_critic.get("suggested_patch", {}) if isinstance(ai_critic, dict) else {}
                if isinstance(critic_patch, dict) and critic_patch:
                    final_payload = _merge_non_empty_patch(final_payload, critic_patch)
                    final_payload = _apply_mm_deterministic_prefill(
                        final_payload,
                        sku=offer_id,
                        product_name=str(product_name),
                        images=photos_clean or [],
                        ozon_source_full=ozon_source_flat or {},
                    )
                    current_flat = dict(final_payload)
                    _append_task_log(task_id, f"[MM-AI-CRITIC][sku={offer_id}][cycle={cycle}] patch={json.dumps(critic_patch, ensure_ascii=False)[:1000]}")
                if not ai_critic.get("pass", False):
                    blk3 = ai_critic.get("blockers", [])[:8]
                    _append_task_log(task_id, f"[MM-AI-CRITIC][sku={offer_id}][cycle={cycle}] BLOCKED {json.dumps(blk3, ensure_ascii=False)[:1200]}")
                    append_task_event(task_id, "blocker", {"stage": "ai_critic", "sku": offer_id, "cycle": cycle, "blockers": blk3})
                    last_errors = [{"message": f"AI critic blocked submit: {json.dumps(blk3, ensure_ascii=False)}"}]
                    continue
                verify = await verify_megamarket_payload_full_picture(
                    adapter=adapter,
                    sku=offer_id,
                    category_id=str(best_cat_id),
                    payload=final_payload,
                    target_schema=target_schema,
                    ozon_source_full=ozon_source_flat,
                    mm_card=mm_fresh,
                    evidence_contract=evidence_contract,
                )
                if not verify.get("ok_to_push", False):
                    blk = verify.get("blockers", [])[:8]
                    print(f"[MM-VERIFIER][task={task_id}][sku={offer_id}][cycle={cycle}] BLOCKED {json.dumps(blk, ensure_ascii=False)[:3000]}")
                    _append_task_log(task_id, f"[MM-VERIFIER][sku={offer_id}][cycle={cycle}] BLOCKED {json.dumps(blk, ensure_ascii=False)[:1200]}")
                    append_task_event(task_id, "blocker", {"stage": "deterministic_verifier", "sku": offer_id, "cycle": cycle, "blockers": blk})
                    last_errors = [{"message": f"Verifier blocked submit: {json.dumps(blk, ensure_ascii=False)}"}]
                    continue

                print(f"[MM-PUSH][task={task_id}][sku={offer_id}][cycle={cycle}] payload={json.dumps(final_payload, ensure_ascii=False)[:5000]}")
                _append_task_log(task_id, f"[MM-PUSH][sku={offer_id}][cycle={cycle}] payload={json.dumps(final_payload, ensure_ascii=False)[:1200]}")
                res = await adapter.push_product(final_payload)
                if int(res.get("status_code", 500)) < 400:
                    redis_client.set(f"task:{task_id}:current_sku", f"MM-fix {offer_id} (ожидание цикл {cycle})")
                    settle, parsed_errors, status_text = await _wait_mm_moderation_or_errors(offer_id)
                    if settle == "ok":
                        _append_task_log(task_id, f"[MM-STATUS][sku={offer_id}][cycle={cycle}] moved_to={status_text or 'unknown'}")
                        append_task_event(task_id, "moderation_transition", {"sku": offer_id, "cycle": cycle, "status": status_text or "unknown"})
                        succeeded = True
                        break
                    if settle == "errors":
                        _append_task_log(task_id, f"[MM-STATUS][sku={offer_id}][cycle={cycle}] errors={json.dumps(parsed_errors[:5], ensure_ascii=False)[:1000]}")
                        append_task_event(task_id, "mm_error", {"sku": offer_id, "cycle": cycle, "errors": parsed_errors[:5]})
                        last_errors = parsed_errors
                    else:
                        _append_task_log(task_id, f"[MM-STATUS][sku={offer_id}][cycle={cycle}] pending_status={status_text or 'unknown'}")
                        last_errors = [{"message": f"MM status still pending: {status_text or 'unknown'}"}]
                else:
                    _append_task_log(task_id, f"[MM-PUSH][sku={offer_id}][cycle={cycle}] http_error={str(res.get('response', ''))[:800]}")
                    last_errors = [{"message": str(res.get("response", ""))[:500]}]

            redis_client.set(f"task:{task_id}:current_sku", f"MM-fix {offer_id} (Успешно)")
            redis_client.incr(f"task:{task_id}:success")

            redis_client.incr(f"task:{task_id}:processed")

    except Exception as e:
        redis_client.incr(f"task:{task_id}:failed")
        redis_client.incr(f"task:{task_id}:processed")
        redis_client.set(f"task:{task_id}:error", f"MM-fix {offer_id}: {str(e)[:300]}")
        _maybe_trigger_self_improve_from_failure(
            sku=str(offer_id),
            task_id=task_id,
            error_excerpt=str(e)[:1000],
            ai_key=ai_key,
        )
        print(f"Error mm_offer_id_autofix {offer_id}: {e}")


@celery_app.task
def process_mm_offer_id_autofix_task(offer_id: str, connection_id: str, ai_key: str, task_id: str):
    asyncio.run(async_mm_offer_id_autofix(offer_id, connection_id, ai_key, task_id))


def _set_star_map_build_job_state(task_id: str, **fields: Any) -> None:
    key = f"task:star_map_build:{task_id}"
    payload: Dict[str, Any] = {}
    for k, v in fields.items():
        if isinstance(v, (dict, list)):
            payload[k] = json.dumps(v, ensure_ascii=False)
        elif v is None:
            payload[k] = ""
        else:
            payload[k] = str(v)
    if payload:
        redis_client.hset(key, mapping=payload)
    redis_client.expire(key, 60 * 60 * 24 * 7)


@celery_app.task
def build_attribute_star_map_task(
    task_id: str,
    ozon_api_key: str,
    ozon_client_id: str | None,
    mm_api_key: str,
    max_ozon_categories: int | None = None,
    max_mm_categories: int | None = None,
    edge_threshold: float = 0.58,
):
    started = int(time.time())
    _set_star_map_build_job_state(
        task_id,
        task_id=task_id,
        status="running",
        stage="starting",
        progress_percent=1,
        message="Запуск Celery задачи сборки карты",
        started_at_ts=started,
        updated_at_ts=started,
        finished_at_ts="",
        error="",
    )

    def _progress_cb(state: Dict[str, Any]) -> None:
        _set_star_map_build_job_state(
            task_id,
            status="running",
            stage=state.get("stage"),
            progress_percent=state.get("progress_percent"),
            message=state.get("message"),
            updated_at_ts=state.get("updated_at_ts") or int(time.time()),
            progress_extra=state.get("extra") or {},
        )

    try:
        result = asyncio.run(
            build_ozon_mm_attribute_star_map(
                ozon_api_key=ozon_api_key,
                ozon_client_id=ozon_client_id,
                mm_api_key=mm_api_key,
                max_ozon_categories=max_ozon_categories,
                max_mm_categories=max_mm_categories,
                edge_threshold=edge_threshold,
                progress_cb=_progress_cb,
            )
        )
        _set_star_map_build_job_state(
            task_id,
            status="completed",
            stage="completed",
            progress_percent=100,
            message="Сборка карты завершена",
            result=result,
            finished_at_ts=int(time.time()),
            updated_at_ts=int(time.time()),
            error="",
        )
    except Exception as e:
        _set_star_map_build_job_state(
            task_id,
            status="failed",
            stage="failed",
            progress_percent=100,
            message="Сборка карты завершилась ошибкой",
            finished_at_ts=int(time.time()),
            updated_at_ts=int(time.time()),
            error=str(e),
        )


@celery_app.task
def run_self_improve_incident_task(incident_id: str, ai_key: str):
    asyncio.run(run_incident_pipeline(incident_id=incident_id, ai_key=ai_key, workspace_root="/mnt/data/Pimv3"))


def _maybe_trigger_self_improve_from_failure(*, sku: str, task_id: str, error_excerpt: str, ai_key: str) -> None:
    try:
        out = record_failure_and_maybe_trigger(sku=sku, task_id=task_id, error_excerpt=error_excerpt, ai_key=ai_key)
        if out.get("triggered") and out.get("incident_id"):
            incident_id = str(out.get("incident_id"))
            _append_task_log(task_id, f"[SELF-IMPROVE] triggered incident={incident_id} sku={sku}")
            run_self_improve_incident_task.delay(incident_id, ai_key)
    except Exception as e:
        _append_task_log(task_id, f"[SELF-IMPROVE] trigger error: {e}")


async def async_process_single_ai_generation(product_id: str, ai_key: str, task_id: str):
    local_engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    LocalSession = async_sessionmaker(local_engine, expire_on_commit=False)
    
    try:
        async with LocalSession() as db:
            prod_res = await db.execute(select(models.Product).where(models.Product.id == product_id))
            db_prod = prod_res.scalars().first()
            if not db_prod:
                redis_client.incr(f"task:{task_id}:failed")
                redis_client.incr(f"task:{task_id}:processed")
                return
                
            redis_client.set(f"task:{task_id}:current_sku", f"AI Gen: {db_prod.sku}")
            
            attrs_res = await db.execute(select(models.Attribute))
            active_attrs = attrs_res.scalars().all()
            
            from backend.services.ai_service import categorize_and_extract, generate_description
            from backend.services.completeness_engine import calculate_completeness
            
            context_data = {"name": db_prod.name, "existing_attributes": db_prod.attributes_data}
            ai_result = await categorize_and_extract(json.dumps(context_data, ensure_ascii=False), active_attrs, ai_key, "Local AI Generator")
            
            new_schema = ai_result.get("new_schema_attributes", [])
            for attr in new_schema:
                existing_attr = await db.execute(select(models.Attribute).where(models.Attribute.code == attr["code"]))
                if not existing_attr.scalars().first():
                    db_attr = models.Attribute(
                        code=attr["code"],
                        name=attr.get("name", attr["code"]).capitalize(),
                        type=attr.get("type", "string"),
                        is_required=False,
                        category_id=db_prod.category_id
                    )
                    db.add(db_attr)
            
            new_attrs = ai_result.get("attributes", {})
            merged_attrs = {**(db_prod.attributes_data or {}), **new_attrs}
            
            seo_html = await generate_description(merged_attrs, ai_key)
            score = calculate_completeness(merged_attrs, [a for a in active_attrs if a.is_required])
            
            db_prod.attributes_data = merged_attrs
            if seo_html:
                db_prod.description_html = seo_html
            db_prod.completeness_score = score
            
            db.add(db_prod)
            await db.commit()
            
            redis_client.incr(f"task:{task_id}:success")
            redis_client.incr(f"task:{task_id}:processed")
    except Exception as e:
        redis_client.incr(f"task:{task_id}:failed")
        redis_client.incr(f"task:{task_id}:processed")
        print(f"Error generating AI for {product_id}: {e}")

@celery_app.task
def process_single_ai_generation_task(product_id: str, ai_key: str, task_id: str):
    asyncio.run(async_process_single_ai_generation(product_id, ai_key, task_id))
