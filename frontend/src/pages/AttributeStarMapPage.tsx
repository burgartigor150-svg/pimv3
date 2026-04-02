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
  Sparkles, AlertCircle, RefreshCw, Link2, BookOpen, X,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Category { id: string; name: string; }

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
  label: {
    fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)",
    textTransform: "uppercase" as const, letterSpacing: "0.07em",
    display: "block", marginBottom: 6,
  },
  scoreColor: (s: number) => s >= 0.85 ? "#10b981" : s >= 0.6 ? "#f59e0b" : "#f87171",
};

// ─── Category Search Panel ────────────────────────────────────────────────────

function CategoryPanel({
  platform, label, color, selected, onSelect,
}: {
  platform: "ozon" | "megamarket"; label: string; color: string;
  selected: Category | null; onSelect: (c: Category) => void;
}) {
  const [q, setQ] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/mp/categories?platform=${platform}&q=${encodeURIComponent(query)}`);
      setCats(res.data.categories ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [platform]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, search]);

  // Load on mount
  useEffect(() => { search(""); }, [search]);

  return (
    <div style={{ ...S.card, display: "flex", flexDirection: "column", minHeight: 520 }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>{label}</span>
          {selected && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: color + "22", color, fontWeight: 600, marginLeft: "auto", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selected.name.split("->").pop()?.trim() ?? selected.name}
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

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
          </div>
        ) : cats.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.2)" }}>
            {q ? "Ничего не найдено" : "Введите запрос"}
          </div>
        ) : (
          cats.map(cat => (
            <div
              key={cat.id}
              onClick={() => onSelect(cat)}
              style={{
                padding: "9px 16px", cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)",
                background: selected?.id === cat.id ? color + "18" : "transparent",
                borderLeft: `3px solid ${selected?.id === cat.id ? color : "transparent"}`,
                transition: "background 0.12s",
              }}
              onMouseEnter={e => { if (selected?.id !== cat.id) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
              onMouseLeave={e => { if (selected?.id !== cat.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <div style={{ flex: 1, overflow: "hidden" }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", lineHeight: 1.4 }}>
                  {(cat.name.split("->").pop() ?? cat.name).trim()}
                </span>
                {cat.name.includes("->") && (
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                    {cat.name.split("->").slice(0, -1).map(s => s.trim()).join(" / ")}
                  </span>
                )}
              </div>
              <ChevronRight size={12} color="rgba(255,255,255,0.2)" style={{ flexShrink: 0, marginLeft: 6 }} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Attribute Preview ────────────────────────────────────────────────────────

function AttrPreview({ platform, category }: { platform: "ozon" | "megamarket"; category: Category }) {
  const [attrs, setAttrs] = useState<MpAttr[]>([]);
  const [loading, setLoading] = useState(false);
  const color = platform === "ozon" ? "#005bff" : "#ff9900";

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
            <span
              key={a.id}
              style={{
                fontSize: 11, padding: "3px 8px", borderRadius: 6,
                background: a.is_required ? "rgba(248,113,113,0.12)" : "rgba(255,255,255,0.06)",
                color: a.is_required ? "#fca5a5" : "rgba(255,255,255,0.5)",
                border: `1px solid ${a.is_required ? "rgba(248,113,113,0.25)" : "transparent"}`,
              }}
            >
              {a.name}
              {(a.dictionary_options?.length ?? 0) > 0 && (
                <span style={{ marginLeft: 4, opacity: 0.5 }}>📋</span>
              )}
            </span>
          ))}
          {attrs.length > 30 && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>+{attrs.length - 30}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Mapping Result ────────────────────────────────────────────────────────────

function MappingResult({ edges, ozonCat, mmCat }: { edges: MapEdge[]; ozonCat: Category; mmCat: Category }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState("");

  const filtered = edges.filter(e =>
    !searchQ || e.from_name.toLowerCase().includes(searchQ.toLowerCase()) ||
    e.to_name.toLowerCase().includes(searchQ.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link2 size={15} color="#a855f7" />
          <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
            Найдено {edges.length} связей
          </span>
        </div>
        <div style={{ position: "relative", width: 220 }}>
          <Search size={12} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
          <input
            style={{ ...S.input, paddingLeft: 28, fontSize: 12 }}
            placeholder="Фильтр по атрибуту..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
        </div>
      </div>

      <div style={{ ...S.card, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr 60px 50px", padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 }}>
          <span>Ozon атрибут</span><span/><span>Megamarket атрибут</span><span>Тип</span><span>%</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>Нет совпадений</div>
        ) : filtered.map((edge, i) => {
          const isExpanded = expandedIdx === i;
          const hasDicts = (edge.mm_dictionary?.length ?? 0) > 0;
          const hasValueMap = (edge.value_mappings?.length ?? 0) > 0;

          return (
            <div key={i}>
              <div
                style={{
                  display: "grid", gridTemplateColumns: "1fr 24px 1fr 60px 50px",
                  padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                  alignItems: "center", gap: 8,
                  background: isExpanded ? "rgba(99,102,241,0.06)" : "transparent",
                  cursor: hasDicts ? "pointer" : "default",
                  transition: "background 0.12s",
                }}
                onClick={() => hasDicts && setExpandedIdx(isExpanded ? null : i)}
                onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; }}
                onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{edge.from_name}</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", display: "block" }}>ID:{edge.from_attribute_id}</span>
                </div>
                <ArrowLeftRight size={14} color="rgba(255,255,255,0.2)" />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{edge.to_name}</span>
                    {edge.mm_is_required && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.12)", padding: "1px 5px", borderRadius: 3 }}>REQ</span>
                    )}
                    {hasDicts && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#a78bfa", background: "rgba(167,139,250,0.12)", padding: "1px 5px", borderRadius: 3 }}>
                        📋 {edge.mm_dictionary!.length}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", display: "block" }}>
                    {edge.mm_type || ""}
                    {edge.mm_is_suggest === false ? " · только словарь" : edge.mm_is_suggest === true ? " · словарь+своё" : ""}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{edge.method}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.07)" }}>
                    <div style={{ width: `${Math.round(edge.score * 100)}%`, height: "100%", borderRadius: 2, background: S.scoreColor(edge.score) }} />
                  </div>
                  <span style={{ fontSize: 11, color: S.scoreColor(edge.score), fontWeight: 700, minWidth: 28 }}>{Math.round(edge.score * 100)}%</span>
                </div>
              </div>

              {/* Expanded: value mappings + full dictionary */}
              {isExpanded && hasDicts && (
                <div style={{ padding: "12px 16px 16px", background: "rgba(99,102,241,0.04)", borderBottom: "1px solid rgba(99,102,241,0.12)" }}>
                  {hasValueMap && (
                    <div style={{ marginBottom: 14 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Сопоставление значений (AI)
                      </p>
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
                  <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Словарь MM ({edge.mm_dictionary!.length} значений)
                    {edge.mm_is_suggest === false && <span style={{ marginLeft: 8, color: "#f87171" }}>— только из этого списка</span>}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {edge.mm_dictionary!.slice(0, 40).map((opt, oi) => (
                      <span key={oi} style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 4 }}>
                        {opt.name}
                      </span>
                    ))}
                    {edge.mm_dictionary!.length > 40 && (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>+{edge.mm_dictionary!.length - 40} ещё</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AttributeStarMapPage() {
  const { toast } = useToast();

  const [ozonCat, setOzonCat] = useState<Category | null>(null);
  const [mmCat, setMmCat] = useState<Category | null>(null);
  const [mapping, setMapping] = useState(false);
  const [autoBuilding, setAutoBuilding] = useState(false);
  const [autoBuildStatus, setAutoBuildStatus] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const autoBuildPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [edges, setEdges] = useState<MapEdge[] | null>(null);
  const [mappedPair, setMappedPair] = useState<{ ozon: Category; mm: Category } | null>(null);

  // Stats from snapshot
  const [snapStats, setSnapStats] = useState<any>(null);
  useEffect(() => {
    api.get("/attribute-star-map/state?edge_limit=0")
      .then(r => setSnapStats(r.data.stats))
      .catch(() => {});
  }, [edges]);

  // Restore active task on mount
  useEffect(() => {
    api.get("/attribute-star-map/active-task")
      .then(r => {
        const d: BuildStatus = r.data?.task ?? r.data;
        if (d?.task_id && (d.status === "running" || d.status === "building" || d.status === "queued")) {
          setBuildStatus(d);
          setAutoBuilding(true);
          setAutoBuildStatus(`${d.stage}: ${d.message} (${d.progress_percent}%)`);
          // Resume polling
          const taskId = d.task_id;
          const poll = setInterval(async () => {
            try {
              const st = await api.get(`/attribute-star-map/build/status?task_id=${taskId}`);
              const sd = st.data;
              setBuildStatus(sd);
              setAutoBuildStatus(`${sd.stage}: ${sd.message} (${sd.progress_percent}%)`);
              if (sd.status === "done" || sd.status === "error") {
                clearInterval(poll);
                setTimeout(() => { setAutoBuilding(false); setBuildStatus(null); }, 3000);
                if (sd.status === "done") {
                  api.get("/attribute-star-map/state?edge_limit=0").then(r => setSnapStats(r.data.stats)).catch(() => {});
                }
              }
            } catch { clearInterval(poll); setAutoBuilding(false); setBuildStatus(null); }
          }, 2500);
        }
      })
      .catch(() => {});
  }, []);

  const runMapping = async () => {
    if (!ozonCat || !mmCat) {
      toast("Выберите категории с обеих сторон", "error");
      return;
    }
    setMapping(true);
    setEdges(null);
    try {
      const res = await api.post("/mp/category/map", {
        ozon_category: ozonCat,
        megamarket_category: mmCat,
      });
      setEdges(res.data.edges ?? []);
      setMappedPair({ ozon: ozonCat, mm: mmCat });
      toast(`Готово: ${res.data.edges_built} связей`, "success");
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? "Ошибка маппинга", "error");
    } finally {
      setMapping(false);
    }
  };

  const runAutoMap = async () => {
    setAutoBuilding(true);
    setAutoBuildStatus("Запускаем...");
    try {
      const res = await api.post("/attribute-star-map/build-from-products");
      const taskId = res.data.task_id;
      setBuildStatus({ task_id: taskId, status: "queued", stage: "queued", progress_percent: 0, message: "Запускаем..." });
      autoBuildPollRef.current = setInterval(async () => {
        try {
          const st = await api.get(`/attribute-star-map/build/status?task_id=${taskId}`);
          const d = st.data;
          setBuildStatus(d);
          setAutoBuildStatus(`${d.stage}: ${d.message} (${d.progress_percent}%)`);
          if (d.status === "done" || d.status === "error") {
            clearInterval(autoBuildPollRef.current!);
            if (d.status === "done") {
              toast(d.message, "success");
              setBuildStatus({ ...d, progress_percent: 100 });
              setTimeout(() => { setAutoBuilding(false); setBuildStatus(null); setAutoBuildStatus(null); }, 4000);
              // refresh stats
              api.get("/attribute-star-map/state?edge_limit=0").then(r => setSnapStats(r.data.stats)).catch(() => {});
            } else {
              setAutoBuilding(false);
              setBuildStatus(null);
              toast(`Ошибка: ${d.error}`, "error");
              setAutoBuildStatus(`Ошибка: ${d.error}`);
            }
          }
        } catch { clearInterval(autoBuildPollRef.current!); setAutoBuilding(false); }
      }, 2500);
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? "Ошибка запуска", "error");
      setAutoBuilding(false);
      setAutoBuildStatus(null);
    }
  };

  React.useEffect(() => () => { if (autoBuildPollRef.current) clearInterval(autoBuildPollRef.current); }, []);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>

      {/* Neural Map Loader */}
      {autoBuilding && buildStatus && (
        <div style={{ marginBottom: 24 }}>
          <NeuralMapLoader status={buildStatus} />
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "rgba(255,255,255,0.95)", margin: 0 }}>
            Маппинг категорий
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: "4px 0 0" }}>
            Выберите категорию Ozon и Megamarket — AI построит карту атрибутов с учётом словарей
          </p>
        </div>
        {snapStats && (
          <div style={{ display: "flex", gap: 12 }}>
            {[
              { label: "Категорий Ozon", value: snapStats.ozon_categories },
              { label: "Категорий MM", value: snapStats.megamarket_categories },
              { label: "Связей", value: snapStats.edges_total },
            ].map(s => (
              <div key={s.label} style={{ ...S.card, padding: "10px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#a5b4fc" }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
        {/* Auto-build button */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <button
            style={{ ...S.btnPrimary, opacity: autoBuilding ? 0.7 : 1 }}
            onClick={runAutoMap}
            disabled={autoBuilding}
          >
            {autoBuilding
              ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
              : <Sparkles size={15} />}
            {autoBuilding ? "Строю карту..." : "Автосборка по товарам"}
          </button>
          {autoBuildStatus && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", maxWidth: 280, textAlign: "right" }}>
              {autoBuildStatus}
            </span>
          )}
        </div>
      </div>

      {/* Category selectors */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", gap: 16, marginBottom: 16, alignItems: "start" }}>
        <CategoryPanel
          platform="ozon" label="Ozon" color="#005bff"
          selected={ozonCat} onSelect={setOzonCat}
        />

        {/* Middle action */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 60 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeftRight size={20} color="rgba(255,255,255,0.3)" />
          </div>
          <button
            style={{
              ...S.btnPrimary,
              flexDirection: "column", gap: 4, padding: "12px 16px",
              opacity: (!ozonCat || !mmCat || mapping) ? 0.5 : 1,
              fontSize: 12, textAlign: "center",
            }}
            onClick={runMapping}
            disabled={!ozonCat || !mmCat || mapping}
          >
            {mapping
              ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
              : <Sparkles size={18} />
            }
            {mapping ? "Строю..." : "Сопоставить"}
          </button>
        </div>

        <CategoryPanel
          platform="megamarket" label="Megamarket" color="#ff9900"
          selected={mmCat} onSelect={setMmCat}
        />
      </div>

      {/* Attribute previews when categories selected */}
      {(ozonCat || mmCat) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", gap: 16, marginBottom: 20 }}>
          <div>{ozonCat ? <AttrPreview platform="ozon" category={ozonCat} /> : <div />}</div>
          <div />
          <div>{mmCat ? <AttrPreview platform="megamarket" category={mmCat} /> : <div />}</div>
        </div>
      )}

      {/* Result */}
      {mapping && (
        <div style={{ ...S.card, padding: 40, textAlign: "center" }}>
          <Loader2 size={32} style={{ animation: "spin 1s linear infinite", color: "#a5b4fc", marginBottom: 16 }} />
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, margin: 0 }}>
            AI анализирует атрибуты и словари...
          </p>
        </div>
      )}

      {edges && mappedPair && !mapping && (
        <MappingResult edges={edges} ozonCat={mappedPair.ozon} mmCat={mappedPair.mm} />
      )}

      {!edges && !mapping && !ozonCat && !mmCat && (
        <div style={{ ...S.card, padding: "48px 24px", textAlign: "center" }}>
          <Link2 size={32} color="rgba(255,255,255,0.1)" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.3)", margin: 0 }}>
            Выберите категорию Ozon и Megamarket для построения карты атрибутов
          </p>
        </div>
      )}
    </div>
  );
}
