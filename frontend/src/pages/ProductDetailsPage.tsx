import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { connectionOptionLabel, syndicationStepHint } from '../lib/marketplaceUi';
import { Sparkles, FileText, Save, Share2, Play, UploadCloud, Scissors, Palette } from 'lucide-react';
import PromoStudio from '../components/PromoStudio';

/** API может вернуть null для JSONB — без объекта страница падает при первом рендере. */
function normalizeProduct(raw: any) {
  if (!raw) return raw;
  const attrs = raw.attributes_data;
  return {
    ...raw,
    attributes_data: attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs : {},
    images: Array.isArray(raw.images) ? raw.images : [],
  };
}

function PayloadTable({ payload }: { payload: any }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded border dark:border-slate-700 overflow-hidden shadow-sm mt-3">
      <table className="w-full text-sm text-left">
        <thead className="bg-slate-50 dark:bg-slate-900 border-b dark:border-slate-700">
          <tr>
            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Как называется поле у площадки</th>
            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Что уйдёт в API</th>
            <th className="px-4 py-3 font-semibold text-center text-slate-600 dark:text-slate-300">Проверка ИИ</th>
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-slate-700">
          {Object.entries(payload).map(([k, v], i) => (
            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-indigo-600 dark:text-indigo-400">{k}</td>
              <td className="px-4 py-3">
                {typeof v === 'object' ? (
                  <pre className="text-[11px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 p-2 rounded">{JSON.stringify(v, null, 2)}</pre>
                ) : (
                  <span className="font-medium dark:text-white">{String(v)}</span>
                )}
              </td>
              <td className="px-4 py-3 text-center">
                {v ? (
                 <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full text-[10px] font-bold">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>
                    Валидно
                 </span>
                ) : (
                 <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-1 rounded-full text-[10px] font-bold">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                    Пусто (Нет в PIM)
                 </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveDictionaryField({ field, connectionId, categoryId, onChange }: any) {
  const [options, setOptions] = useState<any[]>(Array.isArray(field?.dictionary_options) ? field.dictionary_options : []);
  const [loading, setLoading] = useState(false);
  const initialValue =
    field?.current_value !== undefined && field?.current_value !== null
      ? String(field.current_value)
      : '';
  const [value, setValue] = useState<string>(initialValue);
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);
  const optionPairs = options.map((opt: any, idx: number) => ({
    id: String(opt?.id ?? opt?.value ?? opt?.name ?? idx),
    label: String(opt?.value ?? opt?.name ?? opt?.id ?? ''),
  }));
  const matchById = optionPairs.find((o: any) => o.id === String(value));
  const matchByLabel = optionPairs.find((o: any) => o.label.toLowerCase() === String(value).toLowerCase());
  const hasCurrentInOptions = !value ? true : Boolean(matchById || matchByLabel);
  const selectValue = matchById ? matchById.id : (matchByLabel ? matchByLabel.id : '');
  
  useEffect(() => {
    if (Array.isArray(field?.dictionary_options) && field.dictionary_options.length > 0) {
       setOptions(field.dictionary_options);
       return;
    }
    if (field.dictionary_id) {
       setLoading(true);
       api.get(`/syndicate/dictionary?connection_id=${connectionId}&category_id=${categoryId}&dictionary_id=${field.dictionary_id}`)
         .then(res => setOptions(res.data))
         .catch(err => console.error(err))
         .finally(() => setLoading(false));
    }
  }, [field, connectionId, categoryId]);
  
  return (
    <label className="flex flex-col">
       <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{field.name} <span className="text-red-500">*</span></span>
       {field.dictionary_id ? (
         <>
           <select
              className="border p-2 rounded mt-1 bg-white text-black dark:bg-slate-700 dark:text-white"
              value={selectValue}
              onChange={e => {
                setValue(e.target.value);
                onChange(e.target.value);
              }}
            >
               <option value="">Выберите значение по справочнику МП...</option>
               {loading && <option>Загрузка справочника с маркетплейса...</option>}
               {optionPairs.map((opt: any, idx: number) => {
                 return <option key={opt.id + '_' + idx} value={opt.id}>{opt.label}</option>;
               })}
            </select>
            {!hasCurrentInOptions && value ? (
              <span className="text-xs text-red-600 dark:text-red-300 mt-1">
                Текущее значение не входит в словарь этого атрибута и не будет отправлено.
              </span>
            ) : null}
         </>
       ) : (
         <input
            className="border p-2 rounded mt-1 bg-white text-black dark:bg-slate-700 dark:text-white"
            placeholder="Свободное значение..."
            value={value}
            onChange={e => {
              setValue(e.target.value);
              onChange(e.target.value);
            }}
          />
       )}
    </label>
  );
}

export default function ProductDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<any>(null);
  const [attributes, setAttributes] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [supplierText, setSupplierText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'syndicate' | 'promo'>('edit');
  
  // Syndication state
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [syndicateOutput, setSyndicateOutput] = useState<string>('-> Готов к запуску AI агентов...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [mappedPayload, setMappedPayload] = useState<any>(null);
  const [missingFields, setMissingFields] = useState<any[]>([]);
  const [reviewRequiredFields, setReviewRequiredFields] = useState<any[]>([]);
  const [reviewAllFields, setReviewAllFields] = useState<any[]>([]);
  const [qualityWarnings, setQualityWarnings] = useState<any[]>([]);
  const [targetCategoryId, setTargetCategoryId] = useState<string>('');
  const [targetSchema, setTargetSchema] = useState<any>(null);
  
  // Category Search state
  const [catSearchQuery, setCatSearchQuery] = useState('');
  const [catSearchResults, setCatSearchResults] = useState<{id: string, name: string}[]>([]);
  const [isSearchingCat, setIsSearchingCat] = useState(false);
  /** Мегамаркет: после card/* отдельно вызываются price/updateByOfferId и stock/updateByOfferId */
  const [mmPriceRubles, setMmPriceRubles] = useState('');
  const [mmStockQty, setMmStockQty] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Ошибки загрузки вспомогательных списков — карточка товара при этом уже показана */
  const [auxiliaryErrors, setAuxiliaryErrors] = useState<string[]>([]);
  const draftStorageKey = id ? `pimv3:syndicate:draft:${id}` : '';

  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft && typeof draft === 'object') {
        if (typeof draft.selectedConnection === 'string') setSelectedConnection(draft.selectedConnection);
        if (typeof draft.syndicateOutput === 'string') setSyndicateOutput(draft.syndicateOutput);
        if (draft.mappedPayload && typeof draft.mappedPayload === 'object') setMappedPayload(draft.mappedPayload);
        if (Array.isArray(draft.missingFields)) setMissingFields(draft.missingFields);
        if (Array.isArray(draft.reviewRequiredFields)) setReviewRequiredFields(draft.reviewRequiredFields);
        if (Array.isArray(draft.reviewAllFields)) setReviewAllFields(draft.reviewAllFields);
        if (Array.isArray(draft.qualityWarnings)) setQualityWarnings(draft.qualityWarnings);
        if (typeof draft.targetCategoryId === 'string') setTargetCategoryId(draft.targetCategoryId);
        if (typeof draft.mmPriceRubles === 'string') setMmPriceRubles(draft.mmPriceRubles);
        if (typeof draft.mmStockQty === 'string') setMmStockQty(draft.mmStockQty);
        if (draft.targetSchema && typeof draft.targetSchema === 'object') setTargetSchema(draft.targetSchema);
      }
    } catch (e) {
      console.error('Failed to restore syndicate draft', e);
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      const draft = {
        selectedConnection,
        syndicateOutput,
        mappedPayload,
        missingFields,
        reviewRequiredFields,
        reviewAllFields,
        qualityWarnings,
        targetCategoryId,
        mmPriceRubles,
        mmStockQty,
        targetSchema,
      };
      localStorage.setItem(draftStorageKey, JSON.stringify(draft));
    } catch (e) {
      console.error('Failed to persist syndicate draft', e);
    }
  }, [
    draftStorageKey,
    selectedConnection,
    syndicateOutput,
    mappedPayload,
    missingFields,
    reviewRequiredFields,
    reviewAllFields,
    qualityWarnings,
    targetCategoryId,
    mmPriceRubles,
    mmStockQty,
    targetSchema,
  ]);

  const handleSearchCategories = async () => {
    if (!catSearchQuery || !selectedConnection) return;
    setIsSearchingCat(true);
    try {
      const res = await api.get(`/syndicate/categories/search?connection_id=${selectedConnection}&q=${encodeURIComponent(catSearchQuery)}`);
      setCatSearchResults(res.data.categories || []);
    } catch(e) {
      console.error(e);
      alert("Ошибка при поиске категорий");
    } finally {
      setIsSearchingCat(false);
    }
  };

  // Visual AI state
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState<string>('a professional commercial product photography shot, cinematic studio lighting, highly detailed');
  const [generatingVisuals, setGeneratingVisuals] = useState<Record<string, boolean>>({});
  // Using user-requested 'Nano Banana' model via V2 API
  const [aiModel, setAiModel] = useState('gemini-2.5-flash-image');
  const [isBgRemoving, setIsBgRemoving] = useState(false);
  const [availableModels, setAvailableModels] = useState<{id: string, name: string}[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`/api/v1/visual/models?t=${new Date().getTime()}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => {
        console.log("Models fetch response status:", res.status);
        return res.json();
      })
      .then(data => {
        console.log("Models fetched payload:", data);
        const modelsList = data.models || data.custom_models || (Array.isArray(data) ? data : []);
        if (modelsList && modelsList.length > 0) {
          setAvailableModels(modelsList);
        } else {
          console.error("Data returned from models endpoint is empty or malformed: ", data);
        }
      })
      .catch(err => console.error("Failed to load AI models", err));
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoadError(null);
    setAuxiliaryErrors([]);
    setProduct(null);
    setAttributes([]);
    setConnections([]);

    let cancelled = false;

    (async () => {
      try {
        const prodRes = await api.get(`/products/${id}`);
        if (cancelled) return;
        setProduct(normalizeProduct(prodRes.data));
      } catch (e: any) {
        if (cancelled) return;
        const msg = e.response?.data?.detail;
        const text = typeof msg === 'string' ? msg : e.message || 'Не удалось загрузить карточку';
        setLoadError(text);
        return;
      }

      const [attrResult, connResult] = await Promise.allSettled([
        api.get('/attributes'),
        api.get('/connections'),
      ]);
      if (cancelled) return;

      const errs: string[] = [];

      if (attrResult.status === 'fulfilled') {
        const raw = attrResult.value.data;
        setAttributes(Array.isArray(raw) ? raw : []);
      } else {
        setAttributes([]);
        errs.push(
          'Не удалось загрузить схему атрибутов. Карточка открыта; список полей может быть неполным. Проверьте API /attributes и логи сервера.'
        );
        console.error('GET /attributes failed', attrResult.reason);
      }

      if (connResult.status === 'fulfilled') {
        const data = connResult.value.data;
        const list = Array.isArray(data) ? data : [];
        setConnections(list);
        if (list.length > 0) {
          setSelectedConnection(prev => prev || list[0].id);
        }
      } else {
        setConnections([]);
        errs.push(
          'Не удалось загрузить подключения магазинов. Редактор и медиа доступны; выгрузка без списка магазинов. Проверьте API /connections.'
        );
        console.error('GET /connections failed', connResult.reason);
      }

      setAuxiliaryErrors(errs);
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loadError) {
    return (
      <div className="text-center mt-10 space-y-4">
        <p className="text-red-600 dark:text-red-400">{loadError}</p>
        <button type="button" onClick={() => navigate('/products')} className="text-indigo-600 dark:text-indigo-400 underline">
          Вернуться в каталог
        </button>
      </div>
    );
  }

  if (!product) return <div className="text-center mt-10">Загрузка...</div>;

  const selectedConnObj = connections.find((c: { id: string }) => c.id === selectedConnection);
  const isMegamarketTarget = selectedConnObj?.type === 'megamarket';
  const isYandexTarget = selectedConnObj?.type === 'yandex';
  /** Для этих площадок без категории в API уходит неполный запрос */
  const categoryRequiredForPush = isMegamarketTarget || isYandexTarget;
  const syndicateCategoryIdReady = Boolean(
    String(targetCategoryId || '').trim() || String((mappedPayload as Record<string, unknown>)?.categoryId ?? '').trim()
  );

  const handleSave = async () => {
    await api.patch(`/products/${id}`, {
      name: product.name,
      sku: product.sku,
      attributes_data: product.attributes_data,
      description_html: product.description_html,
      images: product.images
    });
    const res = await api.get(`/products/${id}`);
    setProduct(normalizeProduct(res.data));
    alert('Товар успешно сохранён!');
  };

  const handleMagicExtract = async () => {
    if (!supplierText) return alert("Вставьте текст от поставщика");
    setIsExtracting(true);
    try {
      const res = await api.post('/ai/extract', { text: supplierText });
      const extracted = res.data.extracted_data;
      setProduct({ ...product, attributes_data: { ...product.attributes_data, ...extracted } });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleMagicGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await api.post('/ai/generate', { product_id: product.id });
      setProduct({ ...product, description_html: res.data.description_html });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAttrChange = (code: string, value: any) => {
    setProduct({
      ...product,
      attributes_data: {
        ...product.attributes_data,
        [code]: value
      }
    });
  };

  // --- Syndication Handlers ---
  const logOutput = (msg: string) => setSyndicateOutput(prev => prev + '\n-> ' + msg);
  const clearSyndicateDraft = () => {
    if (draftStorageKey) localStorage.removeItem(draftStorageKey);
    setSyndicateOutput('-> Готов к запуску AI агентов...');
    setMappedPayload(null);
    setMissingFields([]);
    setReviewRequiredFields([]);
    setReviewAllFields([]);
    setQualityWarnings([]);
    setTargetCategoryId('');
    setTargetSchema(null);
    setMmPriceRubles('');
    setMmStockQty('');
  };

  const runAISelector = async () => {
    setIsProcessing(true);
    logOutput('Запуск AI Selector... Анализ данных и Автогенерация Схемы PIM...');
    try {
      const res = await api.post('/syndicate/selector', { product_id: product.id });
      setProduct((prev: any) => ({ ...prev, attributes_data: res.data.ideal_card }));
      
      // Золотое правило Zero-Setup: AI сам создает структуру, мы просто подтягиваем её на лету
      const attrRes = await api.get('/attributes');
      setAttributes(attrRes.data);
      
      logOutput('Успех: Идеальная база сформирована! AI-Генерация схемы выполнена.\n' + JSON.stringify(res.data.ideal_card, null, 2));
    } catch (e: any) { logOutput('Ошибка: ' + (e.response?.data?.detail || e.message)); } 
    finally { setIsProcessing(false); }
  };

  const runAISEO = async () => {
    setIsProcessing(true);
    logOutput('Запуск AI SEO Agent... Генерация LSI-тегов и AI-оптимизации...');
    try {
      const res = await api.post('/syndicate/seo', { product_id: product.id });
      logOutput('Успех: SEO Описание сгенерировано:\n' + res.data.seo_html);
    } catch (e: any) { logOutput('Ошибка: ' + (e.response?.data?.detail || e.message)); } 
    finally { setIsProcessing(false); }
  };

  const runAIMapper = async () => {
    if (!selectedConnection) return alert("Выберите магазин");
    setIsProcessing(true);
    logOutput('Запуск AI Маппера... [ReAct Framework]\n1. Генерация поискового запроса по категории\n2. Запрос живого дерева категорий из API маркетплейса\n3. AI-выбор лучшей категории\n4. Скачивание строгой официальной схемы атрибутов\n5. Окончательный маппинг базы...');
    try {
      const res = await api.post('/syndicate/map', { product_id: product.id, connection_id: selectedConnection });
      const mapPayload = { ...res.data.mapped_payload };
      if (product.images && product.images.length > 0) {
        const baseUrl = window.location.origin;
        mapPayload['Фото'] = product.images.map((img: string) => img.startsWith('/') ? baseUrl + img : img);
      }
      
      setMappedPayload(mapPayload);
      setMissingFields(res.data.missing_fields || []);
      if (res.data.category_id) {
          setTargetCategoryId(res.data.category_id);
      }
      setTargetSchema(res.data.target_schema || null);
      logOutput('Маппинг успешно завершён. Ожидание пользователя.');
    } catch (e: any) { logOutput('Ошибка: ' + (e.response?.data?.detail || e.message)); } 
    finally { setIsProcessing(false); }
  };

  const runMarketplaceAgent = async () => {
    if (!selectedConnection) return alert('Выберите магазин');
    setIsProcessing(true);
    logOutput(`AI агент (${selectedConnObj?.type || 'mp'}): автосборка и выгрузка...`);
    logOutput('Ожидание может занять до 4-6 минут: MM проверяет карточку асинхронно.');
    try {
      const publicBase = import.meta.env.VITE_PUBLIC_APP_URL?.trim() || window.location.origin;
      const cat =
        String(targetCategoryId || '').trim() ||
        String((mappedPayload as Record<string, unknown>)?.categoryId ?? '').trim() ||
        undefined;
      const body: Record<string, unknown> = {
        product_id: product.id,
        connection_id: selectedConnection,
        category_id: cat || undefined,
        push: true,
        public_base_url: publicBase,
        mapped_payload: mappedPayload || undefined,
      };
      if (isMegamarketTarget) {
        const p = parseFloat(mmPriceRubles.replace(',', '.').trim());
        if (mmPriceRubles.trim() !== '' && Number.isFinite(p)) body.mm_price_rubles = p;
        if (mmStockQty.trim() !== '') {
          const q = parseInt(mmStockQty.trim(), 10);
          if (!Number.isNaN(q)) body.mm_stock_quantity = q;
        }
      }
      const res = await api.post('/syndicate/agent', body);
      const data = res.data;
      if (data.mapped_payload) setMappedPayload(data.mapped_payload);
      if (data.category_id) setTargetCategoryId(data.category_id);
      if (Array.isArray(data.missing_fields)) {
        setMissingFields(data.missing_fields);
      } else if (Array.isArray(data.preflight_missing)) {
        const pf = data.preflight_missing.map((x: any) => ({
          name: String(x?.field || 'Поле'),
          reason: String(x?.reason || ''),
          is_required: true,
        }));
        setMissingFields(pf);
      } else if (data.status === 'success') {
        setMissingFields([]);
      }
      if (Array.isArray(data.review_required_fields)) setReviewRequiredFields(data.review_required_fields);
      else if (data.status === 'success') setReviewRequiredFields([]);
      if (Array.isArray(data.review_all_fields)) setReviewAllFields(data.review_all_fields);
      else if (data.status === 'success') setReviewAllFields([]);
      if (Array.isArray(data.quality_warnings)) setQualityWarnings(data.quality_warnings);
      else if (data.status === 'success') setQualityWarnings([]);
      const trace = Array.isArray(data.trace) ? data.trace : [];
      logOutput(
        JSON.stringify(
          {
            marketplace: data.marketplace,
            status: data.status,
            message: data.message,
            push: data.push,
            trace,
            missing_fields: data.missing_fields || [],
            review_required_fields: data.review_required_fields || [],
            review_all_fields: data.review_all_fields || [],
            quality_warnings: data.quality_warnings || [],
            preflight_missing: data.preflight_missing || [],
          },
          null,
          2
        )
      );
      if (data.status === 'pending_required') {
        alert('Есть обязательные поля без подтвержденных значений. Заполните ниже вручную/из справочника и повторите.');
      } else if (data.status === 'preflight_blocked') {
        const rows = Array.isArray(data.preflight_missing)
          ? data.preflight_missing.map((x: any) => `- ${String(x?.field || 'Поле')}: ${String(x?.reason || '')}`).join('\n')
          : '';
        alert(`Preflight блокирует отправку. Заполните поля ниже в блоке "Требует Внимания", затем повторите.\n${rows}`);
      } else if (data.status !== 'success') {
        alert(data.message || 'Ошибка выгрузки');
      }
      else alert('AI агент завершил цикл');
    } catch (e: any) {
      const d = e.response?.data?.detail;
      const msg = typeof d === 'string' ? d : Array.isArray(d) ? JSON.stringify(d) : e.message;
      logOutput('Ошибка: ' + msg);
      alert(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVisualAction = async (imgUrl: string, type: 'rmbg' | 'generate') => {
    setIsProcessing(true);
    try {
      const imgRes = await fetch(imgUrl);
      const blob = await imgRes.blob();
      
      const formData = new FormData();
      formData.append('file', blob, 'image.png');
      if (type === 'generate') {
        formData.append('prompt', aiPrompt);
        formData.append('model_id', aiModel);
        if (product?.id) {
          formData.append('product_id', String(product.id));
        }
      }
      
      const endpoint = type === 'rmbg' ? '/api/v1/visual/remove-background' : '/api/v1/visual/generate-background';
      
      const token = localStorage.getItem('token');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `HTTP ${res.status}`);
      }
      const processedBlob = await res.blob();

      const uploadData = new FormData();
      uploadData.append('file', processedBlob, `${type}_${Date.now()}.png`);
      
      const uploadRes = await fetch('/api/v1/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: uploadData
      });
      if (!uploadRes.ok) {
        const errStr = await uploadRes.text();
        throw new Error(errStr || `UPLOAD_HTTP_${uploadRes.status}`);
      }
      const uploadJson = await uploadRes.json();
      
      const newImages = [...(product.images || []), uploadJson.url];
      await api.patch(`/products/${product.id}`, { images: newImages });
      setProduct({ ...product, images: newImages });
      if (type === 'generate') setActiveImage(null);
    } catch (e: any) {
      let errorMsg = e.response?.data?.detail || e.message;
      if (Array.isArray(errorMsg)) errorMsg = JSON.stringify(errorMsg);
      else if (typeof errorMsg === 'object') errorMsg = JSON.stringify(errorMsg);
      alert(`Ошибка Визуального AI (${type}): ` + errorMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setIsProcessing(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      if (!res.ok) throw new Error("Upload failed: " + res.status);
      const json = await res.json();
      const newImages = [...(product.images || []), json.url];
      await api.patch(`/products/${product.id}`, { images: newImages });
      setProduct({ ...product, images: newImages });
    } catch (err: any) {
      alert("Ошибка загрузки: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSyndicatePush = async () => {
    if (!selectedConnection || !mappedPayload) return alert("Сначала выполните маппинг");
    if (categoryRequiredForPush && !syndicateCategoryIdReady) {
      return alert(
        'Укажите категорию на этой площадке: нажмите «Искать» или вставьте ID в поле ниже. Без категории маркетплейс не примет карточку.'
      );
    }
    setIsProcessing(true);
    logOutput('Подготовка API Push...');
    try {
      const finalPayload = { ...mappedPayload };
      if (targetCategoryId) {
        finalPayload.categoryId = targetCategoryId;
      }
      if (product.images && product.images.length > 0) {
        // Прод с SSL на том же хосте, что и API: origin уже https://ваш-домен
        const publicBase = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
        const baseUrl = publicBase || window.location.origin;
        finalPayload['Фото'] = product.images.map((img: string) => img.startsWith('/') ? baseUrl + img : img);
      }
      const pushBody: Record<string, unknown> = {
        product_id: product.id,
        connection_id: selectedConnection,
        mapped_payload: finalPayload,
      };
      if (isMegamarketTarget) {
        const p = parseFloat(mmPriceRubles.replace(',', '.').trim());
        if (mmPriceRubles.trim() !== '' && Number.isFinite(p)) pushBody.mm_price_rubles = p;
        if (mmStockQty.trim() !== '') {
          const q = parseInt(mmStockQty.trim(), 10);
          if (!Number.isNaN(q)) pushBody.mm_stock_quantity = q;
        }
      }
      const res = await api.post('/syndicate/push', pushBody);
      if (res.data.status === 'error') {
         logOutput('Ошибка от Маркетплейса: ' + res.data.message);
         alert('Произошла ошибка при выгрузке. Проверьте консоль Синдикатора!');
      } else {
         logOutput('Успешная выгрузка: ' + res.data.message);
         alert('Карточка успешно собрана и передана в API Маркетплейса!');
      }
    } catch (e: any) { 
      logOutput('Сбой Сети/API: ' + (e.response?.data?.detail || e.message)); 
      alert('Не удалось отправить запрос. Подробности в консоли.');
    } 
    finally { setIsProcessing(false); }
  };


  return (
    <div className="flex flex-col gap-6">
      {auxiliaryErrors.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
        >
          <p className="font-semibold mb-1">Часть данных не загрузилась</p>
          <ul className="list-disc pl-5 space-y-1 text-amber-900/90 dark:text-amber-200/90">
            {auxiliaryErrors.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold flex items-center gap-2">
          {product.name} <span className="text-sm font-normal bg-slate-200 dark:bg-slate-700 px-2 rounded">Артикул: {product.sku}</span>
        </h2>
        <div className="flex gap-4">
          <div className="flex rounded overflow-hidden border border-gray-300">
             <button className={`px-4 py-2 font-medium ${activeTab === 'edit' ? 'bg-primary text-white' : 'bg-white text-black'}`} onClick={() => setActiveTab('edit')}>Редактор Базы</button>
             <button className={`px-4 py-2 font-medium ${activeTab === 'syndicate' ? 'bg-indigo-600 text-white' : 'bg-white text-black'}`} onClick={() => setActiveTab('syndicate')}>Перенос на маркетплейсы</button>
             <button className={`px-4 py-2 font-medium ${activeTab === 'promo' ? 'bg-fuchsia-600 text-white' : 'bg-white text-black'}`} onClick={() => setActiveTab('promo')}>Промо-Студия (AI)</button>
          </div>
          <button onClick={handleSave} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700"><Save className="w-4 h-4" /> Сохранить базу</button>
        </div>
      </div>

      {activeTab === 'edit' && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-slate-800 p-6 rounded shadow flex flex-col gap-4">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Медиафайлы</h4>
              <label className="cursor-pointer bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-3 py-1 rounded text-sm flex items-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 transition-colors">
                <UploadCloud className="w-4 h-4" /> Загрузить фото
                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
            {product.images && product.images.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {product.images.map((img: string, idx: number) => (
                  <div key={idx} className="relative group flex-none">
                    <img src={img} alt={`Slide ${idx}`} onClick={() => setFullscreenImage(img)} className="h-32 w-32 object-contain border dark:border-slate-600 rounded bg-white shadow-sm cursor-pointer hover:ring-2 hover:ring-indigo-500 transition-all" />
                    <button onClick={() => setProduct({...product, images: product.images.filter((_: any, i: number) => i !== idx)})} className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Удалить">&times;</button>
                    <div className="absolute bottom-1 left-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-center">
                      <button type="button" onClick={() => handleVisualAction(img, 'rmbg')} className="bg-slate-900/80 text-white p-1.5 rounded hover:bg-slate-700 transition" title="Удалить фон (U-2-Net)"><Scissors className="w-3 h-3" /></button>
                      <button type="button" onClick={() => setActiveImage(img)} className="bg-slate-900/80 text-white p-1.5 rounded hover:bg-indigo-600 transition" title="Сгенерировать фон (Inpainting)"><Palette className="w-3 h-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Нет загруженных фотографий</p>
            )}

            {activeImage && (
              <div className="mt-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded flex gap-3 animate-in fade-in">
                <img src={activeImage} className="w-12 h-12 object-contain bg-white rounded border" />
                <div className="flex-1 flex flex-col gap-2">
                   <div className="text-xs text-indigo-700 dark:text-indigo-400 font-medium mb-1">
                       Режиссерская постановка (Generative AI Composition)
                   </div>
                   <textarea 
                     className="text-sm p-3 rounded border dark:bg-slate-800 dark:border-slate-700 w-full resize-y min-h-[80px]"
                     value={aiPrompt}
                     onChange={(e) => setAiPrompt(e.target.value)}
                     placeholder="Например: Этот нож в руках у хозяйки, которая режет сочный красный помидор на деревянной доске, летящие брызги воды... ИЛИ Пылесос затягивает вихрь светящейся космической пыли в киберпанк интерьере."
                   />
                   <select 
                     className="text-sm p-2 rounded border dark:bg-slate-800 dark:border-slate-700 mt-2 text-slate-800 dark:text-slate-200"
                     value={aiModel}
                     onChange={e => setAiModel(e.target.value)}
                   >
                     {availableModels.length > 0 ? (
                       <>
                         <option value="">-- Выберите модель --</option>
                         {availableModels.map(model => (
                           <option key={model.id} value={model.id}>{model.name}</option>
                         ))}
                       </>
                     ) : (
                       <option value={aiModel}>Загрузка моделей...</option>
                     )}
                   </select>
                   <div className="flex gap-2 justify-end mt-1">
                     <button onClick={() => setActiveImage(null)} className="text-xs px-3 py-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">Отмена</button>
                     <button onClick={() => handleVisualAction(activeImage, 'generate')} disabled={isProcessing} className="bg-indigo-600 text-white text-sm px-4 py-2 rounded shadow hover:bg-indigo-700 font-bold flex gap-2 items-center disabled:opacity-50">
                        <Sparkles className="w-4 h-4" /> {isProcessing ? 'Нейро-Рендеринг (SD 3.5)...' : 'Создать Рекламную Композицию'}
                     </button>
                   </div>
                </div>
              </div>
            )}
          </div>
          <h3 className="text-xl font-semibold border-b pb-2 flex justify-between">
             Атрибуты Товара
             <span className="text-sm font-normal text-blue-600">Заполненность базы: {product.completeness_score}%</span>
          </h3>
          {attributes
            .filter(attr => attr.is_required || (product.attributes_data[attr.code] !== undefined && product.attributes_data[attr.code] !== null && product.attributes_data[attr.code] !== ''))
            .map(attr => (
            <label key={attr.code} className="flex flex-col gap-1">
              <span className="text-sm font-medium flex justify-between">
                {attr.name} {attr.is_required && <span className="text-red-500">*</span>}
              </span>
              <input 
                className="border rounded p-2 text-black"
                type={attr.type === 'number' ? 'number' : attr.type === 'boolean' ? 'checkbox' : 'text'}
                value={product.attributes_data[attr.code] || ''}
                checked={attr.type === 'boolean' ? !!product.attributes_data[attr.code] : undefined}
                onChange={e => handleAttrChange(attr.code, attr.type === 'boolean' ? e.target.checked : e.target.value)}
              />
            </label>
          ))}

          <div className="mt-8 border-t pt-4">
            <h4 className="font-semibold mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Умный Экстрактор Данных</h4>
            <textarea 
              className="w-full border rounded p-2 text-black text-sm mb-2" 
              rows={4} 
              placeholder="Вставьте сырой текст от поставщика для парсинга атрибутов..."
              value={supplierText}
              onChange={e => setSupplierText(e.target.value)}
            />
            <button onClick={handleMagicExtract} disabled={isExtracting} className="w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-black py-2 rounded flex justify-center items-center gap-2 font-medium hover:opacity-90 disabled:opacity-50">
              {isExtracting ? 'Парсинг...' : 'Извлечь атрибуты из текста'}
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded shadow flex flex-col gap-4">
          <h3 className="text-xl font-semibold border-b pb-2 flex justify-between items-center">
            SEO Описание (HTML базы)
            <button onClick={handleMagicGenerate} disabled={isGenerating} className="bg-primary text-white px-4 py-2 rounded text-sm flex items-center gap-2 shadow hover:bg-blue-600 disabled:opacity-50">
              <FileText className="w-4 h-4" /> {isGenerating ? 'В работе...' : 'Генерация через AI'}
            </button>
          </h3>
          <textarea 
            className="w-full flex-1 border rounded p-4 font-mono text-sm text-black min-h-[400px]"
            value={product.description_html || ''}
            onChange={e => setProduct({...product, description_html: e.target.value})}
            placeholder="<html><body>...</body></html>"
          />
        </div>
      </div>
      )}

      {fullscreenImage && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setFullscreenImage(null)}
        >
          <img 
            src={fullscreenImage} 
            className="max-w-full max-h-[90vh] object-contain shadow-2xl rounded"
            onClick={(e) => e.stopPropagation()} 
          />
          <button 
            className="absolute top-4 right-4 text-white hover:text-gray-300 bg-black/50 p-2 rounded-full transition-colors"
            onClick={() => setFullscreenImage(null)}
          >
             <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {activeTab === 'syndicate' && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded shadow flex flex-col gap-6">
          <h3 className="text-xl font-bold border-b pb-2 flex items-center gap-2 text-slate-900 dark:text-white">
            <Share2 className="w-6 h-6 text-indigo-600"/> Перенос этой карточки на маркетплейс
          </h3>

          <div className="rounded-lg border border-sky-200 dark:border-sky-900/50 bg-sky-50/90 dark:bg-sky-950/40 p-4 text-sm text-sky-950 dark:text-sky-100">
            <p className="font-semibold mb-2">Как это устроено (4 шага слева направо)</p>
            <ol className="list-decimal pl-5 space-y-1 text-sky-900/90 dark:text-sky-200/90">
              <li>Выберите <strong>куда</strong> выгружать — подключённый магазин.</li>
              <li><strong>Собрать идеальную карточку</strong> — система скачает этот же артикул со всех подключённых магазинов и сведёт данные через ИИ.</li>
              <li><strong>Подогнать под правила площадки</strong> — ИИ сопоставит ваши поля с официальной схемой API.</li>
              <li>Укажите <strong>категорию</strong> (если площадка требует), проверьте таблицу и нажмите «Отправить».</li>
            </ol>
            <p className="mt-3 text-xs text-sky-800/80 dark:text-sky-300/80">
              Нет нужного магазина? <Link to="/integrations" className="underline font-medium">Добавьте подключение</Link> в разделе «Магазины и ключи API».
            </p>
          </div>
          
          <div className="grid lg:grid-cols-4 gap-4">
             <div className="border p-4 rounded bg-slate-50 dark:bg-slate-900 shadow-sm">
                <h4 className="font-bold mb-2 flex items-center gap-2 text-slate-800 dark:text-slate-100"><span className="bg-gray-300 dark:bg-gray-700 text-xs px-2 py-1 rounded-full">1</span> Куда выгружать</h4>
                <select className="w-full border p-2 rounded text-black dark:text-white dark:bg-slate-800 mb-2" value={selectedConnection} onChange={e => setSelectedConnection(e.target.value)}>
                   <option value="">— Выберите магазин —</option>
                   {connections.map(c => <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>)}
                </select>
             </div>
             <div className="border p-4 rounded bg-slate-50 dark:bg-slate-900 shadow-sm">
                <h4 className="font-bold mb-2 flex items-center gap-2 text-indigo-700 dark:text-indigo-400"><span className="bg-indigo-200 dark:bg-indigo-900 text-xs px-2 py-1 rounded-full">2</span> Идеальная карточка</h4>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-4 min-h-[2.5rem]">Скачиваем этот SKU со всех подключённых магазинов и объединяем данные в вашей базе.</p>
                <button onClick={runAISelector} disabled={isProcessing} className="bg-indigo-600 text-white w-full py-2 rounded text-sm flex justify-center items-center gap-2 hover:bg-indigo-700 disabled:opacity-50"><Play className="w-4 h-4" />Собрать из магазинов</button>
             </div>
             <div className="border p-4 rounded bg-slate-50 dark:bg-slate-900 shadow-sm">
                <h4 className="font-bold mb-2 flex items-center gap-2 text-indigo-700 dark:text-indigo-400"><span className="bg-indigo-200 dark:bg-indigo-900 text-xs px-2 py-1 rounded-full">3</span> Подогнать под площадку</h4>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-4 min-h-[2.5rem]">ИИ заполняет поля по схеме выбранного маркетплейса и словарям.</p>
                <button onClick={runAIMapper} disabled={isProcessing} className="bg-indigo-600 text-white w-full py-2 rounded text-sm flex justify-center items-center gap-2 hover:bg-indigo-700 disabled:opacity-50"><Play className="w-4 h-4" />Запустить маппинг</button>
                {selectedConnection && (
                  <button
                    type="button"
                    onClick={runMarketplaceAgent}
                    disabled={isProcessing}
                    className="mt-2 bg-violet-700 text-white w-full py-2 rounded text-xs font-semibold hover:bg-violet-800 disabled:opacity-50"
                    title="ИИ сам определит маркетплейс по подключению и выполнит нужный сценарий"
                  >
                    AI агент: автозаполнение и выгрузка
                  </button>
                )}
             </div>
             <div className={`border p-4 rounded shadow-sm transition-all duration-300 ${mappedPayload ? 'bg-green-50 border-green-400 dark:bg-green-900/30' : 'bg-slate-50 dark:bg-slate-900'}`}>
                <h4 className="font-bold mb-2 flex items-center gap-2 text-green-700 dark:text-green-500"><span className="bg-green-200 dark:bg-green-900 text-xs px-2 py-1 rounded-full">4</span> Категория и отправка</h4>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Проверьте таблицу ниже и отправьте данные в API магазина.</p>
                 <div className="mb-3 space-y-1">
                   <label className="text-xs font-bold text-gray-700 dark:text-gray-300">Категория на площадке {categoryRequiredForPush && <span className="text-red-500">*</span>}</label>
                   {syndicationStepHint(selectedConnObj?.type) && (
                     <p className="text-[10px] text-amber-800 dark:text-amber-300/90 leading-tight">
                       {syndicationStepHint(selectedConnObj?.type)}
                     </p>
                   )}
                   <div className="flex gap-2 mb-2">
                     <input 
                       type="text" 
                       className="flex-1 text-xs p-1.5 border rounded dark:bg-slate-800 dark:border-slate-600 text-black dark:text-white"
                       value={catSearchQuery} 
                       onChange={e => setCatSearchQuery(e.target.value)} 
                       onKeyDown={e => e.key === 'Enter' && handleSearchCategories()}
                       placeholder="Поиск по названию (напр. шлем)"
                     />
                     <button onClick={handleSearchCategories} disabled={isSearchingCat || !selectedConnection} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded text-xs">
                       {isSearchingCat ? '...' : 'Искать'}
                     </button>
                   </div>
                   {catSearchResults.length > 0 && (
                     <div className="max-h-32 overflow-y-auto border rounded mb-2 dark:border-gray-600">
                       {catSearchResults.map(c => (
                         <div key={c.id} className="p-1.5 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-900 cursor-pointer border-b last:border-b-0" onClick={() => { setTargetCategoryId(c.id); setCatSearchResults([]); }}>
                           <span className="font-mono text-indigo-600 dark:text-indigo-400 mr-2">[{c.id}]</span>
                           {c.name}
                         </div>
                       ))}
                     </div>
                   )}
                   <input 
                     type="text" 
                     className="w-full text-xs p-1.5 border rounded bg-gray-50 dark:bg-slate-900 dark:border-slate-600 text-black dark:text-white font-mono"
                     value={targetCategoryId} 
                     onChange={e => setTargetCategoryId(e.target.value)} 
                     placeholder="Выбранный ID категории (например, 180203010101)"
                   />
                   {isMegamarketTarget && (
                     <div className="mt-3 space-y-2 border-t border-slate-200 dark:border-slate-600 pt-2">
                       <p className="text-[10px] text-gray-600 dark:text-gray-400 leading-tight">
                         Опционально: цена (₽) и остаток по API Мегамаркета после создания карточки. Нужен{' '}
                         <strong>locationId склада</strong> в «Магазины и ключи API» или переменная{' '}
                         <code className="text-[10px]">MEGAMARKET_DEFAULT_LOCATION_ID</code> на сервере.
                       </p>
                       <div className="grid grid-cols-2 gap-2">
                         <label className="flex flex-col text-[10px] font-bold text-gray-700 dark:text-gray-300">
                           Цена, ₽
                           <input
                             type="text"
                             inputMode="decimal"
                             className="mt-0.5 text-xs p-1.5 border rounded dark:bg-slate-800 dark:border-slate-600 text-black dark:text-white"
                             value={mmPriceRubles}
                             onChange={(e) => setMmPriceRubles(e.target.value)}
                             placeholder="напр. 1299.90"
                           />
                         </label>
                         <label className="flex flex-col text-[10px] font-bold text-gray-700 dark:text-gray-300">
                           Остаток, шт.
                           <input
                             type="text"
                             inputMode="numeric"
                             className="mt-0.5 text-xs p-1.5 border rounded dark:bg-slate-800 dark:border-slate-600 text-black dark:text-white"
                             value={mmStockQty}
                             onChange={(e) => setMmStockQty(e.target.value)}
                             placeholder="напр. 10"
                           />
                         </label>
                       </div>
                     </div>
                   )}
                </div>
                <button
                  onClick={handleSyndicatePush}
                  disabled={
                    isProcessing ||
                    !mappedPayload ||
                    (categoryRequiredForPush && !syndicateCategoryIdReady)
                  }
                  className={`w-full py-2 rounded font-bold transition-all ${
                    mappedPayload && isProcessing
                      ? 'opacity-50 cursor-not-allowed bg-green-600 text-white'
                      : mappedPayload && (!categoryRequiredForPush || syndicateCategoryIdReady)
                        ? 'bg-green-600 text-white shadow-[0_0_15px_rgba(34,197,94,0.6)] animate-pulse hover:bg-green-700'
                        : 'bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Отправить в магазин
                </button>
             </div>
          </div>

          {mappedPayload && (
             <div className="mt-4 p-4 border rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200">
                <h4 className="font-bold mb-2 text-indigo-800 dark:text-indigo-300 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                  Проверьте таблицу перед отправкой
                </h4>
                <p className="text-xs text-indigo-600 dark:text-indigo-400">
                  ИИ подставил значения под требования выбранного магазина. Если что-то не так — поправьте в базе (вкладка слева) и снова запустите шаг 3. Затем нажмите «Отправить в магазин».
                </p>
                <PayloadTable payload={mappedPayload} />
             </div>
          )}

          {missingFields.length > 0 && (
             <div className="mt-4 border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
               <h4 className="text-red-700 dark:text-red-400 font-bold mb-3 flex items-center gap-2">
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                 Требует Внимания (Обязательные атрибуты)
               </h4>
               <p className="text-xs text-red-600 dark:text-red-400 mb-4">
                  Нейросеть не смогла заполнить эти поля. Заполните их вручную из живого словаря МП.
               </p>
               <div className="flex flex-col gap-4">
                 {missingFields.map((field: any, idx: number) => (
                  <div key={idx}>
                    <LiveDictionaryField
                      field={field}
                      connectionId={selectedConnection}
                      categoryId={targetCategoryId}
                      onChange={(val: any) => setMappedPayload((prev: any) => ({...prev, [field.name]: val}))}
                    />
                    {field?.reason ? (
                      <div className="text-xs text-red-700 dark:text-red-300 mt-1">{String(field.reason)}</div>
                    ) : null}
                  </div>
                ))}
              </div>
             </div>
          )}

          {reviewRequiredFields.length > 0 && (
             <div className="mt-4 border border-blue-300 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
               <h4 className="text-blue-700 dark:text-blue-300 font-bold mb-3">
                 Проверка менеджером (обязательные поля категории)
               </h4>
               <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                  Сверьте значения ниже. Пустые поля заполните вручную или выберите из справочника.
               </p>
               <div className="flex flex-col gap-4">
                 {reviewRequiredFields.map((field: any, idx: number) => (
                   <LiveDictionaryField
                     key={`review_${idx}`}
                     field={field}
                     connectionId={selectedConnection}
                     categoryId={targetCategoryId}
                     onChange={(val: any) => setMappedPayload((prev: any) => ({...prev, [field.name]: val}))}
                   />
                 ))}
               </div>
             </div>
          )}

          {reviewAllFields.length > 0 && (
             <div className="mt-4 border border-slate-300 bg-slate-50 dark:bg-slate-900/20 p-4 rounded-lg">
               <h4 className="text-slate-700 dark:text-slate-300 font-bold mb-3">
                 Полный список атрибутов категории (обязательные и необязательные)
               </h4>
               <p className="text-xs text-slate-700 dark:text-slate-300 mb-3">
                  Заполнено: {reviewAllFields.filter((x: any) => !x?.missing).length} / {reviewAllFields.length}
               </p>
               <div className="flex flex-col gap-4 max-h-[420px] overflow-y-auto pr-1">
                 {reviewAllFields.map((field: any, idx: number) => (
                   <LiveDictionaryField
                     key={`review_all_${idx}`}
                     field={field}
                     connectionId={selectedConnection}
                     categoryId={targetCategoryId}
                     onChange={(val: any) => setMappedPayload((prev: any) => ({...prev, [field.name]: val}))}
                   />
                 ))}
               </div>
             </div>
          )}

          {qualityWarnings.length > 0 && (
             <div className="mt-4 border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg">
               <h4 className="text-amber-700 dark:text-amber-300 font-bold mb-2">
                 Критичные проверки перед массовой выгрузкой
               </h4>
               <div className="text-sm text-amber-800 dark:text-amber-200 flex flex-col gap-1">
                 {qualityWarnings.map((w: any, i: number) => (
                   <div key={`qw_${i}`}>- {String(w?.field || '')}: {String(w?.message || '')}</div>
                 ))}
               </div>
             </div>
          )}
          
          <div className="mt-4 flex flex-col">
            <div className="flex justify-between items-center mb-2 px-2">
              <h4 className="font-semibold text-sm text-gray-600 dark:text-gray-400">Журнал шагов выгрузки</h4>
              <div className="flex items-center gap-3">
                <button onClick={() => setSyndicateOutput('-> Готов к запуску AI агентов...')} className="text-xs text-blue-500 hover:underline">Очистить лог</button>
                <button onClick={clearSyndicateDraft} className="text-xs text-red-500 hover:underline">Сбросить шаги выгрузки</button>
              </div>
            </div>
            <textarea 
               readOnly
               value={syndicateOutput}
               className="w-full bg-black text-green-400 p-4 rounded font-mono text-sm h-[300px] overflow-y-auto resize-none"
            />
          </div>
        </div>
      )}

      {activeTab === 'promo' && (
        <PromoStudio product={product} setProduct={setProduct} />
      )}
    </div>
  );
}
