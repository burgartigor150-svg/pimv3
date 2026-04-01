import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Trash2,
  Edit3,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Link,
  Package,
  CheckSquare,
  Square,
  Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  completeness: number;
  status: string;
  image_url?: string;
}

interface ProductsResponse {
  items: Product[];
  total: number;
  pages: number;
}

interface Connection {
  id: string;
  name: string;
  type: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  backdropFilter: 'blur(20px)',
};

function CompletenessBar({ value }: { value: number }) {
  const color = value >= 80 ? '#10b981' : value >= 50 ? '#f59e0b' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
      <div
        style={{
          flex: 1,
          height: 5,
          background: 'rgba(255,255,255,0.07)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${value}%`,
            background: color,
            borderRadius: 3,
            transition: 'width 0.5s ease',
          }}
        />
      </div>
      <span style={{ color, fontSize: 11, fontWeight: 600, minWidth: 28 }}>{value}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    active:   { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', label: 'Активный' },
    draft:    { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', label: 'Черновик' },
    archived: { bg: 'rgba(248,113,113,0.12)', color: '#f87171', label: 'Архив' },
    default:  { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', label: status },
  };
  const s = map[status] ?? map.default;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        borderRadius: 6,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
}

// ─── Import Modal ─────────────────────────────────────────────────────────────

interface ImportModalProps {
  connections: Connection[];
  onClose: () => void;
  onDone: () => void;
}

function ImportModal({ connections, onClose, onDone }: ImportModalProps) {
  const { toast } = useToast();
  const [urls, setUrls] = useState(['']);
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');
  const [loading, setLoading] = useState(false);

  const addUrl = () => setUrls((u) => [...u, '']);
  const removeUrl = (i: number) => setUrls((u) => u.filter((_, idx) => idx !== i));
  const setUrl = (i: number, val: string) => setUrls((u) => u.map((v, idx) => (idx === i ? val : v)));

  const handleImport = async () => {
    const validUrls = urls.filter(Boolean);
    if (!validUrls.length) { toast('Введите хотя бы один URL', 'error'); return; }
    if (!connectionId) { toast('Выберите подключение', 'error'); return; }
    setLoading(true);
    try {
      if (validUrls.length === 1) {
        await api.post('/import/product', { url: validUrls[0], connection_id: connectionId });
        toast('Товар поставлен в очередь', 'success');
      } else {
        const res = await api.post('/import/bulk', { urls: validUrls, connection_id: connectionId });
        const taskId = res.data?.task_id;
        if (taskId) {
          toast('Задача импорта создана, ждём…', 'info');
          // poll
          const poll = async () => {
            const s = await api.get(`/import/tasks/${taskId}`);
            if (s.data?.status === 'completed') {
              toast('Импорт завершён', 'success');
            } else if (s.data?.status === 'failed') {
              toast('Импорт завершился с ошибкой', 'error');
            } else {
              setTimeout(poll, 2000);
            }
          };
          poll();
        }
      }
      onDone();
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? e?.message ?? 'Ошибка импорта', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          ...CARD_STYLE,
          padding: 32,
          width: '100%',
          maxWidth: 520,
          position: 'relative',
        }}
        className="animate-fade-up"
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={18} />
        </button>

        <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700 }}>Импорт товаров</h2>

        {/* Connection selector */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 8 }}>
            Подключение
          </label>
          <select
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            className="input-premium"
            style={{ width: '100%', padding: '10px 14px' }}
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
            {connections.length === 0 && <option value="">Нет подключений</option>}
          </select>
        </div>

        {/* URL inputs */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 8 }}>
            URL товаров
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {urls.map((url, i) => (
              <div key={i} style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <Link
                    size={14}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'rgba(255,255,255,0.25)',
                    }}
                  />
                  <input
                    className="input-premium"
                    style={{ width: '100%', paddingLeft: 36, paddingRight: 12, paddingTop: 10, paddingBottom: 10, boxSizing: 'border-box' }}
                    placeholder="https://..."
                    value={url}
                    onChange={(e) => setUrl(i, e.target.value)}
                  />
                </div>
                {urls.length > 1 && (
                  <button
                    onClick={() => removeUrl(i)}
                    style={{
                      background: 'rgba(248,113,113,0.1)',
                      border: '1px solid rgba(248,113,113,0.2)',
                      borderRadius: 8,
                      color: '#f87171',
                      cursor: 'pointer',
                      padding: '0 12px',
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={addUrl}
          style={{
            background: 'none',
            border: '1px dashed rgba(99,102,241,0.4)',
            borderRadius: 8,
            color: '#6366f1',
            cursor: 'pointer',
            padding: '8px 16px',
            fontSize: 13,
            width: '100%',
            marginBottom: 24,
          }}
        >
          + Добавить ещё URL
        </button>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              padding: '12px 20px',
              fontSize: 14,
            }}
          >
            Отмена
          </button>
          <button
            className="btn-glow"
            onClick={handleImport}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px 20px',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            {loading ? 'Импорт…' : 'Импортировать'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProductsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const fetchProducts = useCallback(async (p = page, s = search, cat = category) => {
    setLoading(true);
    try {
      const res = await api.get<ProductsResponse>(
        `/products?page=${p}&limit=50&search=${encodeURIComponent(s)}&category=${encodeURIComponent(cat)}`
      );
      const rawData = res.data;
      const items = Array.isArray(rawData) ? rawData : (rawData.items ?? []);
      setProducts(items);
      setTotal(Array.isArray(rawData) ? rawData.length : (rawData.total ?? items.length));
      setPages(Array.isArray(rawData) ? 1 : (rawData.pages ?? 1));
    } catch (e: any) {
      toast(e?.message ?? 'Ошибка загрузки товаров', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, category, toast]);

  useEffect(() => { fetchProducts(); }, [page, category]);

  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      fetchProducts(1, search, category);
    }, 400);
    return () => clearTimeout(searchTimeout.current);
  }, [search]);

  useEffect(() => {
    api.get<Connection[]>('/connections').then((r) => {
      setConnections(Array.isArray(r.data) ? r.data : []);
    });
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map((p) => p.id)));
    }
  };

  const handleAiGenerate = async () => {
    if (!selected.size) return;
    setAiLoading(true);
    try {
      await api.post('/ai/generate-bulk', { product_ids: Array.from(selected) });
      toast(`ИИ генерация запущена для ${selected.size} товаров`, 'success');
      setSelected(new Set());
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? 'Ошибка ИИ генерации', 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!selected.size) return;
    setBulkDeleteLoading(true);
    try {
      await Promise.all(Array.from(selected).map((id) => api.delete(`/products/${id}`)));
      toast(`Удалено ${selected.size} товаров`, 'success');
      setSelected(new Set());
      fetchProducts();
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? 'Ошибка удаления', 'error');
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const handleDeleteOne = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.delete(`/products/${id}`);
      toast('Товар удалён', 'success');
      fetchProducts();
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? 'Ошибка удаления', 'error');
    }
  };

  const allSelected = products.length > 0 && selected.size === products.length;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#03030a',
        color: 'rgba(255,255,255,0.9)',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '32px 40px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background orbs */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: '-20%',
            right: '-10%',
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)',
            animation: 'orbFloat 14s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-15%',
            left: '-5%',
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(168,85,247,0.07) 0%, transparent 70%)',
            animation: 'orbFloat 18s ease-in-out infinite reverse',
          }}
        />
        <style>{`
          @keyframes orbFloat {
            0%, 100% { transform: translate(0,0) scale(1); }
            33% { transform: translate(20px,-15px) scale(1.04); }
            66% { transform: translate(-15px,10px) scale(0.97); }
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes slideDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1400, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Package size={24} color="#6366f1" />
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' }}>Товары</h1>
            <span
              className="badge-purple"
              style={{ fontSize: 13, padding: '3px 12px' }}
            >
              {total.toLocaleString()}
            </span>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button
              className="btn-glow"
              onClick={() => setShowImport(true)}
              style={{ padding: '10px 22px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <Plus size={16} />
              Импортировать
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, maxWidth: 360, position: 'relative' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'rgba(255,255,255,0.25)',
              }}
            />
            <input
              className="input-premium"
              style={{ width: '100%', paddingLeft: 36, paddingRight: 12, paddingTop: 10, paddingBottom: 10, boxSizing: 'border-box' }}
              placeholder="Поиск по названию, SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input-premium"
            style={{ padding: '10px 14px', minWidth: 180 }}
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
          >
            <option value="">Все категории</option>
            <option value="electronics">Электроника</option>
            <option value="clothing">Одежда</option>
            <option value="food">Продукты</option>
            <option value="sport">Спорт</option>
            <option value="home">Дом</option>
          </select>
        </div>

        {/* Bulk actions bar */}
        {selected.size > 0 && (
          <div
            style={{
              ...CARD_STYLE,
              padding: '12px 20px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              animation: 'slideDown 0.2s ease',
              borderColor: 'rgba(99,102,241,0.25)',
            }}
          >
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
              Выбрано{' '}
              <strong style={{ color: 'rgba(255,255,255,0.9)' }}>{selected.size}</strong>
            </span>
            <button
              className="btn-glow"
              onClick={handleAiGenerate}
              disabled={aiLoading}
              style={{ padding: '7px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {aiLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={14} />}
              ИИ генерация
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleteLoading}
              style={{
                background: 'rgba(248,113,113,0.1)',
                border: '1px solid rgba(248,113,113,0.25)',
                borderRadius: 8,
                color: '#f87171',
                cursor: 'pointer',
                padding: '7px 16px',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {bulkDeleteLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
              Удалить {selected.size}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Table */}
        <div style={{ ...CARD_STYLE, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {[
                  { content: (
                    <button
                      onClick={toggleAll}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.45)', padding: 0 }}
                    >
                      {allSelected ? <CheckSquare size={16} color="#6366f1" /> : <Square size={16} />}
                    </button>
                  ), w: 44 },
                  { content: '', w: 56 },
                  { content: 'SKU', w: 120 },
                  { content: 'Название', w: 'auto' },
                  { content: 'Бренд', w: 120 },
                  { content: 'Категория', w: 140 },
                  { content: 'Заполненность', w: 140 },
                  { content: 'Статус', w: 110 },
                  { content: '', w: 88 },
                ].map((col, i) => (
                  <th
                    key={i}
                    style={{
                      padding: '14px 16px',
                      textAlign: 'left',
                      color: 'rgba(255,255,255,0.35)',
                      fontSize: 12,
                      fontWeight: 500,
                      width: col.w,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col.content}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      padding: 60,
                      textAlign: 'center',
                      color: 'rgba(255,255,255,0.25)',
                      fontSize: 15,
                    }}
                  >
                    <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', opacity: 0.5 }} />
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      padding: 60,
                      textAlign: 'center',
                      color: 'rgba(255,255,255,0.2)',
                      fontSize: 15,
                    }}
                  >
                    Товары не найдены
                  </td>
                </tr>
              ) : (
                products.map((product, idx) => {
                  const isSelected = selected.has(product.id);
                  return (
                    <tr
                      key={product.id}
                      onClick={() => navigate(`/products/${product.id}`)}
                      style={{
                        borderBottom:
                          idx < products.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        background: isSelected ? 'rgba(99,102,241,0.06)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = isSelected
                          ? 'rgba(99,102,241,0.06)'
                          : 'transparent';
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ padding: '12px 16px' }} onClick={(e) => { e.stopPropagation(); toggleSelect(product.id); }}>
                        {isSelected ? (
                          <CheckSquare size={16} color="#6366f1" style={{ display: 'block' }} />
                        ) : (
                          <Square size={16} color="rgba(255,255,255,0.25)" style={{ display: 'block' }} />
                        )}
                      </td>
                      {/* Image */}
                      <td style={{ padding: '12px 16px' }}>
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt=""
                            style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', display: 'block' }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 8,
                              background: 'rgba(255,255,255,0.05)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Package size={16} color="rgba(255,255,255,0.2)" />
                          </div>
                        )}
                      </td>
                      {/* SKU */}
                      <td style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.45)', fontSize: 12, fontFamily: 'monospace' }}>
                        {product.sku}
                      </td>
                      {/* Name */}
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            color: 'rgba(255,255,255,0.85)',
                            fontSize: 14,
                            fontWeight: 500,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {product.name}
                        </span>
                      </td>
                      {/* Brand */}
                      <td style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                        {product.brand}
                      </td>
                      {/* Category */}
                      <td style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
                        {product.category}
                      </td>
                      {/* Completeness */}
                      <td style={{ padding: '12px 16px' }}>
                        <CompletenessBar value={product.completeness ?? 0} />
                      </td>
                      {/* Status */}
                      <td style={{ padding: '12px 16px' }}>
                        <StatusBadge status={product.status} />
                      </td>
                      {/* Actions */}
                      <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => navigate(`/products/${product.id}`)}
                            title="Редактировать"
                            style={{
                              background: 'rgba(99,102,241,0.1)',
                              border: '1px solid rgba(99,102,241,0.2)',
                              borderRadius: 7,
                              color: '#6366f1',
                              cursor: 'pointer',
                              padding: '6px 8px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            onClick={(e) => handleDeleteOne(product.id, e)}
                            title="Удалить"
                            style={{
                              background: 'rgba(248,113,113,0.08)',
                              border: '1px solid rgba(248,113,113,0.2)',
                              borderRadius: 7,
                              color: '#f87171',
                              cursor: 'pointer',
                              padding: '6px 8px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              marginTop: 24,
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                color: page <= 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                padding: '7px 12px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    background: page === p ? 'linear-gradient(135deg, #6366f1, #a855f7)' : 'rgba(255,255,255,0.04)',
                    border: page === p ? 'none' : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    color: page === p ? '#fff' : 'rgba(255,255,255,0.55)',
                    cursor: 'pointer',
                    padding: '7px 13px',
                    fontSize: 14,
                    fontWeight: page === p ? 600 : 400,
                  }}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                color: page >= pages ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)',
                cursor: page >= pages ? 'not-allowed' : 'pointer',
                padding: '7px 12px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <ImportModal
          connections={connections}
          onClose={() => setShowImport(false)}
          onDone={() => fetchProducts(1, search, category)}
        />
      )}
    </div>
  );
}
