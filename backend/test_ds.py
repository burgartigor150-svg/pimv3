import asyncio
import json
from backend.database import get_db
from sqlalchemy.future import select
from backend import models
from backend.services.ai_service import select_ideal_card
from backend.services.adapters import get_adapter

async def test():
    async for db in get_db():
        ai_key_res = await db.execute(select(models.SystemSettings).where(models.SystemSettings.id == 'deepseek_api_key'))
        ai_key = ai_key_res.scalars().first().value
        
        conns_res = await db.execute(select(models.MarketplaceConnection))
        all_conns = conns_res.scalars().all()
        
        sku = 'СП-00071004'
        duplicates_found = []
        for c in all_conns:
            try:
                adapter = get_adapter(c.type, c.api_key, c.client_id, c.store_id)
                pulled = await adapter.pull_product(sku)
                if pulled:
                    print(f"Found on {c.type}")
                    duplicates_found.append({f"Marketplace ({c.type})": pulled})
            except Exception as e:
                print(f"Error {c.type}: {e}")
                
        print(f"Found {len(duplicates_found)} duplicates.")
        
        attrs_res = await db.execute(select(models.Attribute))
        active_attrs = attrs_res.scalars().all()
        
        print("Running AI...")
        ideal_data = await select_ideal_card({}, duplicates_found, active_attrs, ai_key)
        print("AI Result:")
        print(json.dumps(ideal_data, ensure_ascii=False, indent=2))
        break

asyncio.run(test())
