import asyncio
import httpx
import json
async def main():
    headers = {"X-Merchant-Token": "C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437", "Content-Type": "application/json"}
    async with httpx.AsyncClient() as client:
        res = await client.post("https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/infomodel/get", headers=headers, json={"data": {"categoryId": 80608010102}})
        data = res.json().get("data", {})
        attrs = data.get("masterAttributes", []) + data.get("contentAttributes", [])
        print("Total attrs:", len(attrs))
        if attrs:
            print("Sample attr keys:", list(attrs[0].keys()))
            # Print sizes of top 5 largest attrs
            largest = sorted(attrs, key=lambda x: len(json.dumps(x)), reverse=True)[:5]
            for a in largest:
                print(a.get('name'), "-", len(json.dumps(a)), "bytes")
                if 'values' in a: print("  has values array of len:", len(a['values']))
asyncio.run(main())
