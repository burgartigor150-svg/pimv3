# PIMv3 — Claude Instructions

## Project Overview
PIM (Product Information Management) система для маркетплейсов.
- Backend: FastAPI + PostgreSQL + Redis + Celery, порт 4877
- Frontend: React + Vite, сборка в frontend/dist/
- Сервер: ssh myserver, рабочая директория /mnt/data/Pimv3
- Systemd: `sudo systemctl restart pimv3-backend.service`
- DB: `PGPASSWORD='pim_pass' psql -h localhost -U pim_user -d pim_db -p 5440`

## Маркетплейсы
- Ozon, Megamarket (3 магазина), Wildberries, Яндекс Маркет
- Адаптеры: backend/services/adapters.py
- Каждый адаптер: list_products, pull_product, push_product, get_category_schema, get_dictionary

## Syndication (Push) Flow
Универсальный smart push для всех МП:
1. Резолв категории по PIM-категории (prefix matching по leaf name)
2. Pull существующих атрибутов с МП
3. PIM данные как fallback
4. ИИ дозаполнение ТОЛЬКО недостающих обязательных (с валидацией по словарю)
5. Push через adapter.push_product()

Endpoint: POST /api/v1/syndicate/agent
- Ozon: свой tool-agent (syndicate_ozon_agent)
- Megamarket: smart push (pull + AI fill + push)
- WB/Yandex: universal smart push

## Attribute Schema Page
- GET /api/v1/categories/{id}/marketplace-attributes — атрибуты со всех МП
- ИИ сопоставление общих атрибутов между МП
- Prefix matching для поиска категорий на МП

## Key Files
- backend/main.py — все endpoints (~6500 строк)
- backend/services/adapters.py — адаптеры МП (~2800 строк)
- backend/services/ai_service.py — ИИ функции
- backend/services/attribute_star_map.py — star map атрибутов
- backend/services/megamarket_syndicate_agent.py — MM agent (отключен, используется smart push)
- backend/models.py — SQLAlchemy модели
- backend/schemas.py — Pydantic схемы
- frontend/src/pages/ProductDetailsPage.tsx — карточка товара
- frontend/src/pages/AttributesPage.tsx — схема атрибутов

## Conventions
- offer_id всегда без префикса "mp:" при отправке на МП
- Фото: макс 15 для MM, скачиваются на сервер (/api/v1/uploads/)
- PUBLIC_API_BASE_URL загружается из backend/.env через dotenv
- Категории в БД могут содержать полный путь "A -> B -> C", при поиске берём leaf
- enum атрибуты: fuzzy match по словарю (substring + prefix)

## Known Issues
- MM pull_product возвращает атрибуты без attributeName (резолвим через schema_by_id)
- Ozon категории в формате "descriptionCategoryId_typeId"
- WB push требует subjectID + variants + characteristics формат
