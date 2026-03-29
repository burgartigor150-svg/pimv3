import asyncio
from sqlalchemy import delete
from backend.database import AsyncSessionLocal
from backend import models

async def clear():
    async with AsyncSessionLocal() as db:
        await db.execute(delete(models.Product))
        await db.execute(delete(models.Attribute))
        await db.execute(delete(models.Category))
        await db.commit()

asyncio.run(clear())
