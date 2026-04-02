import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Save, Copy, Check, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Toast';

// ─── Platform config ───────────────────────────────────────────────────────────

interface Platform {
  key: string;
  name: string;
  emoji: string;
  color: string;
  maxLen: number;
  hint: string;
}

const PLATFORMS: Platform[] = [
  { key: 'instagram',     name: 'Instagram',         emoji: '📸', color: '#E1306C', maxLen: 2200,  hint: 'с хэштегами' },
  { key: 'telegram',      name: 'Telegram',           emoji: '✈️', color: '#2AABEE', maxLen: 4096,  hint: 'Markdown разметка' },
  { key: 'vk',            name: 'ВКонтакте',          emoji: '🔵', color: '#4680C2', maxLen: 4096,  hint: 'с хэштегами' },
  { key: 'twitter',       name: 'Twitter / X',        emoji: '🐦', color: '#1DA1F2', maxLen: 280,   hint: 'до 280 символов' },
  { key: 'ok',            name: 'Одноклассники',       emoji: '🟠', color: '#EE8208', maxLen: 3000,  hint: 'широкая аудитория' },
  { key: 'yandex_market', name: 'Яндекс.Маркет',      emoji: '🛒', color: '#FFCC00', maxLen: 3000,  hint: 'SEO-описание' },
  { key: 'ozon',          name: 'Ozon',               emoji: '🔷', color: '#005BFF', maxLen: 5000,  hint: 'rich-описание' },
  { key: 'wildberries',   name: 'Wildberries',        emoji: '🍇', color: '#CB11AB', maxLen: 5000,  hint: 'ключевые слова' },
  { key: 'max_messenger', name: 'Мессенджер Макс',    emoji: '💬', color: '#00B2A9', maxLen: 1000,  hint: 'до 1000 символов' },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  root: { display: 'flex', flexDirection: 'column' as const, height: '88vh', background: '#0c0c18', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' },
  toolbar: { height: 52, display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#0f0f1e', flexShrink: 0 },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  sidebar: { width: 220, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.07)', background: '#0d0d1a', overflowY: 'auto' as const, padding: '8px 0' },
  main: { flex: 1, overflowY: 'auto' as const, padding: 20 },
  btn: (variant: 'primary' | 'ghost' | 'success' = 'ghost'): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
    fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
    ...(variant === 'primary' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 'none' }
      : variant === 'success' ? { background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', border: 'none' }
      : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.75)', borderColor: 'rgba(255,255,255,0.1)' }),
  }),
  sideItem: (active: boolean, color: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer',
    background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
    borderLeft: active ? `3px solid ${color}` : '3px solid transparent',
    transition: 'all 0.15s',
  }),
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' } as React.CSSProperties,
  textarea: { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '12px 14px', color: 'rgba(255,255,255,0.88)', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', resize: 'vertical' as const, lineHeight: 1.6 },
};

// ─── Platform Card ─────────────────────────────────────────────────────────────

function PlatformCard({ platform, data, onChange }: {
  platform: Platform;
  data: { text: string; generated_at: number } | undefined;
  onChange: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const text = data?.text ?? '';
  const len = text.length;
  const over = len > platform.maxLen;

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div style={s.card} id={`platform-${platform.key}`}>
      <div style={s.cardHeader}>
        <span style={{ fontSize: 20 }}>{platform.emoji}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{platform.name}</span>
          <span style={{ marginLeft: 8, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{platform.hint}</span>
        </div>
        <span style={{ fontSize: 11, color: over ? '#f87171' : 'rgba(255,255,255,0.35)', marginRight: 8 }}>
          {len} / {platform.maxLen}
        </span>
        <button style={{ ...s.btn(), padding: '5px 10px', fontSize: 11 }} onClick={handleCopy}>
          {copied ? <><Check size={12} />Скопировано</> : <><Copy size={12} />Копировать</>}
        </button>
        <button style={{ ...s.btn(), padding: '5px 8px', marginLeft: 4 }} onClick={() => setExpanded(e => !e)}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {expanded && (
        <div style={{ padding: 14 }}>
          {!text ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
              Нажмите «AI Генерировать» для создания контента
            </div>
          ) : (
            <textarea
              style={{ ...s.textarea, minHeight: 140, borderColor: over ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.1)' }}
              value={text}
              onChange={e => onChange(e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function SocialContentEditor({ product }: { product: any }) {
  const { toast } = useToast();
  const [content, setContent] = useState<Record<string, { text: string; platform: string; generated_at: number }>>({});
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activePlatform, setActivePlatform] = useState<string>('instagram');

  useEffect(() => {
    if (!product?.id) return;
    api.get(`/products/${product.id}/social-content`)
      .then(r => { if (r.data.social_content) setContent(r.data.social_content); })
      .catch(() => {});
  }, [product?.id]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/products/${product.id}/ai-generate-social`);
      setContent(res.data.social_content || {});
      toast('Контент для всех площадок сгенерирован!', 'success');
    } catch (e: any) {
      toast('Ошибка генерации: ' + (e?.message ?? ''), 'error');
    } finally { setGenerating(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/products/${product.id}/social-content`, { social_content: content });
      toast('Сохранено', 'success');
    } catch { toast('Ошибка сохранения', 'error'); }
    finally { setSaving(false); }
  };

  const updateText = useCallback((key: string, text: string) => {
    setContent(prev => ({
      ...prev,
      [key]: { ...prev[key], text, platform: PLATFORMS.find(p => p.key === key)?.name ?? key, generated_at: prev[key]?.generated_at ?? 0 },
    }));
  }, []);

  const generatedCount = Object.keys(content).filter(k => content[k]?.text).length;

  const scrollTo = (key: string) => {
    setActivePlatform(key);
    const el = document.getElementById(`platform-${key}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={s.root}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>Контент для площадок</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>
          {generatedCount > 0 ? `${generatedCount} / ${PLATFORMS.length} площадок` : 'не сгенерировано'}
        </span>
        <div style={{ flex: 1 }} />
        <button style={{ ...s.btn('primary'), opacity: generating ? 0.7 : 1 }} onClick={handleGenerate} disabled={generating}>
          {generating
            ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />Генерация AI...</>
            : <><Sparkles size={14} />AI Генерировать все</>}
        </button>
        <button style={{ ...s.btn('success'), opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>
          {saving ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />Сохранение...</> : <><Save size={14} />Сохранить</>}
        </button>
      </div>

      <div style={s.body}>
        {/* Sidebar */}
        <div style={s.sidebar}>
          <div style={{ padding: '6px 16px 10px', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Площадки
          </div>
          {PLATFORMS.map(p => {
            const hasContent = !!content[p.key]?.text;
            return (
              <div key={p.key} style={s.sideItem(activePlatform === p.key, p.color)} onClick={() => scrollTo(p.key)}>
                <span style={{ fontSize: 17 }}>{p.emoji}</span>
                <span style={{ fontSize: 13, color: activePlatform === p.key ? '#fff' : 'rgba(255,255,255,0.6)', fontWeight: activePlatform === p.key ? 600 : 400, flex: 1 }}>
                  {p.name}
                </span>
                {hasContent && <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color, flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>

        {/* Content area */}
        <div style={s.main}>
          {PLATFORMS.map(p => (
            <PlatformCard
              key={p.key}
              platform={p}
              data={content[p.key]}
              onChange={text => updateText(p.key, text)}
            />
          ))}
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
