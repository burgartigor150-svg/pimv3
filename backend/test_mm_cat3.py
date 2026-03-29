import asyncio
import httpx
async def main():
    headers = {"X-Merchant-Token": "C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437", "Content-Type": "application/json"}
    async with httpx.AsyncClient() as client:
        res = await client.get("https://partner.megamarket.ru/api/merchantIntegration/assortment/v1/categoryTree/get", headers=headers)
        tree = res.json().get("data", [])
        
        found = []
        def traverse(nodes, parent):
            for n in nodes:
                p = f"{parent} -> {n['name']}" if parent else n['name']
                if "микроволнов" in p.lower():
                    found.append((n['id'], p))
                if "children" in n:
                    traverse(n["children"], p)
        traverse(tree, "")
        print("Found:", len(found))
        for i, p in found:
            print(f"{i}: {p}")

asyncio.run(main())
