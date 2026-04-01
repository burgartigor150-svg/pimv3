import React, { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import {
  Search, RefreshCw, Zap, Link2, GitBranch, ChevronRight,
  ChevronDown, X, Layers, Database, ArrowLeftRight, Plus,
  Check, AlertCircle, Loader2, BarChart3, Sparkles, Settings2,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface MapEdge {
  from_platform: string;
  from_category_id: string;
  from_attribute_id: string;
  from_name: string;
  to_platform: string;
  to_category_id: string;
  to_attribute_id: string;
  to_name: string;
  score: number;
  method: string;
}

interface MapStats {
  ozon_categories: number;
  megamarket_categories: number;
  ozon_attributes: number;
  megamarket_attributes: number;
  edges_total: number;
  manual_overrides_total: number;
}

interface MapState {
  snapshot_exists: boolean;
  generated_at_ts: number;
  stats: MapStats;
  edges_sample: MapEdge[];
  manual_overrides: any[];
}

interface Connection {
  id: string;
  name: string;
  type: string;
}

interface Category {
  id: string;
  name: string;
  parent_id?: string;
  attribute_count?: number;
}

interface MpAttribute {
  id: string;
  name: string;
  type?: string;
  is_required?: boolean;
  description?: string;
  values?: string[];
}

interface BuildStatus {
  status: string;
  stage: string;
  progress_percent: number;
  message: string;
  error?: string;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  overflow: "hidden",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "9px 12px",
  color: "rgba(255,255,255,0.85)",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 7,
  padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600,
  background: "linear-gradient(135deg,#6366f1,#a855f7)", color: "#fff",
  border: "none", cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 7,
  padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 500,
  background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)",
  border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer",
};

const scoreColor = (s: number) =>
  s >= 0.85 ? "#10b981" : s >= 0.6 ? "#f59e0b" : "#f87171";

const methodBadge = (m: string): React.CSSProperties => ({
  display: "inline-block", fontSize: 10, fontWeight: 700,
  padding: "2px 7px", borderRadius: 20, letterSpacing: "0.05em",
  background: m === "semantic" ? "rgba(99,102,241,0.2)" : m === "manual" ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.08)",
  color: m === "semantic" ? "#a5b4fc" : m === "manual" ? "#6ee7b7" : "rgba(255,255,255,0.4)",
});

// ─── Component ──────────────────────────────────────────────────────────────

export default function AttributeStarMapPage() {
  const { toast } = useToast();

  // State
  const [mapState, setMapState] = useState<MapState | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  // Build
  const [ozonConnId, setOzonConnId] = useState("");
  const [mmConnId, setMmConnId] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildTaskId, setBuildTaskId] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const buildPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Search/filter
  const [searchQ, setSearchQ] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"all" | "ozon" | "megamarket">("all");
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [edgeLimit, setEdgeLimit] = useState(100);

  // Category explorer
  const [activeTab, setActiveTab] = useState<"map" | "explorer" | "build">("map");
  const [explorerPlatform, setExplorerPlatform] = useState<"ozon" | "megamarket">("ozon");
  const [explorerCategoryQ, setExplorerCategoryQ] = useState("");
  const [explorerCategories, setExplorerCategories] = useState<Category[]>([]);
  const [explorerCatLoading, setExplorerCatLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categoryAttrs, setCategoryAttrs] = useState<MpAttribute[]>([]);
  const [catAttrsLoading, setCatAttrsLoading] = useState(false);

  // Manual link
  const [manualFrom, setManualFrom] = useState<MapEdge | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────

  const loadMapState = useCallback(async () => {
    try {
      const [stateRes, connRes] = await Promise.all([
        api.get<MapState>(`/attribute-star-map/state?edge_limit=${edgeLimit}`),
        api.get<Connection[]>("/connections"),
      ]);
      setMapState(stateRes.data);
      setEdges(stateRes.data.edges_sample ?? []);
      setConnections(connRes.data ?? []);

      // Auto-select connections
      const ozon = (connRes.data ?? []).find((c: Connection) => c.type === "ozon");
      const mm = (connRes.data ?? []).find((c: Connection) => c.type === "megamarket");
      if (ozon) setOzonConnId(ozon.id);
      if (mm) setMmConnId(mm.id);
    } catch {
      toast("Ошибка загрузки карты атрибутов", "error");
    } finally {
      setLoading(false);
    }
  }, [edgeLimit, toast]);

  useEffect(() => { loadMapState(); }, [loadMapState]);

  // ── Build ────────────────────────────────────────────────────────────────

  const startBuild = async () => {
    if (!ozonConnId || !mmConnId) {
      toast("Выберите подключения Ozon и Мегамаркет", "error");
      return;
    }
    setBuilding(true);
    setBuildStatus(null);
    try {
      const res = await api.post("/attribute-star-map/build", {
        ozon_connection_id: ozonConnId,
        megamarket_connection_id: mmConnId,
        max_ozon_categories: 50,
        max_megamarket_categories: 50,
        edge_threshold: 0.55,
      });
      const taskId = res.data.task_id;
      setBuildTaskId(taskId);
      toast("Сборка карты запущена", "success");

      buildPollRef.current = setInterval(async () => {
        try {
          const st = await api.get<BuildStatus>(`/attribute-star-map/build/status?task_id=${taskId}`);
          setBuildStatus(st.data);
          if (st.data.status === "done" || st.data.status === "error") {
            clearInterval(buildPollRef.current!);
            setBuilding(false);
            if (st.data.status === "done") {
              toast("Карта атрибутов построена!", "success");
              loadMapState();
            } else {
              toast(`Ошибка: ${st.data.error ?? "неизвестная ошибка"}`, "error");
            }
          }
        } catch {
          clearInterval(buildPollRef.current!);
          setBuilding(false);
        }
      }, 2000);
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? "Ошибка запуска сборки", "error");
      setBuilding(false);
    }
  };

  useEffect(() => () => { if (buildPollRef.current) clearInterval(buildPollRef.current); }, []);

  // ── Explorer ─────────────────────────────────────────────────────────────

  const loadExplorerCategories = useCallback(async () => {
    setExplorerCatLoading(true);
    try {
      const res = await api.get(`/attribute-star-map/categories?platform=${explorerPlatform}`);
      const raw = res.data;
      let cats: Category[] = Array.isArray(raw) ? raw : (raw?.categories ?? []);
      if (explorerCategoryQ.trim()) {
        const q = explorerCategoryQ.toLowerCase();
        cats = cats.filter((c: Category) => c.name.toLowerCase().includes(q));
      }
      setExplorerCategories(cats.slice(0, 200));
    } catch {
      toast("Ошибка загрузки категорий", "error");
    } finally {
      setExplorerCatLoading(false);
    }
  }, [explorerPlatform, explorerCategoryQ, toast]);

  useEffect(() => {
    if (activeTab === "explorer") loadExplorerCategories();
  }, [activeTab, explorerPlatform, loadExplorerCategories]);

  const loadCategoryAttrs = async (cat: Category) => {
    setSelectedCategory(cat);
    setCategoryAttrs([]);
    setCatAttrsLoading(true);
    try {
      const res = await api.get(
        `/attribute-star-map/category/attributes?platform=${explorerPlatform}&category_id=${cat.id}&limit=500`
      );
      const rawAttrs = res.data;
      setCategoryAttrs(Array.isArray(rawAttrs) ? rawAttrs : (rawAttrs?.attributes ?? []));
    } catch {
      toast("Ошибка загрузки атрибутов категории", "error");
    } finally {
      setCatAttrsLoading(false);
    }
  };

  // ── Filtered edges ────────────────────────────────────────────────────────

  const filteredEdges = edges.filter(e => {
    const matchPlatform = platformFilter === "all"
      || e.from_platform === platformFilter || e.to_platform === platformFilter;
    const matchQ = !searchQ.trim()
      || e.from_name.toLowerCase().includes(searchQ.toLowerCase())
      || e.to_name.toLowerCase().includes(searchQ.toLowerCase());
    return matchPlatform && matchQ;
  });

  // ── Manual vector ─────────────────────────────────────────────────────────

  const [manualFromName, setManualFromName] = useState("");
  const [manualToName, setManualToName] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  const saveManualLink = async () => {
    if (!manualFromName.trim() || !manualToName.trim()) return;
    setSavingManual(true);
    try {
      await api.post("/attribute-star-map/manual-vector", {
        from_name: manualFromName,
        to_name: manualToName,
        score: 1.0,
      });
      toast("Связь сохранена", "success");
      setManualFromName("");
      setManualToName("");
      loadMapState();
    } catch {
      toast("Ошибка сохранения", "error");
    } finally {
      setSavingManual(false);
    }
  };

  // ── Stat card ─────────────────────────────────────────────────────────────

  const StatCard = ({ label, value, icon: Icon, color }: any) => (
    <div style={{ ...card, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}22`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={20} color={color} />
      </div>
      <div>
        <p style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.95)", margin: 0, lineHeight: 1 }}>{value?.toLocaleString() ?? "—"}</p>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "4px 0 0" }}>{label}</p>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, gap: 12, color: "rgba(255,255,255,0.4)", fontSize: 14 }}>
      <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
      Загрузка карты атрибутов...
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const stats = mapState?.stats;

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.95)", margin: "0 0 6px" }}>
            ✦ Звёздная карта атрибутов
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: 0 }}>
            Центр сопоставления атрибутов маркетплейсов — Ozon, Мегамаркет и другие
            {mapState?.generated_at_ts
              ? ` · Обновлено ${new Date(mapState.generated_at_ts * 1000).toLocaleDateString("ru")}`
              : ""}
          </p>
        </div>
        <button style={btnGhost} onClick={loadMapState}>
          <RefreshCw size={14} />Обновить
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
          <StatCard label="Категорий Ozon" value={stats.ozon_categories} icon={Database} color="#6366f1" />
          <StatCard label="Категорий ММ" value={stats.megamarket_categories} icon={Database} color="#a855f7" />
          <StatCard label="Атрибутов Ozon" value={stats.ozon_attributes} icon={Layers} color="#22d3ee" />
          <StatCard label="Атрибутов ММ" value={stats.megamarket_attributes} icon={Layers} color="#f59e0b" />
          <StatCard label="Связей атрибутов" value={stats.edges_total} icon={Link2} color="#10b981" />
          <StatCard label="Ручных связей" value={stats.manual_overrides_total} icon={GitBranch} color="#f87171" />
        </div>
      )}

      {!mapState?.snapshot_exists && (
        <div style={{ ...card, padding: 24, marginBottom: 24, borderColor: "rgba(251,146,60,0.3)", background: "rgba(251,146,60,0.05)" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <AlertCircle size={20} color="#fb923c" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.9)", margin: "0 0 6px" }}>Карта ещё не построена</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                Перейдите на вкладку «Сборка» и запустите построение карты. Для этого нужны активные подключения к Ozon и Мегамаркет.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.07)", paddingBottom: 0 }}>
        {([
          ["map", "Карта связей", Link2],
          ["explorer", "Проводник атрибутов", Layers],
          ["build", "Сборка и настройки", Settings2],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: "none", border: "none", borderBottom: `2px solid ${activeTab === key ? "#6366f1" : "transparent"}`,
              color: activeTab === key ? "#a5b4fc" : "rgba(255,255,255,0.4)",
              transition: "all 0.2s", marginBottom: -1,
            }}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB: Map ── */}
      {activeTab === "map" && (
        <div>
          {/* Filters */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
              <input
                style={{ ...inputStyle, paddingLeft: 36 }}
                placeholder="Поиск по названию атрибута..."
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["all", "ozon", "megamarket"] as const).map(p => (
                <button key={p}
                  onClick={() => setPlatformFilter(p)}
                  style={{
                    ...btnGhost,
                    background: platformFilter === p ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.05)",
                    color: platformFilter === p ? "#a5b4fc" : "rgba(255,255,255,0.5)",
                    borderColor: platformFilter === p ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.08)",
                    fontSize: 12, padding: "7px 12px",
                  }}>
                  {p === "all" ? "Все" : p === "ozon" ? "Ozon" : "Мегамаркет"}
                </button>
              ))}
            </div>
            <select
              style={{ ...inputStyle, width: "auto" }}
              value={edgeLimit}
              onChange={e => setEdgeLimit(Number(e.target.value))}
            >
              {[50, 100, 300, 500].map(n => <option key={n} value={n}>{n} связей</option>)}
            </select>
          </div>

          {/* Edge table */}
          <div style={{ ...card }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr 70px 60px", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <span>Атрибут источника</span>
              <span>Платформа</span>
              <span>Атрибут назначения</span>
              <span>Метод</span>
              <span>Схожесть</span>
            </div>

            {filteredEdges.length === 0 ? (
              <div style={{ padding: "48px 24px", textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
                {searchQ ? "Ничего не найдено" : "Связи атрибутов не загружены"}
              </div>
            ) : (
              filteredEdges.map((edge, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid", gridTemplateColumns: "1fr 80px 1fr 70px 60px",
                    padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                    alignItems: "center", transition: "background 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <div>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", margin: 0, fontWeight: 500 }}>{edge.from_name}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "2px 0 0" }}>ID: {edge.from_attribute_id}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, padding: "3px 7px", borderRadius: 6, background: edge.from_platform === "ozon" ? "rgba(99,102,241,0.15)" : "rgba(168,85,247,0.15)", color: edge.from_platform === "ozon" ? "#818cf8" : "#c084fc", fontWeight: 600 }}>
                      {edge.from_platform === "ozon" ? "Ozon" : "ММ"}
                    </span>
                    <ArrowLeftRight size={12} color="rgba(255,255,255,0.2)" />
                  </div>
                  <div>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", margin: 0, fontWeight: 500 }}>{edge.to_name}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "2px 0 0" }}>ID: {edge.to_attribute_id}</p>
                  </div>
                  <span style={methodBadge(edge.method)}>{edge.method}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.07)" }}>
                      <div style={{ width: `${Math.round(edge.score * 100)}%`, height: "100%", borderRadius: 2, background: scoreColor(edge.score) }} />
                    </div>
                    <span style={{ fontSize: 11, color: scoreColor(edge.score), fontWeight: 600, minWidth: 30 }}>
                      {Math.round(edge.score * 100)}%
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Manual link */}
          <div style={{ ...card, padding: 20, marginTop: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.85)", margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <Plus size={15} />Добавить ручную связь
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6 }}>Атрибут источника (Ozon)</label>
                <input style={inputStyle} placeholder="Например: Высота" value={manualFromName} onChange={e => setManualFromName(e.target.value)} />
              </div>
              <ArrowLeftRight size={16} color="rgba(255,255,255,0.3)" style={{ marginBottom: 10 }} />
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6 }}>Атрибут назначения (ММ)</label>
                <input style={inputStyle} placeholder="Например: Высота изделия" value={manualToName} onChange={e => setManualToName(e.target.value)} />
              </div>
              <button style={{ ...btnPrimary, opacity: savingManual ? 0.7 : 1 }} onClick={saveManualLink} disabled={savingManual}>
                {savingManual ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={14} />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Explorer ── */}
      {activeTab === "explorer" && (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, minHeight: 600 }}>
          {/* Category list */}
          <div style={{ ...card, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {(["ozon", "megamarket"] as const).map(p => (
                  <button key={p}
                    onClick={() => { setExplorerPlatform(p); setSelectedCategory(null); setCategoryAttrs([]); }}
                    style={{
                      flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 600, borderRadius: 8,
                      border: "none", cursor: "pointer",
                      background: explorerPlatform === p ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.05)",
                      color: explorerPlatform === p ? "#a5b4fc" : "rgba(255,255,255,0.4)",
                    }}>
                    {p === "ozon" ? "Ozon" : "Мегамаркет"}
                  </button>
                ))}
              </div>
              <div style={{ position: "relative" }}>
                <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
                <input
                  style={{ ...inputStyle, paddingLeft: 32, fontSize: 12 }}
                  placeholder="Поиск категории..."
                  value={explorerCategoryQ}
                  onChange={e => setExplorerCategoryQ(e.target.value)}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {explorerCatLoading ? (
                <div style={{ padding: 20, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
                  <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                </div>
              ) : explorerCategories.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
                  Нет категорий
                </div>
              ) : (
                explorerCategories.map(cat => (
                  <div
                    key={cat.id}
                    onClick={() => loadCategoryAttrs(cat)}
                    style={{
                      padding: "9px 14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      background: selectedCategory?.id === cat.id ? "rgba(99,102,241,0.1)" : "transparent",
                      borderLeft: selectedCategory?.id === cat.id ? "2px solid #6366f1" : "2px solid transparent",
                      transition: "background 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {cat.name}
                    </span>
                    <ChevronRight size={12} color="rgba(255,255,255,0.2)" style={{ flexShrink: 0 }} />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Attributes */}
          <div style={{ ...card, display: "flex", flexDirection: "column" }}>
            {!selectedCategory ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
                Выберите категорию слева
              </div>
            ) : (
              <>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: "0 0 4px" }}>{selectedCategory.name}</p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>
                    {explorerPlatform === "ozon" ? "Ozon" : "Мегамаркет"} · {catAttrsLoading ? "загрузка..." : `${categoryAttrs.length} атрибутов`}
                  </p>
                </div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                  {catAttrsLoading ? (
                    <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
                      <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                    </div>
                  ) : categoryAttrs.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>Нет атрибутов</div>
                  ) : (
                    categoryAttrs.map(attr => (
                      <div key={attr.id} style={{ padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 14, alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.88)", fontWeight: 500 }}>{attr.name}</span>
                            {attr.is_required && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.12)", padding: "1px 6px", borderRadius: 4 }}>
                                Обязательный
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {attr.type && (
                              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.06)", padding: "1px 7px", borderRadius: 4 }}>
                                {attr.type}
                              </span>
                            )}
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>ID: {attr.id}</span>
                          </div>
                          {attr.values && attr.values.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                              {attr.values.slice(0, 8).map((v, i) => (
                                <span key={i} style={{ fontSize: 11, color: "#a5b4fc", background: "rgba(99,102,241,0.1)", padding: "2px 7px", borderRadius: 4 }}>
                                  {v}
                                </span>
                              ))}
                              {attr.values.length > 8 && (
                                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>+{attr.values.length - 8}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: Build ── */}
      {activeTab === "build" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Build form */}
          <div style={{ ...card, padding: 24 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
              <Zap size={16} color="#6366f1" />Построить карту атрибутов
            </p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "0 0 20px" }}>
              AI сопоставит атрибуты Ozon и Мегамаркет семантически. Задача выполняется в фоне (Celery).
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Подключение Ozon
                </label>
                <select style={inputStyle} value={ozonConnId} onChange={e => setOzonConnId(e.target.value)}>
                  <option value="">— выберите —</option>
                  {connections.filter(c => c.type === "ozon").map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Подключение Мегамаркет
                </label>
                <select style={inputStyle} value={mmConnId} onChange={e => setMmConnId(e.target.value)}>
                  <option value="">— выберите —</option>
                  {connections.filter(c => c.type === "megamarket").map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                  ))}
                </select>
              </div>

              <button
                style={{ ...btnPrimary, justifyContent: "center", opacity: building ? 0.7 : 1 }}
                onClick={startBuild}
                disabled={building}
              >
                {building
                  ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />Строю карту...</>
                  : <><Sparkles size={15} />Запустить сборку</>
                }
              </button>
            </div>

            {/* Build progress */}
            {buildStatus && (
              <div style={{ marginTop: 20, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: buildStatus.status === "error" ? "#f87171" : "#10b981" }}>
                    {buildStatus.stage ?? buildStatus.status}
                  </span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{buildStatus.progress_percent}%</span>
                </div>
                <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 3 }}>
                  <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg,#6366f1,#a855f7)", width: `${buildStatus.progress_percent}%`, transition: "width 0.5s" }} />
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "8px 0 0" }}>{buildStatus.message}</p>
                {buildStatus.error && (
                  <p style={{ fontSize: 12, color: "#f87171", margin: "6px 0 0" }}>Ошибка: {buildStatus.error}</p>
                )}
              </div>
            )}
          </div>

          {/* Info */}
          <div style={{ ...card, padding: 24 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <BarChart3 size={16} color="#a855f7" />Как работает карта
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { n: "1", title: "Сбор атрибутов", desc: "Система загружает все атрибуты из API Ozon и Мегамаркет для указанных категорий" },
                { n: "2", title: "Семантический анализ", desc: "AI (DeepSeek) сравнивает атрибуты по смыслу — находит «Высота» = «Высота изделия» = «Height»" },
                { n: "3", title: "Построение связей", desc: "Создаётся граф соответствий с оценкой схожести. Ручные связи всегда имеют приоритет" },
                { n: "4", title: "Маппинг товаров", desc: "При синдикации на маркетплейс карта помогает автоматически подставить нужные значения атрибутов" },
              ].map(item => (
                <div key={item.n} style={{ display: "flex", gap: 12 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#a5b4fc", flexShrink: 0 }}>
                    {item.n}
                  </div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", margin: "0 0 3px" }}>{item.title}</p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: 0 }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
