import json
import os
from openai import AsyncOpenAI
from backend.models import Attribute
from typing import List, Dict, Any

def get_client_and_model(config_str: str, role: str = "runtime"):
    try:
        config = json.loads(config_str)
        provider = config.get("provider", "deepseek")
        api_key = config.get("api_key", "missing")
    except json.JSONDecodeError:
        provider = "deepseek"
        api_key = config_str

    if provider == "gemini":
        model = config.get("model", "gemini-2.0-flash") if isinstance(config, dict) else "gemini-2.0-flash"
        return AsyncOpenAI(
            api_key=api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        ), model
    elif provider == "local":
        if role == "code":
            local_model = os.getenv("LOCAL_CODE_LLM_MODEL", os.getenv("LOCAL_LLM_MODEL", "qwen3:14b"))
        else:
            local_model = os.getenv("LOCAL_LLM_MODEL", "qwen3:14b")
        return AsyncOpenAI(api_key="ollama", base_url="http://127.0.0.1:11434/v1"), local_model
    else:
        return AsyncOpenAI(api_key=api_key, base_url="https://api.deepseek.com"), "deepseek-chat"


async def chat_json_with_retries(
    *,
    config_str: str,
    messages: List[Dict[str, str]],
    role: str = "runtime",
    temperature: float = 0.0,
    max_retries: int = 3,
) -> Dict[str, Any]:
    """
    Единый JSON вызов с fallback: temperature=0 и повтор при невалидном JSON.
    """
    client, model_name = get_client_and_model(config_str, role=role)
    last_err = ""
    for attempt in range(max_retries):
        temp = 0.0 if attempt > 0 else temperature
        try:
            resp = await client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=temp,
                response_format={"type": "json_object"},
            )
            raw = (resp.choices[0].message.content or "").strip()
            if raw.startswith("```json"):
                raw = raw[7:]
            if raw.startswith("```"):
                raw = raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            data = json.loads(raw.strip())
            if isinstance(data, dict):
                return data
            last_err = "model did not return object"
        except Exception as e:
            last_err = str(e)
    return {"_error": f"json_generation_failed: {last_err}"}

async def extract_attributes(text: str, active_attributes: List[Attribute], api_key: str) -> Dict[str, Any]:
    schema_desc = {}
    for attr in active_attributes:
        schema_desc[attr.code] = f"{attr.name} (type: {attr.type}, required: {attr.is_required})"

    system_prompt = f"""
    You are an AI data extractor. Extract the product attributes from the user's text.
    Target Schema: {json.dumps(schema_desc, ensure_ascii=False)}
    Return ONLY a valid JSON object matching this schema. Keys must be the attribute codes.
    If a value is not found, OMIT the key entirely (DO NOT set to null or empty string).
    """

    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text}
        ],
        response_format={"type": "json_object"}
    )

    try:
        data = json.loads(response.choices[0].message.content)
        return data
    except Exception:
        return {}

async def categorize_and_extract(text: str, active_attributes: List[Attribute], api_key: str, mp_context: str = None) -> Dict[str, Any]:
    schema_desc = {}
    for attr in active_attributes:
        schema_desc[attr.code] = f"{attr.name} (type: {attr.type})"

    mp_info = f"\nYou are currently extracting data sourced from the '{mp_context}' marketplace." if mp_context else ""

    system_prompt = f"""
    You are an AI data extractor, product categorizer, and PIM schema architect. You will receive raw product data.{mp_info}
    
    1. Suggest a multi-level Category Hierarchy (Array of strings, root to leaf) (e.g. ["Электроника", "Свичи"]).
    2. Review the provided existing schema:
    {json.dumps(schema_desc, ensure_ascii=False)}
    3. Extract values for the existing schema attributes if found. OMIT keys entirely if no value is found (DO NOT include null or empty strings).
    4. IF the product has important characteristics NOT covered by the existing schema, invent NEW schema attributes.
    CRITICAL: IGNORE all internal, technical, or system marketplace fields (e.g. "Ozon id", "offer_id", "dictionary_ids", "hashes", default arrays, etc). Extract ONLY human-readable physical features and buyer specs.
       - Decide if each attribute is generic/common across marketplaces (like weight, length, color) OR specific to this marketplace (like internal {mp_context or 'marketplace'} IDs, category codes, specific dictionary keys).
       - For specific attributes, set "is_marketplace_specific": true. Otherwise false.
       - IMPORTANT: You MUST extract the HUMAN-READABLE text value (e.g. "Dolby Atmos", "Черный"), NOT the numeric dictionary IDs or hashes. The user must be able to read everything you extract.
       - Use english snake_case for "code" (e.g. "diagonal_inches", "screen_tech").
       - CRITICAL: For "name", use the EXACT original `name` string from the raw JSON (e.g. "Технология звука", "Бренд"). DO NOT invent synonyms. DO NOT add technical prefixes.
       - Determine "type" ("string", "number", "boolean").
       - Extract the value for these new attributes too.
    
    Return strictly a JSON object:
    {{
        "categories": ["Level 1", "Level 2"],
        "attributes_data": {{ "existing_code": "val", "new_code_1": "exact_dictionary_id_or_value" }},
        "new_schema_attributes": [
            {{ "code": "new_code_1", "name": "Human Name", "type": "string", "is_marketplace_specific": true }}
        ]
    }}
    """

    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text}
        ],
        response_format={"type": "json_object"},
        max_tokens=8192
    )

    try:
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        elif content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
            
        data = json.loads(content.strip())
        return {
            "categories": data.get("categories", []),
            "attributes": data.get("attributes_data", {}),
            "new_schema_attributes": data.get("new_schema_attributes", [])
        }
    except Exception as e:
        print(f"Extract Parse Error: {e}")
        print(f"Raw Extract Content:\n{response.choices[0].message.content}")
        return {"categories": [], "attributes": {}, "new_schema_attributes": []}

async def generate_sdxl_prompt(attributes_data: Dict[str, Any], product_name: str, user_instruction: str, api_key: str) -> str:
    system_prompt = """
    You are an expert AI prompt engineer for Stable Diffusion XL Inpainting.
    Your task is to rewrite the user's instruction into a lush, descriptive, photorealistic English prompt.
    1. Convert any Russian text to high-quality English photography descriptions.
    2. CRITICAL - CONTEXTUAL ANCHORING: You MUST explicitly name the product in the foreground at the very beginning of the prompt (e.g. "A sleek Samsung television standing on the floor in the foreground, ..."). If you don't name the product, the AI will not know what the object is and will morph it into furniture!
    3. Describe the surrounding background environment, lighting, and mood BEHIND the product.
    4. DO NOT describe the product as "mounted on the wall far away" because the product is already huge and in the very front of the camera.
    5. Always include keywords: "professional commercial photography, cinematic lighting, photorealistic, 8k resolution, highly detailed, sharp focus".
    """
    _, model_name = get_client_and_model(api_key)
    # Extract exact api key from the config in case it's a JSON
    try:
        config = json.loads(api_key)
        extracted_api_key = config.get("api_key", "")
    except:
        extracted_api_key = api_key
        
    import httpx
    import asyncio
    
    for attempt in range(3):
        try:
            async with httpx.AsyncClient() as http_client:
                resp = await http_client.post(
                    "https://api.deepseek.com/chat/completions",
                    headers={"Authorization": f"Bearer {extracted_api_key}"},
                    json={
                        "model": "deepseek-chat",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"User Instruction: {user_instruction}"}
                        ]
                    },
                    timeout=45.0
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data["choices"][0]["message"]["content"].strip()
                else:
                    print(f"DeepSeek LLM HTTP {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"DeepSeek LLM prompt generator attempt {attempt+1} failed: {e}")
        await asyncio.sleep(2)
    print(f"DeepSeek total failure after 3 attempts. Falling back to raw user instruction.")
    return user_instruction

async def generate_description(attributes_data: Dict[str, Any], api_key: str) -> str:
    system_prompt = "You are an expert SEO copywriter. Generate a compelling HTML product description in Russian based on the provided product attributes. Return only HTML."
    
    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(attributes_data, ensure_ascii=False)}
        ]
    )

    return response.choices[0].message.content

# --- Phase 5 AI Syndication Pipeline ---

async def select_ideal_card(product_data: Dict[str, Any], duplicates: List[Dict], active_attributes: List[Attribute], api_key: str) -> Dict[str, Any]:
    schema_desc = {}
    for attr in active_attributes:
        schema_desc[attr.code] = f"{attr.name} (type: {attr.type})"

    system_prompt = f"""
    You are an AUTONOMOUS AI Schema Generator and Selector for a next-gen zero-setup PIM system.
    You will receive raw marketplace duplicate cards. Merge them into one PERFECT, maximally detailed product card.
    
    Current PIM Database Schema: {json.dumps(schema_desc, ensure_ascii=False)}
    
    RULES:
    1. If a value belongs to an existing code in Current PIM Database Schema, use that exact code.
    2. If the product has important characteristics (e.g. Refresh Rate, Inputs, CPU, Material, etc.) that DO NOT exist in the Current Schema, YOU MUST INVENT a new attribute! 
    3. Invented attributes must have a clear snake_case english 'code' and a russian 'name'.
    
    Return strictly a JSON object matching this structure (do not use markdown):
    {{
       "new_attributes": [
           {{"code": "refresh_rate_hz", "name": "Частота обновления (Гц)", "type": "number"}}
       ],
       "ideal_data": {{
           "brand": "Samsung",
           "refresh_rate_hz": 144
       }}
    }}
    """
    
    payload = {
        "base": product_data,
        "duplicates": duplicates or []
    }

    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}
        ],
        response_format={"type": "json_object"}
    )
    try:
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        elif content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        return json.loads(content.strip())
    except Exception as e:
        print(f"DeepSeek Parse Error: {e}")
        print(f"Raw content:\n{response.choices[0].message.content}")
        return product_data

async def generate_promo_copy(attributes_data: Dict[str, Any], api_key: str) -> Dict[str, Any]:
    system_prompt = """
    You are an Expert Marketing Director for a top-tier retail brand.
    Analyze the provided product attributes and generate a high-impact, short promotional copy for an infographic.
    Return strictly a valid JSON object matching this structure:
    {
      "promo_title": "Catchy 2-5 word main banner title",
      "promo_badges": ["100% цветовой объем", "Motion Xcelerator"],
      "features": [
         {"title": "Оптимизация цвета", "description": "Технология усиления контрастности позволяет оживить объекты..."}
      ]
    }
    CRITICAL: Extract a maximum of 3 strongest features that directly relate to the provided attributes.
    """
    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(attributes_data, ensure_ascii=False)}
        ],
        response_format={"type": "json_object"}
    )
    try:
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"): content = content[7:]
        if content.startswith("```"): content = content[3:]
        if content.endswith("```"): content = content[:-3]
        return json.loads(content.strip())
    except Exception as e:
        print(f"Promo Parse Error: {e}")
        return {"promo_title": "Лучший Выбор", "promo_badges": ["Хит продаж"], "features": []}

async def generate_smart_seo(product_data: Dict[str, Any], api_key: str) -> str:
    system_prompt = """
    You are an advanced AI SEO Agent. Create a product description optimized for BOTH traditional search engines (Yandex/Google) AND AI Search Engines (Perplexity/ChatGPT).
    Include natural language LSI keywords, structured bullet points for AI parsers, and a clear HTML structure.
    Return ONLY the HTML output.
    """
    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(product_data, ensure_ascii=False)}
        ]
    )
    return response.choices[0].message.content

async def generate_category_query(product_data: Dict[str, Any], api_key: str) -> str:
    system_prompt = "You are a product categorizer. Based on the product data, generate a 1 to 3 word generic search query (in Russian) to search a marketplace category tree. E.g. 'телевизор', 'микроволновая печь', 'встраиваемая мультиварка'. Return ONLY the generic search terms, nothing else."
    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(product_data, ensure_ascii=False)}
        ]
    )
    return response.choices[0].message.content.strip()

async def select_best_category(product_data: Dict[str, Any], categories: List[Dict[str, Any]], api_key: str) -> Dict[str, Any]:
    system_prompt = f"""
    You are an expert category matcher. Select the single best category ID from the provided list for the product.
    Categories: {json.dumps(categories, ensure_ascii=False)}
    Return ONLY a valid JSON object matching this structure: {{"category_id": "the_id_here"}}
    """
    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(product_data, ensure_ascii=False)}
        ],
        response_format={"type": "json_object"}
    )
    try:
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"): content = content[7:]
        elif content.startswith("```"): content = content[3:]
        if content.endswith("```"): content = content[:-3]
        return json.loads(content.strip())
    except:
        return {}

import re
from difflib import SequenceMatcher

def _normalize_dictionary_probe(value: Any) -> str:
    text = str(value or "").strip().lower().replace("ё", "е")
    return re.sub(r"\s+", " ", text)

def _best_dictionary_value(bad_value: str, dictionary_list: list) -> str:
    candidates = []
    for item in dictionary_list or []:
        text = str(item.get("name") if isinstance(item, dict) else item).strip()
        if text:
            candidates.append(text)
    if not candidates or not bad_value:
        return bad_value
    
    probe = _normalize_dictionary_probe(bad_value)
    if not probe:
        return bad_value

    def score(candidate: str) -> float:
        cand = _normalize_dictionary_probe(candidate)
        seq = SequenceMatcher(None, probe, cand).ratio()
        # Strict substring boost to bypass token dropping
        if probe in cand or cand in probe: seq = max(seq, 0.8)
        probe_tokens = set(probe.replace("/", " ").split())
        cand_tokens = set(cand.replace("/", " ").split())
        token_score = len(probe_tokens & cand_tokens) / max(len(probe_tokens), len(cand_tokens)) if probe_tokens and cand_tokens else 0.0
        return seq * 0.7 + token_score * 0.3

    best_cand = max(candidates, key=score)
    if score(best_cand) > 0.55:
        return best_cand
    return bad_value

async def map_schema_to_marketplace(attributes_data: Dict[str, Any], target_mp: str, target_schema: Dict[str, Any], api_key: str) -> Dict[str, Any]:
    system_prompt = f"""
    You are a strictly constrained AI Schema Mapper.
    Your sole task is to map PIM product attributes to the EXACT schema requirements of {target_mp.upper()}.
    
    Target Schema: {json.dumps(target_schema, ensure_ascii=False)}
    
    CRITICAL RULES DO NOT VIOLATE:
    1. For every field in the Target Schema that has `dictionary_options`, you MUST choose a value ONLY from those provided options. Do not make up synonyms. Copy the dictionary value exactly!
    2. If you cannot find an appropriate value for a dictionary, OMIT the field entirely unless it is required.
    3. Identify any REQUIRED fields (`is_required`: true). If a required field is missing, you MUST try your best to logically infer it or pick the most neutral generic value from the dictionary.
    4. Create a flat JSON payload structure valid for {target_mp.upper()}. The keys MUST literally be the exact `name` of the Target Schema attributes (e.g. "Код товара продавца", "Бренд"). DO NOT use "attributes" sub-arrays.
    
    Return ONLY a JSON object:
    {{
       "mapped_payload": {{"Бренд": "Samsung", "Цвет": "Черный"}},
       "missing_required_fields": [
           {{"attribute_id": 1234, "name": "Required Field Example", "is_required": true}}
       ]
    }}
    """
    client, model_name = get_client_and_model(api_key)
    
    async def _call_ai_mapper(sys_prompt: str, user_data: dict) -> dict:
        res = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": json.dumps(user_data, ensure_ascii=False)}
            ],
            response_format={"type": "json_object"}
        )
        content = res.choices[0].message.content.strip()
        if content.startswith("```json"): content = content[7:]
        elif content.startswith("```"): content = content[3:]
        if content.endswith("```"): content = content[:-3]
        return json.loads(content.strip())

    try:
        result = await _call_ai_mapper(system_prompt, attributes_data)

        schema_dict = {}
        if target_schema and "attributes" in target_schema:
            schema_dict = {a.get("name"): a for a in target_schema.get("attributes", []) if a.get("name")}

        # Подгонка значений к словарям (Ozon / Яндекс / WB / Мегамаркет) — снижает отказы API
        mp = target_mp.lower()
        if schema_dict and mp in ("megamarket", "yandex", "wildberries", "ozon"):
            mapped = result.get("mapped_payload", {})
            for k, v in list(mapped.items()):
                sch = schema_dict.get(k)
                if sch and sch.get("dictionary_options") and isinstance(v, str):
                    mapped[k] = _best_dictionary_value(v, sch.get("dictionary_options"))
            result["mapped_payload"] = mapped

        # Two-Pass Auto Repair Loop
        missing = result.get("missing_required_fields", [])
        if missing:
            repair_prompt = system_prompt + f"\n\n[CRITICAL FAILURE] Your previous mapping missed these REQUIRED fields. You MUST invent, deduce, or pick a default value from the dictionary for them: {json.dumps(missing, ensure_ascii=False)}"
            try:
                repaired_result = await _call_ai_mapper(repair_prompt, attributes_data)
                repaired_mapped = repaired_result.get("mapped_payload", {})
                for mk, mv in repaired_mapped.items():
                    if mk not in result["mapped_payload"] or not str(result["mapped_payload"][mk]).strip():
                        if mk in schema_dict and schema_dict[mk].get("dictionary_options") and isinstance(mv, str):
                            result["mapped_payload"][mk] = _best_dictionary_value(mv, schema_dict[mk].get("dictionary_options"))
                        else:
                            result["mapped_payload"][mk] = mv
                result["missing_required_fields"] = [m for m in missing if m.get("name") not in result["mapped_payload"]]
            except Exception as repair_e:
                print(f"Remap pass failed: {repair_e}")

        return result
    except Exception as e:
        print(f"DeepSeek Parse Error: {e}")
        return attributes_data

async def chat_with_copilot(messages: List[Dict[str, str]], api_key: str, current_path: str = None, extra_instructions: str = "") -> str:
    path_context = f"\n[ВАЖНО] Пользователь сейчас находится на странице (URL Path): {current_path}\nПытайся давать максимально релевантный ответ для этой страницы." if current_path else ""
    dynamic_context = f"\n[ДИНАМИЧЕСКИЕ ЗНАНИЯ СИСТЕМЫ]: {extra_instructions}" if extra_instructions else ""
    
    system_prompt = f"""
    Ты — дружелюбный помощник по интерфейсу PIM.Giper.fm (не нужно называть себя «Copilot»).
    PIM.Giper.fm — единый каталог товаров и перенос карточек на маркетплейсы (Ozon, Яндекс Маркет, Wildberries, Мегамаркет) с помощью ИИ.
    {path_context}
    {dynamic_context}
    
    Разделы меню (называй так же, как в интерфейсе):
    - Дашборд, Каталог товаров, Схема атрибутов, Массовая выгрузка, Магазины и ключи API, Пользователи, Настройки ИИ.
    
    Твои задачи:
    1. Подсказать следующий шаг простым языком (без жаргона вроде «payload», «endpoint» — если пользователь не разработчик).
    2. Кратко объяснить: импорт тянет карточку с выбранного магазина; несколько подключённых магазинов помогают собрать одну полную карточку; перенос — из карточки (вкладка «Перенос на маркетплейсы») или массово из каталога.
    3. Если спрашивают «с чего начать»: 1) Магазины и ключи API — добавить магазин 2) Каталог — импорт или массовый импорт по артикулам 3) Открыть товар → перенос на маркетплейсы (шаги 2–4) или выбрать товары галочками → Массовая выгрузка.
    Отвечай вежливо, используй Markdown для списков и **жирного** для названий разделов.
    """
    formatted_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        formatted_messages.append({"role": msg["role"], "content": msg["content"]})
        
    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=formatted_messages,
        temperature=0.7
    )
    return response.choices[0].message.content.strip()

async def fix_mapping_errors(original_payload: dict, error_text: str, target_schema: dict, ai_key: str) -> dict:
    if not ai_key: return original_payload
    prompt = f"""
    You are an expert Marketplace API Integration engineer.
    The payload you generated was REJECTED by the marketplace API.
    
    Original Payload (JSON):
    {json.dumps(original_payload, ensure_ascii=False)}
    
    Marketplace API Error Response:
    {error_text}
    
    Target Marketplace Schema Requirements:
    {json.dumps(target_schema) if target_schema else 'No strict schema provided'}
    
    Your task:
    Modify the Original Payload so that it satisfies the Marketplace API Error requirement.
    Identify what the error is complaining about (e.g. missing field, invalid type, empty string).
    Modify or add the required field in the payload.
    
    Return your response strictly as a RAW valid JSON object representing the NEW and FIXED payload.
    Do not use markdown formatting like ```json. Return ONLY the raw valid JSON string.
    """
    try:
        client, model_name = get_client_and_model(ai_key)
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": "You are an API payload healing agent returning valid raw JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1
        )
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"): content = content[7:]
        if content.startswith("```"): content = content[3:]
        if content.endswith("```"): content = content[:-3]
        return json.loads(content.strip())
    except Exception as e:
        print(f"Error in AI Self-Healing: {e}")
        return original_payload

async def generate_infographic_plan(attributes_data: Dict[str, Any], product_name: str, api_key: str) -> List[Dict[str, Any]]:
    system_prompt = f"""
    You are an Expert Creative Director and Copywriter for top-tier marketplace infographics.
    Your goal is to autonomously invent a set of 3 to 5 infographic slides (scenes) to sell the product '{product_name}'.
    
    Analyze the following product attributes:
    {json.dumps(attributes_data, ensure_ascii=False)}
    
    For each slide, you must provide:
    1. `background_prompt`: An english, highly detailed, photorealistic prompt for Leonardo AI to generate the ENTIRE scene FROM SCRATCH. CRITICAL RULE: You MUST prominently feature visually inserting the exact product ('{product_name}') organically into the environment prompt! Do NOT leave the room empty. The AI will draw the product directly into the scene! Describe the lighting, shadows, and environment interacting with the product perfectly.
    2. `headline`: A catchy, short Russian marketing headline (1-3 words) for the slide.
    3. `bullets`: An array of 1 to 3 short feature descriptions in Russian.
    4. `generation_type`: Must be strictly "text_to_image" FOR EVERY SINGLE SLIDE. Do NOT use "image_to_image". We want 100% pure generative AI integration for maximum marketing appeal.
    5. `text_position`: The spatial composition of the typography. Must be one of: "top", "bottom", "left_top", "right_top".
    
    Ensure the background_prompt restricts visual noise in the area corresponding to the text_position.
    Make sure the slides follow a logical progression (e.g. Slide 1: Main Hero shot, Slide 2: Feature closeup or lifestyle, Slide 3: Technical spec in environment).
    
    Return strictly a JSON object with a single key 'slides' containing an array of objects:
    {{
      "slides": [
         {{
           "background_prompt": "...",
           "headline": "...",
           "bullets": ["...", "..."]
         }}
      ]
    }}
    """
    client, model_name = get_client_and_model(api_key)
    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": "You are a JSON-producing Creative Director agent."},
            {"role": "user", "content": system_prompt}
        ],
        response_format={"type": "json_object"},
        max_tokens=4000
    )
    try:
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"): content = content[7:]
        elif content.startswith("```"): content = content[3:]
        if content.endswith("```"): content = content[:-3]
        data = json.loads(content.strip())
        return data.get("slides", [])
    except Exception as e:
        print(f"Director Parse Error: {e}")
        return []
