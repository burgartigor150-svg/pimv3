import React, { useState, useRef } from 'react';
import { Rnd } from 'react-rnd';
import html2canvas from 'html2canvas';
import { Sparkles, Download, Type, Image as ImageIcon, Layers, Plus } from 'lucide-react';
import { api } from '../lib/api';

export default function PromoStudio({ product, setProduct }: any) {
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [layers, setLayers] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState('hyper-realistic studio room with elegant props');
  const [elementPrompt, setElementPrompt] = useState('');
  const [isGeneratingElement, setIsGeneratingElement] = useState(false);
  const [availableFonts, setAvailableFonts] = useState(['Inter', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Impact', 'Comic Sans MS', 'Trebuchet MS', 'Playfair Display', 'Roboto', 'Montserrat']);
  
  const boardRef = useRef<HTMLDivElement>(null);
  
  const narrowViewport = () => typeof window !== 'undefined' && window.innerWidth < 640;

  // Add a product cutout or AI element to the canvas
  const addProductLayer = (url: string, label: string = 'Картинка товара') => {
    const narrow = narrowViewport();
    const size = narrow ? 200 : 300;
    const x = narrow ? 80 : window.innerWidth > 1000 ? 300 : 100;
    setLayers(prev => [...prev, {
      id: 'prod_' + Date.now(),
      type: 'image',
      src: url,
      text: label, // Used for layer manager identification
      x, y: narrow ? 240 : 300,
      width: size, height: size
    }]);
  };
  
  // Add a text layer
  const addTextLayer = (presets: any = {}) => {
    const narrow = narrowViewport();
    const defaultWidth = narrow ? 320 : 400;
    const defaultFont = narrow ? 36 : 48;
    setLayers(prev => [...prev, {
      id: 'txt_' + Date.now(),
      type: 'text',
      text: presets.text || 'НОВЫЙ ТЕКСТ',
      x: presets.x ?? (narrow ? 40 : 50), 
      y: presets.y ?? (narrow ? 40 : 50),
      width: presets.width ?? defaultWidth, 
      height: presets.height || 'auto',
      fontSize: presets.fontSize ?? defaultFont,
      color: presets.color || '#ffffff',
      fontWeight: presets.fontWeight || 'bold',
      textAlign: presets.textAlign || 'center',
      fontFamily: presets.fontFamily || 'Inter'
    }]);
  };

  const handleCustomFontUpload = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const fontName = file.name.split('.')[0].replace(/[^a-zA-Z0-9]/g, '_');
    
    const newStyle = document.createElement('style');
    newStyle.appendChild(document.createTextNode(`
      @font-face {
        font-family: '${fontName}';
        src: url('${url}');
      }
    `));
    document.head.appendChild(newStyle);
    
    setAvailableFonts(prev => [...prev, fontName]);
  };

  const updateLayer = (id: string, updates: any) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  };
  
  const removeLayer = (id: string) => {
    setLayers(prev => prev.filter(l => l.id !== id));
  };

  const moveLayerUp = (index: number) => {
    if (index === layers.length - 1) return;
    const newLayers = [...layers];
    [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];
    setLayers(newLayers);
  };
  
  const moveLayerDown = (index: number) => {
    if (index === 0) return;
    const newLayers = [...layers];
    [newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]];
    setLayers(newLayers);
  };

  // Connect to the V2 API explicitly for pure background
  const handleGenerateBackground = async () => {
    setIsGenerating(true);
    try {
      const token = localStorage.getItem('token');
      const fd = new FormData();
      fd.append('prompt', prompt);
      fd.append('model_id', 'gemini-2.5-flash-image');
      if (product?.id) fd.append('product_id', String(product.id));
      
      const res = await fetch('/api/v1/visual/generate-background', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) throw new Error(await res.text());
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setBgImage(url);
    } catch (e: any) {
      alert("Ошибка генерации: " + e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // AI Texts (DeepSeek)
  const generateAITexts = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/v1/ai/generate-promo', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
           body: JSON.stringify({ product_id: product.id, text: '' })
        });
        const json = await res.json();
        const data = json.promo_copy;
        
        // Auto-add layers for generated texts!
        addTextLayer({ text: data.promo_title, fontSize: 64, color: '#ffffff', textAlign: 'center', x: 50, y: 50, width: 900 });
        data.features?.forEach((f: any, idx: number) => {
            addTextLayer({ text: `• ${f.title}\n  ${f.description}`, fontSize: 24, color: '#f0f0f0', textAlign: 'left', x: 50, y: 150 + (idx * 100), width: 800 });
        });
      } catch (err: any) { alert("Ошибка генерации текста: " + err.message); }
  };

  const handleGenerateElement = async (isIcon: boolean) => {
    if (!elementPrompt) return alert("Опишите объект");
    setIsGeneratingElement(true);
    try {
      const token = localStorage.getItem('token');
      const fd = new FormData();
      fd.append('prompt', elementPrompt);
      fd.append('is_icon', isIcon ? 'true' : 'false');
      fd.append('model_id', 'gemini-2.5-flash-image');
      
      const res = await fetch('/api/v1/visual/generate-element', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      
      const uploadFd = new FormData();
      uploadFd.append('file', blob, `element_${Date.now()}.png`);
      const uploadRes = await fetch('/api/v1/upload', {
         method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: uploadFd
      });
      const json = await uploadRes.json();
      
      const newImages = [...(product.images || []), json.url];
      await api.patch(`/products/${product.id}`, { images: newImages });
      setProduct({ ...product, images: newImages });
      
      addProductLayer(json.url, isIcon ? `Иконка: ${elementPrompt}` : `Объект: ${elementPrompt}`);
      setElementPrompt('');
    } catch(e: any) { alert("Ошибка генерации объекта: " + e.message); }
    finally { setIsGeneratingElement(false); }
  };

  const exportCanvas = async () => {
    if (!boardRef.current) return;
    setIsGenerating(true);
    try {
        // Increased scale to 3 for 3000x3000 ultra-high resolution export
        const canvas = await html2canvas(boardRef.current, { useCORS: true, scale: 3, logging: false, backgroundColor: '#ffffff' });
        canvas.toBlob(async (blob) => {
           if (!blob) return;
           const token = localStorage.getItem('token');
           const fd = new FormData();
           fd.append('file', blob, `studio_${Date.now()}.jpg`);
           const res = await fetch('/api/v1/upload', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` },
              body: fd
           });
           const json = await res.json();
           const updatedImages = [...(product.images || []), json.url];
           await api.patch(`/products/${product.id}`, { images: updatedImages });
           setProduct({ ...product, images: updatedImages });
           alert("Стильная инфографика успешно сохранена в базу данных галереи товара!");
           setIsGenerating(false);
        }, 'image/jpeg', 0.95);
    } catch(e: any) { 
        alert("Ошибка рендеринга: " + e.message); 
        setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      
      {/* Left Toolbox */}
      <div className="w-full lg:w-1/3 flex flex-col gap-6">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-lg border border-indigo-100 dark:border-slate-700">
           <h3 className="font-bold text-lg mb-3 flex items-center gap-2"><Sparkles className="w-5 h-5 text-indigo-500"/> 1. Генерация Сцены (Фон)</h3>
           <textarea 
             className="w-full border rounded-lg p-3 text-sm h-24 dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500"
             value={prompt} 
             onChange={e => setPrompt(e.target.value)} 
             placeholder="Нейросеть Nano Banana отрисует окружение без товара..."
           />
           <button onClick={handleGenerateBackground} disabled={isGenerating} className="mt-3 w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg font-bold flex justify-center items-center gap-2 shadow-lg transition-all disabled:opacity-50">
              {isGenerating ? 'Рендеринг Nano Banana...' : 'Сгенерировать Фон (V2)'}
           </button>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-lg border border-fuchsia-100 dark:border-slate-700">
           <h3 className="font-bold text-lg mb-3 flex items-center gap-2"><ImageIcon className="w-5 h-5 text-fuchsia-500"/> 2. Интеграция Товара</h3>
           <p className="text-xs text-gray-500 mb-3">Нажмите на изображение (вырезанное заранее) из галереи товара, чтобы разместить его поверх фона.</p>
           <div className="flex gap-2 overflow-x-auto pb-2">
             {product.images?.map((img: string, i: number) => (
                <div key={i} className="relative group flex-none cursor-pointer hover:ring-2 hover:ring-fuchsia-500 rounded" onClick={() => addProductLayer(img)}>
                   <img src={img} className="h-20 w-20 object-contain bg-slate-100 rounded" />
                   <div className="absolute inset-0 bg-black/60 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 rounded transition-opacity"><Plus className="w-6 h-6"/><span className="text-[10px] font-bold">На Холст</span></div>
                </div>
             ))}
             {(!product.images || product.images.length === 0) && <p className="text-xs text-gray-400 italic">У товара нет фотографий. Пожалуйста, загрузите их в Редакторе Базы.</p>}
           </div>
           <div className="mt-2 bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-700 dark:text-fuchsia-300 p-2 rounded text-xs leading-relaxed">
              <b>Совет:</b> Если фон еще не удален, вернитесь в раздел «Редактор Базы» и нажмите иконку ✂️ на фото инструмента <b>isnet-general-use</b>.
           </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-lg border border-green-100 dark:border-slate-700">
           <h3 className="font-bold text-lg mb-3 flex items-center gap-2"><Type className="w-5 h-5 text-green-500"/> 3. Тексты и Инфографика</h3>
           <div className="flex flex-col sm:flex-row gap-2 mb-3">
             <button onClick={() => addTextLayer()} className="flex-1 bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 py-2 rounded-lg text-sm font-medium flex justify-center items-center gap-1 transition-colors"><Plus className="w-4 h-4"/> Блок</button>
             <button onClick={generateAITexts} className="flex-1 bg-gradient-to-r from-blue-600 to-teal-500 text-white py-2 rounded-lg text-sm font-bold shadow hover:shadow-lg flex justify-center items-center gap-1 transition-all hover:scale-105"><Sparkles className="w-4 h-4"/> ИИ Генерация</button>
           </div>
           
           <label className="mb-3 flex items-center justify-center w-full px-4 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg cursor-pointer text-xs font-bold transition-colors">
              <span className="flex items-center gap-1"><Plus className="w-4 h-4"/> Подгрузить Свой Шрифт (.ttf, .otf)</span>
              <input type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={handleCustomFontUpload} />
           </label>
           
           <div className="max-h-64 overflow-y-auto pr-2 flex flex-col gap-3">
             {layers.filter(l => l.type === 'text').map(layer => (
                <div key={layer.id} className="border dark:border-slate-600 p-3 rounded-lg relative group hover:border-green-400 bg-slate-50 dark:bg-slate-900">
                   <textarea 
                     className="w-full text-sm bg-transparent cursor-text focus:outline-none resize-none min-h-[40px] dark:text-gray-100"
                     value={layer.text} 
                     onChange={e => updateLayer(layer.id, { text: e.target.value })}
                   />
                   <select 
                     value={layer.fontFamily || 'Inter'}
                     onChange={e => updateLayer(layer.id, { fontFamily: e.target.value })}
                     className="w-full mt-2 text-xs p-1.5 rounded border dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                   >
                     {availableFonts.map(f => <option key={f} value={f} style={{fontFamily: f}}>{f}</option>)}
                   </select>
                   <div className="flex gap-3 mt-2 items-center justify-between">
                     <input type="color" value={layer.color} onChange={e => updateLayer(layer.id, { color: e.target.value })} className="w-8 h-8 rounded cursor-pointer border-0" title="Цвет текста" />
                     <div className="flex items-center gap-2 flex-1">
                       <span className="text-[10px] text-gray-500 uppercase font-bold">Размер:</span>
                       <input type="range" min="16" max="120" value={layer.fontSize} onChange={e => updateLayer(layer.id, { fontSize: Number(e.target.value) })} className="w-full accent-green-500" />
                     </div>
                     <button onClick={() => removeLayer(layer.id)} className="text-red-500 hover:text-red-700 transition-colors" title="Удалить слой">
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                     </button>
                   </div>
                </div>
             ))}
             {layers.filter(l => l.type === 'text').length === 0 && <p className="text-xs text-gray-400 italic text-center py-4">Добавьте тексты для сцены.</p>}
           </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-lg border border-amber-100 dark:border-slate-700">
           <h3 className="font-bold text-lg mb-3 flex items-center gap-2"><Sparkles className="w-5 h-5 text-amber-500"/> 4. ИИ-Элементы (Без фона)</h3>
           <p className="text-xs text-gray-500 mb-3">Сгенерируйте любой объект или 3D-иконку. Фон удалится автоматически!</p>
           <textarea 
             className="w-full border rounded-lg p-3 text-sm h-16 dark:bg-slate-900 focus:ring-2 focus:ring-amber-500 mb-3"
             value={elementPrompt} 
             onChange={e => setElementPrompt(e.target.value)} 
             placeholder="Свежий апельсин в брызгах воды..."
           />
           <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={() => handleGenerateElement(false)} disabled={isGeneratingElement} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50">
                 {isGeneratingElement ? '...' : 'Создать Объект'}
              </button>
              <button onClick={() => handleGenerateElement(true)} disabled={isGeneratingElement} className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white py-2 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50">
                 {isGeneratingElement ? '...' : '3D Иконка'}
              </button>
           </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-lg border border-orange-100 dark:border-slate-700">
           <h3 className="font-bold text-lg mb-3 flex items-center gap-2"><Layers className="w-5 h-5 text-orange-500"/> 5. Управление Слоями</h3>
           <p className="text-xs text-gray-500 mb-2">Нажмите стрелки, чтобы переместить слой вперед (▲) или назад (▼).</p>
           <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
             {[...layers].reverse().map((layer, reverseIndex) => {
                const i = layers.length - 1 - reverseIndex;
                return (
                 <div key={layer.id} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 border dark:border-slate-700 rounded text-sm group hover:border-orange-300">
                    <div className="flex items-center gap-2 truncate flex-1">
                       {layer.type === 'image' ? <ImageIcon className="w-4 h-4 text-fuchsia-500"/> : <Type className="w-4 h-4 text-green-500"/>}
                       <span className="truncate pr-2 dark:text-gray-200 font-medium" title={layer.text || 'Картинка'}>
                          {layer.type === 'text' ? layer.text : 'Картинка товара'}
                       </span>
                    </div>
                    <div className="flex gap-1">
                       <button onClick={() => moveLayerUp(i)} disabled={i === layers.length - 1} className="px-2 py-1 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 rounded disabled:opacity-30 font-bold transition-colors">▲</button>
                       <button onClick={() => moveLayerDown(i)} disabled={i === 0} className="px-2 py-1 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 rounded disabled:opacity-30 font-bold transition-colors">▼</button>
                    </div>
                 </div>
                );
             })}
             {layers.length === 0 && <p className="text-xs text-gray-400 italic py-2">Слоев пока нет.</p>}
           </div>
        </div>
      </div>

      {/* Right Canvas Board */}
      <div className="w-full lg:w-2/3 flex flex-col gap-4">
         <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-800 px-4 sm:px-6 py-4 rounded-xl shadow border border-gray-100 dark:border-slate-700">
            <h2 className="font-black text-xl sm:text-2xl flex flex-wrap items-center gap-2 text-slate-800 dark:text-white">
               <Layers className="w-6 h-6 sm:w-7 sm:h-7 text-indigo-600 shrink-0"/> Студия <b>Композиции</b>
            </h2>
            <button onClick={exportCanvas} disabled={!bgImage || isGenerating} className="w-full sm:w-auto justify-center bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-lg flex items-center gap-2 disabled:opacity-50 transition-all sm:hover:scale-105 transform active:scale-95">
               <Download className="w-5 h-5"/> Сохранить Готовый Рендер
            </button>
         </div>

         <p className="md:hidden text-xs text-slate-500 dark:text-slate-400 px-1">
            Холст 1000×1000 пикселей: прокручивайте область ниже, чтобы увидеть и редактировать всю композицию.
         </p>
         
         {/* Enforced horizontal/vertical scrolling to prevent flexbox from squishing the fixed-size 1000x1000 board */}
         <div
            className="bg-slate-100 dark:bg-slate-900 rounded-xl overflow-auto shadow-inner border border-gray-300 dark:border-slate-700 flex justify-center p-2 sm:p-4 md:p-8 relative h-[min(72vh,800px)] md:h-[800px] w-full"
         >
            
            {/* The Actual Render Board (Strictly Maintains 1000x1000) */}
            <div 
               ref={boardRef} 
               className="relative shadow-2xl bg-white flex-shrink-0 overflow-hidden"
               style={{ width: '1000px', height: '1000px' }}
            >
               {bgImage ? (
                  <img src={bgImage} className="absolute inset-0 w-full h-full object-cover" crossOrigin="anonymous" />
               ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center border-4 border-dashed border-gray-300 bg-gray-50 text-gray-400 font-medium">
                     <Sparkles className="w-12 h-12 mb-4 text-indigo-300"/>
                     Холст пуст. Нажмите кнопку «Сгенерировать Фон» слева.
                  </div>
               )}

               {layers.map(layer => (
                  <Rnd
                    key={layer.id}
                    default={{ x: layer.x, y: layer.y, width: layer.width, height: layer.height }}
                    minWidth={50}
                    minHeight={50}
                    onDragStop={(e, d) => updateLayer(layer.id, { x: d.x, y: d.y })}
                    onResizeStop={(e, dir, ref, delta, pos) => updateLayer(layer.id, { width: parseInt(ref.style.width), height: parseInt(ref.style.height), ...pos })}
                    bounds="parent"
                    lockAspectRatio={layer.type === 'image'}
                    className={`group ${layer.type === 'text' ? 'flex items-center justify-center' : ''}`}
                  >
                     {/* Floating Delete Button */}
                     <div className="absolute -top-3 -right-3 bg-red-500 hover:bg-red-600 text-white w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer shadow-lg z-50 text-xs font-bold transition-opacity" onClick={() => removeLayer(layer.id)}>✕</div>
                     
                     {/* Border highlighter */}
                     <div className="absolute inset-0 border-2 border-indigo-500 border-dashed opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity bg-indigo-500/10"/>
                     
                     {layer.type === 'image' && (
                        <img src={layer.src} className="w-full h-full object-contain drop-shadow-2xl" draggable={false} crossOrigin="anonymous" />
                     )}
                     
                     {layer.type === 'text' && (
                        <div style={{ 
                           fontFamily: layer.fontFamily || 'Inter',
                           fontSize: `${layer.fontSize}px`, 
                           color: layer.color, 
                           fontWeight: layer.fontWeight, 
                           textAlign: layer.textAlign,
                           textShadow: '0px 4px 15px rgba(0,0,0,0.8)'
                        }} className="w-full h-full flex flex-col justify-center leading-tight font-sans tracking-tight break-words whitespace-pre-wrap">
                           {layer.text}
                        </div>
                     )}
                  </Rnd>
               ))}
            </div>
         </div>
      </div>
    </div>
  );
}
