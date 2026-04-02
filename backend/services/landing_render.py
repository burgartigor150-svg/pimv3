"""Renders a product landing page as standalone HTML."""
from __future__ import annotations
import json
from typing import Any, Dict, List


def _esc(s: str) -> str:
    return (str(s)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


def render_landing(product: Any) -> str:
    attrs: Dict = product.attributes_data or {}
    images: List = product.images or []
    name: str = product.name or "Товар"
    brand: str = str(attrs.get("brand", ""))
    rich: List = product.rich_content or []
    landing: Dict = product.landing_json or {}

    hero_d = landing.get("hero", {})
    usp: List = landing.get("usp", [])
    features: List = landing.get("features", [])
    specs_preview: List = landing.get("specs_preview", [])
    faq: List = landing.get("faq", [])
    cta_d: Dict = landing.get("cta_section", {})

    hero_img = images[0] if images else ""

    # ── Gallery ──────────────────────────────────────────────────────────────
    if images:
        thumbs = "".join(
            f'<img src="{_esc(img)}" onclick="setMain(this)" '
            'style="width:64px;height:64px;object-fit:cover;border-radius:8px;'
            'cursor:pointer;border:2px solid transparent;opacity:.7;transition:all .2s" />'
            for img in images[:6]
        )
        gallery_html = (
            f'<div style="display:flex;flex-direction:column;gap:10px">'
            f'<img id="mainImg" src="{_esc(hero_img)}" style="width:100%;border-radius:16px;'
            f'object-fit:contain;max-height:420px;background:#f4f4f8" />'
            f'<div style="display:flex;gap:8px;flex-wrap:wrap">{thumbs}</div>'
            f'</div>'
        )
    else:
        gallery_html = (
            '<div style="width:100%;height:360px;background:#f4f4f8;border-radius:16px;'
            'display:flex;align-items:center;justify-content:center;color:#aaa;font-size:48px">🖼</div>'
        )

    # ── USP bar ───────────────────────────────────────────────────────────────
    usp_items = "".join(
        f'<div style="text-align:center;padding:28px 16px">'
        f'<div style="font-size:36px;margin-bottom:8px">{_esc(u.get("icon","✓"))}</div>'
        f'<div style="font-weight:700;font-size:15px;margin-bottom:4px">{_esc(u.get("title",""))}</div>'
        f'<div style="color:#666;font-size:13px;line-height:1.5">{_esc(u.get("desc",""))}</div>'
        f'</div>'
        for u in usp[:4]
    )

    # ── Features grid ─────────────────────────────────────────────────────────
    feat_cards = "".join(
        f'<div style="padding:20px;background:{"#eff6ff" if f.get("highlight") else "#f9fafb"};'
        f'border-radius:12px;border-left:4px solid {"#3b82f6" if f.get("highlight") else "#e5e7eb"}">'
        f'<div style="font-weight:700;margin-bottom:6px;font-size:15px">{_esc(f.get("title",""))}</div>'
        f'<div style="color:#555;font-size:13px;line-height:1.6">{_esc(f.get("desc",""))}</div>'
        f'</div>'
        for f in features[:6]
    )

    # ── Specs table ───────────────────────────────────────────────────────────
    spec_rows = "".join(
        f'<tr>'
        f'<td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px">{_esc(row[0] if len(row) > 0 else "")}</td>'
        f'<td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-weight:600;font-size:13px">{_esc(row[1] if len(row) > 1 else "")}</td>'
        f'</tr>'
        for row in specs_preview[:10]
    )

    # ── FAQ ───────────────────────────────────────────────────────────────────
    faq_items = "".join(
        f'<details style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;cursor:pointer">'
        f'<summary style="font-weight:600;font-size:15px;list-style:none;display:flex;justify-content:space-between;align-items:center">'
        f'{_esc(q.get("q",""))} <span style="color:#3b82f6;font-size:20px;flex-shrink:0">+</span></summary>'
        f'<p style="margin-top:12px;color:#555;font-size:14px;line-height:1.6">{_esc(q.get("a",""))}</p>'
        f'</details>'
        for q in faq[:6]
    )

    # ── Rich content blocks ───────────────────────────────────────────────────
    rich_html_parts: List[str] = []
    for block in rich:
        btype = block.get("type", "")
        if btype == "text":
            rich_html_parts.append(
                f'<div style="margin:24px 0;font-size:15px;line-height:1.7;color:#333">'
                f'{block.get("html", "")}'
                f'</div>'
            )
        elif btype == "features":
            items_html = "".join(
                f'<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:16px">'
                f'<span style="font-size:26px;line-height:1">{_esc(it.get("icon","•"))}</span>'
                f'<div><b style="font-size:15px">{_esc(it.get("title",""))}</b>'
                f'<br><span style="color:#555;font-size:13px;line-height:1.5">{_esc(it.get("desc",""))}</span></div>'
                f'</div>'
                for it in block.get("items", [])
            )
            rich_html_parts.append(
                f'<div style="margin:32px 0">'
                f'<h3 style="font-size:22px;font-weight:800;margin-bottom:20px">{_esc(block.get("title",""))}</h3>'
                f'{items_html}</div>'
            )
        elif btype == "callout":
            bgs = {"info": "#dbeafe", "success": "#dcfce7", "warning": "#fef9c3"}
            borders = {"info": "#3b82f6", "success": "#16a34a", "warning": "#d97706"}
            style = block.get("style", "info")
            rich_html_parts.append(
                f'<div style="background:{bgs.get(style,"#dbeafe")};border-left:4px solid {borders.get(style,"#3b82f6")};'
                f'border-radius:0 12px 12px 0;padding:20px 24px;margin:24px 0">'
                f'<b style="font-size:16px">{_esc(block.get("title",""))}</b>'
                f'<p style="margin:8px 0 0;color:#333;font-size:14px;line-height:1.6">{_esc(block.get("text",""))}</p>'
                f'</div>'
            )
        elif btype == "specs":
            rows_html = "".join(
                f'<tr><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px">{_esc(r[0] if len(r)>0 else "")}</td>'
                f'<td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-weight:600;font-size:13px">{_esc(r[1] if len(r)>1 else "")}</td></tr>'
                for r in block.get("rows", [])
            )
            rich_html_parts.append(
                f'<div style="margin:32px 0">'
                f'<h3 style="font-size:20px;font-weight:800;margin-bottom:16px">{_esc(block.get("title","Характеристики"))}</h3>'
                f'<table style="width:100%;border-collapse:collapse">{rows_html}</table>'
                f'</div>'
            )
    rich_html = "".join(rich_html_parts)

    # ── Hero badge ────────────────────────────────────────────────────────────
    badge_html = ""
    if hero_d.get("badge"):
        badge_html = (
            f'<div style="display:inline-block;background:#f59e0b;color:#000;font-weight:800;'
            f'font-size:12px;padding:4px 14px;border-radius:20px;margin-bottom:16px;letter-spacing:.05em">'
            f'{_esc(hero_d["badge"])}</div>'
        )

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_esc(name)}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#111;line-height:1.5}}
details[open] summary span{{transform:rotate(45deg);display:inline-block}}
@media(max-width:768px){{.hero-grid{{grid-template-columns:1fr!important}}.usp-grid{{grid-template-columns:1fr 1fr!important}}}}
</style>
</head>
<body>

<!-- HERO -->
<section style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#312e81 100%);color:#fff;padding:56px 0">
  <div style="max-width:1100px;margin:0 auto;padding:0 24px;display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center" class="hero-grid">
    <div>
      {badge_html}
      <h1 style="font-size:clamp(22px,3.5vw,40px);font-weight:900;line-height:1.15;margin-bottom:20px">{_esc(hero_d.get("headline", name))}</h1>
      <p style="font-size:18px;opacity:.8;margin-bottom:32px;line-height:1.65">{_esc(hero_d.get("subheadline",""))}</p>
      {'<div style="font-size:13px;opacity:.5;margin-bottom:20px">' + _esc(brand) + '</div>' if brand else ""}
      <a href="#" style="display:inline-block;background:#f59e0b;color:#000;font-weight:800;font-size:16px;padding:16px 44px;border-radius:12px;box-shadow:0 8px 28px rgba(245,158,11,.35);transition:transform .2s" onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform=''">{_esc(hero_d.get("cta","Купить сейчас"))}</a>
    </div>
    <div>{gallery_html}</div>
  </div>
</section>

<!-- USP BAR -->
{'<section style="background:#f8fafc;border-bottom:1px solid #e5e7eb"><div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))" class="usp-grid">' + usp_items + '</div></section>' if usp_items else ""}

<!-- MAIN CONTENT -->
<section style="max-width:1100px;margin:0 auto;padding:56px 24px">

  {rich_html}

  {'<h2 style="font-size:28px;font-weight:900;margin:48px 0 24px">Особенности</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">' + feat_cards + '</div>' if feat_cards else ""}

  {'<h2 style="font-size:28px;font-weight:900;margin:56px 0 24px">Характеристики</h2><table style="width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)"><thead><tr><th style="background:#f1f5f9;padding:12px 16px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b">Параметр</th><th style="background:#f1f5f9;padding:12px 16px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b">Значение</th></tr></thead><tbody>' + spec_rows + '</tbody></table>' if spec_rows else ""}

  {'<h2 style="font-size:28px;font-weight:900;margin:56px 0 24px">Частые вопросы</h2><div style="display:flex;flex-direction:column;gap:10px">' + faq_items + '</div>' if faq_items else ""}

  {'<div style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:24px;padding:56px 32px;text-align:center;margin:56px 0;color:#fff"><h2 style="font-size:32px;font-weight:900;margin-bottom:12px">' + _esc(cta_d.get("headline","")) + '</h2><p style="font-size:18px;opacity:.85;margin-bottom:8px">' + _esc(cta_d.get("subheadline","")) + '</p>' + ('<p style="font-size:13px;opacity:.6;margin-bottom:28px">' + _esc(cta_d.get("urgency","")) + '</p>' if cta_d.get("urgency") else '<div style="margin-bottom:28px"></div>') + '<a href="#" style="display:inline-block;background:#fff;color:#3b82f6;font-weight:800;font-size:16px;padding:16px 56px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.15)">' + _esc(cta_d.get("button","Купить сейчас")) + '</a></div>' if cta_d else ""}

</section>

<footer style="background:#0f172a;color:rgba(255,255,255,.45);text-align:center;padding:28px 24px;font-size:13px">
  {_esc(name)}{" — " + _esc(brand) if brand else ""}
</footer>

<script>
function setMain(el) {{
  document.getElementById("mainImg").src = el.src;
  document.querySelectorAll("[onclick]").forEach(e => {{
    e.style.opacity = .7; e.style.border = "2px solid transparent";
  }});
  el.style.opacity = 1; el.style.border = "2px solid #3b82f6";
}}
</script>
</body>
</html>"""
