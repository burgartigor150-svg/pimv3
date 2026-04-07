import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import html2canvas from 'html2canvas';
import {
  Sparkles, Download, Type, Image as ImageIcon, Layers, Plus, Trash2,
  RefreshCw, Wand2, Eraser, ZoomIn, ZoomOut, AlignLeft, AlignCenter,
  AlignRight, Bold, X, Upload, Eye, EyeOff, Copy, ChevronUp, ChevronDown,
  LayoutTemplate, Square, Circle, Maximize2, Save, Undo2, Redo2,
  PanelLeft, PanelRight, Monitor, Lock, Unlock, FolderOpen, ImagePlus,
  AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter,
  AlignStartHorizontal, AlignEndHorizontal, AlignStartVertical, AlignEndVertical,
  Italic, Underline, Move,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Toast';

type LayerType = 'image' | 'text' | 'shape';
type PanelTab = 'ai' | 'layers' | 'props' | 'canvas';

interface Layer {
  id: string; type: LayerType; src?: string; text?: string;
  x: number; y: number; width: number; height: number | 'auto';
  fontSize?: number; color?: string; fontWeight?: string; fontStyle?: string;
  textDecoration?: string; textAlign?: 'left' | 'center' | 'right';
  fontFamily?: string; opacity?: number; visible?: boolean; locked?: boolean; label?: string;
  shapeType?: 'rect' | 'circle'; shapeFill?: string; shapeGradient?: string; borderRadius?: number;
  shadowX?: number; shadowY?: number; shadowBlur?: number; shadowColor?: string;
  strokeColor?: string; strokeWidth?: number; letterSpacing?: number; lineHeight?: number;
}

const CANVAS_PRESETS = [
  { label: 'Квадрат 1:1', w: 1080, h: 1080 },
  { label: 'Сторис 9:16', w: 1080, h: 1920 },
  { label: 'Пост 4:5', w: 1080, h: 1350 },
  { label: 'Баннер 16:9', w: 1920, h: 1080 },
  { label: 'Wide 2:1', w: 1200, h: 600 },
  { label: 'A4 портрет', w: 2480, h: 3508 },
];

const FONTS = [
  'Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman',
  'Courier New', 'Impact', 'Trebuchet MS', 'Verdana',
  'Roboto', 'Open Sans', 'Montserrat', 'Playfair Display',
];

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
function fmtTime(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('ru', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

export default function ContentStudio({ product }: { product: any }) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const inlineEditRef = useRef<HTMLTextAreaElement>(null);

  const [canvasW, setCanvasW] = useState(1080);
  const [canvasH, setCanvasH] = useState(1080);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState('#1a1a2e');
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.42);
  const [panel, setPanel] = useState<PanelTab>('ai');
  const [rightPanel, setRightPanel] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const gridSize = 20;

  // Pan state
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  // Inline text editing
  const [editingId, setEditingId] = useState<string | null>(null);

  // AI state
  const [bgPrompt, setBgPrompt] = useState('professional studio photography, soft cinematic lighting, clean gradient background, product showcase');
  const [elementPrompt, setElementPrompt] = useState('');
  const [bgModel, setBgModel] = useState('5c232a9e-9061-4777-980a-ddc8e65647c6');
  const [generatingBg, setGeneratingBg] = useState(false);
  const [generatingEl, setGeneratingEl] = useState(false);
  const [removingBg, setRemovingBg] = useState<string | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);

  // Project state
  const [projects, setProjects] = useState<any[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Новый проект');
  const [saving, setSaving] = useState(false);
  const [exportingMedia, setExportingMedia] = useState(false);

  // History
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

  useEffect(() => {
    if (!product?.id) return;
    api.get(`/products/${product.id}/studio-projects`)
      .then(r => setProjects(r.data.projects || []))
      .catch(() => {});
  }, [product?.id]);

  const updateLayer = useCallback((id: string, upd: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...upd } : l));
  }, []);

  const removeLayer = useCallback((id: string) => {
    setLayers(prev => { const next = prev.filter(l => l.id !== id); pushHistory(next); return next; });
    setSelectedId(prev => prev === id ? null : prev);
  }, [pushHistory]);

  const addLayer = useCallback((layer: Layer) => {
    setLayers(prev => { const next = [...prev, layer]; pushHistory(next); return next; });
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
    const l = layers.find(l => l.id === id); if (!l) return;
    addLayer({ ...l, id: uid(), x: l.x + 24, y: l.y + 24, label: (l.label ?? 'Слой') + ' (копия)' });
  };

  const addImageLayer = (src: string, label = 'Изображение') => addLayer({
    id: uid(), type: 'image', src, label,
    x: Math.round(canvasW * 0.2), y: Math.round(canvasH * 0.2),
    width: Math.round(canvasW * 0.4), height: Math.round(canvasH * 0.4),
    opacity: 1, visible: true,
  });

  const addTextLayer = (text = 'ТЕКСТ', opts: Partial<Layer> = {}) => addLayer({
    id: uid(), type: 'text', text, label: text.slice(0, 24),
    x: 60, y: 60, width: Math.round(canvasW * 0.8), height: 'auto',
    fontSize: 80, color: '#ffffff', fontWeight: 'bold',
    textAlign: 'center', fontFamily: 'Inter', opacity: 1, visible: true,
    lineHeight: 1.2, letterSpacing: 0, ...opts,
  });

  const addShapeLayer = (shapeType: 'rect' | 'circle' = 'rect') => addLayer({
    id: uid(), type: 'shape', shapeType, label: shapeType === 'rect' ? 'Прямоугольник' : 'Круг',
    x: 200, y: 200, width: 400, height: 240,
    shapeFill: '#6366f1', borderRadius: shapeType === 'circle' ? 999 : 16,
    opacity: 0.85, visible: true,
  });

  const alignLayer = (id: string, dir: 'cx' | 'cy' | 'left' | 'right' | 'top' | 'bottom') => {
    const l = layers.find(x => x.id === id); if (!l) return;
    const w = l.width as number;
    const h = l.height === 'auto' ? 0 : l.height as number;
    const updates: Partial<Layer> = {};
    if (dir === 'cx') updates.x = Math.round((canvasW - w) / 2);
    if (dir === 'cy') updates.y = Math.round((canvasH - h) / 2);
    if (dir === 'left') updates.x = 0;
    if (dir === 'right') updates.x = canvasW - w;
    if (dir === 'top') updates.y = 0;
    if (dir === 'bottom') updates.y = canvasH - h;
    updateLayer(id, updates);
  };

  // ── Zoom with Ctrl+wheel ──────────────────────────────────────────────
  useEffect(() => {
    const el = canvasAreaRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        setZoom(z => Math.min(3, Math.max(0.1, +(z + delta).toFixed(2))));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Pan with Space+drag ───────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); setSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { setSpaceDown(false); setIsPanning(false); panStart.current = null; }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (spaceDown || e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    }
  };
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning && panStart.current) {
      setPanX(panStart.current.px + e.clientX - panStart.current.x);
      setPanY(panStart.current.py + e.clientY - panStart.current.y);
    }
  };
  const onCanvasMouseUp = () => { if (isPanning) { setIsPanning(false); panStart.current = null; } };

  // ── AI ────────────────────────────────────────────────────────────────
  const generateBackground = async () => {
    setGeneratingBg(true);
    try {
      const fd = new FormData();
      fd.append('prompt', bgPrompt); fd.append('model_id', bgModel);
      if (product?.id) fd.append('product_id', String(product.id));
      const res = await api.post('/visual/generate-background', fd, { responseType: 'blob', headers: { 'Content-Type': 'multipart/form-data' } });
      setBgImage(await blobToBase64(res.data as Blob));
      toast('Фон сгенерирован', 'success');
    } catch (e: any) {
      const msg = e?.response?.data ? await (e.response.data as Blob).text?.() : e?.message;
      toast('Ошибка: ' + (msg ?? 'GPU сервис недоступен'), 'error');
    } finally { setGeneratingBg(false); }
  };

  const generateElement = async () => {
    if (!elementPrompt.trim()) return;
    setGeneratingEl(true);
    try {
      const fd = new FormData();
      fd.append('prompt', elementPrompt); fd.append('is_icon', 'false'); fd.append('model_id', 'gemini-2.5-flash-image');
      const res = await api.post('/visual/generate-element', fd, { responseType: 'blob', headers: { 'Content-Type': 'multipart/form-data' } });
      addImageLayer(await blobToBase64(res.data as Blob), elementPrompt.slice(0, 30));
      setElementPrompt('');
      toast('Элемент добавлен', 'success');
    } catch (e: any) { toast('Ошибка: ' + (e?.message ?? ''), 'error'); }
    finally { setGeneratingEl(false); }
  };

  const removeBackground = async (layerId: string, src: string) => {
    setRemovingBg(layerId);
    try {
      const blob = await (await fetch(src)).blob();
      const fd = new FormData(); fd.append('file', blob, 'image.png');
      const res = await api.post('/visual/remove-background', fd, { responseType: 'blob', headers: { 'Content-Type': 'multipart/form-data' } });
      updateLayer(layerId, { src: await blobToBase64(res.data as Blob) });
      toast('Фон удалён', 'success');
    } catch { toast('Ошибка удаления фона', 'error'); }
    finally { setRemovingBg(null); }
  };

  const generateInfographicPlan = async () => {
    setGeneratingPlan(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/ai/generate-promo', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ product_id: product?.id, text: '' }),
      });
      const d = (await res.json()).promo_copy;
      if (d?.promo_title) addTextLayer(d.promo_title, { fontSize: 72, y: 60 });
      (d?.features ?? []).slice(0, 4).forEach((f: any, i: number) =>
        addTextLayer(`• ${f.title}`, { fontSize: 36, color: 'rgba(255,255,255,0.85)', y: 200 + i * 80, fontWeight: 'normal' })
      );
      toast('AI-план создан', 'success');
    } catch { toast('Ошибка генерации плана', 'error'); }
    finally { setGeneratingPlan(false); }
  };

  // ── Upload ────────────────────────────────────────────────────────────
  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    addImageLayer(await blobToBase64(file), file.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
  };
  const handleUploadBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBgImage(await blobToBase64(file)); e.target.value = '';
  };
  const addProductImages = () => {
    const imgs: any[] = product?.images ?? product?.media ?? [];
    if (!imgs.length) { toast('У товара нет изображений', 'error'); return; }
    imgs.slice(0, 4).forEach((img: any, i: number) => {
      const url = typeof img === 'string' ? img : (img.url ?? img.src ?? '');
      if (url) setTimeout(() => addImageLayer(url, `Фото товара ${i + 1}`), i * 60);
    });
  };

  // ── Export (pixel-perfect: zoom=1 during capture) ─────────────────────
  const withZoom1 = async (fn: () => Promise<void>) => {
    const pz = zoom, ppx = panX, ppy = panY;
    setZoom(1); setPanX(0); setPanY(0);
    await new Promise(r => setTimeout(r, 120));
    await fn();
    setZoom(pz); setPanX(ppx); setPanY(ppy);
  };

  const exportCanvas = async (format: 'png' | 'jpg' = 'png') => {
    if (!canvasRef.current) return;
    try {
      await withZoom1(async () => {
        const canvas = await html2canvas(canvasRef.current!, { width: canvasW, height: canvasH, scale: 2, useCORS: true, allowTaint: true, logging: false });
        const link = document.createElement('a');
        link.download = `studio_${product?.sku ?? 'export'}_${Date.now()}.${format}`;
        link.href = canvas.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
        link.click();
      });
      toast(`${format.toUpperCase()} экспортирован`, 'success');
    } catch { toast('Ошибка экспорта', 'error'); }
  };

  const exportToMedia = async () => {
    if (!canvasRef.current || !product?.id) return;
    setExportingMedia(true);
    try {
      await withZoom1(async () => {
        const canvas = await html2canvas(canvasRef.current!, { width: canvasW, height: canvasH, scale: 1, useCORS: true, allowTaint: true, logging: false });
        await api.post(`/products/${product.id}/studio-export-to-media`, { image: canvas.toDataURL('image/jpeg', 0.9) });
      });
      toast('Сохранено в медиатеку товара', 'success');
    } catch { toast('Ошибка сохранения в медиатеку', 'error'); }
    finally { setExportingMedia(false); }
  };

  // ── Project save/load ─────────────────────────────────────────────────
  const saveProject = async () => {
    if (!product?.id) return;
    setSaving(true);
    try {
      let thumbnail: string | undefined;
      if (canvasRef.current) {
        try {
          await withZoom1(async () => {
            const c = await html2canvas(canvasRef.current!, { width: canvasW, height: canvasH, scale: 0.15, useCORS: true, allowTaint: true, logging: false });
            thumbnail = c.toDataURL('image/jpeg', 0.7);
          });
        } catch {}
      }
      const res = await api.post(`/products/${product.id}/studio-projects`, {
        id: currentProjectId ?? undefined, name: projectName,
        layers, bgImage, bgColor, canvasW, canvasH, thumbnail,
      });
      setCurrentProjectId(res.data.id);
      setProjects((await api.get(`/products/${product.id}/studio-projects`)).data.projects || []);
      toast('Проект сохранён', 'success');
    } catch { toast('Ошибка сохранения', 'error'); }
    finally { setSaving(false); }
  };

  const loadProject = (p: any) => {
    setLayers(p.layers || []); setBgImage(p.bgImage || null); setBgColor(p.bgColor || '#1a1a2e');
    setCanvasW(p.canvasW || 1080); setCanvasH(p.canvasH || 1080);
    setCurrentProjectId(p.id); setProjectName(p.name || 'Проект'); setSelectedId(null);
    historyRef.current = [p.layers || []]; historyIdx.current = 0;
    toast(`Загружен: ${p.name}`, 'success');
  };

  const deleteProject = async (id: string) => {
    if (!product?.id) return;
    try {
      await api.delete(`/products/${product.id}/studio-projects/${id}`);
      setProjects(prev => prev.filter(p => p.id !== id));
      if (currentProjectId === id) setCurrentProjectId(null);
      toast('Проект удалён', 'success');
    } catch { toast('Ошибка', 'error'); }
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveProject(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') { e.preventDefault(); if (selectedId) duplicateLayer(selectedId); }
      if (e.key === 'Escape' && editingId) setEditingId(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) removeLayer(selectedId);
      }
      if (selectedId && !editingId && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const l = layers.find(x => x.id === selectedId);
          if (l) {
            if (e.key === 'ArrowUp') updateLayer(selectedId, { y: l.y - step });
            if (e.key === 'ArrowDown') updateLayer(selectedId, { y: l.y + step });
            if (e.key === 'ArrowLeft') updateLayer(selectedId, { x: l.x - step });
            if (e.key === 'ArrowRight') updateLayer(selectedId, { x: l.x + step });
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, removeLayer, layers, editingId]);

  // ─── Styles ─────────────────────────────────────────────────────────────
  const c = {
    root: { display: 'flex', flexDirection: 'column' as const, height: 'calc(100vh - 180px)', background: '#0c0c18', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' },
    menubar: { height: 46, display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#0f0f1e', flexShrink: 0 },
    workspace: { flex: 1, display: 'flex', overflow: 'hidden' },
    sidebar: { width: 268, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column' as const, background: '#0d0d1a' },
    tabs: { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' },
    tab: (a: boolean): React.CSSProperties => ({ flex: 1, padding: '9px 2px', fontSize: 10, fontWeight: 700, textAlign: 'center' as const, cursor: 'pointer', letterSpacing: '0.05em', color: a ? '#a5b4fc' : 'rgba(255,255,255,0.28)', background: 'none', border: 'none', borderBottom: `2px solid ${a ? '#6366f1' : 'transparent'}`, transition: 'color 0.2s', textTransform: 'uppercase' as const }),
    scroll: { flex: 1, overflowY: 'auto' as const, padding: 10, display: 'flex', flexDirection: 'column' as const, gap: 8 },
    sec: { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: 10 } as React.CSSProperties,
    secTitle: { fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8, display: 'block' },
    label: { fontSize: 10, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 3 } as React.CSSProperties,
    input: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '7px 9px', color: 'rgba(255,255,255,0.85)', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
    numInput: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '5px 7px', color: 'rgba(255,255,255,0.85)', fontSize: 11, outline: 'none', width: '100%', fontFamily: 'inherit' },
    textarea: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '7px 9px', color: 'rgba(255,255,255,0.85)', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', resize: 'none' as const, minHeight: 64 },
    btn: (v: 'primary' | 'ghost' | 'danger' | 'success' | 'ozon' = 'ghost'): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent', transition: 'all 0.15s',
      ...(v === 'primary' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', borderColor: 'rgba(99,102,241,0.4)' }
        : v === 'success' ? { background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff' }
        : v === 'ozon' ? { background: 'linear-gradient(135deg,#005bff,#0041cc)', color: '#fff' }
        : v === 'danger' ? { background: 'rgba(239,68,68,0.12)', color: '#f87171', borderColor: 'rgba(239,68,68,0.2)' }
        : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.09)' }),
    }),
    iconBtn: (active = false, danger = false): React.CSSProperties => ({ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', border: 'none', flexShrink: 0, background: danger ? 'rgba(239,68,68,0.12)' : active ? 'rgba(99,102,241,0.28)' : 'rgba(255,255,255,0.06)', color: danger ? '#f87171' : active ? '#a5b4fc' : 'rgba(255,255,255,0.55)', transition: 'all 0.12s' }),
    canvasArea: { flex: 1, overflow: 'hidden', position: 'relative' as const, background: 'radial-gradient(ellipse at 50% 50%, #141428 0%, #0a0a14 100%)' },
    rightPanel: { width: 232, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.07)', background: '#0d0d1a', overflowY: 'auto' as const },
    statusbar: { height: 26, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#0a0a14', fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0 },
    divider: { height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 0' } as React.CSSProperties,
    row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 } as React.CSSProperties,
    row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 } as React.CSSProperties,
    row4: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 3 } as React.CSSProperties,
  };

  // ─── Layer rendering ─────────────────────────────────────────────────────
  const getLayerStyle = (layer: Layer): React.CSSProperties => {
    const shadow = (layer.shadowBlur || layer.shadowX || layer.shadowY)
      ? `${layer.shadowX ?? 0}px ${layer.shadowY ?? 4}px ${layer.shadowBlur ?? 8}px ${layer.shadowColor ?? 'rgba(0,0,0,0.5)'}`
      : undefined;
    return { opacity: layer.opacity ?? 1, filter: shadow ? `drop-shadow(${shadow})` : undefined };
  };

  const getTextStyle = (layer: Layer): React.CSSProperties => {
    const textShadow = (layer.shadowBlur || layer.shadowX || layer.shadowY)
      ? `${layer.shadowX ?? 0}px ${layer.shadowY ?? 4}px ${layer.shadowBlur ?? 8}px ${layer.shadowColor ?? 'rgba(0,0,0,0.5)'}`
      : undefined;
    return {
      width: '100%', height: '100%', fontSize: layer.fontSize, color: layer.color,
      fontWeight: layer.fontWeight as any, fontStyle: layer.fontStyle, textDecoration: layer.textDecoration,
      textAlign: layer.textAlign, fontFamily: layer.fontFamily,
      letterSpacing: layer.letterSpacing ? `${layer.letterSpacing}px` : undefined,
      lineHeight: layer.lineHeight ?? 1.2, userSelect: 'none' as const,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word' as const, textShadow,
      WebkitTextStroke: layer.strokeColor && layer.strokeWidth ? `${layer.strokeWidth}px ${layer.strokeColor}` : undefined,
    };
  };

  const renderLayer = (layer: Layer) => {
    if (layer.visible === false) return null;
    const isSel = layer.id === selectedId;
    const isEditing = layer.id === editingId;
    const rnd = {
      key: layer.id,
      position: { x: layer.x, y: layer.y },
      size: { width: layer.width as number, height: layer.height === 'auto' ? 'auto' : layer.height as number },
      onDragStop: (_: any, d: any) => {
        const nx = snapToGrid ? Math.round(d.x / gridSize) * gridSize : d.x;
        const ny = snapToGrid ? Math.round(d.y / gridSize) * gridSize : d.y;
        updateLayer(layer.id, { x: nx, y: ny });
      },
      onResizeStop: (_: any, __: any, ref: any, ___: any, pos: any) => updateLayer(layer.id, {
        width: parseInt(ref.style.width), height: parseInt(ref.style.height), ...pos,
      }),
      onClick: (e: any) => { e.stopPropagation(); setSelectedId(layer.id); setPanel('props'); },
      onDoubleClick: (e: any) => {
        e.stopPropagation();
        if (layer.type === 'text' && !layer.locked) {
          setEditingId(layer.id);
          setTimeout(() => inlineEditRef.current?.focus(), 30);
        }
      },
      style: { outline: isSel ? '2px solid #6366f1' : 'none', outlineOffset: 2, ...getLayerStyle(layer), cursor: layer.locked ? 'not-allowed' : (isEditing ? 'text' : 'move') },
      disableDragging: !!layer.locked || isEditing,
      enableResizing: !layer.locked && !isEditing,
      bounds: 'parent' as const,
      scale: zoom,
    };

    if (layer.type === 'image' && layer.src)
      return <Rnd {...rnd}><img src={layer.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none', userSelect: 'none' }} draggable={false} crossOrigin="anonymous" /></Rnd>;

    if (layer.type === 'text') {
      return (
        <Rnd {...rnd} enableResizing={!layer.locked && !isEditing ? { right: true, bottom: true, bottomRight: true } : false}>
          {isEditing ? (
            <textarea
              ref={inlineEditRef}
              value={layer.text ?? ''}
              onChange={e => updateLayer(layer.id, { text: e.target.value })}
              onBlur={() => setEditingId(null)}
              style={{
                ...getTextStyle(layer),
                background: 'rgba(99,102,241,0.08)',
                border: '1.5px solid #6366f1',
                borderRadius: 4, resize: 'none', outline: 'none',
                padding: 0, userSelect: 'text', cursor: 'text', overflow: 'hidden',
              }}
            />
          ) : (
            <div style={getTextStyle(layer)}>{layer.text}</div>
          )}
        </Rnd>
      );
    }

    if (layer.type === 'shape')
      return <Rnd {...rnd}><div style={{ width: '100%', height: '100%', background: layer.shapeGradient || layer.shapeFill, borderRadius: layer.borderRadius }} /></Rnd>;

    return null;
  };

  // ─── Properties panel ──────────────────────────────────────────────────
  const PropertiesPanel = () => {
    if (!selected) return (
      <div style={{ padding: 20, color: 'rgba(255,255,255,0.18)', fontSize: 11, textAlign: 'center', lineHeight: 1.6 }}>
        Кликните на слой<br />для редактирования
      </div>
    );
    return (
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={c.sec}>
          <span style={c.secTitle}>Позиция и размер</span>
          <div style={c.row2}>
            <div><label style={c.label}>X</label><input type="number" style={c.numInput} value={selected.x} onChange={e => updateLayer(selected.id, { x: parseInt(e.target.value) || 0 })} /></div>
            <div><label style={c.label}>Y</label><input type="number" style={c.numInput} value={selected.y} onChange={e => updateLayer(selected.id, { y: parseInt(e.target.value) || 0 })} /></div>
            <div><label style={c.label}>W</label><input type="number" style={c.numInput} value={selected.width as number} onChange={e => updateLayer(selected.id, { width: parseInt(e.target.value) || 100 })} /></div>
            <div><label style={c.label}>H</label><input type="number" style={c.numInput} value={selected.height === 'auto' ? 0 : selected.height as number} onChange={e => updateLayer(selected.id, { height: parseInt(e.target.value) || 100 })} /></div>
          </div>
        </div>
        <div style={c.sec}>
          <span style={c.secTitle}>Выравнивание</span>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' as const }}>
            {([['cx', <AlignHorizontalJustifyCenter size={11} />, 'По горизонтали'], ['cy', <AlignVerticalJustifyCenter size={11} />, 'По вертикали'], ['left', <AlignStartHorizontal size={11} />, 'К левому краю'], ['right', <AlignEndHorizontal size={11} />, 'К правому краю'], ['top', <AlignStartVertical size={11} />, 'К верхнему краю'], ['bottom', <AlignEndVertical size={11} />, 'К нижнему краю']] as const).map(([dir, icon, title]) => (
              <button key={dir as string} style={{ ...c.iconBtn(), width: 30, height: 28 }} title={title as string} onClick={() => alignLayer(selected.id, dir as any)}>{icon}</button>
            ))}
          </div>
        </div>
        <div style={c.sec}>
          <span style={c.secTitle}>Прозрачность {Math.round((selected.opacity ?? 1) * 100)}%</span>
          <input type="range" min={0} max={1} step={0.01} value={selected.opacity ?? 1} onChange={e => updateLayer(selected.id, { opacity: parseFloat(e.target.value) })} style={{ width: '100%', accentColor: '#6366f1' }} />
        </div>
        {selected.type === 'text' && (
          <>
            <div style={c.sec}>
              <span style={c.secTitle}>Текст <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', fontWeight: 400 }}>двойной клик на холсте</span></span>
              <textarea style={{ ...c.textarea, marginBottom: 6, minHeight: 52 }} value={selected.text ?? ''} onChange={e => updateLayer(selected.id, { text: e.target.value })} rows={2} />
              <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 6 }}>
                <input type="number" style={{ ...c.numInput, width: 56 }} value={selected.fontSize ?? 48} onChange={e => updateLayer(selected.id, { fontSize: parseInt(e.target.value) || 48 })} placeholder="px" />
                <input type="color" value={selected.color ?? '#ffffff'} onChange={e => updateLayer(selected.id, { color: e.target.value })} style={{ width: 32, height: 30, borderRadius: 6, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
                <button style={c.iconBtn(selected.fontWeight === 'bold')} onClick={() => updateLayer(selected.id, { fontWeight: selected.fontWeight === 'bold' ? 'normal' : 'bold' })}><Bold size={12} /></button>
                <button style={c.iconBtn(selected.fontStyle === 'italic')} onClick={() => updateLayer(selected.id, { fontStyle: selected.fontStyle === 'italic' ? 'normal' : 'italic' })}><Italic size={12} /></button>
                <button style={c.iconBtn(selected.textDecoration === 'underline')} onClick={() => updateLayer(selected.id, { textDecoration: selected.textDecoration === 'underline' ? 'none' : 'underline' })}><Underline size={12} /></button>
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {(['left', 'center', 'right'] as const).map(a => (
                  <button key={a} style={c.iconBtn(selected.textAlign === a)} onClick={() => updateLayer(selected.id, { textAlign: a })}>
                    {a === 'left' ? <AlignLeft size={12} /> : a === 'center' ? <AlignCenter size={12} /> : <AlignRight size={12} />}
                  </button>
                ))}
              </div>
              <select style={{ ...c.input, marginBottom: 6, fontSize: 11 }} value={selected.fontFamily ?? 'Inter'} onChange={e => updateLayer(selected.id, { fontFamily: e.target.value })}>
                {FONTS.map(f => <option key={f}>{f}</option>)}
              </select>
              <div style={c.row2}>
                <div><label style={c.label}>Межбуквенный</label><input type="number" style={c.numInput} value={selected.letterSpacing ?? 0} onChange={e => updateLayer(selected.id, { letterSpacing: parseFloat(e.target.value) })} /></div>
                <div><label style={c.label}>Межстрочный</label><input type="number" style={c.numInput} step={0.1} value={selected.lineHeight ?? 1.2} onChange={e => updateLayer(selected.id, { lineHeight: parseFloat(e.target.value) })} /></div>
              </div>
            </div>
            <div style={c.sec}>
              <span style={c.secTitle}>Обводка текста</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={selected.strokeColor ?? '#000000'} onChange={e => updateLayer(selected.id, { strokeColor: e.target.value })} style={{ width: 30, height: 28, borderRadius: 5, border: 'none', background: 'none', cursor: 'pointer' }} />
                <input type="number" style={{ ...c.numInput, width: 60 }} min={0} max={20} placeholder="px" value={selected.strokeWidth ?? 0} onChange={e => updateLayer(selected.id, { strokeWidth: parseInt(e.target.value) || 0 })} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>толщина</span>
              </div>
            </div>
          </>
        )}
        {selected.type === 'shape' && (
          <div style={c.sec}>
            <span style={c.secTitle}>Фигура</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <label style={c.label}>Цвет</label>
              <input type="color" value={(selected.shapeFill ?? '#6366f1').startsWith('#') ? selected.shapeFill ?? '#6366f1' : '#6366f1'} onChange={e => updateLayer(selected.id, { shapeFill: e.target.value, shapeGradient: undefined })} style={{ width: 30, height: 28, borderRadius: 5, border: 'none', background: 'none', cursor: 'pointer' }} />
            </div>
            <div style={{ marginBottom: 6 }}>
              <label style={c.label}>Градиент CSS</label>
              <input style={c.input} placeholder="linear-gradient(135deg,#6366f1,#ec4899)" value={selected.shapeGradient ?? ''} onChange={e => updateLayer(selected.id, { shapeGradient: e.target.value || undefined })} />
            </div>
            <div><label style={c.label}>Скругление</label><input type="number" style={c.numInput} min={0} max={999} value={selected.borderRadius ?? 0} onChange={e => updateLayer(selected.id, { borderRadius: parseInt(e.target.value) || 0 })} /></div>
          </div>
        )}
        <div style={c.sec}>
          <span style={c.secTitle}>Тень</span>
          <div style={c.row2}>
            <div><label style={c.label}>X</label><input type="number" style={c.numInput} value={selected.shadowX ?? 0} onChange={e => updateLayer(selected.id, { shadowX: parseInt(e.target.value) })} /></div>
            <div><label style={c.label}>Y</label><input type="number" style={c.numInput} value={selected.shadowY ?? 4} onChange={e => updateLayer(selected.id, { shadowY: parseInt(e.target.value) })} /></div>
            <div><label style={c.label}>Blur</label><input type="number" style={c.numInput} value={selected.shadowBlur ?? 8} min={0} onChange={e => updateLayer(selected.id, { shadowBlur: parseInt(e.target.value) })} /></div>
            <div><label style={c.label}>Цвет</label><input type="color" value={selected.shadowColor ?? '#000000'} onChange={e => updateLayer(selected.id, { shadowColor: e.target.value })} style={{ width: '100%', height: 28, borderRadius: 5, border: 'none', background: 'none', cursor: 'pointer' }} /></div>
          </div>
        </div>
        {selected.type === 'image' && selected.src && (
          <div style={c.sec}>
            <span style={c.secTitle}>Изображение</span>
            <button style={{ ...c.btn('ghost'), width: '100%' }} disabled={removingBg === selected.id} onClick={() => removeBackground(selected.id, selected.src!)}>
              {removingBg === selected.id ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Удаляю...</> : <><Eraser size={12} />Удалить фон AI</>}
            </button>
          </div>
        )}
        <div style={c.divider} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <button style={c.btn()} onClick={() => moveLayerUp(selected.id)}><ChevronUp size={12} />Вверх</button>
          <button style={c.btn()} onClick={() => moveLayerDown(selected.id)}><ChevronDown size={12} />Вниз</button>
          <button style={c.btn()} onClick={() => duplicateLayer(selected.id)}><Copy size={12} />Дубль</button>
          <button style={c.btn()} onClick={() => updateLayer(selected.id, { locked: !selected.locked })}>
            {selected.locked ? <><Unlock size={12} />Разблок</> : <><Lock size={12} />Блок</>}
          </button>
          <button style={c.btn()} onClick={() => updateLayer(selected.id, { visible: !(selected.visible !== false) })}>
            {selected.visible === false ? <Eye size={12} /> : <EyeOff size={12} />}
            {selected.visible === false ? 'Показать' : 'Скрыть'}
          </button>
        </div>
        <button style={{ ...c.btn('danger'), width: '100%' }} onClick={() => removeLayer(selected.id)}><Trash2 size={12} />Удалить слой</button>
      </div>
    );
  };

  // ─── JSX ─────────────────────────────────────────────────────────────────
  return (
    <div style={c.root}>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadImage} />
      <input ref={bgFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadBg} />

      {/* ── Menubar ── */}
      <div style={c.menubar}>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <button style={c.iconBtn()} title="Текст (T)" onClick={() => { addTextLayer(); setPanel('props'); }}><Type size={14} /></button>
          <button style={c.iconBtn()} title="Изображение" onClick={() => fileInputRef.current?.click()}><ImageIcon size={14} /></button>
          <button style={c.iconBtn()} title="Прямоугольник" onClick={() => addShapeLayer('rect')}><Square size={14} /></button>
          <button style={c.iconBtn()} title="Круг" onClick={() => addShapeLayer('circle')}><Circle size={14} /></button>
        </div>
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 5px' }} />
        <button style={c.iconBtn()} onClick={() => setZoom(z => Math.min(3, +(z + 0.1).toFixed(2)))}><ZoomIn size={14} /></button>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', minWidth: 38, textAlign: 'center', cursor: 'pointer' }} onClick={() => { setZoom(0.42); setPanX(0); setPanY(0); }} title="Сбросить zoom и pan">{Math.round(zoom * 100)}%</span>
        <button style={c.iconBtn()} onClick={() => setZoom(z => Math.max(0.1, +(z - 0.1).toFixed(2)))}><ZoomOut size={14} /></button>
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 5px' }} />
        <button style={c.iconBtn()} title="Отменить Ctrl+Z" onClick={undo}><Undo2 size={14} /></button>
        <button style={c.iconBtn()} title="Вернуть Ctrl+Y" onClick={redo}><Redo2 size={14} /></button>
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 5px' }} />
        <button style={c.iconBtn(showGrid)} title="Сетка" onClick={() => setShowGrid(g => !g)}><Maximize2 size={14} /></button>
        <button style={c.iconBtn(snapToGrid)} title="Привязка к сетке" onClick={() => setSnapToGrid(s => !s)}><AlignLeft size={14} /></button>
        <button style={c.iconBtn(spaceDown || isPanning)} title="Pan: Space + drag или средняя кнопка мыши"><Move size={14} /></button>
        <div style={{ flex: 1 }} />
        <input style={{ ...c.input, width: 160, height: 28, padding: '4px 8px', fontSize: 11 }} value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Название проекта" />
        <button style={{ ...c.btn('ghost'), fontSize: 11, marginLeft: 4 }} onClick={() => setRightPanel(p => !p)} title="Панель свойств"><PanelRight size={13} /></button>
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
        <button style={{ ...c.btn('ghost'), fontSize: 11 }} onClick={() => { setLayers([]); setBgImage(null); setBgColor('#1a1a2e'); setCurrentProjectId(null); }}><Trash2 size={13} />Очистить</button>
        <button style={{ ...c.btn('ghost'), fontSize: 11, opacity: saving ? 0.7 : 1 }} onClick={saveProject} disabled={saving}>
          {saving ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Сохранение</> : <><Save size={13} />Сохранить</>}
        </button>
        <button style={{ ...c.btn('ghost'), fontSize: 11, opacity: exportingMedia ? 0.7 : 1 }} onClick={exportToMedia} disabled={exportingMedia} title="Сохранить в медиатеку товара">
          {exportingMedia ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Сохранение</> : <><ImagePlus size={13} />В медиатеку</>}
        </button>
        <button style={{ ...c.btn('success'), fontSize: 11 }} onClick={() => exportCanvas('png')}><Download size={13} />PNG</button>
        <button style={{ ...c.btn('ghost'), fontSize: 11 }} onClick={() => exportCanvas('jpg')}><Download size={13} />JPG</button>
      </div>

      {/* ── Workspace ── */}
      <div style={c.workspace}>

        {/* ── Left sidebar ── */}
        <div style={c.sidebar}>
          <div style={c.tabs}>
            {([['ai', '✦ AI'], ['layers', 'Слои'], ['props', 'Свойства'], ['canvas', 'Холст']] as const).map(([key, label]) => (
              <button key={key} style={c.tab(panel === key)} onClick={() => setPanel(key)}>{label}</button>
            ))}
          </div>

          {panel === 'ai' && (
            <div style={c.scroll}>
              <div style={c.sec}>
                <span style={c.secTitle}>Генерация фона</span>
                <textarea style={{ ...c.textarea, marginBottom: 6 }} value={bgPrompt} onChange={e => setBgPrompt(e.target.value)} placeholder="Опишите фон..." />
                <select style={{ ...c.input, marginBottom: 6 }} value={bgModel} onChange={e => setBgModel(e.target.value)}>
                  {BG_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <div style={c.row2}>
                  <button style={c.btn()} onClick={() => bgFileInputRef.current?.click()}><Upload size={12} />Загрузить</button>
                  <button style={{ ...c.btn('primary'), opacity: generatingBg ? 0.7 : 1 }} onClick={generateBackground} disabled={generatingBg}>
                    {generatingBg ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Генерация...</> : <><Sparkles size={12} />Создать фон</>}
                  </button>
                </div>
                {bgImage && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                    <img src={bgImage} alt="bg" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }} onClick={() => addImageLayer(bgImage, 'Фон')} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button style={{ ...c.btn(), fontSize: 10, padding: '4px 8px' }} onClick={() => addImageLayer(bgImage, 'Фон')}><Plus size={10} />На холст как слой</button>
                      <button style={{ ...c.btn('danger'), fontSize: 10, padding: '4px 8px' }} onClick={() => setBgImage(null)}><X size={10} />Убрать фон</button>
                    </div>
                  </div>
                )}
              </div>

              <div style={c.sec}>
                <span style={c.secTitle}>Генерация элемента</span>
                <input style={{ ...c.input, marginBottom: 6 }} value={elementPrompt} onChange={e => setElementPrompt(e.target.value)} placeholder="Золотая звезда, стикер, иконка..." onKeyDown={e => e.key === 'Enter' && generateElement()} />
                <button style={{ ...c.btn('primary'), width: '100%', opacity: generatingEl ? 0.7 : 1 }} onClick={generateElement} disabled={generatingEl}>
                  {generatingEl ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Генерация...</> : <><Wand2 size={12} />Создать элемент (Gemini)</>}
                </button>
              </div>

              <div style={c.sec}>
                <span style={c.secTitle}>Фото товара</span>
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5, marginBottom: 6 }}>
                  {(product?.images ?? product?.media ?? []).slice(0, 8).map((img: any, i: number) => {
                    const url = typeof img === 'string' ? img : (img.url ?? img.src ?? '');
                    return url ? (
                      <div key={i} onClick={() => addImageLayer(url, `Фото ${i + 1}`)} title="Нажмите чтобы добавить на холст"
                        style={{ width: 46, height: 46, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
                        <img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} crossOrigin="anonymous" />
                      </div>
                    ) : null;
                  })}
                </div>
                <div style={c.row2}>
                  <button style={c.btn()} onClick={addProductImages}><ImageIcon size={12} />Все фото</button>
                  <button style={c.btn()} onClick={() => fileInputRef.current?.click()}><Upload size={12} />Загрузить</button>
                </div>
              </div>

              <div style={c.sec}>
                <span style={c.secTitle}>AI-план инфографики</span>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 8, lineHeight: 1.5 }}>Создаёт текстовые слои на основе атрибутов товара</p>
                <button style={{ ...c.btn('primary'), width: '100%', opacity: generatingPlan ? 0.7 : 1 }} onClick={generateInfographicPlan} disabled={generatingPlan}>
                  {generatingPlan ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />Генерация...</> : <><LayoutTemplate size={12} />Создать план</>}
                </button>
              </div>

              {projects.length > 0 && (
                <div style={c.sec}>
                  <span style={c.secTitle}>Сохранённые проекты</span>
                  {projects.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, padding: '6px 8px', background: currentProjectId === p.id ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)', borderRadius: 6, border: `1px solid ${currentProjectId === p.id ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.05)', borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ImageIcon size={14} color="rgba(255,255,255,0.2)" />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 1 }}>{p.canvasW}×{p.canvasH} · {fmtTime(p.updated_at)}</div>
                      </div>
                      <button style={{ ...c.iconBtn(), width: 22, height: 22 }} title="Загрузить" onClick={() => loadProject(p)}><FolderOpen size={10} /></button>
                      <button style={{ ...c.iconBtn(false, true), width: 22, height: 22 }} title="Удалить" onClick={() => deleteProject(p.id)}><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {panel === 'layers' && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 4 }}>
                <button style={c.iconBtn()} title="Текст" onClick={() => addTextLayer()}><Type size={13} /></button>
                <button style={c.iconBtn()} title="Изображение" onClick={() => fileInputRef.current?.click()}><ImageIcon size={13} /></button>
                <button style={c.iconBtn()} title="Прямоугольник" onClick={() => addShapeLayer('rect')}><Square size={13} /></button>
                <button style={c.iconBtn()} title="Круг" onClick={() => addShapeLayer('circle')}><Circle size={13} /></button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' as const }}>
                {layers.length === 0
                  ? <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.18)', fontSize: 11 }}>Нет слоёв</div>
                  : [...layers].reverse().map(layer => (
                    <div key={layer.id} onClick={() => { setSelectedId(layer.id); setPanel('props'); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', cursor: 'pointer', background: selectedId === layer.id ? 'rgba(99,102,241,0.1)' : 'transparent', borderLeft: `2px solid ${selectedId === layer.id ? '#6366f1' : 'transparent'}`, borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: layer.visible === false ? 0.35 : 1 }}>
                      <span style={{ fontSize: 12 }}>{layer.type === 'text' ? '𝐓' : layer.type === 'image' ? '🖼' : '◻'}</span>
                      {layer.locked && <Lock size={9} color="rgba(255,255,255,0.3)" />}
                      <span style={{ flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.label ?? layer.text?.slice(0, 22) ?? 'Слой'}</span>
                      <button style={{ ...c.iconBtn(), width: 20, height: 20 }} onClick={e => { e.stopPropagation(); updateLayer(layer.id, { visible: !(layer.visible !== false) }); }}>
                        {layer.visible === false ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                      <button style={{ ...c.iconBtn(), width: 20, height: 20 }} onClick={e => { e.stopPropagation(); removeLayer(layer.id); }}><X size={10} /></button>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {panel === 'props' && <div style={{ flex: 1, overflowY: 'auto' as const }}><PropertiesPanel /></div>}

          {panel === 'canvas' && (
            <div style={c.scroll}>
              <div style={c.sec}>
                <span style={c.secTitle}>Размер холста</span>
                {CANVAS_PRESETS.map(p => (
                  <button key={p.label} style={{ ...c.btn(canvasW === p.w && canvasH === p.h ? 'primary' : 'ghost'), width: '100%', justifyContent: 'space-between', marginBottom: 4 }} onClick={() => { setCanvasW(p.w); setCanvasH(p.h); }}>
                    <span>{p.label}</span><span style={{ opacity: 0.5, fontSize: 10 }}>{p.w}×{p.h}</span>
                  </button>
                ))}
                <div style={c.row2}>
                  <div><label style={c.label}>Ширина</label><input type="number" style={c.numInput} value={canvasW} onChange={e => setCanvasW(parseInt(e.target.value) || 1080)} /></div>
                  <div><label style={c.label}>Высота</label><input type="number" style={c.numInput} value={canvasH} onChange={e => setCanvasH(parseInt(e.target.value) || 1080)} /></div>
                </div>
              </div>
              <div style={c.sec}>
                <span style={c.secTitle}>Фон холста</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} style={{ width: 36, height: 34, borderRadius: 6, border: 'none', cursor: 'pointer' }} />
                  <input style={{ ...c.input, flex: 1, fontSize: 11 }} value={bgColor} onChange={e => setBgColor(e.target.value)} placeholder="#1a1a2e" />
                </div>
                <div style={c.row2}>
                  <button style={c.btn()} onClick={() => bgFileInputRef.current?.click()}><Upload size={12} />Загрузить фото</button>
                  <button style={c.btn('danger')} onClick={() => setBgImage(null)}><X size={12} />Убрать фото</button>
                </div>
              </div>
              <div style={c.sec}>
                <span style={c.secTitle}>Сетка</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Показать сетку
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} /> Привязка
                  </label>
                </div>
              </div>
              <div style={c.sec}>
                <span style={c.secTitle}>Быстрые шаблоны</span>
                {[
                  { name: '🏷 Карточка товара', fn: () => { setLayers([]); addTextLayer(product?.name ?? 'Название товара', { fontSize: 64, y: 60 }); addTextLayer(product?.sku ? `Арт. ${product.sku}` : 'SKU', { fontSize: 28, y: 180, color: 'rgba(255,255,255,0.5)', fontWeight: 'normal' }); } },
                  { name: '🔥 Промо-баннер', fn: () => { setLayers([]); addTextLayer('СКИДКА 50%', { fontSize: 128, y: 80, color: '#f59e0b' }); addTextLayer(product?.name ?? 'Товар', { fontSize: 52, y: 260 }); addTextLayer('Только сегодня', { fontSize: 36, y: 360, color: 'rgba(255,255,255,0.6)', fontWeight: 'normal' }); } },
                  { name: '📋 Характеристики', fn: () => { setLayers([]); addTextLayer(product?.name ?? 'Товар', { fontSize: 60, y: 40 }); addTextLayer('• Характеристика 1\n• Характеристика 2\n• Характеристика 3', { fontSize: 32, y: 160, color: 'rgba(255,255,255,0.75)', fontWeight: 'normal', textAlign: 'left' }); } },
                  { name: '⭐ Отзыв', fn: () => { setLayers([]); addTextLayer('★★★★★', { fontSize: 80, y: 100, color: '#f59e0b' }); addTextLayer('"Отличный товар!"', { fontSize: 52, y: 220, fontStyle: 'italic' }); addTextLayer('— Покупатель', { fontSize: 32, y: 330, color: 'rgba(255,255,255,0.5)', fontWeight: 'normal' }); } },
                ].map(t => <button key={t.name} style={{ ...c.btn(), width: '100%', justifyContent: 'flex-start', marginBottom: 4 }} onClick={t.fn}>{t.name}</button>)}
              </div>
            </div>
          )}
        </div>

        {/* ── Canvas Area ── */}
        <div
          ref={canvasAreaRef}
          style={{ ...c.canvasArea, cursor: spaceDown ? (isPanning ? 'grabbing' : 'grab') : 'default', userSelect: 'none' }}
          onClick={() => { if (!isPanning) { setSelectedId(null); setEditingId(null); } }}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
        >
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${zoom})`,
            transformOrigin: 'center center',
            width: canvasW, height: canvasH, flexShrink: 0,
            boxShadow: '0 8px 80px rgba(0,0,0,0.9)',
          }}>
            <div ref={canvasRef} style={{ width: canvasW, height: canvasH, position: 'relative', overflow: 'hidden', background: bgImage ? `url(${bgImage}) center/cover no-repeat` : bgColor }}>
              {showGrid && (
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: `linear-gradient(rgba(99,102,241,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.1) 1px, transparent 1px)`, backgroundSize: `${gridSize}px ${gridSize}px`, zIndex: 0 }} />
              )}
              {layers.map(renderLayer)}
            </div>
          </div>
        </div>

        {/* ── Right Properties Panel ── */}
        {rightPanel && (
          <div style={c.rightPanel}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
              {selected ? `${selected.type === 'text' ? 'Текст' : selected.type === 'image' ? 'Изображение' : 'Фигура'}` : 'Свойства слоя'}
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
        {selected && <><span>•</span><span style={{ color: 'rgba(255,255,255,0.4)' }}>{selected.label ?? selected.type}</span><span style={{ opacity: 0.5 }}> x:{selected.x} y:{selected.y}</span></>}
        {editingId && <><span>•</span><span style={{ color: '#6366f1' }}>Редактирование · Esc завершить</span></>}
        <span style={{ flex: 1 }} />
        <span>Ctrl+колесо zoom · Space+drag pan · 2×клик текст · Del · Ctrl+Z/S</span>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
