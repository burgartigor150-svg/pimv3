# Megamarket Pipeline Runbook (Production)

Этот файл фиксирует, **как система должна работать в проде** для выгрузки карточек в Megamarket.

## Цель

- Не просто получить `HTTP 200` на `card/save`.
- Довести карточку до стабильного состояния без ошибок `card/getError`.
- Отправлять не только minimum required, но и максимально полный набор релевантных атрибутов из PIM.

## Входные данные

- `Product.attributes_data` (идеальная карточка PIM, агрегированная из источников).
- `Product.images` (источники фото).
- Подключение MM (`X-Merchant-Token`, merchant account).
- Категория MM 6-го уровня (`categoryId`) — auto-pick или явно задана.

## Обязательные API шаги (MM)

1. `categoryTree/get` -> выбор leaf категории (6 уровень).
2. `infomodel/get` -> `masterAttributes` + `contentAttributes` (источник правил).
3. Подготовка payload карточки.
4. `card/save`.
5. Асинхронная проверка:
   - `card/get` (статус),
   - `card/getError` (детализация ошибок, включая `attributesErrors` и `exportError`).
6. При успехе и наличии `locationId`: `price/updateByOfferId`, `stock/updateByOfferId`.

## Структура payload (важно)

- Для `card/save` используем:
  - `masterAttributes`
  - `contentAttributes`
- Не использовать единый `attributes` как основную структуру для MM.

## Правила заполнения атрибутов

### 1) Универсальный rule-engine по infomodel

Для каждого атрибута из схемы:

- Если `enum`:
  - `isSuggest=false`: только словарное значение.
  - `isSuggest=true`: словарь + допускается своё значение.
- `boolean`: нормализация в `true/false`.
- `number/int`: парсинг числа + конверсия единиц при необходимости.
- `string`: очистка и нормализация.

### 2) Required vs Optional

- `required` заполняем агрессивно (включая fallback).
- `optional` заполняем только при достаточной уверенности матчинга.

### 3) Сопоставление значений

- По нормализованным именам полей + token similarity.
- Для enum: exact -> fuzzy -> fallback (для required).
- Для rich PIM полей использовать semantic aliases:
  - модель, страна, комплект, ТН ВЭД, материал корпуса и т.д.

## Фото (жёстко)

- Для MM отправлять фото через **наш публичный HTTPS домен**:
  - `PUBLIC_API_BASE_URL/api/v1/media/proxy/<b64>`
- Если `PUBLIC_API_BASE_URL` невалиден/непубличный -> отдавать явную ошибку конфигурации.
- В `card/save` должно быть 1..16 фото.

## Обновление карточки (защита от затирания)

- Перед `card/save` подтянуть текущие атрибуты через `card/getAttributes`.
- Подмешать отсутствующие ранее заполненные атрибуты.
- Не допускать сценария "пропущенные поля -> null после апдейта".

## Асинхронная валидация и статусы

- `PROCESSING`, `MODERATION` => `pending` (не success).
- `ACTIVE` + пустой `getError` => success.
- `ERROR/CHANGES_REJECTED/BLOCKED`:
  - анализировать `getError`,
  - запускать repair цикл.

## Repair цикл

Порядок:

1. Deterministic fix (особенно `code=2001` required missing).
2. Re-submit.
3. Re-poll status/errors.
4. Если остаются ошибки — AI repair.
5. Повторить в пределах лимита попыток.

Отдельно:

- `exportError code=500` (техсбой MM) -> повторная отправка без модификации payload.

## Наблюдаемость (обязательно)

- Возвращать `status`: `pending | success | error`.
- В ответе держать:
  - `message`,
  - `category_id`,
  - `submit_during_agent`,
  - `trace` шагов агента,
  - `payload_sent` на ошибке.

## Критерии готовности (Definition of Done)

- Карточка не падает в `getError` по required/enum/type.
- В `getAttributes` заполнены:
  - required атрибуты,
  - и расширенный набор optional из идеальной карточки.
- Фото идут через наш публичный proxy URL.
- На апдейте не теряются ранее заполненные поля.
- Ответ API не выдаёт ложный `success` до финальной проверки.

