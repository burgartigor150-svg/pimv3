import asyncio
from backend.database import engine, Base
import backend.models

async def init_models():
    async with engine.begin() as conn:
        print("Creating new tables for Schema Mapping...")
        await conn.run_sync(Base.metadata.create_all)
        print("Done!")

if __name__ == "__main__":
    asyncio.run(init_models())
