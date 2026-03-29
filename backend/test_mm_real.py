import asyncio
import httpx

async def main():
    headers = {
        "Content-Type": "application/json",
        "X-Merchant-Token": "C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437",
        "User-Agent": "Mozilla/5.0"
    }
    
    payload = {
        "categoryId": 0,
        "cards": [{
            "type": "Соло",
            "brand": "LG",
            "color": "белый",
            "model": "MW25R35GISW",
            "power_w": 1000,
            "warranty": "1 год",
            "weight_g": 14000
        }]
    }

    async with httpx.AsyncClient() as client:
        res = await client.post("https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/card/save", headers=headers, json=payload)
        print("POST /card/save:", res.status_code, res.text[:200])

asyncio.run(main())
