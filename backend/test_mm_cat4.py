import asyncio
from backend.services.adapters import MegamarketAdapter
async def main():
    a = MegamarketAdapter("C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437", "", "")
    res = await a.search_categories("микроволнов")
    print("Matches:", len(res), res)
asyncio.run(main())
