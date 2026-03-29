import asyncio
import httpx
import time

async def try_payload(payload):
    headers = {
        "Content-Type": "application/json",
        "X-Merchant-Token": "C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437",
        "User-Agent": "Mozilla/5.0"
    }
    async with httpx.AsyncClient() as client:
        res = await client.post("https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/card/save", headers=headers, json=payload)
        print("Payload:", payload)
        print("Response:", res.status_code, res.text[:300])
        print("---")

async def main():
    t = str(int(time.time()))
    # Test 1: Flat offerId
    await try_payload({
        "categoryId": 180203010101,
        "cards": [{"offerId": t+"a", "Бренд": "LG"}]
    })
    
    # Test 2: offerId + attributes array
    await try_payload({
        "categoryId": 180203010101,
        "cards": [{"offerId": t+"b", "attributes": [{"id": "Бренд", "value": "LG"}]}]
    })

asyncio.run(main())
