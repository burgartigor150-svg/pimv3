import asyncio
from backend.services.adapters import MegamarketAdapter

async def main():
    adapter = MegamarketAdapter("test_api", "client", "store")
    res = await adapter.push_product({"type": "Соло", "categoryId": 123})
    print(res)

asyncio.run(main())
