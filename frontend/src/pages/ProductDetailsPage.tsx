import React, { useEffect, useState, useCallback, useRef, Component } from "react";

// ─── Error Boundary ───────────────────────────────────────────────────────────
class TabErrorBoundary extends Component<{children: React.ReactNode}, {error: Error | null}> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return React.createElement('div',
        {style: {padding: 40, color: '#f87171', background: '#1a0a0a', borderRadius: 12, margin: 16}},
        React.createElement('b', null, 'Ошибка компонента:'),
        React.createElement('pre', {style: {marginTop: 12, fontSize: 12, whiteSpace: 'pre-wrap', color: '#fca5a5'}},
          this.state.error.message + ' ' + (this.state.error.stack ?? ''))
      );
    }
    return this.props.children;
  }
}
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import ContentStudio from "../components/ContentStudio";
import RichContentEditor from "../components/RichContentEditor";
import SocialContentEditor from "../components/SocialContentEditor";
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
  Share2,
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
  type: string;
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
  { key: "rich", label: "Rich & Лендинг", Icon: FileText },
  { key: "social", label: "Соцсети", Icon: Share2 },
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
  const [enrichConnectionDialog, setEnrichConnectionDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("main");
  const [pushingId, setPushingId] = useState<string | null>(null);
  const isMpProduct = id?.startsWith('mp__') ?? false;
  const [mpPlatform, mpSku] = isMpProduct && id ? (() => { const parts = id.split('__'); return [parts[1] || '', decodeURIComponent(parts.slice(2).join('__'))]; })() : ['', ''];
  const [mpErrors, setMpErrors] = useState<any[]>([]);
  const [pimId, setPimId] = useState<string | null>(null);
  const [vendorCode, setVendorCode] = useState<string>("");
  const [mpBindings, setMpBindings] = useState<any[]>([]);
  const [mpBindingPlatform, setMpBindingPlatform] = useState<string>("");
  const [activePlatform, setActivePlatform] = useState<string>("");
  const [isShadowCard, setIsShadowCard] = useState(false);
  const [mpAttrsByPlatform, setMpAttrsByPlatform] = useState<Record<string, any[]>>({});
  const [mpAttrSchemaByPlatform, setMpAttrSchemaByPlatform] = useState<Record<string, any[]>>({});

  const [fields, setFields] = useState({
    name: "",
    sku: "",
    description: "",
    brand: "",
    category: "",
  });
  const [attributes, setAttributes] = useState<ProductAttribute[]>([]);
  const [attrFilter, setAttrFilter] = useState('');
  const [attrSubTab, setAttrSubTab] = useState<'current' | 'schema'>('current');
  const [catSchemaData, setCatSchemaData] = useState<any>(null);
  const [catSchemaLoading, setCatSchemaLoading] = useState(false);
  const [catSchemaTab, setCatSchemaTab] = useState('common');
  const [catSchemaSearch, setCatSchemaSearch] = useState('');
  const [autofillLoading, setAutofillLoading] = useState<Record<string, boolean>>({});
  const [autofillResults, setAutofillResults] = useState<Record<string, any>>({});

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const connRes = await api.get("/connections");
      setConnections(connRes.data ?? []);

      if (id.startsWith('mp__')) {
        // MP marketplace product — load via /mp/product-details
        const parts = id.split('__');
        const platform = parts[1] || '';
        const sku = decodeURIComponent(parts.slice(2).join('__'));
        const res = await api.get(`/mp/product-details?platform=${encodeURIComponent(platform)}&sku=${encodeURIComponent(sku)}`);
        const raw = res.data;
        const p: Product = {
          id,
          sku: (raw.sku ?? sku ?? '').replace(/^mp:/, ''),
          name: raw.name ?? '',
          brand: raw.brand || raw.attributes_data?.brand || (() => { const plats = (raw.attributes_data || {})._platforms || {}; for (const k in plats) { if (plats[k].brand) return plats[k].brand; } return ''; })(),
          category: raw.category ?? '',
          completeness_score: 0,
          status: 'active',
          description: raw.description || raw.description_html || '',
          description_html: raw.description ?? '',
          media: (raw.photos ?? []).map((url: string, i: number) => ({ id: String(i), url, type: 'image' as const })),
          attributes: (raw.attributes ?? []).map((a: any) => ({ key: a.name || a.id, value: a.value, type: a.type || 'string', dictionary_options: a.dictionary_options || [], isSuggest: a.isSuggest, is_multiple: a.is_multiple, is_required: a.is_required, error: a.error })),
          syndication: [],
          history: [],
        };
        setProduct(p);
        setFields({ name: p.name ?? '', sku: (p.sku ?? '').replace(/^mp:/, ''), description: raw.description ?? '', brand: p.brand || (() => { const plats = (p.attributes_data || {})._platforms || {}; for (const k in plats) { if (plats[k].brand) return plats[k].brand; } return ''; })(), category: String(p.category ?? '') });
        setAttributes(p.attributes as any);
        setMpErrors(res.data.errors ?? []);

        // Create/get shadow PIM record so Studio/Rich/Syndication work
        const attrDict = (res.data.attributes ?? []).reduce((acc: any, a: any) => {
          if (a.value) acc[a.name || a.id] = a.value;
          return acc;
        }, {});
        const vc = res.data.vendor_code || sku;
        setVendorCode(vc);
        const shadowRes = await api.post('/mp/shadow-product', {
          platform,
          sku,
          vendor_code: vc,
          name: res.data.name,
          brand: res.data.brand,
          description: res.data.description,
          images: res.data.photos ?? [],
          attributes: attrDict,
        });
        setPimId(shadowRes.data.id);
        // Load MP bindings for this vendor_code
        try {
          const bindRes = await api.get(`/mp/bindings?vendor_code=${encodeURIComponent(vc)}`);
          setMpBindings(bindRes.data.bindings || []);
        } catch {}
        return;
      }

      // PIM product
      const prodRes = await api.get(`/products/${id}`);
      const raw = prodRes.data;
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
        sku: (p.sku ?? "").replace(/^mp:/, ""),
        description: p.description_html ?? p.description ?? "",
        brand: p.brand || p.attributes_data?.brand || (() => { const plats = (p.attributes_data || {})._platforms || {}; for (const k in plats) { if (plats[k].brand) return plats[k].brand; } return ""; })(),
        category: getCatName(p.category),
      });
      const attrs = Array.isArray(p.attributes) && p.attributes.length > 0
        ? p.attributes.map((a: any) => ({
            key: a.key ?? a.name ?? a.id,
            value: a.value ?? '',
            type: a.type ?? 'string',
            dictionary_options: Array.isArray(a.dictionary_options) ? a.dictionary_options : [],
            isSuggest: a.isSuggest,
            is_multiple: a.is_multiple,
            is_required: a.is_required,
            error: a.error,
          }))
        : p.attributes_data
          ? Object.entries(p.attributes_data)
              .filter(([key]) => !key.startsWith('_'))
              .map(([key, v]: [string, any]) => ({
                key,
                value: v?.value ?? String(v ?? ""),
                type: v?.type ?? "string",
                dictionary_options: Array.isArray(v?.dictionary_options) ? v.dictionary_options : [],
                isSuggest: v?.isSuggest,
                is_multiple: v?.is_multiple,
                is_required: v?.is_required,
                error: v?.error,
              }))
          : [];
      setAttributes(attrs);

      // If this is a unified shadow-product (sku = mp:vendor_code)
      if (raw.sku && raw.sku.startsWith('mp:')) {
        const vc = raw.attributes_data?._vendor_code || raw.sku.slice(3);
        setVendorCode(vc);
        setPimId(raw.id);
        setIsShadowCard(true);
        // Load bindings (list of platforms)
        try {
          const bindRes = await api.get(`/mp/bindings?vendor_code=${encodeURIComponent(vc)}`);
          const bindings = bindRes.data.bindings || [];
          setMpBindings(bindings);
          // Auto-select first platform
          if (bindings.length > 0) {
            const firstPlatform = bindings[0].platform;
            setActivePlatform(firstPlatform);
            setMpBindingPlatform(firstPlatform);
            // Load attrs for first platform
            try {
              const liveRes = await api.get(`/mp/product-details?platform=${encodeURIComponent(firstPlatform)}&sku=${encodeURIComponent(vc)}`);
              const liveAttrs = (liveRes.data?.attributes || []).map((a: any) => ({
                key: a.name || a.id, value: a.value ?? '', type: a.type || 'string',
                is_required: a.is_required, error: a.error, dictionary_options: a.dictionary_options || [], isSuggest: a.isSuggest, is_multiple: a.is_multiple,
              }));
              setMpAttrsByPlatform(prev => ({ ...prev, [firstPlatform]: liveAttrs }));
              setMpAttrSchemaByPlatform(prev => ({ ...prev, [firstPlatform]: liveRes.data?.attributes || [] }));
              setAttributes(liveAttrs);
              if (liveRes.data?.photos?.length) {
                setProduct(prev => prev ? { ...prev, media: liveRes.data.photos.map((url: string, i: number) => ({ id: String(i), url, type: 'image' as const })) } : prev);
              }
              setMpErrors(liveRes.data?.errors || []);
            } catch {}
          }
        } catch {}
      }
    } catch {
      toast("Ошибка загрузки продукта", "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  const switchPlatform = async (platform: string) => {
    // Save current platform's edited attributes to cache before switching
    const currentPlatform = activePlatform || mpBindingPlatform || mpPlatform;
    if (currentPlatform && currentPlatform !== platform) {
      setMpAttrsByPlatform(prev => ({ ...prev, [currentPlatform]: attributes }));
    }

    setActivePlatform(platform);
    setAttrFilter("");
    setMpBindingPlatform(platform);
    // Use cached attrs if available
    if (mpAttrsByPlatform[platform]) {
      setAttributes(mpAttrsByPlatform[platform]);
      return;
    }
    try {
      const vc = vendorCode;
      const liveRes = await api.get(`/mp/product-details?platform=${encodeURIComponent(platform)}&sku=${encodeURIComponent(vc)}`);
      const liveAttrs = (liveRes.data?.attributes || []).map((a: any) => ({
        key: a.name || a.id, value: a.value ?? '', type: a.type || 'string', dictionary_options: a.dictionary_options || [], isSuggest: a.isSuggest, is_multiple: a.is_multiple,
        is_required: a.is_required, error: a.error,
      }));
      setMpAttrsByPlatform(prev => ({ ...prev, [platform]: liveAttrs }));
      setMpAttrSchemaByPlatform(prev => ({ ...prev, [platform]: liveRes.data?.attributes || [] }));
      setAttributes(liveAttrs);
      if (liveRes.data?.photos?.length) {
        setProduct(prev => prev ? { ...prev, media: liveRes.data.photos.map((url: string, i: number) => ({ id: String(i), url, type: 'image' as const })) } : prev);
      }
      setMpErrors(liveRes.data?.errors || []);
    } catch {}
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    let effectiveId = (isMpProduct && pimId) ? pimId : id;

    // Auto-create shadow product if MP product without PIM record
    if (isMpProduct && !pimId) {
      try {
        const shadowRes = await api.post('/mp/shadow-product', {
          platform: mpPlatform,
          sku: mpSku,
          vendor_code: vendorCode || mpSku,
          name: fields.name,
          brand: fields.brand,
          description: fields.description,
          images: product?.media?.map((m: any) => m.url) || [],
        });
        const newPimId = shadowRes.data?.id;
        if (newPimId) {
          setPimId(newPimId);
          effectiveId = newPimId;
        }
      } catch (e) {
        toast("Не удалось создать запись в каталоге", "error");
        return;
      }
    }

    if (!effectiveId) return;
    setSaving(true);
    try {
      // Convert attributes array to attributes_data dict for the backend
      const attributes_data: Record<string, any> = {};
      for (const attr of attributes) {
        if (attr.key) {
          attributes_data[attr.key] = attr.value ?? '';
        }
      }
      const payload: any = {
        name: fields.name,
        description_html: fields.description,
        attributes_data,
      };
      // Only include images if product has media
      if (product?.media?.length) {
        payload.images = product.media.map(m => m.url);
      }
      const res = await api.put(`/products/${effectiveId}`, payload);
      setProduct(res.data);
      toast("Продукт сохранён", "success");
    } catch {
      toast("Не удалось сохранить", "error");
    } finally {
      setSaving(false);
    }
  };

  const runEnrichWithConnection = async (connectionId: string) => {
    let effectiveId = (isMpProduct && pimId) ? pimId : id;

    // Auto-create shadow product if MP product without PIM record
    if (isMpProduct && !pimId && !effectiveId) {
      try {
        const shadowRes = await api.post('/mp/shadow-product', {
          platform: mpPlatform,
          sku: mpSku,
          vendor_code: vendorCode || mpSku,
          name: fields.name,
          brand: fields.brand,
          description: fields.description,
          images: product?.media?.map((m: any) => m.url) || [],
        });
        const newPimId = shadowRes.data?.id;
        if (newPimId) {
          setPimId(newPimId);
          effectiveId = newPimId;
        }
      } catch (e) {
        toast("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u043f\u0438\u0441\u044c", "error");
        return;
      }
    }

    if (!effectiveId) return;
    setEnriching(true);
    try {
      const res = await api.post('/syndicate/agent', {
        product_id: effectiveId,
        connection_id: connectionId,
        push: false,
        public_base_url: window.location.origin,
      });
      const d = res.data;
      if (d.mapped_payload) {
        const mp = d.mapped_payload;
        setFields((f: any) => ({
          name: mp["Наименование карточки"] || mp.name || f.name,
          sku: f.sku,
          description: mp["Описание"] || mp.description || f.description,
          brand: mp["Бренд"] || mp.brand || f.brand,
          category: f.category,
        }));
        // Update attributes from mapped_payload
        const skipKeys = new Set(["categoryId", "offer_id", "name", "Бренд", "brand", "Описание", "description", "Фото", "images", "Наименование карточки"]);
        const newAttrs: any[] = [];
        for (const [key, val] of Object.entries(mp)) {
          if (skipKeys.has(key) || key.startsWith("_")) continue;
          if (val === null || val === undefined || val === "") continue;
          newAttrs.push({
            key,
            value: Array.isArray(val) ? val.join(", ") : String(val),
            type: "string",
          });
        }
        if (newAttrs.length > 0) {
          // Merge with existing: update values for existing keys, add new ones
          const existing = [...attributes];
          for (const na of newAttrs) {
            const idx = existing.findIndex((a: any) => a.key === na.key);
            if (idx >= 0) {
              existing[idx] = { ...existing[idx], value: na.value };
            } else {
              existing.push(na);
            }
          }
          setAttributes(existing);
        }
      }
      toast(d.status === 'success' ? 'AI обогащение выполнено' : (d.message || 'Завершено с замечаниями'), d.status === 'success' ? 'success' : 'warning');
    } catch (err: any) {
      toast(err?.response?.data?.detail || "Ошибка AI обогащения", "error");
    } finally {
      setEnriching(false);
    }
  };

  const handleEnrich = async () => {
    let effectiveId = (isMpProduct && pimId) ? pimId : id;

    // Auto-create shadow product if MP product without PIM record
    if (isMpProduct && !pimId) {
      try {
        const shadowRes = await api.post('/mp/shadow-product', {
          platform: mpPlatform,
          sku: mpSku,
          vendor_code: vendorCode || mpSku,
          name: fields.name,
          brand: fields.brand,
          description: fields.description,
          images: product?.media?.map((m: any) => m.url) || [],
        });
        const newPimId = shadowRes.data?.id;
        if (newPimId) {
          setPimId(newPimId);
          effectiveId = newPimId;
        }
      } catch (e) {
        toast("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u043f\u0438\u0441\u044c \u0432 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0435", "error");
        return;
      }
    }

    if (!effectiveId) return;

    if (isMpProduct || isShadowCard) {
      const platform = activePlatform || mpBindingPlatform || mpPlatform;
      const platformConns = connections.filter((c: any) => c.type === platform);
      if (platformConns.length === 0) {
        toast("Нет подключений для этого маркетплейса", "error");
        return;
      }
      if (platformConns.length === 1) {
        await runEnrichWithConnection(platformConns[0].id);
      } else {
        setEnrichConnectionDialog(true);
      }
    } else {
      // Simple PIM enrichment
      setEnriching(true);
      try {
        const res = await api.post(`/ai/enrich/${effectiveId}`);
        const d = res.data;
        setFields((f: any) => ({
          name: d.name ?? f.name, sku: d.sku ?? f.sku,
          description: d.description ?? f.description,
          brand: d.brand ?? f.brand, category: d.category ?? f.category,
        }));
        toast("AI обогащение выполнено", "success");
      } catch { toast("Ошибка AI обогащения", "error"); }
      finally { setEnriching(false); }
    }
  };

  const handlePush = async (connectionId: string) => {
    if (!id) return;
    setPushingId(connectionId);
    try {
      let effectiveId = (isMpProduct && pimId) ? pimId : id;

      // Auto-create shadow PIM record for MP products without PIM ID
      if (isMpProduct && !pimId) {
        try {
          const shadowRes = await api.post('/mp/shadow-product', {
            platform: mpPlatform,
            sku: mpSku,
            vendor_code: vendorCode || mpSku,
            name: fields.name,
            brand: fields.brand,
            description: fields.description,
            images: product?.media?.map((m: any) => m.url) || [],
          });
          const newPimId = shadowRes.data?.id;
          if (newPimId) {
            setPimId(newPimId);
            effectiveId = newPimId;
          } else {
            toast("Не удалось создать PIM-запись для отправки", "error");
            setPushingId(null);
            return;
          }
        } catch {
          toast("Не удалось создать PIM-запись", "error");
          setPushingId(null);
          return;
        }
      }

      const res = await api.post('/syndicate/agent', {
        product_id: effectiveId,
        connection_id: connectionId,
        push: true,
        public_base_url: window.location.origin,
      });
      const d = res.data;
      if (d.status === "preflight_blocked") {
        const missing = (d.preflight_missing || []).map((m: any) => m.field).join(", ");
        toast(`Не хватает полей: ${missing}`, "warning");
      } else if (d.status === "error" || d.ok === false || d.error) {
        toast(d.message || d.error || "Ошибка при отправке", "error");
      } else {
        toast(d.message || "Продукт отправлен на маркетплейс", "success");
      }
      // Reload product to update syndication status
      const prodRes = await api.get(`/products/${effectiveId}`);
      setProduct(prodRes.data);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.message || "Ошибка синдикации";
      toast(typeof detail === "string" ? detail : JSON.stringify(detail), "error");
    } finally {
      setPushingId(null);
    }
  };

  const handleRemoveMedia = async (mediaId: string) => {
    const effectiveId = (isMpProduct && pimId) ? pimId : id;
    setProduct((p) => {
      if (!p) return p;
      const updated = p.media.filter((m) => m.id !== mediaId);
      // Save updated images to DB
      if (effectiveId) {
        const urls = updated.map((m) => m.url);
        api.put(`/products/${effectiveId}`, { images: urls }).catch(() => {});
      }
      return { ...p, media: updated };
    });
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
            {isMpProduct && (
              <span style={{ marginLeft: 10, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                {mpPlatform.toUpperCase()}
              </span>
            )}
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
            type="button"
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
                <label style={labelStyle}>Артикул продавца</label>
                <input
                  style={inputStyle}
                  value={fields.sku}
                  onChange={(e) => setFields((f) => ({ ...f, sku: e.target.value }))}
                  placeholder="SKU-12345"
                />
              </div>
              <div>
                <label style={labelStyle}>SKU маркетплейса</label>
                <input
                  style={{...inputStyle, opacity: 0.6}}
                  value={(() => {
                    const attrs = product?.attributes_data || {};
                    const plats = attrs._platforms || {};
                    const p = plats[activePlatform || mpPlatform || Object.keys(plats)[0] || ''] || {};
                    return p.marketplace_product_id || '';
                  })()}
                  readOnly
                  placeholder="Не привязан"
                />
              </div>
              <div>
                <label style={labelStyle}>Бренд</label>
                <input
                  style={inputStyle}
                  value={fields.brand}
                  onChange={(e) => setFields((f) => ({ ...f, brand: e.target.value }))}
                  placeholder="Не указан"
                />
              </div>
              <div>
                <label style={labelStyle}>Категория</label>
                <input
                  style={inputStyle}
                  value={fields.category}
                  onChange={(e) => setFields((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Категория не указана"
                />
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <label style={labelStyle}>Описание</label>
              <textarea
                style={textareaStyle}
                value={fields.description}
                onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
                placeholder="Нажмите «AI обогатить» для генерации описания"
                rows={6}
              />
            </div>
          </div>
        )}

        {/* ──────────── Атрибуты ──────────── */}
        {activeTab === "attributes" && (
          <div style={{ ...card, overflow: "hidden" }}>
            {/* Sub-tab switcher: Current attrs vs Category Schema */}
            <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {(["current", "schema"] as const).map(st => (
                <button key={st} onClick={() => {
                  setAttrSubTab(st);
                  if (st === 'schema' && !catSchemaData && !catSchemaLoading) {
                    const catId = product?.category && typeof product.category === 'object' ? (product.category as any).id : null;
                    if (catId) {
                      setCatSchemaLoading(true);
                      api.get(`/categories/${catId}/marketplace-attributes`).then(r => {
                        setCatSchemaData(r.data);
                        const mps = Object.keys(r.data.marketplaces || {});
                        if ((r.data.common_count || 0) > 0) setCatSchemaTab('common');
                        else if (mps.length > 0) setCatSchemaTab(mps[0]);
                      }).catch(console.error).finally(() => setCatSchemaLoading(false));
                    }
                  }
                }} style={{
                  flex: 1, padding: "12px 20px", border: "none", cursor: "pointer",
                  background: attrSubTab === st ? "rgba(99,102,241,0.08)" : "transparent",
                  borderBottom: attrSubTab === st ? "2px solid #6366f1" : "2px solid transparent",
                  color: attrSubTab === st ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
                  fontSize: 13, fontWeight: attrSubTab === st ? 600 : 400, transition: "all 0.15s",
                }}>
                  {st === 'current' ? 'Атрибуты товара' : 'Схема категории'}
                </button>
              ))}
            </div>

            {/* ── Category Schema sub-tab ── */}
            {attrSubTab === 'schema' && (
              <div style={{ padding: 0 }}>
                {catSchemaLoading && (
                  <div style={{ textAlign: "center", padding: "48px 0" }}>
                    <div style={{ display: "inline-block", width: 24, height: 24, border: "2px solid rgba(99,102,241,0.3)", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 10 }}>Загружаем атрибуты со всех маркетплейсов...</p>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  </div>
                )}
                {!catSchemaLoading && !catSchemaData && (
                  <div style={{ textAlign: "center", padding: "48px 24px", color: "rgba(255,255,255,0.25)" }}>
                    <p>Нет данных о категории товара</p>
                  </div>
                )}
                {!catSchemaLoading && catSchemaData && (() => {
                  const MP_COLORS: Record<string, string> = { ozon: '#005bff', megamarket: '#00b33c', wildberries: '#cb11ab', yandex: '#fc0', wb: '#cb11ab' };
                  const mpC = (t: string) => MP_COLORS[t] || '#6366f1';
                  const mpL = (t: string) => ({ ozon: 'Ozon', megamarket: 'Мегамаркет', wildberries: 'Wildberries', yandex: 'Яндекс Маркет', wb: 'Wildberries' }[t] || t);
                  const tabs: { key: string; label: string; count: number; color: string }[] = [];
                  if ((catSchemaData.common_count || 0) > 0) tabs.push({ key: 'common', label: 'Общие (ИИ)', count: catSchemaData.common_count, color: '#6366f1' });
                  for (const [mp, d] of Object.entries(catSchemaData.marketplaces || {})) tabs.push({ key: mp, label: mpL(mp), count: (d as any).total || 0, color: mpC(mp) });

                  let attrs: any[] = [];
                  if (catSchemaTab === 'common') {
                    attrs = (catSchemaData.common_attributes || []).map((ca: any) => ({
                      id: ca.normalized, name: ca.name,
                      type: (Object.values(ca.marketplaces || {}) as any[])[0]?.type || '',
                      is_required: ca.is_required_any, _common: true, _variants: ca.marketplaces,
                    }));
                  } else {
                    const mp = catSchemaData.marketplaces?.[catSchemaTab];
                    attrs = mp ? (mp.attributes || []) : [];
                  }
                  const q = catSchemaSearch.trim().toLowerCase();
                  const filtered = q ? attrs.filter((a: any) => (a.name || '').toLowerCase().includes(q) || String(a.id || '').toLowerCase().includes(q)) : attrs;

                  return (
                    <>
                      {/* Stats */}
                      <div style={{ display: "flex", gap: 8, padding: "12px 16px", flexWrap: "wrap", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        {Object.entries(catSchemaData.marketplaces || {}).map(([mp, d]: [string, any]) => (
                          <div key={mp} style={{ background: `${mpC(mp)}10`, border: `1px solid ${mpC(mp)}30`, borderRadius: 8, padding: "6px 12px", fontSize: 11 }}>
                            <span style={{ color: mpC(mp), fontWeight: 700 }}>{d.total}</span>
                            <span style={{ color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>{mpL(mp)}</span>
                          </div>
                        ))}
                        {(catSchemaData.common_count || 0) > 0 && (
                          <div style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, padding: "6px 12px", fontSize: 11 }}>
                            <span style={{ color: "#6366f1", fontWeight: 700 }}>{catSchemaData.common_count}</span>
                            <span style={{ color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>общих</span>
                          </div>
                        )}
                        {/* Autofill button */}
                        <button
                          disabled={Object.values(autofillLoading).some(Boolean)}
                          onClick={async () => {
                            const sourceAttrs: Record<string, any> = {};
                            attributes.forEach((a: any) => { if (a.value) sourceAttrs[a.key] = a.value; });
                            if (Object.keys(sourceAttrs).length === 0) { alert('Нет заполненных атрибутов для маппинга'); return; }
                            const mps = Object.entries(catSchemaData.marketplaces || {});
                            for (const [mp, d] of mps) {
                              setAutofillLoading(prev => ({ ...prev, [mp]: true }));
                              try {
                                const res = await api.post(`/products/${product?.id || 'unknown'}/autofill-mp-attributes`, {
                                  target_platform: mp,
                                  target_category_id: (d as any).category_id,
                                  source_attributes: sourceAttrs,
                                });
                                setAutofillResults(prev => ({ ...prev, [mp]: res.data }));
                              } catch (e) { console.error(e); }
                              setAutofillLoading(prev => ({ ...prev, [mp]: false }));
                            }
                          }}
                          style={{
                            background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)",
                            borderRadius: 8, padding: "6px 14px", fontSize: 11, fontWeight: 600,
                            color: "#10b981", cursor: "pointer", whiteSpace: "nowrap",
                            opacity: Object.values(autofillLoading).some(Boolean) ? 0.5 : 1,
                          }}
                        >
                          {Object.values(autofillLoading).some(Boolean) ? 'ИИ заполняет...' : 'ИИ автозаполнение'}
                        </button>
                      </div>
                      {/* Autofill results */}
                      {Object.keys(autofillResults).length > 0 && catSchemaTab !== 'common' && autofillResults[catSchemaTab] && (
                        <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(16,185,129,0.04)" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#10b981", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span>ИИ заполнил {autofillResults[catSchemaTab]?.filled_count || 0} атрибутов для {mpL(catSchemaTab)}</span>
                            <button onClick={() => {
                              const filled = autofillResults[catSchemaTab]?.filled || {};
                              const newAttrs = [...attributes];
                              for (const [name, value] of Object.entries(filled)) {
                                const idx = newAttrs.findIndex((a: any) => a.key.toLowerCase() === (name as string).toLowerCase());
                                if (idx >= 0) {
                                  newAttrs[idx] = { ...newAttrs[idx], value: value as string };
                                } else {
                                  newAttrs.push({ key: name as string, value: value as string, type: 'string' });
                                }
                              }
                              setAttributes(newAttrs);
                              setAttrSubTab('current');
                            }} style={{
                              background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)",
                              borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 600,
                              color: "#10b981", cursor: "pointer",
                            }}>
                              Применить к товару
                            </button>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                            {Object.entries(autofillResults[catSchemaTab]?.filled || {}).map(([k, v]: [string, any]) => (
                              <div key={k} style={{ display: "flex", gap: 8, fontSize: 11 }}>
                                <span style={{ color: "rgba(255,255,255,0.5)", minWidth: 180 }}>{k}</span>
                                <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Errors */}
                      {Object.keys(catSchemaData.errors || {}).length > 0 && (
                        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                          {Object.entries(catSchemaData.errors).map(([mp, e]: [string, any]) => <div key={mp}><span style={{ color: "#f87171" }}>{mpL(mp)}:</span> {e}</div>)}
                        </div>
                      )}
                      {/* Tabs */}
                      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", overflowX: "auto" }}>
                        {tabs.map(t => (
                          <button key={t.key} onClick={() => { setCatSchemaTab(t.key); setCatSchemaSearch(''); }} style={{
                            background: "none", border: "none", padding: "10px 16px", cursor: "pointer",
                            borderBottom: catSchemaTab === t.key ? `2px solid ${t.color}` : "2px solid transparent",
                            color: catSchemaTab === t.key ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)",
                            fontSize: 12, fontWeight: catSchemaTab === t.key ? 600 : 400, whiteSpace: "nowrap",
                          }}>
                            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: t.color, marginRight: 6, opacity: catSchemaTab === t.key ? 1 : 0.4 }} />
                            {t.label}
                            <span style={{ marginLeft: 6, background: catSchemaTab === t.key ? `${t.color}22` : "rgba(255,255,255,0.05)", color: catSchemaTab === t.key ? t.color : "rgba(255,255,255,0.25)", padding: "1px 6px", borderRadius: 12, fontSize: 10, fontWeight: 600 }}>{t.count}</span>
                          </button>
                        ))}
                      </div>
                      {/* Search */}
                      <div style={{ display: "flex", gap: 8, padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", alignItems: "center" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input value={catSchemaSearch} onChange={e => setCatSchemaSearch(e.target.value)} placeholder="Поиск..." style={{ background: "transparent", border: "none", outline: "none", color: "rgba(255,255,255,0.85)", fontSize: 12, flex: 1 }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{filtered.length} / {attrs.length}</span>
                      </div>
                      {/* Table */}
                      {filtered.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "32px 0", fontSize: 12, color: "rgba(255,255,255,0.2)" }}>Нет атрибутов</div>
                      ) : (
                        <div style={{ maxHeight: 500, overflowY: "auto" }}>
                          <table className="table-premium" style={{ minWidth: 500, fontSize: 12 }}>
                            <thead><tr><th style={{ width: 40 }}>#</th><th>ID</th><th>Название</th><th>Тип</th><th>Обяз.</th>{catSchemaTab === 'common' && <th>МП</th>}{catSchemaTab !== 'common' && <th>Словарь</th>}</tr></thead>
                            <tbody>
                              {filtered.map((a: any, i: number) => (
                                <tr key={a.id || i}>
                                  <td style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>{i+1}</td>
                                  <td><span style={{ fontFamily: "monospace", fontSize: 10, color: mpC(catSchemaTab === 'common' ? '' : catSchemaTab) }}>{a.id}</span></td>
                                  <td style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{a.name}</td>
                                  <td><span className="badge badge-neutral" style={{ fontSize: 10 }}>{a.type || '—'}</span></td>
                                  <td>{a.is_required ? <span className="badge badge-error" style={{ fontSize: 10 }}>Да</span> : <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>Нет</span>}</td>
                                  {catSchemaTab === 'common' && <td><div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>{Object.keys(a._variants || {}).map((mp: string) => <span key={mp} style={{ background: `${mpC(mp)}18`, color: mpC(mp), padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600 }}>{mpL(mp)}</span>)}</div></td>}
                                  {catSchemaTab !== 'common' && <td>{a.dictionary_options?.length > 0 ? <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{a.dictionary_options.length} знач.</span> : <span style={{ color: "rgba(255,255,255,0.12)", fontSize: 10 }}>—</span>}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* ── Current attrs sub-tab ── */}
            {attrSubTab === 'current' && (<>
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
                {mpErrors.length > 0 && (
                  <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: "rgba(248,113,113,0.15)", color: "#f87171", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <AlertCircle size={11} /> {mpErrors.length} ошибок
                  </span>
                )}
              </h2>
              <button onClick={addAttr} style={btnSecondary}>
                <Plus size={14} />
                Добавить
              </button>
            </div>

            {/* Error summary for MP */}
            {isMpProduct && mpErrors.length > 0 && (
              <div style={{ background: "rgba(248,113,113,0.07)", borderBottom: "1px solid rgba(248,113,113,0.15)", padding: "14px 24px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#f87171", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <AlertCircle size={13} /> Найдено {mpErrors.length} ошибки — исправьте выделенные поля
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {mpErrors.map((e: any, i: number) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ color: "#f87171", fontWeight: 600, fontSize: 12, flexShrink: 0 }}>{e.attributeName}</span>
                      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{e.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}


            {/* ── MP Platform switcher ── */}
            {mpBindings.length > 0 && (
              <div style={{ display: "flex", gap: 6, padding: "10px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", alignSelf: "center", marginRight: 4 }}>Маркетплейс:</span>
                {mpBindings.map((b: any) => {
                  const icons: Record<string,string> = { ozon: "🟦", wb: "🟣", wildberries: "🟣", yandex: "🟡", megamarket: "🟢" };
                  const isActive = b.platform === (activePlatform || mpBindingPlatform || mpPlatform);
                  return (
                    <button
                      key={b.platform}
                      type="button"
                      onClick={() => switchPlatform(b.platform)}
                      style={{
                        display: "flex", alignItems: "center", gap: 5, padding: "5px 12px",
                        borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${isActive ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.08)"}`,
                        background: isActive ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.05)",
                        color: isActive ? "#a5b4fc" : "rgba(255,255,255,0.6)",
                        transition: "all 0.15s",
                      }}
                    >
                      <span>{icons[b.platform] || "🔘"}</span>
                      <span style={{ textTransform: "capitalize" }}>{b.platform}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* Attribute filter */}
            {attributes.length > 5 && (
              <div style={{ display: "flex", gap: 10, padding: "10px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", alignItems: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  value={attrFilter}
                  onChange={e => setAttrFilter(e.target.value)}
                  placeholder="Фильтр атрибутов..."
                  style={{ background: "transparent", border: "none", outline: "none", color: "rgba(255,255,255,0.85)", fontSize: 13, flex: 1 }}
                />
                {attrFilter && (
                  <button onClick={() => setAttrFilter('')} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>&times;</button>
                )}
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                  {attributes.filter(a => {
                    if (!attrFilter.trim()) return true;
                    const q = attrFilter.trim().toLowerCase();
                    return a.key.toLowerCase().includes(q) || String(a.value || '').toLowerCase().includes(q);
                  }).length} / {attributes.length}
                </span>
              </div>
            )}

            {/* Header row */}
            {!isMpProduct && <div
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
            </div>}

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
                {(isMpProduct || isShadowCard) ? (
                  // ── MP attrs with errors highlighted + dropdowns ──
                  // key=activePlatform forces remount on platform switch (needed for defaultValue inputs)
                  <React.Fragment key={activePlatform || 'mp'}>
                  {attributes.filter(attr => {
                    if (!attrFilter.trim()) return true;
                    const q = attrFilter.trim().toLowerCase();
                    return attr.key.toLowerCase().includes(q) || String(attr.value || '').toLowerCase().includes(q);
                  }).map((attr, idx) => {
                    const hasError = !!(attr as any).error;
                    const opts: any[] = Array.isArray((attr as any).dictionary_options) ? (attr as any).dictionary_options : [];
                    const isSuggest = (attr as any).isSuggest;
                    const isRequired = (attr as any).is_required;
                    const isEmpty = !attr.value;
                    return (
                      <div key={idx} style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        background: hasError ? "rgba(248,113,113,0.04)" : "transparent",
                        borderLeft: hasError ? "3px solid rgba(248,113,113,0.6)" : "3px solid transparent",
                      }}>
                        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", padding: "11px 24px 11px 21px", alignItems: "start", gap: 16 }}>
                          {/* Label */}
                          <div style={{ paddingTop: 7 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              {hasError && <AlertCircle size={12} color="#f87171" style={{ flexShrink: 0 }} />}
                              <span style={{ fontSize: 13, color: hasError ? "#f87171" : isRequired ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.55)", fontWeight: hasError || isRequired ? 600 : 400 }}>
                                {attr.key}
                                {isRequired && !hasError && <span style={{ color: "rgba(248,113,113,0.7)", marginLeft: 3 }}>*</span>}
                              </span>
                            </div>
                          </div>
                          {/* Value or dropdown */}
                          <div>
                            {opts.length > 0 && !isSuggest ? (
                              <select
                                defaultValue={attr.value}
                                onChange={(e) => {
                                  const newAttrs = [...attributes];
                                  newAttrs[idx] = { ...newAttrs[idx], value: e.target.value };
                                  setAttributes(newAttrs);
                                }}
                                style={{ ...inputStyle, padding: "7px 12px", width: "100%", cursor: "pointer",
                                  borderColor: hasError ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.08)",
                                  background: hasError ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.04)",
                                  color: "rgba(255,255,255,0.85)" }}
                              >
                                <option value="">— выберите —</option>
                                {opts.map((o: any) => (
                                  <option key={o.id ?? o.name} value={o.name ?? o.id}>{o.name ?? o.id}</option>
                                ))}
                              </select>
                            ) : isSuggest && opts.length > 0 ? (
                              <>
                                <input
                                  list={`suggest-${idx}`}
                                  style={{ ...inputStyle, padding: "7px 12px", width: "100%", boxSizing: "border-box",
                                    borderColor: hasError ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.08)",
                                    background: hasError ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.04)",
                                    color: isEmpty ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                                  defaultValue={attr.value}
                                  placeholder={isEmpty ? "Введите или выберите" : undefined}
                                  onChange={(e) => {
                                    const newAttrs = [...attributes];
                                    newAttrs[idx] = { ...newAttrs[idx], value: e.target.value };
                                    setAttributes(newAttrs);
                                  }}
                                />
                                <datalist id={`suggest-${idx}`}>
                                  {opts.map((o: any) => (
                                    <option key={o.id ?? o.name} value={o.name ?? o.id} />
                                  ))}
                                </datalist>
                              </>
                            ) : (
                              <input
                                style={{ ...inputStyle, padding: "7px 12px", width: "100%", boxSizing: "border-box",
                                  borderColor: hasError ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.08)",
                                  background: hasError ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.04)",
                                  color: isEmpty ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                                defaultValue={attr.value}
                                placeholder={isEmpty ? "Не заполнено" : undefined}
                                onChange={(e) => {
                                  const newAttrs = [...attributes];
                                  newAttrs[idx] = { ...newAttrs[idx], value: e.target.value };
                                  setAttributes(newAttrs);
                                }}
                              />
                            )}
                            {hasError && (
                              <div style={{ display: "flex", alignItems: "flex-start", gap: 5, marginTop: 6, fontSize: 12, color: "#f87171", lineHeight: 1.4 }}>
                                <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                                {(attr as any).error}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </React.Fragment>
                ) : (
                  // ── PIM editable attrs ──
                  attributes.map((attr, idx) => (
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
                  ))
                )}
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
            </>)}
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
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (!files.length) return;
                    const effectiveId = (isMpProduct && pimId) ? pimId : id;
                    if (!effectiveId) return;
                    const newUrls: string[] = [];
                    for (const file of files) {
                      try {
                        const fd = new FormData();
                        fd.append('file', file);
                        const res = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                        newUrls.push(res.data.url);
                      } catch { toast('Ошибка загрузки ' + file.name, 'error'); }
                    }
                    if (newUrls.length) {
                      setProduct((p) => {
                        if (!p) return p;
                        const existing = p.media.map((m) => m.url);
                        const added = newUrls.map((url, i) => ({ id: String(Date.now() + i), url, type: 'image' as const }));
                        const updated = [...p.media, ...added];
                        const allUrls = [...existing, ...newUrls];
                        api.put(`/products/${effectiveId}`, { images: allUrls }).catch(() => {});
                        return { ...p, media: updated };
                      });
                      toast(`Загружено ${newUrls.length} фото`, 'success');
                    }
                    e.target.value = '';
                  }}
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
                          {({megamarket: "Мегамаркет", ozon: "Ozon", wildberries: "Wildberries", yandex: "Яндекс.Маркет"} as Record<string, string>)[conn.type] || conn.type || conn.marketplace}
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
        <TabErrorBoundary key="studio">
          <div style={{ padding: "0 16px 24px" }}>
            <ContentStudio product={isMpProduct && pimId ? { ...product, id: pimId } : product} />
          </div>
        </TabErrorBoundary>
      )}

      {activeTab === "rich" && product && (
        <TabErrorBoundary key="rich">
          <div style={{ padding: "0 16px 24px" }}>
            <RichContentEditor product={isMpProduct && pimId ? { ...product, id: pimId } : product} />
          </div>
        </TabErrorBoundary>
      )}

      {activeTab === "social" && product && (
        <TabErrorBoundary key="social">
          <SocialContentEditor product={product} />
        </TabErrorBoundary>
      )}

      {/* Connection chooser modal for AI enrichment */}
      {enrichConnectionDialog && (
        <div style={{position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center'}}>
          <div onClick={() => setEnrichConnectionDialog(false)} style={{position:'absolute', inset:0, background:'rgba(0,0,0,0.6)'}} />
          <div style={{position:'relative', background:'#12121f', borderRadius:16, padding:32, maxWidth:400, width:'90%', border:'1px solid rgba(99,102,241,0.2)'}}>
            <h3 style={{margin:'0 0 16px', fontSize:18, fontWeight:700, color:'#fff'}}>Выберите подключение</h3>
            <p style={{fontSize:13, color:'rgba(255,255,255,0.4)', marginBottom:20}}>AI заполнит атрибуты для выбранного маркетплейса</p>
            <div style={{display:'flex', flexDirection:'column' as const, gap:8}}>
              {connections.filter((c: any) => c.type === (activePlatform || mpPlatform)).map((c) => (
                <button key={c.id} onClick={() => { setEnrichConnectionDialog(false); runEnrichWithConnection(c.id); }}
                  style={{padding:'12px 16px', borderRadius:10, border:'1px solid rgba(99,102,241,0.2)', background:'rgba(99,102,241,0.06)', color:'#fff', cursor:'pointer', textAlign:'left' as const, fontSize:14}}>
                  {c.name || c.type}
                </button>
              ))}
            </div>
            <button onClick={() => setEnrichConnectionDialog(false)} style={{marginTop:16, width:'100%', padding:'10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'rgba(255,255,255,0.5)', cursor:'pointer'}}>
              Отмена
            </button>
          </div>
        </div>
      )}

    </div>
  );
}