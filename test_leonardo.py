import json
import os
import sys

import requests

LEONARDO_API_KEY = os.environ.get("LEONARDO_API_KEY", "")
if not LEONARDO_API_KEY:
    sys.exit("Set LEONARDO_API_KEY")
HEADERS = {
    "accept": "application/json",
    "authorization": f"Bearer {LEONARDO_API_KEY}"
}

url = "https://cloud.leonardo.ai/api/rest/v2/generations"
payload = {
    "model": "gemini-2.5-flash-image",
    "parameters": {
        "width": 1024,
        "height": 1024,
        "prompt": "isolated single 3d floating object of 'wifi', completely naked borderless shape, NO bounding box, NO app square, pure solid white background, high quality 3d render",
        "quantity": 1,
        "prompt_enhance": "OFF"
    },
    "public": False
}

res = requests.post(url, json=payload, headers=HEADERS)
print("STATUS:", res.status_code)
print("RESPONSE:", res.text)
