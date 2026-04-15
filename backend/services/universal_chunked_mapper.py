"""
Universal chunked mapper for all marketplaces.
Adds Ozon and WB/Yandex support to mm_chunked_mapper pattern.
"""
import json
import os
from typing import Any, Dict, List
from openai import OpenAI


def _get_ai():
    key = os.getenv("OPENAI_API_KEY", "ollama")
    base = os.getenv("OPENAI_BASE_URL", "http://localhost:11434/v1")
    model = os.getenv("AI_MODEL", "qwen2.5:14b")
    return OpenAI(api_key=key, base_url=base), model


def _ai_json(client, model, prompt, timeout=120):
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Return ONLY valid JSON. No markdown, no explanation."},
            {"role": "user", "content": prompt},
        ],
        timeout=timeout,
    )
    text = resp.choices[0].message.content.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"): text = text[4:]
    if text.endswith("```"): text = text[:-3]
    return json.loads(text.strip())


def chunked_map_to_schema(
    source_attrs: Dict[str, Any],
    product_name: str,
    target_schema_attrs: List[Dict[str, Any]],
    platform: str,
) -> List[Dict[str, Any]]:
    """Map source attributes to target schema in chunks. Returns list of {id, name, value}."""
    client, model = _get_ai()
    
    source_text = f"Название: {product_name}\n"
    for k, v in source_attrs.items():
        if v and not str(k).startswith("_"):
            source_text += f"{k}: {v}\n"
    source_text = source_text[:3000]
    
    result = []
    
    # Step 1: Required non-enum attrs
    simple_req = [a for a in target_schema_attrs
                  if a.get("is_required")
                  and not a.get("dictionary_options")]
    
    if simple_req:
        desc = "\n".join(f"- {a.get('name','')} (id={a.get('id','')}, type={a.get('type','')})" for a in simple_req[:20])
        prompt = f"Товар для {platform}:\n{source_text[:1500]}\n\nЗаполни атрибуты:\n{desc}\n\nbool=\"true\"/\"false\". Только из данных товара.\nJSON: [{{\"id\": ID, \"name\": \"имя\", \"value\": \"значение\"}}, ...]"
        try:
            filled = _ai_json(client, model, prompt, timeout=90)
            if isinstance(filled, list):
                result.extend([{"id": a.get("id"), "name": a.get("name",""), "value": str(a.get("value",""))} for a in filled if a.get("value")])
            print(f"[+] {platform} step1: {len(result)} simple required")
        except Exception as e:
            print(f"[!] {platform} step1 failed: {e}")
    
    # Step 2: Required enum attrs (one by one)
    enum_req = [a for a in target_schema_attrs if a.get("is_required") and a.get("dictionary_options")]
    
    for ea in enum_req:
        opts = ea.get("dictionary_options", [])
        opt_names = [str(o.get("name") or o) for o in opts[:50] if o]
        if not opt_names: continue
        
        prompt = f"Товар: {product_name}\nАтрибуты: {source_text[:800]}\n\nАтрибут: {ea.get('name','')}\nДопустимые: {', '.join(opt_names[:30])}\n\nJSON: {{\"value\": \"выбранное\"}} или {{\"value\": null}}"
        try:
            filled = _ai_json(client, model, prompt, timeout=60)
            val = filled.get("value")
            if val and str(val).lower() not in ("null", "none", ""):
                # Match to dictionary
                val_l = str(val).lower().strip()
                matched = None
                for on in opt_names:
                    if on.lower().strip() == val_l: matched = on; break
                if not matched:
                    for on in opt_names:
                        if val_l in on.lower() or on.lower() in val_l: matched = on; break
                if matched:
                    result.append({"id": ea.get("id"), "name": ea.get("name",""), "value": matched})
                elif ea.get("isSuggest", True):
                    result.append({"id": ea.get("id"), "name": ea.get("name",""), "value": str(val)})
        except Exception as e:
            print(f"[!] {platform} enum {ea.get('name','')}: {e}")
    
    print(f"[+] {platform} step2: {len(result)} total after enum")
    
    # Step 3: Optional non-enum attrs (batch)
    filled_ids = {a["id"] for a in result}
    optional = [a for a in target_schema_attrs
                if not a.get("is_required") and a.get("id") not in filled_ids and not a.get("dictionary_options")]
    
    if optional[:15]:
        desc = "\n".join(f"- {a.get('name','')} (id={a.get('id','')}, type={a.get('type','')})" for a in optional[:15])
        prompt = f"Товар: {source_text[:1500]}\n\nЗаполни ТОЛЬКО те что ТОЧНО есть в данных:\n{desc}\n\nJSON: [{{\"id\": ID, \"name\": \"имя\", \"value\": \"значение\"}}, ...]\nПустой [] если ничего."
        try:
            filled = _ai_json(client, model, prompt, timeout=90)
            if isinstance(filled, list):
                result.extend([{"id": a.get("id"), "name": a.get("name",""), "value": str(a.get("value",""))} for a in filled if a.get("value")])
            print(f"[+] {platform} step3: {len(result)} total after optional")
        except Exception as e:
            print(f"[!] {platform} step3: {e}")
    
    return result
