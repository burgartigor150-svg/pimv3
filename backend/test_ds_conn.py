import asyncio
from openai import AsyncOpenAI
async def main():
    client = AsyncOpenAI(api_key="test", base_url="https://api.deepseek.com")
    try:
        await client.chat.completions.create(model="deepseek-chat", messages=[{"role": "user", "content": "hi"}])
    except Exception as e:
        print(repr(e))
asyncio.run(main())
