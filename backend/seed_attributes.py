import asyncio
from backend.database import async_sessionmaker
from backend.models import Attribute
from sqlalchemy.future import select
from backend.database import get_db

ATTRIBUTES = [
    {"code": "brand", "name": "Бренд", "type": "string", "is_required": True},
    {"code": "model", "name": "Модель", "type": "string", "is_required": True},
    {"code": "color", "name": "Цвет", "type": "string", "is_required": False},
    {"code": "weight_g", "name": "Вес (в граммах)", "type": "number", "is_required": True},
    {"code": "length_mm", "name": "Длина (в мм)", "type": "number", "is_required": True},
    {"code": "width_mm", "name": "Ширина (в мм)", "type": "number", "is_required": True},
    {"code": "height_mm", "name": "Высота (в мм)", "type": "number", "is_required": True},
    {"code": "screen_diagonal", "name": "Диагональ экрана", "type": "string", "is_required": False},
    {"code": "resolution", "name": "Разрешение экрана", "type": "string", "is_required": False},
    {"code": "smart_tv", "name": "Поддержка Smart TV", "type": "boolean", "is_required": False},
    {"code": "matrix_type", "name": "Тип матрицы", "type": "string", "is_required": False},
    {"code": "production_country", "name": "Страна изготовитель", "type": "string", "is_required": False},
]

async def seed():
    async for db in get_db():
        for attr_data in ATTRIBUTES:
            res = await db.execute(select(Attribute).where(Attribute.code == attr_data["code"]))
            existing = res.scalars().first()
            if not existing:
                print(f"Adding {attr_data['code']}...")
                db.add(Attribute(**attr_data))
        await db.commit()
        print("Done!")

asyncio.run(seed())
