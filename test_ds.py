import asyncio
import os
import sys
import traceback

from openai import AsyncOpenAI

async def test():
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not key:
        sys.exit("Set DEEPSEEK_API_KEY")
    client = AsyncOpenAI(api_key=key, base_url="https://api.deepseek.com")
    try:
        resp = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": "hello"}]
        )
        print("SUCCESS:", resp.choices[0].message.content)
    except Exception as e:
        print("ERROR:", str(e))
        traceback.print_exc()

asyncio.run(test())
