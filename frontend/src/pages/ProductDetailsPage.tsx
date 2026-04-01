import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { connectionOptionLabel, syndicationStepHint } from '../lib/marketplaceUi';
import { Sparkles, Save, Share2, ArrowLeft, Package, Tag, Image, ExternalLink, Plus, Trash2, Send, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '../components/Toast';

interface ProductAttr { key: string; value: string; type?: string }
interface Connection { id: string; name: string; type: string }
interface SyndStatus { connection_id: string; status: string; last_pushed_at?: string; external_id?: string }

interface Product {
  id: string; name: string; sku: string; description: string; brand: string;
  category: string; status: string; attributes: ProductAttr[]; images: string[];
  syndication?: SyndStatus[];
}

const TABS = [
  { id: 'main', label: 'Основное', icon: <Package size={14} /> },
  { id: 'attrs', label: 'Атрибуты', icon: <Tag size={14} /> },
  { id: 'media', label: 'Медиа', icon: <Image size={14} /> },
  { id: 'synd', label: 'Синдикация', icon: <Share2 size={14} /> },
];

const STATUS_COLORS: Record<string, string> = {
  active: '#10b981', draft: '#f59e0b', archived: '#6b7280',
};

export default function ProductDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [product, setProduct] = useState<Product | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeTab, setActiveTab] = useState('main');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [prod, conns] = await Promise.all([
        api.get(`/products/${id}`).then(r => r.data),
        api.get('/connections').then(r => r.data),
      ]);
      setProduct(prod);
      setConnections(Array.isArray(conns) ? conns : (conns.connections || conns.items || []));
    } catch { toast('Ошибка загрузки товара', 'error'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!product) return;
    setSaving(true);
    try {
      await api.put(`/products/${id}`, product);
      toast('Сохранено', 'success');
    } catch { toast('Ошибка сохранения', 'error'); }
    finally { setSaving(false); }
  };

  const enrich = async () => {
    setEnriching(true);
    try {
      const res = await api.post(`/ai/enrich/${id}`);
      setProduct(p => p ? { ...p, ...res.data } : p);
      toast('ИИ обогащение завершено', 'success');
    } catch { toast('Ошибка обогащения', 'error'); }
    finally { setEnriching(false); }
  };

  const push = async (connId: string) => {
    setPushingId(connId);
    try {
      await api.post(`/syndication/push/${id}`, { connection_id: connId });
      toast('Отправлено на маркетплейс', 'success');
      load();
    } catch { toast('Ошибка отправки', 'error'); }
    finally { setPushingId(null); }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'rgba(255,255,255,0.3)', gap: 12 }}>
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
      Загрузка...
    </div>
  );

  if (!product) return (
    <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.3)' }}>Товар не найден</div>
  );

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            to="/products"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 13,
              padding: '6px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <ArrowLeft size={14} /> Назад
          </Link>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.02em', margin: 0 }}>
              {product.name || 'Без названия'}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>SKU: {product.sku}</span>
              {product.status && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: `rgba(${product.status === 'active' ? '16,185,129' : product.status === 'draft' ? '245,158,11' : '107,114,128'},0.15)`,
                  color: STATUS_COLORS[product.status] || '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  {product.status}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={enrich}
            disabled={enriching}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 8, fontSize: 13,
              background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)',
              color: '#c084fc', cursor: enriching ? 'not-allowed' : 'pointer',
              opacity: enriching ? 0.6 : 1,
            }}
          >
            {enriching ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={14} />}
            ИИ-обогащение
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="btn-glow"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8, fontSize: 13,
              opacity: saving ? 0.7 : 1, cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
            Сохранить
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 4, width: 'fit-content', border: '1px solid rgba(255,255,255,0.06)' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 9, fontSize: 13,
              background: activeTab === tab.id ? 'rgba(99,102,241,0.15)' : 'transparent',
              border: activeTab === tab.id ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
              color: activeTab === tab.id ? '#818cf8' : 'rgba(255,255,255,0.4)',
              cursor: 'pointer', fontWeight: activeTab === tab.id ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Основное */}
      {activeTab === 'main' && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 28 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            {([
              { field: 'name', label: 'Название' },
              { field: 'sku', label: 'SKU' },
              { field: 'brand', label: 'Бренд' },
              { field: 'category', label: 'Категория' },
            ] as const).map(({ field, label }) => (
              <div key={field}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
                <input
                  value={(product as any)[field] || ''}
                  onChange={e => setProduct(p => p ? { ...p, [field]: e.target.value } : p)}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'rgba(255,255,255,0.85)',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => (e.target.style.borderColor = 'rgba(99,102,241,0.5)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
                />
              </div>
            ))}
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Описание</label>
              <textarea
                value={product.description || ''}
                onChange={e => setProduct(p => p ? { ...p, description: e.target.value } : p)}
                rows={5}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'rgba(255,255,255,0.85)',
                  outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(99,102,241,0.5)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab: Атрибуты */}
      {activeTab === 'attrs' && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button
              onClick={() => setProduct(p => p ? { ...p, attributes: [...(p.attributes || []), { key: '', value: '' }] } : p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 13,
                background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8', cursor: 'pointer',
              }}
            >
              <Plus size={13} /> Добавить
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(product.attributes || []).map((attr, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 10, alignItems: 'center' }}>
                <input
                  value={attr.key}
                  placeholder="Ключ"
                  onChange={e => {
                    const attrs = [...product.attributes];
                    attrs[i] = { ...attrs[i], key: e.target.value };
                    setProduct(p => p ? { ...p, attributes: attrs } : p);
                  }}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'rgba(255,255,255,0.8)', outline: 'none' }}
                />
                <input
                  value={attr.value}
                  placeholder="Значение"
                  onChange={e => {
                    const attrs = [...product.attributes];
                    attrs[i] = { ...attrs[i], value: e.target.value };
                    setProduct(p => p ? { ...p, attributes: attrs } : p);
                  }}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'rgba(255,255,255,0.8)', outline: 'none' }}
                />
                <button
                  onClick={() => setProduct(p => p ? { ...p, attributes: p.attributes.filter((_, j) => j !== i) } : p)}
                  style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '8px', cursor: 'pointer', color: '#f87171', display: 'flex' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {!product.attributes?.length && (
              <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>Нет атрибутов</div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Медиа */}
      {activeTab === 'media' && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
            {(product.images || []).map((url, i) => (
              <div key={i} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', aspectRatio: '1', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button
                  onClick={() => setProduct(p => p ? { ...p, images: p.images.filter((_, j) => j !== i) } : p)}
                  style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 6, background: 'rgba(0,0,0,0.7)', border: 'none', cursor: 'pointer', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            <div
              style={{ borderRadius: 10, border: '2px dashed rgba(255,255,255,0.1)', aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', fontSize: 12, gap: 6 }}
              onClick={() => {
                const url = prompt('URL изображения:');
                if (url) setProduct(p => p ? { ...p, images: [...(p.images || []), url] } : p);
              }}
            >
              <Plus size={20} />
              Добавить
            </div>
          </div>
        </div>
      )}

      {/* Tab: Синдикация */}
      {activeTab === 'synd' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {connections.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
              Нет подключённых маркетплейсов. <Link to="/integrations" style={{ color: '#818cf8' }}>Добавить</Link>
            </div>
          )}
          {connections.map(conn => {
            const synd = product.syndication?.find(s => s.connection_id === conn.id);
            const hint = syndicationStepHint(conn.type);
            return (
              <div key={conn.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: 4 }}>{connectionOptionLabel(conn.name, conn.type)}</div>
                  {synd?.status && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      {synd.status === 'success' ? <CheckCircle size={12} color="#10b981" /> : <AlertCircle size={12} color="#f59e0b" />}
                      <span style={{ color: synd.status === 'success' ? '#10b981' : '#f59e0b' }}>{synd.status}</span>
                      {synd.last_pushed_at && <span style={{ color: 'rgba(255,255,255,0.25)' }}>· {new Date(synd.last_pushed_at).toLocaleDateString('ru-RU')}</span>}
                      {synd.external_id && <a href={`#`} style={{ color: '#818cf8', display: 'flex', alignItems: 'center', gap: 3 }}><ExternalLink size={11} /> {synd.external_id}</a>}
                    </div>
                  )}
                  {hint && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>{hint}</div>}
                </div>
                <button
                  onClick={() => push(conn.id)}
                  disabled={pushingId === conn.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, fontSize: 13,
                    background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                    border: 'none', color: 'white', cursor: pushingId === conn.id ? 'not-allowed' : 'pointer',
                    opacity: pushingId === conn.id ? 0.6 : 1,
                    boxShadow: '0 0 16px rgba(99,102,241,0.3)',
                  }}
                >
                  {pushingId === conn.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
                  Отправить
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
