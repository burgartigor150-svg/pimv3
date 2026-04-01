"""
Smoke tests for MegamarketAdapter HTTP calls (mocked httpx).
Run from repo root: PYTHONPATH=. python3 -m unittest backend.test_megamarket_adapter -v
"""
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.services.adapters import MegamarketAdapter


def _async_client_cm(inner_client):
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=inner_client)
    cm.__aexit__ = AsyncMock(return_value=None)
    return cm


class MegamarketAdapterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.adapter = MegamarketAdapter("test-token", None, None)

    async def test_pull_product_merges_card_get_and_get_attributes(self):
        inner = MagicMock()
        r_card = MagicMock()
        r_card.status_code = 200
        r_card.json.return_value = {
            "data": {"cardsInfo": [{"offerId": "SKU-1", "status": {"code": "ACTIVE"}}]}
        }
        r_attrs = MagicMock()
        r_attrs.status_code = 200
        r_attrs.json.return_value = {"data": {"cards": [{"masterAttributes": [], "contentAttributes": []}]}}
        inner.post = AsyncMock(side_effect=[r_card, r_attrs])

        with patch("backend.services.adapters.httpx.AsyncClient", return_value=_async_client_cm(inner)):
            out = await self.adapter.pull_product("SKU-1")

        self.assertIsNotNone(out)
        self.assertEqual(out.get("offerId"), "SKU-1")
        self.assertIn("attributes", out)
        self.assertEqual(len(inner.post.call_args_list), 2)
        self.assertIn("card/get", inner.post.call_args_list[0][0][0])
        self.assertIn("getAttributes", inner.post.call_args_list[1][0][0])
        self.assertEqual(
            inner.post.call_args_list[0][1]["json"]["filter"]["offerId"],
            ["SKU-1"],
        )

    async def test_pull_product_returns_none_when_card_get_not_200(self):
        inner = MagicMock()
        r_card = MagicMock()
        r_card.status_code = 401
        inner.post = AsyncMock(return_value=r_card)

        with patch("backend.services.adapters.httpx.AsyncClient", return_value=_async_client_cm(inner)):
            out = await self.adapter.pull_product("X")

        self.assertIsNone(out)
        inner.post.assert_called_once()

    async def test_pull_product_returns_none_when_cards_info_empty(self):
        inner = MagicMock()
        r_card = MagicMock()
        r_card.status_code = 200
        r_card.json.return_value = {"data": {"cardsInfo": []}}
        inner.post = AsyncMock(return_value=r_card)

        with patch("backend.services.adapters.httpx.AsyncClient", return_value=_async_client_cm(inner)):
            out = await self.adapter.pull_product("X")

        self.assertIsNone(out)

    async def test_pull_product_falls_back_to_card_only_when_get_attributes_fails(self):
        inner = MagicMock()
        r_card = MagicMock()
        r_card.status_code = 200
        r_card.json.return_value = {"data": {"cardsInfo": [{"offerId": "A"}]}}
        r_attrs = MagicMock()
        r_attrs.status_code = 500
        inner.post = AsyncMock(side_effect=[r_card, r_attrs])

        with patch("backend.services.adapters.httpx.AsyncClient", return_value=_async_client_cm(inner)):
            out = await self.adapter.pull_product("A")

        self.assertEqual(out, {"offerId": "A"})
        self.assertNotIn("attributes", out)

    async def test_get_async_errors_uses_documented_payload_shape(self):
        inner = MagicMock()
        r = MagicMock()
        r.status_code = 200
        r.json.return_value = {
            "data": {
                "cards": [
                    {
                        "offerId": "O1",
                        "attributesErrors": [{"msg": "bad"}],
                    }
                ]
            }
        }
        inner.post = AsyncMock(return_value=r)

        with patch("backend.services.adapters.httpx.AsyncClient", return_value=_async_client_cm(inner)):
            err = await self.adapter.get_async_errors("O1")

        self.assertIsNotNone(err)
        self.assertEqual(json.loads(err), [{"msg": "bad"}])
        kwargs = inner.post.call_args[1]
        self.assertEqual(
            kwargs["json"],
            {
                "filter": {"offerId": ["O1"]},
                "sorting": {"fieldName": "goodsId", "order": "asc"},
                "pagination": {"limit": 50, "offset": 0},
            },
        )

    async def test_push_product_calls_card_save(self):
        schema = {
            "attributes": [
                {"id": "17", "name": "Наименование карточки", "is_required": True, "type": "string", "valueTypeCode": "", "is_multiple": False, "dictionary_options": []},
                {"id": "14", "name": "Бренд", "is_required": True, "type": "string", "valueTypeCode": "", "is_multiple": False, "dictionary_options": []},
                {"id": "16", "name": "Описание", "is_required": False, "type": "string", "valueTypeCode": "", "is_multiple": False, "dictionary_options": []},
                {"id": "15", "name": "Код товара продавца", "is_required": True, "type": "string", "valueTypeCode": "", "is_multiple": False, "dictionary_options": []},
                {"id": "33", "name": "Вес (упаковки)", "is_required": False, "type": "string", "valueTypeCode": "", "is_multiple": False, "dictionary_options": []},
                {"id": "34", "name": "Длина (упаковки)", "is_required": False, "type": "string", "valueTypeCode": "", "is_multiple": False, "dictionary_options": []},
                {"id": "35", "name": "Высота (упаковки)", "is_required": False, "type": "string", "valueTypeCode": "", "is_multiple": False, "dictionary_options": []},
                {"id": "36", "name": "Ширина (упаковки)", "is_required": False, "type": "string", "valueTypeCode": "", "is_multiple": False, "dictionary_options": []},
            ]
        }
        inner = MagicMock()
        r_save = MagicMock()
        r_save.status_code = 200
        r_save.json.return_value = {"data": {"errorTotal": 0}}
        r_save.text = "{}"
        inner.post = AsyncMock(return_value=r_save)

        with patch.object(MegamarketAdapter, "get_category_schema", new_callable=AsyncMock, return_value=schema):
            with patch("backend.services.adapters.httpx.AsyncClient", return_value=_async_client_cm(inner)):
                res = await self.adapter.push_product(
                    {
                        "categoryId": 999,
                        "offer_id": "SKU-X",
                        "Наименование карточки": "Тест",
                        "Бренд": "Acme",
                    }
                )

        self.assertEqual(res["status_code"], 200)
        # New prod behavior: prefetch existing attrs via getAttributes, then save card.
        self.assertGreaterEqual(inner.post.call_count, 2)
        save_call = inner.post.call_args_list[-1]
        self.assertIn("card/save", save_call[0][0])
        body = save_call[1]["json"]
        self.assertEqual(body["categoryId"], 999)
        self.assertEqual(len(body["cards"]), 1)
        self.assertEqual(body["cards"][0]["offerId"], "SKU-X")


if __name__ == "__main__":
    unittest.main()
