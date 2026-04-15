# Universal Smart Push Pattern
Used in syndicate_agent for all marketplaces.

```
1. Resolve category (PIM name → MP category search)
2. Get schema (adapter.get_category_schema)
3. Pull existing (adapter.pull_product → extract attrs by name/id)
4. PIM fallback (attributes_data minus _ keys)
5. AI fill missing required only (with dictionary validation)
6. Set standard fields (offer_id, name, description, brand, photos)
7. Push (adapter.push_product)
```

Key: NEVER let AI fill from scratch. Always pull first, AI only fills gaps.
