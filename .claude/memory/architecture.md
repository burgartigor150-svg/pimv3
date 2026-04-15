---
name: PIMv3 Architecture
description: Core architecture decisions and data flow
type: reference
---

## Data Flow
Product sync: MP API → list_products → _sync_shadows_for_platform → Product(sku=mp:XXX)
Push: Product → syndicate/agent → pull existing → AI fill missing → adapter.push_product()

## DB Schema
- products: id, sku, name, description_html, images(JSONB), attributes_data(JSONB), category_id, completeness_score
- categories: id, name, parent_id
- marketplace_connections: id, type, name, api_key, client_id, store_id, warehouse_id, status
- category_mappings: source_type, target_type, source_cat_id, target_cat_id
- attribute_mappings: category_mapping_id, source_attr_id, target_attr_id
- attributes: id, code, name, type, is_required, category_id, connection_id

## attributes_data Structure
{
  "brand": "LG",
  "_vendor_code": "СП-00028744",
  "_platforms": {
    "ozon": {"name": "...", "brand": "...", "category": "...", "image_url": "...", "status": "..."},
    "megamarket": {...},
    ...
  },
  // User/imported attributes:
  "Цвет": "белый",
  "Мощность": "1000"
}
