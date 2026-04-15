"""
Chunked MM attribute mapper — splits AI mapping into small steps
for local LLM compatibility (qwen2.5:14b on T4).
"""
import json
import time
import os
from typing import Any, Dict, List, Optional
from openai import OpenAI

MM_API_URL = "https://api.megamarket.tech/api/merchantIntegration/assortment/v1"

def _get_ai_client():
    key = os.getenv("OPENAI_API_KEY", "ollama")
    base = os.getenv("OPENAI_BASE_URL", "http://localhost:11434/v1")
    model = os.getenv("AI_MODEL", "qwen2.5:14b")
    return OpenAI(api_key=key, base_url=base), model

def _ai_json(client, model, prompt, timeout=120):
    """Single AI call returning JSON."""
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Return ONLY valid JSON. No markdown, no explanation."},
            {"role": "user", "content": prompt},
        ],
        timeout=timeout,
    )
    text = resp.choices[0].message.content.strip()
    # Clean markdown
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text.strip())


def chunked_map_product(
    ozon_data: Dict[str, Any],
    mm_schema: Dict[str, Any],
    category_id: int,
) -> Dict[str, Any]:
    """Map Ozon product to MM schema in chunks."""
    client, model = _get_ai_client()
    
    # Extract source info
    name = ozon_data.get("name", "")
    attrs = ozon_data.get("attributes", [])
    source_text = f"Название: {name}\n"
    for a in attrs:
        aname = a.get("name", "")
        vals = a.get("values", [])
        if aname and vals:
            source_text += f"{aname}: {', '.join(str(v) for v in vals)}\n"
    source_text = source_text[:3000]  # Limit
    
    content_attrs = mm_schema.get("contentAttributes", [])
    master_attrs = mm_schema.get("masterAttributes", [])
    
    result_content: List[Dict[str, Any]] = []
    
    # --- Step 1: Map simple required attrs (no dictionary) ---
    simple_required = [a for a in content_attrs 
                       if a.get("isRequired") 
                       and str(a.get("valueTypeCode", "")).lower() != "enum"
                       and not a.get("dictionaryList")]
    
    if simple_required:
        attrs_desc = "\n".join(
            f"- {a['attributeName']} (id={a['attributeId']}, type={a.get('valueTypeCode','')})"
            for a in simple_required[:20]
        )
        prompt = f"""Товар: {source_text[:1500]}

Заполни атрибуты для Мегамаркет:
{attrs_desc}

Правила: извлекай ТОЛЬКО из данных товара. Не выдумывай. bool = "true"/"false".
JSON: [{{"attributeId": ID, "values": ["значение"]}}, ...]"""

        try:
            filled = _ai_json(client, model, prompt, timeout=90)
            if isinstance(filled, list):
                result_content.extend([{"attributeId": a["attributeId"], "values": [str(v) for v in a.get("values",[])]} for a in filled if isinstance(a, dict)])
            elif isinstance(filled, dict) and "attributes" in filled:
                result_content.extend(filled["attributes"])
            print(f"[+] Step 1: {len(result_content)} simple required attrs mapped")
        except Exception as e:
            print(f"[!] Step 1 failed: {e}")
    
    # --- Step 2: Map enum required attrs (with dictionary) ---
    enum_required = [a for a in content_attrs 
                     if a.get("isRequired") 
                     and (str(a.get("valueTypeCode", "")).lower() == "enum" or a.get("dictionaryList"))]
    
    for ea in enum_required:
        dict_list = ea.get("dictionaryList") or ea.get("dictionaryValues") or []
        dict_names = []
        for d in dict_list[:50]:
            if isinstance(d, dict):
                dict_names.append(str(d.get("name", d.get("value", ""))))
            else:
                dict_names.append(str(d))
        dict_names = [n for n in dict_names if n]
        
        is_suggest = ea.get("isSuggest", True)
        rule = "Выбери ТОЛЬКО из списка." if not is_suggest else "Можно выбрать из списка или своё."
        
        prompt = f"""Товар: {name}
Атрибуты: {source_text[:800]}

Атрибут: {ea['attributeName']}
{rule}
Допустимые значения: {', '.join(dict_names[:30])}

Верни JSON: {{"value": "выбранное значение"}}
Если не определить — верни {{"value": null}}"""

        try:
            filled = _ai_json(client, model, prompt, timeout=60)
            val = filled.get("value")
            if val and str(val).lower() not in ("null", "none", ""):
                # Validate against dictionary
                if not is_suggest:
                    matched = None
                    val_lower = str(val).lower().strip()
                    for dn in dict_names:
                        if dn.lower().strip() == val_lower:
                            matched = dn; break
                    if not matched:
                        for dn in dict_names:
                            if val_lower in dn.lower() or dn.lower() in val_lower:
                                matched = dn; break
                    if matched:
                        result_content.append({"attributeId": ea["attributeId"], "values": [matched]})
                else:
                    result_content.append({"attributeId": ea["attributeId"], "values": [str(val)]})
        except Exception as e:
            print(f"[!] Enum {ea['attributeName']} failed: {e}")
    
    print(f"[+] Step 2: {len(result_content)} total attrs after enum mapping")
    
    # --- Step 3: Map optional attrs (batch, no dictionaries) ---
    filled_ids = {a["attributeId"] for a in result_content}
    optional = [a for a in content_attrs 
                if not a.get("isRequired") 
                and a["attributeId"] not in filled_ids
                and str(a.get("valueTypeCode", "")).lower() != "enum"]
    
    if optional:
        attrs_desc = "\n".join(
            f"- {a['attributeName']} (id={a['attributeId']}, type={a.get('valueTypeCode','')})"
            for a in optional[:15]
        )
        prompt = f"""Товар: {source_text[:1500]}

Заполни ТОЛЬКО те атрибуты, значения которых ТОЧНО есть в данных товара:
{attrs_desc}

JSON: [{{"attributeId": ID, "values": ["значение"]}}, ...]
Пустой массив [] если ничего не удалось определить."""

        try:
            filled = _ai_json(client, model, prompt, timeout=90)
            if isinstance(filled, list):
                result_content.extend([{"attributeId": a["attributeId"], "values": [str(v) for v in a.get("values",[])]} for a in filled if isinstance(a, dict)])
            elif isinstance(filled, dict) and "attributes" in filled:
                result_content.extend(filled["attributes"])
            print(f"[+] Step 3: {len(result_content)} total attrs after optional")
        except Exception as e:
            print(f"[!] Step 3 failed: {e}")
    
    # --- Build result ---
    # Extract key fields from ozon data
    barcode = ozon_data.get("barcode", "")
    weight_g = ozon_data.get("weight_g") or ozon_data.get("weight", 0)
    depth_mm = ozon_data.get("depth_mm") or ozon_data.get("depth", 0)
    width_mm = ozon_data.get("width_mm") or ozon_data.get("width", 0)
    height_mm = ozon_data.get("height_mm") or ozon_data.get("height", 0)
    images = ozon_data.get("images", [])[:15]
    
    def _to_f(v, d=0.0):
        try: return float(str(v).replace(",", "."))
        except: return d
    
    weight_kg = _to_f(weight_g) / 1000 if _to_f(weight_g) > 100 else _to_f(weight_g)
    depth_cm = _to_f(depth_mm) / 10 if _to_f(depth_mm) > 100 else _to_f(depth_mm)
    width_cm = _to_f(width_mm) / 10 if _to_f(width_mm) > 100 else _to_f(width_mm)
    height_cm = _to_f(height_mm) / 10 if _to_f(height_mm) > 100 else _to_f(height_mm)
    
    def _num(v):
        n = _to_f(v)
        return f"{n:g}" if n else "0"
    
    # Find brand from source
    brand = ""
    for a in attrs:
        if a.get("name", "").lower() in ("бренд", "brand", "торговая марка"):
            vals = a.get("values", [])
            if vals: brand = str(vals[0]); break
    if not brand:
        brand = ozon_data.get("brand", "")
    
    desc = ""
    for a in attrs:
        if a.get("name", "").lower() in ("описание", "description", "аннотация"):
            vals = a.get("values", [])
            if vals: desc = str(vals[0]); break
    
    return {
        "name": name[:90],
        "brand": brand or "Без бренда",
        "description": (desc or name)[:2500],
        "barcode": barcode,
        "images": images,
        "weight": weight_kg,
        "height": height_cm,
        "width": width_cm,
        "depth": depth_cm,
        "contentAttributes": result_content,
        "categoryId": category_id,
    }
