import argparse
import json
import math
import os
import re
import threading
import time
from pathlib import Path
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field

from backend.services import mm_o2m_client as mm_client
from backend.services import mm_o2m_ozon_client as ozon_client
from backend.services.mm_o2m_knowledge import knowledge_store

load_dotenv()

OZON_CLIENT_ID = os.getenv("OZON_CLIENT_ID")
OZON_API_KEY = os.getenv("OZON_API_KEY")
MEGAMARKET_TOKEN = os.getenv("MEGAMARKET_TOKEN")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o")

OZON_API_URL = ozon_client.OZON_API_URL
MM_API_URL = mm_client.MM_API_URL
MEDIA_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "media_cache")
os.makedirs(MEDIA_CACHE_DIR, exist_ok=True)
PUBLIC_BASE_URL = (
    os.getenv("APP_PUBLIC_BASE_URL")
    or os.getenv("PUBLIC_BASE_URL")
    or "http://127.0.0.1:3569"
).rstrip("/")
USE_LOCAL_MEDIA_LINKS = os.getenv("USE_LOCAL_MEDIA_LINKS", "auto").strip().lower()


class MMCategoryChoice(BaseModel):
    category_id: int = Field(description="Megamarket category id")
    reasoning: str = Field(description="Reason for the choice")


class MMAttributeValue(BaseModel):
    value: str


class MMAttribute(BaseModel):
    attributeId: int
    attributeName: Optional[str] = None
    values: List[MMAttributeValue]


class MMProductMapping(BaseModel):
    selected_brand: str
    name: str
    description: str
    series: Optional[str] = None
    barcode: Optional[str] = None
    weight: float
    height: float
    width: float
    depth: float
    contentAttributes: List[MMAttribute]
    images: List[str] = Field(default_factory=list)
    reasoning: Optional[str] = None


# PIMv3 AI integration
def _get_pimv3_ai_config():
    """Get AI config from PIMv3 system_settings."""
    import asyncio
    from sqlalchemy import select, text
    try:
        from backend.database import AsyncSessionLocal
        from backend import models
        async def _fetch():
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(models.SystemSettings).where(
                        models.SystemSettings.id.in_(["ai_provider", "deepseek_api_key", "gemini_api_key", "gemini_model", "local_llm_model"])
                    )
                )
                return {s.id: s.value for s in result.scalars().all()}
        settings = asyncio.get_event_loop().run_until_complete(_fetch()) if asyncio.get_event_loop().is_running() else asyncio.run(_fetch())
    except Exception:
        settings = {}
    
    provider = settings.get("ai_provider", "local")
    if provider == "gemini":
        return settings.get("gemini_api_key", ""), "https://generativelanguage.googleapis.com/v1beta/openai/", settings.get("gemini_model", "gemini-2.0-flash")
    elif provider == "local":
        return "ollama", "http://localhost:11434/v1", settings.get("local_llm_model", "qwen3:32b")
    else:
        return settings.get("deepseek_api_key", ""), "https://api.deepseek.com", "deepseek-chat"


def get_ozon_headers(creds: Optional[Dict[str, Any]] = None):
    return ozon_client.get_headers(creds, OZON_CLIENT_ID, OZON_API_KEY)


def get_mm_headers(creds: Optional[Dict[str, Any]] = None):
    return mm_client.get_headers(creds, MEGAMARKET_TOKEN)


def ensure_status_ok(response, context: str):
    if response.status_code != 200:
        raise Exception(f"{context}: {response.text}")


def ensure_ai_client_ready():
    if ai_client is None:
        raise Exception("AI client is not initialized. Check OPENAI_API_KEY / OPENAI_BASE_URL.")


def build_ozon_lookup_payload(query: str, search_type: str) -> Dict[str, List[Any]]:
    if search_type == "sku":
        return {"sku": [int(query)]}
    if search_type == "product_id":
        return {"product_id": [int(query)]}
    return {"offer_id": [query]}


def extract_internal_code(attributes: Dict[str, Any], fallback_offer_id: str) -> str:
    for attr in attributes.get("attributes", []):
        if attr.get("id") == 9024 and attr.get("values"):
            return attr["values"][0].get("value") or fallback_offer_id
    return fallback_offer_id


def normalize_barcode(raw_barcode: Optional[str]) -> Optional[str]:
    if not raw_barcode:
        return None
    cleaned = "".join(ch for ch in str(raw_barcode) if ch.isdigit())
    return cleaned or None


def _flatten_str_values(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out: List[str] = []
        for item in value:
            out.extend(_flatten_str_values(item))
        return out
    text = str(value).strip()
    return [text] if text else []


def _safe_offer_folder(offer_id: str) -> str:
    text = str(offer_id or "").strip() or "unknown_offer"
    text = re.sub(r"[^0-9A-Za-zА-Яа-я_.-]+", "_", text)
    return text[:120]


def _image_ext_from_url(url: str) -> str:
    path = urlparse(url).path or ""
    ext = Path(path).suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp"}:
        return ext
    return ".jpg"


def _cache_ozon_images_for_offer(core_info: dict, offer_id: str) -> dict:
    src_images = _flatten_str_values(core_info.get("images"))
    src_primary = _flatten_str_values(core_info.get("primary_image"))
    all_urls: List[str] = []
    for u in src_primary + src_images:
        if u and u not in all_urls:
            all_urls.append(u)

    if not all_urls:
        return {"images": src_images, "primary_image": src_primary[0] if src_primary else None}

    offer_folder = _safe_offer_folder(offer_id)
    target_dir = os.path.join(MEDIA_CACHE_DIR, offer_folder)
    os.makedirs(target_dir, exist_ok=True)

    local_public_urls: List[str] = []
    primary_public_url: Optional[str] = None

    for idx, src in enumerate(all_urls):
        try:
            ext = _image_ext_from_url(src)
            file_name = f"{idx+1:02d}_{abs(hash(src)) % (10**10)}{ext}"
            abs_path = os.path.join(target_dir, file_name)
            if not os.path.exists(abs_path):
                resp = requests.get(src, timeout=30)
                if resp.status_code != 200:
                    continue
                with open(abs_path, "wb") as f:
                    f.write(resp.content)
            public_url = f"{PUBLIC_BASE_URL}/media/{offer_folder}/{file_name}"
            local_public_urls.append(public_url)
            if primary_public_url is None:
                primary_public_url = public_url
        except Exception:
            continue

    if not local_public_urls:
        return {"images": src_images, "primary_image": src_primary[0] if src_primary else None}

    # MM requires externally reachable HTTPS links with valid certificate.
    # If we don't have HTTPS public base URL, keep source Ozon links for upload.
    if USE_LOCAL_MEDIA_LINKS == "always":
        use_local_links = True
    elif USE_LOCAL_MEDIA_LINKS == "never":
        use_local_links = False
    else:
        use_local_links = PUBLIC_BASE_URL.startswith("https://")

    if use_local_links:
        return {"images": local_public_urls, "primary_image": primary_public_url}
    return {"images": src_images, "primary_image": src_primary[0] if src_primary else None}


def _first_value(values: Any) -> Optional[str]:
    if not isinstance(values, list):
        return None
    for item in values:
        if isinstance(item, dict):
            val = item.get("value")
        else:
            val = item
        if val is None:
            continue
        text = str(val).strip()
        if text:
            return text
    return None


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        num = float(str(value).replace(",", "."))
        # Round by math rules instead of truncation.
        return int(math.floor(num + 0.5)) if num >= 0 else int(math.ceil(num - 0.5))
    except Exception:
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(str(value).replace(",", "."))
    except Exception:
        return default


def _mm_to_cm(mm_value: Any) -> float:
    mm_num = _to_float(mm_value, 0.0)
    return round(mm_num / 10.0, 1) if mm_num > 0 else 0.0


def normalize_ai_mapping_payload(data: dict, ozon_data: dict) -> dict:
    """
    Accept both the expected MMProductMapping format and legacy/loose AI formats.
    This prevents hard failures when model returns contentAttributes with `value`
    or top-level `masterAttributes`.
    """
    if not isinstance(data, dict):
        return {}

    raw_content = data.get("contentAttributes") or []
    normalized_content = []
    if isinstance(raw_content, list):
        for item in raw_content:
            if not isinstance(item, dict):
                continue
            attr_id = item.get("attributeId") or item.get("id")
            if attr_id is None:
                continue
            if "values" in item:
                source_values = item.get("values") or []
            elif "value" in item:
                source_values = [item.get("value")]
            else:
                source_values = []
            values = []
            if isinstance(source_values, list):
                for raw_val in source_values:
                    if isinstance(raw_val, dict):
                        vv = raw_val.get("value") or raw_val.get("name")
                    else:
                        vv = raw_val
                    if vv is None:
                        continue
                    txt = str(vv).strip()
                    if txt:
                        values.append({"value": txt})
            if values:
                normalized_content.append({"attributeId": _to_int(attr_id, 0), "values": values})

    master_map = {}
    raw_master = data.get("masterAttributes") or []
    if isinstance(raw_master, list):
        for item in raw_master:
            if not isinstance(item, dict):
                continue
            aid = _to_int(item.get("attributeId"), 0)
            if aid <= 0:
                continue
            val = _first_value(item.get("values"))
            if val is not None:
                master_map[aid] = val
            elif "value" in item and item.get("value") is not None:
                master_map[aid] = str(item.get("value"))

    normalized = {
        "selected_brand": data.get("selected_brand") or master_map.get(14) or "",
        "name": data.get("name") or master_map.get(17) or (ozon_data.get("name") or ""),
        "description": data.get("description") or master_map.get(16) or "",
        "series": data.get("series") or master_map.get(41),
        "barcode": data.get("barcode") or master_map.get(39) or (ozon_data.get("barcode") or ""),
        "weight": _to_float(data.get("weight"), _to_float(master_map.get(33), _to_float(ozon_data.get("weight_g"), 0.0))),
        "height": _to_float(data.get("height"), _to_float(master_map.get(35), _mm_to_cm(ozon_data.get("height_mm")))),
        "width": _to_float(data.get("width"), _to_float(master_map.get(36), _mm_to_cm(ozon_data.get("width_mm")))),
        "depth": _to_float(data.get("depth"), _to_float(master_map.get(34), _mm_to_cm(ozon_data.get("depth_mm")))),
        "contentAttributes": normalized_content,
        "reasoning": data.get("reasoning"),
    }
    images = data.get("images")
    normalized["images"] = images if isinstance(images, list) else (ozon_data.get("images") or [])
    return normalized


try:
    # Try PIMv3 config first, fallback to env
    try:
        _key, _base, _model = _get_pimv3_ai_config()
        if _key:
            OPENAI_API_KEY = _key
            OPENAI_BASE_URL = _base
            AI_MODEL = _model
    except Exception:
        pass
    ai_client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
except Exception:
    ai_client = None


def get_ozon_attribute_names(category_id: int, ozon_creds: dict = None) -> dict:
    print(f"[*] Fetching Ozon attribute names for category {category_id}...")
    res = ozon_client.post(
        "/v3/category/attribute",
        {"category_id": [category_id], "language": "DEFAULT"},
        ozon_creds,
        timeout=30,
        default_client_id=OZON_CLIENT_ID,
        default_api_key=OZON_API_KEY,
    )
    if res.status_code != 200:
        print(f"[!] Warning: Failed to fetch Ozon attribute names: {res.text}")
        return {}
    result = res.json().get("result", [])
    names = {}
    if result:
        for attr in result[0].get("attributes", []):
            names[attr.get("id")] = attr.get("name")
    return names


def get_ozon_product(query: str, search_type: str = "offer_id", ozon_creds: dict = None) -> dict:
    print(f"[*] Fetching Ozon product info ({search_type}): {query}")
    payload = build_ozon_lookup_payload(query, search_type)
    res_info = ozon_client.post(
        "/v3/product/info/list",
        payload,
        ozon_creds,
        timeout=30,
        default_client_id=OZON_CLIENT_ID,
        default_api_key=OZON_API_KEY,
    )
    ensure_status_ok(res_info, "Failed to fetch Ozon info")
    items = res_info.json().get("items", [])
    if not items:
        raise Exception(f"Product not found: {query}")
    info = items[0]

    actual_offer_id = info.get("offer_id")
    res_attr = ozon_client.post(
        "/v4/product/info/attributes",
        {
            "filter": {"offer_id": [actual_offer_id], "visibility": "ALL"},
            "limit": 1,
            "last_id": "",
        },
        ozon_creds,
        timeout=30,
        default_client_id=OZON_CLIENT_ID,
        default_api_key=OZON_API_KEY,
    )
    ensure_status_ok(res_attr, "Failed to fetch Ozon attributes")
    attr_list = res_attr.json().get("result", [])
    attributes = attr_list[0] if attr_list else {}

    cat_id = info.get("category_id")
    attr_names = get_ozon_attribute_names(cat_id, ozon_creds) if cat_id else {}
    for attr in attributes.get("attributes", []):
        attr["name"] = attr_names.get(attr.get("id"), f"Attribute {attr.get('id')}")

    internal_code = extract_internal_code(attributes, info.get("offer_id"))
    cached_images = _cache_ozon_images_for_offer(info, internal_code or info.get("offer_id"))
    info["images"] = cached_images.get("images", info.get("images", []))
    if cached_images.get("primary_image"):
        info["primary_image"] = cached_images["primary_image"]
    return {"core_info": info, "attributes": attributes, "internal_code": internal_code}


def list_ozon_products(limit: int = 50, last_id: str = "", ozon_creds: dict = None) -> dict:
    print(f"[*] Fetching Ozon product list (limit {limit})...")
    res_list = ozon_client.post(
        "/v3/product/list",
        {"limit": limit, "last_id": last_id, "filter": {"visibility": "ALL"}},
        ozon_creds,
        timeout=30,
        default_client_id=OZON_CLIENT_ID,
        default_api_key=OZON_API_KEY,
    )
    ensure_status_ok(res_list, "Failed to fetch Ozon product list")
    product_ids = [p["product_id"] for p in res_list.json().get("result", {}).get("items", [])]
    if not product_ids:
        return {"items": [], "last_id": ""}

    res_info = ozon_client.post(
        "/v3/product/info/list",
        {"product_id": product_ids},
        ozon_creds,
        timeout=30,
        default_client_id=OZON_CLIENT_ID,
        default_api_key=OZON_API_KEY,
    )
    ensure_status_ok(res_info, "Failed to fetch batch Ozon info")
    res_list_json = res_list.json().get("result", {})
    return {"items": res_info.json().get("items", []), "last_id": res_list_json.get("last_id", "")}


def load_mm_categories() -> dict:
    with open("megamarket_categories.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    leaves = {}

    def extract(nodes, path=""):
        for n in nodes:
            curr_path = f"{path} > {n.get('name')}" if path else n.get("name")
            if n.get("children"):
                extract(n["children"], curr_path)
            else:
                leaves[str(n.get("id"))] = curr_path

    extract(data.get("data", []))
    print(f"[*] Loaded {len(leaves)} leaf categories from Megamarket.")
    return leaves


_mm_cat_items = None


def get_mm_cat_items(mm_categories):
    global _mm_cat_items
    if _mm_cat_items is None:
        _mm_cat_items = [(cat_id, path.lower()) for cat_id, path in mm_categories.items()]
    return _mm_cat_items


def ai_select_category(ozon_product: dict, mm_categories: dict, use_memory: bool = True) -> int:
    ozon_name = ozon_product["core_info"].get("name", "")
    if use_memory:
        cached_id = knowledge_store.find_remembered_category(ozon_name)
        if cached_id:
            print(f"[Memory] Using remembered category for {ozon_name}: {cached_id}")
            return int(cached_id)

    ensure_ai_client_ready()
    ozon_name_lower = ozon_name.lower()
    keywords = [kw for kw in ozon_name_lower.split() if len(kw) > 2]
    cat_items = get_mm_cat_items(mm_categories)
    scored = []
    for cat_id, path_lower in cat_items:
        score = 0
        for kw in keywords:
            if kw in path_lower:
                score += 1
        if score > 0:
            scored.append((score, cat_id))
    scored.sort(key=lambda x: x[0], reverse=True)
    top_candidates = {cat_id: mm_categories[cat_id] for _, cat_id in scored[:80]}
    prompt = (
        "Select the most appropriate Megamarket category ID.\n"
        f"Product Name: {ozon_name}\n\nCandidates:\n{json.dumps(top_candidates, ensure_ascii=False)}\n\n"
        'Return JSON: {"category_id": integer, "reasoning": "string"}'
    )
    is_deepseek = "deepseek" in (OPENAI_BASE_URL or "").lower() or (AI_MODEL or "").startswith("deepseek")
    if is_deepseek:
        response = ai_client.chat.completions.create(
            model=AI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            timeout=300,
        )
        data = json.loads(response.choices[0].message.content)
        result = MMCategoryChoice(**data)
    else:
        completion = ai_client.beta.chat.completions.parse(
            model=AI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format=MMCategoryChoice,
        )
        result = completion.choices[0].message.parsed
    knowledge_store.save_category_match(ozon_name, result.category_id)
    return result.category_id


SCHEMA_CACHE_DIR = "schema_cache"
os.makedirs(SCHEMA_CACHE_DIR, exist_ok=True)
_schema_memory = {}
_schema_lock = threading.Lock()


def get_mm_category_schema(cat_id: int, mm_creds: dict = None) -> dict:
    global _schema_memory
    with _schema_lock:
        if cat_id in _schema_memory:
            return _schema_memory[cat_id]
    cache_path = os.path.join(SCHEMA_CACHE_DIR, f"{cat_id}.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            with _schema_lock:
                _schema_memory[cat_id] = data
            return data
        except Exception:
            pass

    with _schema_lock:
        if cat_id in _schema_memory:
            return _schema_memory[cat_id]
        payload = {"meta": {}, "data": {"categoryId": cat_id}}
        res = mm_client.post("/infomodel/get", payload, mm_creds, timeout=30, default_token=MEGAMARKET_TOKEN)
        if res.status_code != 200:
            print(f"[!] Warning: Failed to fetch MM schema for {cat_id}: {res.text}")
            return {}
        data = res.json().get("data", {})
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        _schema_memory[cat_id] = data
        return data


def trim_schema(schema: dict) -> dict:
    if not schema:
        return {}
    trimmed = {"contentAttributes": [], "masterAttributes": []}
    for section in ["contentAttributes", "masterAttributes"]:
        for attr in schema.get(section, []):
            row = {
                "attributeId": attr.get("attributeId"),
                "attributeName": attr.get("attributeName"),
                "isRequired": attr.get("isRequired"),
                "valueTypeCode": attr.get("valueTypeCode"),
                "isSuggest": attr.get("isSuggest", True),
            }
            d_list = attr.get("dictionaryList")
            if d_list:
                row["dictionaryList"] = d_list[:20]
                if len(d_list) > 20:
                    row["dictionaryNote"] = f"...and {len(d_list)-20} more values"
            trimmed[section].append(row)
    return trimmed


def _first_ozon_attr_value_by_name_keywords(
    ozon_data: dict, keywords: list[str], exclude_keywords: Optional[list[str]] = None
) -> Optional[str]:
    kws = [k.lower() for k in keywords if k]
    excludes = [k.lower() for k in (exclude_keywords or []) if k]
    for item in ozon_data.get("attributes", []) or []:
        name = str(item.get("name") or "").lower()
        if not name:
            continue
        if excludes and any(ex in name for ex in excludes):
            continue
        if all(kw in name for kw in kws):
            vals = item.get("values") or []
            if vals:
                return str(vals[0]).strip()
    return None


def _parse_number_text(value: Any) -> Optional[float]:
    if value is None:
        return None
    import re

    m = re.search(r"-?\d+(?:[.,]\d+)?", str(value))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", "."))
    except Exception:
        return None


def _set_attr_single_value(attr: MMAttribute, value: Any):
    if value is None:
        attr.values = []
        return
    text = str(value).strip()
    attr.values = [MMAttributeValue(value=text)] if text else []


def _extract_audio_format_from_name(name: Any) -> Optional[str]:
    text = str(name or "")
    # Common channel notation in titles (e.g. 2.1, 5.1.2).
    m = re.search(r"\b\d(?:[.,]\d){1,2}\b", text)
    if not m:
        return None
    return m.group(0).replace(",", ".")


def _postprocess_tv_mapping(mapped: MMProductMapping, ozon_data: dict):
    name = str(ozon_data.get("name") or "").lower()
    if "телевиз" not in name:
        return

    for attr in mapped.contentAttributes:
        attr_name = str(attr.attributeName or "").lower()
        if not attr_name:
            continue

        if "формат изображения" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["формат изображения"]) or _first_ozon_attr_value_by_name_keywords(
                ozon_data, ["соотношение", "сторон"]
            )
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "дизайн" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["дизайн"])
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "голосовой помощник" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["голосовой", "помощник"])
            if not src:
                attr.values = []
            elif "нет" in src.lower():
                _set_attr_single_value(attr, "Нет")
            else:
                _set_attr_single_value(attr, src)

        if "умного дома" in attr_name or "smart home" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["умного", "дома"])
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "usb" in attr_name and ("количество" in attr_name or "кол-во" in attr_name):
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["usb", "кол"]) or _first_ozon_attr_value_by_name_keywords(
                ozon_data, ["количество", "usb"]
            )
            num = _parse_number_text(src)
            if num is not None:
                _set_attr_single_value(attr, str(int(round(num))))

        if "hdmi" in attr_name and ("количество" in attr_name or "кол-во" in attr_name):
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["hdmi", "кол"]) or _first_ozon_attr_value_by_name_keywords(
                ozon_data, ["количество", "hdmi"]
            )
            num = _parse_number_text(src)
            if num is not None:
                _set_attr_single_value(attr, str(int(round(num))))

        if "ядер" in attr_name and "процессор" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["ядер"]) or _first_ozon_attr_value_by_name_keywords(
                ozon_data, ["процессор"]
            )
            num = _parse_number_text(src)
            if num is None:
                attr.values = []
            else:
                _set_attr_single_value(attr, str(int(round(num))))

        if "вес" in attr_name and "без подставки" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["вес", "без", "подстав"])
            num = _parse_number_text(src)
            if num is None:
                attr.values = []
            else:
                _set_attr_single_value(attr, f"{num:g}")

    def _find_attr(substrings: list[str]) -> Optional[MMAttribute]:
        for a in mapped.contentAttributes:
            n = str(a.attributeName or "").lower()
            if all(s in n for s in substrings):
                return a
        return None

    for suffix in (["с", "подстав"], ["без", "подстав"]):
        width_attr = _find_attr(["ширина"] + suffix)
        height_attr = _find_attr(["высота"] + suffix)
        if not width_attr or not height_attr or not width_attr.values or not height_attr.values:
            continue
        w = _parse_number_text(width_attr.values[0].value)
        h = _parse_number_text(height_attr.values[0].value)
        if w is None or h is None:
            continue
        if w < h:
            width_attr.values[0].value, height_attr.values[0].value = height_attr.values[0].value, width_attr.values[0].value


def _postprocess_soundbar_mapping(mapped: MMProductMapping, ozon_data: dict):
    name = str(ozon_data.get("name") or "").lower()
    if not any(k in name for k in ("саундбар", "саунд бар", "soundbar")):
        return

    package_keywords = ["упаков", "в упаковке", "короб", "брутто", "габариты упаков", "размер упаков"]

    for attr in mapped.contentAttributes:
        attr_name = str(attr.attributeName or "").lower()
        if not attr_name:
            continue

        if "формат звука" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["формат", "звука"])
            src = src or _extract_audio_format_from_name(ozon_data.get("name"))
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "голосовой помощник" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["голосовой", "помощник"])
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "сабвуфер" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["сабвуфер"], exclude_keywords=package_keywords)
            if not src:
                attr.values = []
            else:
                low = src.lower()
                if "беспровод" in low:
                    _set_attr_single_value(attr, "Беспроводной")
                elif "встро" in low:
                    _set_attr_single_value(attr, "Встроенный")
                elif "нет" in low or "отсутств" in low:
                    _set_attr_single_value(attr, "Нет")
                else:
                    _set_attr_single_value(attr, src)

        if "размещ" in attr_name or "монтаж" in attr_name or "установ" in attr_name:
            src = (
                _first_ozon_attr_value_by_name_keywords(ozon_data, ["размещ"])
                or _first_ozon_attr_value_by_name_keywords(ozon_data, ["монтаж"])
                or _first_ozon_attr_value_by_name_keywords(ozon_data, ["креплен"])
            )
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "диапазон частот" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["диапазон", "частот"])
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "протокол" in attr_name or "профил" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["протокол"]) or _first_ozon_attr_value_by_name_keywords(
                ozon_data, ["профил"]
            )
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "поток" in attr_name and ("аудио" in attr_name or "воспроизв" in attr_name):
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["поток"]) or _first_ozon_attr_value_by_name_keywords(
                ozon_data, ["стрим"]
            )
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "количество" in attr_name and "динамик" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["колич", "динамик"])
            num = _parse_number_text(src)
            if num is None:
                attr.values = []
            else:
                _set_attr_single_value(attr, str(int(round(num))))

        if "мощность динамик" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["мощность", "динамик"])
            if src and not ("общ" in src.lower() and "систем" in src.lower()):
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "потребляем" in attr_name and "мощност" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["потребляем", "мощност"])
            if src and not ("общ" in src.lower() and "систем" in src.lower()):
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "поддержка" in attr_name and "3d" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["3d"]) or _first_ozon_attr_value_by_name_keywords(
                ozon_data, ["3 д"]
            )
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "поддержка" in attr_name and "4k" in attr_name:
            src = _first_ozon_attr_value_by_name_keywords(ozon_data, ["4k"]) or _first_ozon_attr_value_by_name_keywords(
                ozon_data, ["4 к"]
            )
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "саундбар" in attr_name and ("габарит" in attr_name or "размер" in attr_name or "ширина" in attr_name):
            src = (
                _first_ozon_attr_value_by_name_keywords(ozon_data, ["саундбар", "габарит"], exclude_keywords=package_keywords)
                or _first_ozon_attr_value_by_name_keywords(ozon_data, ["саундбар", "размер"], exclude_keywords=package_keywords)
                or _first_ozon_attr_value_by_name_keywords(ozon_data, ["саундбар", "ширина"], exclude_keywords=package_keywords)
            )
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []

        if "сабвуфер" in attr_name and ("габарит" in attr_name or "размер" in attr_name or "вес" in attr_name):
            src = (
                _first_ozon_attr_value_by_name_keywords(ozon_data, ["сабвуфер", "габарит"], exclude_keywords=package_keywords)
                or _first_ozon_attr_value_by_name_keywords(ozon_data, ["сабвуфер", "размер"], exclude_keywords=package_keywords)
                or _first_ozon_attr_value_by_name_keywords(ozon_data, ["сабвуфер", "вес"], exclude_keywords=package_keywords)
            )
            if src:
                _set_attr_single_value(attr, src)
            else:
                attr.values = []


def _norm_text(text: Any) -> str:
    s = str(text or "").lower().replace("ё", "е")
    return re.sub(r"\s+", " ", s).strip()


def _build_ozon_evidence(ozon_data: dict) -> tuple[str, set[str]]:
    texts = []
    name = ozon_data.get("name")
    if name:
        texts.append(str(name))
    for item in ozon_data.get("attributes", []) or []:
        n = item.get("name")
        if n:
            texts.append(str(n))
        for v in item.get("values", []) or []:
            if v is not None:
                texts.append(str(v))
    blob = _norm_text(" | ".join(texts))
    tokens = {t for t in re.split(r"[^a-zа-я0-9]+", blob) if len(t) >= 3}
    return blob, tokens


def _is_value_supported_by_ozon(value: str, evidence_blob: str, evidence_tokens: set[str]) -> bool:
    probe = _norm_text(value)
    if not probe:
        return False
    if probe in evidence_blob:
        return True
    parts = [p.strip() for p in re.split(r"\s*,\s*|\s*;\s*|\s*\|\s*|/", probe) if p.strip()]
    if len(parts) > 1:
        # For list-like values require that every part is seen in Ozon evidence.
        return all((p in evidence_blob) for p in parts)
    probe_tokens = {t for t in re.split(r"[^a-zа-я0-9]+", probe) if len(t) >= 3}
    if not probe_tokens:
        return False
    return len(probe_tokens & evidence_tokens) >= max(1, min(2, len(probe_tokens)))


def _strict_filter_mapping_to_ozon_source(mapped: MMProductMapping, full_schema: dict, ozon_data: dict):
    """
    Global anti-hallucination guard:
    keep non-required text/enum values only when they are supported by Ozon source text.
    """
    evidence_blob, evidence_tokens = _build_ozon_evidence(ozon_data)
    schema_index = {}
    for section in ("contentAttributes", "masterAttributes"):
        for a in full_schema.get(section, []) or []:
            aid = a.get("attributeId")
            if aid is None:
                continue
            try:
                schema_index[int(aid)] = a
            except Exception:
                continue

    for attr in mapped.contentAttributes:
        sch = schema_index.get(int(attr.attributeId))
        if not sch:
            continue
        if sch.get("isRequired"):
            # Required fields are handled by repair loop; don't over-prune here.
            continue
        value_type = str(sch.get("valueTypeCode") or "").lower()
        if value_type in {"float", "double", "decimal", "number", "int", "integer", "long", "bool", "boolean"}:
            continue
        filtered = []
        for v in attr.values or []:
            raw = v.value if hasattr(v, "value") else v
            if raw is None:
                continue
            txt = str(raw).strip()
            if not txt:
                continue
            if _is_value_supported_by_ozon(txt, evidence_blob, evidence_tokens):
                filtered.append(v)
        attr.values = filtered


def _is_non_empty_value(value: Any) -> bool:
    if value is None:
        return False
    return str(value).strip() != ""


def _missing_required_content_attrs(mapped: MMProductMapping, full_schema: dict) -> list[dict]:
    required = [a for a in (full_schema.get("contentAttributes", []) or []) if a.get("isRequired") is True]
    if not required:
        return []
    mapped_index = {int(a.attributeId): a for a in mapped.contentAttributes if getattr(a, "attributeId", None) is not None}
    missing = []
    for attr in required:
        aid = attr.get("attributeId")
        try:
            aid_int = int(aid)
        except Exception:
            continue
        mapped_attr = mapped_index.get(aid_int)
        has_value = False
        if mapped_attr and isinstance(mapped_attr.values, list):
            for v in mapped_attr.values:
                raw = v.value if hasattr(v, "value") else v
                if _is_non_empty_value(raw):
                    has_value = True
                    break
        if not has_value:
            missing.append(attr)
    return missing


def _compact_required_attrs_for_prompt(attrs: list[dict]) -> list[dict]:
    out = []
    for a in attrs or []:
        row = {
            "attributeId": a.get("attributeId"),
            "attributeName": a.get("attributeName"),
            "valueTypeCode": a.get("valueTypeCode"),
            "isSuggest": a.get("isSuggest", True),
        }
        dlist = a.get("dictionaryList") or a.get("dictionaryValues") or []
        if dlist:
            row["dictionaryList"] = dlist[:40]
        out.append(row)
    return out


def ai_map_product(
    ozon_product: dict,
    cat_id: int,
    mm_creds: dict = None,
    error_feedback: str = None,
    attempt_history: Optional[List[Dict[str, Any]]] = None,
) -> MMProductMapping:
    ensure_ai_client_ready()
    start_time = time.time()
    full_schema = get_mm_category_schema(cat_id, mm_creds)
    schema = trim_schema(full_schema)
    lessons = knowledge_store.get_relevant_knowledge(cat_id)
    rules = knowledge_store.get_all_rules()
    lessons_formatted = ""
    if lessons:
        lessons_formatted = "\nLEARNED LESSONS:\n" + "\n".join(
            [f"- IF ERROR: {x['error_text']} -> APPLY: {x['fix_logic']}" for x in lessons]
        )
    docs_formatted = "\nPLATFORM RULES:\n" + "\n".join([f"- {x['topic']}: {x['rule']}" for x in rules])
    attempts_formatted = ""
    if attempt_history:
        attempts_formatted = "\nPREVIOUS ATTEMPTS:\n"
        for item in attempt_history[-3:]:
            attempts_formatted += f"- attempt={item.get('attempt')} error={item.get('error')} sig={item.get('mapping_signature')}\n"

    raw_images = ozon_product["core_info"].get("images", []) or []
    primary_image = ozon_product["core_info"].get("primary_image")

    def _flatten_images(value: Any) -> List[str]:
        out: List[str] = []
        if value is None:
            return out
        if isinstance(value, list):
            for item in value:
                out.extend(_flatten_images(item))
            return out
        text = str(value).strip()
        if text:
            out.append(text)
        return out

    ordered_images: List[str] = []
    for img in _flatten_images(primary_image):
        if img not in ordered_images:
            ordered_images.append(img)
    for img in _flatten_images(raw_images):
        if img not in ordered_images:
            ordered_images.append(img)

    ozon_data = {
        "name": ozon_product["core_info"].get("name"),
        "barcode": ozon_product["core_info"].get("barcodes")[0] if ozon_product["core_info"].get("barcodes") else "",
        "weight_g": ozon_product["attributes"].get("weight"),
        "depth_mm": ozon_product["attributes"].get("depth"),
        "width_mm": ozon_product["attributes"].get("width"),
        "height_mm": ozon_product["attributes"].get("height"),
        "images": ordered_images,
        "attributes": [
            {
                "id": a.get("id"),
                "name": a.get("name") or f"Attr {a.get('id')}",
                "values": [v.get("value") for v in a.get("values", [])],
            }
            for a in ozon_product["attributes"].get("attributes", [])
        ],
    }
    mm_target_options = {"contentAttributes": schema.get("contentAttributes", []), "masterAttributes": schema.get("masterAttributes", [])}
    required_content_attrs = [
        {
            "attributeId": a.get("attributeId"),
            "attributeName": a.get("attributeName"),
            "valueTypeCode": a.get("valueTypeCode"),
            "isSuggest": a.get("isSuggest", True),
            "dictionaryList": a.get("dictionaryList") or [],
        }
        for a in mm_target_options.get("contentAttributes", [])
        if a.get("isRequired") is True
    ]

    prompt = f"""
Map OZON product data to Megamarket target schema.
{(f'PREVIOUS ERROR FEEDBACK: {error_feedback}' if error_feedback else '')}
{attempts_formatted}
{lessons_formatted}
{docs_formatted}

Ozon Data:
{json.dumps(ozon_data, ensure_ascii=False)}

Megamarket Schema:
{json.dumps(mm_target_options, ensure_ascii=False)}

Required content attributes (MUST be non-empty in output):
{json.dumps(required_content_attrs, ensure_ascii=False)}

Rules:
1) Weight in grams, dimensions in cm (from mm -> cm).
2) Fill ALL required attributes.
3) If isSuggest=false use exact dictionary values.
4) name <= 90 chars, description <= 2500 chars.
5) Photos max 15.
6) If previous attempts exist, do not repeat the same failing mapping decisions.
Return strict JSON for MMProductMapping.
"""

    is_deepseek = "deepseek" in (OPENAI_BASE_URL or "").lower() or (AI_MODEL or "").startswith("deepseek")

    def _call_ai_mapping(user_prompt: str) -> MMProductMapping:
        if is_deepseek:
            response = ai_client.chat.completions.create(
                model=AI_MODEL,
                messages=[
                    {"role": "system", "content": "You are a precise e-commerce data mapper. Return valid JSON only."},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                timeout=300,
            )
            data = json.loads(response.choices[0].message.content)
            return MMProductMapping(**normalize_ai_mapping_payload(data, ozon_data))
        completion = ai_client.beta.chat.completions.parse(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": "You are an expert e-commerce data mapper. Return valid JSON."},
                {"role": "user", "content": user_prompt},
            ],
            response_format=MMProductMapping,
            timeout=300,
        )
        return completion.choices[0].message.parsed

    result = _call_ai_mapping(prompt)

    result.images = ozon_data["images"]
    combined = full_schema.get("contentAttributes", []) + full_schema.get("masterAttributes", [])
    attr_names = {a.get("attributeId"): a.get("attributeName") for a in combined}
    for attr in result.contentAttributes:
        attr.attributeName = attr_names.get(attr.attributeId, f"ID: {attr.attributeId}")
    _postprocess_tv_mapping(result, ozon_data)
    _postprocess_soundbar_mapping(result, ozon_data)
    _strict_filter_mapping_to_ozon_source(result, full_schema, ozon_data)

    # Systemic safeguard for large-scale imports:
    # if required content fields are still empty, force one focused remap pass.
    missing_required = _missing_required_content_attrs(result, full_schema)
    if missing_required:
        missing_prompt = f"""
Your previous mapping is missing required content attributes.
You MUST return a full MMProductMapping JSON with non-empty values for these required fields.
Do not invent free text when dictionary values are provided; pick appropriate value from dictionary.

Ozon Data:
{json.dumps(ozon_data, ensure_ascii=False)}

Megamarket Schema (trimmed):
{json.dumps(mm_target_options, ensure_ascii=False)}

Previous mapping:
{json.dumps(result.model_dump(), ensure_ascii=False)}

Missing required attributes:
{json.dumps(_compact_required_attrs_for_prompt(missing_required), ensure_ascii=False)}
"""
        try:
            remapped = _call_ai_mapping(missing_prompt)
            remapped.images = ozon_data["images"]
            for attr in remapped.contentAttributes:
                attr.attributeName = attr_names.get(attr.attributeId, f"ID: {attr.attributeId}")
            _postprocess_tv_mapping(remapped, ozon_data)
            _postprocess_soundbar_mapping(remapped, ozon_data)
            _strict_filter_mapping_to_ozon_source(remapped, full_schema, ozon_data)
            new_missing = _missing_required_content_attrs(remapped, full_schema)
            if len(new_missing) <= len(missing_required):
                result = remapped
        except Exception as e:
            print(f"[!] Required-attributes remap pass failed: {e}")
    print(f"[+] AI mapping completed in {time.time() - start_time:.2f}s")
    return result


def create_payload(mapped: MMProductMapping, cat_id: int, offer_id: str, merchant_id: str = None) -> dict:
    barcode = normalize_barcode(mapped.barcode)
    if barcode and len(barcode) not in {8, 12, 13}:
        barcode = ""
    def _text(value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()

    short_name = _text(mapped.name)[:90] or str(offer_id)
    brand = _text(mapped.selected_brand) or "Без бренда"
    description = (_text(mapped.description) or short_name)[:2500]
    content_attrs = []
    for attr in mapped.contentAttributes:
        values: List[str] = []
        for v in attr.values:
            raw = v.value
            if raw is None:
                continue
            # MM CardSave expects string values in arrays; keep logical values as "true"/"false".
            if isinstance(raw, bool):
                values.append("true" if raw else "false")
                continue
            text = str(raw).strip()
            if text != "":
                values.append(text)
        if values:
            content_attrs.append({"attributeId": attr.attributeId, "values": values})

    # Keep Ozon order: main image should stay first.
    short_photos = mapped.images[:15] if mapped.images else []
    def _num_text(v: Any) -> str:
        n = _to_float(v, 0.0)
        return f"{n:g}"

    master_attrs = [
        {"attributeId": 17, "values": [short_name]},
        {"attributeId": 14, "values": [brand]},
        {"attributeId": 16, "values": [description]},
        {"attributeId": 15, "values": [offer_id]},
        {"attributeId": 33, "values": [_num_text(mapped.weight)]},
        {"attributeId": 34, "values": [_num_text(mapped.depth)]},
        {"attributeId": 35, "values": [_num_text(mapped.height)]},
        {"attributeId": 36, "values": [_num_text(mapped.width)]},
    ]
    if short_photos:
        master_attrs.append({"attributeId": 18, "values": short_photos})
    if barcode:
        master_attrs.append({"attributeId": 39, "values": [barcode]})
    if mapped.series:
        master_attrs.append({"attributeId": 41, "values": [mapped.series]})

    card = {
        "offerId": offer_id,
        "name": short_name,
        "brand": brand,
        "description": description,
        "manufacturerNo": offer_id,
        "photos": short_photos,
        "package": {"weight": mapped.weight, "height": mapped.height, "width": mapped.width, "length": mapped.depth},
        "masterAttributes": master_attrs,
        "contentAttributes": content_attrs,
    }
    if barcode:
        card["barcodes"] = [barcode]
    if mapped.series:
        card["series"] = mapped.series
    payload = {"categoryId": cat_id, "cards": [card]}
    if merchant_id:
        payload["merchantId"] = int(merchant_id)
    return payload


CONSULTANT_SYSTEM_PROMPT = """Ты — ИИ-консультант приложения «Megamarket AI Importer». Ты знаешь весь функционал и помогаешь пользователям разобраться в работе системы. Отвечай кратко, по делу, на русском.

## Основное назначение
Перенос товарных карточек с Ozon на Мегамаркет с ИИ-маппингом атрибутов. Система не выдумывает данные: если в Ozon нет — пользователь заполняет вручную.

## Вкладки и режимы

### Поиск по ID (одиночный режим)
- Выбор кабинетов Ozon и Megamarket (обязательно).
- Поиск по артикулу (offer_id), SKU или product_id.
- «Найти и сопоставить» — ИИ загружает товар с Ozon, выбирает категорию MM, маппит атрибуты.
- Результат: карточка с обязательными пустыми полями (если данных в Ozon нет) и сомнительными значениями (не подтверждены Ozon).
- Пользователь заполняет/исправляет и нажимает «Залить на Мегамаркет».

### Каталог Ozon
- Загрузка списка товаров из Ozon.
- Можно выбрать несколько и запустить сопоставление по очереди.

### Массовый импорт
Два режима:
1. **«Начать сопоставление и загрузку»** — сразу маппит и отправляет в MM (с опцией авто-исправления ошибок).
2. **«Сначала черновик (без выгрузки)»** — только маппинг, без отправки. Статусы: Готово / Нужна проверка / Ошибка. У каждой строки кнопка «Открыть» — открывает карточку для ручной правки. «Сохранить правки в черновик» фиксирует изменения. «Выгрузить отмеченные из черновика» — отправляет в MM только проверенные и отмеченные чекбоксом карточки.

### Настройки
- Кабинеты Ozon и Megamarket (добавление, удаление).
- Пользователи и права (только для админа): создание, роли, доступ к кабинетам, генерация пароля.

## Кнопки и действия
- **Переотправить тех. ошибки** — повторная отправка карточек с технической ошибкой MM (code 500) без изменения данных.
- **Исправить ВСЕ ошибки кабинета** — авто-ремонт всех ошибочных карточек в MM.
- **Проверить статусы** — запрос актуальных статусов карточек на Мегамаркете.

## Важные правила
- Система не придумывает атрибуты — только из Ozon или ручной ввод.
- Сомнительные значения (не подтверждены Ozon) можно очистить или заменить.
- Для обязательных полей MM без данных в Ozon — выпадающие списки или ручной ввод.
- Черновик bulk позволяет сначала проверить все карточки, а выгружать только проверенные.
"""


def consultant_chat(user_message: str, history: Optional[list] = None) -> str:
    ensure_ai_client_ready()
    messages = [{"role": "system", "content": CONSULTANT_SYSTEM_PROMPT}]
    for h in (history or [])[-10:]:
        if h.get("role") and h.get("content"):
            messages.append({"role": h["role"], "content": str(h["content"])[:2000]})
    messages.append({"role": "user", "content": str(user_message)[:1500]})
    try:
        response = ai_client.chat.completions.create(
            model=AI_MODEL,
            messages=messages,
            max_tokens=800,
            temperature=0.4,
        )
        return (response.choices[0].message.content or "").strip()
    except Exception as e:
        return f"Ошибка консультанта: {str(e)}"


def main():
    parser = argparse.ArgumentParser(description="Ozon to Megamarket AI Importer")
    parser.add_argument("--query", required=True, help="Ozon query")
    parser.add_argument("--type", default="offer_id", choices=["offer_id", "sku", "product_id"], help="Search type")
    parser.add_argument("--dry-run", action="store_true", help="Skip card/save")
    args = parser.parse_args()

    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY is not set.")
        return
    ozon_product = get_ozon_product(args.query, args.type)
    mm_categories = load_mm_categories()
    cat_id = ai_select_category(ozon_product, mm_categories)
    mapped = ai_map_product(ozon_product, cat_id)
    payload = create_payload(mapped, cat_id, ozon_product["core_info"].get("offer_id"))
    with open("megamarket_payload_preview.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    if not args.dry_run:
        res = mm_client.post("/card/save", payload, timeout=300, default_token=MEGAMARKET_TOKEN)
        print(res.status_code, res.text[:800])


if __name__ == "__main__":
    main()
