import asyncio
from backend.services.adapters import MegamarketAdapter

async def main():
    adapter = MegamarketAdapter("C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437", "", "")
    res = await adapter.search_categories("микроволновая")
    print("Categories found:", len(res))
    for c in res:
        print(c)

asyncio.run(main())
