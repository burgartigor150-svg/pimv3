"""Тесты нормализации плоского payload -> Ozon /v2/product/import и разбора v3/info/list."""
import asyncio
from unittest.mock import AsyncMock

from backend.services.adapters import OzonAdapter, _ozon_product_info_items


def test_ozon_product_info_items_reads_result_wrapper():
    data = {"result": {"items": [{"offer_id": "x", "errors": [{"code": "EMPTY"}]}]}}
    items = _ozon_product_info_items(data)
    assert len(items) == 1
    assert items[0].get("offer_id") == "x"


async def _build_maps_flat():
    adapter = OzonAdapter("api", "cid", None, None)
    adapter.get_category_schema = AsyncMock(
        return_value={
            "attributes": [
                {"id": 100, "name": "Бренд", "dictionary_id": 0, "type": "String"},
                {"id": 200, "name": "Цвет", "dictionary_id": 123, "type": "String"},
            ]
        }
    )
    adapter.get_dictionary = AsyncMock(return_value=[{"id": 999, "value": "Черный"}])
    flat = {
        "categoryId": "1_2",
        "offer_id": "SKU1",
        "name": "Test",
        "Бренд": "Samsung",
        "Цвет": "Черный",
    }
    body = await adapter._build_ozon_v2_import_body(flat)
    assert "items" in body and len(body["items"]) == 1
    item = body["items"][0]
    assert item["description_category_id"] == 1
    assert item["type_id"] == 2
    by_id = {a["id"]: a for a in item["attributes"]}
    assert by_id[100]["values"][0]["value"] == "Samsung"
    assert by_id[200]["values"][0].get("dictionary_value_id") == 999


def test_build_ozon_v2_import_body_maps_flat_names_to_ids():
    asyncio.run(_build_maps_flat())


async def _prebuilt():
    adapter = OzonAdapter("api", "cid", None, None)
    flat = {"items": [{"offer_id": "z", "name": "N", "attributes": []}]}
    body = await adapter._build_ozon_v2_import_body(flat)
    assert body == flat


def test_prebuilt_items_pass_through():
    asyncio.run(_prebuilt())
