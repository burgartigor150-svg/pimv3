import asyncio
from backend.database import get_db
from backend.services.adapters import get_adapter
from backend.services.ai_service import select_ideal_card
from backend.models import MarketplaceConnection
from sqlalchemy.future import select

async def test():
    async for db in get_db():
        res = await db.execute(select(MarketplaceConnection))
        conn = res.scalars().first()
        adapter = get_adapter(conn.type, conn.api_key, conn.client_id, conn.store_id)
        print("Pulling from Ozon...")
        pulled = await adapter.pull_product("СП-00071004")
        print("Pulled data keys:", list(pulled.keys()) if pulled else "None")
        
        print("Running AI Selector...")
        import os
        ds_key = os.environ.get("DEEPSEEK_API_KEY", "")
        if not ds_key:
            print("Set DEEPSEEK_API_KEY to run AI selector")
            return
        ideal = await select_ideal_card({}, [pulled] if pulled else [], ds_key)
        print("AI Result:", ideal)

asyncio.run(test())
