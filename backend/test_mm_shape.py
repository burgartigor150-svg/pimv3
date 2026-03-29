import asyncio
import httpx

async def try_payload(payload):
    headers = {
        "Content-Type": "application/json",
        "X-Merchant-Token": "C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437",
        "User-Agent": "Mozilla/5.0"
    }
    async with httpx.AsyncClient() as client:
        res = await client.post("https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/card/save", headers=headers, json=payload)
        print("Payload:", payload)
        print("Response:", res.status_code, res.text[:200])
        print("---")

async def main():
    # Test 1: Flat offerId
    await try_payload({
        "categoryId": 0,
        "cards": [{"offerId": "123", "type": "Соло"}]
    })
    
    # Test 2: offerId + attributes array (Ozon style)
    await try_payload({
        "categoryId": 0,
        "cards": [{"offerId": "9999912384", "attributes": [{"id": "type", "value": "Соло"}]}]
    })

    # Test 3: offerId + fields
    await try_payload({
        "categoryId": 0,
        "cards": [{"offer_id": "123", "fields": {"type": "Соло"}}]
    })

asyncio.run(main())
