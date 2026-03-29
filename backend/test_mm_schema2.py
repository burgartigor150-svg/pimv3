import asyncio
import json
from backend.services.adapters import MegamarketAdapter
async def main():
    a = MegamarketAdapter("C717BAED-D3FF-4FD9-9FD2-8D7CAA6DD437", "", "")
    res = await a.get_category_schema("80608010102")
    print("Total attrs:", len(res.get("attributes", [])))
    schema_json = json.dumps(res)
    print("Schema size bytes:", len(schema_json))
asyncio.run(main())
