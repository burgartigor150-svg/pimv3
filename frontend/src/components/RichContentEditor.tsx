import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Save, Plus, Trash2, ChevronUp, ChevronDown, RefreshCw,
  Type, List, Table, AlertCircle, ExternalLink, Eye, Edit3,
  GripVertical, Star, Zap, CheckCircle, Image as ImageIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Toast';

// ─── Block types ──────────────────────────────────────────────────────────────

type BlockType = 'hero' | 'text' | 'features' | 'specs' | 'callout' | 'images';

interface HeroBlock { type: 'hero'; title: string; subtitle: string; badge: string }
interface TextBlock { type: 'text'; html: string }
interface FeaturesBlock { type: 'features'; title: string; items: { icon: string; title: string; desc: string }[] }
interface SpecsBlock { type: 'specs'; title: string; rows: [string, string][] }
interface CalloutBlock { type: 'callout'; style: 'info' | 'warning' | 'success'; title: string; text: string }
interface ImagesBlock { type: 'images'; caption: string }

type Block = HeroBlock | TextBlock | FeaturesBlock | SpecsBlock | CalloutBlock | ImagesBlock;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return 'b_' + Math.random().toString(36).slice(2, 9); }

const BLOCK_ICONS: Record<BlockType, React.ReactNode> = {
  hero: <Star size={14} />,
  text: <Type size={14} />,
  features: <List size={14} />,
  specs: <Table size={14} />,
  callout: <AlertCircle size={14} />,
  images: <ImageIcon size={14} />,
};

const BLOCK_LABELS: Record<BlockType, string> = {
  hero: 'Заголовок',
  text: 'Текст',
  features: 'Преимущества',
  specs: 'Характеристики',
  callout: 'Выделение',
  images: 'Галерея',
};

const CALLOUT_COLORS = {
  info: { bg: '#dbeafe', border: '#3b82f6', label: 'Инфо' },
  success: { bg: '#dcfce7', border: '#16a34a', label: 'Успех' },
  warning: { bg: '#fef9c3', border: '#d97706', label: 'Важно' },
};

function defaultBlock(type: BlockType): Block {
  if (type === 'hero') return { type, title: 'Заголовок товара', subtitle: 'Краткое описание преимущества', badge: 'Новинка' };
  if (type === 'text') return { type, html: '<p>Введите описание товара здесь...</p>' };
  if (type === 'features') return { type, title: 'Ключевые преимущества', items: [{ icon: '⚡', title: 'Быстро', desc: 'Описание' }, { icon: '🛡', title: 'Надёжно', desc: 'Описание' }] };
  if (type === 'specs') return { type, title: 'Характеристики', rows: [['Параметр 1', 'Значение 1'], ['Параметр 2', 'Значение 2']] };
  if (type === 'callout') return { type, style: 'info', title: 'Важно знать', text: 'Дополнительная информация о товаре' };
  return { type: 'images', caption: '' };
}

// ─── Block Editors ────────────────────────────────────────────────────────────

const s = {
  label: { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 4, display: 'block' },
  input: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: 'rgba(255,255,255,0.9)', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  textarea: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: 'rgba(255,255,255,0.9)', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', resize: 'vertical' as const, minHeight: 80 },
  row: { display: 'flex', gap: 8, marginBottom: 8 },
  iconBtn: (danger = false): React.CSSProperties => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer', flexShrink: 0, background: danger ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)', color: danger ? '#f87171' : 'rgba(255,255,255,0.6)' }),
  smallBtn: { display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600 } as React.CSSProperties,
};

function HeroEditor({ block, onChange }: { block: HeroBlock; onChange: (b: HeroBlock) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div><label style={s.label}>Бейдж</label><input style={s.input} value={block.badge} onChange={e => onChange({ ...block, badge: e.target.value })} /></div>
      <div><label style={s.label}>Заголовок</label><input style={s.input} value={block.title} onChange={e => onChange({ ...block, title: e.target.value })} /></div>
      <div><label style={s.label}>Подзаголовок</label><textarea style={s.textarea} rows={2} value={block.subtitle} onChange={e => onChange({ ...block, subtitle: e.target.value })} /></div>
    </div>
  );
}

function TextEditor({ block, onChange }: { block: TextBlock; onChange: (b: TextBlock) => void }) {
  return (
    <div>
      <label style={s.label}>HTML-контент</label>
      <textarea style={{ ...s.textarea, minHeight: 120, fontFamily: 'monospace', fontSize: 12 }} value={block.html} onChange={e => onChange({ ...block, html: e.target.value })} />
      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>Поддерживается HTML: &lt;p&gt;, &lt;b&gt;, &lt;ul&gt;, &lt;li&gt;, &lt;br&gt;</p>
    </div>
  );
}

function FeaturesEditor({ block, onChange }: { block: FeaturesBlock; onChange: (b: FeaturesBlock) => void }) {
  const updateItem = (i: number, upd: Partial<{ icon: string; title: string; desc: string }>) => {
    const items = (block.items ?? []).map((it, idx) => idx === i ? { ...it, ...upd } : it);
    onChange({ ...block, items });
  };
  const addItem = () => onChange({ ...block, items: [...(block.items ?? []), { icon: '✓', title: 'Новый пункт', desc: '' }] });
  const removeItem = (i: number) => onChange({ ...block, items: (block.items ?? []).filter((_, idx) => idx !== i) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div><label style={s.label}>Заголовок раздела</label><input style={s.input} value={block.title} onChange={e => onChange({ ...block, title: e.target.value })} /></div>
      {(block.items ?? []).map((item, i) => (
        <div key={i} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 10 }}>
          <div style={s.row}>
            <input style={{ ...s.input, width: 50 }} value={item.icon} onChange={e => updateItem(i, { icon: e.target.value })} title="Эмодзи" />
            <input style={{ ...s.input, flex: 1 }} value={item.title} onChange={e => updateItem(i, { title: e.target.value })} placeholder="Название" />
            <button style={s.iconBtn(true)} onClick={() => removeItem(i)}><Trash2 size={12} /></button>
          </div>
          <input style={s.input} value={item.desc} onChange={e => updateItem(i, { desc: e.target.value })} placeholder="Описание" />
        </div>
      ))}
      <button style={s.smallBtn} onClick={addItem}><Plus size={12} />Добавить пункт</button>
    </div>
  );
}

function SpecsEditor({ block, onChange }: { block: SpecsBlock; onChange: (b: SpecsBlock) => void }) {
  const updateRow = (i: number, col: 0 | 1, val: string) => {
    const rows = (block.rows ?? []).map((r, idx): [string, string] => idx === i ? (col === 0 ? [val, r[1]] : [r[0], val]) : r);
    onChange({ ...block, rows });
  };
  const addRow = () => onChange({ ...block, rows: [...(block.rows ?? []), ['', '']] });
  const removeRow = (i: number) => onChange({ ...block, rows: (block.rows ?? []).filter((_, idx) => idx !== i) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div><label style={s.label}>Заголовок таблицы</label><input style={s.input} value={block.title} onChange={e => onChange({ ...block, title: e.target.value })} /></div>
      {(block.rows ?? []).map((row, i) => (
        <div key={i} style={s.row}>
          <input style={{ ...s.input, flex: 1 }} value={row[0]} onChange={e => updateRow(i, 0, e.target.value)} placeholder="Название параметра" />
          <input style={{ ...s.input, flex: 1 }} value={row[1]} onChange={e => updateRow(i, 1, e.target.value)} placeholder="Значение" />
          <button style={s.iconBtn(true)} onClick={() => removeRow(i)}><Trash2 size={12} /></button>
        </div>
      ))}
      <button style={s.smallBtn} onClick={addRow}><Plus size={12} />Добавить строку</button>
    </div>
  );
}

function CalloutEditor({ block, onChange }: { block: CalloutBlock; onChange: (b: CalloutBlock) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={s.label}>Стиль</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['info', 'success', 'warning'] as const).map(style => (
            <button key={style} onClick={() => onChange({ ...block, style })}
              style={{ ...s.smallBtn, background: block.style === style ? CALLOUT_COLORS[style].bg : 'rgba(255,255,255,0.06)', color: block.style === style ? '#000' : 'rgba(255,255,255,0.7)', border: `1px solid ${block.style === style ? CALLOUT_COLORS[style].border : 'rgba(255,255,255,0.1)'}` }}>
              {CALLOUT_COLORS[style].label}
            </button>
          ))}
        </div>
      </div>
      <div><label style={s.label}>Заголовок</label><input style={s.input} value={block.title} onChange={e => onChange({ ...block, title: e.target.value })} /></div>
      <div><label style={s.label}>Текст</label><textarea style={s.textarea} rows={3} value={block.text} onChange={e => onChange({ ...block, text: e.target.value })} /></div>
    </div>
  );
}

// ─── Block wrapper ─────────────────────────────────────────────────────────────

function BlockCard({ block, index, total, onChange, onMove, onDelete }:
  { block: Block; index: number; total: number; onChange: (b: Block) => void; onMove: (d: -1 | 1) => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const btype = block.type as BlockType;

  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', cursor: 'pointer', borderBottom: expanded ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
        onClick={() => setExpanded(e => !e)}>
        <GripVertical size={14} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>{BLOCK_ICONS[btype]}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', flex: 1 }}>{BLOCK_LABELS[btype]}</span>
        <button style={s.iconBtn()} onClick={e => { e.stopPropagation(); onMove(-1); }} disabled={index === 0}><ChevronUp size={12} /></button>
        <button style={s.iconBtn()} onClick={e => { e.stopPropagation(); onMove(1); }} disabled={index === total - 1}><ChevronDown size={12} /></button>
        <button style={s.iconBtn(true)} onClick={e => { e.stopPropagation(); onDelete(); }}><Trash2 size={12} /></button>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {/* Body */}
      {expanded && (
        <div style={{ padding: 14 }}>
          {btype === 'hero' && <HeroEditor block={block as HeroBlock} onChange={onChange as any} />}
          {btype === 'text' && <TextEditor block={block as TextBlock} onChange={onChange as any} />}
          {btype === 'features' && <FeaturesEditor block={block as FeaturesBlock} onChange={onChange as any} />}
          {btype === 'specs' && <SpecsEditor block={block as SpecsBlock} onChange={onChange as any} />}
          {btype === 'callout' && <CalloutEditor block={block as CalloutBlock} onChange={onChange as any} />}
        </div>
      )}
    </div>
  );
}

// ─── Rich Content Preview ─────────────────────────────────────────────────────

function RichPreview({ blocks, productImages }: { blocks: Block[]; productImages: string[] }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 32, color: '#111', fontFamily: 'system-ui', overflow: 'hidden' }}>
      {blocks.map((block, i) => {
        const btype = block.type as BlockType;
        if (btype === 'hero') {
          const b = block as HeroBlock;
          return (
            <div key={i} style={{ marginBottom: 32 }}>
              {b.badge && <span style={{ display: 'inline-block', background: '#f59e0b', color: '#000', fontWeight: 700, fontSize: 11, padding: '3px 10px', borderRadius: 20, marginBottom: 10 }}>{b.badge}</span>}
              <h1 style={{ fontSize: 32, fontWeight: 900, lineHeight: 1.2, marginBottom: 10, color: '#111' }}>{b.title}</h1>
              <p style={{ fontSize: 16, color: '#555', lineHeight: 1.7 }}>{b.subtitle}</p>
            </div>
          );
        }
        if (btype === 'text') return <div key={i} style={{ marginBottom: 24, fontSize: 15, lineHeight: 1.7, color: '#333' }} dangerouslySetInnerHTML={{ __html: (block as TextBlock).html }} />;
        if (btype === 'features') {
          const b = block as FeaturesBlock;
          return (
            <div key={i} style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16, color: '#111' }}>{b.title}</h3>
              {(b.items ?? []).map((it, j) => (
                <div key={j} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
                  <span style={{ fontSize: 22 }}>{it.icon}</span>
                  <div><b style={{ fontSize: 15 }}>{it.title}</b><br /><span style={{ fontSize: 13, color: '#555' }}>{it.desc}</span></div>
                </div>
              ))}
            </div>
          );
        }
        if (btype === 'specs') {
          const b = block as SpecsBlock;
          return (
            <div key={i} style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12, color: '#111' }}>{b.title}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                {(b.rows ?? []).map((row, j) => (
                  <tr key={j}><td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', color: '#666', fontSize: 13, width: '45%' }}>{row[0]}</td><td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 13 }}>{row[1]}</td></tr>
                ))}
              </table>
            </div>
          );
        }
        if (btype === 'callout') {
          const b = block as CalloutBlock;
          const c = CALLOUT_COLORS[b.style];
          return <div key={i} style={{ background: c.bg, borderLeft: `4px solid ${c.border}`, borderRadius: '0 10px 10px 0', padding: '16px 20px', marginBottom: 20 }}><b style={{ fontSize: 15 }}>{b.title}</b><p style={{ marginTop: 6, color: '#333', fontSize: 14 }}>{b.text}</p></div>;
        }
        return null;
      })}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function RichContentEditor({ product }: { product: any }) {
  const { toast } = useToast();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [landingJson, setLandingJson] = useState<any>({});
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'edit' | 'preview' | 'landing'>('edit');
  const [landingUrl, setLandingUrl] = useState('');

  useEffect(() => {
    if (!product?.id) return;
    api.get(`/products/${product.id}/rich-content`)
      .then(r => {
        if (r.data.rich_content?.length) setBlocks(r.data.rich_content);
        if (r.data.landing_json && Object.keys(r.data.landing_json).length) setLandingJson(r.data.landing_json);
      })
      .catch(() => {});
    setLandingUrl(`/api/v1/products/${product.id}/landing-preview`);
  }, [product?.id]);

  const addBlock = (type: BlockType) => setBlocks(prev => [...prev, defaultBlock(type)]);

  const updateBlock = useCallback((i: number, block: Block) => {
    setBlocks(prev => prev.map((b, idx) => idx === i ? block : b));
  }, []);

  const deleteBlock = useCallback((i: number) => {
    setBlocks(prev => prev.filter((_, idx) => idx !== i));
  }, []);

  const moveBlock = useCallback((i: number, dir: -1 | 1) => {
    setBlocks(prev => {
      const arr = [...prev];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }, []);

  const refreshLanding = () => {
    setLandingUrl(`/api/v1/products/${product.id}/landing-preview?t=${Date.now()}`);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/products/${product.id}/ai-generate-rich`);
      const newBlocks = res.data.rich_content || [];
      const newLanding = res.data.landing_json || {};
      setBlocks(newBlocks);
      setLandingJson(newLanding);
      await api.put(`/products/${product.id}/rich-content`, {
        rich_content: newBlocks,
        landing_json: newLanding,
      });
      setTimeout(() => { refreshLanding(); setView('landing'); }, 300);
      toast('Готово — переключаю на лендинг', 'success');
    } catch (e: any) {
      toast('Ошибка генерации: ' + (e?.message ?? ''), 'error');
    } finally { setGenerating(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/products/${product.id}/rich-content`, { rich_content: blocks, landing_json: landingJson });
      refreshLanding();
      toast('Сохранено', 'success');
    } catch { toast('Ошибка сохранения', 'error'); }
    finally { setSaving(false); }
  };

  const c = {
    root: { display: 'flex', flexDirection: 'column' as const, height: '88vh', background: '#0c0c18', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' },
    toolbar: { height: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#0f0f1e', flexShrink: 0 },
    body: { flex: 1, display: 'flex', overflow: 'hidden' },
    sidebar: { width: 320, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column' as const, background: '#0d0d1a', overflow: 'hidden' },
    editorScroll: { flex: 1, overflowY: 'auto' as const, padding: 14 },
    previewArea: { flex: 1, overflow: 'auto', padding: 24, background: '#e8e8ee' },
    btn: (v: 'primary' | 'ghost' | 'success' = 'ghost'): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
      ...(v === 'primary' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }
        : v === 'success' ? { background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff' }
        : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.1)' }),
    }),
    viewBtn: (active: boolean): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
      background: active ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)', color: active ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
    }),
    addBlockBtn: (type: BlockType): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.08)', width: '100%', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.65)', marginBottom: 5,
    }),
  };

  return (
    <div style={c.root}>
      {/* Toolbar */}
      <div style={c.toolbar}>
        <button style={c.viewBtn(view === 'edit')} onClick={() => setView('edit')}><Edit3 size={13} />Редактор</button>
        <button style={c.viewBtn(view === 'preview')} onClick={() => setView('preview')}><Eye size={13} />Превью</button>
        <button style={c.viewBtn(view === 'landing')} onClick={() => { setView('landing'); refreshLanding(); }}><ExternalLink size={13} />Лендинг</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{blocks.length} блоков</span>
        <button style={{ ...c.btn('primary'), opacity: generating ? 0.7 : 1 }} onClick={handleGenerate} disabled={generating}>
          {generating ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />Генерация AI...</> : <><Sparkles size={13} />AI создать</>}
        </button>
        <button style={{ ...c.btn('success'), opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>
          {saving ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />Сохранение...</> : <><Save size={13} />Сохранить</>}
        </button>
      </div>

      <div style={c.body}>
        {view === 'edit' && (
          <>
            {/* Left: Add blocks */}
            <div style={{ ...c.sidebar, width: 200 }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Добавить блок</div>
              <div style={{ padding: 10 }}>
                {(Object.keys(BLOCK_LABELS) as BlockType[]).map(type => (
                  <button key={type} style={c.addBlockBtn(type)} onClick={() => addBlock(type)}>
                    {BLOCK_ICONS[type]}{BLOCK_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Editor */}
            <div style={c.editorScroll}>
              {blocks.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'rgba(255,255,255,0.2)' }}>
                  <Sparkles size={40} style={{ marginBottom: 16, opacity: 0.3 }} />
                  <p style={{ fontSize: 15, marginBottom: 8 }}>Rich content пуст</p>
                  <p style={{ fontSize: 13 }}>Нажмите «AI создать» или добавьте блоки вручную</p>
                </div>
              ) : (
                blocks.map((block, i) => (
                  <BlockCard key={i} block={block} index={i} total={blocks.length}
                    onChange={b => updateBlock(i, b)}
                    onMove={d => moveBlock(i, d)}
                    onDelete={() => deleteBlock(i)}
                  />
                ))
              )}
            </div>
          </>
        )}

        {view === 'preview' && (
          <div style={c.previewArea}>
            <div style={{ maxWidth: 800, margin: '0 auto' }}>
              <RichPreview blocks={blocks} productImages={product?.images ?? []} />
            </div>
          </div>
        )}

        {view === 'landing' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 10, alignItems: 'center', background: '#0d0d1a' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Промо-лендинг товара</span>
              <div style={{ flex: 1 }} />
              {Object.keys(landingJson).length === 0 && (
                <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ Нажмите «AI создать» для генерации лендинга</span>
              )}
              <a href={landingUrl} target="_blank" rel="noreferrer"
                style={{ ...c.btn(), fontSize: 11, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
                <ExternalLink size={12} />Открыть в новой вкладке
              </a>
            </div>
            <iframe
              key={landingUrl}
              src={landingUrl}
              style={{ flex: 1, border: 'none', background: '#fff' }}
              title="Landing preview"
            />
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
