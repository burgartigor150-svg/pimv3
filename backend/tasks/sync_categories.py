import asyncio
import json
import os
import sys

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sqlalchemy.future import select
from backend.database import AsyncSessionLocal
from backend.models import MarketplaceConnection, SystemSettings, CategoryMapping
from backend.services.adapters import get_adapter
from backend.services.ai_service import select_best_category

async def fetch_and_store_ozon_categories():
    async with AsyncSessionLocal() as db:
        ozon_conn = (await db.execute(select(MarketplaceConnection).where(MarketplaceConnection.type == 'ozon'))).scalars().first()
        if not ozon_conn:
            print("No Ozon connection found.")
            return

        adapter = get_adapter(ozon_conn.type, ozon_conn.api_key, ozon_conn.client_id, ozon_conn.store_id, getattr(ozon_conn, "warehouse_id", None))
        
        # Ozon category tree
        print(f"Fetching Ozon tree...")
        import httpx
        headers = {
            "Client-Id": adapter.client_id or "",
            "Api-Key": adapter.api_key,
            "Content-Type": "application/json"
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post("https://api-seller.ozon.ru/v1/description-category/tree", headers=headers)
            if res.status_code != 200:
                print("Failed to fetch Ozon categories:", res.text)
                return
            tree = res.json().get("result", [])
            
        leaf_categories = []
        def traverse(nodes, path):
            for node in nodes:
                current_path = path + " / " + node.get("category_name", "") if path else node.get("category_name", "")
                type_name = node.get("type_name", "")
                if "description_category_id" in node and "type_id" in node and not node.get("children"):
                    cat_id = f"{node['description_category_id']}_{node['type_id']}"
                    leaf_categories.append({"id": cat_id, "name": f"{current_path} -> {type_name}"})
                if "children" in node:
                    traverse(node["children"], current_path)
                    
        traverse(tree, "")
        print(f"Found {len(leaf_categories)} leaf categories in Ozon.")
        
        # Load existing
        existing_res = await db.execute(select(CategoryMapping.source_cat_id).where(CategoryMapping.source_type == 'ozon'))
        existing_ids = {row for row in existing_res.scalars().all()}
        
        # Save to DB
        inserted = 0
        for cat in leaf_categories:
            if cat["id"] not in existing_ids:
                new_map = CategoryMapping(
                    source_type="ozon",
                    target_type="megamarket",
                    source_cat_id=cat["id"],
                    source_name=cat["name"],
                    is_approved=False
                )
                db.add(new_map)
                inserted += 1
                if inserted % 500 == 0:
                    await db.commit()
                
        if inserted > 0:
            await db.commit()
            print(f"Inserted {inserted} new Ozon categories into pending mapping.")

async def run_ai_matching(batch_size=50):
    async with AsyncSessionLocal() as db:
        mm_conn = (await db.execute(select(MarketplaceConnection).where(MarketplaceConnection.type == 'megamarket'))).scalars().first()
        setting = (await db.execute(select(SystemSettings).where(SystemSettings.id == 'deepseek_api_key'))).scalars().first()
        
        if not mm_conn or not setting:
            print("Megamarket connection or AI Key missing.")
            return
            
        ai_key = setting.value
        mm_adapter = get_adapter(mm_conn.type, mm_conn.api_key, mm_conn.client_id, mm_conn.store_id, getattr(mm_conn, "warehouse_id", None))
        
        # Fetch unmapped categories
        unmapped_res = await db.execute(
            select(CategoryMapping).where(CategoryMapping.target_cat_id == None).limit(batch_size)
        )
        unmapped = unmapped_res.scalars().all()
        
        print(f"Found {len(unmapped)} unmapped categories. Processing...")
        
        for mapping in unmapped:
            print(f"Mapping Ozon Category: {mapping.source_name}...")
            # Use only the last part of the path for better search
            parts = mapping.source_name.split("->")
            search_term = parts[-1].strip() if parts else mapping.source_name
            # remove some fluff
            search_query = search_term.split("(")[0].strip()
            
            candidates = await mm_adapter.search_categories(search_query)
            if not candidates:
                # Retry with broader term
                broad_query = search_term.split()[0]
                candidates = await mm_adapter.search_categories(broad_query)
                
            if candidates:
                try:
                    product_context = {"source_ozon_category": mapping.source_name}
                    cat_select = await select_best_category(product_context, candidates, ai_key)
                    best_id = cat_select.get("category_id")
                    if best_id:
                        best_name = next((c["name"] for c in candidates if c["id"] == str(best_id)), "Unknown")
                        mapping.target_cat_id = str(best_id)
                        mapping.target_name = best_name
                        mapping.ai_confidence = 90
                        print(f"✅ Matched -> {best_name} (ID: {best_id})")
                    else:
                        print("❌ AI returned no match.")
                except Exception as e:
                    print(f"AI Exception: {e}")
            else:
                print("❌ No candidates found in Megamarket tree.")
                
            db.add(mapping)
            await db.commit()
            await asyncio.sleep(1) # rate limit

async def main():
    while True:
        print("\n--- Category Sync ---")
        print("1. Fetch all Ozon leaf categories")
        print("2. Run AI batch matching (50 items)")
        print("3. Exit")
        cmd = input("Choice: ").strip()
        if cmd == "1":
            await fetch_and_store_ozon_categories()
        elif cmd == "2":
            await run_ai_matching(50)
        elif cmd == "3":
            break

if __name__ == "__main__":
    asyncio.run(main())
