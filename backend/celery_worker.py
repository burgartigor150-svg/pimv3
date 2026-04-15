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
def auto_build_star_map_from_products_task(task_id: str, ai_key: str, source_platforms: list = None) -> dict:
    """Автосборка звёздной карты между ВСЕМИ подключёнными платформами.

    Вариант A: полносвязный граф без зависимости от товаров.
    - Для каждой пары платформ (A, B) строим edges A->B на основе схем категорий
    - Edges B->A строятся автоматически как инверсия A->B
    - Товары (Ozon) используются только для обогащения value_mappings если доступны
    - Новая платформа: добавить _fetch_categories_for_platform + адаптер в get_adapter

    Регистрация новой платформы:
    1. Добавить elif в _fetch_categories_for_platform (дерево категорий)
    2. Реализовать адаптер с get_category_schema в adapters.py
    3. Всё остальное подхватится автоматически
    """
    import time as _time, json as _json, re as _re
    from difflib import SequenceMatcher
    from collections import defaultdict

    def _upd(stage, pct, msg):
        redis_client.hset(f"task:star_map_build:{task_id}", mapping={
            "status": "running", "stage": stage,
            "progress_percent": max(0, min(int(pct), 99)),
            "message": msg, "updated_at_ts": int(_time.time()),
        })

    def _done(msg):
        redis_client.hset(f"task:star_map_build:{task_id}", mapping={
            "status": "done", "stage": "done", "progress_percent": 100,
            "message": msg, "finished_at_ts": int(_time.time()),
        })

    def _error(msg):
        redis_client.hset(f"task:star_map_build:{task_id}", mapping={
            "status": "error", "stage": "error", "progress_percent": 0,
            "message": msg, "error": msg, "finished_at_ts": int(_time.time()),
        })

    def _norm(s):
        return _re.sub(r"\s+", " ", str(s or "").strip().lower().replace("ё", "е"))

    def _sim(a, b):
        an, bn = _norm(a), _norm(b)
        if not an or not bn: return 0.0
        seq = SequenceMatcher(None, an, bn).ratio()
        ta = set(_re.findall(r"[a-zA-Zа-яА-ЯёЁ0-9]+", an))
        tb = set(_re.findall(r"[a-zA-Zа-яА-ЯёЁ0-9]+", bn))
        jac = len(ta & tb) / max(1, len(ta | tb))
        if an in bn or bn in an: seq = max(seq, 0.82)
        return seq * 0.65 + jac * 0.35

    try:
        from backend.database import AsyncSessionLocal
        from backend.models import MarketplaceConnection
        from backend.services.adapters import get_adapter, ozon_httpx_client
        from backend.services.attribute_star_map import (
            _fetch_ozon_categories, _fetch_mm_categories, _fetch_yandex_categories, _fetch_wb_categories,
            _read_json, _write_json, _STAR_MAP_SNAPSHOT, get_agent_memory,
        )
        from openai import OpenAI
        from sqlalchemy import select as sa_select

        _upd("init", 1, "Инициализация...")

        _ai_cfg = _json.loads(ai_key) if isinstance(ai_key, str) and ai_key.startswith("{") else {"api_key": ai_key}
        _real_ai_key = _ai_cfg.get("api_key", ai_key)
        ai_client = OpenAI(api_key=_real_ai_key, base_url="https://api.deepseek.com", timeout=45)

        # ── 1. Один представитель на платформу ───────────────────────────
        async def _get_platform_conns():
            async with AsyncSessionLocal() as db:
                res = await db.execute(sa_select(MarketplaceConnection))
                all_conns = [c for c in res.scalars().all() if "test" not in (c.api_key or "").lower()]
                by_platform = {}
                for c in sorted(all_conns, key=lambda x: str(x.id)):
                    if c.type not in by_platform:
                        by_platform[c.type] = c
                return by_platform

        platform_conns = asyncio.run(_get_platform_conns())
        platforms = list(platform_conns.keys())
        _upd("init", 3, f"Подключены: {', '.join(platforms)}")

        if len(platforms) < 2:
            _error(f"Нужно хотя бы 2 платформы, подключена только: {platforms}")
            return {}

        # ── 2. Загрузка дерева категорий для любой платформы ─────────────
        # Добавить новую платформу: elif platform == "yandex": ...
        async def _fetch_categories_for_platform(platform, conn) -> list:
            if platform == "ozon":
                return await _fetch_ozon_categories(conn.api_key, conn.client_id)
            if platform == "megamarket":
                return await _fetch_mm_categories(conn.api_key)
            elif platform in ("wildberries", "wb"):
                return await _fetch_wb_categories(conn.api_key)
            elif platform == "yandex":
                return await _fetch_yandex_categories(conn.api_key, conn.client_id)
            raise NotImplementedError(f"Дерево категорий для '{platform}' не реализовано")

        # ── 3. Загрузка реальных товаров Ozon для value_mappings ──────────
        async def _fetch_ozon_products_by_category(conn) -> dict:
            """Возвращает {cat_key: {attr_id: {values}}} — реальные значения атрибутов."""
            oz_headers = {"Client-Id": conn.client_id, "Api-Key": conn.api_key, "Content-Type": "application/json"}
            items = []
            last_id = None
            page = 0
            async with ozon_httpx_client(60.0) as client:
                while True:
                    body = {"filter": {"visibility": "ALL"}, "limit": 1000, "sort_dir": "ASC"}
                    if last_id:
                        body["last_id"] = last_id
                    r = await client.post(
                        "https://api-seller.ozon.ru/v4/product/info/attributes",
                        headers=oz_headers, json=body
                    )
                    if r.status_code != 200:
                        break
                    d = r.json()
                    batch = d.get("result") or []
                    items.extend(batch)
                    last_id = d.get("last_id")
                    page += 1
                    if not batch or not last_id or len(batch) < 1000 or page > 50:
                        break
            # Группируем: {cat_key: {attr_id: set(values)}}
            cat_attr_values: dict = defaultdict(lambda: defaultdict(set))
            for item in items:
                cid = item.get("description_category_id")
                tid = item.get("type_id")
                if not cid:
                    continue
                cat_key = f"{cid}_{tid or 0}"
                for a in (item.get("attributes") or []):
                    aid = str(a.get("id") or "")
                    for v in (a.get("values") or []):
                        val = v.get("value") or v.get("dictionary_value") or ""
                        if val:
                            cat_attr_values[cat_key][aid].add(str(val))
            return cat_attr_values

        # ── 4. AI: сопоставить категорию src -> лучшая в tgt ─────────────
        def _ai_find_best_category(src_cat_name, tgt_cats, tgt_platform):
            scored = sorted(tgt_cats, key=lambda c: -_sim(src_cat_name, c.get("name", "")))
            top = scored[:30]
            prompt = (
                f'Категория товаров: "{src_cat_name}"\n\n'
                f'Выбери ОДНУ наиболее подходящую категорию из {tgt_platform}:\n'
                + _json.dumps([{"id": c["id"], "name": c["name"]} for c in top], ensure_ascii=False)
                + '\n\nВерни JSON: {"id": "...", "name": "..."}\n'
                  'Только одну, самую точную. Если нет совпадений — верни null.'
            )
            try:
                resp = ai_client.chat.completions.create(
                    model="deepseek-chat",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1, max_tokens=200,
                )
                raw = resp.choices[0].message.content.strip()
                m = _re.search(r'\{.*?\}', raw, _re.DOTALL)
                if m:
                    result = _json.loads(m.group())
                    if result and result.get("id"):
                        return result
            except Exception:
                pass
            return {"id": scored[0]["id"], "name": scored[0]["name"]} if scored else None

        # ── 5. AI: сопоставить атрибуты src -> tgt ───────────────────────
        def _ai_match_attrs(src_list, tgt_list, src_platform, tgt_platform):
            src_items = [{"id": str(a.get("id") or a.get("attribute_id") or ""), "name": str(a.get("name") or "")} for a in src_list]
            tgt_items = [{"id": str(a.get("id") or ""), "name": str(a.get("name") or "")} for a in tgt_list]
            prompt = (
                f"Сопоставь атрибуты товаров между {src_platform} и {tgt_platform} по смыслу.\n\n"
                f"Атрибуты {src_platform}:\n" + _json.dumps(src_items, ensure_ascii=False) + "\n\n"
                f"Атрибуты {tgt_platform}:\n" + _json.dumps(tgt_items, ensure_ascii=False) + "\n\n"
                'Верни JSON массив пар: [{"oz_id": "...", "mm_id": "...", "confidence": 0.0-1.0}]\n'
                "Правила:\n"
                "- Сопоставляй только если атрибуты означают одно и то же\n"
                "- НЕ сопоставляй атрибуты которые лишь содержат общее слово но означают разное\n"
                "- Включай только пары с реальным смысловым соответствием (confidence >= 0.65)\n"
                "- Один атрибут источника — один атрибут цели (лучшее совпадение)"
            )
            try:
                resp = ai_client.chat.completions.create(
                    model="deepseek-chat",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1, max_tokens=4000,
                )
                raw = resp.choices[0].message.content.strip()
                m = _re.search(r'\[.*\]', raw, _re.DOTALL)
                if m:
                    try:
                        pairs = _json.loads(m.group())
                    except Exception:
                        raw_arr = m.group()
                        pairs = _json.loads(raw_arr[:raw_arr.rfind("}") + 1] + "]")
                    return {str(p["oz_id"]): p for p in pairs if p.get("confidence", 0) >= 0.65}
            except Exception:
                pass
            return {}

        # ── 6. Загружаем деревья категорий всех платформ ─────────────────
        _upd("fetch_categories", 5, "Загружаем категории всех платформ...")
        platform_cats = {}  # {platform: [{id, name}]}
        for platform, conn in platform_conns.items():
            try:
                cats = asyncio.run(_fetch_categories_for_platform(platform, conn))
                platform_cats[platform] = cats
                _upd("fetch_categories", 5, f"{platform}: {len(cats)} категорий")
            except NotImplementedError as e:
                _upd("fetch_categories", 5, f"Пропуск {platform}: {e}")
            except Exception as e:
                _upd("fetch_categories", 5, f"Ошибка загрузки категорий {platform}: {e}")

        active_platforms = list(platform_cats.keys())
        if len(active_platforms) < 2:
            _error(f"Удалось загрузить категории только для {active_platforms}, нужно минимум 2")
            return {}

        _upd("fetch_categories", 10, f"Категории загружены: {', '.join(f'{p}:{len(platform_cats[p])}' for p in active_platforms)}")

        # ── 7. Опционально: реальные значения атрибутов из товаров Ozon ──
        ozon_attr_values: dict = {}  # {cat_key: {attr_id: set(values)}}
        if "ozon" in platform_conns:
            try:
                _upd("fetch_ozon_products", 12, "Загружаем товары Ozon для value_mappings...")
                ozon_attr_values = asyncio.run(_fetch_ozon_products_by_category(platform_conns["ozon"]))
                _upd("fetch_ozon_products", 15, f"Ozon: реальные значения для {len(ozon_attr_values)} категорий")
            except Exception:
                pass  # value_mappings без реальных значений — не критично

        # ── 8. Снапшот ────────────────────────────────────────────────────
        snap = _read_json(_STAR_MAP_SNAPSHOT, {"edges": [], "categories_by_platform": {}})
        all_edges = list(snap.get("edges") or [])
        cats_by_platform = dict(snap.get("categories_by_platform") or {})

        # ── 9. Все пары платформ (A→B и B→A как инверсия) ────────────────
        # Строим только уникальные пары (A,B) где A < B по алфавиту,
        # потом инвертируем edges чтобы получить B→A бесплатно
        pairs = []
        for i, pa in enumerate(active_platforms):
            for pb in active_platforms[i+1:]:
                pairs.append((pa, pb))

        total_pairs = len(pairs)
        _upd("build", 15, f"Будет обработано {total_pairs} пар платформ: {', '.join(f'{a}-{b}' for a,b in pairs)}")

        for pair_idx, (platform_a, platform_b) in enumerate(pairs):
            conn_a = platform_conns[platform_a]
            conn_b = platform_conns[platform_b]
            cats_a = platform_cats[platform_a]
            cats_b = platform_cats[platform_b]
            pair_label = f"{platform_a}<->{platform_b}"
            base_pct = 15 + int(pair_idx / total_pairs * 72)

            try:
                adapter_a = get_adapter(platform_a, conn_a.api_key, conn_a.client_id, None, None)
                adapter_b = get_adapter(platform_b, conn_b.api_key, conn_b.client_id, None, None)
            except (ValueError, NotImplementedError) as e:
                _upd("build", base_pct, f"Пропуск {pair_label}: адаптер не поддерживается — {e}")
                continue

            cats_by_platform.setdefault(platform_a, [])
            cats_by_platform.setdefault(platform_b, [])

            total_cats = len(cats_a)
            processed = 0

            for cat_a in cats_a:
                processed += 1
                pct = base_pct + int((processed / total_cats) * (72 // total_pairs))
                cat_a_id = str(cat_a["id"])
                cat_a_name = cat_a.get("name", cat_a_id)

                _upd("build_pair", pct, f"[{pair_label}] [{processed}/{total_cats}] {cat_a_name[:60]}")

                # Схема атрибутов платформы A
                try:
                    schema_a = asyncio.run(adapter_a.get_category_schema(cat_a_id))
                    attrs_a = schema_a.get("attributes") or []
                except Exception:
                    continue
                if not attrs_a:
                    continue

                # AI: найти лучшую категорию в платформе B
                cat_b_match = _ai_find_best_category(cat_a_name, cats_b, platform_b)
                if not cat_b_match:
                    continue
                cat_b_id = str(cat_b_match["id"])
                cat_b_name = cat_b_match.get("name", cat_b_id)

                # Схема атрибутов платформы B
                try:
                    schema_b = asyncio.run(adapter_b.get_category_schema(cat_b_id))
                    attrs_b = schema_b.get("attributes") or []
                except Exception:
                    continue
                if not attrs_b:
                    continue

                # AI: сопоставляем атрибуты A→B чанками по 25
                attrs_b_by_id = {str(a.get("id") or ""): a for a in attrs_b}
                ai_matches = {}
                for chunk in [attrs_a[i:i+25] for i in range(0, len(attrs_a), 25)]:
                    ai_matches.update(_ai_match_attrs(chunk, attrs_b, platform_a, platform_b))

                # Реальные значения атрибутов если есть (пока только для Ozon)
                real_values_a = {}
                if platform_a == "ozon":
                    real_values_a = {k: list(v) for k, v in ozon_attr_values.get(cat_a_id, {}).items()}
                real_values_b = {}
                if platform_b == "ozon":
                    real_values_b = {k: list(v) for k, v in ozon_attr_values.get(cat_b_id, {}).items()}

                new_edges_ab = []
                new_edges_ba = []  # инверсия

                for attr_a in attrs_a:
                    attr_a_id = str(attr_a.get("id") or attr_a.get("attribute_id") or "")
                    attr_a_name = str(attr_a.get("name") or "")
                    if not attr_a_name:
                        continue

                    ai_pair = ai_matches.get(attr_a_id)
                    if not ai_pair:
                        continue
                    attr_b = attrs_b_by_id.get(str(ai_pair["mm_id"]))
                    if not attr_b:
                        continue

                    score = float(ai_pair.get("confidence", 0.8))
                    attr_b_id = str(attr_b.get("id") or "")
                    attr_b_name = str(attr_b.get("name") or "")

                    # Value mappings для словарных атрибутов
                    value_mappings_ab = []
                    tgt_dict = attr_b.get("dictionary_options") or []
                    src_vals = real_values_a.get(attr_a_id, [])
                    if tgt_dict and src_vals:
                        is_suggest = attr_b.get("isSuggest")
                        restrict = "" if is_suggest else "ВАЖНО: isSuggest=false — ТОЛЬКО значения из словаря цели."
                        vm_prompt = (
                            f'Атрибут {platform_a} "{attr_a_name}" -> {platform_b} "{attr_b_name}".\n\n'
                            f"Реальные значения источника: {src_vals[:30]}\n"
                            f'Словарь цели: {[{"name": o.get("name")} for o in tgt_dict[:60]]}\n'
                            f"{restrict}\n\n"
                            f'Верни JSON: [{{"oz_value": "...", "mm_name": "..."}}]\n'
                            f"Только точные смысловые совпадения."
                        )
                        try:
                            resp = ai_client.chat.completions.create(
                                model="deepseek-chat",
                                messages=[{"role": "user", "content": vm_prompt}],
                                temperature=0.1, max_tokens=1000,
                            )
                            raw = resp.choices[0].message.content.strip()
                            m = _re.search(r'\[.*?\]', raw, _re.DOTALL)
                            if m:
                                value_mappings_ab = _json.loads(m.group())
                        except Exception:
                            pass

                    edge_ab = {
                        "from_platform": platform_a,
                        "from_category_id": cat_a_id,
                        "from_attribute_id": attr_a_id,
                        "from_name": attr_a_name,
                        "to_platform": platform_b,
                        "to_category_id": cat_b_id,
                        "to_attribute_id": attr_b_id,
                        "to_name": attr_b_name,
                        "score": round(score, 3),
                        "method": "auto_schema",
                        "tgt_is_required": attr_b.get("is_required", False),
                        "tgt_type": attr_b.get("valueTypeCode") or attr_b.get("type") or "",
                        "tgt_is_suggest": attr_b.get("isSuggest"),
                        "value_mappings": value_mappings_ab,
                    }
                    new_edges_ab.append(edge_ab)

                    # Инверсия B→A (value_mappings инвертируем)
                    value_mappings_ba = [
                        {"oz_value": vm.get("mm_name", ""), "mm_name": vm.get("oz_value", "")}
                        for vm in value_mappings_ab
                    ]
                    src_vals_b = real_values_b.get(attr_b_id, [])
                    edge_ba = {
                        "from_platform": platform_b,
                        "from_category_id": cat_b_id,
                        "from_attribute_id": attr_b_id,
                        "from_name": attr_b_name,
                        "to_platform": platform_a,
                        "to_category_id": cat_a_id,
                        "to_attribute_id": attr_a_id,
                        "to_name": attr_a_name,
                        "score": round(score, 3),
                        "method": "auto_schema_inv",
                        "tgt_is_required": attr_a.get("is_required", False),
                        "tgt_type": attr_a.get("type") or "",
                        "tgt_is_suggest": None,
                        "value_mappings": value_mappings_ba,
                    }
                    new_edges_ba.append(edge_ba)

                # Убираем старые edges для этой пары категорий, добавляем новые
                all_edges = [e for e in all_edges
                             if not (
                                 (e.get("from_platform") == platform_a and e.get("to_platform") == platform_b
                                  and e.get("from_category_id") == cat_a_id and e.get("to_category_id") == cat_b_id)
                                 or
                                 (e.get("from_platform") == platform_b and e.get("to_platform") == platform_a
                                  and e.get("from_category_id") == cat_b_id and e.get("to_category_id") == cat_a_id)
                             )]
                all_edges.extend(new_edges_ab)
                all_edges.extend(new_edges_ba)

                # Обновляем категории
                sp_a = cats_by_platform.setdefault(platform_a, [])
                if not any(c.get("id") == cat_a_id for c in sp_a):
                    sp_a.append({"id": cat_a_id, "name": cat_a_name[:80]})
                sp_b = cats_by_platform.setdefault(platform_b, [])
                if not any(c.get("id") == cat_b_id for c in sp_b):
                    sp_b.append({"id": cat_b_id, "name": cat_b_name[:80]})

                # Сохраняем снапшот после каждой категории
                snap.update({
                    "edges": all_edges,
                    "categories_by_platform": cats_by_platform,
                    "edges_total": len(all_edges),
                    "generated_at_ts": int(_time.time()),
                    # legacy поля для совместимости с UI
                    "ozon_categories_list": cats_by_platform.get("ozon", []),
                    "megamarket_categories_list": cats_by_platform.get("megamarket", []),
                    "ozon_categories": len(cats_by_platform.get("ozon", [])),
                    "megamarket_categories": len(cats_by_platform.get("megamarket", [])),
                })
                _write_json(_STAR_MAP_SNAPSHOT, snap)

        # ── 10. Векторная база ────────────────────────────────────────────
        _upd("store_vectors", 90, f"Сохраняем {len(all_edges)} связей в векторную базу...")
        try:
            memory = get_agent_memory()
            memory.clear_namespace("attr_star_map_v1_edges")
            for e in all_edges:
                txt = f"{e['from_name']} -> {e['to_name']} score={e['score']}"
                memory.add_case(
                    namespace="attr_star_map_v1_edges", sku="",
                    category_id=str(e.get("from_category_id", "")),
                    problem_text=txt, action_summary="attribute_star_edge",
                    result_status="active", metadata=e,
                )
        except Exception:
            pass

        total_cats_all = sum(len(v) for v in cats_by_platform.values())
        pairs_desc = ", ".join(f"{a}<->{b}" for a, b in pairs)
        _done(
            f"Готово: {total_cats_all} категорий, {len(all_edges)} связей "
            f"({len(all_edges)//2} уникальных пар атрибутов). Платформы: {pairs_desc}"
        )
        return {"edges": len(all_edges), "platforms": active_platforms, "pairs": len(pairs)}

    except Exception as exc:
        import traceback
        _error(f"{str(exc)}: {traceback.format_exc()[-600:]}")
        raise

@celery_app.task(name="run_self_improve_incident_task")
def run_self_improve_incident_task(incident_id: str, ai_key: str = "") -> dict:
    """Celery task: запустить пайплайн самоисправления."""
    from backend.services.autonomous_improve import run_incident_pipeline
    return asyncio.run(run_incident_pipeline(incident_id=incident_id, ai_key=ai_key))



@celery_app.task(name="ai_generate_rich_task", bind=True)
def ai_generate_rich_task(self, product_id: str, ai_key: str) -> dict:
    """Celery task: генерирует rich content и landing для товара в фоне."""
    return asyncio.run(_async_generate_rich(self.request.id, product_id, ai_key))


async def _async_generate_rich(celery_task_id: str, product_id: str, ai_key: str) -> dict:
    import json as _json, re as _re
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy.future import select
    from backend.services.ai_service import get_client_and_model

    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        res = await db.execute(select(models.Product).where(models.Product.id == product_id))
        product = res.scalars().first()
        if not product:
            return {"ok": False, "error": "Product not found"}

        client, model = get_client_and_model(ai_key)
        # Use faster model for text generation (32b is too slow for rich content)
        # Override to 14b for rich/landing generation; vision still uses 72b
        if model == "qwen3:32b":
            from openai import AsyncOpenAI as _OAI
            client = _OAI(api_key="ollama", base_url="http://127.0.0.1:11434/v1")
            model = "qwen3:14b"
        attrs = product.attributes_data or {}
        name = product.name or ""
        images = product.images or []

        # Step 1: vision analysis
        vision_analysis = ""
        sorted_images = images[:]
        if images:
            try:
                import aiohttp, base64
                from openai import AsyncOpenAI
                vision_client = AsyncOpenAI(api_key="ollama", base_url="http://127.0.0.1:11434/v1")

                # Download up to 3 images as base64 (Ollama requires base64, not external URLs)
                async def _fetch_b64(url: str) -> str:
                    try:
                        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
                            async with s.get(url) as r:
                                data = await r.read()
                                ct = r.headers.get("Content-Type", "image/jpeg").split(";")[0]
                                return f"data:{ct};base64,{base64.b64encode(data).decode()}"
                    except Exception:
                        return ""

                import asyncio as _aio
                # Limit to 3 images to keep vision fast (72b is slow with many images)
                b64_imgs = await _aio.gather(*[_fetch_b64(u) for u in images[:3]])
                b64_imgs_valid = [(images[i], b) for i, b in enumerate(b64_imgs) if b]

                if b64_imgs_valid:
                    vision_content = [{"type": "text", "text": (
                        f"Product: {name}. You see {len(b64_imgs_valid)} photos numbered 0 to {len(b64_imgs_valid)-1}.\n"
                        "I need to pick the HERO image for a product landing page.\n"
                        "The hero image must be: a clean product photo showing the full device, ideally on neutral background.\n"
                        "AVOID: infographics, dimension diagrams, charts, text overlays, close-up details, accessories only.\n"
                        "PREFER: the product standing alone, full view, studio shot.\n"
                        "Reply with ONLY a single digit — the index of the best hero photo. No other text."
                    )}] + [{"type": "image_url", "image_url": {"url": b}} for _, b in b64_imgs_valid]

                    v_resp = await vision_client.chat.completions.create(
                        model="qwen2.5vl:72b",
                        messages=[{"role": "user", "content": vision_content}],
                        max_tokens=5, temperature=0.0
                    )
                    v_raw = _re.sub(r'<think>.*?</think>', '', (v_resp.choices[0].message.content or ""), flags=_re.DOTALL).strip()
                    import logging as _log
                    _log.warning(f"[vision] raw: {v_raw[:100]}")
                    # Extract just the first digit from response
                    digit_m = _re.search(r'\d', v_raw)
                    best_idx = int(digit_m.group(0)) if digit_m else 0
                    if best_idx >= len(b64_imgs_valid): best_idx = 0
                    hero_url = b64_imgs_valid[best_idx][0]
                    sorted_images = [u for u, _ in b64_imgs_valid]
                    if hero_url in sorted_images: sorted_images.remove(hero_url)
                    sorted_images = [hero_url] + sorted_images + [u for u in images if u not in sorted_images]
                    vision_analysis = (
                        f"\nАнализ фото: лучшее главное — {hero_url}\n"
                        f"Описание: {v_data.get('description', '')}"
                    )
            except Exception as ve:
                vision_analysis = f"\n(vision недоступен: {ve})"

        product_info = "Товар: " + name + "\nАтрибуты: " + _json.dumps(attrs, ensure_ascii=False)[:2000]
        product_info += vision_analysis
        images_note = ""
        if sorted_images:
            # Number each photo explicitly so model can assign them without repeating
            numbered = "\n".join(f"  фото[{i}]: {u}" for i, u in enumerate(sorted_images[:8]))
            images_note = (
                f"\nДоступные фото товара (каждое использовать только 1 раз):\n{numbered}"
                f"\nhero.image_url = фото[0] = {sorted_images[0]}"
            )

        RICH_SYSTEM = (
            "Создай rich content для товара — JSON-массив из 6-8 блоков.\n"
            "Типы: hero({title,subtitle,badge,image_url}), text({html}), "
            "features({title,items:[{icon,title,desc}]}), "
            "specs({title,rows:[[name,val]]}), gallery({images:[url,...]}), "
            "callout({style:info|success|warning,title,text}).\n"
            "ВАЖНО: используй фото из списка. Каждое фото используй ТОЛЬКО ОДИН РАЗ — не повторяй одинаковые URL в разных блоках.\n"
            "В hero — лучшее фото товара целиком. В gallery — все остальные фото.\n"
            "Верни ТОЛЬКО JSON-массив без пояснений."
        )
        LANDING_SYSTEM = (
            "Создай landing page JSON для товара.\n"
            'Структура: {"hero":{headline,subheadline,cta,badge,image_url},'
            '"usp":[{icon,title,desc}],"features":[{title,desc,highlight,image_url}],'
            '"specs_preview":[[k,v]],"faq":[{q,a}],'
            '"cta_section":{headline,subheadline,button,urgency}}.\n'
            "ВАЖНО: каждый image_url должен быть УНИКАЛЬНЫМ — не повторяй одно фото в hero и features.\n"
            "Распредели фото по порядку: hero=фото[0], features[0]=фото[1], features[1]=фото[2] и т.д.\n"
            "Верни ТОЛЬКО JSON без пояснений."
        )

        import asyncio as _asyncio
        rich_resp, landing_resp = await _asyncio.gather(
            client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": RICH_SYSTEM}, {"role": "user", "content": product_info + images_note}],
                max_tokens=2500, temperature=0.3,
            ),
            client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": LANDING_SYSTEM}, {"role": "user", "content": product_info + images_note}],
                max_tokens=2000, temperature=0.3,
            ),
        )

        def safe_parse(raw, fallback):
            import logging as _log2
            raw = _re.sub(r'<think>.*?</think>', '', raw, flags=_re.DOTALL).strip()
            # Strip markdown code fences
            raw = _re.sub(r'```(?:json)?\s*', '', raw).strip().rstrip('`').strip()
            _log2.warning(f"[safe_parse] first200: {raw[:200]!r}")
            # 1. Direct parse
            try: return _json.loads(raw)
            except Exception: pass
            # 2. Repair truncated array: cut after last complete object
            if raw.lstrip().startswith('['):
                for cut in [raw.rfind('},'), raw.rfind('}')]:
                    if cut > 0:
                        for suffix in (']', ',]'):
                            try: return _json.loads(raw[:cut+1] + ']')
                            except Exception: pass
            # 3. Repair truncated object: close open braces
            if raw.lstrip().startswith('{'):
                depth = sum(1 if c == '{' else -1 if c == '}' else 0 for c in raw)
                if depth > 0:
                    try: return _json.loads(raw + '}' * depth)
                    except Exception: pass
            # 4. Find any JSON in the text
            for pat in [r'\[.*?\]', r'\{.*?\}']:
                m = _re.search(pat, raw, _re.DOTALL)
                if m:
                    try: return _json.loads(m.group(0))
                    except Exception: pass
            _log2.warning(f"[safe_parse] FAILED")
            return fallback

        rich_parsed = safe_parse(rich_resp.choices[0].message.content or "[]", [])
        landing_parsed = safe_parse(landing_resp.choices[0].message.content or "{}", {})
        if isinstance(rich_parsed, dict): rich_parsed = list(rich_parsed.values())

        product.rich_content = rich_parsed
        product.landing_json = landing_parsed
        db.add(product)
        await db.commit()

    await engine.dispose()
    return {"ok": True, "rich_content": rich_parsed, "landing_json": landing_parsed}


if __name__ == "__main__":
    celery_app.start()
