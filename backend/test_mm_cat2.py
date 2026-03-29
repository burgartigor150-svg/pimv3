import asyncio
import httpx
async def main():
    headers = {"X-Merchant-Token": "C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437", "Content-Type": "application/json"}
    async with httpx.AsyncClient() as client:
        res = await client.get("https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/categoryTree/get", headers=headers)
        tree = res.json().get("data", [])
        print("Tree roots:", len(tree))
        for c in tree:
            print(c['name'])

asyncio.run(main())
