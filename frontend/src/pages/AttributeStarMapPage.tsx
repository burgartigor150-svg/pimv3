import React, { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import {
  Search,
  Plus,
  Trash2,
  Link2,
  X,
  ChevronRight,
  Loader2,
  RefreshCw,
  GitBranch,
} from "lucide-react";

interface StarMapNode {
  id: string;
  name: string;
  type: string;
  connections: string[];
}

interface StarMapEdge {
  id: string;
  source: string;
  target: string;
  marketplace: string;
}

interface Connection {
  id: string;
  name: string;
  marketplace: string;
}

const MARKETPLACE_TABS = [
  { key: "ozon", label: "Ozon" },
  { key: "wb", label: "WB" },
  { key: "yandex", label: "Яндекс" },
  { key: "megamarket", label: "Мегамаркет" },
];

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  backdropFilter: "blur(20px)",
  overflow: "hidden",
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 16px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.75)",
  fontWeight: 500,
  fontSize: 14,
  cursor: "pointer",
};

const btnGlow: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 20px",
  borderRadius: 10,
  background: "linear-gradient(135deg, #6366f1, #a855f7)",
  border: "none",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  boxShadow: "0 0 20px rgba(99,102,241,0.4)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "rgba(255,255,255,0.5)",
  display: "block",
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "11px 14px",
  color: "rgba(255,255,255,0.9)",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };

const dotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "linear-gradient(135deg, #6366f1, #a855f7)",
  flexShrink: 0,
  display: "inline-block",
};

const spinStyle: React.CSSProperties = { animation: "spin 1s linear infinite" };

export default function AttributeStarMapPage() {
  const { toast } = useToast();
  const [nodes, setNodes] = useState<StarMapNode[]>([]);
  const [edges, setEdges] = useState<StarMapEdge[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAttr, setSelectedAttr] = useState<StarMapNode | null>(null);
  const [activeTab, setActiveTab] = useState("ozon");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [deletingEdgeId, setDeletingEdgeId] = useState<string | null>(null);
  const [form, setForm] = useState({ pim_attr_id: "", marketplace: "ozon", mp_attr_name: "" });
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [mapRes, connRes] = await Promise.all([
        api.get("/api/v1/attributes/star-map"),
        api.get("/api/v1/connections"),
      ]);
      setNodes(mapRes.data.nodes ?? []);
      setEdges(mapRes.data.edges ?? []);
      setConnections(connRes.data ?? []);
    } catch {
      toast('Ошибка загрузки данных', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredNodes = nodes.filter((n) =>
    n.name.toLowerCase().includes(search.toLowerCase())
  );

  const edgesForTab = edges.filter(
    (e) => e.marketplace === activeTab && (!selectedAttr || e.source === selectedAttr.id)
  );

  const handleDeleteEdge = async (edgeId: string) => {
    setDeletingEdgeId(edgeId);
    try {
      await api.delete(`/api/v1/attributes/star-map/link/${edgeId}`);
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      toast('Маппинг удалён', 'success');
    } catch {
      toast('Не удалось удалить маппинг', 'error');
    } finally {
      setDeletingEdgeId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.pim_attr_id || !form.mp_attr_name) {
      toast('Заполните все поля', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post("/api/v1/attributes/star-map/link", form);
      setEdges((prev) => [...prev, res.data]);
      toast('Маппинг добавлен', 'success');
      setShowModal(false);
      setForm({ pim_attr_id: "", marketplace: "ozon", mp_attr_name: "" });
    } catch {
      toast('Не удалось добавить маппинг', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openModal = (attrId = "", mp = activeTab) => {
    setForm({ pim_attr_id: attrId, marketplace: mp, mp_attr_name: "" });
    setShowModal(true);
  };

  const getNodeName = (nodeId: string) =>
    nodes.find((n) => n.id === nodeId)?.name ?? nodeId;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-void, #03030a)",
        color: "rgba(255,255,255,0.9)",
        fontFamily: "'Inter', sans-serif",
        padding: 32,
        boxSizing: "border-box",
      }}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* ── Top Bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 32,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "linear-gradient(135deg, #6366f1, #a855f7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <GitBranch size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "rgba(255,255,255,0.9)" }}>
              Атрибут Star Map
            </h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: "4px 0 0" }}>
              Маппинг атрибутов PIM → маркетплейсы
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "10px 14px",
              width: 260,
            }}
          >
            <Search size={15} color="rgba(255,255,255,0.35)" />
            <input
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: "rgba(255,255,255,0.9)",
                fontSize: 14,
                width: "100%",
              }}
              placeholder="Поиск атрибутов…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}
              >
                <X size={14} color="rgba(255,255,255,0.35)" />
              </button>
            )}
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            style={{ ...btnSecondary, opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading
              ? <Loader2 size={15} style={spinStyle} />
              : <RefreshCw size={15} />}
            Обновить
          </button>

          <button
            className="btn-glow"
            onClick={() => openModal(selectedAttr?.id ?? "")}
            style={btnGlow}
          >
            <Plus size={16} />
            Добавить маппинг
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0" }}>
          <Loader2 size={36} color="#6366f1" style={spinStyle} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>

          {/* ── Left: PIM Attributes ── */}
          <div style={card}>
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                PIM Атрибуты
              </span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
                {filteredNodes.length}
              </span>
            </div>

            <div style={{ maxHeight: "calc(100vh - 260px)", overflowY: "auto" }}>
              {filteredNodes.length === 0 ? (
                <div
                  style={{ padding: "40px 20px", textAlign: "center", color: "rgba(255,255,255,0.25)" }}
                >
                  <p style={{ fontSize: 14, margin: 0 }}>Атрибуты не найдены</p>
                </div>
              ) : (
                filteredNodes.map((node) => {
                  const count = edges.filter((e) => e.source === node.id).length;
                  const isActive = selectedAttr?.id === node.id;
                  return (
                    <div
                      key={node.id}
                      onClick={() => setSelectedAttr(isActive ? null : node)}
                      style={{
                        padding: "12px 20px",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: isActive ? "rgba(99,102,241,0.1)" : "transparent",
                        borderLeft: isActive ? "2px solid #6366f1" : "2px solid transparent",
                        transition: "background 0.15s",
                      }}
                    >
                      <div>
                        <div
                          style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.85)" }}
                        >
                          {node.name}
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                          {node.type}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {count > 0 && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 7px",
                              borderRadius: 20,
                              background: "rgba(99,102,241,0.2)",
                              color: "#a5b4fc",
                              fontWeight: 600,
                            }}
                          >
                            {count}
                          </span>
                        )}
                        <ChevronRight
                          size={14}
                          color={isActive ? "#6366f1" : "rgba(255,255,255,0.2)"}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Right: Marketplace Mappings ── */}
          <div style={card}>
            {/* Tabs */}
            <div
              style={{
                display: "flex",
                padding: "0 20px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                alignItems: "center",
              }}
            >
              {MARKETPLACE_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={{
                    padding: "14px 18px",
                    fontSize: 14,
                    fontWeight: 500,
                    color: activeTab === t.key ? "#a5b4fc" : "rgba(255,255,255,0.45)",
                    cursor: "pointer",
                    border: "none",
                    background: "transparent",
                    borderBottom: activeTab === t.key ? "2px solid #6366f1" : "2px solid transparent",
                    marginBottom: -1,
                    transition: "color 0.2s",
                  }}
                >
                  {t.label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              {selectedAttr && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 13,
                    color: "rgba(255,255,255,0.4)",
                  }}
                >
                  <span style={dotStyle} />
                  Фильтр:{" "}
                  <strong style={{ color: "#a5b4fc" }}>{selectedAttr.name}</strong>
                  <button
                    onClick={() => setSelectedAttr(null)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "rgba(255,255,255,0.3)",
                      padding: 0,
                      display: "flex",
                      marginLeft: 2,
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>

            {/* Table Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 140px",
                padding: "10px 20px",
                background: "rgba(255,255,255,0.02)",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(255,255,255,0.3)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              <span>PIM Атрибут</span>
              <span>Атрибут маркетплейса</span>
              <span>Действия</span>
            </div>

            {edgesForTab.length === 0 ? (
              <div
                style={{
                  padding: "56px 20px",
                  textAlign: "center",
                  color: "rgba(255,255,255,0.25)",
                }}
              >
                <Link2
                  size={40}
                  color="rgba(255,255,255,0.1)"
                  style={{ marginBottom: 14, display: "block", margin: "0 auto 14px" }}
                />
                <p style={{ fontSize: 14, margin: "0 0 20px" }}>
                  Нет маппингов для{" "}
                  {MARKETPLACE_TABS.find((t) => t.key === activeTab)?.label}
                  {selectedAttr ? ` / «${selectedAttr.name}»` : ""}
                </p>
                <button
                  onClick={() => openModal(selectedAttr?.id ?? "", activeTab)}
                  style={btnSecondary}
                >
                  <Plus size={14} />
                  Добавить маппинг
                </button>
              </div>
            ) : (
              <>
                {edgesForTab.map((edge) => (
                  <div
                    key={edge.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 140px",
                      padding: "13px 20px",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      alignItems: "center",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background =
                        "rgba(255,255,255,0.015)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={dotStyle} />
                      <span style={{ fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
                        {getNodeName(edge.source)}
                      </span>
                    </div>
                    <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>
                      {edge.target}
                    </span>
                    <button
                      disabled={deletingEdgeId === edge.id}
                      onClick={() => handleDeleteEdge(edge.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "5px 11px",
                        borderRadius: 7,
                        background: "transparent",
                        border: "1px solid rgba(239,68,68,0.3)",
                        color: "rgba(239,68,68,0.7)",
                        fontSize: 12,
                        cursor: deletingEdgeId === edge.id ? "not-allowed" : "pointer",
                        opacity: deletingEdgeId === edge.id ? 0.6 : 1,
                      }}
                    >
                      {deletingEdgeId === edge.id ? (
                        <Loader2 size={12} style={spinStyle} />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      Удалить
                    </button>
                  </div>
                ))}

                <div
                  style={{ padding: "14px 20px", borderTop: "1px solid rgba(255,255,255,0.04)" }}
                >
                  <button onClick={() => openModal(selectedAttr?.id ?? "", activeTab)} style={btnSecondary}>
                    <Plus size={14} />
                    Добавить маппинг
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Add Mapping Modal ── */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              background: "#0d0d1a",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20,
              padding: 32,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "rgba(255,255,255,0.9)",
                margin: "0 0 28px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: "linear-gradient(135deg, #6366f1, #a855f7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Link2 size={16} color="#fff" />
              </div>
              Добавить маппинг
            </h2>

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>PIM Атрибут</label>
                <select
                  value={form.pim_attr_id}
                  onChange={(e) => setForm((f) => ({ ...f, pim_attr_id: e.target.value }))}
                  required
                  style={selectStyle}
                >
                  <option value="">— Выберите атрибут —</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Маркетплейс</label>
                <select
                  value={form.marketplace}
                  onChange={(e) => setForm((f) => ({ ...f, marketplace: e.target.value }))}
                  style={selectStyle}
                >
                  {MARKETPLACE_TABS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 28 }}>
                <label style={labelStyle}>Атрибут маркетплейса</label>
                <input
                  value={form.mp_attr_name}
                  onChange={(e) => setForm((f) => ({ ...f, mp_attr_name: e.target.value }))}
                  required
                  placeholder="Например: Цвет товара"
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={btnSecondary}>
                  Отмена
                </button>
                <button
                  type="submit"
                  className="btn-glow"
                  disabled={submitting}
                  style={{
                    ...btnGlow,
                    opacity: submitting ? 0.7 : 1,
                    cursor: submitting ? "not-allowed" : "pointer",
                  }}
                >
                  {submitting ? (
                    <Loader2 size={15} style={spinStyle} />
                  ) : (
                    <Plus size={15} />
                  )}
                  {submitting ? "Сохранение…" : "Добавить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
