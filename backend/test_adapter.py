import asyncio
from backend.services.adapters import get_adapter

async def test():
    adapter = get_adapter("megamarket", "DUMMY_KEY", "", "")
    print("Adapter push_product -> ")
    res = await adapter.push_product({"categoryId": 180203010101, "Код товара продавца": "СП-00027962"})
    print(res)

asyncio.run(test())
