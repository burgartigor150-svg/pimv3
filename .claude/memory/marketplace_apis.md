---
name: Marketplace API Reference
description: Key API endpoints and formats per marketplace
type: reference
---

## Ozon
- Push: POST /v2/product/import {items: [{offer_id, name, description_category_id, type_id, attributes: [{id, values: [{value}]}]}]}
- Category: "descriptionCategoryId_typeId" format
- pull_product returns _ozon_source_flat: {attr_name: value}

## Megamarket
- Push: POST card/save with masterAttributes + contentAttributes arrays
- Category: numeric ID from categoryTree
- pull_product: card/get + card/getAttributes (attrs lack names, need schema resolve)
- Max 15 photos, offerId max 35 chars

## Wildberries
- Push: POST /content/v2/cards/upload [{subjectID, variants: [{vendorCode, title, description, brand, characteristics: [{id, value}], sizes, mediaFiles}]}]
- Category: subjectID (numeric)
- Characteristics: [{id: charcID, value: [val]}]

## Yandex Market
- Push: POST /businesses/{bid}/offer-mappings/update {offerMappingEntries: [{offer: {offerId, name, vendor, category, pictures, parameterValues}}]}
- Category: numeric ID from category tree
- businessId from connection.store_id
