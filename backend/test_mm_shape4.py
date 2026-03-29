import asyncio
import httpx
import time
import json

async def try_payload(payload):
    headers = {
        "Content-Type": "application/json",
        "X-Merchant-Token": "C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437",
        "User-Agent": "Mozilla/5.0"
    }
    async with httpx.AsyncClient() as client:
        res = await client.post("https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/card/save", headers=headers, json=payload)
        print("Response:", res.status_code, res.text)

async def main():
    t = str(int(time.time()))
    # EXACT error repro
    await try_payload({
        "categoryId": 180203010101,
        "cards": [{'Код товара продавца': 'MW25R35GISW', 'Бренд': 'LG', 'offerId': '50eda570-f73c-4fe3-ba17-eec5b23defaf'}]
    })
asyncio.run(main())
