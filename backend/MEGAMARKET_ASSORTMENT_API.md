# Megamarket Assortment API 1.0 Notes

Рабочая выжимка под наш backend (`Pimv3`) для карточек/ошибок/цен/остатков.

## Базовые принципы

- Заголовок для всех методов: `X-Merchant-Token`.
- Создавать карточку можно только в категории **6-го уровня**.
- Валидация карточки асинхронная:
  - `card/save` может вернуть `200`, но ошибки появятся позже в `card/getError`.
  - Финальная проверка: `card/get` + `card/getError`.
- Для публикации нужны все `isRequired=true` с непустыми значениями.
- При `valueTypeCode=enum`:
  - `isSuggest=true` -> можно словарь + свое значение;
  - `isSuggest=false` -> только значение из словаря.
- При обновлении карточки нужно отправлять все ранее заполненные атрибуты, иначе пропущенные могут обнулиться.

## Категории

- Полное дерево:
  - `GET /api/merchantIntegration/assortment/v1/categoryTree/get`
- Только 1-й уровень:
  - `GET /api/merchantIntegration/assortment/v1/categoryParent/list`
- Ветка по parent категории:
  - `POST /api/merchantIntegration/assortment/v1/categoryBranch/get`
  - `data.parentId` (required), `data.skipIntermediateCategory` (optional)

## Инфомодель

- Получить атрибуты категории:
  - `POST /api/merchantIntegration/assortment/v1/infomodel/get`
  - body: `{"data":{"categoryId": <int>}}`
  - ответ: `masterAttributes` + `contentAttributes`

## Карточки

- Создание/обновление:
  - `POST /api/merchantIntegration/assortment/v1/card/save`
  - body: `{"categoryId": <number>, "cards": [...] }`
  - в ответе анализируем `successTotal/errorTotal/errorCards/changes`

- Статусы карточек:
  - `POST /api/merchantIntegration/assortment/v1/card/get`
  - ключевые статусы: `PROCESSING`, `MODERATION`, `ACTIVE`, `ERROR`, `CHANGES_REJECTED`, `BLOCKED`

- Полные атрибуты карточек:
  - `POST /api/merchantIntegration/assortment/v1/card/getAttributes`
  - `targetFields`: `all|masterAttributes|contentAttributes`

- Ошибки карточек:
  - `POST /api/merchantIntegration/assortment/v1/card/getError`
  - ошибки: атрибуты, категория, модерация, технические

## Цены

- Получение:
  - `POST /price/getByOfferId`
  - `POST /price/getByGoodsId`
  - `POST /price/get` (по складу)
- Обновление:
  - `POST /price/updateByOfferId`
  - `POST /price/updateByGoodsId`

## Остатки

- Получение:
  - `POST /stock/getByOfferId`
  - `POST /stock/getByGoodsId`
  - `POST /stock/get` (по складу)
- Обновление:
  - `POST /stock/updateByOfferId`
  - `POST /stock/updateByGoodsId`

## Ограничения контента (важно для reject)

- Фото: 1..16, https, без авторизации, формат jpg/jpeg/webp/png, без водяных знаков и рекламных оверлеев.
- Штрихкод: только цифры, до 8 ШК на карточку.
- Описание: до 2500 символов, без внешних ссылок и промо-призывов.
- Документы (инструкция/сертификат): https, без авторизации, форматы jpg/jpeg/webp/png/pdf.

## Как применяем в Pimv3

1. Ищем категорию 6-го уровня (`categoryTree/get`).
2. Берем инфомодель (`infomodel/get`) и обязательные поля.
3. Сборка payload + `card/save`.
4. Polling статуса (`card/get`) и ошибок (`card/getError`).
5. Если есть ошибки: авто-исправление -> повтор `card/save`.
6. После валидной карточки обновляем цену/остаток (`updateByOfferId`) при наличии `locationId`.

