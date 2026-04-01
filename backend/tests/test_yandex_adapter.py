"""Smoke tests for YandexAdapter (mocked httpx). PYTHONPATH=. python3 -m unittest backend.test_yandex_adapter -v"""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.services.adapters import YandexAdapter


def _async_client_cm(inner_client):
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=inner_client)
    cm.__aexit__ = AsyncMock(return_value=None)
    return cm


class YandexAdapterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.adapter = YandexAdapter("test-api-key", None, "12345")

    async def test_headers_use_api_key_when_no_client_id(self):
        h = self.adapter._headers()
        self.assertEqual(h.get("Api-Key"), "test-api-key")
        self.assertNotIn("Authorization", h)

    async def test_headers_oauth_when_client_id_set(self):
        ad = YandexAdapter("tok", "cid", "12345")
        h = ad._headers()
        self.assertIn("OAuth oauth_token=tok", h["Authorization"])
        self.assertIn("oauth_client_id=cid", h["Authorization"])

    async def test_search_categories_traverses_tree(self):
        tree = {
            "status": "OK",
            "result": {
                "id": 1,
                "name": "Root",
                "children": [
                    {
                        "id": 10,
                        "name": "Электроника",
                        "children": [
                            {"id": 100, "name": "Наушники беспроводные", "children": []},
                        ],
                    }
                ],
            },
        }
        inner = MagicMock()
        r = MagicMock()
        r.status_code = 200
        r.json.return_value = tree
        inner.post = AsyncMock(return_value=r)

        with patch("backend.services.adapters.httpx.AsyncClient", return_value=_async_client_cm(inner)):
            out = await self.adapter.search_categories("наушник")

        self.assertTrue(any("100" == x["id"] for x in out))
        inner.post.assert_called_once()
        url = inner.post.call_args[0][0]
        self.assertIn("/categories/tree", url)

    async def test_get_category_schema_maps_parameters(self):
        inner = MagicMock()
        r = MagicMock()
        r.status_code = 200
        r.json.return_value = {
            "status": "OK",
            "result": {
                "categoryId": 100,
                "parameters": [
                    {
                        "id": 1,
                        "name": "Бренд",
                        "type": "ENUM",
                        "required": True,
                        "values": [{"id": 11, "value": "Acme"}],
                    }
                ],
            },
        }
        inner.post = AsyncMock(return_value=r)

        with patch("backend.services.adapters.httpx.AsyncClient", return_value=_async_client_cm(inner)):
            schema = await self.adapter.get_category_schema("100")

        attrs = schema.get("attributes") or []
        self.assertEqual(len(attrs), 1)
        self.assertEqual(attrs[0]["name"], "Бренд")
        self.assertTrue(attrs[0]["is_required"])
        self.assertEqual(len(attrs[0]["dictionary_options"]), 1)

    async def test_pull_product_uses_offer_mappings_post(self):
        inner = MagicMock()
        r = MagicMock()
        r.status_code = 200
        r.json.return_value = {
            "status": "OK",
            "result": {
                "offerMappings": [
                    {"offer": {"offerId": "SKU1", "name": "N"}, "mapping": {"marketSku": 1}}
                ]
            },
        }
        inner.post = AsyncMock(return_value=r)

        with patch("backend.services.adapters.httpx.AsyncClient", return_value=_async_client_cm(inner)):
            out = await self.adapter.pull_product("SKU1")

        self.assertIsNotNone(out)
        self.assertEqual(out.get("offerId"), "SKU1")
        call_kw = inner.post.call_args
        self.assertIn("/businesses/12345/offer-mappings", call_kw[0][0])
        self.assertEqual(call_kw[1]["json"], {"offerIds": ["SKU1"]})


if __name__ == "__main__":
    unittest.main()
