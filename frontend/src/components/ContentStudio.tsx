import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import html2canvas from 'html2canvas';
import {
  Sparkles, Download, Type, Image as ImageIcon, Layers, Plus, Trash2,
  RefreshCw, Wand2, Eraser, ZoomIn, ZoomOut, AlignLeft, AlignCenter,
  AlignRight, Bold, X, Upload, Eye, EyeOff, Copy, ChevronUp, ChevronDown,
  LayoutTemplate, Square, Circle, Maximize2, Save, Undo2, Redo2,
  PanelLeft, PanelRight, Monitor,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Toast';

// ─── Types ─────────────────────────────────────────────────────────────────

type LayerType = 'image' | 'text' | 'shape';
type PanelTab = 'ai' | 'layers' | 'props' | 'templates';

interface Layer {
  id: string;
  type: LayerType;
  src?: string;
  text?: string;
  x: number; y: number;
  width: number; height: number | 'auto';
  fontSize?: number;
  color?: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontFamily?: string;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  label?: string;
  shapeType?: 'rect' | 'circle';
  shapeFill?: string;
  borderRadius?: number;
}

const CANVAS_PRESETS = [
  { label: 'Квадрат 1:1', w: 1080, h: 1080 },
  { label: 'Сторис 9:16', w: 1080, h: 1920 },
  { label: 'Пост 4:5', w: 1080, h: 1350 },
  { label: 'Баннер 16:9', w: 1920, h: 1080 },
  { label: 'Wide 2:1', w: 1200, h: 600 },
];

const FONTS = ['Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Trebuchet MS', 'Playfair Display'];

const BG_MODELS = [
  { id: '5c232a9e-9061-4777-980a-ddc8e65647c6', name: 'Leonardo Vision XL' },
  { id: 'aa77f04e-3eec-4034-9c07-d0f619684628', name: 'Kino XL (кино)' },
  { id: 'b24e16ff-06e3-43eb-8d33-4416c2d75876', name: 'Lightning XL (быстро)' },
  { id: '1e60896f-3c26-4296-8ecc-53e2afecc132', name: 'Diffusion XL' },
  { id: '291be633-cb24-434f-898f-e662799936ad', name: 'Signature' },
];

function uid() { return 'l_' + Math.random().toString(36).slice(2, 9); }
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result as string); r.readAsDataURL(blob); });
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ContentStudio({ product }: { product: any }) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  const [canvasW, setCanvasW] = useState(1080);
  const [canvasH, setCanvasH] = useState(1080);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState('#1a1a2e');
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.42);
  const [panel, setPanel] = useState<PanelTab>('ai');
  const [rightPanel, setRightPanel] = useState(true);

  // AI state
  const [bgPrompt, setBgPrompt] = useState('professional studio photography, soft cinematic lighting, clean gradient background, product showcase');
  const [elementPrompt, setElementPrompt] = useState('');
  const [bgModel, setBgModel] = useState('5c232a9e-9061-4777-980a-ddc8e65647c6');
  const [generatingBg, setGeneratingBg] = useState(false);
  const [generatingEl, setGeneratingEl] = useState(false);
  const [removingBg, setRemovingBg] = useState<string | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);

  // History (undo/redo)
  const historyRef = useRef<Layer[][]>([[]]);
  const historyIdx = useRef(0);

  const pushHistory = useCallback((newLayers: Layer[]) => {
    historyRef.current = historyRef.current.slice(0, historyIdx.current + 1);
    historyRef.current.push(JSON.parse(JSON.stringify(newLayers)));
    historyIdx.current = historyRef.current.length - 1;
  }, []);

  const undo = () => {
    if (historyIdx.current <= 0) return;
    historyIdx.current--;
    setLayers(JSON.parse(JSON.stringify(historyRef.current[historyIdx.current])));
  };

  const redo = () => {
    if (historyIdx.current >= historyRef.current.length - 1) return;
    historyIdx.current++;
    setLayers(JSON.parse(JSON.stringify(historyRef.current[historyIdx.current])));
  };

  const selected = layers.find(l => l.id === selectedId) ?? null;

  // ── Layer helpers ─────────────────────────────────────────────────────────

  const updateLayer = useCallback((id: string, upd: Partial<Layer>) => {
    setLayers(prev => {
      const next = prev.map(l => l.id === id ? { ...l, ...upd } : l);
      return next;
    });
  }, []);

  const removeLayer = useCallback((id: string) => {
    setLayers(prev => {
      const next = prev.filter(l => l.id !== id);
      pushHistory(next);
      return next;
    });
    setSelectedId(prev => prev === id ? null : prev);
  }, [pushHistory]);

  const addLayer = useCallback((layer: Layer) => {
    setLayers(prev => {
      const next = [...prev, layer];
      pushHistory(next);
      return next;
    });
    setSelectedId(layer.id);
  }, [pushHistory]);

  const moveLayerUp = (id: string) => setLayers(prev => {
    const i = prev.findIndex(l => l.id === id);
    if (i >= prev.length - 1) return prev;
    const arr = [...prev]; [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]; return arr;
  });

  const moveLayerDown = (id: string) => setLayers(prev => {
    const i = prev.findIndex(l => l.id === id);
    if (i <= 0) return prev;
    const arr = [...prev]; [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]; return arr;
  });

  const duplicateLayer = (id: string) => {
    const l = layers.find(l => l.id === id);
    if (!l) return;
    addLayer({ ...l, id: uid(), x: l.x + 24, y: l.y + 24, label: (l.label ?? 'Layer') + ' (копия)' });
  };

  const addImageLayer = (src: string, label = 'Image') => addLayer({
    id: uid(), type: 'image', src, label,
    x: Math.round(canvasW * 0.2), y: Math.round(canvasH * 0.2),
    width: Math.round(canvasW * 0.4), height: Math.round(canvasH * 0.4),
    opacity: 1, visible: true,
  });

  const addTextLayer = (text = 'НОВЫЙ ТЕКСТ', opts: Partial<Layer> = {}) => addLayer({
    id: uid(), type: 'text', text, label: text.slice(0, 24),
    x: 60, y: 60, width: Math.round(canvasW * 0.8), height: 'auto',
    fontSize: 80, color: '#ffffff', fontWeight: 'bold',
    textAlign: 'center', fontFamily: 'Inter', opacity: 1, visible: true, ...opts,
  });

  const addShapeLayer = (shapeType: 'rect' | 'circle' = 'rect') => addLayer({
    id: uid(), type: 'shape', shapeType, label: shapeType === 'rect' ? 'Прямоугольник' : 'Круг',
    x: 200, y: 200, width: 400, height: 240,
    shapeFill: '#6366f1', borderRadius: shapeType === 'circle' ? 999 : 16,
    opacity: 0.85, visible: true,
  });

  // ── AI ────────────────────────────────────────────────────────────────────

  const generateBackground = async () => {
    setGeneratingBg(true);
    try {
      const fd = new FormData();
      fd.append('prompt', bgPrompt);
      fd.append('model_id', bgModel);
      if (product?.id) fd.append('product_id', String(product.id));
      const res = await api.post('/visual/generate-background', fd, { responseType: 'blob', headers: { 'Content-Type': 'multipart/form-data' } });
      const b64 = await blobToBase64(res.data as Blob);
      setBgImage(b64);
      toast('Фон сгенерирован', 'success');
    } catch (e: any) {
      const msg = e?.response?.data ? await e.response.data.text?.() : e?.message;
      toast('Ошибка генерации фона: ' + (msg ?? 'GPU сервис недоступен'), 'error');
    } finally { setGeneratingBg(false); }
  };

  const generateElement = async () => {
    if (!elementPrompt.trim()) return;
    setGeneratingEl(true);
    try {
      const fd = new FormData();
      fd.append('prompt', elementPrompt);
      fd.append('is_icon', 'false');
      fd.append('model_id', 'gemini-2.5-flash-image');
      const res = await api.post('/visual/generate-element', fd, { responseType: 'blob', headers: { 'Content-Type': 'multipart/form-data' } });
      const b64 = await blobToBase64(res.data as Blob);
      addImageLayer(b64, elementPrompt.slice(0, 30));
      setElementPrompt('');
      toast('Элемент создан и добавлен на холст', 'success');
    } catch (e: any) {
      toast('Ошибка генерации: ' + (e?.message ?? ''), 'error');
    } finally { setGeneratingEl(false); }
  };

  const removeBackground = async (layerId: string, src: string) => {
    setRemovingBg(layerId);
    try {
      const resImg = await fetch(src);
      const blob = await resImg.blob();
      const fd = new FormData(); fd.append('file', blob, 'image.png');
      const res = await api.post('/visual/remove-background', fd, { responseType: 'blob', headers: { 'Content-Type': 'multipart/form-data' } });
      const b64 = await blobToBase64(res.data as Blob);
      updateLayer(layerId, { src: b64 });
      toast('Фон удалён', 'success');
    } catch { toast('Ошибка удаления фона', 'error'); }
    finally { setRemovingBg(null); }
  };

  const generateInfographicPlan = async () => {
    setGeneratingPlan(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/ai/generate-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ product_id: product?.id, text: '' }),
      });
      const json = await res.json();
      const d = json.promo_copy;
      if (d?.promo_title) addTextLayer(d.promo_title, { fontSize: 72, y: 60 });
      (d?.features ?? []).slice(0, 4).forEach((f: any, i: number) => {
        addTextLayer(`• ${f.title}`, { fontSize: 36, color: 'rgba(255,255,255,0.85)', y: 200 + i * 80, fontWeight: 'normal' });
      });
      toast('AI-план создан — добавлены текстовые слои', 'success');
    } catch { toast('Ошибка генерации плана', 'error'); }
    finally { setGeneratingPlan(false); }
  };

  // ── Upload ────────────────────────────────────────────────────────────────

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const b64 = await blobToBase64(file);
    addImageLayer(b64, file.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
  };

  const handleUploadBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const b64 = await blobToBase64(file); setBgImage(b64); e.target.value = '';
  };

  const addProductImages = () => {
    const imgs: any[] = product?.images ?? product?.media ?? [];
    if (!imgs.length) { toast('У товара нет изображений', 'error'); return; }
    imgs.slice(0, 4).forEach((img: any, i: number) => {
      const url = typeof img === 'string' ? img : (img.url ?? img.src ?? '');
      if (url) setTimeout(() => addImageLayer(url, `Фото товара ${i + 1}`), i * 50);
    });
  };

  // ── Export ────────────────────────────────────────────────────────────────

  const exportCanvas = async () => {
    if (!canvasRef.current) return;
    try {
      const prev = zoom; setZoom(1); await new Promise(r => setTimeout(r, 150));
      const canvas = await html2canvas(canvasRef.current, { width: canvasW, height: canvasH, scale: 2, useCORS: true, allowTaint: true });
      setZoom(prev);
      const link = document.createElement('a');
      link.download = `studio_${product?.sku ?? 'export'}_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('PNG экспортирован', 'success');
    } catch { toast('Ошибка экспорта', 'error'); }
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          removeLayer(selectedId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, removeLayer]);

  // ─── Styles ────────────────────────────────────────────────────────────────

  const c = {
    root: { display: 'flex', flexDirection: 'column' as const, height: '88vh', background: '#0c0c18', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' },
    menubar: { height: 44, display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#0f0f1e', flexShrink: 0 },
    workspace: { flex: 1, display: 'flex', overflow: 'hidden' },
    sidebar: { width: 264, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column' as const, background: '#0d0d1a' },
    tabs: { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' },
    tab: (a: boolean): React.CSSProperties => ({ flex: 1, padding: '9px 4px', fontSize: 10, fontWeight: 700, textAlign: 'center' as const, cursor: 'pointer', letterSpacing: '0.06em', color: a ? '#a5b4fc' : 'rgba(255,255,255,0.28)', background: 'none', border: 'none', borderBottom: `2px solid ${a ? '#6366f1' : 'transparent'}`, transition: 'color 0.2s', textTransform: 'uppercase' as const }),
    scroll: { flex: 1, overflowY: 'auto' as const, padding: 10, display: 'flex', flexDirection: 'column' as const, gap: 8 },
    sec: { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: 10 } as React.CSSProperties,
    secTitle: { fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 },
    input: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '7px 9px', color: 'rgba(255,255,255,0.85)', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
    textarea: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '7px 9px', color: 'rgba(255,255,255,0.85)', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', resize: 'none' as const, minHeight: 64 },
    btn: (v: 'primary' | 'ghost' | 'danger' | 'success' = 'ghost'): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent', transition: 'all 0.15s',
      ...(v === 'primary' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', borderColor: 'rgba(99,102,241,0.4)' }
        : v === 'success' ? { background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff' }
        : v === 'danger' ? { background: 'rgba(239,68,68,0.12)', color: '#f87171', borderColor: 'rgba(239,68,68,0.2)' }
        : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.09)' }),
    }),
    iconBtn: (active = false): React.CSSProperties => ({ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', border: 'none', flexShrink: 0, background: active ? 'rgba(99,102,241,0.28)' : 'rgba(255,255,255,0.06)', color: active ? '#a5b4fc' : 'rgba(255,255,255,0.55)', transition: 'all 0.12s' }),
    canvasArea: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(ellipse at 50% 50%, #141428 0%, #0a0a14 100%)', overflow: 'hidden', position: 'relative' as const },
    rightPanel: { width: 220, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.07)', background: '#0d0d1a', overflowY: 'auto' as const },
    statusbar: { height: 26, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#0a0a14', fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0 },
  };

  // ─── Render layer ──────────────────────────────────────────────────────────

  const renderLayer = (layer: Layer) => {
    if (layer.visible === false) return null;
    const isSel = layer.id === selectedId;
    const rnd = {
      key: layer.id,
      position: { x: layer.x, y: layer.y },
      size: { width: layer.width as number, height: layer.height === 'auto' ? 'auto' : layer.height as number },
      onDragStop: (_: any, d: any) => updateLayer(layer.id, { x: d.x, y: d.y }),
      onResizeStop: (_: any, __: any, ref: any, ___: any, pos: any) => updateLayer(layer.id, { width: parseInt(ref.style.width), height: parseInt(ref.style.height), ...pos }),
      onClick: (e: any) => { e.stopPropagation(); setSelectedId(layer.id); setPanel('props'); },
      style: { outline: isSel ? '2px solid #6366f1' : 'none', outlineOffset: 2, opacity: layer.opacity ?? 1, cursor: layer.locked ? 'not-allowed' : 'move' },
      disableDragging: layer.locked,
      enableResizing: !layer.locked,
      bounds: 'parent' as const,
    };
    if (layer.type === 'image' && layer.src)
      return <Rnd {...rnd}><img src={layer.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none', userSelect: 'none' }} draggable={false} crossOrigin="anonymous" /></Rnd>;
    if (layer.type === 'text')
      return <Rnd {...rnd} enableResizing={{ right: true, bottom: true, bottomRight: true }}><div style={{ width: '100%', height: '100%', fontSize: layer.fontSize, color: layer.color, fontWeight: layer.fontWeight as any, textAlign: layer.textAlign, fontFamily: layer.fontFamily, userSelect: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.2 }}>{layer.text}</div></Rnd>;
    if (layer.type === 'shape')
      return <Rnd {...rnd}><div style={{ width: '100%', height: '100%', background: layer.shapeFill, borderRadius: layer.borderRadius }} /></Rnd>;
    return null;
  };

  // ─── Properties panel ──────────────────────────────────────────────────────

  const PropertiesPanel = () => {
    if (!selected) return <div style={{ padding: 20, color: 'rgba(255,255,255,0.2)', fontSize: 11, textAlign: 'center' }}>Кликните на слой для редактирования</div>;
    return (
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={c.secTitle}>Свойства</p>
        <div>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 3 }}>Прозрачность {Math.round((selected.opacity ?? 1) * 100)}%</label>
          <input type="range" min={0} max={1} step={0.01} value={selected.opacity ?? 1} onChange={e => updateLayer(selected.id, { opacity: parseFloat(e.target.value) })} style={{ width: '100%', accentColor: '#6366f1' }} />
        </div>
        {selected.type === 'text' && <>
          <textarea style={c.textarea} value={selected.text ?? ''} onChange={e => updateLayer(selected.id, { text: e.target.value })} rows={3} />
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="number" style={{ ...c.input, width: 60 }} value={selected.fontSize ?? 48} onChange={e => updateLayer(selected.id, { fontSize: parseInt(e.target.value) || 48 })} />
            <input type="color" value={selected.color ?? '#ffffff'} onChange={e => updateLayer(selected.id, { color: e.target.value })} style={{ width: 32, height: 32, borderRadius: 6, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
            <button style={c.iconBtn(selected.fontWeight === 'bold')} onClick={() => updateLayer(selected.id, { fontWeight: selected.fontWeight === 'bold' ? 'normal' : 'bold' })}><Bold size={13} /></button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['left', 'center', 'right'] as const).map(a => (
              <button key={a} style={c.iconBtn(selected.textAlign === a)} onClick={() => updateLayer(selected.id, { textAlign: a })}>
                {a === 'left' ? <AlignLeft size={12} /> : a === 'center' ? <AlignCenter size={12} /> : <AlignRight size={12} />}
              </button>
            ))}
          </div>
          <select style={c.input} value={selected.fontFamily ?? 'Inter'} onChange={e => updateLayer(selected.id, { fontFamily: e.target.value })}>
            {FONTS.map(f => <option key={f}>{f}</option>)}
          </select>
        </>}
        {selected.type === 'shape' && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Цвет</label>
          <input type="color" value={(selected.shapeFill ?? '#6366f1').startsWith('#') ? selected.shapeFill : '#6366f1'} onChange={e => updateLayer(selected.id, { shapeFill: e.target.value })} style={{ width: 32, height: 32, borderRadius: 6, border: 'none', background: 'none', cursor: 'pointer' }} />
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Скругл.</label>
          <input type="number" style={{ ...c.input, width: 55 }} min={0} max={999} value={selected.borderRadius ?? 0} onChange={e => updateLayer(selected.id, { borderRadius: parseInt(e.target.value) || 0 })} />
        </div>}
        {selected.type === 'image' && selected.src && (
          <button style={{ ...c.btn('ghost'), width: '100%' }} disabled={removingBg === selected.id} onClick={() => removeBackground(selected.id, selected.src!)}>
            {removingBg === selected.id ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Удаляю фон...</> : <><Eraser size={12} />Удалить фон AI</>}
          </button>
        )}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '2px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <button style={c.btn()} onClick={() => moveLayerUp(selected.id)}><ChevronUp size={12} />Вверх</button>
          <button style={c.btn()} onClick={() => moveLayerDown(selected.id)}><ChevronDown size={12} />Вниз</button>
          <button style={c.btn()} onClick={() => duplicateLayer(selected.id)}><Copy size={12} />Копия</button>
          <button style={c.btn()} onClick={() => updateLayer(selected.id, { visible: !(selected.visible !== false) })}>
            {selected.visible === false ? <EyeOff size={12} /> : <Eye size={12} />}
            {selected.visible === false ? 'Показать' : 'Скрыть'}
          </button>
        </div>
        <button style={{ ...c.btn('danger'), width: '100%' }} onClick={() => removeLayer(selected.id)}><Trash2 size={12} />Удалить слой</button>
      </div>
    );
  };

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <div style={c.root}>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadImage} />
      <input ref={bgFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadBg} />

      {/* ── Menubar ── */}
      <div style={c.menubar}>
        {/* Left: Add elements */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <button style={c.iconBtn()} title="Добавить текст (T)" onClick={() => { addTextLayer(); setPanel('props'); }}><Type size={14} /></button>
          <button style={c.iconBtn()} title="Загрузить изображение" onClick={() => fileInputRef.current?.click()}><ImageIcon size={14} /></button>
          <button style={c.iconBtn()} title="Прямоугольник" onClick={() => addShapeLayer('rect')}><Square size={14} /></button>
          <button style={c.iconBtn()} title="Круг" onClick={() => addShapeLayer('circle')}><Circle size={14} /></button>
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {/* Zoom */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <button style={c.iconBtn()} onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))}><ZoomIn size={14} /></button>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', minWidth: 38, textAlign: 'center', cursor: 'pointer' }} onClick={() => setZoom(0.42)}>{Math.round(zoom * 100)}%</span>
          <button style={c.iconBtn()} onClick={() => setZoom(z => Math.max(0.1, +(z - 0.1).toFixed(2)))}><ZoomOut size={14} /></button>
          <button style={c.iconBtn()} title="По экрану" onClick={() => setZoom(0.42)}><Monitor size={14} /></button>
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {/* Undo/Redo */}
        <button style={c.iconBtn()} title="Отменить (Ctrl+Z)" onClick={undo}><Undo2 size={14} /></button>
        <button style={c.iconBtn()} title="Вернуть (Ctrl+Y)" onClick={redo}><Redo2 size={14} /></button>

        <div style={{ flex: 1 }} />

        {/* Right: export */}
        <button style={c.iconBtn(rightPanel)} title="Панель свойств" onClick={() => setRightPanel(p => !p)}><PanelRight size={14} /></button>
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
        <button style={{ ...c.btn('ghost'), fontSize: 11 }} onClick={() => { setLayers([]); setBgImage(null); }}><Trash2 size={13} />Очистить</button>
        <button style={{ ...c.btn('success'), fontSize: 11 }} onClick={exportCanvas}><Download size={13} />Экспорт PNG</button>
      </div>

      {/* ── Workspace ── */}
      <div style={c.workspace}>

        {/* ── Left sidebar ── */}
        <div style={c.sidebar}>
          <div style={c.tabs}>
            {([['ai', '✦ AI'], ['layers', 'Слои'], ['props', 'Свойства'], ['templates', 'Холст']] as const).map(([key, label]) => (
              <button key={key} style={c.tab(panel === key)} onClick={() => setPanel(key)}>{label}</button>
            ))}
          </div>

          {/* AI Panel */}
          {panel === 'ai' && (
            <div style={c.scroll}>
              <div style={c.sec}>
                <p style={c.secTitle}>Генерация фона</p>
                <textarea style={{ ...c.textarea, marginBottom: 6 }} value={bgPrompt} onChange={e => setBgPrompt(e.target.value)} placeholder="Опишите фон..." />
                <select style={{ ...c.input, marginBottom: 6 }} value={bgModel} onChange={e => setBgModel(e.target.value)}>
                  {BG_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  <button style={c.btn()} onClick={() => bgFileInputRef.current?.click()}><Upload size={12} />Загрузить</button>
                  <button style={{ ...c.btn('primary'), opacity: generatingBg ? 0.7 : 1 }} onClick={generateBackground} disabled={generatingBg}>
                    {generatingBg ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Генерация...</> : <><Sparkles size={12} />Создать фон</>}
                  </button>
                </div>
                {bgImage && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                    <img src={bgImage} alt="bg" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button style={{ ...c.btn(), fontSize: 10, padding: '5px 8px' }} onClick={() => addImageLayer(bgImage, 'Фон')}><Plus size={10} />На холст как слой</button>
                      <button style={{ ...c.btn('danger'), fontSize: 10, padding: '5px 8px' }} onClick={() => setBgImage(null)}><X size={10} />Убрать</button>
                    </div>
                  </div>
                )}
              </div>

              <div style={c.sec}>
                <p style={c.secTitle}>Генерация элемента</p>
                <input style={{ ...c.input, marginBottom: 6 }} value={elementPrompt} onChange={e => setElementPrompt(e.target.value)} placeholder="Золотая звезда, значок, украшение..." onKeyDown={e => e.key === 'Enter' && generateElement()} />
                <button style={{ ...c.btn('primary'), width: '100%', opacity: generatingEl ? 0.7 : 1 }} onClick={generateElement} disabled={generatingEl}>
                  {generatingEl ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Генерация...</> : <><Wand2 size={12} />Создать элемент (Gemini)</>}
                </button>
              </div>

              <div style={c.sec}>
                <p style={c.secTitle}>AI-план инфографики</p>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 8, lineHeight: 1.4 }}>Сгенерирует текстовые слои на основе атрибутов товара</p>
                <button style={{ ...c.btn('primary'), width: '100%', opacity: generatingPlan ? 0.7 : 1 }} onClick={generateInfographicPlan} disabled={generatingPlan}>
                  {generatingPlan ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Генерация...</> : <><LayoutTemplate size={12} />Создать план</>}
                </button>
              </div>

              <div style={c.sec}>
                <p style={c.secTitle}>Фото товара</p>
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5, marginBottom: 6 }}>
                  {(product?.images ?? []).slice(0, 6).map((img: any, i: number) => {
                    const url = typeof img === 'string' ? img : (img.url ?? img.src ?? '');
                    return url ? (
                      <div key={i} onClick={() => addImageLayer(url, `Фото ${i + 1}`)} title="Добавить на холст"
                        style={{ width: 48, height: 48, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', transition: 'border-color 0.15s' }}>
                        <img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    ) : null;
                  })}
                </div>
                <button style={{ ...c.btn(), width: '100%', marginBottom: 5 }} onClick={addProductImages}><ImageIcon size={12} />Добавить все фото</button>
                <button style={{ ...c.btn(), width: '100%' }} onClick={() => fileInputRef.current?.click()}><Upload size={12} />Загрузить своё фото</button>
              </div>
            </div>
          )}

          {/* Layers Panel */}
          {panel === 'layers' && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 4 }}>
                <button style={c.iconBtn()} title="Текст" onClick={() => addTextLayer()}><Type size={13} /></button>
                <button style={c.iconBtn()} title="Изображение" onClick={() => fileInputRef.current?.click()}><ImageIcon size={13} /></button>
                <button style={c.iconBtn()} title="Прямоугольник" onClick={() => addShapeLayer('rect')}><Square size={13} /></button>
                <button style={c.iconBtn()} title="Круг" onClick={() => addShapeLayer('circle')}><Circle size={13} /></button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' as const }}>
                {layers.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.18)', fontSize: 11 }}>Нет слоёв. Добавьте через AI или +.</div>
                ) : (
                  [...layers].reverse().map(layer => (
                    <div key={layer.id} onClick={() => { setSelectedId(layer.id); setPanel('props'); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', cursor: 'pointer', background: selectedId === layer.id ? 'rgba(99,102,241,0.1)' : 'transparent', borderLeft: `2px solid ${selectedId === layer.id ? '#6366f1' : 'transparent'}`, borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: layer.visible === false ? 0.4 : 1 }}>
                      <span style={{ fontSize: 13 }}>{layer.type === 'text' ? '𝐓' : layer.type === 'image' ? '🖼' : '◻'}</span>
                      <span style={{ flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.label ?? layer.text?.slice(0, 22) ?? 'Layer'}</span>
                      <button style={{ ...c.iconBtn(), width: 20, height: 20 }} onClick={e => { e.stopPropagation(); updateLayer(layer.id, { visible: !(layer.visible !== false) }); }}>
                        {layer.visible === false ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                      <button style={{ ...c.iconBtn(), width: 20, height: 20, color: '#f87171' }} onClick={e => { e.stopPropagation(); removeLayer(layer.id); }}><X size={10} /></button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Properties panel in sidebar */}
          {panel === 'props' && <div style={{ flex: 1, overflowY: 'auto' as const }}><PropertiesPanel /></div>}

          {/* Templates / Canvas size */}
          {panel === 'templates' && (
            <div style={c.scroll}>
              <div style={c.sec}>
                <p style={c.secTitle}>Размер холста</p>
                {CANVAS_PRESETS.map(p => (
                  <button key={p.label} style={{ ...c.btn(canvasW === p.w && canvasH === p.h ? 'primary' : 'ghost'), width: '100%', justifyContent: 'space-between', marginBottom: 4 }} onClick={() => { setCanvasW(p.w); setCanvasH(p.h); }}>
                    <span>{p.label}</span><span style={{ opacity: 0.5, fontSize: 10 }}>{p.w}×{p.h}</span>
                  </button>
                ))}
              </div>
              <div style={c.sec}>
                <p style={c.secTitle}>Цвет фона</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={bgColor} onChange={e => { setBgColor(e.target.value); if (!bgImage) {} }} style={{ width: 36, height: 36, borderRadius: 6, border: 'none', cursor: 'pointer' }} />
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{bgColor}</span>
                  <button style={{ ...c.btn('danger'), padding: '5px 8px', fontSize: 10 }} onClick={() => setBgImage(null)}><X size={10} />Убрать фон</button>
                </div>
              </div>
              <div style={c.sec}>
                <p style={c.secTitle}>Быстрые шаблоны</p>
                {[
                  { name: '🏷 Карточка товара', fn: () => { setLayers([]); addTextLayer(product?.name ?? 'Название товара', { fontSize: 64, y: 60 }); addTextLayer(product?.sku ? `Арт. ${product.sku}` : 'SKU', { fontSize: 28, y: 180, color: 'rgba(255,255,255,0.5)', fontWeight: 'normal' }); } },
                  { name: '🔥 Промо-баннер', fn: () => { setLayers([]); addTextLayer('СКИДКА 50%', { fontSize: 128, y: 80, color: '#f59e0b' }); addTextLayer(product?.name ?? 'Название товара', { fontSize: 52, y: 260 }); addTextLayer('Только сегодня', { fontSize: 36, y: 360, color: 'rgba(255,255,255,0.6)', fontWeight: 'normal' }); } },
                  { name: '📋 Характеристики', fn: () => { setLayers([]); addTextLayer(product?.name ?? 'Товар', { fontSize: 60, y: 40 }); addTextLayer('• Характеристика 1\n• Характеристика 2\n• Характеристика 3', { fontSize: 32, y: 160, color: 'rgba(255,255,255,0.75)', fontWeight: 'normal', textAlign: 'left' }); } },
                ].map(t => <button key={t.name} style={{ ...c.btn(), width: '100%', justifyContent: 'flex-start', marginBottom: 4 }} onClick={t.fn}>{t.name}</button>)}
              </div>
            </div>
          )}
        </div>

        {/* ── Canvas Area ── */}
        <div style={c.canvasArea} onClick={() => setSelectedId(null)}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', width: canvasW, height: canvasH, position: 'relative', flexShrink: 0, boxShadow: '0 8px 80px rgba(0,0,0,0.9)' }}>
            <div ref={canvasRef} style={{ width: canvasW, height: canvasH, position: 'relative', overflow: 'hidden', background: bgImage ? `url(${bgImage}) center/cover no-repeat` : bgColor }}>
              {layers.map(renderLayer)}
            </div>
          </div>
        </div>

        {/* ── Right Properties Panel ── */}
        {rightPanel && (
          <div style={c.rightPanel}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>
              {selected ? `${selected.type === 'text' ? 'Текст' : selected.type === 'image' ? 'Изображение' : 'Фигура'} — ${selected.label ?? selected.id.slice(0, 8)}` : 'Свойства слоя'}
            </div>
            <PropertiesPanel />
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div style={c.statusbar}>
        <span>{canvasW}×{canvasH}px</span>
        <span>•</span>
        <span>{layers.length} слоёв</span>
        {selected && <><span>•</span><span>{selected.label ?? selected.type}</span><span style={{ opacity: 0.6 }}>{selected.x},{selected.y}</span></>}
        <span style={{ flex: 1 }} />
        <span>Del — удалить • Ctrl+Z — отменить</span>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
