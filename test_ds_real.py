import asyncio
import os
from openai import AsyncOpenAI
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.future import select
from backend.models import SystemSettings

load_dotenv('backend/.env')
DATABASE_URL = os.getenv('DATABASE_URL')

async def main():
    engine = create_async_engine(DATABASE_URL)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(SystemSettings).where(SystemSettings.id == 'deepseek_api_key'))
        key = res.scalars().first().value

    client = AsyncOpenAI(api_key=key, base_url="https://api.deepseek.com")
    try:
        res = await client.chat.completions.create(model="deepseek-chat", messages=[{"role": "user", "content": "hello"}], timeout=15.0)
        print("SUCCESS!", res.choices[0].message.content)
    except Exception as e:
        print("ERROR!", repr(e))

asyncio.run(main())
