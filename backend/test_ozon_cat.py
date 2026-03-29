import asyncio
from backend.database import AsyncSessionLocal
from backend.services.adapters import OzonAdapter
from backend.models import MarketplaceConnection
from sqlalchemy import select
import json

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(MarketplaceConnection).where(MarketplaceConnection.type == 'ozon'))
        conn = res.scalars().first()
        adapter = OzonAdapter(conn.api_key, conn.client_id, conn.store_id)
        # A product SKU from earlier logs MW25R35GISW
        data = await adapter.pull_product('MW25R35GISW')
        print(json.dumps(data, indent=2, ensure_ascii=False)[:3000])

if __name__ == '__main__':
    asyncio.run(main())
