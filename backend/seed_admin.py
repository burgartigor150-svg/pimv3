import asyncio
from backend.database import engine, Base, AsyncSessionLocal
from backend import models
from passlib.context import CryptContext
import uuid

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password):
    return pwd_context.hash(password)

async def init_db():
    # Sync create_all is not directly supported on async engine without run_sync
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def seed_admin():
    await init_db()
    print("Database tables verified/created.")
    
    async with AsyncSessionLocal() as db:
        from sqlalchemy.future import select
        result = await db.execute(select(models.User).filter(models.User.email == "admin@admin.com"))
        user = result.scalars().first()
        if not user:
            hashed_password = get_password_hash("admin")
            admin_user = models.User(email="admin@admin.com", hashed_password=hashed_password, role="admin")
            db.add(admin_user)
            await db.commit()
            print("Admin user (admin@admin.com / admin) created successfully.")
        else:
            print("Admin user already exists.")

if __name__ == "__main__":
    asyncio.run(seed_admin())
