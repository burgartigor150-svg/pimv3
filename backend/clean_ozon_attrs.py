import asyncio
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from backend.database import AsyncSessionLocal
from backend.models import Attribute

async def clean_db():
    async with AsyncSessionLocal() as session:
        # Find all attributes that are purely technical Ozon metadata
        stmt = select(Attribute).where(
            (Attribute.name.ilike('%ozon%')) & 
            (~Attribute.name.ilike('%(%)%'))
        )
        result = await session.execute(stmt)
        to_delete = result.scalars().all()
        
        print(f'Found {len(to_delete)} purely technical attributes to wipe.')
        for attr in to_delete:
            print(f'- Deleting: {attr.name}')
            await session.delete(attr)
            
        await session.commit()
        print('Cleanup complete.')

if __name__ == '__main__':
    asyncio.run(clean_db())
