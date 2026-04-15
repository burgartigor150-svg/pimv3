---
name: Syndication Lessons Learned
description: Critical bugs and fixes discovered during syndication development
type: feedback
---

## offer_id must not have "mp:" prefix
Products in DB have sku="mp:СП-00028744", but marketplaces expect just "СП-00028744".
Always .replace("mp:", "") before sending.

## MM category must be numeric ID, not path string
_platforms.megamarket.category stores text path like "Малая бытовая техника -> ...",
but push_product expects int(categoryId). Must search by leaf name.

## AI mapper hallucinates when given sparse data
map_schema_to_marketplace with only {brand: "LG"} will fill ALL fields with garbage
(SKU digits, model number in every field). Solution: pull existing data first, AI only fills gaps.

## MM pull_product returns attrs without names
card/getAttributes returns attributeId but empty attributeName.
Must resolve via get_category_schema schema_by_id mapping.

## Photos need file extension
Local uploads like /api/v1/uploads/img_xxx have .jpg extension in filesystem
but URL may lack it. Always append .jpg if no extension present.

## MM max 15 photos
card/save rejects >15 photos. Always slice [:15].

## PUBLIC_API_BASE_URL required for MM
MM needs public HTTPS URLs for images. Set in backend/.env, loaded via python-dotenv.

## enum validation strict
MM dictionary_options require exact match. Added fuzzy: substring + prefix matching + aliases.

## MM API URL — api.megamarket.tech, НЕ partner.megamarket.ru
partner.megamarket.ru — фронтенд кабинета. API вызовы принимает но молча игнорирует (возвращает 200 OK но не применяет изменения).
Правильный домен: api.megamarket.tech
Рабочий URL: https://api.megamarket.tech/api/merchantIntegration/assortment/v1/card/save
Обнаружено в проекте o2m_importer (/mnt/data/o2m_importer/).

## MM master attributes — фиксированные ID
17=name, 14=brand, 16=description, 15=артикул, 33=вес(кг), 34=длина(см), 35=высота(см), 36=ширина(см), 18=фото, 39=штрихкод, 41=серия.
Package weight в КГ, dimensions в СМ (не г/мм).

## MM push работает — финальный формат (2026-04-08)
API: https://api.megamarket.tech/api/merchantIntegration/assortment/v1/card/save
Headers: X-Merchant-Token + Content-Type: application/json (без Origin/Referer)
Payload: {categoryId: int, cards: [{offerId, name, brand, description, manufacturerNo, photos, package, masterAttributes, contentAttributes, barcodes?}]}
masterAttributes IDs: 17=name, 14=brand, 16=desc, 15=артикул, 33=вес(кг), 34=длина(см), 35=высота(см), 36=ширина(см), 18=фото, 39=штрихкод
Package: weight(кг float), height/width/length(см float)
Flow: pull existing → fill from PIM → AI fill missing required → build card → POST card/save
