"""Premium product landing page renderer — 12 templates."""
from __future__ import annotations
from typing import Any, Dict, List


def _esc(s: str) -> str:
    return (str(s)
            .replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))

def _normalize_blocks(blocks: List[Dict]) -> List[Dict]:
    """Flatten {type, data: {...}} -> {type, ...} if saved in old format."""
    result = []
    for b in (blocks or []):
        if isinstance(b, dict) and "data" in b and isinstance(b.get("data"), dict):
            result.append({"type": b["type"], **b["data"]})
        else:
            result.append(b)
    return result

# ─── Template registry ────────────────────────────────────────────────────────

TEMPLATES: Dict[str, Dict] = {
    "dark_premium":    {"name": "Dark Premium",    "desc": "Тёмный с фиолетовыми акцентами", "preview_bg": "linear-gradient(135deg,#060612,#1a1040)", "preview_accent": "#6366f1"},
    "luxury_black":    {"name": "Luxury Black",    "desc": "Чёрный с золотом",               "preview_bg": "linear-gradient(135deg,#0a0a0a,#1a1400)", "preview_accent": "#d4a017"},
    "cyber_neon":      {"name": "Cyber Neon",      "desc": "Киберпанк с неоном",              "preview_bg": "linear-gradient(135deg,#00040f,#001a2c)", "preview_accent": "#00f5ff"},
    "clean_white":     {"name": "Clean White",     "desc": "Чистый минимализм",               "preview_bg": "linear-gradient(135deg,#ffffff,#f0f4ff)", "preview_accent": "#2563eb"},
    "deep_ocean":      {"name": "Deep Ocean",      "desc": "Океанские глубины",               "preview_bg": "linear-gradient(135deg,#020b18,#031d3a)", "preview_accent": "#06b6d4"},
    "rose_luxury":     {"name": "Rose Luxury",     "desc": "Розово-золотой люкс",             "preview_bg": "linear-gradient(135deg,#1a0010,#2d0a1a)", "preview_accent": "#f43f8e"},
    "forest_dark":     {"name": "Forest Dark",     "desc": "Тёмный изумруд",                  "preview_bg": "linear-gradient(135deg,#010d08,#021a0e)", "preview_accent": "#10b981"},
    "sunset_warm":     {"name": "Sunset Warm",     "desc": "Тёплый закатный градиент",        "preview_bg": "linear-gradient(135deg,#1a0a00,#2d1500)", "preview_accent": "#f97316"},
    "arctic_clean":    {"name": "Arctic Clean",    "desc": "Холодный светлый минимализм",     "preview_bg": "linear-gradient(135deg,#f0f8ff,#e8f4ff)", "preview_accent": "#0284c7"},
    "midnight_blue":   {"name": "Midnight Blue",   "desc": "Полночный синий",                 "preview_bg": "linear-gradient(135deg,#000814,#001233)", "preview_accent": "#3b82f6"},
    "carbon_fiber":    {"name": "Carbon Fiber",    "desc": "Карбон и металл",                 "preview_bg": "linear-gradient(135deg,#0d0d0d,#1a1a1a)", "preview_accent": "#94a3b8"},
    "violet_dream":    {"name": "Violet Dream",    "desc": "Мечтательный фиолет",             "preview_bg": "linear-gradient(135deg,#0d0021,#1a003d)", "preview_accent": "#a855f7"},
}

def get_templates_list() -> List[Dict]:
    return [{"key": k, **v} for k, v in TEMPLATES.items()]

# ─── Shared helpers ───────────────────────────────────────────────────────────

REVEAL_CSS = """
.reveal{opacity:0;transform:translateY(28px);transition:opacity .65s cubic-bezier(.16,1,.3,1),transform .65s cubic-bezier(.16,1,.3,1)}
.reveal.visible{opacity:1;transform:translateY(0)}
.reveal-left{opacity:0;transform:translateX(-28px);transition:opacity .65s cubic-bezier(.16,1,.3,1),transform .65s cubic-bezier(.16,1,.3,1)}
.reveal-left.visible{opacity:1;transform:translateX(0)}
"""

REVEAL_JS = """
const obs=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')})},{threshold:.1,rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.reveal,.reveal-left').forEach(el=>obs.observe(el));
setTimeout(()=>{document.querySelectorAll('.reveal,.reveal-left').forEach(el=>{if(el.getBoundingClientRect().top<window.innerHeight)el.classList.add('visible')})},80);
"""

GALLERY_JS = """
function setMain(el,src){const img=document.getElementById('mainImg');img.style.opacity='0';setTimeout(()=>{img.src=src;img.style.opacity='1'},150);document.querySelectorAll('.thumb').forEach(t=>t.classList.remove('active'));el.classList.add('active');}
const ft=document.querySelector('.thumb');if(ft)ft.classList.add('active');
"""

FAQ_JS = """
document.querySelectorAll('.faq-item').forEach(d=>{d.addEventListener('toggle',()=>{const ic=d.querySelector('.faq-icon');if(ic)ic.style.transform=d.open?'rotate(45deg)':''})});
"""

def _gallery(images: List[str], main_style: str, thumb_style: str) -> str:
    if not images:
        return '<div style="width:100%;height:380px;border-radius:20px;background:rgba(128,128,128,.1);display:flex;align-items:center;justify-content:center;font-size:56px;opacity:.3">🖼</div>'
    thumbs = "".join(
        f'<img src="{_esc(img)}" onclick="setMain(this,this.src)" class="thumb" style="{thumb_style}" />'
        for img in images[:6]
    )
    return (
        f'<div style="display:flex;flex-direction:column;gap:12px">'
        f'<div style="border-radius:20px;overflow:hidden"><img id="mainImg" src="{_esc(images[0])}" style="{main_style}transition:opacity .25s" /></div>'
        f'<div style="display:flex;gap:8px;flex-wrap:wrap">{thumbs}</div>'
        f'</div>'
    )

def _faq(items: List[Dict], q_color: str, a_color: str, border_color: str, bg: str) -> str:
    if not items: return ""
    rows = "".join(
        f'<details class="faq-item" style="border-radius:14px;overflow:hidden;cursor:pointer;margin-bottom:10px">'
        f'<summary style="font-weight:700;font-size:15px;list-style:none;display:flex;justify-content:space-between;align-items:center;padding:18px 22px;background:{bg};border:1px solid {border_color};border-radius:14px;transition:background .2s;color:{q_color}">'
        f'{_esc(q.get("q",""))} <span class="faq-icon" style="color:{q_color};font-size:22px;flex-shrink:0;transition:transform .3s;font-weight:300;opacity:.7">+</span></summary>'
        f'<p style="padding:18px 22px;color:{a_color};font-size:14px;line-height:1.7;background:{bg};border:1px solid {border_color};border-top:none;border-radius:0 0 14px 14px;margin:0">{_esc(q.get("a",""))}</p>'
        f'</details>'
        for q in items[:6]
    )
    return rows

# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATE 1: DARK PREMIUM (violet/indigo)
# ═══════════════════════════════════════════════════════════════════════════════
def _tpl_dark_premium(p: Any) -> str:
    attrs=p.attributes_data or {}; name=p.name or "Товар"
    brand=str(attrs.get("brand","")); rich=_normalize_blocks(p.rich_content or []); landing=p.landing_json or {}
    images = list(dict.fromkeys((p.images or []) + [u for u in [landing.get("hero",{}).get("image_url","")] + [f.get("image_url","") if isinstance(f,dict) else "" for f in (landing.get("features") or [])] if u]))
    hero_d=landing.get("hero",{}); usp=landing.get("usp",[]); features=landing.get("features",[])
    specs=landing.get("specs_preview",[]); faq=landing.get("faq",[]); cta=landing.get("cta_section",{})

    badge = f'<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(99,102,241,.2);border:1px solid rgba(139,92,246,.4);color:#c4b5fd;font-weight:700;font-size:11px;padding:6px 16px;border-radius:50px;margin-bottom:20px;letter-spacing:.06em;backdrop-filter:blur(8px)">✦ {_esc(hero_d.get("badge","Premium"))}</div>' if hero_d.get("badge") else ""
    gallery = _gallery(images,"width:100%;max-height:460px;object-fit:contain;display:block;background:#0d0d1f;","width:70px;height:70px;object-fit:cover;border-radius:10px;cursor:pointer;border:2px solid transparent;opacity:.6;transition:all .25s;")
    usp_html = "".join(f'<div class="reveal" style="text-align:center;padding:32px 16px"><div style="font-size:38px;margin-bottom:10px;filter:drop-shadow(0 4px 12px rgba(99,102,241,.5))">{_esc(u.get("icon","✓"))}</div><div style="font-weight:800;font-size:14px;margin-bottom:6px;color:#fff">{_esc(u.get("title",""))}</div><div style="color:rgba(255,255,255,.5);font-size:13px;line-height:1.6">{_esc(u.get("desc",""))}</div></div>' for u in usp[:4])
    feat_html = "".join(f'<div class="reveal" style="padding:28px;background:rgba(255,255,255,.04);border:1px solid rgba(99,102,241,.2);border-radius:20px;backdrop-filter:blur(12px);transition:all .3s" onmouseover="this.style.transform=\'translateY(-6px)\';this.style.borderColor=\'rgba(99,102,241,.5)\'" onmouseout="this.style.transform=\'\';this.style.borderColor=\'rgba(99,102,241,.2)\'"><div style="font-size:30px;margin-bottom:12px">{_esc(f.get("icon","⚡"))}</div><div style="font-weight:800;font-size:15px;margin-bottom:8px;color:#fff">{_esc(f.get("title",""))}</div><div style="color:rgba(255,255,255,.55);font-size:14px;line-height:1.6">{_esc(f.get("desc",""))}</div></div>' for f in features[:6])
    spec_html = "".join(f'<tr onmouseover="this.style.background=\'rgba(99,102,241,.08)\'" onmouseout="this.style.background=\'\'"><td style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.06);color:rgba(255,255,255,.45);font-size:14px">{_esc(r[0] if len(r)>0 else "")}</td><td style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.06);font-weight:700;font-size:14px;color:#fff">{_esc(r[1] if len(r)>1 else "")}</td></tr>' for r in specs[:12])
    rich_html = _render_rich_dark(rich)
    faq_html = _faq(faq,"#e2e8f0","rgba(255,255,255,.6)","rgba(255,255,255,.08)","rgba(255,255,255,.04)")

    return f"""<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{_esc(name)}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}html{{scroll-behavior:smooth}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#060612;color:#fff;line-height:1.5;overflow-x:hidden}}
::-webkit-scrollbar{{width:5px}}::-webkit-scrollbar-thumb{{background:rgba(99,102,241,.5);border-radius:3px}}
.thumb{{width:70px;height:70px;object-fit:cover;border-radius:10px;cursor:pointer;border:2px solid transparent;opacity:.6;transition:all .25s}}
.thumb.active{{opacity:1;border-color:#6366f1}}
.grad{{background:linear-gradient(135deg,#fff,rgba(255,255,255,.7));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}}
@keyframes float{{0%,100%{{transform:translateY(0)}}50%{{transform:translateY(-14px)}}}}
@media(max-width:768px){{.hg{{grid-template-columns:1fr!important}}.fg{{grid-template-columns:1fr!important}}}}
{REVEAL_CSS}
</style></head><body>
<section style="position:relative;min-height:100vh;display:flex;align-items:center;padding:80px 0 60px;overflow:hidden">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 20% 40%,rgba(99,102,241,.18),transparent 60%),radial-gradient(ellipse 60% 70% at 80% 60%,rgba(139,92,246,.14),transparent 60%),#060612;z-index:0"></div>
  <div style="position:absolute;top:10%;left:5%;width:340px;height:340px;background:radial-gradient(circle,rgba(99,102,241,.14),transparent 70%);border-radius:50%;filter:blur(50px);animation:float 9s ease-in-out infinite;pointer-events:none"></div>
  <div style="position:absolute;bottom:15%;right:5%;width:300px;height:300px;background:radial-gradient(circle,rgba(139,92,246,.1),transparent 70%);border-radius:50%;filter:blur(50px);animation:float 11s ease-in-out infinite reverse;pointer-events:none"></div>
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(99,102,241,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,.04) 1px,transparent 1px);background-size:56px 56px;pointer-events:none"></div>
  <div style="max-width:1200px;margin:0 auto;padding:0 32px;display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:center;position:relative;z-index:1;width:100%" class="hg">
    <div>
      {badge}
      {"<div style='font-size:12px;font-weight:700;color:rgba(165,180,252,.7);text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px'>" + _esc(brand) + "</div>" if brand else ""}
      <h1 style="font-size:clamp(28px,4vw,52px);font-weight:900;line-height:1.1;margin-bottom:22px;letter-spacing:-.025em" class="grad">{_esc(hero_d.get("headline",name))}</h1>
      <p style="font-size:clamp(15px,1.4vw,19px);color:rgba(255,255,255,.58);margin-bottom:40px;line-height:1.75">{_esc(hero_d.get("subheadline",""))}</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <a href="#" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:800;font-size:16px;padding:17px 38px;border-radius:14px;box-shadow:0 8px 32px rgba(99,102,241,.4);text-decoration:none;transition:all .3s" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 16px 48px rgba(99,102,241,.55)'" onmouseout="this.style.transform='';this.style.boxShadow='0 8px 32px rgba(99,102,241,.4)'">{_esc(hero_d.get("cta","Купить сейчас"))} →</a>
        <a href="#content" style="display:inline-flex;align-items:center;color:rgba(255,255,255,.5);font-size:15px;font-weight:600;text-decoration:none;padding:17px 8px;transition:color .2s" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='rgba(255,255,255,.5)'">Подробнее ↓</a>
      </div>
    </div>
    <div style="position:relative"><div style="position:absolute;inset:-30px;background:radial-gradient(circle at center,rgba(99,102,241,.1),transparent 70%);border-radius:50%;pointer-events:none"></div>{gallery}</div>
  </div>
</section>
{"<section style='background:rgba(255,255,255,.025);border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06)'><div style='max-width:1200px;margin:0 auto;padding:0 32px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))'>" + usp_html + "</div></section>" if usp_html else ""}
<section id="content" style="max-width:920px;margin:0 auto;padding:80px 32px">{rich_html}</section>
{"<section style='max-width:1200px;margin:0 auto;padding:80px 32px'><div class='reveal' style='text-align:center;margin-bottom:52px'><h2 style='font-size:clamp(26px,3vw,40px);font-weight:900;letter-spacing:-.02em' class='grad'>Ключевые преимущества</h2></div><div style='display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:18px' class='fg'>" + feat_html + "</div></section>" if feat_html else ""}
{"<section style='max-width:880px;margin:0 auto;padding:80px 32px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(26px,3vw,40px);font-weight:900;letter-spacing:-.02em' class='grad'>Характеристики</h2></div><div class='reveal' style='background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:20px;overflow:hidden'><table style='width:100%;border-collapse:collapse'><thead><tr><th style='padding:14px 20px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);border-bottom:1px solid rgba(255,255,255,.06);font-weight:600'>Параметр</th><th style='padding:14px 20px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);border-bottom:1px solid rgba(255,255,255,.06);font-weight:600'>Значение</th></tr></thead><tbody>" + spec_html + "</tbody></table></div></section>" if spec_html else ""}
{"<section style='max-width:760px;margin:0 auto;padding:80px 32px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(26px,3vw,40px);font-weight:900;letter-spacing:-.02em' class='grad'>Вопросы и ответы</h2></div>" + faq_html + "</section>" if faq_html else ""}
{"<section style='max-width:1200px;margin:0 auto;padding:40px 32px 100px'><div class='reveal' style='background:rgba(255,255,255,.04);border:1px solid rgba(99,102,241,.2);border-radius:32px;padding:80px 40px;text-align:center;position:relative;overflow:hidden;backdrop-filter:blur(16px)'><div style='position:absolute;inset:0;background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(139,92,246,.08));pointer-events:none'></div><div style='position:relative;z-index:1'><h2 style='font-size:clamp(22px,3.5vw,42px);font-weight:900;margin-bottom:16px;letter-spacing:-.02em' class='grad'>" + _esc(cta.get("headline","")) + "</h2><p style='font-size:18px;color:rgba(255,255,255,.6);margin-bottom:10px;line-height:1.6'>" + _esc(cta.get("subheadline","")) + "</p>" + ("<p style='font-size:13px;color:rgba(245,158,11,.85);margin-bottom:36px;font-weight:600'>" + _esc(cta.get("urgency","")) + "</p>" if cta.get("urgency") else "<div style='margin-bottom:36px'></div>") + "<a href='#' style='display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:800;font-size:17px;padding:19px 54px;border-radius:16px;box-shadow:0 12px 40px rgba(99,102,241,.45);text-decoration:none;transition:all .3s' onmouseover=\"this.style.transform='translateY(-3px)';this.style.boxShadow='0 20px 60px rgba(99,102,241,.55)'\" onmouseout=\"this.style.transform='';this.style.boxShadow='0 12px 40px rgba(99,102,241,.45)'\">" + _esc(cta.get("button","Купить")) + " →</a></div></div></section>" if cta else ""}
<footer style="border-top:1px solid rgba(255,255,255,.06);padding:36px 32px;text-align:center"><div style="font-size:13px;color:rgba(255,255,255,.22)">{_esc(name)}{" · " + _esc(brand) if brand else ""}</div></footer>
<script>{REVEAL_JS}{GALLERY_JS}{FAQ_JS}</script>
</body></html>"""


# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATE 2: LUXURY BLACK (black + gold)
# ═══════════════════════════════════════════════════════════════════════════════
def _tpl_luxury_black(p: Any) -> str:
    attrs=p.attributes_data or {}; name=p.name or "Товар"
    brand=str(attrs.get("brand","")); rich=_normalize_blocks(p.rich_content or []); landing=p.landing_json or {}
    images = list(dict.fromkeys((p.images or []) + [u for u in [landing.get("hero",{}).get("image_url","")] + [f.get("image_url","") if isinstance(f,dict) else "" for f in (landing.get("features") or [])] if u]))
    hero_d=landing.get("hero",{}); usp=landing.get("usp",[]); features=landing.get("features",[])
    specs=landing.get("specs_preview",[]); faq=landing.get("faq",[]); cta=landing.get("cta_section",{})
    gallery = _gallery(images,"width:100%;max-height:460px;object-fit:contain;display:block;background:#0a0a0a;","width:68px;height:68px;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid transparent;opacity:.55;transition:all .25s;")
    usp_html = "".join(f'<div class="reveal" style="text-align:center;padding:36px 20px;border-right:1px solid rgba(212,160,23,.1)"><div style="font-size:28px;margin-bottom:10px;color:#d4a017">{_esc(u.get("icon","★"))}</div><div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#e8d5a0;letter-spacing:.04em">{_esc(u.get("title",""))}</div><div style="color:rgba(255,255,255,.4);font-size:13px;line-height:1.6">{_esc(u.get("desc",""))}</div></div>' for u in usp[:4])
    feat_html = "".join(f'<div class="reveal" style="padding:32px;background:#111;border:1px solid rgba(212,160,23,.15);border-radius:4px;transition:all .3s" onmouseover="this.style.borderColor=\'rgba(212,160,23,.5)\'" onmouseout="this.style.borderColor=\'rgba(212,160,23,.15)\'"><div style="width:40px;height:2px;background:linear-gradient(90deg,#d4a017,#f5c842);margin-bottom:20px"></div><div style="font-weight:800;font-size:16px;margin-bottom:10px;color:#e8d5a0;letter-spacing:.02em">{_esc(f.get("title",""))}</div><div style="color:rgba(255,255,255,.45);font-size:14px;line-height:1.7">{_esc(f.get("desc",""))}</div></div>' for f in features[:6])
    spec_html = "".join(f'<tr onmouseover="this.style.background=\'rgba(212,160,23,.06)\'" onmouseout="this.style.background=\'\'"><td style="padding:16px 24px;border-bottom:1px solid rgba(212,160,23,.08);color:rgba(255,255,255,.4);font-size:13px;font-weight:500;letter-spacing:.03em">{_esc(r[0] if len(r)>0 else "")}</td><td style="padding:16px 24px;border-bottom:1px solid rgba(212,160,23,.08);font-weight:700;font-size:13px;color:#e8d5a0">{_esc(r[1] if len(r)>1 else "")}</td></tr>' for r in specs[:12])
    rich_html = _render_rich_theme(rich, "#e8d5a0", "rgba(255,255,255,.45)", "rgba(212,160,23,.15)", "#d4a017")
    faq_html = _faq(faq,"#e8d5a0","rgba(255,255,255,.5)","rgba(212,160,23,.12)","rgba(212,160,23,.05)")

    return f"""<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{_esc(name)}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}html{{scroll-behavior:smooth}}
body{{font-family:"Georgia","Times New Roman",serif;background:#0a0a0a;color:#fff;line-height:1.5;overflow-x:hidden}}
::-webkit-scrollbar{{width:4px}}::-webkit-scrollbar-thumb{{background:#d4a017;border-radius:2px}}
.thumb{{width:68px;height:68px;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid transparent;opacity:.55;transition:all .25s}}
.thumb.active{{opacity:1!important;border-color:#d4a017!important}}
.gold{{background:linear-gradient(135deg,#d4a017,#f5c842,#d4a017);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;background-size:200%;animation:gshift 4s ease infinite}}
@keyframes gshift{{0%,100%{{background-position:0%}}50%{{background-position:100%}}}}
@keyframes float{{0%,100%{{transform:translateY(0)}}50%{{transform:translateY(-10px)}}}}
@media(max-width:768px){{.hg{{grid-template-columns:1fr!important}}.fg{{grid-template-columns:1fr!important}}}}
{REVEAL_CSS}
</style></head><body>
<section style="position:relative;min-height:100vh;display:flex;align-items:center;padding:80px 0;overflow:hidden;background:#0a0a0a">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 60% 50% at 15% 50%,rgba(212,160,23,.07),transparent 60%),radial-gradient(ellipse 40% 60% at 85% 40%,rgba(212,160,23,.05),transparent 60%)"></div>
  <div style="position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(212,160,23,.4),transparent)"></div>
  <div style="max-width:1200px;margin:0 auto;padding:0 40px;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center;position:relative;z-index:1;width:100%" class="hg">
    <div>
      {"<div style='font-size:11px;font-weight:700;color:#d4a017;text-transform:uppercase;letter-spacing:.2em;margin-bottom:20px'>" + _esc(brand) + "</div>" if brand else ""}
      {"<div style='display:inline-block;border:1px solid rgba(212,160,23,.4);color:#d4a017;font-size:11px;padding:5px 18px;border-radius:2px;margin-bottom:20px;letter-spacing:.1em;font-weight:600'>" + _esc(hero_d.get("badge","")) + "</div>" if hero_d.get("badge") else ""}
      <h1 style="font-size:clamp(28px,4vw,54px);font-weight:900;line-height:1.08;margin-bottom:24px;letter-spacing:-.02em" class="gold">{_esc(hero_d.get("headline",name))}</h1>
      <div style="width:60px;height:1px;background:linear-gradient(90deg,#d4a017,transparent);margin-bottom:24px"></div>
      <p style="font-size:clamp(15px,1.4vw,18px);color:rgba(255,255,255,.55);margin-bottom:44px;line-height:1.8;font-style:italic">{_esc(hero_d.get("subheadline",""))}</p>
      <a href="#" style="display:inline-flex;align-items:center;gap:10px;background:transparent;border:1px solid #d4a017;color:#d4a017;font-weight:700;font-size:14px;padding:18px 44px;border-radius:2px;letter-spacing:.1em;text-decoration:none;text-transform:uppercase;transition:all .3s" onmouseover="this.style.background='#d4a017';this.style.color='#000'" onmouseout="this.style.background='transparent';this.style.color='#d4a017'">{_esc(hero_d.get("cta","Приобрести"))}</a>
    </div>
    <div>{gallery}</div>
  </div>
</section>
{"<section style='background:#111;border-top:1px solid rgba(212,160,23,.1);border-bottom:1px solid rgba(212,160,23,.1)'><div style='max-width:1200px;margin:0 auto;padding:0 40px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))'>" + usp_html + "</div></section>" if usp_html else ""}
<section style="max-width:900px;margin:0 auto;padding:80px 40px">{_render_rich_theme(rich,"#e8d5a0","rgba(255,255,255,.45)","rgba(212,160,23,.08)","#d4a017")}</section>
{"<section style='max-width:1200px;margin:0 auto;padding:80px 40px'><div class='reveal' style='text-align:center;margin-bottom:56px'><h2 style='font-size:clamp(24px,3vw,40px);font-weight:900;letter-spacing:-.01em' class='gold'>Исключительные возможности</h2><div style='width:60px;height:1px;background:linear-gradient(90deg,#d4a017,transparent);margin:20px auto 0'></div></div><div style='display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px' class='fg'>" + feat_html + "</div></section>" if feat_html else ""}
{"<section style='max-width:860px;margin:0 auto;padding:80px 40px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(24px,3vw,40px);font-weight:900' class='gold'>Характеристики</h2></div><div class='reveal' style='border:1px solid rgba(212,160,23,.12);border-radius:4px;overflow:hidden'><table style='width:100%;border-collapse:collapse'><thead><tr style='background:rgba(212,160,23,.06)'><th style='padding:14px 24px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#d4a017;font-weight:600'>Параметр</th><th style='padding:14px 24px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#d4a017;font-weight:600'>Значение</th></tr></thead><tbody>" + spec_html + "</tbody></table></div></section>" if spec_html else ""}
{"<section style='max-width:760px;margin:0 auto;padding:80px 40px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(24px,3vw,40px);font-weight:900' class='gold'>Вопросы и ответы</h2></div>" + faq_html + "</section>" if faq_html else ""}
{"<section style='padding:100px 40px;text-align:center;background:#0d0d0d;border-top:1px solid rgba(212,160,23,.1);position:relative'><div style='position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(212,160,23,.5),transparent)'></div><div class='reveal'><h2 style='font-size:clamp(22px,3.5vw,44px);font-weight:900;margin-bottom:16px' class='gold'>" + _esc(cta.get("headline","")) + "</h2><p style='font-size:18px;color:rgba(255,255,255,.5);margin-bottom:10px;line-height:1.7;font-style:italic'>" + _esc(cta.get("subheadline","")) + "</p>" + ("<p style='font-size:12px;color:#d4a017;margin-bottom:40px;letter-spacing:.06em;text-transform:uppercase'>" + _esc(cta.get("urgency","")) + "</p>" if cta.get("urgency") else "<div style='margin-bottom:40px'></div>") + "<a href='#' style='display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#d4a017,#f5c842);color:#000;font-weight:900;font-size:15px;padding:20px 60px;border-radius:2px;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;transition:all .3s' onmouseover=\"this.style.transform='scale(1.04)'\" onmouseout=\"this.style.transform=''\">" + _esc(cta.get("button","Приобрести")) + "</a></div></section>" if cta else ""}
<footer style="background:#050505;border-top:1px solid rgba(212,160,23,.08);padding:32px 40px;text-align:center"><div style="font-size:12px;color:rgba(255,255,255,.2);letter-spacing:.08em;text-transform:uppercase">{_esc(name)}{" · " + _esc(brand) if brand else ""}</div></footer>
<script>{REVEAL_JS}{GALLERY_JS}{FAQ_JS}</script>
</body></html>"""


# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATE 3: CYBER NEON (dark + cyan)
# ═══════════════════════════════════════════════════════════════════════════════
def _tpl_cyber_neon(p: Any) -> str:
    attrs=p.attributes_data or {}; name=p.name or "Товар"
    brand=str(attrs.get("brand","")); rich=_normalize_blocks(p.rich_content or []); landing=p.landing_json or {}
    images = list(dict.fromkeys((p.images or []) + [u for u in [landing.get("hero",{}).get("image_url","")] + [f.get("image_url","") if isinstance(f,dict) else "" for f in (landing.get("features") or [])] if u]))
    hero_d=landing.get("hero",{}); usp=landing.get("usp",[]); features=landing.get("features",[])
    specs=landing.get("specs_preview",[]); faq=landing.get("faq",[]); cta=landing.get("cta_section",{})
    gallery = _gallery(images,"width:100%;max-height:440px;object-fit:contain;display:block;background:#00040f;","width:68px;height:68px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent;opacity:.5;transition:all .25s;")
    usp_html = "".join(f'<div class="reveal" style="text-align:center;padding:32px 16px;border-right:1px solid rgba(0,245,255,.08)"><div style="font-size:30px;margin-bottom:10px;color:#00f5ff;text-shadow:0 0 20px rgba(0,245,255,.6)">{_esc(u.get("icon","◈"))}</div><div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#00f5ff;letter-spacing:.06em;text-transform:uppercase">{_esc(u.get("title",""))}</div><div style="color:rgba(255,255,255,.4);font-size:12px;line-height:1.6">{_esc(u.get("desc",""))}</div></div>' for u in usp[:4])
    feat_html = "".join(f'<div class="reveal" style="padding:24px;background:rgba(0,245,255,.03);border:1px solid rgba(0,245,255,.15);border-radius:8px;transition:all .3s;position:relative;overflow:hidden" onmouseover="this.style.borderColor=\'rgba(0,245,255,.5)\';this.style.boxShadow=\'0 0 30px rgba(0,245,255,.1)\'" onmouseout="this.style.borderColor=\'rgba(0,245,255,.15)\';this.style.boxShadow=\'none\'"><div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#00f5ff,transparent)"></div><div style="font-size:24px;margin-bottom:12px;color:#00f5ff;text-shadow:0 0 16px rgba(0,245,255,.5)">{_esc(f.get("icon","◈"))}</div><div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#e0f7ff;letter-spacing:.03em">{_esc(f.get("title",""))}</div><div style="color:rgba(255,255,255,.45);font-size:13px;line-height:1.6">{_esc(f.get("desc",""))}</div></div>' for f in features[:6])
    spec_html = "".join(f'<tr onmouseover="this.style.background=\'rgba(0,245,255,.05)\'" onmouseout="this.style.background=\'\'"><td style="padding:12px 20px;border-bottom:1px solid rgba(0,245,255,.08);color:rgba(0,245,255,.6);font-size:13px;font-family:monospace">{_esc(r[0] if len(r)>0 else "")}</td><td style="padding:12px 20px;border-bottom:1px solid rgba(0,245,255,.08);font-weight:700;font-size:13px;color:#e0f7ff;font-family:monospace">{_esc(r[1] if len(r)>1 else "")}</td></tr>' for r in specs[:12])
    rich_html = _render_rich_theme(rich, "#e0f7ff", "rgba(255,255,255,.5)", "rgba(0,245,255,.1)", "#00f5ff")
    faq_html = _faq(faq,"#e0f7ff","rgba(255,255,255,.55)","rgba(0,245,255,.12)","rgba(0,245,255,.04)")

    return f"""<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{_esc(name)}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}html{{scroll-behavior:smooth}}
body{{font-family:"Courier New",Courier,monospace;background:#00040f;color:#fff;line-height:1.5;overflow-x:hidden}}
::-webkit-scrollbar{{width:4px}}::-webkit-scrollbar-thumb{{background:#00f5ff;border-radius:2px;box-shadow:0 0 8px #00f5ff}}
.thumb{{width:68px;height:68px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent;opacity:.5;transition:all .25s}}
.thumb.active{{opacity:1!important;border-color:#00f5ff!important;box-shadow:0 0 12px rgba(0,245,255,.4)}}
.neon{{color:#00f5ff;text-shadow:0 0 40px rgba(0,245,255,.5),0 0 80px rgba(0,245,255,.2)}}
@keyframes scan{{0%{{transform:translateY(-100%)}}100%{{transform:translateY(100vh)}}}}
@keyframes float{{0%,100%{{transform:translateY(0)}}50%{{transform:translateY(-12px)}}}}
@media(max-width:768px){{.hg{{grid-template-columns:1fr!important}}.fg{{grid-template-columns:1fr!important}}}}
{REVEAL_CSS}
</style></head><body>
<div style="position:fixed;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,#00f5ff,transparent);z-index:100;animation:scan 8s linear infinite;opacity:.3;pointer-events:none"></div>
<section style="position:relative;min-height:100vh;display:flex;align-items:center;padding:80px 0;overflow:hidden">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 60% 60% at 20% 50%,rgba(0,245,255,.08),transparent 60%),radial-gradient(ellipse 40% 50% at 80% 40%,rgba(6,182,212,.06),transparent 60%)"></div>
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(0,245,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,245,255,.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none"></div>
  <div style="max-width:1200px;margin:0 auto;padding:0 32px;display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:center;position:relative;z-index:1;width:100%" class="hg">
    <div>
      {"<div style='font-size:11px;font-weight:700;color:#00f5ff;text-transform:uppercase;letter-spacing:.2em;margin-bottom:16px;text-shadow:0 0 16px rgba(0,245,255,.5)'>" + _esc(brand) + "</div>" if brand else ""}
      {"<div style='display:inline-block;border:1px solid #00f5ff;color:#00f5ff;font-size:11px;padding:5px 16px;border-radius:2px;margin-bottom:18px;letter-spacing:.1em;box-shadow:0 0 16px rgba(0,245,255,.2)'>" + _esc(hero_d.get("badge","")) + "</div>" if hero_d.get("badge") else ""}
      <h1 style="font-size:clamp(26px,4vw,52px);font-weight:900;line-height:1.1;margin-bottom:22px;letter-spacing:-.01em" class="neon">{_esc(hero_d.get("headline",name))}</h1>
      <p style="font-size:clamp(14px,1.4vw,17px);color:rgba(0,245,255,.55);margin-bottom:40px;line-height:1.75">{_esc(hero_d.get("subheadline",""))}</p>
      <a href="#" style="display:inline-flex;align-items:center;gap:8px;background:transparent;border:2px solid #00f5ff;color:#00f5ff;font-weight:700;font-size:14px;padding:16px 40px;border-radius:4px;letter-spacing:.08em;text-decoration:none;text-transform:uppercase;transition:all .3s;box-shadow:0 0 20px rgba(0,245,255,.2)" onmouseover="this.style.background='rgba(0,245,255,.1)';this.style.boxShadow='0 0 40px rgba(0,245,255,.4)'" onmouseout="this.style.background='transparent';this.style.boxShadow='0 0 20px rgba(0,245,255,.2)'">{_esc(hero_d.get("cta","Получить"))}</a>
    </div>
    <div>{gallery}</div>
  </div>
</section>
{"<section style='background:rgba(0,245,255,.02);border-top:1px solid rgba(0,245,255,.08);border-bottom:1px solid rgba(0,245,255,.08)'><div style='max-width:1200px;margin:0 auto;padding:0 32px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))'>" + usp_html + "</div></section>" if usp_html else ""}
<section style="max-width:900px;margin:0 auto;padding:80px 32px">{rich_html}</section>
{"<section style='max-width:1200px;margin:0 auto;padding:80px 32px'><div class='reveal' style='text-align:center;margin-bottom:48px'><h2 style='font-size:clamp(24px,3vw,38px);font-weight:900;letter-spacing:.02em' class='neon'>// ХАРАКТЕРИСТИКИ СИСТЕМЫ</h2></div><div style='display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px' class='fg'>" + feat_html + "</div></section>" if feat_html else ""}
{"<section style='max-width:860px;margin:0 auto;padding:80px 32px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(24px,3vw,38px);font-weight:900;letter-spacing:.02em' class='neon'>// СПЕЦИФИКАЦИИ</h2></div><div class='reveal' style='border:1px solid rgba(0,245,255,.15);border-radius:4px;overflow:hidden'><table style='width:100%;border-collapse:collapse'><thead><tr style='background:rgba(0,245,255,.06)'><th style='padding:12px 20px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#00f5ff;font-weight:600'>ПАРАМЕТР</th><th style='padding:12px 20px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#00f5ff;font-weight:600'>ЗНАЧЕНИЕ</th></tr></thead><tbody>" + spec_html + "</tbody></table></div></section>" if spec_html else ""}
{"<section style='max-width:760px;margin:0 auto;padding:80px 32px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(24px,3vw,38px);font-weight:900' class='neon'>// FAQ</h2></div>" + faq_html + "</section>" if faq_html else ""}
{"<section style='padding:100px 40px;text-align:center;position:relative;background:rgba(0,245,255,.02);border-top:1px solid rgba(0,245,255,.1)'><div class='reveal'><h2 style='font-size:clamp(22px,3.5vw,44px);font-weight:900;margin-bottom:16px' class='neon'>" + _esc(cta.get("headline","")) + "</h2><p style='font-size:17px;color:rgba(0,245,255,.5);margin-bottom:10px;line-height:1.7'>" + _esc(cta.get("subheadline","")) + "</p>" + ("<p style='font-size:12px;color:rgba(0,245,255,.7);margin-bottom:40px;letter-spacing:.08em;text-transform:uppercase'>" + _esc(cta.get("urgency","")) + "</p>" if cta.get("urgency") else "<div style='margin-bottom:40px'></div>") + "<a href='#' style='display:inline-flex;align-items:center;gap:10px;background:rgba(0,245,255,.1);border:2px solid #00f5ff;color:#00f5ff;font-weight:700;font-size:15px;padding:20px 60px;border-radius:4px;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;transition:all .3s;box-shadow:0 0 30px rgba(0,245,255,.25)' onmouseover=\"this.style.background='rgba(0,245,255,.2)';this.style.boxShadow='0 0 60px rgba(0,245,255,.4)'\" onmouseout=\"this.style.background='rgba(0,245,255,.1)';this.style.boxShadow='0 0 30px rgba(0,245,255,.25)'\">" + _esc(cta.get("button","Получить")) + "</a></div></section>" if cta else ""}
<footer style="background:#020810;border-top:1px solid rgba(0,245,255,.06);padding:28px;text-align:center"><div style="font-size:12px;color:rgba(0,245,255,.3);letter-spacing:.1em;text-transform:uppercase">{_esc(name)}{" :: " + _esc(brand) if brand else ""}</div></footer>
<script>{REVEAL_JS}{GALLERY_JS}{FAQ_JS}</script>
</body></html>"""


# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATE 4: CLEAN WHITE (minimal light)
# ═══════════════════════════════════════════════════════════════════════════════
def _tpl_clean_white(p: Any) -> str:
    attrs=p.attributes_data or {}; name=p.name or "Товар"
    brand=str(attrs.get("brand","")); rich=_normalize_blocks(p.rich_content or []); landing=p.landing_json or {}
    images = list(dict.fromkeys((p.images or []) + [u for u in [landing.get("hero",{}).get("image_url","")] + [f.get("image_url","") if isinstance(f,dict) else "" for f in (landing.get("features") or [])] if u]))
    hero_d=landing.get("hero",{}); usp=landing.get("usp",[]); features=landing.get("features",[])
    specs=landing.get("specs_preview",[]); faq=landing.get("faq",[]); cta=landing.get("cta_section",{})
    gallery = _gallery(images,"width:100%;max-height:480px;object-fit:contain;display:block;background:#f8faff;border-radius:20px;","width:68px;height:68px;object-fit:cover;border-radius:10px;cursor:pointer;border:2px solid transparent;opacity:.6;transition:all .25s;")
    usp_html = "".join(f'<div class="reveal" style="text-align:center;padding:36px 24px"><div style="width:48px;height:48px;background:#eff6ff;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto 14px">{_esc(u.get("icon","✓"))}</div><div style="font-weight:800;font-size:14px;margin-bottom:6px;color:#1e293b">{_esc(u.get("title",""))}</div><div style="color:#64748b;font-size:13px;line-height:1.6">{_esc(u.get("desc",""))}</div></div>' for u in usp[:4])
    feat_html = "".join(f'<div class="reveal" style="padding:28px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;transition:all .3s;box-shadow:0 1px 4px rgba(0,0,0,.04)" onmouseover="this.style.transform=\'translateY(-4px)\';this.style.boxShadow=\'0 12px 40px rgba(37,99,235,.1)\';this.style.borderColor=\'#bfdbfe\'" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'0 1px 4px rgba(0,0,0,.04)\';this.style.borderColor=\'#e2e8f0\'"><div style="width:44px;height:44px;background:#eff6ff;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:14px">{_esc(f.get("icon","⚡"))}</div><div style="font-weight:800;font-size:15px;margin-bottom:8px;color:#1e293b">{_esc(f.get("title",""))}</div><div style="color:#64748b;font-size:14px;line-height:1.65">{_esc(f.get("desc",""))}</div></div>' for f in features[:6])
    spec_html = "".join(f'<tr onmouseover="this.style.background=\'#f1f5f9\'" onmouseout="this.style.background=\'\'"><td style="padding:14px 20px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:14px">{_esc(r[0] if len(r)>0 else "")}</td><td style="padding:14px 20px;border-bottom:1px solid #f1f5f9;font-weight:700;font-size:14px;color:#1e293b">{_esc(r[1] if len(r)>1 else "")}</td></tr>' for r in specs[:12])
    rich_html = _render_rich_light(rich)
    faq_html = _faq(faq,"#1e293b","#475569","#e2e8f0","#fff")
    return f"""<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{_esc(name)}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}html{{scroll-behavior:smooth}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fafbff;color:#1e293b;line-height:1.5;overflow-x:hidden}}
.thumb{{width:68px;height:68px;object-fit:cover;border-radius:10px;cursor:pointer;border:2px solid transparent;opacity:.6;transition:all .25s}}
.thumb.active{{opacity:1!important;border-color:#2563eb!important}}
@media(max-width:768px){{.hg{{grid-template-columns:1fr!important}}.fg{{grid-template-columns:1fr!important}}}}
{REVEAL_CSS.replace("opacity:0;","opacity:0;")}
</style></head><body>
<nav style="position:sticky;top:0;z-index:100;background:rgba(250,251,255,.9);backdrop-filter:blur(20px);border-bottom:1px solid #e2e8f0;padding:0 40px;height:64px;display:flex;align-items:center;gap:16px">
  {"<span style='font-size:13px;font-weight:800;color:#1e293b;letter-spacing:.02em'>" + _esc(brand) + "</span>" if brand else ""}
  <div style="flex:1"></div>
  <a href="#" style="display:inline-flex;align-items:center;background:#2563eb;color:#fff;font-weight:700;font-size:13px;padding:10px 24px;border-radius:10px;text-decoration:none;transition:all .2s" onmouseover="this.style.background='#1d4ed8'" onmouseout="this.style.background='#2563eb'">{_esc(hero_d.get("cta","Купить"))}</a>
</nav>
<section style="padding:100px 0 60px">
  <div style="max-width:1200px;margin:0 auto;padding:0 40px;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center" class="hg">
    <div>
      {"<div style='font-size:12px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.12em;margin-bottom:16px'>" + _esc(brand) + "</div>" if brand else ""}
      {"<div style='display:inline-block;background:#eff6ff;color:#2563eb;font-size:12px;padding:5px 14px;border-radius:50px;margin-bottom:16px;font-weight:700'>" + _esc(hero_d.get("badge","")) + "</div>" if hero_d.get("badge") else ""}
      <h1 style="font-size:clamp(28px,4vw,52px);font-weight:900;line-height:1.1;margin-bottom:20px;color:#0f172a;letter-spacing:-.03em">{_esc(hero_d.get("headline",name))}</h1>
      <p style="font-size:clamp(15px,1.4vw,18px);color:#64748b;margin-bottom:40px;line-height:1.75">{_esc(hero_d.get("subheadline",""))}</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <a href="#" style="display:inline-flex;align-items:center;gap:8px;background:#2563eb;color:#fff;font-weight:700;font-size:15px;padding:16px 36px;border-radius:12px;box-shadow:0 4px 20px rgba(37,99,235,.35);text-decoration:none;transition:all .3s" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 32px rgba(37,99,235,.45)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 20px rgba(37,99,235,.35)'">{_esc(hero_d.get("cta","Купить сейчас"))}</a>
        <a href="#content" style="display:inline-flex;align-items:center;gap:8px;background:#f1f5f9;color:#475569;font-weight:600;font-size:15px;padding:16px 28px;border-radius:12px;text-decoration:none;transition:all .2s" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">Узнать больше</a>
      </div>
    </div>
    <div>{gallery}</div>
  </div>
</section>
{"<section style='background:#fff;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0'><div style='max-width:1200px;margin:0 auto;padding:0 40px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))'>" + usp_html + "</div></section>" if usp_html else ""}
<section id="content" style="max-width:880px;margin:0 auto;padding:80px 40px">{rich_html}</section>
{"<section style='max-width:1200px;margin:0 auto;padding:80px 40px'><div class='reveal' style='text-align:center;margin-bottom:52px'><h2 style='font-size:clamp(26px,3vw,40px);font-weight:900;color:#0f172a;letter-spacing:-.025em'>Почему выбирают нас</h2><p style='color:#64748b;font-size:16px;margin-top:12px'>Всё что нужно для идеального выбора</p></div><div style='display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px' class='fg'>" + feat_html + "</div></section>" if feat_html else ""}
{"<section style='max-width:860px;margin:0 auto;padding:80px 40px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(26px,3vw,40px);font-weight:900;color:#0f172a;letter-spacing:-.025em'>Технические характеристики</h2></div><div class='reveal' style='background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04)'><table style='width:100%;border-collapse:collapse'><thead><tr style='background:#f8fafc'><th style='padding:14px 20px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:600'>Параметр</th><th style='padding:14px 20px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:600'>Значение</th></tr></thead><tbody>" + spec_html + "</tbody></table></div></section>" if spec_html else ""}
{"<section style='max-width:760px;margin:0 auto;padding:80px 40px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(26px,3vw,40px);font-weight:900;color:#0f172a;letter-spacing:-.025em'>Часто задаваемые вопросы</h2></div>" + faq_html + "</section>" if faq_html else ""}
{"<section style='background:linear-gradient(135deg,#eff6ff,#f0fdf4);padding:100px 40px;text-align:center'><div class='reveal'><h2 style='font-size:clamp(24px,3.5vw,44px);font-weight:900;color:#0f172a;margin-bottom:16px;letter-spacing:-.025em'>" + _esc(cta.get("headline","")) + "</h2><p style='font-size:18px;color:#64748b;margin-bottom:10px;line-height:1.65'>" + _esc(cta.get("subheadline","")) + "</p>" + ("<p style='font-size:13px;color:#dc2626;margin-bottom:36px;font-weight:600'>" + _esc(cta.get("urgency","")) + "</p>" if cta.get("urgency") else "<div style='margin-bottom:36px'></div>") + "<a href='#' style='display:inline-flex;align-items:center;gap:8px;background:#2563eb;color:#fff;font-weight:800;font-size:17px;padding:20px 56px;border-radius:14px;box-shadow:0 8px 32px rgba(37,99,235,.4);text-decoration:none;transition:all .3s' onmouseover=\"this.style.transform='translateY(-3px)';this.style.boxShadow='0 16px 48px rgba(37,99,235,.5)'\" onmouseout=\"this.style.transform='';this.style.boxShadow='0 8px 32px rgba(37,99,235,.4)'\">" + _esc(cta.get("button","Купить")) + " →</a></div></section>" if cta else ""}
<footer style="background:#0f172a;padding:36px 40px;text-align:center"><div style="font-size:13px;color:rgba(255,255,255,.3)">{_esc(name)}{" · " + _esc(brand) if brand else ""}</div></footer>
<script>{REVEAL_JS}{GALLERY_JS}{FAQ_JS}</script>
</body></html>"""


# ═══════════════════════════════════════════════════════════════════════════════
# Rich block renderers
# ═══════════════════════════════════════════════════════════════════════════════
def _render_rich_dark(blocks: List[Dict]) -> str:
    return _render_rich_theme(blocks, "#fff", "rgba(255,255,255,.6)", "rgba(99,102,241,.12)", "#6366f1")

def _render_rich_light(blocks: List[Dict]) -> str:
    parts = []
    for b in blocks:
        t = b.get("type","")
        if t == "text":
            parts.append(f'<div class="reveal" style="margin:28px 0;font-size:16px;line-height:1.8;color:#475569">{b.get("html","")}</div>')
        elif t == "callout":
            bgs={"info":"#eff6ff","success":"#f0fdf4","warning":"#fffbeb"}; borders={"info":"#2563eb","success":"#16a34a","warning":"#d97706"}
            s=b.get("style","info")
            parts.append(f'<div class="reveal" style="background:{bgs.get(s,"#eff6ff")};border-left:4px solid {borders.get(s,"#2563eb")};border-radius:0 12px 12px 0;padding:20px 24px;margin:24px 0"><b style="color:#1e293b;font-size:15px;display:block;margin-bottom:8px">{_esc(b.get("title",""))}</b><p style="color:#475569;font-size:14px;line-height:1.65;margin:0">{_esc(b.get("text",""))}</p></div>')
        # features and specs rendered in dedicated landing sections
    return "".join(parts)

def _render_rich_theme(blocks: List[Dict], text_color: str, muted_color: str, callout_bg: str, accent: str) -> str:
    parts = []
    for b in blocks:
        t = b.get("type","")
        if t == "text":
            parts.append(f'<div class="reveal" style="margin:28px 0;font-size:15px;line-height:1.85;color:{muted_color}">{b.get("html","")}</div>')
        elif t == "callout":
            parts.append(f'<div class="reveal" style="background:{callout_bg};border-left:4px solid {accent};border-radius:0 14px 14px 0;padding:22px 26px;margin:24px 0"><b style="color:{text_color};font-size:15px;display:block;margin-bottom:8px">{_esc(b.get("title",""))}</b><p style="color:{muted_color};font-size:14px;line-height:1.65;margin:0">{_esc(b.get("text",""))}</p></div>')
        elif t == "gallery":
            imgs = b.get("images", [])
            if imgs:
                main_img = _esc(imgs[0])
                gid = f"gal_{id(b)}"
                thumbs_parts = []
                for _gi, _gu in enumerate(imgs[:8]):
                    _eu = _esc(_gu)
                    thumbs_parts.append(
                        f'<img src="{_eu}" style="width:110px;height:80px;object-fit:cover;border-radius:8px;cursor:pointer;opacity:.65;transition:all .2s" '
                        f'onclick="document.getElementById(\'{gid}\').src=this.src;[...this.parentElement.querySelectorAll(\'img\')].forEach(x=>x.style.opacity=.65);this.style.opacity=1" />'
                    )
                thumbs = "".join(thumbs_parts)
                parts.append(
                    f'<div class="reveal" style="margin:28px 0">'
                    f'<img id="{gid}" src="{main_img}" style="width:100%;max-height:400px;object-fit:contain;border-radius:12px;display:block;margin-bottom:12px" />'
                    f'<div style="display:flex;gap:8px;flex-wrap:wrap">{thumbs}</div>'
                    f'</div>'
                )
        elif t == "hero":
            img_url = b.get("image_url", "")
            if img_url:
                parts.append(f'<div class="reveal" style="margin:28px 0;border-radius:16px;overflow:hidden"><img src="{_esc(img_url)}" style="width:100%;max-height:460px;object-fit:contain;display:block" /></div>')
        # specs/features blocks are rendered in the dedicated landing section — skip here
    return "".join(parts)


# ═══════════════════════════════════════════════════════════════════════════════
# Remaining 8 templates — variations on the 4 base themes
# ═══════════════════════════════════════════════════════════════════════════════
def _make_dark_variant(accent_hex: str, accent_rgb: str, bg: str, bg2: str):
    """Factory for dark templates with different accent colors."""
    def _tpl(p: Any) -> str:
        attrs=p.attributes_data or {}; name=p.name or "Товар"
        brand=str(attrs.get("brand","")); rich=_normalize_blocks(p.rich_content or []); landing=p.landing_json or {}
        images = list(dict.fromkeys((p.images or []) + [u for u in [landing.get("hero",{}).get("image_url","")] + [f.get("image_url","") if isinstance(f,dict) else "" for f in (landing.get("features") or [])] if u]))
        hero_d=landing.get("hero",{}); usp=landing.get("usp",[]); features=landing.get("features",[])
        specs=landing.get("specs_preview",[]); faq=landing.get("faq",[]); cta=landing.get("cta_section",{})
        gallery = _gallery(images,f"width:100%;max-height:460px;object-fit:contain;display:block;background:{bg};",f"width:68px;height:68px;object-fit:cover;border-radius:10px;cursor:pointer;border:2px solid transparent;opacity:.6;transition:all .25s;")
        usp_html = "".join(f'<div class="reveal" style="text-align:center;padding:32px 16px"><div style="font-size:36px;margin-bottom:10px">{_esc(u.get("icon","✓"))}</div><div style="font-weight:800;font-size:14px;margin-bottom:6px;color:{accent_hex}">{_esc(u.get("title",""))}</div><div style="color:rgba(255,255,255,.45);font-size:13px;line-height:1.6">{_esc(u.get("desc",""))}</div></div>' for u in usp[:4])
        feat_html = "".join(f'<div class="reveal" style="padding:26px;background:rgba(255,255,255,.03);border:1px solid rgba({accent_rgb},.18);border-radius:16px;transition:all .3s" onmouseover="this.style.transform=\'translateY(-5px)\';this.style.borderColor=\'rgba({accent_rgb},.45)\'" onmouseout="this.style.transform=\'\';this.style.borderColor=\'rgba({accent_rgb},.18)\'"><div style="font-size:28px;margin-bottom:12px">{_esc(f.get("icon","⚡"))}</div><div style="font-weight:800;font-size:15px;margin-bottom:8px;color:#fff">{_esc(f.get("title",""))}</div><div style="color:rgba(255,255,255,.5);font-size:13px;line-height:1.65">{_esc(f.get("desc",""))}</div></div>' for f in features[:6])
        spec_html = "".join(f'<tr onmouseover="this.style.background=\'rgba({accent_rgb},.07)\'" onmouseout="this.style.background=\'\'"><td style="padding:13px 20px;border-bottom:1px solid rgba(255,255,255,.05);color:rgba(255,255,255,.45);font-size:13px">{_esc(r[0] if len(r)>0 else "")}</td><td style="padding:13px 20px;border-bottom:1px solid rgba(255,255,255,.05);font-weight:700;font-size:13px;color:#fff">{_esc(r[1] if len(r)>1 else "")}</td></tr>' for r in specs[:12])
        rich_html = _render_rich_theme(rich,"#fff",f"rgba(255,255,255,.58)",f"rgba({accent_rgb},.1)",accent_hex)
        faq_html = _faq(faq,"#e2e8f0","rgba(255,255,255,.6)",f"rgba({accent_rgb},.15)",f"rgba({accent_rgb},.05)")
        badge = f'<div style="display:inline-flex;align-items:center;gap:6px;background:rgba({accent_rgb},.15);border:1px solid rgba({accent_rgb},.35);color:{accent_hex};font-weight:700;font-size:11px;padding:6px 16px;border-radius:50px;margin-bottom:20px;letter-spacing:.06em">✦ {_esc(hero_d.get("badge","Premium"))}</div>' if hero_d.get("badge") else ""
        return f"""<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{_esc(name)}</title>
<style>*{{box-sizing:border-box;margin:0;padding:0}}html{{scroll-behavior:smooth}}body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:{bg};color:#fff;line-height:1.5;overflow-x:hidden}}
.thumb{{width:68px;height:68px;object-fit:cover;border-radius:10px;cursor:pointer;border:2px solid transparent;opacity:.6;transition:all .25s}}.thumb.active{{opacity:1!important;border-color:{accent_hex}!important}}
@keyframes float{{0%,100%{{transform:translateY(0)}}50%{{transform:translateY(-12px)}}}}
@media(max-width:768px){{.hg{{grid-template-columns:1fr!important}}.fg{{grid-template-columns:1fr!important}}}}{REVEAL_CSS}</style></head><body>
<section style="position:relative;min-height:100vh;display:flex;align-items:center;padding:80px 0;overflow:hidden">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 70% 60% at 20% 45%,rgba({accent_rgb},.15),transparent 55%),radial-gradient(ellipse 50% 60% at 80% 55%,rgba({accent_rgb},.1),transparent 55%),{bg}"></div>
  <div style="position:absolute;top:10%;left:5%;width:320px;height:320px;background:radial-gradient(circle,rgba({accent_rgb},.12),transparent 70%);border-radius:50%;filter:blur(50px);animation:float 9s ease-in-out infinite;pointer-events:none"></div>
  <div style="max-width:1200px;margin:0 auto;padding:0 32px;display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:center;position:relative;z-index:1;width:100%" class="hg">
    <div>
      {badge}
      {"<div style='font-size:12px;font-weight:700;color:" + accent_hex + ";text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px'>" + _esc(brand) + "</div>" if brand else ""}
      <h1 style="font-size:clamp(28px,4vw,52px);font-weight:900;line-height:1.1;margin-bottom:22px;letter-spacing:-.025em;color:#fff">{_esc(hero_d.get("headline",name))}</h1>
      <p style="font-size:clamp(15px,1.4vw,19px);color:rgba(255,255,255,.55);margin-bottom:40px;line-height:1.75">{_esc(hero_d.get("subheadline",""))}</p>
      <a href="#" style="display:inline-flex;align-items:center;gap:8px;background:{accent_hex};color:#fff;font-weight:800;font-size:16px;padding:17px 38px;border-radius:14px;box-shadow:0 8px 32px rgba({accent_rgb},.4);text-decoration:none;transition:all .3s" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 16px 48px rgba({accent_rgb},.55)'" onmouseout="this.style.transform='';this.style.boxShadow='0 8px 32px rgba({accent_rgb},.4)'">{_esc(hero_d.get("cta","Купить сейчас"))} →</a>
    </div>
    <div>{gallery}</div>
  </div>
</section>
{"<section style='background:rgba(255,255,255,.025);border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06)'><div style='max-width:1200px;margin:0 auto;padding:0 32px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))'>" + usp_html + "</div></section>" if usp_html else ""}
<section style="max-width:900px;margin:0 auto;padding:80px 32px">{rich_html}</section>
{"<section style='max-width:1200px;margin:0 auto;padding:80px 32px'><div class='reveal' style='text-align:center;margin-bottom:52px'><h2 style='font-size:clamp(26px,3vw,40px);font-weight:900;color:#fff;letter-spacing:-.02em'>Ключевые преимущества</h2></div><div style='display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:18px' class='fg'>" + feat_html + "</div></section>" if feat_html else ""}
{"<section style='max-width:860px;margin:0 auto;padding:80px 32px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(26px,3vw,40px);font-weight:900;color:#fff;letter-spacing:-.02em'>Характеристики</h2></div><div class='reveal' style='background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:20px;overflow:hidden'><table style='width:100%;border-collapse:collapse'><thead><tr><th style='padding:14px 20px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);border-bottom:1px solid rgba(255,255,255,.06);font-weight:600'>Параметр</th><th style='padding:14px 20px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);border-bottom:1px solid rgba(255,255,255,.06);font-weight:600'>Значение</th></tr></thead><tbody>" + spec_html + "</tbody></table></div></section>" if spec_html else ""}
{"<section style='max-width:760px;margin:0 auto;padding:80px 32px'><div class='reveal' style='text-align:center;margin-bottom:44px'><h2 style='font-size:clamp(26px,3vw,40px);font-weight:900;color:#fff;letter-spacing:-.02em'>Вопросы и ответы</h2></div>" + faq_html + "</section>" if faq_html else ""}
{"<section style='max-width:1200px;margin:0 auto;padding:40px 32px 100px'><div class='reveal' style='background:rgba(" + accent_rgb + ",.1);border:1px solid rgba(" + accent_rgb + ",.25);border-radius:28px;padding:72px 40px;text-align:center;backdrop-filter:blur(16px)'><h2 style='font-size:clamp(22px,3.5vw,42px);font-weight:900;margin-bottom:16px;color:#fff;letter-spacing:-.02em'>" + _esc(cta.get("headline","")) + "</h2><p style='font-size:18px;color:rgba(255,255,255,.6);margin-bottom:10px;line-height:1.6'>" + _esc(cta.get("subheadline","")) + "</p>" + ("<p style='font-size:13px;color:" + accent_hex + ";margin-bottom:36px;font-weight:600'>" + _esc(cta.get("urgency","")) + "</p>" if cta.get("urgency") else "<div style='margin-bottom:36px'></div>") + "<a href='#' style='display:inline-flex;align-items:center;gap:8px;background:" + accent_hex + ";color:#fff;font-weight:800;font-size:17px;padding:19px 54px;border-radius:16px;box-shadow:0 12px 40px rgba(" + accent_rgb + ",.45);text-decoration:none;transition:all .3s' onmouseover=\"this.style.transform='translateY(-3px)'\" onmouseout=\"this.style.transform=''\">" + _esc(cta.get("button","Купить")) + " →</a></div></section>" if cta else ""}
<footer style="border-top:1px solid rgba(255,255,255,.06);padding:32px;text-align:center"><div style="font-size:13px;color:rgba(255,255,255,.2)">{_esc(name)}{" · " + _esc(brand) if brand else ""}</div></footer>
<script>{REVEAL_JS}{GALLERY_JS}{FAQ_JS}</script></body></html>"""
    return _tpl


# Generate remaining 8 templates using the factory
_tpl_deep_ocean   = _make_dark_variant("#06b6d4", "6,182,212",  "#020b18", "#031d3a")
_tpl_rose_luxury  = _make_dark_variant("#f43f8e", "244,63,142", "#1a0010", "#2d0a1a")
_tpl_forest_dark  = _make_dark_variant("#10b981", "16,185,129", "#010d08", "#021a0e")
_tpl_sunset_warm  = _make_dark_variant("#f97316", "249,115,22", "#1a0a00", "#2d1500")
_tpl_midnight_blue= _make_dark_variant("#3b82f6", "59,130,246", "#000814", "#001233")
_tpl_carbon_fiber = _make_dark_variant("#94a3b8", "148,163,184","#0d0d0d", "#1a1a1a")
_tpl_violet_dream = _make_dark_variant("#a855f7", "168,85,247", "#0d0021", "#1a003d")
_tpl_arctic_clean = _make_dark_variant("#0284c7", "2,132,199",  "#f0f8ff", "#e8f4ff")  # light variant


# ─── Dispatch table ───────────────────────────────────────────────────────────

_RENDERERS = {
    "dark_premium":  _tpl_dark_premium,
    "luxury_black":  _tpl_luxury_black,
    "cyber_neon":    _tpl_cyber_neon,
    "clean_white":   _tpl_clean_white,
    "deep_ocean":    _tpl_deep_ocean,
    "rose_luxury":   _tpl_rose_luxury,
    "forest_dark":   _tpl_forest_dark,
    "sunset_warm":   _tpl_sunset_warm,
    "midnight_blue": _tpl_midnight_blue,
    "carbon_fiber":  _tpl_carbon_fiber,
    "violet_dream":  _tpl_violet_dream,
    "arctic_clean":  _tpl_arctic_clean,
}


def render_landing(product: Any, template: str | None = None) -> str:
    tpl = template or getattr(product, "landing_template", None) or "dark_premium"
    renderer = _RENDERERS.get(tpl, _tpl_dark_premium)
    return renderer(product)
