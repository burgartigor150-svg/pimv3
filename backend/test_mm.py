import asyncio
import httpx

async def main():
    headers = {
        "Content-Type": "application/json",
        "X-Merchant-Token": "test",
        "User-Agent": "Mozilla/5.0"
    }
    payload = {
        "categoryId": 0,
        "cards": [{ "type": "Соло" }]
    }
    async with httpx.AsyncClient() as client:
        res = await client.post("https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/card/save", headers=headers, json=payload)
        print("POST /card/save:", res.status_code, res.text)

asyncio.run(main())
