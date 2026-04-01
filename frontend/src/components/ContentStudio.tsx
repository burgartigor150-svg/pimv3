import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import html2canvas from 'html2canvas';
import {
  Sparkles, Download, Type, Image as ImageIcon, Layers, Plus, Trash2,
  RefreshCw, Wand2, Eraser, ZoomIn, ZoomOut, Move, AlignLeft, AlignCenter,
  AlignRight, Bold, X, Upload, Eye, EyeOff, Copy, ChevronUp, ChevronDown,
  Palette, LayoutTemplate,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Toast';

// ─── Types ─────────────────────────────────────────────────────────────────

type LayerType = 'image' | 'text' | 'shape';

interface Layer {
  id: string;
  type: LayerType;
  src?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number | 'auto';
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

const CANVAS_W = 1080;
const CANVAS_H = 1080;

const FONTS = ['Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Trebuchet MS', 'Playfair Display'];

const PRESETS = [
  { label: 'Квадрат 1:1', w: 1080, h: 1080 },
  { label: 'Сторис 9:16', w: 1080, h: 1920 },
  { label: 'Пост 4:5', w: 1080, h: 1350 },
  { label: 'Баннер 16:9', w: 1920, h: 1080 },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid() { return 'l_' + Math.random().toString(36).slice(2, 9); }

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader();
    r.onloadend = () => res(r.result as string);
    r.readAsDataURL(blob);
  });
}

function fileToBase64(file: File): Promise<string> {
  return blobToBase64(file);
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ContentStudio({ product }: { product: any }) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  const [canvasW, setCanvasW] = useState(CANVAS_W);
  const [canvasH, setCanvasH] = useState(CANVAS_H);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.45);

  // Panels
  const [activePanel, setActivePanel] = useState<'layers' | 'ai' | 'templates'>('ai');

  // AI state
  const [bgPrompt, setBgPrompt] = useState('professional studio photography, soft cinematic lighting, clean background, product showcase');
  const [elementPrompt, setElementPrompt] = useState('');
  const [modelId, setModelId] = useState('5c232a9e-9061-4777-980a-ddc8e65647c6');
  const [generatingBg, setGeneratingBg] = useState(false);
  const [generatingEl, setGeneratingEl] = useState(false);
  const [removingBg, setRemovingBg] = useState<string | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);

  const selected = layers.find(l => l.id === selectedId) ?? null;

  // ── Layer helpers ─────────────────────────────────────────────────────────

  const updateLayer = useCallback((id: string, upd: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...upd } : l));
  }, []);

  const removeLayer = useCallback((id: string) => {
    setLayers(prev => prev.filter(l => l.id !== id));
    setSelectedId(prev => prev === id ? null : prev);
  }, []);

  const moveLayerUp = (id: string) => {
    setLayers(prev => {
      const i = prev.findIndex(l => l.id === id);
      if (i >= prev.length - 1) return prev;
      const arr = [...prev];
      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      return arr;
    });
  };

  const moveLayerDown = (id: string) => {
    setLayers(prev => {
      const i = prev.findIndex(l => l.id === id);
      if (i <= 0) return prev;
      const arr = [...prev];
      [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
      return arr;
    });
  };

  const duplicateLayer = (id: string) => {
    const l = layers.find(l => l.id === id);
    if (!l) return;
    setLayers(prev => [...prev, { ...l, id: uid(), x: l.x + 20, y: l.y + 20, label: (l.label ?? l.text ?? 'Layer') + ' (копия)' }]);
  };

  // ── Add layers ────────────────────────────────────────────────────────────

  const addImageLayer = (src: string, label = 'Image') => {
    const id = uid();
    setLayers(prev => [...prev, {
      id, type: 'image', src, label,
      x: canvasW * 0.25, y: canvasH * 0.25,
      width: canvasW * 0.5, height: canvasH * 0.5,
      opacity: 1, visible: true,
    }]);
    setSelectedId(id);
  };

  const addTextLayer = (text = 'НОВЫЙ ТЕКСТ') => {
    const id = uid();
    setLayers(prev => [...prev, {
      id, type: 'text', text, label: text.slice(0, 20),
      x: 50, y: 50, width: 600, height: 'auto',
      fontSize: 72, color: '#ffffff', fontWeight: 'bold',
      textAlign: 'center', fontFamily: 'Inter',
      opacity: 1, visible: true,
    }]);
    setSelectedId(id);
  };

  const addShapeLayer = (shapeType: 'rect' | 'circle' = 'rect') => {
    const id = uid();
    setLayers(prev => [...prev, {
      id, type: 'shape', shapeType, label: shapeType === 'rect' ? 'Прямоугольник' : 'Круг',
      x: 200, y: 200, width: 400, height: 200,
      shapeFill: 'rgba(99,102,241,0.7)', borderRadius: shapeType === 'circle' ? 999 : 16,
      opacity: 1, visible: true,
    }]);
    setSelectedId(id);
  };

  // ── AI: Generate Background ───────────────────────────────────────────────

  const generateBackground = async () => {
    setGeneratingBg(true);
    try {
      const formData = new FormData();
      formData.append('prompt', bgPrompt);
      formData.append('model_id', modelId);
      if (product?.id) formData.append('product_id', product.id);
      const res = await api.post('/visual/generate-background', formData, {
        responseType: 'blob',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const b64 = await blobToBase64(res.data as Blob);
      setBgImage(b64);
      toast('Фон сгенерирован', 'success');
    } catch {
      toast('Ошибка генерации фона. GPU-сервис недоступен.', 'error');
    } finally {
      setGeneratingBg(false);
    }
  };

  // ── AI: Generate Element ──────────────────────────────────────────────────

  const generateElement = async () => {
    if (!elementPrompt.trim()) return;
    setGeneratingEl(true);
    try {
      const formData = new FormData();
      formData.append('prompt', elementPrompt);
      formData.append('is_icon', 'false');
      formData.append('model_id', 'gemini-2.5-flash-image');
      const res = await api.post('/visual/generate-element', formData, {
        responseType: 'blob',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const b64 = await blobToBase64(res.data as Blob);
      addImageLayer(b64, elementPrompt.slice(0, 30));
      toast('Элемент создан', 'success');
    } catch {
      toast('Ошибка генерации элемента', 'error');
    } finally {
      setGeneratingEl(false);
    }
  };

  // ── AI: Remove Background ─────────────────────────────────────────────────

  const removeBackground = async (layerId: string, src: string) => {
    setRemovingBg(layerId);
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const formData = new FormData();
      formData.append('file', blob, 'image.png');
      const apiRes = await api.post('/visual/remove-background', formData, {
        responseType: 'blob',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const b64 = await blobToBase64(apiRes.data as Blob);
      updateLayer(layerId, { src: b64 });
      toast('Фон удалён', 'success');
    } catch {
      toast('Ошибка удаления фона. GPU-сервис недоступен.', 'error');
    } finally {
      setRemovingBg(null);
    }
  };

  // ── AI: Infographic Plan ──────────────────────────────────────────────────

  const generateInfographicPlan = async () => {
    if (!product?.id) return;
    setGeneratingPlan(true);
    try {
      const res = await api.post('/ai/generate-infographic-plan', { product_id: product.id });
      const slides: any[] = res.data?.slides ?? [];
      // Auto-populate text layers from plan
      setLayers([]);
      slides.slice(0, 4).forEach((slide: any, i: number) => {
        const yOff = i * 80;
        addTextLayerDirect(slide.headline ?? slide.title ?? `Слайд ${i + 1}`, 60, '#ffffff', yOff + 40);
        if (slide.body) addTextLayerDirect(slide.body, 28, 'rgba(255,255,255,0.7)', yOff + 120);
      });
      toast('План инфографики создан — добавлены текстовые слои', 'success');
    } catch {
      toast('Ошибка генерации плана', 'error');
    } finally {
      setGeneratingPlan(false);
    }
  };

  function addTextLayerDirect(text: string, fontSize: number, color: string, yOff: number) {
    setLayers(prev => [...prev, {
      id: uid(), type: 'text', text, label: text.slice(0, 24),
      x: 80, y: yOff, width: canvasW - 160, height: 'auto',
      fontSize, color, fontWeight: fontSize > 40 ? 'bold' : 'normal',
      textAlign: 'center', fontFamily: 'Inter', opacity: 1, visible: true,
    }]);
  }

  // ── Upload handlers ───────────────────────────────────────────────────────

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    addImageLayer(b64, file.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
  };

  const handleUploadBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    setBgImage(b64);
    e.target.value = '';
  };

  // Add product images as layers
  const addProductImages = () => {
    const imgs: any[] = product?.images ?? product?.media ?? [];
    if (!imgs.length) { toast('У товара нет изображений', 'error'); return; }
    imgs.slice(0, 3).forEach((img: any, i: number) => {
      const url = typeof img === 'string' ? img : (img.url ?? img.src ?? '');
      if (url) addImageLayer(url, `Фото товара ${i + 1}`);
    });
  };

  // ── Export ────────────────────────────────────────────────────────────────

  const exportCanvas = async () => {
    if (!canvasRef.current) return;
    try {
      const prev = zoom;
      setZoom(1);
      await new Promise(r => setTimeout(r, 100));
      const canvas = await html2canvas(canvasRef.current, {
        width: canvasW, height: canvasH, scale: 2, useCORS: true, allowTaint: true,
      });
      setZoom(prev);
      const link = document.createElement('a');
      link.download = `studio_${product?.sku ?? 'export'}_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('Изображение сохранено', 'success');
    } catch {
      toast('Ошибка экспорта', 'error');
    }
  };

  // ── Styles ────────────────────────────────────────────────────────────────

  const s = {
    root: {
      display: 'flex', height: '82vh', background: '#0a0a14', borderRadius: 16,
      overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)',
    } as React.CSSProperties,

    sidebar: {
      width: 280, borderRight: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', flexDirection: 'column' as const, flexShrink: 0,
      background: '#0d0d1a',
    },

    toolbar: {
      display: 'flex', gap: 4, padding: '10px 12px',
      borderBottom: '1px solid rgba(255,255,255,0.07)', flexWrap: 'wrap' as const,
    },

    canvasArea: {
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'repeating-conic-gradient(rgba(255,255,255,0.03) 0% 25%, transparent 0% 50%) 0 0 / 20px 20px',
      overflow: 'hidden', position: 'relative' as const,
    },

    panelTabs: {
      display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)',
    },

    panelTab: (active: boolean): React.CSSProperties => ({
      flex: 1, padding: '10px 0', fontSize: 11, fontWeight: 600,
      textAlign: 'center', cursor: 'pointer', letterSpacing: '0.05em',
      color: active ? '#a5b4fc' : 'rgba(255,255,255,0.3)',
      borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
      background: 'none', border: 'none', borderBottomWidth: 2,
      borderBottomStyle: 'solid', borderBottomColor: active ? '#6366f1' : 'transparent',
      transition: 'color 0.2s',
    }),

    scrollPane: {
      flex: 1, overflowY: 'auto' as const, padding: 12,
      display: 'flex', flexDirection: 'column' as const, gap: 12,
    },

    section: {
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, padding: 12,
    } as React.CSSProperties,

    sectionTitle: {
      fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)',
      textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 10,
    },

    input: {
      width: '100%', background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
      padding: '8px 10px', color: 'rgba(255,255,255,0.85)', fontSize: 12,
      outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit',
    },

    textarea: {
      width: '100%', background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
      padding: '8px 10px', color: 'rgba(255,255,255,0.85)', fontSize: 12,
      outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit',
      resize: 'none' as const, minHeight: 70,
    },

    btn: (variant: 'primary' | 'ghost' | 'danger' = 'ghost'): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
      borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      border: 'none', transition: 'all 0.2s',
      ...(variant === 'primary'
        ? { background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff' }
        : variant === 'danger'
        ? { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }
        : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.1)' }),
    }),

    iconBtn: (active = false): React.CSSProperties => ({
      width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 7, cursor: 'pointer', border: 'none',
      background: active ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
      color: active ? '#a5b4fc' : 'rgba(255,255,255,0.6)',
      transition: 'all 0.15s',
    }),
  };

  // ── Render Layer on Canvas ────────────────────────────────────────────────

  const renderLayer = (layer: Layer) => {
    if (layer.visible === false) return null;
    const isSelected = layer.id === selectedId;

    const rndProps = {
      key: layer.id,
      position: { x: layer.x, y: layer.y },
      size: { width: layer.width as number, height: layer.height === 'auto' ? 'auto' : layer.height as number },
      onDragStop: (_: any, d: any) => updateLayer(layer.id, { x: d.x, y: d.y }),
      onResizeStop: (_: any, __: any, ref: any, ___: any, pos: any) => {
        updateLayer(layer.id, { width: parseInt(ref.style.width), height: parseInt(ref.style.height), ...pos });
      },
      onClick: (e: any) => { e.stopPropagation(); setSelectedId(layer.id); },
      style: {
        outline: isSelected ? '2px solid #6366f1' : 'none',
        outlineOffset: 2,
        opacity: layer.opacity ?? 1,
        cursor: 'move',
      },
      bounds: 'parent' as const,
    };

    if (layer.type === 'image' && layer.src) {
      return (
        <Rnd {...rndProps}>
          <img
            src={layer.src}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none', userSelect: 'none' }}
            draggable={false}
            crossOrigin="anonymous"
          />
        </Rnd>
      );
    }

    if (layer.type === 'text') {
      return (
        <Rnd {...rndProps} enableResizing={{ right: true, bottom: true, bottomRight: true }}>
          <div
            style={{
              width: '100%', height: '100%',
              fontSize: layer.fontSize, color: layer.color,
              fontWeight: layer.fontWeight as any,
              textAlign: layer.textAlign, fontFamily: layer.fontFamily,
              userSelect: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              lineHeight: 1.2,
            }}
          >
            {layer.text}
          </div>
        </Rnd>
      );
    }

    if (layer.type === 'shape') {
      return (
        <Rnd {...rndProps}>
          <div
            style={{
              width: '100%', height: '100%',
              background: layer.shapeFill,
              borderRadius: layer.borderRadius,
            }}
          />
        </Rnd>
      );
    }

    return null;
  };

  // ── Properties Panel ──────────────────────────────────────────────────────

  const PropertiesPanel = () => {
    if (!selected) return (
      <div style={{ padding: 16, color: 'rgba(255,255,255,0.2)', fontSize: 12, textAlign: 'center' }}>
        Выберите слой для редактирования
      </div>
    );

    return (
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={s.sectionTitle}>Свойства слоя</p>

        {/* Opacity */}
        <div>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 4 }}>
            Прозрачность: {Math.round((selected.opacity ?? 1) * 100)}%
          </label>
          <input type="range" min={0} max={1} step={0.01}
            value={selected.opacity ?? 1}
            onChange={e => updateLayer(selected.id, { opacity: parseFloat(e.target.value) })}
            style={{ width: '100%', accentColor: '#6366f1' }}
          />
        </div>

        {/* Text-specific */}
        {selected.type === 'text' && (
          <>
            <textarea
              style={s.textarea}
              value={selected.text ?? ''}
              onChange={e => updateLayer(selected.id, { text: e.target.value })}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" style={{ ...s.input, width: 70 }}
                value={selected.fontSize ?? 48}
                onChange={e => updateLayer(selected.id, { fontSize: parseInt(e.target.value) || 48 })}
              />
              <input type="color" value={selected.color ?? '#ffffff'}
                onChange={e => updateLayer(selected.id, { color: e.target.value })}
                style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer' }}
              />
              <button style={s.iconBtn(selected.fontWeight === 'bold')}
                onClick={() => updateLayer(selected.id, { fontWeight: selected.fontWeight === 'bold' ? 'normal' : 'bold' })}>
                <Bold size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a} style={s.iconBtn(selected.textAlign === a)}
                  onClick={() => updateLayer(selected.id, { textAlign: a })}>
                  {a === 'left' ? <AlignLeft size={13} /> : a === 'center' ? <AlignCenter size={13} /> : <AlignRight size={13} />}
                </button>
              ))}
            </div>
            <select style={s.input}
              value={selected.fontFamily ?? 'Inter'}
              onChange={e => updateLayer(selected.id, { fontFamily: e.target.value })}>
              {FONTS.map(f => <option key={f}>{f}</option>)}
            </select>
          </>
        )}

        {/* Shape-specific */}
        {selected.type === 'shape' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Цвет</label>
            <input type="color" value={(selected.shapeFill ?? '#6366f1').replace(/rgba?\(.*/, '#6366f1')}
              onChange={e => updateLayer(selected.id, { shapeFill: e.target.value })}
              style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer' }}
            />
            <input type="range" min={0} max={999} step={1}
              value={selected.borderRadius ?? 0}
              onChange={e => updateLayer(selected.id, { borderRadius: parseInt(e.target.value) })}
              style={{ flex: 1, accentColor: '#6366f1' }}
            />
          </div>
        )}

        {/* Image-specific */}
        {selected.type === 'image' && selected.src && (
          <button
            style={{ ...s.btn('ghost'), width: '100%', justifyContent: 'center' }}
            disabled={removingBg === selected.id}
            onClick={() => removeBackground(selected.id, selected.src!)}
          >
            {removingBg === selected.id
              ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />Удаляю фон...</>
              : <><Eraser size={13} />Удалить фон (AI)</>
            }
          </button>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={s.iconBtn()} title="Вверх" onClick={() => moveLayerUp(selected.id)}><ChevronUp size={14} /></button>
          <button style={s.iconBtn()} title="Вниз" onClick={() => moveLayerDown(selected.id)}><ChevronDown size={14} /></button>
          <button style={s.iconBtn()} title="Дублировать" onClick={() => duplicateLayer(selected.id)}><Copy size={14} /></button>
          <button style={s.iconBtn(selected.visible === false)} title="Скрыть"
            onClick={() => updateLayer(selected.id, { visible: !(selected.visible !== false) })}>
            {selected.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button style={{ ...s.iconBtn(), color: '#f87171', marginLeft: 'auto' }}
            title="Удалить" onClick={() => removeLayer(selected.id)}><Trash2 size={14} /></button>
        </div>
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div style={s.root}>
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadImage} />
      <input ref={bgFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadBg} />

      {/* ── Left Sidebar ── */}
      <div style={s.sidebar}>
        {/* Panel tabs */}
        <div style={s.panelTabs}>
          {([['ai', '✦ AI'], ['layers', 'Слои'], ['templates', 'Шаблоны']] as const).map(([key, label]) => (
            <button key={key} style={s.panelTab(activePanel === key)} onClick={() => setActivePanel(key)}>
              {label}
            </button>
          ))}
        </div>

        {/* AI Panel */}
        {activePanel === 'ai' && (
          <div style={s.scrollPane}>

            {/* Generate background */}
            <div style={s.section}>
              <p style={s.sectionTitle}>Генерация фона</p>
              <textarea
                style={{ ...s.textarea, marginBottom: 8 }}
                value={bgPrompt}
                onChange={e => setBgPrompt(e.target.value)}
                placeholder="Опишите желаемый фон..."
              />
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button style={{ ...s.btn('ghost'), flex: 1, justifyContent: 'center' }}
                  onClick={() => bgFileInputRef.current?.click()}>
                  <Upload size={13} />Загрузить
                </button>
                <button
                  style={{ ...s.btn('primary'), flex: 1, justifyContent: 'center', opacity: generatingBg ? 0.7 : 1 }}
                  onClick={generateBackground}
                  disabled={generatingBg}
                >
                  {generatingBg
                    ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />Генерирую...</>
                    : <><Sparkles size={13} />Создать фон</>
                  }
                </button>
              </div>
              {bgImage && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <img src={bgImage} alt="bg" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <button style={{ ...s.btn('ghost'), fontSize: 11, justifyContent: 'center' }}
                      onClick={() => addImageLayer(bgImage, 'Фон')}><Plus size={11} />На холст</button>
                    <button style={{ ...s.btn('danger'), fontSize: 11, justifyContent: 'center' }}
                      onClick={() => setBgImage(null)}><X size={11} />Удалить</button>
                  </div>
                </div>
              )}
            </div>

            {/* Generate element */}
            <div style={s.section}>
              <p style={s.sectionTitle}>Генерация элемента</p>
              <input
                style={{ ...s.input, marginBottom: 8 }}
                value={elementPrompt}
                onChange={e => setElementPrompt(e.target.value)}
                placeholder="Звезда, значок, украшение..."
                onKeyDown={e => e.key === 'Enter' && generateElement()}
              />
              <button
                style={{ ...s.btn('primary'), width: '100%', justifyContent: 'center', opacity: generatingEl ? 0.7 : 1 }}
                onClick={generateElement} disabled={generatingEl}
              >
                {generatingEl
                  ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />Генерирую...</>
                  : <><Wand2 size={13} />Создать элемент</>
                }
              </button>
            </div>

            {/* Infographic plan */}
            <div style={s.section}>
              <p style={s.sectionTitle}>AI-план инфографики</p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>
                AI создаст структуру текстовых слоёв на основе атрибутов товара
              </p>
              <button
                style={{ ...s.btn('primary'), width: '100%', justifyContent: 'center', opacity: generatingPlan ? 0.7 : 1 }}
                onClick={generateInfographicPlan} disabled={generatingPlan}
              >
                {generatingPlan
                  ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />Генерирую...</>
                  : <><LayoutTemplate size={13} />Создать план</>
                }
              </button>
            </div>

            {/* Add product images */}
            <div style={s.section}>
              <p style={s.sectionTitle}>Фото товара</p>
              <button style={{ ...s.btn('ghost'), width: '100%', justifyContent: 'center' }}
                onClick={addProductImages}>
                <ImageIcon size={13} />Добавить фото товара
              </button>
              <button style={{ ...s.btn('ghost'), width: '100%', justifyContent: 'center', marginTop: 6 }}
                onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} />Загрузить своё фото
              </button>
            </div>
          </div>
        )}

        {/* Layers Panel */}
        {activePanel === 'layers' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* Quick add */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 6 }}>
              <button style={s.iconBtn()} title="Текст" onClick={() => addTextLayer()}><Type size={14} /></button>
              <button style={s.iconBtn()} title="Изображение" onClick={() => fileInputRef.current?.click()}><ImageIcon size={14} /></button>
              <button style={s.iconBtn()} title="Прямоугольник" onClick={() => addShapeLayer('rect')}><Palette size={14} /></button>
              <button style={s.iconBtn()} title="Круг" onClick={() => addShapeLayer('circle')}><Layers size={14} /></button>
            </div>

            {/* Layer list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {layers.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
                  Нет слоёв. Добавьте элементы с вкладки AI.
                </div>
              ) : (
                [...layers].reverse().map(layer => (
                  <div
                    key={layer.id}
                    onClick={() => setSelectedId(layer.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', cursor: 'pointer',
                      background: selectedId === layer.id ? 'rgba(99,102,241,0.12)' : 'transparent',
                      borderLeft: selectedId === layer.id ? '2px solid #6366f1' : '2px solid transparent',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      opacity: layer.visible === false ? 0.4 : 1,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>
                      {layer.type === 'text' ? '𝐓' : layer.type === 'image' ? '🖼' : '◻'}
                    </span>
                    <span style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {layer.label ?? layer.text?.slice(0, 20) ?? 'Layer'}
                    </span>
                    <button style={{ ...s.iconBtn(), width: 22, height: 22 }}
                      onClick={e => { e.stopPropagation(); updateLayer(layer.id, { visible: !(layer.visible !== false) }); }}>
                      {layer.visible === false ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                    <button style={{ ...s.iconBtn(), width: 22, height: 22, color: '#f87171' }}
                      onClick={e => { e.stopPropagation(); removeLayer(layer.id); }}>
                      <X size={11} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Properties */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', maxHeight: '40%', overflowY: 'auto' }}>
              <PropertiesPanel />
            </div>
          </div>
        )}

        {/* Templates Panel */}
        {activePanel === 'templates' && (
          <div style={s.scrollPane}>
            <div style={s.section}>
              <p style={s.sectionTitle}>Размер холста</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {PRESETS.map(p => (
                  <button key={p.label}
                    style={{ ...s.btn(canvasW === p.w && canvasH === p.h ? 'primary' : 'ghost'), justifyContent: 'space-between' }}
                    onClick={() => { setCanvasW(p.w); setCanvasH(p.h); }}
                  >
                    <span>{p.label}</span>
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{p.w}×{p.h}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={s.section}>
              <p style={s.sectionTitle}>Быстрые шаблоны</p>
              {[
                { name: 'Карточка товара', fn: () => {
                  setLayers([]);
                  addTextLayerDirect(product?.name ?? 'Название товара', 64, '#ffffff', 60);
                  addTextLayerDirect(product?.sku ? `Арт. ${product.sku}` : 'SKU', 28, 'rgba(255,255,255,0.5)', 160);
                }},
                { name: 'Промо-баннер', fn: () => {
                  setLayers([]);
                  addTextLayerDirect('СКИДКА 50%', 120, '#f59e0b', 80);
                  addTextLayerDirect(product?.name ?? 'Название товара', 48, '#ffffff', 220);
                  addTextLayerDirect('Только сегодня', 32, 'rgba(255,255,255,0.6)', 310);
                }},
                { name: 'Характеристики', fn: () => {
                  setLayers([]);
                  addTextLayerDirect(product?.name ?? 'Товар', 56, '#ffffff', 40);
                  addTextLayerDirect('• Характеристика 1\n• Характеристика 2\n• Характеристика 3', 32, 'rgba(255,255,255,0.7)', 140);
                }},
              ].map(t => (
                <button key={t.name} style={{ ...s.btn('ghost'), width: '100%', justifyContent: 'flex-start', marginBottom: 6 }}
                  onClick={t.fn}>
                  <LayoutTemplate size={13} />{t.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Canvas Area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Top toolbar */}
        <div style={{ ...s.toolbar, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button style={s.iconBtn()} onClick={() => addTextLayer()}><Type size={14} /></button>
            <button style={s.iconBtn()} onClick={() => fileInputRef.current?.click()}><ImageIcon size={14} /></button>
            <button style={s.iconBtn()} onClick={() => addShapeLayer('rect')}><Palette size={14} /></button>
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />
            <button style={s.iconBtn()} onClick={() => setZoom(z => Math.min(2, z + 0.1))}><ZoomIn size={14} /></button>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', minWidth: 36, textAlign: 'center' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button style={s.iconBtn()} onClick={() => setZoom(z => Math.max(0.1, z - 0.1))}><ZoomOut size={14} /></button>
            <button style={s.iconBtn()} onClick={() => setZoom(0.45)}><Move size={14} /></button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...s.btn('ghost') }} onClick={() => { setLayers([]); setBgImage(null); }}>
              <Trash2 size={13} />Очистить
            </button>
            <button style={{ ...s.btn('primary') }} onClick={exportCanvas}>
              <Download size={13} />Экспорт PNG
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div style={s.canvasArea} onClick={() => setSelectedId(null)}>
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
              width: canvasW,
              height: canvasH,
              position: 'relative',
              flexShrink: 0,
              boxShadow: '0 0 60px rgba(0,0,0,0.8)',
            }}
          >
            {/* Background */}
            <div
              ref={canvasRef}
              style={{
                width: canvasW, height: canvasH,
                position: 'relative', overflow: 'hidden',
                background: bgImage ? `url(${bgImage}) center/cover no-repeat` : '#1a1a2e',
              }}
            >
              {layers.map(renderLayer)}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
