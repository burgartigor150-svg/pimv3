import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import ContentStudio from "../components/ContentStudio";
import {
  ArrowLeft,
  Save,
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  Image as ImageIcon,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Package,
  Tag,
  FileText,
  Layers,
  History,
  Upload,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductAttribute {
  key: string;
  value: string;
  type: string;
}

interface ProductMedia {
  id: string;
  url: string;
  type: "image" | "video";
}

interface SyndicationStatus {
  connection_id: string;
  status: "synced" | "pending" | "error" | "not_pushed";
  last_pushed_at: string | null;
  error_message: string | null;
}

interface HistoryEntry {
  id: string;
  action: string;
  actor: string;
  created_at: string;
  details: string;
}

type CategoryVal = { name: string; id: string; parent_id?: string } | string | null | undefined;
function getCatName(cat: CategoryVal): string {
  if (!cat) return '';
  if (typeof cat === 'object') return (cat as any).name ?? '';
  return String(cat);
}

interface Product {
  id: string;
  name: string;
  sku: string;
  description: string;
  description_html?: string;
  brand?: string;
  category: CategoryVal;
  category_id?: string;
  status: "active" | "draft" | "archived";
  attributes: ProductAttribute[];
  attributes_data?: any;
  images?: any[];
  media: ProductMedia[];
  syndication: SyndicationStatus[];
  history: HistoryEntry[];
  completeness_score?: number;
}

interface Connection {
  id: string;
  name: string;
  marketplace: string;
}

// ─── Style Constants ──────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  backdropFilter: "blur(20px)",
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
  transition: "border-color 0.2s",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: 100,
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "rgba(255,255,255,0.4)",
  display: "block",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 16px",
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
  padding: "10px 22px",
  borderRadius: 10,
  background: "linear-gradient(135deg, #6366f1, #a855f7)",
  border: "none",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  boxShadow: "0 0 20px rgba(99,102,241,0.4)",
};

const spinStyle: React.CSSProperties = { animation: "spin 1s linear infinite" };

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  active: { bg: "rgba(34,197,94,0.15)", color: "#4ade80", label: "Активен" },
  draft: { bg: "rgba(234,179,8,0.15)", color: "#fbbf24", label: "Черновик" },
  archived: { bg: "rgba(107,114,128,0.15)", color: "#9ca3af", label: "Архив" },
};

const SYNC_COLORS: Record<string, { bg: string; color: string }> = {
  synced: { bg: "rgba(34,197,94,0.12)", color: "#4ade80" },
  pending: { bg: "rgba(234,179,8,0.12)", color: "#fbbf24" },
  error: { bg: "rgba(239,68,68,0.12)", color: "#f87171" },
  not_pushed: { bg: "rgba(107,114,128,0.12)", color: "#9ca3af" },
};

const SYNC_LABELS: Record<string, string> = {
  synced: "Синхронизирован",
  pending: "Ожидает",
  error: "Ошибка",
  not_pushed: "Не отправлен",
};

const TABS = [
  { key: "main", label: "Основное", Icon: Package },
  { key: "attributes", label: "Атрибуты", Icon: Tag },
  { key: "media", label: "Медиа", Icon: ImageIcon },
  { key: "studio", label: "Студия", Icon: Sparkles },
  { key: "syndication", label: "Синдикация", Icon: Send },
  { key: "history", label: "История", Icon: History },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [activeTab, setActiveTab] = useState("main");
  const [pushingId, setPushingId] = useState<string | null>(null);

  const [fields, setFields] = useState({
    name: "",
    sku: "",
    description: "",
    brand: "",
    category: "",
  });
  const [attributes, setAttributes] = useState<ProductAttribute[]>([]);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [prodRes, connRes] = await Promise.all([
        api.get(`/products/${id}`),
        api.get("/connections"),
      ]);
      const raw = prodRes.data;
      // API returns `images` array and `attributes_data` object — map to expected shape
      const p: Product = {
        ...raw,
        media: raw.media?.length
          ? raw.media
          : (raw.images ?? []).map((img: any, i: number) => ({
              id: img.id ?? String(i),
              url: img.url ?? img,
              type: "image" as const,
            })),
        attributes: Array.isArray(raw.attributes) ? raw.attributes : [],
        syndication: raw.syndication ?? [],
        history: raw.history ?? [],
      };
      setProduct(p);
      setFields({
        name: p.name ?? "",
        sku: p.sku ?? "",
        description: p.description_html ?? p.description ?? "",
        brand: p.brand ?? "",
        category: getCatName(p.category),
      });
      // attributes_data is an object {key: {value, type}}, attributes is array
      const attrs = Array.isArray(p.attributes) && p.attributes.length > 0
        ? p.attributes
        : p.attributes_data
          ? Object.entries(p.attributes_data).map(([key, v]: [string, any]) => ({
              key,
              value: v?.value ?? String(v ?? ""),
              type: v?.type ?? "string",
            }))
          : [];
      setAttributes(attrs);
      setConnections(connRes.data ?? []);
    } catch {
      toast("Ошибка загрузки продукта", "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const res = await api.put(`/products/${id}`, { ...fields, attributes });
      setProduct(res.data);
      toast("Продукт сохранён", "success");
    } catch {
      toast("Не удалось сохранить", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEnrich = async () => {
    if (!id) return;
    setEnriching(true);
    try {
      const res = await api.post(`/ai/enrich/${id}`);
      const d = res.data;
      setFields((f) => ({
        name: d.name ?? f.name,
        sku: d.sku ?? f.sku,
        description: d.description ?? f.description,
        brand: d.brand ?? f.brand,
        category: d.category ?? f.category,
      }));
      if (d.attributes) setAttributes(d.attributes);
      toast("AI обогащение выполнено", "success");
    } catch {
      toast("Ошибка AI обогащения", "error");
    } finally {
      setEnriching(false);
    }
  };

  const handlePush = async (connectionId: string) => {
    if (!id) return;
    setPushingId(connectionId);
    try {
      await api.post(`/syndication/push/${id}`, { connection_id: connectionId });
      toast("Продукт отправлен на маркетплейс", "success");
      const res = await api.get(`/products/${id}`);
      setProduct(res.data);
    } catch {
      toast("Ошибка синдикации", "error");
    } finally {
      setPushingId(null);
    }
  };

  const handleRemoveMedia = (mediaId: string) => {
    setProduct((p) =>
      p ? { ...p, media: p.media.filter((m) => m.id !== mediaId) } : p
    );
    toast("Изображение удалено", "success");
  };

  const handleAttrChange = (idx: number, field: keyof ProductAttribute, value: string) => {
    setAttributes((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addAttr = () =>
    setAttributes((prev) => [...prev, { key: "", value: "", type: "string" }]);

  const removeAttr = (idx: number) =>
    setAttributes((prev) => prev.filter((_, i) => i !== idx));

  const getSyncStatus = (connectionId: string): SyndicationStatus | undefined =>
    product?.syndication?.find((s) => s.connection_id === connectionId);

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg-void, #03030a)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        <Loader2 size={42} color="#6366f1" style={spinStyle} />
      </div>
    );
  }

  if (!product) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg-void, #03030a)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.5)",
          gap: 16,
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <Package size={52} color="rgba(255,255,255,0.08)" />
        <p style={{ fontSize: 16, margin: 0 }}>Продукт не найден</p>
        <button onClick={() => navigate(-1)} style={btnSecondary}>
          <ArrowLeft size={15} />
          Назад
        </button>
      </div>
    );
  }

  const statusInfo = STATUS_COLORS[product.status] ?? STATUS_COLORS.draft;

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-void, #03030a)",
        color: "rgba(255,255,255,0.9)",
        fontFamily: "'Inter', sans-serif",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input:focus, textarea:focus, select:focus { border-color: rgba(99,102,241,0.5) !important; }
      `}</style>

      {/* ── Sticky Top Bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "18px 32px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(3,3,10,0.85)",
          backdropFilter: "blur(20px)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.45)",
            fontSize: 14,
            cursor: "pointer",
            padding: "6px 10px",
            borderRadius: 8,
            transition: "color 0.2s",
            flexShrink: 0,
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.8)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.45)")
          }
        >
          <ArrowLeft size={16} />
          Назад
        </button>

        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1
              style={{
                fontSize: 18,
                fontWeight: 700,
                margin: 0,
                color: "rgba(255,255,255,0.9)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {product.name || "Без названия"}
            </h1>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: 20,
                background: statusInfo.bg,
                color: statusInfo.color,
                flexShrink: 0,
              }}
            >
              {statusInfo.label}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: "3px 0 0" }}>
            SKU: {product.sku || "—"}
          </p>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <button
            onClick={handleEnrich}
            disabled={enriching}
            style={{
              ...btnSecondary,
              opacity: enriching ? 0.7 : 1,
              cursor: enriching ? "not-allowed" : "pointer",
            }}
          >
            {enriching
              ? <Loader2 size={15} style={spinStyle} />
              : <Sparkles size={15} color="#a5b4fc" />}
            {enriching ? "Обогащение…" : "AI обогатить"}
          </button>

          <button
            className="btn-glow"
            onClick={handleSave}
            disabled={saving}
            style={{
              ...btnGlow,
              opacity: saving ? 0.7 : 1,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving
              ? <Loader2 size={15} style={spinStyle} />
              : <Save size={15} />}
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>

      {/* ── Tab Row ── */}
      <div
        style={{
          display: "flex",
          padding: "0 32px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.12)",
          overflowX: "auto",
        }}
      >
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "14px 18px",
              fontSize: 14,
              fontWeight: 500,
              color: activeTab === key ? "#a5b4fc" : "rgba(255,255,255,0.45)",
              cursor: "pointer",
              border: "none",
              background: "transparent",
              borderBottom: activeTab === key ? "2px solid #6366f1" : "2px solid transparent",
              marginBottom: -1,
              transition: "color 0.2s",
              whiteSpace: "nowrap",
            }}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ padding: 32, maxWidth: 960, margin: "0 auto" }}>

        {/* ──────────── Основное ──────────── */}
        {activeTab === "main" && (
          <div style={{ ...card, padding: 28 }}>
            <h2
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "rgba(255,255,255,0.35)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 24px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <FileText size={14} />
              Основная информация
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <label style={labelStyle}>Название товара</label>
                <input
                  style={inputStyle}
                  value={fields.name}
                  onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Введите название"
                />
              </div>
              <div>
                <label style={labelStyle}>Артикул (SKU)</label>
                <input
                  style={inputStyle}
                  value={fields.sku}
                  onChange={(e) => setFields((f) => ({ ...f, sku: e.target.value }))}
                  placeholder="SKU-12345"
                />
              </div>
              <div>
                <label style={labelStyle}>Бренд</label>
                <input
                  style={inputStyle}
                  value={fields.brand}
                  onChange={(e) => setFields((f) => ({ ...f, brand: e.target.value }))}
                  placeholder="Название бренда"
                />
              </div>
              <div>
                <label style={labelStyle}>Категория</label>
                <input
                  style={inputStyle}
                  value={fields.category}
                  onChange={(e) => setFields((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Электроника / Телефоны"
                />
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <label style={labelStyle}>Описание</label>
              <textarea
                style={textareaStyle}
                value={fields.description}
                onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
                placeholder="Подробное описание товара…"
                rows={6}
              />
            </div>
          </div>
        )}

        {/* ──────────── Атрибуты ──────────── */}
        {activeTab === "attributes" && (
          <div style={{ ...card, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "18px 24px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <h2
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Layers size={14} />
                Атрибуты
                {attributes.length > 0 && (
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
                    {attributes.length}
                  </span>
                )}
              </h2>
              <button onClick={addAttr} style={btnSecondary}>
                <Plus size={14} />
                Добавить
              </button>
            </div>

            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 130px 44px",
                padding: "9px 24px",
                background: "rgba(255,255,255,0.02)",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(255,255,255,0.28)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                gap: 12,
              }}
            >
              <span>Ключ</span>
              <span>Значение</span>
              <span>Тип</span>
              <span />
            </div>

            {attributes.length === 0 ? (
              <div
                style={{
                  padding: "52px 24px",
                  textAlign: "center",
                  color: "rgba(255,255,255,0.22)",
                }}
              >
                <Tag
                  size={36}
                  color="rgba(255,255,255,0.08)"
                  style={{ display: "block", margin: "0 auto 12px" }}
                />
                <p style={{ fontSize: 14, margin: "0 0 18px" }}>Нет атрибутов</p>
                <button onClick={addAttr} style={btnSecondary}>
                  <Plus size={14} />
                  Добавить атрибут
                </button>
              </div>
            ) : (
              <>
                {attributes.map((attr, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 130px 44px",
                      padding: "10px 24px",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <input
                      style={{ ...inputStyle, padding: "8px 12px" }}
                      value={attr.key}
                      onChange={(e) => handleAttrChange(idx, "key", e.target.value)}
                      placeholder="Атрибут"
                    />
                    <input
                      style={{ ...inputStyle, padding: "8px 12px" }}
                      value={attr.value}
                      onChange={(e) => handleAttrChange(idx, "value", e.target.value)}
                      placeholder="Значение"
                    />
                    <select
                      value={attr.type}
                      onChange={(e) => handleAttrChange(idx, "type", e.target.value)}
                      style={{ ...inputStyle, padding: "8px 12px", cursor: "pointer" }}
                    >
                      <option value="string">Строка</option>
                      <option value="number">Число</option>
                      <option value="boolean">Булево</option>
                      <option value="list">Список</option>
                    </select>
                    <button
                      onClick={() => removeAttr(idx)}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(239,68,68,0.25)",
                        borderRadius: 8,
                        color: "rgba(239,68,68,0.6)",
                        cursor: "pointer",
                        padding: "7px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.15s",
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div
                  style={{ padding: "14px 24px", borderTop: "1px solid rgba(255,255,255,0.04)" }}
                >
                  <button onClick={addAttr} style={btnSecondary}>
                    <Plus size={14} />
                    Добавить атрибут
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ──────────── Медиа ──────────── */}
        {activeTab === "media" && (
          <div>
            <div
              style={{
                ...card,
                padding: "18px 24px",
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.35)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "0 0 4px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <ImageIcon size={14} />
                  Медиафайлы
                </h2>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", margin: 0 }}>
                  {product.media?.length ?? 0} файл(ов)
                </p>
              </div>
              <div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  onChange={() =>
                    toast("Загрузка файлов пока не реализована", "info")
                  }
                />
                <button onClick={() => fileInputRef.current?.click()} style={btnSecondary}>
                  <Upload size={15} />
                  Загрузить
                </button>
              </div>
            </div>

            {!product.media || product.media.length === 0 ? (
              <div
                style={{
                  ...card,
                  padding: "64px 24px",
                  textAlign: "center",
                  color: "rgba(255,255,255,0.22)",
                }}
              >
                <ImageIcon
                  size={52}
                  color="rgba(255,255,255,0.07)"
                  style={{ display: "block", margin: "0 auto 16px" }}
                />
                <p style={{ fontSize: 14, margin: "0 0 20px" }}>Нет медиафайлов</p>
                <button onClick={() => fileInputRef.current?.click()} style={btnSecondary}>
                  <Upload size={14} />
                  Загрузить изображение
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 16,
                }}
              >
                {product.media.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      ...card,
                      position: "relative",
                      overflow: "hidden",
                      aspectRatio: "1",
                      padding: 0,
                    }}
                    onMouseEnter={(e) => {
                      const btn = (e.currentTarget as HTMLDivElement).querySelector(
                        ".media-del-btn"
                      ) as HTMLButtonElement | null;
                      if (btn) btn.style.opacity = "1";
                    }}
                    onMouseLeave={(e) => {
                      const btn = (e.currentTarget as HTMLDivElement).querySelector(
                        ".media-del-btn"
                      ) as HTMLButtonElement | null;
                      if (btn) btn.style.opacity = "0";
                    }}
                  >
                    <img
                      src={m.url}
                      alt="product"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    <button
                      className="media-del-btn"
                      onClick={() => handleRemoveMedia(m.id)}
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "rgba(0,0,0,0.72)",
                        border: "1px solid rgba(239,68,68,0.4)",
                        color: "#f87171",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: 0,
                        transition: "opacity 0.2s",
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}

                {/* Add tile */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px dashed rgba(255,255,255,0.1)",
                    borderRadius: 16,
                    aspectRatio: "1",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    cursor: "pointer",
                    color: "rgba(255,255,255,0.28)",
                    fontSize: 13,
                    transition: "background 0.2s",
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(255,255,255,0.04)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(255,255,255,0.02)")
                  }
                >
                  <Plus size={22} color="rgba(255,255,255,0.2)" />
                  Добавить
                </button>
              </div>
            )}
          </div>
        )}

        {/* ──────────── Синдикация ──────────── */}
        {activeTab === "syndication" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {connections.length === 0 ? (
              <div
                style={{
                  ...card,
                  padding: "64px 24px",
                  textAlign: "center",
                  color: "rgba(255,255,255,0.22)",
                }}
              >
                <Send
                  size={44}
                  color="rgba(255,255,255,0.07)"
                  style={{ display: "block", margin: "0 auto 14px" }}
                />
                <p style={{ fontSize: 14, margin: 0 }}>
                  Нет подключённых маркетплейсов
                </p>
              </div>
            ) : (
              connections.map((conn) => {
                const status = getSyncStatus(conn.id);
                const syncKey = status?.status ?? "not_pushed";
                const syncInfo = SYNC_COLORS[syncKey] ?? SYNC_COLORS.not_pushed;
                const syncLabel = SYNC_LABELS[syncKey] ?? "Не отправлен";
                const isPushing = pushingId === conn.id;
                const isSynced = syncKey === "synced";

                return (
                  <div
                    key={conn.id}
                    style={{
                      ...card,
                      padding: "20px 24px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 11,
                          background: "rgba(255,255,255,0.05)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Send size={18} color="rgba(255,255,255,0.45)" />
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: "rgba(255,255,255,0.85)",
                          }}
                        >
                          {conn.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "rgba(255,255,255,0.35)",
                            marginTop: 2,
                          }}
                        >
                          {conn.marketplace}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div style={{ textAlign: "right" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 12,
                            fontWeight: 600,
                            padding: "4px 10px",
                            borderRadius: 20,
                            background: syncInfo.bg,
                            color: syncInfo.color,
                          }}
                        >
                          {syncKey === "synced" && <CheckCircle2 size={13} />}
                          {syncKey === "pending" && <Clock size={13} />}
                          {syncKey === "error" && <AlertCircle size={13} />}
                          {syncKey === "not_pushed" && <Clock size={13} />}
                          {syncLabel}
                        </span>
                        {status?.last_pushed_at && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "rgba(255,255,255,0.28)",
                              marginTop: 4,
                            }}
                          >
                            {formatDate(status.last_pushed_at)}
                          </div>
                        )}
                        {status?.error_message && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "#f87171",
                              marginTop: 4,
                              maxWidth: 240,
                            }}
                          >
                            {status.error_message}
                          </div>
                        )}
                      </div>

                      <button
                        className={!isSynced ? "btn-glow" : undefined}
                        onClick={() => handlePush(conn.id)}
                        disabled={isPushing}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 7,
                          padding: "9px 18px",
                          borderRadius: 10,
                          background: isSynced
                            ? "rgba(255,255,255,0.05)"
                            : "linear-gradient(135deg, #6366f1, #a855f7)",
                          border: isSynced ? "1px solid rgba(255,255,255,0.1)" : "none",
                          color: isSynced ? "rgba(255,255,255,0.6)" : "#fff",
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: isPushing ? "not-allowed" : "pointer",
                          boxShadow: !isSynced ? "0 0 16px rgba(99,102,241,0.35)" : "none",
                          opacity: isPushing ? 0.7 : 1,
                          flexShrink: 0,
                          transition: "opacity 0.2s",
                        }}
                      >
                        {isPushing ? (
                          <Loader2 size={14} style={spinStyle} />
                        ) : isSynced ? (
                          <RefreshCw size={14} />
                        ) : (
                          <Send size={14} />
                        )}
                        {isPushing
                          ? "Отправка…"
                          : isSynced
                          ? "Обновить"
                          : "Отправить"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Studio moved outside container */}

        {/* ──────────── История ──────────── */}
        {activeTab === "history" && (
          <div style={{ ...card, overflow: "hidden" }}>
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <History size={14} color="rgba(255,255,255,0.35)" />
              <h2
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: 0,
                }}
              >
                История изменений
              </h2>
              {product.history && product.history.length > 0 && (
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
                  {product.history.length}
                </span>
              )}
            </div>

            {!product.history || product.history.length === 0 ? (
              <div
                style={{
                  padding: "56px 24px",
                  textAlign: "center",
                  color: "rgba(255,255,255,0.22)",
                }}
              >
                <History
                  size={40}
                  color="rgba(255,255,255,0.07)"
                  style={{ display: "block", margin: "0 auto 12px" }}
                />
                <p style={{ fontSize: 14, margin: 0 }}>История пуста</p>
              </div>
            ) : (
              product.history.map((entry, idx) => (
                <div
                  key={entry.id}
                  style={{
                    display: "flex",
                    gap: 16,
                    padding: "18px 24px",
                    borderBottom:
                      idx < product.history.length - 1
                        ? "1px solid rgba(255,255,255,0.04)"
                        : "none",
                  }}
                >
                  {/* Timeline */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      flexShrink: 0,
                      paddingTop: 3,
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg, #6366f1, #a855f7)",
                        flexShrink: 0,
                      }}
                    />
                    {idx < product.history.length - 1 && (
                      <div
                        style={{
                          width: 1,
                          flex: 1,
                          minHeight: 16,
                          background: "rgba(99,102,241,0.18)",
                          marginTop: 4,
                        }}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        marginBottom: 5,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "rgba(255,255,255,0.85)",
                        }}
                      >
                        {entry.action}
                      </span>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                        {entry.actor}
                      </span>
                    </div>
                    {entry.details && (
                      <p
                        style={{
                          fontSize: 13,
                          color: "rgba(255,255,255,0.45)",
                          margin: "0 0 5px",
                          lineHeight: 1.5,
                        }}
                      >
                        {entry.details}
                      </p>
                    )}
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
                      {formatDate(entry.created_at)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ──────────── Студия — полноэкранная, за пределами ограниченного контейнера ──────────── */}
      {activeTab === "studio" && product && (
        <div style={{ padding: "0 16px 24px" }}>
          <ContentStudio product={product} />
        </div>
      )}
    </div>
  );
}
