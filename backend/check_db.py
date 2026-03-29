import asyncio
from backend.database import async_session_maker
from sqlalchemy.future import select
from backend.models import MarketplaceConnection
async def check():
  async with async_session_maker() as db:
    res = await db.execute(select(MarketplaceConnection))
    conns = res.scalars().all()
    for c in conns:
      print(c.type, c.api_key, c.client_id, c.store_id)
asyncio.run(check())
