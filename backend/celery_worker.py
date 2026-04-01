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


@celery_app.task(name="run_self_improve_incident_task")
def run_self_improve_incident_task(incident_id: str, ai_key: str = "") -> dict:
    """Celery task: запустить пайплайн самоисправления."""
    from backend.services.autonomous_improve import run_incident_pipeline
    return asyncio.run(run_incident_pipeline(incident_id=incident_id, ai_key=ai_key))

if __name__ == "__main__":
    celery_app.start()
