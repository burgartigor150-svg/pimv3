import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Wifi,
  WifiOff,
  Loader2,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Plug,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Connection {
  id: string;
  name: string;
  type: 'ozon' | 'wb' | 'yandex' | 'mega' | string;
  status: 'connected' | 'error' | 'pending' | string;
  last_sync?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MARKETPLACE_META: Record<string, { emoji: string; label: string; color: string }> = {
  ozon:    { emoji: '🟠', label: 'Ozon',           color: '#005BFF' },
  wb:      { emoji: '🟣', label: 'Wildberries',    color: '#CB11AB' },
  yandex:  { emoji: '🟡', label: 'Яндекс Маркет',  color: '#FFCC00' },
  mega:    { emoji: '🟢', label: 'МегаМаркет',     color: '#00B065' },
};

const MARKETPLACES = ['ozon', 'wb', 'yandex', 'mega'] as const;

const STATUS_CONFIG: Record<string, { color: string; borderGlow: string; icon: React.ReactNode; label: string }> = {
  connected: {
    color: '#10b981',
    borderGlow: '0 0 0 1px rgba(16,185,129,0.35), 0 0 16px rgba(16,185,129,0.12)',
    icon: <CheckCircle2 size={14} />,
    label: 'Подключено',
  },
  error: {
    color: '#f87171',
    borderGlow: '0 0 0 1px rgba(248,113,113,0.35), 0 0 16px rgba(248,113,113,0.12)',
    icon: <AlertCircle size={14} />,
    label: 'Ошибка',
  },
  pending: {
    color: '#f59e0b',
    borderGlow: '0 0 0 1px rgba(245,158,11,0.3), 0 0 12px rgba(245,158,11,0.1)',
    icon: <Clock size={14} />,
    label: 'Ожидание',
  },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? {
    color: 'rgba(255,255,255,0.3)',
    borderGlow: 'none',
    icon: <Plug size={14} />,
    label: status,
  };
}

// ─── Add Connection Modal ─────────────────────────────────────────────────────

interface AddModalProps {
  onClose: () => void;
  onAdded: () => void;
}

function AddModal({ onClose, onAdded }: AddModalProps) {
  const { toast } = useToast();
  const [type, setType] = useState<typeof MARKETPLACES[number]>('ozon');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast('Введите название подключения', 'error'); return; }
    if (!apiKey.trim()) { toast('Введите API ключ', 'error'); return; }
    setLoading(true);
    try {
      await api.post('/connections', { name: name.trim(), type, api_key: apiKey.trim() });
      toast('Подключение добавлено', 'success');
      onAdded();
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? e?.message ?? 'Ошибка создания подключения', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(10px)',
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
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 20,
          backdropFilter: 'blur(24px)',
          padding: 36,
          width: '100%',
          maxWidth: 500,
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
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            padding: 6,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={15} />
        </button>

        <h2 style={{ margin: '0 0 28px', fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.92)' }}>
          Добавить подключение
        </h2>

        <form onSubmit={handleSubmit}>
          {/* Marketplace type selector */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: '0 0 12px', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
              Маркетплейс
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
              {MARKETPLACES.map((m) => {
                const meta = MARKETPLACE_META[m];
                const active = type === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setType(m)}
                    style={{
                      background: active
                        ? 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))'
                        : 'rgba(255,255,255,0.03)',
                      border: active
                        ? '1px solid rgba(99,102,241,0.5)'
                        : '1px solid rgba(255,255,255,0.07)',
                      borderRadius: 12,
                      cursor: 'pointer',
                      padding: '14px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ fontSize: 22 }}>{meta.emoji}</span>
                    <span
                      style={{
                        color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)',
                        fontSize: 11,
                        fontWeight: active ? 600 : 400,
                        textAlign: 'center',
                        lineHeight: 1.3,
                      }}
                    >
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name */}
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="conn-name"
              style={{ display: 'block', color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 8 }}
            >
              Название
            </label>
            <input
              id="conn-name"
              className="input-premium"
              style={{ width: '100%', padding: '10px 14px', boxSizing: 'border-box' }}
              placeholder={`Мой ${MARKETPLACE_META[type]?.label ?? type}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* API key */}
          <div style={{ marginBottom: 28 }}>
            <label
              htmlFor="conn-key"
              style={{ display: 'block', color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 8 }}
            >
              API ключ
            </label>
            <input
              id="conn-key"
              className="input-premium"
              type="password"
              style={{ width: '100%', padding: '10px 14px', boxSizing: 'border-box' }}
              placeholder="sk-••••••••••••"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                color: 'rgba(255,255,255,0.55)',
                cursor: 'pointer',
                padding: '12px',
                fontSize: 14,
              }}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="btn-glow"
              disabled={loading}
              style={{
                flex: 2,
                padding: '12px',
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {loading ? (
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Plus size={16} />
              )}
              {loading ? 'Сохранение…' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Connection Card ──────────────────────────────────────────────────────────

interface ConnectionCardProps {
  connection: Connection;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  testing: boolean;
}

function ConnectionCard({ connection, onDelete, onTest, testing }: ConnectionCardProps) {
  const meta = MARKETPLACE_META[connection.type] ?? { emoji: '🔌', label: connection.type, color: '#6366f1' };
  const sc = getStatusConfig(connection.status);

  const formatSync = (dt?: string) => {
    if (!dt) return 'Нет данных';
    const d = new Date(dt);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'Только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин. назад`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч. назад`;
    return d.toLocaleDateString('ru');
  };

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        backdropFilter: 'blur(20px)',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: sc.borderGlow,
        transition: 'box-shadow 0.3s, transform 0.2s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Subtle gradient background accent */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${sc.color}88, transparent)`,
          borderRadius: '16px 16px 0 0',
        }}
      />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        {/* Logo */}
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: `${meta.color}18`,
            border: `1px solid ${meta.color}30`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            flexShrink: 0,
          }}
        >
          {meta.emoji}
        </div>

        {/* Name + type */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: 'rgba(255,255,255,0.88)',
              fontSize: 16,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {connection.name}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 3 }}>
            {meta.label}
          </div>
        </div>

        {/* Status badge */}
        <span
          style={{
            background: `${sc.color}18`,
            border: `1px solid ${sc.color}35`,
            color: sc.color,
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            whiteSpace: 'nowrap',
          }}
        >
          {sc.icon}
          {sc.label}
        </span>
      </div>

      {/* Last sync */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'rgba(255,255,255,0.3)',
          fontSize: 12,
        }}
      >
        <Clock size={12} />
        <span>Синхронизация: {formatSync(connection.last_sync)}</span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onTest(connection.id)}
          disabled={testing}
          style={{
            flex: 1,
            background: 'rgba(99,102,241,0.08)',
            border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 9,
            color: '#6366f1',
            cursor: testing ? 'not-allowed' : 'pointer',
            padding: '9px 12px',
            fontSize: 13,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            transition: 'all 0.2s',
            opacity: testing ? 0.7 : 1,
          }}
        >
          {testing ? (
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          ) : connection.status === 'connected' ? (
            <Wifi size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          Проверить
        </button>
        <button
          onClick={() => onDelete(connection.id)}
          style={{
            background: 'rgba(248,113,113,0.07)',
            border: '1px solid rgba(248,113,113,0.18)',
            borderRadius: 9,
            color: '#f87171',
            cursor: 'pointer',
            padding: '9px 12px',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { toast } = useToast();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());

  const fetchConnections = useCallback(async () => {
    try {
      const res = await api.get<Connection[]>('/connections');
      setConnections(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      toast(e?.message ?? 'Ошибка загрузки подключений', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/connections/${id}`);
      toast('Подключение удалено', 'success');
      setConnections((prev) => prev.filter((c) => c.id !== id));
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? 'Ошибка удаления', 'error');
    }
  };

  const handleTest = async (id: string) => {
    setTestingIds((prev) => new Set(prev).add(id));
    try {
      const res = await api.post(`/connections/${id}/test`);
      const ok = res.data?.success ?? res.data?.status === 'ok';
      if (ok) {
        toast('Подключение работает', 'success');
        setConnections((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: 'connected' } : c))
        );
      } else {
        toast(res.data?.message ?? 'Проверка не прошла', 'error');
        setConnections((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: 'error' } : c))
        );
      }
    } catch (e: any) {
      toast(e?.response?.data?.detail ?? 'Ошибка проверки', 'error');
      setConnections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'error' } : c))
      );
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Stats summary
  const connected = connections.filter((c) => c.status === 'connected').length;
  const errors = connections.filter((c) => c.status === 'error').length;

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
            top: '-15%',
            left: '-8%',
            width: 550,
            height: 550,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 70%)',
            animation: 'orbFloat 13s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-12%',
            right: '-6%',
            width: 480,
            height: 480,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(168,85,247,0.09) 0%, transparent 70%)',
            animation: 'orbFloat 17s ease-in-out infinite reverse',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '55%',
            left: '45%',
            width: 320,
            height: 320,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)',
            animation: 'orbFloat 22s ease-in-out infinite 3s',
          }}
        />
        <style>{`
          @keyframes orbFloat {
            0%, 100% { transform: translate(0,0) scale(1); }
            33% { transform: translate(25px,-18px) scale(1.04); }
            66% { transform: translate(-18px,12px) scale(0.97); }
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))',
                border: '1px solid rgba(99,102,241,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Plug size={20} color="#a855f7" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' }}>
                Подключения
              </h1>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.3)', fontSize: 13, marginTop: 2 }}>
                Управление интеграциями с маркетплейсами
              </p>
            </div>
          </div>
          <button
            className="btn-glow"
            onClick={() => setShowAdd(true)}
            style={{
              marginLeft: 'auto',
              padding: '10px 22px',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Plus size={16} />
            Добавить
          </button>
        </div>

        {/* Summary strip */}
        {!loading && connections.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginBottom: 28,
            }}
            className="animate-fade-in"
          >
            {[
              { label: 'Всего', value: connections.length, color: '#6366f1' },
              { label: 'Подключено', value: connected, color: '#10b981' },
              { label: 'Ошибки', value: errors, color: '#f87171' },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 12,
                  padding: '12px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span style={{ color, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</span>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 100,
              color: 'rgba(255,255,255,0.2)',
              fontSize: 15,
              gap: 12,
            }}
          >
            <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />
            Загрузка…
          </div>
        ) : connections.length === 0 ? (
          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.08)',
              borderRadius: 20,
              padding: 80,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                background: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}
            >
              <WifiOff size={28} color="#6366f1" />
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, margin: '0 0 8px' }}>
              Нет подключений
            </p>
            <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, margin: '0 0 24px' }}>
              Добавьте первое подключение к маркетплейсу
            </p>
            <button
              className="btn-glow"
              onClick={() => setShowAdd(true)}
              style={{ padding: '10px 24px', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Plus size={16} />
              Добавить подключение
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 20,
            }}
          >
            {connections.map((conn) => (
              <div key={conn.id} className="animate-fade-up">
                <ConnectionCard
                  connection={conn}
                  onDelete={handleDelete}
                  onTest={handleTest}
                  testing={testingIds.has(conn.id)}
                />
              </div>
            ))}

            {/* Add card shortcut */}
            <button
              onClick={() => setShowAdd(true)}
              style={{
                background: 'rgba(255,255,255,0.015)',
                border: '1px dashed rgba(255,255,255,0.08)',
                borderRadius: 16,
                cursor: 'pointer',
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                minHeight: 200,
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'rgba(99,102,241,0.3)';
                el.style.background = 'rgba(99,102,241,0.04)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'rgba(255,255,255,0.08)';
                el.style.background = 'rgba(255,255,255,0.015)';
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'rgba(99,102,241,0.1)',
                  border: '1px solid rgba(99,102,241,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Plus size={20} color="#6366f1" />
              </div>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Добавить подключение</span>
            </button>
          </div>
        )}
      </div>

      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onAdded={fetchConnections}
        />
      )}
    </div>
  );
}
