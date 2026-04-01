import os
import json
import logging
import shutil
import re
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request, Form, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import text
from typing import List, Dict, Any, Optional
import uuid
import asyncio
import copy
import time
import redis
from datetime import timedelta
from fastapi import BackgroundTasks
from pydantic import BaseModel

from backend.services.auth import create_access_token, verify_password, get_current_user, ACCESS_TOKEN_EXPIRE_MINUTES

from backend.database import get_db, engine, Base, AsyncSessionLocal
from backend.celery_worker import (
    process_single_sku_task,
    redis_client,
    build_attribute_star_map_task,
    run_self_improve_incident_task,
)
from backend import models, schemas
from backend.services.completeness_engine import calculate_completeness
from backend.services.ai_service import extract_attributes, generate_description, select_ideal_card, generate_smart_seo, map_schema_to_marketplace, generate_promo_copy, generate_infographic_plan
from backend.services.attribute_star_map import (
    delete_manual_vector_override,
    get_attribute_star_categories,
    get_attribute_star_category_attributes,
    get_attribute_star_map_build_status,
    get_attribute_star_category_links,
    get_attribute_star_map_state,
    search_attribute_star_nodes,
    upsert_manual_vector_override,
    search_attribute_star_map,
)
from backend.services.knowledge_hub import (
    ingest_url_to_knowledge,
    list_knowledge,
    search_knowledge,
    bootstrap_qwen_commands_knowledge,
    bootstrap_project_knowledge,
    ingest_local_markdown_file,
)
from backend.services.team_orchestrator import (
    create_plan,
    get_plan,
    add_task,
    add_question,
    answer_question,
    request_admin_approval,
    list_approvals,
    decide_approval,
    get_approval,
    init_state_machine,
    advance_state_machine,
)
from backend.services.autonomous_improve import (
    get_incident as get_self_improve_incident,
    list_incidents as list_self_improve_incidents,
    record_failure_and_maybe_trigger,
)
from backend.services.github_automation import github_config_status
from backend.services.agent_task_console import (
    create_agent_task,
    get_agent_task,
    list_agent_tasks,
    run_agent_task,
    context7_is_connected,
    set_task_control_state,
    answer_agent_clarification,
    rollback_task,
)
try:
    from backend.services.agent_metrics import get_task_metrics, get_agent_dashboard, estimate_task_cost as _estimate_cost
    from backend.services.agent_conventions import run_conventions_update
    _AGENT_EXTRAS = True
except Exception:
    _AGENT_EXTRAS = False
    def get_task_metrics(tid): return {}
    def get_agent_dashboard(): return {}
    def _estimate_cost(tt, desc): return {}
    async def run_conventions_update(*a, **kw): return {}
from backend.services.agent_chat import (
    route_message_with_llm,
    compose_assistant_reply_with_llm,
    build_user_reply,
    build_smalltalk_reply,
    infer_contextual_task_command_with_llm,
    load_chat_state,
    save_chat_state,
)
from backend.services.helper_agents import (
    auto_spawn_helpers_for_task,
    create_helper_agent,
    get_helper_agent,
    list_helper_agents,
)

log = logging.getLogger("pim")

IMPORT_TASKS: Dict[str, Dict[str, Any]] = {}
_task_dispatcher_started = False
_task_launch_redis = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)


def _require_admin(user: models.User) -> None:
    if str(getattr(user, "role", "")).strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin approval required")

def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if raw:
        return [x.strip() for x in raw.split(",") if x.strip()]
    return [
        "https://pim.giper.fm.postobot.online",
        "http://localhost:5173",
        "http://localhost:4876",
    ]

VISUAL_AI_BASE = os.getenv("VISUAL_AI_SERVICE_URL", "http://127.0.0.1:8001").rstrip("/")

app = FastAPI(title="PIM V3 API")

@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/v1/system-status")
async def system_status():
    """Возвращает статус зависимостей: PostgreSQL, Redis, Celery."""
    import psycopg2
    from redis import Redis
    from celery import Celery
    from sqlalchemy import text
    from backend.database import engine
    from backend.celery_worker import celery_app, redis_client
    import time
    
    status = {
        "timestamp": time.time(),
        "postgresql": "unknown",
        "redis": "unknown",
        "celery": "unknown",
        "details": {}
    }
    
    # Проверка PostgreSQL
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            status["postgresql"] = "ok"
    except Exception as e:
        status["postgresql"] = "error"
        status["details"]["postgresql_error"] = str(e)
    
    # Проверка Redis
    try:
        if redis_client.ping():
            status["redis"] = "ok"
        else:
            status["redis"] = "error"
    except Exception as e:
        status["redis"] = "error"
        status["details"]["redis_error"] = str(e)
    
    # Проверка Celery
    try:
        inspect = celery_app.control.inspect()
        if inspect.active():
            status["celery"] = "ok"
        else:
            status["celery"] = "no_workers"
    except Exception as e:
        status["celery"] = "error"
        status["details"]["celery_error"] = str(e)
    
    return status


@app.get("/api/v1/migrations/status")
async def get_migration_status(current_user: models.User = Depends(get_current_user)):
    """Возвращает текущий статус миграций Alembic (текущая ревизия)."""
    import subprocess
    import os
    
    # Определяем путь к alembic.ini (предполагаем, что он в корне бэкенда)
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    alembic_ini_path = os.path.join(backend_dir, "alembic.ini")
    
    try:
        # Выполняем команду alembic current для получения текущей ревизии
        result = subprocess.run(
            ["alembic", "-c", alembic_ini_path, "current", "--verbose"],
            capture_output=True,
            text=True,
            cwd=backend_dir,
            timeout=10
        )
        if result.returncode == 0:
            output = result.stdout.strip()
            if output:
                return {
                    "status": "ok",
                    "current_revision": output.split(" ")[0] if " " in output else output,
                    "details": output
                }
            else:
                return {"status": "ok", "current_revision": "None", "details": "No migrations applied."}
        else:
            error_msg = result.stderr.strip() or result.stdout.strip()
            return {
                "status": "error",
                "error": f"Alembic command failed: {error_msg}"
            }
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": "Alembic command timed out."}
    except Exception as e:
        return {"status": "error", "error": str(e)}
    """Проверка работоспособности backend."""
    return {"status": "ok", "service": "pimv3-backend", "timestamp": time.time()}

@app.get("/api/v1/version")
async def get_version():
    return {"version": "3.0"}

@app.get("/api/v1/uptime")
async def get_uptime():
    """Возвращает время работы сервера в секундах с момента запуска."""
    import time
    from backend.services.telemetry import get_server_start_time
    start_time = get_server_start_time()
    if start_time is None:
        return {"uptime_seconds": 0, "message": "Start time not recorded"}
    uptime = time.time() - start_time
    return {"uptime_seconds": uptime, "uptime_human": str(timedelta(seconds=int(uptime)))}
    """Возвращает текущую версию бэкенда для мониторинга."""
    return {"version": "1.0.0", "service": "pimv3-backend", "timestamp": time.time()}

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _get_deepseek_key_value() -> str:
    try:
        async with AsyncSessionLocal() as db:
            setting_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == "deepseek_api_key"))
            setting = setting_res.scalars().first()
            return setting.value if setting and setting.value else ""
    except Exception:
        return ""


async def _run_task_job(task_id: str) -> None:
    lock_key = f"agent_task:launcher:{task_id}"
    try:
        ai_key = await _get_deepseek_key_value()
        await run_agent_task(task_id, ai_key=ai_key)
    except Exception as e:
        now = int(time.time())
        _task_launch_redis.hset(
            f"agent_task:{task_id}",
            mapping={
                "status": "failed",
                "stage": "failed_runtime",
                "updated_at_ts": str(now),
                "result": json.dumps({"error": str(e)}, ensure_ascii=False),
            },
        )
        _task_launch_redis.rpush(f"agent_task:{task_id}:logs", f"[{time.strftime('%H:%M:%S')}] Runtime failure: {e}")
        _task_launch_redis.ltrim(f"agent_task:{task_id}:logs", -500, -1)
    finally:
        try:
            _task_launch_redis.delete(lock_key)
        except Exception:
            pass


def _queue_task_for_dispatch(task_id: str) -> None:
    now = int(time.time())
    _task_launch_redis.hset(
        f"agent_task:{task_id}",
        mapping={
            "status": "queued",
            "stage": "queued",
            "updated_at_ts": str(now),
        },
    )
    _task_launch_redis.rpush(f"agent_task:{task_id}:logs", f"[{time.strftime('%H:%M:%S')}] Queued for autonomous execution")
    _task_launch_redis.ltrim(f"agent_task:{task_id}:logs", -500, -1)
    _task_launch_redis.delete(f"agent_task:launcher:{task_id}")


async def _agent_task_dispatcher_loop() -> None:
    while True:
        try:
            got = list_agent_tasks(limit=300)
            tasks = got.get("tasks", []) if isinstance(got, dict) else []
            for t in tasks:
                if not isinstance(t, dict):
                    continue
                task_id = str(t.get("task_id") or "")
                status = str(t.get("status") or "").strip().lower()
                if not task_id or status != "queued":
                    continue
                lock_key = f"agent_task:launcher:{task_id}"
                claimed = _task_launch_redis.set(lock_key, "1", nx=True, ex=60 * 30)
                if not claimed:
                    continue
                asyncio.create_task(_run_task_job(task_id))
        except Exception:
            pass
        await asyncio.sleep(2.0)


@app.on_event("startup")
async def _startup_agent_task_dispatcher() -> None:
    global _task_dispatcher_started
    if _task_dispatcher_started:
        return
    _task_dispatcher_started = True
    asyncio.create_task(_agent_task_dispatcher_loop())


@app.on_event("startup")
async def _verify_postgres_schema() -> None:
    """Ловит типичный сбой: модель с warehouse_id, а миграция не применена — тогда падают /attributes и /connections."""
    db_url = os.getenv("DATABASE_URL", "").lower()
    if "postgresql" not in db_url:
        return
    try:
        async with engine.connect() as conn:
            r = await conn.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'marketplace_connections' "
                    "AND column_name = 'warehouse_id' LIMIT 1"
                )
            )
            if r.fetchone() is None:
                log.error(
                    "DB schema outdated: column public.marketplace_connections.warehouse_id is missing. "
                    "From the backend directory run: alembic upgrade head"
                )
    except Exception as exc:
        log.warning("Could not verify PostgreSQL schema: %s", exc)


from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    log_path = os.getenv("VALIDATION_ERROR_LOG_PATH", "").strip()
    if log_path:
        try:
            with open(log_path, "a", encoding="utf-8") as f:
                f.write("URL: " + str(request.url) + "\nEXC: " + str(exc.errors()) + "\n\n")
        except OSError as e:
            log.warning("validation log write failed: %s", e)
    else:
        log.warning("validation 422 url=%s errors=%s", request.url, exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

os.makedirs("uploads", exist_ok=True)
app.mount("/api/v1/uploads", StaticFiles(directory="uploads"), name="uploads")

@app.post("/api/v1/upload")
async def upload_file(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user)):
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"{uuid.uuid4()}.{ext}"
    file_path = os.path.join("uploads", filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"url": f"/api/v1/uploads/{filename}"}

async def get_deepseek_key(db: AsyncSession = Depends(get_db)) -> str:
    res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id.in_(["deepseek_api_key", "ai_provider"])))
    settings = {s.id: s.value for s in res.scalars().all()}
    provider = settings.get("ai_provider", "deepseek")
    api_key = settings.get("deepseek_api_key", "")
    
    if provider == "deepseek" and not api_key:
        raise HTTPException(status_code=400, detail="DeepSeek API Key не настроен. Зайдите в Настройки ИИ.")
        
    return json.dumps({
        "provider": provider,
        "api_key": api_key
    })

@app.get("/api/v1/settings", response_model=List[schemas.SystemSettingResponse])
async def get_settings(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.SystemSettings))
    return result.scalars().all()

@app.post("/api/v1/settings/{setting_id}", response_model=schemas.SystemSettingResponse)
async def update_setting(setting_id: str, payload: schemas.SystemSettingUpdate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == setting_id))
    setting = result.scalars().first()
    if not setting:
        setting = models.SystemSettings(id=setting_id, value=payload.value, description="AI API Key")
        db.add(setting)
    else:
        setting.value = payload.value
    await db.commit()
    await db.refresh(setting)
    return setting

@app.get("/api/v1/categories", response_model=List[schemas.Category])
async def get_categories(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.Category))
    return result.scalars().all()

@app.post("/api/v1/categories", response_model=schemas.Category)
async def create_category(cat: schemas.CategoryCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_cat = models.Category(**cat.model_dump())
    db.add(db_cat)
    await db.commit()
    await db.refresh(db_cat)
    return db_cat

@app.get("/api/v1/attributes", response_model=List[schemas.Attribute])
async def get_attributes(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.Attribute))
    return result.scalars().all()

@app.post("/api/v1/attributes", response_model=schemas.Attribute)
async def create_attribute(attr: schemas.AttributeCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_attr = models.Attribute(**attr.model_dump())
    db.add(db_attr)
    await db.commit()
    await db.refresh(db_attr)
    return db_attr

from sqlalchemy.orm import selectinload

@app.get("/api/v1/products", response_model=list[schemas.Product])
async def get_products(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.Product).options(selectinload(models.Product.category)))
    products = result.scalars().all()
    return products

@app.post("/api/v1/products", response_model=schemas.Product)
async def create_product(prod: schemas.ProductCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    req_attrs_res = await db.execute(select(models.Attribute).where(
        (models.Attribute.is_required == True) &
        ((models.Attribute.category_id == None) | (models.Attribute.category_id == prod.category_id))
    ))
    req_attrs = req_attrs_res.scalars().all()
    
    score = calculate_completeness(prod.attributes_data, req_attrs)
    
    db_prod = models.Product(**prod.model_dump(), completeness_score=score)
    db.add(db_prod)
    await db.commit()
    await db.refresh(db_prod)
    return db_prod

@app.patch("/api/v1/products/{product_id}", response_model=schemas.Product)
async def update_product(product_id: uuid.UUID, prod: schemas.ProductUpdate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.Product).where(models.Product.id == product_id))
    db_prod = result.scalars().first()
    if not db_prod:
        raise HTTPException(status_code=404, detail="Product not found")

    update_data = prod.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_prod, key, value)

    req_attrs_res = await db.execute(select(models.Attribute).where(
        (models.Attribute.is_required == True) &
        ((models.Attribute.category_id == None) | (models.Attribute.category_id == db_prod.category_id))
    ))
    req_attrs = req_attrs_res.scalars().all()
    
    db_prod.completeness_score = calculate_completeness(db_prod.attributes_data, req_attrs)

    db.add(db_prod)
    await db.commit()
    await db.refresh(db_prod)
    return db_prod

@app.get("/api/v1/products/{product_id}", response_model=schemas.Product)
async def get_product(product_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.Product).where(models.Product.id == product_id))
    db_prod = result.scalars().first()
    if not db_prod:
        raise HTTPException(status_code=404, detail="Product not found")
    return db_prod

@app.delete("/api/v1/products/{product_id}")
async def delete_product(product_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.Product).where(models.Product.id == product_id))
    db_prod = result.scalars().first()
    if not db_prod:
        raise HTTPException(status_code=404, detail="Product not found")
    await db.delete(db_prod)
    await db.commit()
    return {"status": "ok", "deleted_id": product_id}

@app.get("/api/v1/connections", response_model=List[schemas.MarketplaceConnection])
async def get_connections(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.MarketplaceConnection))
    return result.scalars().all()

@app.post("/api/v1/connections", response_model=schemas.MarketplaceConnection)


@app.post("/api/v1/connections/test")
async def test_connection(conn: schemas.MarketplaceConnectionCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """Тестирует подключение к маркетплейсу с предоставленными данными интеграции."""
    from backend.services.adapters import get_adapter
    try:
        adapter = get_adapter(conn.type, conn.api_key, conn.client_id, conn.store_id, getattr(conn, "warehouse_id", None))
        # Вызываем простой метод для проверки подключения, например, получение списка категорий или статуса
        test_result = await adapter.test_connection()
        return {"status": "success", "message": "Подключение успешно", "details": test_result}
    except Exception as e:
        log.error(f"Connection test failed for {conn.type}: {e}")
        raise HTTPException(status_code=400, detail=f"Ошибка подключения: {str(e)}")
async def create_connection(conn: schemas.MarketplaceConnectionCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_conn = models.MarketplaceConnection(**conn.model_dump())
    db.add(db_conn)
    await db.commit()
    await db.refresh(db_conn)
    return db_conn

@app.post("/api/v1/ai/extract")
async def ai_extract(req: schemas.AIExtractRequest, db: AsyncSession = Depends(get_db), ai_key: str = Depends(get_deepseek_key), current_user: models.User = Depends(get_current_user)):
    attrs_res = await db.execute(select(models.Attribute))
    active_attrs = attrs_res.scalars().all()
    extracted = await extract_attributes(req.text, active_attrs, ai_key)
    return {"extracted_data": extracted}

@app.post("/api/v1/ai/generate-promo")
async def generate_product_promo(
    req: schemas.AIGenerateRequest,
    db: AsyncSession = Depends(get_db),
    ai_key: str = Depends(get_deepseek_key),
    current_user: models.User = Depends(get_current_user)
):
    product_res = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
    product = product_res.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    result = await generate_promo_copy(product.attributes_data or {}, ai_key)
    return {"promo_copy": result}

@app.post("/api/v1/ai/generate-infographic-plan")
async def ai_generate_infographic_plan(
    req: schemas.AIGenerateRequest,
    db: AsyncSession = Depends(get_db),
    ai_key: str = Depends(get_deepseek_key),
    current_user: models.User = Depends(get_current_user)
):
    product_res = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
    product = product_res.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    slides = await generate_infographic_plan(product.attributes_data or {}, product.name, ai_key)
    return {"slides": slides}

@app.post("/api/v1/ai/generate")
async def generate_product_description(req: schemas.AIGenerateRequest, db: AsyncSession = Depends(get_db), ai_key: str = Depends(get_deepseek_key), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
    db_prod = result.scalars().first()
    if not db_prod:
        raise HTTPException(status_code=404, detail="Product not found")
        
    html_desc = await generate_description(db_prod.attributes_data, ai_key)
    
    db_prod.description_html = html_desc
    db.add(db_prod)
    await db.commit()
    
    return {"description_html": html_desc}

@app.post("/api/v1/ai/generate-bulk")
async def ai_generate_bulk(req: schemas.BulkGenerateRequest, db: AsyncSession = Depends(get_db), ai_key: str = Depends(get_deepseek_key), current_user: models.User = Depends(get_current_user)):
    task_id = str(uuid.uuid4())
    redis_client.set(f"task:{task_id}:status", "running")
    redis_client.set(f"task:{task_id}:total", len(req.product_ids))
    redis_client.set(f"task:{task_id}:processed", 0)
    redis_client.set(f"task:{task_id}:success", 0)
    redis_client.set(f"task:{task_id}:failed", 0)
    redis_client.set(f"task:{task_id}:type", "ai-generation")
    redis_client.set(f"task:{task_id}:current_sku", "Инициализация AI...")
    
    for product_id in req.product_ids:
        celery_app.send_task("backend.celery_worker.process_single_ai_generation_task", args=[str(product_id), ai_key, task_id])
        
    return {"task_id": task_id}

@app.get("/api/v1/media/proxy/{encoded_url}")
async def proxy_image(encoded_url: str):
    import base64
    import httpx
    from fastapi import Response
    from backend.services.url_safety import is_safe_proxy_target

    try:
        url = base64.urlsafe_b64decode(encoded_url.encode()).decode()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL encoding")

    if not is_safe_proxy_target(url):
        log.warning("media proxy rejected URL (not allowlisted)")
        raise HTTPException(status_code=403, detail="URL not allowed")

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36"}
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, max_redirects=8) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Image proxy failed")
            final = str(resp.url)
            if not is_safe_proxy_target(final):
                log.warning("media proxy rejected redirect target")
                raise HTTPException(status_code=403, detail="Redirect target not allowed")
            return Response(content=resp.content, media_type=resp.headers.get("content-type", "image/jpeg"))
    except HTTPException:
        raise
    except Exception as e:
        log.warning("media proxy error: %s", e)
        raise HTTPException(status_code=404, detail="Image proxy failed")

@app.post("/api/v1/visual/remove-background")
async def proxy_remove_background(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user)):
    import httpx
    async with httpx.AsyncClient() as client:
        files = {"file": (file.filename, await file.read(), file.content_type)}
        try:
            resp = await client.post(f"{VISUAL_AI_BASE}/api/v1/visual/remove-background", files=files, timeout=300.0)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return Response(content=resp.content, media_type=resp.headers.get("Content-Type", "image/png"))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Visual AI GPU Service is unavailable: {str(e)}")

@app.post("/api/v1/visual/inpaint-masked")
async def proxy_inpaint_masked(
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
    prompt: str = Form(...),
    current_user: models.User = Depends(get_current_user)
):
    import httpx
    async with httpx.AsyncClient(timeout=600.0) as client:
        files = {
            'file': (file.filename, await file.read(), file.content_type),
            'mask': (mask.filename, await mask.read(), mask.content_type)
        }
        data = {'prompt': prompt}
        try:
            resp = await client.post(f"{VISUAL_AI_BASE}/api/v1/visual/inpaint-masked", files=files, data=data)
            if resp.status_code != 200:
                err_detail = resp.json().get("detail", resp.text) if "application/json" in resp.headers.get("content-type", "") else resp.text
                raise HTTPException(status_code=resp.status_code, detail=f"Visual Inpaint Failed: {err_detail}")
            return Response(content=resp.content, media_type=resp.headers.get("content-type"))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Visual UI Exception: {str(e)}")

@app.post("/api/v1/visual/generate-element")
async def proxy_generate_element(
    prompt: str = Form(...),
    is_icon: bool = Form(False),
    model_id: str = Form("gemini-2.5-flash-image"),
    current_user: models.User = Depends(get_current_user)
):
    import httpx
    async with httpx.AsyncClient() as client:
        data = {"prompt": prompt, "model_id": model_id, "is_icon": str(is_icon).lower()}
        try:
            resp = await client.post(f"{VISUAL_AI_BASE}/api/v1/visual/generate-element", data=data, timeout=600.0)
            if resp.status_code != 200:
                err_detail = resp.json().get("detail", resp.text) if "application/json" in resp.headers.get("content-type", "") else resp.text
                raise HTTPException(status_code=resp.status_code, detail=err_detail)
            return Response(content=resp.content, media_type="image/png")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/visual/models")
async def get_visual_models(current_user: models.User = Depends(get_current_user)):
    import httpx
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{VISUAL_AI_BASE}/api/v1/visual/models")
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Visual AI GPU Service is unavailable: {str(e)}")

@app.post("/api/v1/visual/generate-background")
async def proxy_generate_background(
    file: UploadFile = File(None),
    prompt: str = Form("a professional commercial product photography shot, cinematic studio lighting, highly detailed"),
    model_id: str = Form("5c232a9e-9061-4777-980a-ddc8e65647c6"),
    product_id: str = Form(None),
    db: AsyncSession = Depends(get_db),
    ai_key: str = Depends(get_deepseek_key),
    current_user: models.User = Depends(get_current_user)
):
    from backend.services.ai_service import generate_sdxl_prompt
    
    if product_id:
        prod_res = await db.execute(select(models.Product).where(models.Product.id == product_id))
        product = prod_res.scalars().first()
        if product:
            print(f"Original user prompt: {prompt}")
            prompt = await generate_sdxl_prompt(product.attributes_data, product.name, prompt, ai_key)
            print(f"DeepSeek optimized prompt: {prompt}")

    import httpx
    async with httpx.AsyncClient() as client:
        files = {"file": (file.filename, await file.read(), file.content_type)} if file else None
        data = {"prompt": prompt, "model_id": model_id, "product_id": product_id}
        try:
            # Increased timeout to 600s to accommodate prolonged sequential VRAM layer offloading
            if files:
                resp = await client.post(f"{VISUAL_AI_BASE}/api/v1/visual/generate-background", files=files, data=data, timeout=600.0)
            else:
                resp = await client.post(f"{VISUAL_AI_BASE}/api/v1/visual/generate-background", data=data, timeout=600.0)
            if resp.status_code != 200:
                err_detail = resp.json().get("detail", resp.text) if "application/json" in resp.headers.get("content-type", "") else resp.text
                raise HTTPException(status_code=resp.status_code, detail=err_detail)
            return Response(content=resp.content, media_type=resp.headers.get("content-type"))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Visual AI HTTPX Error: {str(e)}")

@app.post("/api/v1/chat")
async def ai_chat(req: schemas.ChatRequest, db: AsyncSession = Depends(get_db), ai_key: str = Depends(get_deepseek_key), current_user: models.User = Depends(get_current_user)):
    from backend.services.ai_service import chat_with_copilot
    
    setting_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == 'bot_instructions'))
    setting = setting_res.scalars().first()
    extra_instructions = setting.value if setting else ""
    
    reply = await chat_with_copilot([m.model_dump() for m in req.messages], ai_key, req.current_path, extra_instructions)
    return {"reply": reply}

@app.get("/api/v1/stats")
async def get_stats(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    from sqlalchemy import func
    total_products = (await db.execute(select(func.count(models.Product.id)))).scalar() or 0
    total_categories = (await db.execute(select(func.count(models.Category.id)))).scalar() or 0
    total_attributes = (await db.execute(select(func.count(models.Attribute.id)))).scalar() or 0
    total_connections = (await db.execute(select(func.count(models.MarketplaceConnection.id)))).scalar() or 0
    
    avg_score = (await db.execute(select(func.avg(models.Product.completeness_score)))).scalar() or 0.0
    avg_score = round(avg_score)
    
    return {
        "total_products": total_products,
        "total_categories": total_categories,
        "total_attributes": total_attributes,
        "total_connections": total_connections,
        "average_completeness": avg_score
    }

# === IMPORT ENDPOINT ===
@app.post("/api/v1/import/product", response_model=schemas.Product)
async def import_marketplace_product(req: schemas.ImportRequest, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == req.connection_id))
    db_conn = conn_res.scalars().first()
    if not db_conn: raise HTTPException(404, "Интеграция не найдена")
    
    from backend.services.adapters import get_adapter
    adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
    pulled_data = await adapter.pull_product(req.query)
    
    if not pulled_data:
        raise HTTPException(404, "Товар не найден на маркетплейсе по этому артикулу/запросу.")
        
    images = []
    if db_conn.type == "ozon":
        images = [pulled_data.get("primary_image")] + pulled_data.get("images", [])
        images = [img for img in images if img]
    elif db_conn.type == "wildberries":
        photos = pulled_data.get("photos", [])
        images = [p.get("big") or p.get("tm") for p in photos]
        images = [img for img in images if img]
        
    # Check if SKU exists
    existing_res = await db.execute(select(models.Product).where(models.Product.sku == req.query))
    db_prod = existing_res.scalars().first()
        
    # Generate a name
    name = pulled_data.get("name", pulled_data.get("title", f"Imported {req.query}"))
    
    # Fetch active attributes
    attrs_res = await db.execute(select(models.Attribute))
    active_attrs = attrs_res.scalars().all()
    
    # Fetch AI Key
    from backend.services.ai_service import categorize_and_extract
    setting_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == 'deepseek_api_key'))
    setting = setting_res.scalars().first()
    if not setting or not setting.value:
        raise HTTPException(400, "DeepSeek API Key is not configured. Please configure it in System Settings.")
    ai_key = setting.value

    # Run AI categorizer + extractor
    mp_context = db_conn.name if getattr(db_conn, "name", None) else db_conn.type
    ai_result = await categorize_and_extract(json.dumps(pulled_data, ensure_ascii=False), active_attrs, ai_key, mp_context)
    
    categories_path = ai_result.get("categories", [])
    if not categories_path:
        categories_path = ["Общие (Разобрать)"]
        
    parent_id = None
    for cat_name in categories_path:
        # Find existing category with same name and parent_id
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
        
    from backend.services.completeness_engine import calculate_completeness
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
        db_prod.images = images
        db_prod.completeness_score = score
    else:
        db_prod = models.Product(
            sku=req.query,
            name=name,
            category_id=parent_id,
            attributes_data=new_attrs,
            images=images,
            completeness_score=score
        )
    db.add(db_prod)
    await db.commit()
    await db.refresh(db_prod)
    return db_prod

@app.get("/api/v1/import/tasks/{task_id}")
async def get_import_task(task_id: str, current_user: models.User = Depends(get_current_user)):
    from backend.services.telemetry import get_task_events
    total_str = redis_client.get(f"task:{task_id}:total")
    if not total_str:
        raise HTTPException(404, "Task not found")
        
    total = int(total_str)
    processed = int(redis_client.get(f"task:{task_id}:processed") or 0)
    status = redis_client.get(f"task:{task_id}:status") or "processing"
    
    if processed >= total and status != "failed":
        status = "completed"
        redis_client.set(f"task:{task_id}:status", "completed")
        # Delete keys automatically after a while if needed, or keep for history
        
    return {
        "status": status,
        "total": total,
        "processed": processed,
        "success": int(redis_client.get(f"task:{task_id}:success") or 0),
        "failed": int(redis_client.get(f"task:{task_id}:failed") or 0),
        "current_sku": redis_client.get(f"task:{task_id}:current_sku") or "",
        "error": redis_client.get(f"task:{task_id}:error") or "",
        "logs": redis_client.lrange(f"task:{task_id}:logs", -200, -1) or [],
        "events": get_task_events(task_id, tail=120),
    }


@app.get("/api/v1/import/tasks/{task_id}/kpi")
async def get_import_task_kpi(task_id: str, current_user: models.User = Depends(get_current_user)):
    from backend.services.telemetry import get_task_events
    from backend.services.kpi_guard import compute_task_kpis, should_auto_stop_self_rewrite, canary_gate_ok
    events = get_task_events(task_id, tail=400)
    kpis = compute_task_kpis(events)
    guard = should_auto_stop_self_rewrite(kpis)
    return {"task_id": task_id, "kpis": kpis, "guard": guard}


@app.post("/api/v1/knowledge/ingest/url")
async def knowledge_ingest_url(
    req: schemas.KnowledgeIngestUrlRequest,
    current_user: models.User = Depends(get_current_user),
):
    return await ingest_url_to_knowledge(namespace=req.namespace, url=req.url, title=req.title)


@app.post("/api/v1/knowledge/search")
async def knowledge_search(
    req: schemas.KnowledgeSearchRequest,
    current_user: models.User = Depends(get_current_user),
):
    return search_knowledge(req.namespace, req.query, limit=req.limit)


@app.get("/api/v1/knowledge/sources")
async def knowledge_sources(
    namespace: str,
    limit: int = 200,
    current_user: models.User = Depends(get_current_user),
):
    return list_knowledge(namespace, limit=limit)


@app.post("/api/v1/knowledge/bootstrap/qwen-commands")
async def knowledge_bootstrap_qwen(
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    return await bootstrap_qwen_commands_knowledge()


@app.post("/api/v1/knowledge/bootstrap/core-docs")
async def knowledge_bootstrap_core_docs(
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    files = [
        "/mnt/data/Pimv3/backend/MEGAMARKET_ASSORTMENT_API.md",
        "/mnt/data/Pimv3/backend/MEGAMARKET_PIPELINE_RUNBOOK.md",
    ]
    out = []
    for p in files:
        out.append(ingest_local_markdown_file(namespace="docs:megamarket-api", path=p, title="Megamarket API Docs"))
    return {"ok": True, "items": out}


@app.post("/api/v1/knowledge/bootstrap/project-core")
async def knowledge_bootstrap_project_core(
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    return bootstrap_project_knowledge(namespace="docs:project-core")


@app.post("/api/v1/agent-tasks/create")
async def agent_task_create(
    req: schemas.AgentTaskCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    created = create_agent_task(
        task_type=req.task_type,
        title=req.title,
        description=req.description,
        requested_by=current_user.email,
        namespace=req.namespace,
        docs_urls=req.docs_urls,
        local_paths=req.local_paths,
        validation_query=req.validation_query,
        web_query=req.web_query,
        max_web_results=req.max_web_results,
    )
    if req.auto_run and created.get("ok"):
        task_id = (((created or {}).get("task") or {}).get("task_id") or "")
        if task_id:
            _queue_task_for_dispatch(task_id)
    return created


@app.get("/api/v1/agent-tasks")
async def agent_tasks_list(
    limit: int = 100,
    current_user: models.User = Depends(get_current_user),
):
    return list_agent_tasks(limit=limit)


@app.get("/api/v1/agent-tasks/{task_id}")
async def agent_task_get(
    task_id: str,
    current_user: models.User = Depends(get_current_user),
):
    return get_agent_task(task_id)


@app.get("/api/v1/agent-tasks/context7-connected")
async def agent_context7_connected(current_user: models.User = Depends(get_current_user)):
    """Возвращает статус подключения к MCP-серверу context7 для документации."""
    return {"connected": context7_is_connected()}


@app.get("/api/v1/agent-tasks/{task_id}/metrics")
async def agent_task_metrics(
    task_id: str,
    current_user: models.User = Depends(get_current_user),
):
    """Возвращает детальные метрики выполнения агентской задачи, включая KPI, логи и события."""
    from backend.services.telemetry import get_task_events
    from backend.services.kpi_guard import compute_task_kpis
    
    # Получить базовую информацию о задаче
    task_info = get_agent_task(task_id)
    if not task_info or "task" not in task_info:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Получить события и вычислить KPI
    events = get_task_events(task_id, tail=500)
    kpis = compute_task_kpis(events)
    
    # Получить логи из Redis
    logs = _task_launch_redis.lrange(f"agent_task:{task_id}:logs", -200, -1) or []
    
    return {
        "task_id": task_id,
        "status": task_info["task"].get("status", "unknown"),
        "title": task_info["task"].get("title", ""),
        "kpis": kpis,
        "events_count": len(events),
        "recent_events": events[-10:],  # Последние 10 событий
        "logs": logs,
        "redis_info": {
            "queue_length": _task_launch_redis.llen(f"agent_task:{task_id}:logs"),
            "lock_status": _task_launch_redis.get(f"agent_task:launcher:{task_id}")
        }
    }


@app.post("/api/v1/agent-tasks/{task_id}/run")
async def agent_task_run(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _queue_task_for_dispatch(task_id)
    return {"ok": True, "task_id": task_id, "status": "queued"}


@app.post("/api/v1/agent-tasks/{task_id}/pause")
async def agent_task_pause(
    task_id: str,
    current_user: models.User = Depends(get_current_user),
):
    return set_task_control_state(task_id, "paused")


@app.post("/api/v1/agent-tasks/{task_id}/resume")
async def agent_task_resume(
    task_id: str,
    current_user: models.User = Depends(get_current_user),
):
    return set_task_control_state(task_id, "running")


@app.post("/api/v1/agent/tasks/{task_id}/clarify")
async def agent_task_clarify(
    task_id: str,
    req: dict,
    current_user: models.User = Depends(get_current_user),
):
    """Ответить на вопрос агента который ждёт уточнения (ask_user)."""
    answer = str((req or {}).get("answer") or "").strip()
    if not answer:
        raise HTTPException(status_code=400, detail="answer is required")
    return answer_agent_clarification(task_id, answer)


@app.post("/api/v1/agent/tasks/{task_id}/rollback")
async def agent_task_rollback(
    task_id: str,
    current_user: models.User = Depends(get_current_user),
):
    """Откатить изменения задачи через git revert."""
    return rollback_task(task_id)



@app.get("/api/v1/agent/tasks/{task_id}/diff")
async def agent_task_diff(task_id: str):
    """Показать git diff изменений задачи."""
    import subprocess as _sp
    task = get_agent_task(task_id)
    if not task.get("ok"):
        raise HTTPException(status_code=404, detail="task not found")
    t = task.get("task", {})
    commit_hash = str(t.get("commit_hash") or "").strip()
    if not commit_hash:
        return {"ok": False, "error": "no commit hash yet"}
    try:
        result = _sp.run(
            ["git", "show", "--stat", commit_hash],
            cwd="/mnt/data/Pimv3", capture_output=True, text=True, timeout=15
        )
        diff = _sp.run(
            ["git", "show", commit_hash],
            cwd="/mnt/data/Pimv3", capture_output=True, text=True, timeout=30
        )
        return {"ok": True, "stat": result.stdout, "diff": diff.stdout[:50000]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/v1/agent/tasks/{task_id}/explain")
async def agent_task_explain(task_id: str):
    """Объяснить изменения задачи на русском через LLM."""
    import httpx as _hx
    task = get_agent_task(task_id)
    if not task.get("ok"):
        raise HTTPException(status_code=404, detail="task not found")
    t = task.get("task", {})
    ai_key = str(os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY") or "")
    if not ai_key:
        return {"ok": False, "error": "no ai key"}
    result_summary = str(t.get("result", ""))[:2000]
    prompt = (
        f"Задача: {t.get('title')}\n"
        f"Тип: {t.get('task_type')}\n"
        f"Результат: {result_summary}\n\n"
        "Объясни на русском языке, что было сделано, какие файлы изменены и зачем. "
        "Ответ в 3-5 предложениях."
    )
    try:
        async with _hx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.deepseek.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {ai_key}"},
                json={"model": "deepseek-chat", "messages": [{"role": "user", "content": prompt}], "max_tokens": 400},
            )
            data = resp.json()
            explanation = data["choices"][0]["message"]["content"]
            return {"ok": True, "explanation": explanation}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/v1/agent/metrics")
async def agent_metrics_dashboard():
    """Dashboard агента: сводная статистика."""
    return get_agent_dashboard()


@app.get("/api/v1/agent/metrics/{task_id}")
async def agent_task_metrics(task_id: str):
    """Метрики конкретной задачи."""
    return get_task_metrics(task_id)


@app.post("/api/v1/agent/estimate")
async def agent_estimate_cost(body: dict):
    """Оценить стоимость задачи до запуска."""
    task_type = str(body.get("task_type", "backend"))
    description = str(body.get("description", ""))
    return _estimate_cost(task_type, description)


@app.get("/api/v1/agent/tasks/{task_id}/dependencies")
async def agent_task_dependencies(task_id: str):
    """Проверить DAG-зависимости задачи."""
    from backend.services.agent_task_console import check_task_dependencies
    return check_task_dependencies(task_id)


@app.post("/api/v1/agent/conventions/update")
async def agent_conventions_update():
    """Принудительно обновить CONVENTIONS.md на основе истории задач."""
    ai_key = str(os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY") or "")
    ai_config = {"api_key": ai_key, "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat"}
    return await run_conventions_update("/mnt/data/Pimv3", ai_config, force=True)


@app.get("/api/v1/agent/tasks/{task_id}/stream/log")
async def agent_task_stream_log(task_id: str):
    """Получить накопленный лог стриминга (без SSE подписки)."""
    r = None
    try:
        import redis as _rl
        r = _rl.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)
        raw = r.lrange(f"agent:stream_log:{task_id}", 0, -1) or []
        events = []
        for line in raw:
            try:
                events.append(json.loads(line))
            except Exception:
                events.append({"raw": line})
        return {"ok": True, "events": events}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        if r:
            try:
                r.close()
            except Exception:
                pass


@app.get("/api/v1/agent/tasks/{task_id}/checkpoint")
async def agent_task_checkpoint(task_id: str):
    """Получить сохранённый checkpoint задачи (для resume)."""
    return resume_from_checkpoint(task_id)


@app.get("/api/v1/agent/tasks/{task_id}/pipeline")
async def agent_task_pipeline_status(task_id: str):
    """Получить статус multi-agent pipeline задачи."""
    import redis as _rl
    r = _rl.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)
    try:
        raw = r.hgetall(f"agent_task:{task_id}") or {}
        return {
            "ok": True,
            "task_id": task_id,
            "pipeline_stage": raw.get("pipeline_stage", "not_started"),
            "pipeline_progress": raw.get("pipeline_progress", "0"),
            "pipeline_analysis": json.loads(raw.get("pipeline_analysis", "null") or "null"),
            "status": raw.get("status", "unknown"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        r.close()


@app.get("/api/v1/agent/tasks/{task_id}/stream")
async def agent_task_stream(task_id: str):
    """SSE stream событий ReAct-агента для задачи."""
    import asyncio
    try:
        from sse_starlette.sse import EventSourceResponse
    except ImportError:
        raise HTTPException(status_code=501, detail="sse_starlette not installed")

    async def event_generator():
        r = None
        try:
            import redis as _redis_lib
            r = _redis_lib.Redis.from_url(
                os.getenv("REDIS_URL", "redis://localhost:6379/0"),
                decode_responses=True,
            )
            log_key = f"agent:stream_log:{task_id}"
            last_id = "0-0"
            while True:
                # Используем xread для чтения новых событий из Redis stream
                result = r.xread({log_key: last_id}, block=5000, count=10)
                if result:
                    for stream, messages in result:
                        for message_id, data in messages:
                            yield {
                                "event": "message",
                                "data": json.dumps({"id": message_id, "data": data})
                            }
                            last_id = message_id
                else:
                    # Если нет новых событий, отправляем keep-alive комментарий
                    yield {"event": "comment", "data": "keep-alive"}
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.error("SSE stream error for task %s: %s", task_id, e)
            yield {"event": "error", "data": json.dumps({"error": str(e)})}
        finally:
            if r:
                r.close()
    
    return EventSourceResponse(event_generator())


@app.post("/api/v1/agent-chat/message")
async def agent_chat_message(
    req: schemas.AgentChatMessageRequest,
    ai_key: str = Depends(get_deepseek_key),
    current_user: models.User = Depends(get_current_user),
):
    user_id = str(getattr(current_user, "email", "") or "anonymous")
    state = load_chat_state(user_id)
    state_history = state.get("history", []) or []
    client_history = [m.model_dump() for m in (req.history or [])]
    merged_history = (state_history if state_history else client_history)[-20:]
    low = str(req.message or "").lower()
    if any(x in low for x in ["что за проект", "в каком проекте", "видишь файл", "видишь файлы", "видишь проект", "контекст проекта"]):
        reply = "Да. Я работаю в `pimv3`, вижу проект и могу сразу запускать задачи по коду/интеграциям/UI."
        history_out = merged_history + [{"role": "user", "content": req.message}, {"role": "assistant", "content": reply}]
        save_chat_state(user_id, history=history_out, active_task_id=str(state.get("active_task_id") or ""))
        return {"ok": True, "assistant_reply": reply, "task": {}, "active_task_id": str(state.get("active_task_id") or "")}

    # 1) Contextual auto-start (LLM): if phrase is actionable in context, start immediately.
    contextual = await infer_contextual_task_command_with_llm(
        message=req.message,
        history=merged_history,
        ai_key=ai_key,
    )
    if isinstance(contextual, dict) and str(contextual.get("intent") or "") == "task_create":
        created = create_agent_task(
            task_type=str(contextual.get("task_type") or "api-integration"),
            title=str(contextual.get("title") or (str(req.message or "").strip()[:120] or "Интеграция маркетплейса")),
            description=str(contextual.get("description") or req.message),
            requested_by=current_user.email,
            namespace=str(contextual.get("namespace") or "") or None,
            docs_urls=contextual.get("docs_urls") or req.docs_urls,
            validation_query=str(contextual.get("validation_query") or "authorization token create update list"),
            web_query=str(contextual.get("web_query") or ""),
            max_web_results=int(contextual.get("max_web_results") or 5),
        )
        task_id = (((created or {}).get("task") or {}).get("task_id") or "")
        if req.auto_run and task_id:
            _queue_task_for_dispatch(task_id)
        reply = (
            "Понял с полуслова и уже запустил выполнение.\n"
            f"task_id: `{task_id}`\n"
            "Если понадобятся доступы, пришлю короткий конкретный список."
        )
        history_out = merged_history + [
            {"role": "user", "content": req.message},
            {"role": "assistant", "content": reply},
        ]
        save_chat_state(user_id, history=history_out, active_task_id=task_id)
        return {
            "ok": True,
            "assistant_reply": reply,
            "task": (created or {}).get("task", {}),
            "active_task_id": task_id,
        }
    # 2) Intent routing (LLM): status/clarify/task.

    inferred = await route_message_with_llm(
        message=req.message,
        history=merged_history,
        ai_key=ai_key,
    )
    intent = str(inferred.get("intent") or "clarify")
    if intent == "smalltalk":
        llm = await compose_assistant_reply_with_llm(
            ai_key=ai_key,
            user_message=req.message,
            context={"intent": "smalltalk", "action": "no_task_started"},
        )
        history_out = merged_history + [
            {"role": "user", "content": req.message},
            {"role": "assistant", "content": llm or build_smalltalk_reply(req.message)},
        ]
        save_chat_state(user_id, history=history_out, active_task_id=str(state.get("active_task_id") or ""))
        return {
            "ok": True,
            "assistant_reply": llm or build_smalltalk_reply(req.message),
            "task": {},
            "active_task_id": str(state.get("active_task_id") or ""),
        }
    if bool(inferred.get("requires_clarification")) or intent == "clarify":
        llm = await compose_assistant_reply_with_llm(
            ai_key=ai_key,
            user_message=req.message,
            context={
                "intent": "clarify",
                "clarification_question": inferred.get("clarification_question") or "Уточни, пожалуйста, что именно нужно сделать первым?",
            },
        )
        history_out = merged_history + [
            {"role": "user", "content": req.message},
            {"role": "assistant", "content": llm or str(inferred.get("clarification_question") or "Уточни, пожалуйста, цель задачи.")},
        ]
        save_chat_state(user_id, history=history_out, active_task_id=str(state.get("active_task_id") or ""))
        return {
            "ok": True,
            "assistant_reply": llm or str(inferred.get("clarification_question") or "Уточни, пожалуйста, цель задачи."),
            "task": {},
            "active_task_id": str(state.get("active_task_id") or ""),
        }
    if intent == "task_status":
        task_id = str(inferred.get("task_id") or "").strip()
        if not task_id:
            task_id = str(state.get("active_task_id") or "").strip()
        if (not task_id) and any(x in str(req.message or "").lower() for x in ["изучил", "статус", "готово", "что с задачей", "как там"]):
            task_id = str(state.get("active_task_id") or "").strip()
        if not task_id:
            llm = await compose_assistant_reply_with_llm(
                ai_key=ai_key,
                user_message=req.message,
                context={"intent": "clarify", "clarification_question": "Пришли task_id, чтобы я показал точный статус."},
            )
            return {"ok": True, "assistant_reply": llm or "Пришли task_id, чтобы я показал точный статус.", "task": {}, "active_task_id": ""}
        got = get_agent_task(task_id)
        llm = await compose_assistant_reply_with_llm(
            ai_key=ai_key,
            user_message=req.message,
            context={"intent": "task_status", "task": got.get("task", {}), "logs_tail": (got.get("logs", []) or [])[-5:]},
        )
        history_out = merged_history + [
            {"role": "user", "content": req.message},
            {"role": "assistant", "content": llm or f"Статус задачи `{task_id}`: {((got.get('task') or {}).get('status') or 'unknown')}."},
        ]
        save_chat_state(user_id, history=history_out, active_task_id=task_id)
        return {"ok": True, "assistant_reply": llm or f"Статус задачи `{task_id}`: {((got.get('task') or {}).get('status') or 'unknown')}.", "task": got.get("task", {}), "active_task_id": task_id}

    created = create_agent_task(
        task_type=inferred.get("task_type", "backend"),
        title=inferred.get("title", "Новая задача агенту"),
        description=inferred.get("description", req.message),
        requested_by=current_user.email,
        namespace=inferred.get("namespace") or None,
        docs_urls=inferred.get("docs_urls") or [],
        validation_query=inferred.get("validation_query") or None,
        web_query=inferred.get("web_query") or None,
        max_web_results=int(inferred.get("max_web_results") or 5),
    )
    if req.auto_run and created.get("ok"):
        task_id = (((created or {}).get("task") or {}).get("task_id") or "")
        if task_id:
            _queue_task_for_dispatch(task_id)
    task_obj = (created or {}).get("task", {}) if isinstance(created, dict) else {}
    llm = await compose_assistant_reply_with_llm(
        ai_key=ai_key,
        user_message=req.message,
        context={
            "intent": "task_create",
            "task": task_obj,
            "hint": "Прогресс и логи в Agent Task Console",
        },
    )
    history_out = merged_history + [
        {"role": "user", "content": req.message},
        {"role": "assistant", "content": llm or build_user_reply(created)},
    ]
    save_chat_state(user_id, history=history_out, active_task_id=str(task_obj.get("task_id") or ""))
    return {
        "ok": True,
        "assistant_reply": llm or build_user_reply(created),
        "task": task_obj,
        "active_task_id": str(task_obj.get("task_id") or ""),
    }


@app.get("/api/v1/agent-chat/state")
async def agent_chat_state(
    current_user: models.User = Depends(get_current_user),
):
    user_id = str(getattr(current_user, "email", "") or "anonymous")
    state = load_chat_state(user_id)
    active_task_id = str(state.get("active_task_id") or "")
    task: Dict[str, Any] = {}
    if active_task_id:
        got = get_agent_task(active_task_id)
        task = got.get("task", {}) if isinstance(got, dict) else {}
    return {
        "ok": True,
        "history": state.get("history", []) or [],
        "active_task_id": active_task_id,
        "task": task,
    }


@app.get("/api/v1/agent-tasks-capabilities")
async def agent_tasks_capabilities(
    current_user: models.User = Depends(get_current_user),
):
    return {
        "ok": True,
        "capabilities": {
            "web_ingest": True,
            "web_discovery": True,
            "context7_connected": context7_is_connected(),
        },
    }


@app.post("/api/v1/helper-agents/create")
async def helper_agent_create(
    req: schemas.HelperAgentCreateRequest,
    current_user: models.User = Depends(get_current_user),
):
    return create_helper_agent(
        name=req.name,
        role=req.role,
        goal=req.goal,
        tools=req.tools,
        created_by=current_user.email,
        parent_task_id=req.parent_task_id,
    )


@app.post("/api/v1/helper-agents/auto-spawn")
async def helper_agents_auto_spawn(
    task_id: str,
    task_type: str,
    title: str = "",
    description: str = "",
    current_user: models.User = Depends(get_current_user),
):
    return auto_spawn_helpers_for_task(
        task_type=task_type,
        task_id=task_id,
        title=title or task_type,
        description=description,
        created_by=current_user.email,
    )


@app.get("/api/v1/helper-agents")
async def helper_agents_list(
    limit: int = 200,
    current_user: models.User = Depends(get_current_user),
):
    return list_helper_agents(limit=limit)


@app.get("/api/v1/helper-agents/{helper_id}")
async def helper_agent_get(
    helper_id: str,
    current_user: models.User = Depends(get_current_user),
):
    return get_helper_agent(helper_id)


@app.post("/api/v1/team/plan/create")
async def team_plan_create(
    req: schemas.TeamPlanCreateRequest,
    current_user: models.User = Depends(get_current_user),
):
    return create_plan(req.topic, created_by=current_user.email)


@app.get("/api/v1/team/plan/{plan_id}")
async def team_plan_get(
    plan_id: str,
    current_user: models.User = Depends(get_current_user),
):
    return get_plan(plan_id)


@app.post("/api/v1/team/task/create")
async def team_task_create(
    req: schemas.TeamTaskCreateRequest,
    current_user: models.User = Depends(get_current_user),
):
    return add_task(req.plan_id, req.role, req.title, req.details)


@app.post("/api/v1/team/question/create")
async def team_question_create(
    req: schemas.TeamQuestionCreateRequest,
    current_user: models.User = Depends(get_current_user),
):
    return add_question(req.plan_id, req.asked_by, req.question)


@app.post("/api/v1/team/question/answer")
async def team_question_answer(
    req: schemas.TeamQuestionAnswerRequest,
    current_user: models.User = Depends(get_current_user),
):
    return answer_question(req.plan_id, req.question_id, req.answer, req.answered_by)


@app.post("/api/v1/team/plan/{plan_id}/state/init")
async def team_plan_state_init(
    plan_id: str,
    current_user: models.User = Depends(get_current_user),
):
    return init_state_machine(plan_id)


@app.post("/api/v1/team/plan/{plan_id}/state/advance")
async def team_plan_state_advance(
    plan_id: str,
    note: str = "",
    current_user: models.User = Depends(get_current_user),
):
    return advance_state_machine(plan_id, note=note)


@app.post("/api/v1/admin/approvals/request")
async def admin_approval_request(
    req: schemas.ApprovalRequestCreate,
    current_user: models.User = Depends(get_current_user),
):
    return request_admin_approval(req.action, req.payload, requested_by=current_user.email)


@app.get("/api/v1/admin/approvals")
async def admin_approvals_list(
    limit: int = 100,
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    return list_approvals(limit=limit)


@app.post("/api/v1/admin/approvals/decide")
async def admin_approvals_decide(
    req: schemas.ApprovalDecisionRequest,
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    return decide_approval(req.approval_id, req.decision, admin_email=current_user.email)


@app.post("/api/v1/github/connect/request")
async def github_connect_request(
    req: schemas.GithubConnectRequest,
    current_user: models.User = Depends(get_current_user),
):
    return request_admin_approval(
        "github_connect",
        {"repo_url": req.repo_url, "reason": req.reason, "requested_by": current_user.email},
        requested_by=current_user.email,
    )


@app.post("/api/v1/github/connect/execute")
async def github_connect_execute(
    approval_id: str,
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    ap = get_approval(approval_id)
    if not ap.get("ok"):
        raise HTTPException(404, ap.get("error", "approval not found"))
    approval = ap.get("approval", {})
    if str(approval.get("action")) != "github_connect":
        raise HTTPException(400, "approval action mismatch")
    if str(approval.get("status")) != "approved":
        raise HTTPException(403, "approval is not approved")
    # Hard gate done. Real external GitHub linking is intentionally explicit and controlled.
    return {"ok": True, "status": "approved_to_connect", "approval": approval}


@app.get("/api/v1/github/automation/status")
async def github_automation_status(
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    return {"ok": True, "github": github_config_status("/mnt/data/Pimv3")}


@app.post("/api/v1/agents/self-rewrite/run")
async def run_self_rewrite(
    req: schemas.SelfRewriteRunRequest,
    current_user: models.User = Depends(get_current_user),
):
    """
    Полуавтономный self-rewrite контур: plan -> proposal -> quality gate -> (опционально apply).
    По умолчанию не применяет patch автоматически.
    """
    from pathlib import Path
    from backend.services.telemetry import get_task_events, append_task_event
    from backend.services.self_rewrite_planner import build_self_rewrite_plan
    from backend.services.code_patch_agent import generate_code_patch_proposal, resume_from_checkpoint
    from backend.services.quality_gate import run_quality_gate
    from backend.services.rollback_guard import backup_files
    from backend.services.kpi_guard import compute_task_kpis, should_auto_stop_self_rewrite

    events = get_task_events(req.task_id, tail=400)
    rewrite_plan = build_self_rewrite_plan(events, max_hypotheses=6)
    kpis = compute_task_kpis(events)
    guard = should_auto_stop_self_rewrite(kpis)
    canary = canary_gate_ok(events)
    if guard.get("stop"):
        return {
            "ok": False,
            "reason": "auto_stop_guard",
            "guard": guard,
            "canary": canary,
            "kpis": kpis,
            "rewrite_plan": rewrite_plan,
        }

    setting_id = "deepseek_api_key"
    async with AsyncSessionLocal() as db:
        setting_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == setting_id))
        setting = setting_res.scalars().first()
    if not setting or not setting.value:
        raise HTTPException(400, "DeepSeek API key is not configured")
    ai_key = setting.value

    proposal = await generate_code_patch_proposal(
        ai_config=ai_key,
        rewrite_plan=rewrite_plan,
        allowlist_files=req.allowlist_files,
    )
    if not proposal.get("ok"):
        append_task_event(req.task_id, "self_rewrite_failed", {"stage": "proposal", "error": proposal.get("error")})
        return {"ok": False, "stage": "proposal", "proposal": proposal}

    affected_files = proposal.get("proposal", {}).get("affected_files", []) if isinstance(proposal.get("proposal"), dict) else []
    gate = run_quality_gate(
        workspace_root="/mnt/data/Pimv3",
        changed_files=affected_files,
        run_frontend_build=req.run_frontend_build,
    )
    append_task_event(req.task_id, "self_rewrite_quality_gate", {"gate": gate, "affected_files": affected_files})

    backup_map = backup_files("/mnt/data/Pimv3", affected_files) if affected_files else {}
    # NOTE: apply_patch intentionally disabled by default for safety.
    applied = bool(req.apply_patch and gate.get("ok") and canary.get("ok") and proposal.get("proposal", {}).get("patch_unified_diff"))
    if applied:
        # Полуавто-режим: в этой версии возвращаем patch для контролируемого применения оркестратором.
        append_task_event(req.task_id, "self_rewrite_ready_to_apply", {"affected_files": affected_files})

    return {
        "ok": bool(gate.get("ok")),
        "kpis": kpis,
        "guard": guard,
        "canary_gate": canary,
        "rewrite_plan": rewrite_plan,
        "proposal": proposal.get("proposal", {}),
        "quality_gate": gate,
        "backup_created": bool(backup_map),
        "applied": applied,
        "note": "Patch proposal generated. Automatic file patch apply is guarded in this build.",
    }


@app.get("/api/v1/self-improve/incidents")
async def self_improve_incidents(
    limit: int = 100,
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    return list_self_improve_incidents(limit=limit)


@app.get("/api/v1/self-improve/incidents/{incident_id}")
async def self_improve_incident(
    incident_id: str,
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    return get_self_improve_incident(incident_id)


@app.post("/api/v1/self-improve/incidents/{incident_id}/run")
async def self_improve_incident_run(
    incident_id: str,
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    async with AsyncSessionLocal() as db:
        setting_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == "deepseek_api_key"))
        setting = setting_res.scalars().first()
        ai_key = setting.value if setting and setting.value else ""
    run_self_improve_incident_task.delay(incident_id, ai_key)
    return {"ok": True, "incident_id": incident_id, "status": "queued"}


@app.post("/api/v1/self-improve/trigger")
async def self_improve_trigger(
    req: schemas.SelfImproveManualTriggerRequest,
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    ai_key = ""
    async with AsyncSessionLocal() as db:
        setting_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == "deepseek_api_key"))
        setting = setting_res.scalars().first()
        ai_key = setting.value if setting and setting.value else ""
    out = record_failure_and_maybe_trigger(
        sku=req.sku,
        task_id=req.task_id,
        error_excerpt=req.error_excerpt or "manual trigger",
        ai_key=ai_key,
    )
    if out.get("triggered") and out.get("incident_id"):
        run_self_improve_incident_task.delay(str(out.get("incident_id")), ai_key)
    return {"ok": True, **out}

@app.post("/api/v1/import/bulk")
async def import_marketplace_bulk(req: schemas.BulkImportRequest, current_user: models.User = Depends(get_current_user)):
    queries = [q.strip() for q in req.queries if q.strip()]
    if not queries:
        raise HTTPException(400, "Отсутствуют артикулы для импорта")
    
    task_id = str(uuid.uuid4())
    
    async with AsyncSessionLocal() as db:
        setting_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == 'deepseek_api_key'))
        setting = setting_res.scalars().first()
        if not setting or not setting.value:
            raise HTTPException(400, "DeepSeek API key is not configured")
        ai_key = setting.value
        
    redis_client.set(f"task:{task_id}:total", len(queries))
    redis_client.set(f"task:{task_id}:processed", 0)
    redis_client.set(f"task:{task_id}:success", 0)
    redis_client.set(f"task:{task_id}:failed", 0)
    redis_client.set(f"task:{task_id}:status", "processing")
    redis_client.delete(f"task:{task_id}:logs")
    redis_client.rpush(f"task:{task_id}:logs", "[INIT] Bulk import task created")
    from backend.celery_worker import process_single_sku_task
    for q in queries:
        process_single_sku_task.delay(q, str(req.connection_id), ai_key, task_id)
        
    return {"task_id": task_id}

@app.post("/api/v1/syndicate/bulk")
async def import_syndicate_bulk(req: schemas.BulkSyndicateRequest, current_user: models.User = Depends(get_current_user)):
    if not req.product_ids:
        raise HTTPException(400, "Отсутствуют товары для синдикации")
    
    task_id = str(uuid.uuid4())
    
    async with AsyncSessionLocal() as db:
        setting_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == 'deepseek_api_key'))
        setting = setting_res.scalars().first()
        if not setting or not setting.value:
            raise HTTPException(400, "DeepSeek API key is not configured")
        ai_key = setting.value
        
    redis_client.set(f"task:{task_id}:total", len(req.product_ids))
    redis_client.set(f"task:{task_id}:processed", 0)
    redis_client.set(f"task:{task_id}:success", 0)
    redis_client.set(f"task:{task_id}:failed", 0)
    redis_client.set(f"task:{task_id}:status", "processing")
    redis_client.set(f"task:{task_id}:current_sku", "Инициализация...")
    redis_client.delete(f"task:{task_id}:logs")
    redis_client.rpush(f"task:{task_id}:logs", "[INIT] Bulk syndication task created")
    
    from backend.celery_worker import process_single_syndicate_task
    for product_id in req.product_ids:
        process_single_syndicate_task.delay(str(product_id), str(req.connection_id), ai_key, task_id)
        
    return {"task_id": task_id, "message": "Celery tasks dispatched"}


@app.post("/api/v1/syndicate/mm/autofix-existing-errors")
async def megamarket_autofix_existing_errors(
    req: schemas.MegamarketAutoFixExistingRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Берёт реальный список карточек с ошибками из MM getError,
    сопоставляет с локальными SKU и ставит совпавшие в очередь автоисправления.
    """
    conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == req.connection_id))
    db_conn = conn_res.scalars().first()
    if not db_conn:
        raise HTTPException(404, "Connection not found")
    if db_conn.type != "megamarket":
        raise HTTPException(400, "Режим доступен только для Megamarket")

    setting_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == 'deepseek_api_key'))
    setting = setting_res.scalars().first()
    if not setting or not setting.value:
        raise HTTPException(400, "DeepSeek API key is not configured")
    ai_key = setting.value

    from backend.services.adapters import MegamarketAdapter, get_adapter
    adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
    if not isinstance(adapter, MegamarketAdapter):
        raise HTTPException(500, "Внутренняя ошибка: адаптер не Megamarket")

    scan_limit = max(1, min(int(req.scan_limit or 150), 2000))
    page_size = 100
    offer_ids: List[str] = []
    seen_offer_ids = set()
    offset = 0
    # Берём ошибки страницами: источник истины — MM, а не случайные локальные товары.
    while len(offer_ids) < scan_limit:
        chunk = await adapter.list_error_offer_ids(limit=min(page_size, scan_limit - len(offer_ids)), offset=offset)
        if not chunk:
            break
        for oid in chunk:
            s = str(oid).strip()
            if not s or s in seen_offer_ids:
                continue
            seen_offer_ids.add(s)
            offer_ids.append(s)
            if len(offer_ids) >= scan_limit:
                break
        offset += page_size

    mm_error_cards_found = len(offer_ids)

    matched_products: List[models.Product] = []
    matched_skus: set = set()
    if offer_ids:
        prod_res = await db.execute(select(models.Product).where(models.Product.sku.in_(offer_ids)))
        matched_products = prod_res.scalars().all()
        matched_skus = {p.sku for p in matched_products}

    matched_local_products = len(matched_products)
    # offerId с ошибками, которых нет в PIM — исправляем прямо по MM-данным
    unmatched_offer_ids_list = [oid for oid in offer_ids if oid not in matched_skus]
    unmatched_offer_ids = len(unmatched_offer_ids_list)

    total_queued = matched_local_products + unmatched_offer_ids
    task_id = str(uuid.uuid4())
    redis_client.set(f"task:{task_id}:total", total_queued)
    redis_client.set(f"task:{task_id}:processed", 0)
    redis_client.set(f"task:{task_id}:success", 0)
    redis_client.set(f"task:{task_id}:failed", 0)
    redis_client.set(f"task:{task_id}:status", "completed" if total_queued == 0 else "processing")
    redis_client.set(f"task:{task_id}:current_sku", "Инициализация..." if total_queued > 0 else "Нет карточек с ошибками")
    redis_client.delete(f"task:{task_id}:logs")
    redis_client.rpush(f"task:{task_id}:logs", "[INIT] MM autofix task created")

    if matched_products:
        from backend.celery_worker import process_single_syndicate_task
        for p in matched_products:
            process_single_syndicate_task.delay(str(p.id), str(req.connection_id), ai_key, task_id)

    if unmatched_offer_ids_list:
        # Карточки есть на MM, но нет в PIM — исправляем напрямую из MM-данных
        from backend.celery_worker import process_mm_offer_id_autofix_task
        for oid in unmatched_offer_ids_list:
            process_mm_offer_id_autofix_task.delay(oid, str(req.connection_id), ai_key, task_id)

    return {
        "task_id": task_id,
        "message": f"Queued {total_queued} cards (PIM: {matched_local_products}, MM-only: {unmatched_offer_ids})" if total_queued > 0 else "Ошибочные карточки не найдены",
        "mm_error_cards_found": mm_error_cards_found,
        "matched_local_products": matched_local_products,
        "unmatched_offer_ids": unmatched_offer_ids,
        "scanned": mm_error_cards_found,
        "queued": total_queued,
    }


# === AI SYNDICATION ENDPOINTS ===

@app.post("/api/v1/syndicate/selector")
async def syndicate_selector(req: schemas.SyndicateBaseRequest, db: AsyncSession = Depends(get_db), ai_key: str = Depends(get_deepseek_key), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
    db_prod = result.scalars().first()
    if not db_prod: raise HTTPException(404)
    
    # Real-time live fetching duplicates from all attached marketplaces
    conns_res = await db.execute(select(models.MarketplaceConnection))
    all_conns = conns_res.scalars().all()
    
    from backend.services.adapters import get_adapter
    duplicates_found = []
    for c in all_conns:
        try:
            adapter = get_adapter(c.type, c.api_key, c.client_id, c.store_id, getattr(c, "warehouse_id", None))
            pulled_card = await adapter.pull_product(db_prod.sku)
            if pulled_card:
                duplicates_found.append({f"Marketplace ({c.type})": pulled_card})
        except Exception as e:
            print(f"Warning: Failed to pull real data from {c.type}: {e}")
            pass

    attrs_res = await db.execute(select(models.Attribute))
    active_attrs = attrs_res.scalars().all()
    
    if not duplicates_found and not db_prod.attributes_data:
        raise HTTPException(status_code=404, detail=f"Артикул {db_prod.sku} не найден в подключенных магазинах, а локальная база пуста. ИИ не из чего собирать карточку!")
        
    # Feed real scraped data to AI DeepSeek
    ai_response = await select_ideal_card(db_prod.attributes_data, duplicates_found, active_attrs, ai_key)
    
    # Process dynamic AI attributes
    new_attrs = ai_response.get("new_attributes", [])
    ideal_data = ai_response.get("ideal_data", ai_response) # Fallback to raw response if AI hallucinates
    
    # Auto-save new attributes to DB
    for attr in new_attrs:
        existing = await db.execute(select(models.Attribute).where(models.Attribute.code == attr["code"]))
        if not existing.scalars().first():
            db.add(models.Attribute(
                code=attr["code"],
                name=attr.get("name", attr["code"]).capitalize(),
                type=attr.get("type", "string"),
                is_required=False,
                category_id=db_prod.category_id
            ))
    
    # Auto-save ideal data to DB
    db_prod.attributes_data = ideal_data
    req_attrs_res = await db.execute(select(models.Attribute).where(
        (models.Attribute.is_required == True) &
        ((models.Attribute.category_id == None) | (models.Attribute.category_id == db_prod.category_id))
    ))
    req_attrs = req_attrs_res.scalars().all()
    db_prod.completeness_score = calculate_completeness(ideal_data, req_attrs)
    db.add(db_prod)
    await db.commit()

    return {"ideal_card": ideal_data}

@app.post("/api/v1/syndicate/seo")
async def syndicate_seo(req: schemas.SyndicateBaseRequest, db: AsyncSession = Depends(get_db), ai_key: str = Depends(get_deepseek_key), current_user: models.User = Depends(get_current_user)):
    result = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
    db_prod = result.scalars().first()
    if not db_prod: raise HTTPException(404)
    
    smart_html = await generate_smart_seo(db_prod.attributes_data, ai_key)
    return {"seo_html": smart_html}

@app.post("/api/v1/syndicate/map")
async def syndicate_map(req: schemas.SyndicateMapRequest, db: AsyncSession = Depends(get_db), ai_key: str = Depends(get_deepseek_key), current_user: models.User = Depends(get_current_user)):
    prod_res = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
    conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == req.connection_id))
    
    db_prod = prod_res.scalars().first()
    db_conn = conn_res.scalars().first()
    
    if not db_prod or not db_conn: raise HTTPException(404)
    
    from backend.services.ai_service import map_schema_to_marketplace, generate_category_query, select_best_category
    from backend.services.adapters import get_adapter
    
    adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
    
    # --- ENTERPRISE REACT WORKFLOW ---
    # 1. Generate search term
    search_query = await generate_category_query(db_prod.attributes_data, ai_key)
    print(f"ReAct Query: {search_query}")
    
    # 2. Search marketplace categories
    found_categories = await adapter.search_categories(search_query)
    
    target_schema = {}
    best_cat_id = None
    if found_categories:
        # 3. Select BEST Category ID
        cat_select = await select_best_category(db_prod.attributes_data, found_categories, ai_key)
        best_cat_id = cat_select.get("category_id")
        print(f"ReAct Selected Category ID: {best_cat_id}")
        
        # 4. Fetch STRICT Marketplace Schema
        if best_cat_id:
            target_schema = await adapter.get_category_schema(str(best_cat_id))
            print(f"Downloaded strict schema!")
            
    # 5. Map attributes using strict target schema
    pim_attrs = dict(db_prod.attributes_data) if db_prod.attributes_data else {}
    pim_attrs["Артикул (SKU)"] = db_prod.sku
    
    mapped_res = await map_schema_to_marketplace(pim_attrs, db_conn.type, target_schema, ai_key)

    mapped_payload = mapped_res.get("mapped_payload", mapped_res)
    missing_fields = mapped_res.get("missing_required_fields", [])

    # Optionally save the mapping for later push
    return {
        "mapped_payload": mapped_payload, 
        "missing_fields": missing_fields,
        "category_id": best_cat_id,
        "target_schema": target_schema
    }


@app.post("/api/v1/syndicate/ozon-agent")
async def syndicate_ozon_agent(
    req: schemas.SyndicateOzonAgentRequest,
    db: AsyncSession = Depends(get_db),
    ai_key: str = Depends(get_deepseek_key),
    current_user: models.User = Depends(get_current_user),
):
    """ИИ-агент: инструменты get_schema / get_dictionary / get_errors / set_fields / submit → выгрузка Ozon."""
    prod_res = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
    conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == req.connection_id))
    db_prod = prod_res.scalars().first()
    db_conn = conn_res.scalars().first()
    if not db_prod or not db_conn:
        raise HTTPException(404)
    if db_conn.type != "ozon":
        raise HTTPException(400, "Агент доступен только для подключения Ozon")

    from backend.services.adapters import OzonAdapter, get_adapter
    from backend.services.ai_service import generate_category_query, map_schema_to_marketplace, select_best_category
    from backend.services.ozon_syndicate_agent import run_ozon_syndicate_agent

    adapter = get_adapter(
        db_conn.type,
        db_conn.api_key,
        db_conn.client_id,
        db_conn.store_id,
        getattr(db_conn, "warehouse_id", None),
    )
    if not isinstance(adapter, OzonAdapter):
        raise HTTPException(500, "Внутренняя ошибка: адаптер не Ozon")

    pim_attrs = dict(db_prod.attributes_data) if db_prod.attributes_data else {}
    pim_attrs["Артикул (SKU)"] = db_prod.sku

    forced = (req.category_id or "").strip() or None
    best_cat_id = None
    target_schema: Dict[str, Any] = {}
    if forced:
        best_cat_id = forced
        target_schema = await adapter.get_category_schema(best_cat_id)
    else:
        search_query = await generate_category_query(db_prod.attributes_data, ai_key)
        found_categories = await adapter.search_categories(search_query)
        if found_categories:
            cat_select = await select_best_category(db_prod.attributes_data, found_categories, ai_key)
            best_cat_id = cat_select.get("category_id")
            if best_cat_id:
                target_schema = await adapter.get_category_schema(str(best_cat_id))

    if not best_cat_id:
        raise HTTPException(
            400,
            "Не определена категория Ozon: укажите category_id (desc_type) в запросе или заполните карточку для авто-подбора.",
        )

    mapped_res = await map_schema_to_marketplace(pim_attrs, "ozon", target_schema, ai_key)
    initial_flat = mapped_res.get("mapped_payload", mapped_res)
    if not isinstance(initial_flat, dict):
        initial_flat = {}
    initial_flat["categoryId"] = str(best_cat_id)

    base = (req.public_base_url or os.getenv("PUBLIC_API_BASE_URL", "")).strip().rstrip("/")
    imgs: List[str] = []
    for im in db_prod.images or []:
        s = str(im).strip()
        if not s:
            continue
        if s.startswith("http"):
            imgs.append(s)
        elif s.startswith("/") and base:
            imgs.append(base + s)

    agent_out = await run_ozon_syndicate_agent(
        adapter=adapter,
        ai_config=ai_key,
        category_id=str(best_cat_id),
        sku=db_prod.sku,
        name=db_prod.name or "",
        pim_attributes=pim_attrs,
        initial_flat=initial_flat,
        image_urls=imgs or None,
        do_final_push=req.push,
        allow_agent_submit=req.push,
    )

    pr = agent_out.get("push")
    http_ok = True
    detail = ""
    if isinstance(pr, dict):
        if "status_code" in pr:
            http_ok = int(pr.get("status_code", 500)) < 400
            detail = str(pr.get("response", ""))[:500]
        elif pr.get("skipped"):
            detail = "push уже выполнен инструментом submit внутри агента"

    return {
        "status": "success" if http_ok else "error",
        "marketplace": "ozon",
        "category_id": str(best_cat_id),
        "mapped_payload": agent_out.get("mapped_payload"),
        "trace": agent_out.get("trace"),
        "push": pr,
        "submit_during_agent": agent_out.get("submit_during_agent"),
        "message": detail or ("Готово" if http_ok else "Ошибка HTTP при выгрузке"),
    }


@app.post("/api/v1/syndicate/agent")
async def syndicate_agent(
    req: schemas.SyndicateAgentRequest,
    db: AsyncSession = Depends(get_db),
    ai_key: str = Depends(get_deepseek_key),
    current_user: models.User = Depends(get_current_user),
):
    """
    Универсальный агент по выбранному подключению:
    - ozon: tool-agent (schema/dictionary/errors/set_fields/submit)
    - остальные: map -> push (для Megamarket сохранена авто-починка в syndicate_push)
    """
    conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == req.connection_id))
    db_conn = conn_res.scalars().first()
    if not db_conn:
        raise HTTPException(404, "Интеграция не найдена")

    if db_conn.type == "ozon":
        return await syndicate_ozon_agent(
            schemas.SyndicateOzonAgentRequest(
                product_id=req.product_id,
                connection_id=req.connection_id,
                category_id=req.category_id,
                push=req.push,
                public_base_url=req.public_base_url,
            ),
            db=db,
            ai_key=ai_key,
            current_user=current_user,
        )

    if db_conn.type == "megamarket":
        from backend.services.adapters import MegamarketAdapter, get_adapter
        from backend.services.ai_service import generate_category_query, select_best_category
        from backend.services.megamarket_syndicate_agent import run_megamarket_syndicate_agent

        prod_res = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
        db_prod = prod_res.scalars().first()
        if not db_prod:
            raise HTTPException(404, "Product not found")

        adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
        if not isinstance(adapter, MegamarketAdapter):
            raise HTTPException(500, "Внутренняя ошибка: адаптер не Megamarket")

        target_schema: Dict[str, Any] = {}
        best_cat_id = (req.category_id or "").strip() or None
        if not best_cat_id:
            search_query = await generate_category_query(db_prod.attributes_data, ai_key)
            found_categories = await adapter.search_categories(search_query)
            if found_categories:
                cat_select = await select_best_category(db_prod.attributes_data, found_categories, ai_key)
                best_cat_id = cat_select.get("category_id")
        if not best_cat_id:
            raise HTTPException(400, "Не определена категория Megamarket")
        target_schema = await adapter.get_category_schema(str(best_cat_id))

        pim_attrs = dict(db_prod.attributes_data) if db_prod.attributes_data else {}
        pim_attrs["Артикул (SKU)"] = db_prod.sku
        # Для MM не отправляем огромный контекст в map AI: стартуем из user payload + PIM attrs.
        mapped_payload: Dict[str, Any] = {}
        if isinstance(req.mapped_payload, dict) and req.mapped_payload:
            mapped_payload.update(copy.deepcopy(req.mapped_payload))
        for k, v in pim_attrs.items():
            if k not in mapped_payload and v not in (None, ""):
                mapped_payload[k] = v
        mapped_payload["categoryId"] = str(best_cat_id)

        base = (req.public_base_url or os.getenv("PUBLIC_API_BASE_URL", "")).strip().rstrip("/")
        imgs: List[str] = []
        for im in (db_prod.images or []):
            s = str(im).strip()
            if not s:
                continue
            if s.startswith("http"):
                imgs.append(s)
            elif s.startswith("/") and base:
                imgs.append(base + s)
        if imgs and not mapped_payload.get("Фото"):
            mapped_payload["Фото"] = imgs

        agent_out = await run_megamarket_syndicate_agent(
            adapter=adapter,
            ai_config=ai_key,
            category_id=str(best_cat_id),
            sku=db_prod.sku,
            name=db_prod.name or "",
            pim_attributes=pim_attrs,
            initial_flat=mapped_payload,
            image_urls=imgs or None,
            allow_agent_submit=req.push,
        )
        final_payload = agent_out.get("mapped_payload") or mapped_payload

        if not req.push:
            return {
                "status": "success",
                "marketplace": "megamarket",
                "category_id": str(best_cat_id),
                "mapped_payload": final_payload,
                "trace": agent_out.get("trace"),
                "submit_during_agent": agent_out.get("submit_during_agent"),
                "message": "Готово: MM tool-agent заполнил payload (dry-run)",
            }

        push_req = schemas.SyndicatePushRequest(
            product_id=str(req.product_id),
            connection_id=str(req.connection_id),
            mapped_payload=final_payload,
            mm_price_rubles=req.mm_price_rubles,
            mm_stock_quantity=req.mm_stock_quantity,
            public_base_url=req.public_base_url,
        )
        push_result = await syndicate_push(push_req, db=db, current_user=current_user)
        push_result["marketplace"] = "megamarket"
        push_result["category_id"] = str(best_cat_id)
        push_result["trace"] = agent_out.get("trace")
        push_result["submit_during_agent"] = agent_out.get("submit_during_agent")
        return push_result

    from backend.services.adapters import get_adapter
    from backend.services.ai_service import map_schema_to_marketplace, generate_category_query, select_best_category

    prod_res = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
    db_prod = prod_res.scalars().first()
    if not db_prod:
        raise HTTPException(404, "Product not found")

    adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))

    target_schema: Dict[str, Any] = {}
    best_cat_id = (req.category_id or "").strip() or None
    user_payload: Dict[str, Any] = {}
    if isinstance(req.mapped_payload, dict) and req.mapped_payload:
        user_payload = copy.deepcopy(req.mapped_payload)
        if not best_cat_id:
            from_payload_cat = str(user_payload.get("categoryId") or "").strip()
            best_cat_id = from_payload_cat or None
    if not best_cat_id:
        search_query = await generate_category_query(db_prod.attributes_data, ai_key)
        found_categories = await adapter.search_categories(search_query)
        if found_categories:
            cat_select = await select_best_category(db_prod.attributes_data, found_categories, ai_key)
            best_cat_id = cat_select.get("category_id")
    if best_cat_id:
        target_schema = await adapter.get_category_schema(str(best_cat_id))

    # Всегда строим свежий маппинг по схеме MP, затем накладываем пользовательские правки.
    pim_attrs = dict(db_prod.attributes_data) if db_prod.attributes_data else {}
    pim_attrs["Артикул (SKU)"] = db_prod.sku
    mapped_payload: Dict[str, Any] = {}
    mapped_res = await map_schema_to_marketplace(pim_attrs, db_conn.type, target_schema, ai_key)
    mapped_payload_raw = mapped_res.get("mapped_payload", mapped_res)
    if isinstance(mapped_payload_raw, dict):
        mapped_payload = mapped_payload_raw
    # Для MM добавляем исходные признаки товара как fallback-источник:
    # если AI-мэппер не положил русские ключи схемы, адаптер всё равно сможет наполнить карточку.
    if db_conn.type == "megamarket":
        for k, v in pim_attrs.items():
            if k not in mapped_payload and v not in (None, ""):
                mapped_payload[k] = v
    if user_payload:
        mapped_payload.update(user_payload)
    if best_cat_id and db_conn.type in ("megamarket", "yandex", "ozon"):
        mapped_payload["categoryId"] = best_cat_id

    base = (req.public_base_url or os.getenv("PUBLIC_API_BASE_URL", "")).strip().rstrip("/")
    if db_prod.images:
        pics: List[str] = []
        for im in db_prod.images:
            s = str(im).strip()
            if not s:
                continue
            if s.startswith("http"):
                pics.append(s)
            elif s.startswith("/") and base:
                pics.append(base + s)
        if pics:
            mapped_payload["Фото"] = pics

    if not req.push:
        return {
            "status": "success",
            "marketplace": db_conn.type,
            "category_id": best_cat_id,
            "mapped_payload": mapped_payload,
            "message": "Готово: payload собран (dry-run, без отправки)",
        }

    push_req = schemas.SyndicatePushRequest(
        product_id=str(req.product_id),
        connection_id=str(req.connection_id),
        mapped_payload=mapped_payload,
        mm_price_rubles=req.mm_price_rubles,
        mm_stock_quantity=req.mm_stock_quantity,
        public_base_url=req.public_base_url,
    )
    push_result = await syndicate_push(push_req, db=db, current_user=current_user)
    push_result["marketplace"] = db_conn.type
    push_result["category_id"] = best_cat_id
    return push_result


@app.get("/api/v1/syndicate/categories/search")
async def search_market_categories(
    connection_id: str,
    q: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == connection_id))
    db_conn = conn_res.scalars().first()
    if not db_conn: raise HTTPException(404)
    
    from backend.services.adapters import get_adapter
    adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
    
    results = await adapter.search_categories(q)
    return {"categories": results}

@app.get("/api/v1/syndicate/dictionary")
async def get_market_dictionary(connection_id: str, category_id: str, dictionary_id: str, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == connection_id))
    db_conn = conn_res.scalars().first()
    if not db_conn: raise HTTPException(404)
    from backend.services.adapters import get_adapter
    adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
    return await adapter.get_dictionary(category_id, dictionary_id)


@app.post("/api/v1/attribute-star-map/build")
async def build_attribute_star_map(
    req: schemas.AttributeStarMapBuildRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    oz_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == req.ozon_connection_id))
    mm_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == req.megamarket_connection_id))
    oz_conn = oz_res.scalars().first()
    mm_conn = mm_res.scalars().first()
    if not oz_conn or oz_conn.type != "ozon":
        raise HTTPException(404, "Ozon connection not found")
    if not mm_conn or mm_conn.type != "megamarket":
        raise HTTPException(404, "Megamarket connection not found")

    import uuid as _uuid
    task_id = str(_uuid.uuid4())
    key = f"task:star_map_build:{task_id}"
    now_ts = int(time.time())
    redis_client.hset(
        key,
        mapping={
            "task_id": task_id,
            "status": "queued",
            "stage": "queued",
            "progress_percent": 0,
            "message": "Задача поставлена в очередь Celery",
            "started_at_ts": now_ts,
            "updated_at_ts": now_ts,
            "finished_at_ts": "",
            "error": "",
            "result": "",
        },
    )
    redis_client.expire(key, 60 * 60 * 24 * 7)
    build_attribute_star_map_task.delay(
        task_id,
        oz_conn.api_key,
        oz_conn.client_id,
        mm_conn.api_key,
        req.max_ozon_categories,
        req.max_megamarket_categories,
        req.edge_threshold,
    )
    return {"ok": True, "task_id": task_id, "status": "queued", "stage": "queued", "message": "queued_celery_job"}


@app.get("/api/v1/attribute-star-map/build/status")
async def build_attribute_star_map_status(
    task_id: str,
    current_user: models.User = Depends(get_current_user),
):
    key = f"task:star_map_build:{task_id}"
    raw = redis_client.hgetall(key) or {}
    if raw:
        out: Dict[str, Any] = {"ok": True}
        for k, v in raw.items():
            if k in {"progress_percent", "started_at_ts", "updated_at_ts", "finished_at_ts"}:
                try:
                    out[k] = int(str(v).strip()) if str(v).strip() else 0
                except Exception:
                    out[k] = 0
                continue
            if k in {"result", "progress_extra"}:
                try:
                    out[k] = json.loads(v) if v else {}
                except Exception:
                    out[k] = {}
                continue
            out[k] = v
        return out
    return get_attribute_star_map_build_status(task_id)


@app.get("/api/v1/attribute-star-map/search")
async def attribute_star_map_search(
    q: str,
    limit: int = 10,
    current_user: models.User = Depends(get_current_user),
):
    return search_attribute_star_map(q, limit=limit)


@app.get("/api/v1/attribute-star-map/nodes")
async def attribute_star_map_nodes(
    q: str = "",
    platform: str | None = None,
    limit: int = 40,
    current_user: models.User = Depends(get_current_user),
):
    return search_attribute_star_nodes(q, platform=platform, limit=limit)


@app.get("/api/v1/attribute-star-map/state")
async def attribute_star_map_state(
    edge_limit: int = 300,
    current_user: models.User = Depends(get_current_user),
):
    return get_attribute_star_map_state(edge_limit=edge_limit)


@app.post("/api/v1/attribute-star-map/manual-vector")
async def attribute_star_map_manual_vector(
    req: schemas.AttributeStarMapManualOverrideRequest,
    current_user: models.User = Depends(get_current_user),
):
    return upsert_manual_vector_override(
        from_name=req.from_name,
        to_name=req.to_name,
        from_category_id=req.from_category_id,
        to_category_id=req.to_category_id,
        from_attribute_id=req.from_attribute_id,
        to_attribute_id=req.to_attribute_id,
        score=req.score,
    )


@app.post("/api/v1/attribute-star-map/manual-vector/delete")
async def attribute_star_map_manual_vector_delete(
    override_id: str,
    current_user: models.User = Depends(get_current_user),
):
    return delete_manual_vector_override(override_id)


@app.get("/api/v1/attribute-star-map/categories")
async def attribute_star_map_categories(
    platform: str,
    current_user: models.User = Depends(get_current_user),
):
    return get_attribute_star_categories(platform)


@app.get("/api/v1/attribute-star-map/category/attributes")
async def attribute_star_map_category_attributes(
    platform: str,
    category_id: str,
    limit: int = 2000,
    current_user: models.User = Depends(get_current_user),
):
    return get_attribute_star_category_attributes(platform, category_id, limit=limit)


@app.get("/api/v1/attribute-star-map/category/links")
async def attribute_star_map_category_links(
    ozon_category_id: str,
    megamarket_category_id: str,
    limit: int = 1000,
    current_user: models.User = Depends(get_current_user),
):
    return get_attribute_star_category_links(ozon_category_id, megamarket_category_id, limit=limit)


@app.post("/api/v1/integrations/{connection_id}/export")
async def export_to_marketplace_bulk(
    connection_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == connection_id))
    db_conn = conn_res.scalars().first()
    if not db_conn: raise HTTPException(404, "Connection not found")
    
    ss = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == 'deepseek_api_key'))
    ai_key = ss.scalars().first()
    if not ai_key or not ai_key.value: raise HTTPException(400, "DeepSeek API Key missing")
    
    prod_res = await db.execute(select(models.Product.id))
    all_prods = prod_res.scalars().all()
    
    import uuid
    from backend.celery_worker import process_single_syndicate_task, redis_client
    task_id = str(uuid.uuid4())
    total = len(all_prods)
    
    redis_client.set(f"task:{task_id}:total", total)
    redis_client.set(f"task:{task_id}:processed", 0)
    redis_client.set(f"task:{task_id}:success", 0)
    redis_client.set(f"task:{task_id}:failed", 0)
    redis_client.set(f"task:{task_id}:current_sku", "Starting push...")
    redis_client.delete(f"task:{task_id}:logs")
    redis_client.rpush(f"task:{task_id}:logs", "[INIT] Push-all task created")
    
    for pid in all_prods:
        process_single_syndicate_task.delay(str(pid), connection_id, ai_key.value, task_id)
        
    return {"status": "success", "task_id": task_id, "message": f"Queued {total} products for export"}

@app.post("/api/v1/syndicate/push")
async def syndicate_push(req: schemas.SyndicatePushRequest, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    conn_res = await db.execute(select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == req.connection_id))
    db_conn = conn_res.scalars().first()
    if not db_conn: raise HTTPException(404)

    from backend.services.adapters import (
        get_adapter,
        megamarket_httpx_client,
        format_megamarket_error_message,
        megamarket_request_headers,
    )
    adapter = get_adapter(db_conn.type, db_conn.api_key, db_conn.client_id, db_conn.store_id, getattr(db_conn, "warehouse_id", None))
    
    prod_res = await db.execute(select(models.Product).where(models.Product.id == req.product_id))
    db_prod = prod_res.scalars().first()
    if not db_prod: raise HTTPException(404, "Product not found")

    async def megamarket_post_card_price_stock() -> None:
        """После успешного card/* — отдельные вызовы price/stock по док. MM (нужен locationId склада)."""
        if db_conn.type != "megamarket":
            return
        loc = getattr(db_conn, "warehouse_id", None) or os.getenv("MEGAMARKET_DEFAULT_LOCATION_ID", "").strip()
        if not loc or not hasattr(adapter, "update_price_by_offer_id"):
            return
        extra_msgs = []
        if req.mm_price_rubles is not None:
            pr = await adapter.update_price_by_offer_id(loc, str(db_prod.sku)[:35], float(req.mm_price_rubles))
            extra_msgs.append(f"цена API {pr.get('status_code')}")
        if req.mm_stock_quantity is not None:
            st = await adapter.update_stock_by_offer_id(loc, str(db_prod.sku)[:35], int(req.mm_stock_quantity))
            extra_msgs.append(f"остаток API {st.get('status_code')}")
        if extra_msgs:
            log.info("megamarket post-push: %s", " ".join(extra_msgs))
    
    req.mapped_payload["offer_id"] = db_prod.sku
    req.mapped_payload["name"] = db_prod.name
    if db_conn.type == "megamarket" and not req.mapped_payload.get("Фото"):
        mm_base = (req.public_base_url or os.getenv("PUBLIC_API_BASE_URL", "")).strip().rstrip("/")
        auto_photos: List[str] = []
        for im in (db_prod.images or []):
            s = str(im).strip()
            if not s:
                continue
            if s.startswith("http"):
                auto_photos.append(s)
            elif s.startswith("/") and mm_base:
                auto_photos.append(mm_base + s)
        if auto_photos:
            req.mapped_payload["Фото"] = auto_photos

    def _first_non_empty_from_payload(payload: Dict[str, Any], keys: List[str]) -> Any:
        for k in keys:
            v = payload.get(k)
            if v is None:
                continue
            if isinstance(v, str) and not v.strip():
                continue
            if isinstance(v, list) and len(v) == 0:
                continue
            return v
        return None

    def _extract_barcode(payload: Dict[str, Any], attrs: Dict[str, Any]) -> str:
        raw = _first_non_empty_from_payload(
            payload,
            ["Штрихкод", "Штрих-код", "barcode", "Barcode", "EAN", "ean", "GTIN", "gtin", "barcodes"],
        )
        if raw is None:
            raw = _first_non_empty_from_payload(
                attrs,
                ["Штрихкод", "Штрих-код", "barcode", "Barcode", "EAN", "ean", "GTIN", "gtin", "barcodes"],
            )
        candidates: List[str] = []
        if isinstance(raw, (list, tuple, set)):
            for item in raw:
                digits = "".join(c for c in str(item) if c.isdigit())
                if digits:
                    candidates.append(digits)
        else:
            raw_s = str(raw or "")
            for m in re.findall(r"\d{8,14}", raw_s):
                digits = "".join(c for c in m if c.isdigit())
                if digits:
                    candidates.append(digits)
            digits = "".join(c for c in raw_s if c.isdigit())
            if digits:
                candidates.append(digits)
        for c in candidates:
            if len(c) in {8, 12, 13, 14}:
                return c
        return candidates[0] if candidates else ""

    if db_conn.type == "megamarket":
        prod_attrs = dict(db_prod.attributes_data) if db_prod.attributes_data else {}
        preflight_missing: List[Dict[str, str]] = []
        photos_value = _first_non_empty_from_payload(req.mapped_payload, ["Фото", "images", "photos", "Изображения", "Фотографии"])
        has_photos = bool(photos_value) and (not isinstance(photos_value, list) or len(photos_value) > 0)
        if not has_photos:
            preflight_missing.append({"field": "Фото", "reason": "Нет изображений в payload/товаре"})
        barcode_value = _extract_barcode(req.mapped_payload, prod_attrs)
        if barcode_value:
            req.mapped_payload["Штрихкод"] = barcode_value
        else:
            preflight_missing.append({"field": "Штрихкод", "reason": "Нет валидного EAN/GTIN (8/12/13/14 цифр)"})
        model_value = _first_non_empty_from_payload(
            req.mapped_payload,
            ["Наименование модели", "Модель", "model", "model_number", "model_code"],
        ) or _first_non_empty_from_payload(
            prod_attrs,
            ["Наименование модели", "Модель", "model", "model_number", "model_code"],
        )
        if not model_value:
            preflight_missing.append({"field": "Модель", "reason": "Нет значения модели в PIM/названии"})
        review_all_fields: List[Dict[str, Any]] = []
        cat_for_review = req.mapped_payload.get("categoryId")
        if cat_for_review:
            try:
                schema_data = await adapter.get_category_schema(str(cat_for_review))
                attrs = schema_data.get("attributes", []) if isinstance(schema_data, dict) else []
                seen_names: set[str] = set()
                for a in attrs:
                    if not isinstance(a, dict):
                        continue
                    nm = str(a.get("name") or "").strip()
                    if not nm or nm in seen_names:
                        continue
                    seen_names.add(nm)
                    cur = req.mapped_payload.get(nm)
                    empty = cur is None or (isinstance(cur, str) and not cur.strip()) or (isinstance(cur, list) and len(cur) == 0)
                    item: Dict[str, Any] = {
                        "name": nm,
                        "attribute_id": str(a.get("id") or ""),
                        "value_type": str(a.get("valueTypeCode") or ""),
                        "is_required": bool(a.get("is_required")),
                        "current_value": cur,
                    }
                    if empty:
                        item["missing"] = True
                    dvals = a.get("dictionary_options") or []
                    if dvals:
                        item["dictionary_id"] = str(a.get("id") or "")
                        item["dictionary_options"] = dvals[:200]
                    review_all_fields.append(item)
            except Exception:
                review_all_fields = []
        if preflight_missing:
            return {
                "status": "preflight_blocked",
                "message": "Megamarket preflight: карточка заблокирована до отправки. Заполните критичные поля.",
                "preflight_missing": preflight_missing,
                "review_all_fields": review_all_fields,
                "payload_sent": req.mapped_payload,
            }
    
    try:
        prev_public_base = os.getenv("PUBLIC_API_BASE_URL")
        # Allow runtime override from request for MM image proxy domain.
        if db_conn.type == "megamarket" and req.public_base_url:
            os.environ["PUBLIC_API_BASE_URL"] = str(req.public_base_url).strip().rstrip("/")
        # Глубокая копия: nested поля (Фото, атрибуты) не должны мутировать при AI-починке
        cached_payload = copy.deepcopy(req.mapped_payload)
        cached_cat_id = cached_payload.get("categoryId")
        
        res = await adapter.push_product(req.mapped_payload)
        if int(res.get("status_code", 500)) >= 400:
            raw = str(res.get("response", "") or "")
            api_detail = (
                format_megamarket_error_message(int(res.get("status_code", 500)), raw)
                if db_conn.type == "megamarket"
                else raw[:200]
            )
            return {"status": "error", "message": f"HTTP {res['status_code']} | Ошибка API: {api_detail}", "payload_sent": req.mapped_payload}
        
        if db_conn.type == "megamarket":
            from backend.models import SystemSettings
            from backend.services.ai_service import get_client_and_model
            strict_verified_only = True
            # adapter.push_product can normalize payload (e.g. image proxy urls).
            # Keep the normalized version for UI/operator review.
            cached_payload = copy.deepcopy(req.mapped_payload)
            mm_base = (req.public_base_url or os.getenv("PUBLIC_API_BASE_URL", "")).strip().rstrip("/")
            if not cached_payload.get("Фото"):
                auto_pics: List[str] = []
                for im in (db_prod.images or []):
                    s = str(im).strip()
                    if not s:
                        continue
                    if s.startswith("http"):
                        auto_pics.append(s)
                    elif s.startswith("/") and mm_base:
                        auto_pics.append(mm_base + s)
                if auto_pics:
                    req.mapped_payload["Фото"] = auto_pics
                    cached_payload["Фото"] = auto_pics

            async def _poll_mm_errors() -> tuple[list, bool]:
                headers_st = megamarket_request_headers(db_conn.api_key, for_post=True)
                payload_st = {"filter": {"offerId": [db_prod.sku]}, "limit": 10}
                settled_ok_hits = 0
                last_status = "UNKNOWN"
                async with megamarket_httpx_client(10.0) as st_client:
                    # MM валидирует асинхронно: ждём до ~4 минут и требуем несколько "чистых" проверок подряд.
                    for _ in range(32):
                        await asyncio.sleep(8)
                        st_res = await st_client.post(
                            "https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/card/get",
                            headers=headers_st,
                            json=payload_st,
                        )
                        if st_res.status_code == 200:
                            try:
                                cards = st_res.json().get("data", {}).get("cardsInfo", [])
                                if cards:
                                    last_status = (
                                        cards[0].get("status", {}).get("code")
                                        or cards[0].get("status", {}).get("name")
                                        or last_status
                                    )
                            except (ValueError, KeyError, TypeError) as e:
                                log.debug("megamarket card/get status parse: %s", e)
                        err_raw_local = await adapter.get_async_errors(db_prod.sku)
                        if err_raw_local:
                            try:
                                parsed = json.loads(err_raw_local)
                                if isinstance(parsed, list):
                                    return parsed, True
                                if isinstance(parsed, dict):
                                    return [parsed], True
                                return [{"message": str(parsed)}], True
                            except json.JSONDecodeError:
                                return [{"message": err_raw_local}], True

                        st_up = str(last_status).upper()
                        if st_up in {"ERROR", "CHANGES_REJECTED", "BLOCKED"}:
                            # Иногда getError запаздывает относительно статуса. Дополнительно перепроверяем ошибки.
                            for _ in range(4):
                                await asyncio.sleep(4)
                                err_retry = await adapter.get_async_errors(db_prod.sku)
                                if err_retry:
                                    try:
                                        parsed_retry = json.loads(err_retry)
                                        if isinstance(parsed_retry, list):
                                            return parsed_retry, True
                                        if isinstance(parsed_retry, dict):
                                            return [parsed_retry], True
                                    except json.JSONDecodeError:
                                        return [{"message": err_retry}], True
                            # Нет детализации ошибок — считаем, что проверка ещё не устаканилась.
                            return [], False
                        if st_up in {"ACTIVE"}:
                            settled_ok_hits += 1
                            if settled_ok_hits >= 2:
                                return [], True
                        else:
                            settled_ok_hits = 0
                return [], False

            def _first(*keys: str) -> Optional[Any]:
                src = db_prod.attributes_data or {}
                for k in keys:
                    v = current_payload.get(k)
                    if v not in (None, ""):
                        return v
                    v2 = src.get(k)
                    if v2 not in (None, ""):
                        return v2
                return None

            def _to_num(v: Any) -> Optional[float]:
                if v is None:
                    return None
                try:
                    return float(str(v).replace(",", ".").strip())
                except Exception:
                    return None

            def _mm_fix_required_2001(payload: Dict[str, Any], errs: list) -> tuple[Dict[str, Any], bool]:
                fixed = copy.deepcopy(payload)
                changed = False
                name_blob = " ".join(
                    [
                        str(fixed.get("full_name", "") or ""),
                        str(fixed.get("name", "") or ""),
                        str(fixed.get("Наименование карточки", "") or ""),
                    ]
                ).lower()
                title_power = re.search(r"(\d{2,5})\s*вт", name_blob)
                title_volume = re.search(r"(\d{1,3}(?:[.,]\d+)?)\s*л", name_blob)
                for e in errs:
                    if not isinstance(e, dict):
                        continue
                    if str(e.get("code", "")) != "2001":
                        continue
                    name = str(e.get("attributeName") or "").strip().lower()
                    if not name:
                        continue
                    if "быстрый старт" in name and not fixed.get("Быстрый старт"):
                        features_txt = str(_first("features", "Функции", "Особенности") or "").lower()
                        if "быстр" in features_txt and "старт" in features_txt:
                            fixed["Быстрый старт"] = "Да"
                            changed = True
                    elif name == "вид" and not fixed.get("Вид"):
                        v = _first("Вид", "installation_type", "type")
                        if v:
                            fixed["Вид"] = v
                            changed = True
                    elif "высота" in name and "см" in name and not fixed.get("Высота, см"):
                        h = _to_num(_first("Высота, см", "height_mm", "height"))
                        if h is not None:
                            if h > 120:
                                h = h / 10.0
                            fixed["Высота, см"] = f"{h:g}"
                            changed = True
                    elif "глубина" in name and "см" in name and not fixed.get("Глубина, см"):
                        d = _to_num(_first("Глубина, см", "depth_mm", "depth"))
                        if d is not None:
                            if d > 120:
                                d = d / 10.0
                            fixed["Глубина, см"] = f"{d:g}"
                            changed = True
                    elif "дисплей" in name and not fixed.get("Дисплей"):
                        features_txt = str(_first("features", "Функции", "Особенности", "display") or "").lower()
                        if "диспле" in features_txt:
                            fixed["Дисплей"] = "Да"
                            changed = True
                    elif "механизм открыв" in name and not fixed.get("Механизм открывания дверцы"):
                        mech = _first("Механизм открывания дверцы", "door_handle_type", "door_opening_direction")
                        if mech:
                            fixed["Механизм открывания дверцы"] = mech
                            changed = True
                    elif "мощность микроволн" in name and not fixed.get("Мощность микроволн, Вт"):
                        p = _to_num(_first("Мощность микроволн, Вт", "microwave_power_w", "total_power_w", "power_consumption_w"))
                        if p is None and title_power:
                            try:
                                p = float(title_power.group(1))
                            except Exception:
                                p = None
                        if p is not None:
                            fixed["Мощность микроволн, Вт"] = int(p)
                            changed = True
                    elif "объем" in name and "л" in name and not fixed.get("Объем, л"):
                        v = _to_num(_first("Объем, л", "volume_liters", "internal_volume_l"))
                        if v is None and title_volume:
                            try:
                                v = float(title_volume.group(1).replace(",", "."))
                            except Exception:
                                v = None
                        if v is not None:
                            fixed["Объем, л"] = f"{v:g}"
                            changed = True
                    elif name == "тип" and not fixed.get("Тип"):
                        t = _first("Тип", "type", "microwave_type")
                        if not t:
                            if "соло" in name_blob:
                                t = "Соло"
                            elif "встраиваем" in name_blob:
                                t = "Встраиваемая"
                        if t:
                            fixed["Тип"] = t
                            changed = True
                    elif "управление" in name and not fixed.get("Управление"):
                        control = _first("Управление", "control_type", "control_interface")
                        if control:
                            fixed["Управление"] = control
                            changed = True
                return fixed, changed

            async def _mm_fix_attr_not_in_category(payload: Dict[str, Any], errs: list) -> tuple[Dict[str, Any], bool]:
                """
                Детерминированный ремонт: удаляем поля, которые MM вернул как
                "атрибут отсутствует в указанной категории".
                """
                fixed = copy.deepcopy(payload)
                changed = False
                try:
                    schema_data = await adapter.get_category_schema(str(cached_cat_id)) if cached_cat_id else {}
                    attrs = schema_data.get("attributes", []) if isinstance(schema_data, dict) else []
                except Exception:
                    attrs = []
                valid_names = {str(a.get("name") or "").strip() for a in attrs if isinstance(a, dict) and str(a.get("name") or "").strip()}
                valid_names_norm = {str(a.get("name") or "").strip().lower() for a in attrs if isinstance(a, dict) and str(a.get("name") or "").strip()}
                for e in errs:
                    if not isinstance(e, dict):
                        continue
                    msg = str(e.get("message") or e.get("description") or "").lower()
                    raw_name = str(e.get("attributeName") or e.get("name") or "").strip()
                    if ("нет в указанной категории" not in msg) and ("attribute doesn't exist in category" not in msg):
                        continue
                    if raw_name:
                        # remove exact / case-insensitive matches
                        to_drop = [k for k in list(fixed.keys()) if k == raw_name or str(k).strip().lower() == raw_name.lower()]
                        for k in to_drop:
                            if k in {"categoryId", "offer_id", "offerId", "name"}:
                                continue
                            fixed.pop(k, None)
                            changed = True
                        continue
                    # fallback: prune obvious non-schema user fields
                    for k in list(fixed.keys()):
                        kk = str(k).strip()
                        if kk in {"categoryId", "offer_id", "offerId", "name", "Фото", "images", "Изображения", "Фотографии"}:
                            continue
                        if kk in valid_names or kk.lower() in valid_names_norm:
                            continue
                        fixed.pop(k, None)
                        changed = True
                return fixed, changed

            async def _mm_build_operator_missing_fields(errs: list) -> list[Dict[str, Any]]:
                """Build operator-friendly required fields with dictionary hints."""
                out: list[Dict[str, Any]] = []
                if not cached_cat_id:
                    return out
                try:
                    schema_data = await adapter.get_category_schema(str(cached_cat_id))
                    attrs = schema_data.get("attributes", []) if isinstance(schema_data, dict) else []
                except Exception:
                    attrs = []
                by_name: Dict[str, Dict[str, Any]] = {}
                by_id: Dict[str, Dict[str, Any]] = {}
                for a in attrs:
                    if not isinstance(a, dict):
                        continue
                    nm = str(a.get("name") or "").strip().lower()
                    aid = str(a.get("id") or "").strip()
                    if nm:
                        by_name[nm] = a
                    if aid:
                        by_id[aid] = a
                seen: set[str] = set()
                for e in errs:
                    if not isinstance(e, dict):
                        continue
                    if str(e.get("code", "")) != "2001":
                        continue
                    raw_name = str(e.get("attributeName") or e.get("name") or "").strip()
                    raw_id = str(e.get("attributeId") or e.get("id") or "").strip()
                    sch = None
                    if raw_name:
                        sch = by_name.get(raw_name.lower())
                    if sch is None and raw_id:
                        sch = by_id.get(raw_id)
                    if sch is None and not raw_name:
                        continue
                    final_name = str((sch or {}).get("name") or raw_name).strip()
                    if not final_name or final_name in seen:
                        continue
                    final_name_norm = final_name.lower()
                    if "фото" in final_name_norm or "изображ" in final_name_norm:
                        # Photos are auto-populated from product images; don't show as manual required.
                        continue
                    seen.add(final_name)
                    dictionary_options = (sch or {}).get("dictionary_options") or []
                    item = {
                        "name": final_name,
                        "attribute_id": str((sch or {}).get("id") or raw_id or ""),
                        "value_type": str((sch or {}).get("valueTypeCode") or ""),
                        "is_required": True,
                    }
                    if dictionary_options:
                        item["dictionary_id"] = str((sch or {}).get("id") or raw_id or "")
                        item["dictionary_options"] = dictionary_options[:200]
                    out.append(item)
                return out

            async def _mm_build_required_review_fields(payload: Dict[str, Any]) -> list[Dict[str, Any]]:
                """Build required fields list from infomodel for manager review/edit."""
                out: list[Dict[str, Any]] = []
                if not cached_cat_id:
                    return out
                try:
                    schema_data = await adapter.get_category_schema(str(cached_cat_id))
                    attrs = schema_data.get("attributes", []) if isinstance(schema_data, dict) else []
                except Exception:
                    attrs = []
                seen: set[str] = set()
                for a in attrs:
                    if not isinstance(a, dict):
                        continue
                    if not bool(a.get("is_required")):
                        continue
                    nm = str(a.get("name") or "").strip()
                    if not nm or nm in seen:
                        continue
                    nm_norm = nm.lower()
                    if "фото" in nm_norm or "изображ" in nm_norm:
                        continue
                    seen.add(nm)
                    cur = payload.get(nm)
                    empty = cur is None or (isinstance(cur, str) and not cur.strip()) or (isinstance(cur, list) and len(cur) == 0)
                    item = {
                        "name": nm,
                        "attribute_id": str(a.get("id") or ""),
                        "value_type": str(a.get("valueTypeCode") or ""),
                        "is_required": True,
                        "current_value": cur,
                    }
                    if empty:
                        item["missing"] = True
                    dvals = a.get("dictionary_options") or []
                    if dvals:
                        item["dictionary_id"] = str(a.get("id") or "")
                        item["dictionary_options"] = dvals[:200]
                    out.append(item)
                return out

            async def _mm_build_all_review_fields(payload: Dict[str, Any]) -> list[Dict[str, Any]]:
                """Build full attribute list (required + optional) from infomodel."""
                out: list[Dict[str, Any]] = []
                if not cached_cat_id:
                    return out
                try:
                    schema_data = await adapter.get_category_schema(str(cached_cat_id))
                    attrs = schema_data.get("attributes", []) if isinstance(schema_data, dict) else []
                except Exception:
                    attrs = []
                seen: set[str] = set()
                for a in attrs:
                    if not isinstance(a, dict):
                        continue
                    nm = str(a.get("name") or "").strip()
                    if not nm or nm in seen:
                        continue
                    seen.add(nm)
                    cur = payload.get(nm)
                    empty = cur is None or (isinstance(cur, str) and not cur.strip()) or (isinstance(cur, list) and len(cur) == 0)
                    item = {
                        "name": nm,
                        "attribute_id": str(a.get("id") or ""),
                        "value_type": str(a.get("valueTypeCode") or ""),
                        "is_required": bool(a.get("is_required")),
                        "current_value": cur,
                    }
                    if empty:
                        item["missing"] = True
                    dvals = a.get("dictionary_options") or []
                    if dvals:
                        item["dictionary_id"] = str(a.get("id") or "")
                        item["dictionary_options"] = dvals[:200]
                    out.append(item)
                return out

            def _mm_quality_warnings(payload: Dict[str, Any]) -> list[Dict[str, Any]]:
                warnings: list[Dict[str, Any]] = []
                photos = payload.get("Фото") or payload.get("images") or payload.get("Изображения") or payload.get("Фотографии")
                has_photos = bool(photos) and (not isinstance(photos, list) or len(photos) > 0)
                if not has_photos:
                    warnings.append({"field": "Фото", "code": "missing_photos", "message": "Нет изображений в payload"})
                barcode = str(payload.get("Штрихкод") or payload.get("Штрих-код") or payload.get("EAN") or payload.get("GTIN") or "").strip()
                if not barcode:
                    warnings.append({"field": "Штрихкод", "code": "missing_barcode", "message": "Нет штрихкода в payload"})
                brand = str(payload.get("Бренд") or payload.get("brand") or "").strip()
                if not brand:
                    warnings.append({"field": "Бренд", "code": "missing_brand", "message": "Нет бренда в payload"})
                model = str(payload.get("Наименование модели") or payload.get("Модель") or payload.get("model") or "").strip()
                if not model:
                    warnings.append({"field": "Модель", "code": "missing_model", "message": "Нет модели в payload"})
                return warnings

            current_payload = copy.deepcopy(cached_payload)
            err_list, settled = await _poll_mm_errors()
            for _attempt in range(8):
                if not err_list:
                    if not settled:
                        review_fields = await _mm_build_required_review_fields(current_payload)
                        review_all_fields = await _mm_build_all_review_fields(current_payload)
                        return {
                            "status": "pending",
                            "message": "Megamarket: карточка ещё в отложенной проверке. Повторите проверку через 2-5 минут.",
                            "missing_fields": [x for x in review_fields if x.get("missing")],
                            "review_required_fields": review_fields,
                            "review_all_fields": review_all_fields,
                            "quality_warnings": _mm_quality_warnings(current_payload),
                            "payload_sent": current_payload,
                        }
                    await megamarket_post_card_price_stock()
                    review_fields = await _mm_build_required_review_fields(current_payload)
                    review_all_fields = await _mm_build_all_review_fields(current_payload)
                    return {
                        "status": "success",
                        "message": "HTTP 200 | Megamarket: карточка прошла проверку без ошибок getError.",
                        "missing_fields": [x for x in review_fields if x.get("missing")],
                        "review_required_fields": review_fields,
                        "review_all_fields": review_all_fields,
                        "quality_warnings": _mm_quality_warnings(current_payload),
                        "payload_sent": current_payload,
                    }
                # 0) Техническая ошибка MM exportError code=500 -> повтор отправки без AI-ремонта.
                is_export_500 = True
                for item in err_list:
                    if not isinstance(item, dict):
                        is_export_500 = False
                        break
                    code = str(item.get("code", "")).strip()
                    msg = str(item.get("message") or item.get("description") or "").lower()
                    if code != "500" or ("техничес" not in msg and "technical" not in msg):
                        is_export_500 = False
                        break
                if is_export_500:
                    res_retry = await adapter.push_product(current_payload)
                    if int(res_retry.get("status_code", 500)) >= 400:
                        return {
                            "status": "error",
                            "message": f"HTTP {res_retry.get('status_code')} | Megamarket retry failed",
                            "payload_sent": current_payload,
                        }
                    err_list, settled = await _poll_mm_errors()
                    continue

                # 0.5) MM validation: attribute not in this category -> drop offending attrs and retry.
                fixed_drop_payload, dropped = await _mm_fix_attr_not_in_category(current_payload, err_list)
                if dropped:
                    fixed_drop_payload["offerId"] = str(db_prod.sku)[:35]
                    fixed_drop_payload["offer_id"] = db_prod.sku
                    if cached_cat_id:
                        fixed_drop_payload["categoryId"] = cached_cat_id
                    res_drop = await adapter.push_product(fixed_drop_payload)
                    if int(res_drop.get("status_code", 500)) < 400:
                        current_payload = fixed_drop_payload
                        err_list, settled = await _poll_mm_errors()
                        if not err_list:
                            continue

                # 1) Сначала deterministic fix по ошибкам required (code 2001), чтобы не тратить токены ИИ.
                fixed_payload, changed = _mm_fix_required_2001(current_payload, err_list)
                if changed:
                    fixed_payload["offerId"] = str(db_prod.sku)[:35]
                    fixed_payload["offer_id"] = db_prod.sku
                    if cached_cat_id:
                        fixed_payload["categoryId"] = cached_cat_id
                    res_det = await adapter.push_product(fixed_payload)
                    if int(res_det.get("status_code", 500)) < 400:
                        current_payload = fixed_payload
                        err_list, settled = await _poll_mm_errors()
                        if not err_list:
                            continue
                if strict_verified_only:
                    non_required_only = []
                    for it in err_list:
                        if isinstance(it, dict) and str(it.get("code", "")) == "2001":
                            non_required_only.append(it)
                    if len(non_required_only) != len(err_list):
                        return {
                            "status": "error",
                            "message": f"Megamarket async validation errors remain: {json.dumps(err_list[:10], ensure_ascii=False)}",
                            "payload_sent": current_payload,
                        }
                    operator_missing_fields = await _mm_build_operator_missing_fields(err_list)
                    review_fields = await _mm_build_required_review_fields(current_payload)
                    review_all_fields = await _mm_build_all_review_fields(current_payload)
                    return {
                        "status": "pending_required",
                        "message": "Megamarket: остались обязательные поля без подтвержденного источника. Добавьте фактические данные в PIM/название и повторите.",
                        "errors": err_list[:30],
                        "missing_fields": operator_missing_fields,
                        "review_required_fields": review_fields,
                        "review_all_fields": review_all_fields,
                        "quality_warnings": _mm_quality_warnings(current_payload),
                        "payload_sent": current_payload,
                    }
                ss = await db.execute(select(SystemSettings).where(SystemSettings.id == "deepseek_api_key"))
                ai_key_obj = ss.scalars().first()
                if not ai_key_obj:
                    break
                client, model_name = get_client_and_model(ai_key_obj.value)
                repair_prompt = f"""
                You are an expert E-Commerce API JSON repair agent.
                We submitted a product to Megamarket but received these asynchronous validation errors:
                {json.dumps(err_list, ensure_ascii=False)}

                Original Payload Submitted:
                {json.dumps(current_payload, ensure_ascii=False)}

                Rules:
                1. Read the errors carefully. If it expects a boolean, convert to \"true\" or \"false\".
                2. If attribute doesn't exist in category, delete it.
                3. Do NOT invent values. Use only values already present in payload/source context.
                4. For enum fields use ONLY exact values from dictionary; if no exact match, remove that field.
                5. Return ONLY repaired JSON object.
                """
                try:
                    ai_res = await client.chat.completions.create(
                        model=model_name,
                        messages=[{"role": "user", "content": repair_prompt}],
                        response_format={"type": "json_object"},
                    )
                    raw_ai = ai_res.choices[0].message.content.strip()
                    if raw_ai.startswith("```json"):
                        raw_ai = raw_ai[7:]
                    if raw_ai.startswith("```"):
                        raw_ai = raw_ai[3:]
                    if raw_ai.endswith("```"):
                        raw_ai = raw_ai[:-3]
                    repaired_payload = json.loads(raw_ai.strip())
                    repaired_payload["offerId"] = str(db_prod.sku)[:35]
                    repaired_payload["offer_id"] = db_prod.sku
                    if cached_cat_id:
                        repaired_payload["categoryId"] = cached_cat_id
                    res2 = await adapter.push_product(repaired_payload)
                    if int(res2.get("status_code", 500)) >= 400:
                        return {
                            "status": "error",
                            "message": f"HTTP {res2.get('status_code')} | Megamarket rejected repaired payload",
                            "payload_sent": repaired_payload,
                        }
                    current_payload = repaired_payload
                    err_list, settled = await _poll_mm_errors()
                except Exception as ai_e:
                    log.debug("Auto-healing AI failed: %s", ai_e)
                    break

            if err_list:
                return {
                    "status": "error",
                    "message": f"Megamarket async validation errors remain: {json.dumps(err_list[:10], ensure_ascii=False)}",
                    "payload_sent": current_payload,
                }
            await megamarket_post_card_price_stock()

        if db_conn.type == "ozon":
            from backend.models import SystemSettings
            from backend.services.ai_service import get_client_and_model

            oz_flat = copy.deepcopy(cached_payload)
            oz_cat = oz_flat.get("categoryId")
            err_raw = None
            for _ in range(24):
                await asyncio.sleep(4)
                err_raw = await adapter.get_async_errors(db_prod.sku)
                if err_raw:
                    break

            err_list = []
            if err_raw:
                try:
                    parsed = json.loads(err_raw)
                    if isinstance(parsed, list):
                        err_list = parsed
                    elif isinstance(parsed, dict):
                        err_list = [parsed]
                except json.JSONDecodeError:
                    err_list = [{"message": err_raw}]

            if len(err_list) > 0:
                ss = await db.execute(select(SystemSettings).where(SystemSettings.id == "deepseek_api_key"))
                ai_key_obj = ss.scalars().first()
                if ai_key_obj:
                    client, model_name = get_client_and_model(ai_key_obj.value)
                    repair_prompt = (
                        "You are an expert Ozon Seller API assistant. "
                        "Products are uploaded from a PIM as a FLAT JSON object: keys are Ozon attribute names (Russian) "
                        "from the category schema, plus categoryId (descriptionCategoryId_typeId as string), offer_id, name, "
                        "Фото (image URLs), price-related keys. The server converts this flat object to POST /v2/product/import.\n\n"
                        "Async validation errors from Ozon (JSON):\n"
                        f"{json.dumps(err_list, ensure_ascii=False)}\n\n"
                        "Flat payload that was sent:\n"
                        f"{json.dumps(oz_flat, ensure_ascii=False)}\n\n"
                        "Return ONLY valid JSON: the repaired FLAT object (do NOT return items[] or numeric attribute id arrays). "
                        "Fill every required attribute mentioned in errors with plausible values consistent with the product. "
                        "For enumerated attributes, use natural Russian marketplace wording. "
                        "Preserve categoryId, offer_id, name, and image fields when present."
                    )
                    try:
                        ai_res = await client.chat.completions.create(
                            model=model_name,
                            messages=[{"role": "user", "content": repair_prompt}],
                            response_format={"type": "json_object"},
                        )
                        raw_ai = ai_res.choices[0].message.content.strip()
                        repaired_payload = json.loads(raw_ai.strip())
                        repaired_payload["offer_id"] = db_prod.sku
                        repaired_payload["name"] = db_prod.name
                        if oz_cat is not None:
                            repaired_payload["categoryId"] = oz_cat
                        res2 = await adapter.push_product(repaired_payload)
                        if int(res2.get("status_code", 500)) < 400:
                            return {
                                "status": "success",
                                "message": (
                                    f"HTTP 200 | Ozon: повторная выгрузка после автоисправления по ответу API "
                                    f"({len(err_list)} сраб.)."
                                ),
                                "payload_sent": repaired_payload,
                            }
                    except Exception as ai_e:
                        log.debug("Ozon auto-healing AI failed: %s", ai_e)

        msg = f"HTTP {res['status_code']} | Ответ API: {res.get('response', '')[:200]}"
        if db_conn.type == "megamarket" and (req.mm_price_rubles is not None or req.mm_stock_quantity is not None):
            msg += " (проверьте ответы price/stock в логах при указании склада warehouse_id)"
        return {"status": "success", "message": msg, "payload_sent": req.mapped_payload}
    except Exception as e:
        return {"status": "error", "message": f"Критическая ошибка выгрузки: {str(e)}", "payload_sent": req.mapped_payload}
    finally:
        if db_conn.type == "megamarket":
            if prev_public_base is None:
                os.environ.pop("PUBLIC_API_BASE_URL", None)
            else:
                os.environ["PUBLIC_API_BASE_URL"] = prev_public_base


from pydantic import EmailStr
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: str = "manager"

class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    class Config:
        orm_mode = True
        from_attributes = True

@app.get("/api/v1/users", response_model=List[UserResponse])
async def get_users(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(select(models.User))
    return result.scalars().all()

@app.post("/api/v1/users", response_model=UserResponse)
async def create_user(user: UserCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(select(models.User).filter(models.User.email == user.email))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    from backend.services.auth import get_password_hash
    hashed_password = get_password_hash(user.password)
    new_user = models.User(email=user.email, hashed_password=hashed_password, role=user.role)
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user

@app.delete("/api/v1/users/{user_id}")
async def delete_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(select(models.User).filter(models.User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if str(user.id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    await db.delete(user)
    await db.commit()
    return {"status": "ok"}


FAILED_LOGINS = {}
MAX_ATTEMPTS = 5
LOCKOUT_TIME = 300
import time
from fastapi import Request
from fastapi.security import OAuth2PasswordRequestForm

@app.post("/api/v1/auth/login")
async def login_for_access_token(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "127.0.0.1"
    current_time = time.time()
    
    # Check Rate Limit
    if client_ip in FAILED_LOGINS:
        attempts, lock_time = FAILED_LOGINS[client_ip]
        if lock_time and current_time < lock_time:
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
        if current_time > (lock_time or current_time) + LOCKOUT_TIME:
             FAILED_LOGINS.pop(client_ip, None)
             
    result = await db.execute(select(models.User).filter(models.User.email == form_data.username))
    user = result.scalars().first()
    
    from backend.services.auth import verify_password, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES
    from datetime import timedelta
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        attempts, _ = FAILED_LOGINS.get(client_ip, (0, 0))
        attempts += 1
        if attempts >= MAX_ATTEMPTS:
            FAILED_LOGINS[client_ip] = (attempts, current_time + LOCKOUT_TIME)
        else:
            FAILED_LOGINS[client_ip] = (attempts, 0)
            
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Reset on success
    FAILED_LOGINS.pop(client_ip, None)
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "role": user.role}
