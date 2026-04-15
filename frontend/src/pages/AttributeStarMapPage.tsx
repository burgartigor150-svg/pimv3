import React, { useEffect, useState, useCallback, useRef } from "react";
import NeuralMapLoader from "../components/NeuralMapLoader";

interface BuildStatus {
  task_id: string; status: string; stage: string;
  progress_percent: number; message: string; error?: string;
}
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import {
  Search, Loader2, ArrowLeftRight, Check, ChevronRight,
  Sparkles, AlertCircle, RefreshCw, Link2, BookOpen, X, ChevronDown,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Category { id: string; name: string; }

interface Connection { id: string; type: string; name: string; }

interface MpAttr {
  id: string; name: string; is_required?: boolean; type?: string;
  valueTypeCode?: string; isSuggest?: boolean | null;
  dictionary_options?: { id: string | number; name: string }[];
  values?: any[];
}

interface MapEdge {
  from_attribute_id: string; from_name: string;
  to_attribute_id: string; to_name: string;
  score: number; method: string;
  mm_is_required?: boolean; mm_type?: string;
  mm_is_suggest?: boolean | null;
  mm_dictionary?: { id: string | number; name: string }[];
  value_mappings?: { oz_value: string; mm_id: string; mm_name: string }[];
}

// ─── Platform helpers ─────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  ozon: "#005bff", megamarket: "#ff9900", wildberries: "#cb3e76", wb: "#cb3e76", yandex: "#ffcc00",
};
const PLATFORM_LABELS: Record<string, string> = {
  ozon: "Ozon", megamarket: "Megamarket", wildberries: "Wildberries", wb: "Wildberries", yandex: "Яндекс",
};
function platformColor(p: string) { return PLATFORM_COLORS[p?.toLowerCase()] ?? "#8888cc"; }
function platformLabel(p: string) { return PLATFORM_LABELS[p?.toLowerCase()] ?? p; }

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  card: {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
  } as React.CSSProperties,
  input: {
    width: "100%", padding: "9px 12px", borderRadius: 9, fontSize: 13,
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    color: "rgba(255,255,255,0.88)", outline: "none", boxSizing: "border-box",
  } as React.CSSProperties,
  btnPrimary: {
    display: "flex", alignItems: "center", gap: 7, padding: "9px 18px",
    borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
    background: "linear-gradient(135deg,#6366f1,#a855f7)", color: "#fff",
    border: "none", whiteSpace: "nowrap",
  } as React.CSSProperties,
  btnGhost: {
    display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
    borderRadius: 9, fontSize: 12, fontWeight: 500, cursor: "pointer",
    background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)",
    border: "1px solid rgba(255,255,255,0.1)",
  } as React.CSSProperties,
  scoreColor: (s: number) => s >= 0.85 ? "#10b981" : s >= 0.6 ? "#f59e0b" : "#f87171",
};

// ─── Platform Selector ────────────────────────────────────────────────────────

function PlatformSelector({ label, value, onChange, connections, exclude }: {
  label: string; value: string; onChange: (v: string) => void;
  connections: Connection[]; exclude?: string;
}) {
  const available = connections.filter(c => c.type !== exclude);
  const unique = [...new Map(available.map(c => [c.type, c])).values()];
  const color = platformColor(value);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ position: "relative" }}>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            padding: "7px 32px 7px 12px", borderRadius: 9, fontSize: 13, fontWeight: 600,
            background: color + "18", border: `1px solid ${color}44`,
            color, outline: "none", cursor: "pointer", appearance: "none",
          }}
        >
          {unique.map(c => (
            <option key={c.type} value={c.type} style={{ background: "#1a1a2e", color: "#fff" }}>
              {platformLabel(c.type)}
            </option>
          ))}
        </select>
        <ChevronDown size={12} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color, pointerEvents: "none" }} />
      </div>
    </div>
  );
}

// ─── Category helpers ─────────────────────────────────────────────────────────

function splitCatName(name: string): { leaf: string; path: string } {
  // Normalise: " -> " and "->" → split on "->"
  const norm = name.replace(/ -> /g, "->").replace(/ \/ /g, "/");
  const sep = norm.includes("->") ? "->" : norm.includes("/") ? "/" : null;
  if (!sep) return { leaf: name.trim(), path: "" };
  const parts = norm.split(sep).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return { leaf: name.trim(), path: "" };
  return { leaf: parts[parts.length - 1], path: parts.slice(0, -1).join(" / ") };
}

const PAGE_SIZE = 60;

// ─── Category Search Panel ────────────────────────────────────────────────────

function CategoryPanel({ platform, selected, onSelect }: {
  platform: string; selected: Category | null; onSelect: (c: Category) => void;
}) {
  const [q, setQ] = useState("");
  const [allCats, setAllCats] = useState<Category[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const color = platformColor(platform);

  const search = useCallback(async (query: string) => {
    if (!platform) return;
    setLoading(true);
    setVisible(PAGE_SIZE);
    try {
      const res = await api.get(`/mp/categories?platform=${platform}&q=${encodeURIComponent(query)}`);
      setAllCats(res.data.categories ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [platform]);

  useEffect(() => {
    setAllCats([]); setQ(""); setVisible(PAGE_SIZE);
    search("");
  }, [platform]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, search]);

  // Load more on scroll
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setVisible(v => Math.min(v + PAGE_SIZE, allCats.length));
    }
  }, [allCats.length]);

  const cats = allCats.slice(0, visible);

  return (
    <div style={{ ...S.card, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>{platformLabel(platform)}</span>
          {selected && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: color + "22", color, fontWeight: 600, marginLeft: "auto", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {splitCatName(selected.name).leaf}
            </span>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
          <input
            style={{ ...S.input, paddingLeft: 32, fontSize: 12 }}
            placeholder="Поиск категории..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
      </div>
      <div ref={listRef} onScroll={onScroll} style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
          </div>
        ) : cats.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.2)" }}>
            {q ? "Ничего не найдено" : "Загрузка..."}
          </div>
        ) : (
          <>
            {cats.map(cat => {
              const { leaf, path } = splitCatName(cat.name);
              return (
                <div
                  key={cat.id}
                  onClick={() => onSelect(cat)}
                  style={{
                    padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", minWidth: 0,
                    justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background: selected?.id === cat.id ? color + "18" : "transparent",
                    borderLeft: `3px solid ${selected?.id === cat.id ? color : "transparent"}`,
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={e => { if (selected?.id !== cat.id) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { if (selected?.id !== cat.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", lineHeight: 1.4 }}>
                      {leaf}
                    </span>
                    {path && (
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                        {path.split(" / ").slice(-2).join(" / ")}
                      </span>
                    )}
                  </div>
                  <ChevronRight size={12} color="rgba(255,255,255,0.2)" style={{ flexShrink: 0, marginLeft: 6 }} />
                </div>
              );
            })}
            {visible < allCats.length && (
              <div style={{ padding: "10px 16px", textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                Прокрутите вниз — ещё {allCats.length - visible} категорий
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Attribute Preview ────────────────────────────────────────────────────────

function AttrPreview({ platform, category }: { platform: string; category: Category }) {
  const [attrs, setAttrs] = useState<MpAttr[]>([]);
  const [loading, setLoading] = useState(false);
  const color = platformColor(platform);

  useEffect(() => {
    setLoading(true);
    api.get(`/mp/category/attributes?platform=${platform}&category_id=${category.id}`)
      .then(r => setAttrs(r.data.attributes ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [platform, category.id]);

  return (
    <div style={{ ...S.card, padding: 16 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <BookOpen size={13} color={color} />
        {loading ? "Загрузка атрибутов..." : `${attrs.length} атрибутов`}
      </p>
      {loading ? (
        <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "rgba(255,255,255,0.3)" }} />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 180, overflow: "hidden" }}>
          {attrs.slice(0, 30).map(a => (
            <span key={a.id} style={{
              fontSize: 11, padding: "3px 8px", borderRadius: 6,
              background: a.is_required ? "rgba(248,113,113,0.12)" : "rgba(255,255,255,0.06)",
              color: a.is_required ? "#fca5a5" : "rgba(255,255,255,0.5)",
              border: `1px solid ${a.is_required ? "rgba(248,113,113,0.25)" : "transparent"}`,
            }}>
              {a.name}
              {(a.dictionary_options?.length ?? 0) > 0 && <span style={{ marginLeft: 4, opacity: 0.5 }}>📋</span>}
            </span>
          ))}
          {attrs.length > 30 && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>+{attrs.length - 30}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Manual Attribute Mapper ─────────────────────────────────────────────────

function ManualMapper({ srcPlatform, tgtPlatform, srcCat, tgtCat, initialEdges, onSaved }: {
  srcPlatform: string; tgtPlatform: string;
  srcCat: Category; tgtCat: Category;
  initialEdges: MapEdge[];
  onSaved: (edges: MapEdge[]) => void;
}) {
  const { toast } = useToast();
  const [srcAttrs, setSrcAttrs] = useState<MpAttr[]>([]);
  const [tgtAttrs, setTgtAttrs] = useState<MpAttr[]>([]);
  const [loadingAttrs, setLoadingAttrs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownQ, setDropdownQ] = useState("");

  useEffect(() => {
    setLoadingAttrs(true);
    Promise.all([
      api.get(`/mp/category/attributes?platform=${srcPlatform}&category_id=${srcCat.id}`),
      api.get(`/mp/category/attributes?platform=${tgtPlatform}&category_id=${tgtCat.id}`),
    ]).then(([srcR, tgtR]) => {
      setSrcAttrs(srcR.data.attributes ?? []);
      setTgtAttrs(tgtR.data.attributes ?? []);
      const init: Record<string, string | null> = {};
      for (const e of initialEdges) init[e.from_attribute_id] = e.to_attribute_id || null;
      setAssignments(init);
    }).catch(() => toast("Ошибка загрузки атрибутов", "error"))
      .finally(() => setLoadingAttrs(false));
  }, [srcCat.id, tgtCat.id]);

  const tgtById: Record<string, MpAttr> = {};
  for (const a of tgtAttrs) tgtById[a.id] = a;

  const assign = (srcId: string, tgtId: string | null) => {
    setAssignments(prev => ({ ...prev, [srcId]: tgtId }));
    setOpenDropdown(null); setDropdownQ("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const edges: MapEdge[] = [];
      for (const src of srcAttrs) {
        const tgtId = assignments[src.id];
        if (!tgtId) continue;
        const tgt = tgtById[tgtId];
        if (!tgt) continue;
        const existing = initialEdges.find(e => e.from_attribute_id === src.id && e.to_attribute_id === tgtId);
        edges.push({
          from_attribute_id: src.id, from_name: src.name,
          to_attribute_id: tgt.id, to_name: tgt.name,
          score: existing?.score ?? 1.0, method: existing?.method ?? "manual",
          mm_is_required: tgt.is_required, mm_type: tgt.valueTypeCode ?? tgt.type ?? "",
          mm_is_suggest: tgt.isSuggest, mm_dictionary: tgt.dictionary_options ?? [],
          value_mappings: existing?.value_mappings ?? [],
        });
      }
      const res = await api.post("/mp/category/map/manual", {
        src_platform: srcPlatform, tgt_platform: tgtPlatform,
        src_category: srcCat, tgt_category: tgtCat, edges,
      });
      toast(`Сохранено ${edges.length} связей`, "success");
      onSaved(res.data.edges ?? edges);
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? "Ошибка сохранения", "error");
    } finally { setSaving(false); }
  };

  const filteredSrc = srcAttrs.filter(a => !searchQ || a.name.toLowerCase().includes(searchQ.toLowerCase()));
  const assignedCount = Object.values(assignments).filter(Boolean).length;

  if (loadingAttrs) return (
    <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
      <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
      <p style={{ marginTop: 12, fontSize: 13 }}>Загружаем атрибуты...</p>
    </div>
  );

  const srcColor = platformColor(srcPlatform);
  const tgtColor = platformColor(tgtPlatform);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link2 size={15} color="#a855f7" />
          <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
            Ручная настройка: {assignedCount} / {srcAttrs.length} атрибутов назначено
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", width: 200 }}>
            <Search size={12} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
            <input style={{ ...S.input, paddingLeft: 28, fontSize: 12 }} placeholder={`Фильтр ${platformLabel(srcPlatform)} атрибутов...`} value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          </div>
          <button style={{ ...S.btnPrimary, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={14} />}
            {saving ? "Сохраняю..." : "Сохранить"}
          </button>
        </div>
      </div>
      <div style={{ ...S.card, overflow: "visible" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr 36px", padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.06em", gap: 8 }}>
          <span style={{ color: srcColor }}>{platformLabel(srcPlatform)} атрибут</span><span/><span style={{ color: tgtColor }}>{platformLabel(tgtPlatform)} атрибут</span><span/>
        </div>
        {filteredSrc.map(src => {
          const tgtId = assignments[src.id] ?? null;
          const tgtAttr = tgtId ? tgtById[tgtId] : null;
          const isOpen = openDropdown === src.id;
          const filteredTgt = tgtAttrs.filter(a => !dropdownQ || a.name.toLowerCase().includes(dropdownQ.toLowerCase()));
          return (
            <div key={src.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", position: "relative" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr 36px", padding: "10px 16px", alignItems: "center", gap: 8 }}>
                <div>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{src.name}</span>
                  {src.is_required && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.12)", padding: "1px 5px", borderRadius: 3 }}>REQ</span>}
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", display: "block" }}>ID:{src.id}</span>
                </div>
                <ArrowLeftRight size={14} color="rgba(255,255,255,0.2)" />
                <div onClick={() => { setOpenDropdown(isOpen ? null : src.id); setDropdownQ(""); }} style={{ cursor: "pointer", padding: "7px 10px", borderRadius: 8, border: `1px solid ${tgtAttr ? "rgba(167,139,250,0.4)" : "rgba(255,255,255,0.1)"}`, background: tgtAttr ? "rgba(167,139,250,0.08)" : "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  {tgtAttr ? (
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <span style={{ fontSize: 12, color: "#c4b5fd", fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tgtAttr.name}</span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{tgtAttr.valueTypeCode ?? tgtAttr.type ?? ""}{(tgtAttr.dictionary_options?.length ?? 0) > 0 && ` · 📋 ${tgtAttr.dictionary_options!.length}`}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", fontStyle: "italic" }}>Выберите атрибут {platformLabel(tgtPlatform)}...</span>
                  )}
                  <ChevronRight size={12} color="rgba(255,255,255,0.3)" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  {tgtAttr && <button onClick={e => { e.stopPropagation(); assign(src.id, null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 4, borderRadius: 4 }}><X size={14} /></button>}
                </div>
              </div>
              {isOpen && (
                <div style={{ position: "absolute", left: "calc(50% + 20px)", top: "100%", zIndex: 100, width: "42%", maxHeight: 280, overflowY: "auto", background: "#1e1e2e", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                  <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", position: "sticky", top: 0, background: "#1e1e2e" }}>
                    <div style={{ position: "relative" }}>
                      <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
                      <input autoFocus style={{ ...S.input, paddingLeft: 26, fontSize: 12, padding: "6px 8px 6px 26px" }} placeholder={`Поиск по ${platformLabel(tgtPlatform)} атрибутам...`} value={dropdownQ} onChange={e => { e.stopPropagation(); setDropdownQ(e.target.value); }} onClick={e => e.stopPropagation()} />
                    </div>
                  </div>
                  <div onClick={() => assign(src.id, null)} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.3)", fontStyle: "italic", borderBottom: "1px solid rgba(255,255,255,0.05)" }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>— не привязывать</div>
                  {filteredTgt.map(tgt => (
                    <div key={tgt.id} onClick={() => assign(src.id, tgt.id)} style={{ padding: "8px 12px", cursor: "pointer", background: tgtId === tgt.id ? "rgba(167,139,250,0.12)" : "transparent", borderLeft: `2px solid ${tgtId === tgt.id ? "#a855f7" : "transparent"}` }} onMouseEnter={e => { if (tgtId !== tgt.id) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }} onMouseLeave={e => { if (tgtId !== tgt.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                      <div style={{ fontSize: 12, color: tgtId === tgt.id ? "#c4b5fd" : "rgba(255,255,255,0.8)", fontWeight: tgtId === tgt.id ? 600 : 400 }}>{tgt.name}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{tgt.valueTypeCode ?? tgt.type ?? ""}{tgt.is_required && <span style={{ color: "#f87171", marginLeft: 6 }}>обяз.</span>}{(tgt.dictionary_options?.length ?? 0) > 0 && <span style={{ marginLeft: 6 }}>📋 {tgt.dictionary_options!.length}</span>}</div>
                    </div>
                  ))}
                  {filteredTgt.length === 0 && <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.2)" }}>Ничего не найдено</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Mapping Result ────────────────────────────────────────────────────────────

function MappingResult({ edges, srcPlatform, tgtPlatform, unmatchedSrc = [] }: {
  edges: MapEdge[]; srcPlatform: string; tgtPlatform: string;
  unmatchedSrc?: { id: string; name: string; is_required: boolean }[];
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const srcColor = platformColor(srcPlatform);
  const tgtColor = platformColor(tgtPlatform);

  const filtered = edges.filter(e => !searchQ || e.from_name.toLowerCase().includes(searchQ.toLowerCase()) || e.to_name.toLowerCase().includes(searchQ.toLowerCase()));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link2 size={15} color="#a855f7" />
          <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>Найдено {edges.length} связей</span>
        </div>
        <div style={{ position: "relative", width: 220 }}>
          <Search size={12} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
          <input style={{ ...S.input, paddingLeft: 28, fontSize: 12 }} placeholder="Фильтр по атрибуту..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        </div>
      </div>
      <div style={{ ...S.card, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr 60px 50px", padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.06em", gap: 8 }}>
          <span style={{ color: srcColor }}>{platformLabel(srcPlatform)} атрибут</span><span/><span style={{ color: tgtColor }}>{platformLabel(tgtPlatform)} атрибут</span><span>Тип</span><span>%</span>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>Нет совпадений</div>
        ) : filtered.map((edge, i) => {
          const isExpanded = expandedIdx === i;
          const hasDicts = (edge.mm_dictionary?.length ?? 0) > 0;
          const hasValueMap = (edge.value_mappings?.length ?? 0) > 0;
          return (
            <div key={i}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr 60px 50px", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", alignItems: "center", gap: 8, background: isExpanded ? "rgba(99,102,241,0.06)" : "transparent", cursor: hasDicts ? "pointer" : "default", transition: "background 0.12s" }} onClick={() => hasDicts && setExpandedIdx(isExpanded ? null : i)} onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; }} onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <div>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{edge.from_name}</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", display: "block" }}>ID:{edge.from_attribute_id}</span>
                </div>
                <ArrowLeftRight size={14} color="rgba(255,255,255,0.2)" />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{edge.to_name}</span>
                    {edge.mm_is_required && <span style={{ fontSize: 9, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.12)", padding: "1px 5px", borderRadius: 3 }}>REQ</span>}
                    {hasDicts && <span style={{ fontSize: 9, fontWeight: 700, color: "#a78bfa", background: "rgba(167,139,250,0.12)", padding: "1px 5px", borderRadius: 3 }}>📋 {edge.mm_dictionary!.length}</span>}
                  </div>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", display: "block" }}>{edge.mm_type || ""}{edge.mm_is_suggest === false ? " · только словарь" : edge.mm_is_suggest === true ? " · словарь+своё" : ""}</span>
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{edge.method}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.07)" }}>
                    <div style={{ width: `${Math.round(edge.score * 100)}%`, height: "100%", borderRadius: 2, background: S.scoreColor(edge.score) }} />
                  </div>
                  <span style={{ fontSize: 11, color: S.scoreColor(edge.score), fontWeight: 700, minWidth: 28 }}>{Math.round(edge.score * 100)}%</span>
                </div>
              </div>
              {isExpanded && hasDicts && (
                <div style={{ padding: "12px 16px 16px", background: "rgba(99,102,241,0.04)", borderBottom: "1px solid rgba(99,102,241,0.12)" }}>
                  {hasValueMap && (
                    <div style={{ marginBottom: 14 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Сопоставление значений (AI)</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {edge.value_mappings!.map((vm, vi) => (
                          <div key={vi} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                            <span style={{ color: "rgba(255,255,255,0.6)", minWidth: 120 }}>{vm.oz_value}</span>
                            <ArrowLeftRight size={12} color="rgba(255,255,255,0.2)" />
                            <span style={{ color: "#c4b5fd", background: "rgba(167,139,250,0.1)", padding: "2px 8px", borderRadius: 4 }}>{vm.mm_name}</span>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>id:{vm.mm_id}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Словарь ({edge.mm_dictionary!.length} значений){edge.mm_is_suggest === false && <span style={{ marginLeft: 8, color: "#f87171" }}>— только из этого списка</span>}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {edge.mm_dictionary!.slice(0, 40).map((opt, oi) => (
                      <span key={oi} style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 4 }}>{opt.name}</span>
                    ))}
                    {edge.mm_dictionary!.length > 40 && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>+{edge.mm_dictionary!.length - 40} ещё</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {unmatchedSrc.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <AlertCircle size={14} color="#f59e0b" />
            <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>
              Не найдено совпадений: {unmatchedSrc.length} атрибутов {platformLabel(srcPlatform)}
            </span>
          </div>
          <div style={{ ...S.card, padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unmatchedSrc.map(a => (
              <span key={a.id} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, background: a.is_required ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.04)", color: a.is_required ? "#fca5a5" : "rgba(255,255,255,0.35)", border: `1px solid ${a.is_required ? "rgba(248,113,113,0.2)" : "rgba(255,255,255,0.07)"}` }}>
                {a.name}{a.is_required && <span style={{ marginLeft: 4, color: "#f87171" }}>*</span>}
              </span>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 6 }}>Переключись на «Ручную настройку» чтобы задать связи вручную</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AttributeStarMapPage() {
  const { toast } = useToast();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [srcPlatform, setSrcPlatform] = useState("ozon");
  const [tgtPlatform, setTgtPlatform] = useState("megamarket");
  const [srcCat, setSrcCat] = useState<Category | null>(null);
  const [tgtCat, setTgtCat] = useState<Category | null>(null);
  const [mapping, setMapping] = useState(false);
  const [autoBuilding, setAutoBuilding] = useState(false);
  const [autoBuildStatus, setAutoBuildStatus] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const autoBuildPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [edges, setEdges] = useState<MapEdge[] | null>(null);
  const [unmatchedSrc, setUnmatchedSrc] = useState<{ id: string; name: string; is_required: boolean }[]>([]);
  const [mappedPair, setMappedPair] = useState<{ src: Category; tgt: Category; srcP: string; tgtP: string } | null>(null);
  const [viewMode, setViewMode] = useState<"ai" | "manual">("ai");
  const [snapStats, setSnapStats] = useState<any>(null);
  const [activePlatforms, setActivePlatforms] = useState<string[]>(["ozon", "megamarket"]);

  useEffect(() => {
    api.get("/connections")
      .then(r => {
        const conns: Connection[] = Array.isArray(r.data) ? r.data : (r.data?.connections ?? []);
        setConnections(conns);
        const types = [...new Set<string>(conns.map(c => c.type?.toLowerCase()).filter(Boolean))];
        setActivePlatforms(types.length >= 2 ? types : ["ozon", "megamarket"]);
        if (types.length >= 1 && !types.includes(srcPlatform)) setSrcPlatform(types[0]);
        if (types.length >= 2 && !types.includes(tgtPlatform)) setTgtPlatform(types[1]);
      })
      .catch(() => {});
    api.get("/attribute-star-map/state?edge_limit=0")
      .then(r => setSnapStats(r.data.stats))
      .catch(() => {});
  }, []);

  // When src changes, tgt should not equal src
  useEffect(() => {
    if (srcPlatform === tgtPlatform) {
      const other = activePlatforms.find(p => p !== srcPlatform);
      if (other) setTgtPlatform(other);
    }
    setSrcCat(null); setEdges(null);
  }, [srcPlatform]);

  useEffect(() => {
    if (tgtPlatform === srcPlatform) {
      const other = activePlatforms.find(p => p !== tgtPlatform);
      if (other) setSrcPlatform(other);
    }
    setTgtCat(null); setEdges(null);
  }, [tgtPlatform]);

  // Restore active task on mount
  useEffect(() => {
    api.get("/attribute-star-map/active-task")
      .then(r => {
        const d: BuildStatus = r.data?.task ?? r.data;
        if (d?.task_id && (d.status === "running" || d.status === "building" || d.status === "queued")) {
          setBuildStatus(d); setAutoBuilding(true);
          setAutoBuildStatus(`${d.stage}: ${d.message} (${d.progress_percent}%)`);
          const taskId = d.task_id;
          const poll = setInterval(async () => {
            try {
              const st = await api.get(`/attribute-star-map/build/status?task_id=${taskId}`);
              const sd = st.data;
              setBuildStatus(sd); setAutoBuildStatus(`${sd.stage}: ${sd.message} (${sd.progress_percent}%)`);
              if (sd.status === "done" || sd.status === "error") {
                clearInterval(poll);
                setTimeout(() => { setAutoBuilding(false); setBuildStatus(null); }, 3000);
                if (sd.status === "done") api.get("/attribute-star-map/state?edge_limit=0").then(r => setSnapStats(r.data.stats)).catch(() => {});
              }
            } catch { clearInterval(poll); setAutoBuilding(false); setBuildStatus(null); }
          }, 2500);
        }
      })
      .catch(() => {});
  }, []);

  const runMapping = async () => {
    if (!srcCat || !tgtCat) { toast("Выберите категории с обеих сторон", "error"); return; }
    setMapping(true); setEdges(null); setUnmatchedSrc([]);
    try {
      const res = await api.post("/mp/category/map", {
        src_platform: srcPlatform, tgt_platform: tgtPlatform,
        src_category: srcCat, tgt_category: tgtCat,
      });
      setEdges(res.data.edges ?? []);
      setUnmatchedSrc(res.data.unmatched_src ?? res.data.unmatched_ozon ?? []);
      setMappedPair({ src: srcCat, tgt: tgtCat, srcP: srcPlatform, tgtP: tgtPlatform });
      toast(`Готово: ${res.data.edges_built} связей`, "success");
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? "Ошибка маппинга", "error");
    } finally { setMapping(false); }
  };

  const runAutoMap = async () => {
    setAutoBuilding(true); setAutoBuildStatus("Запускаем...");
    try {
      const res = await api.post("/attribute-star-map/build-from-products");
      const taskId = res.data.task_id;
      setBuildStatus({ task_id: taskId, status: "queued", stage: "queued", progress_percent: 0, message: "Запускаем..." });
      autoBuildPollRef.current = setInterval(async () => {
        try {
          const st = await api.get(`/attribute-star-map/build/status?task_id=${taskId}`);
          const d = st.data;
          setBuildStatus(d); setAutoBuildStatus(`${d.stage}: ${d.message} (${d.progress_percent}%)`);
          if (d.status === "done" || d.status === "error") {
            clearInterval(autoBuildPollRef.current!);
            if (d.status === "done") {
              toast(d.message, "success");
              setBuildStatus({ ...d, progress_percent: 100 });
              setTimeout(() => { setAutoBuilding(false); setBuildStatus(null); setAutoBuildStatus(null); }, 4000);
              api.get("/attribute-star-map/state?edge_limit=0").then(r => setSnapStats(r.data.stats)).catch(() => {});
            } else {
              setAutoBuilding(false); setBuildStatus(null);
              toast(`Ошибка: ${d.error}`, "error"); setAutoBuildStatus(`Ошибка: ${d.error}`);
            }
          }
        } catch { clearInterval(autoBuildPollRef.current!); setAutoBuilding(false); }
      }, 2500);
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? "Ошибка запуска", "error");
      setAutoBuilding(false); setAutoBuildStatus(null);
    }
  };

  React.useEffect(() => () => { if (autoBuildPollRef.current) clearInterval(autoBuildPollRef.current); }, []);

  const srcColor = platformColor(srcPlatform);
  const tgtColor = platformColor(tgtPlatform);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>

      {autoBuilding && buildStatus && (
        <div style={{ marginBottom: 24 }}>
          <NeuralMapLoader status={buildStatus} platforms={activePlatforms} />
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "rgba(255,255,255,0.95)", margin: 0 }}>Маппинг категорий</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: "4px 0 0" }}>
            AI построит карту атрибутов между выбранными маркетплейсами
          </p>
        </div>
        {snapStats && (
          <div style={{ display: "flex", gap: 12 }}>
            {[{ label: "Связей", value: snapStats.edges_total }].map(s => (
              <div key={s.label} style={{ ...S.card, padding: "10px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#a5b4fc" }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <button style={{ ...S.btnPrimary, opacity: autoBuilding ? 0.7 : 1 }} onClick={runAutoMap} disabled={autoBuilding}>
            {autoBuilding ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={15} />}
            {autoBuilding ? "Строю карту..." : "Автосборка по товарам"}
          </button>
          {autoBuildStatus && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", maxWidth: 280, textAlign: "right" }}>{autoBuildStatus}</span>}
        </div>
      </div>

      {/* Platform selectors */}
      <div style={{ ...S.card, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 20 }}>
        <PlatformSelector label="Источник" value={srcPlatform} onChange={setSrcPlatform} connections={connections} exclude={tgtPlatform} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${srcColor}44, ${tgtColor}44)` }} />
          <button
            onClick={() => { const tmp = srcPlatform; setSrcPlatform(tgtPlatform); setTgtPlatform(tmp); setSrcCat(null); setTgtCat(null); setEdges(null); }}
            style={{ ...S.btnGhost, padding: "5px 10px", flexShrink: 0 }}
            title="Поменять местами"
          >
            <ArrowLeftRight size={14} />
          </button>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${srcColor}44, ${tgtColor}44)` }} />
        </div>
        <PlatformSelector label="Цель" value={tgtPlatform} onChange={setTgtPlatform} connections={connections} exclude={srcPlatform} />
      </div>

      {/* Category selectors */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", gridTemplateRows: "500px", gap: 16, marginBottom: 16, alignItems: "stretch" }}>
        <CategoryPanel platform={srcPlatform} selected={srcCat} onSelect={setSrcCat} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 60 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeftRight size={20} color="rgba(255,255,255,0.3)" />
          </div>
          <button
            style={{ ...S.btnPrimary, flexDirection: "column", gap: 4, padding: "12px 16px", opacity: (!srcCat || !tgtCat || mapping) ? 0.5 : 1, fontSize: 12, textAlign: "center" }}
            onClick={runMapping}
            disabled={!srcCat || !tgtCat || mapping}
          >
            {mapping ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={18} />}
            {mapping ? "Строю..." : "Сопоставить"}
          </button>
        </div>
        <CategoryPanel platform={tgtPlatform} selected={tgtCat} onSelect={setTgtCat} />
      </div>

      {/* Attribute previews */}
      {(srcCat || tgtCat) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", gap: 16, marginBottom: 20 }}>
          <div>{srcCat ? <AttrPreview platform={srcPlatform} category={srcCat} /> : <div />}</div>
          <div />
          <div>{tgtCat ? <AttrPreview platform={tgtPlatform} category={tgtCat} /> : <div />}</div>
        </div>
      )}

      {mapping && (
        <div style={{ ...S.card, padding: 40, textAlign: "center" }}>
          <Loader2 size={32} style={{ animation: "spin 1s linear infinite", color: "#a5b4fc", marginBottom: 16 }} />
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, margin: 0 }}>AI анализирует атрибуты и словари...</p>
        </div>
      )}

      {edges && mappedPair && !mapping && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {(["ai", "manual"] as const).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{ padding: "7px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", background: viewMode === mode ? "linear-gradient(135deg,#6366f1,#a855f7)" : "rgba(255,255,255,0.06)", color: viewMode === mode ? "#fff" : "rgba(255,255,255,0.45)" }}>
                {mode === "ai" ? "AI результат" : "Ручная настройка"}
              </button>
            ))}
          </div>
          {viewMode === "ai"
            ? <MappingResult edges={edges} srcPlatform={mappedPair.srcP} tgtPlatform={mappedPair.tgtP} unmatchedSrc={unmatchedSrc} />
            : <ManualMapper srcPlatform={mappedPair.srcP} tgtPlatform={mappedPair.tgtP} srcCat={mappedPair.src} tgtCat={mappedPair.tgt} initialEdges={edges} onSaved={(newEdges) => { setEdges(newEdges); setViewMode("ai"); }} />
          }
        </div>
      )}

      {!edges && !mapping && !srcCat && !tgtCat && (
        <div style={{ ...S.card, padding: "48px 24px", textAlign: "center" }}>
          <Link2 size={32} color="rgba(255,255,255,0.1)" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.3)", margin: 0 }}>
            Выберите платформы и категории для построения карты атрибутов
          </p>
        </div>
      )}
    </div>
  );
}
