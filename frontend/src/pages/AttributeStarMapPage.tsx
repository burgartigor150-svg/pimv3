import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw, Search, Link2, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { connectionOptionLabel } from '../lib/marketplaceUi';

type Conn = { id: string; type: string; name: string };
type NodeHit = { metadata?: any; score?: number };
type CatTreeNode = { name: string; category_id?: string; full_path?: string; children?: CatTreeNode[] };

export default function AttributeStarMapPage() {
  const [connections, setConnections] = useState<Conn[]>([]);
  const [ozonConnId, setOzonConnId] = useState('');
  const [mmConnId, setMmConnId] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildTaskId, setBuildTaskId] = useState('');
  const [buildStatus, setBuildStatus] = useState('');
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildStage, setBuildStage] = useState('');
  const [buildMessage, setBuildMessage] = useState('');
  const [isLoadingState, setIsLoadingState] = useState(false);
  const [stateData, setStateData] = useState<any>(null);
  const [q, setQ] = useState('');
  const [searchRes, setSearchRes] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [fromName, setFromName] = useState('');
  const [toName, setToName] = useState('');
  const [fromCategoryId, setFromCategoryId] = useState('');
  const [toCategoryId, setToCategoryId] = useState('');
  const [score, setScore] = useState('1');
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  const [ozonNodeQ, setOzonNodeQ] = useState('');
  const [mmNodeQ, setMmNodeQ] = useState('');
  const [ozonNodes, setOzonNodes] = useState<NodeHit[]>([]);
  const [mmNodes, setMmNodes] = useState<NodeHit[]>([]);
  const [isLoadingNodes, setIsLoadingNodes] = useState(false);
  const [ozonTree, setOzonTree] = useState<CatTreeNode[]>([]);
  const [mmTree, setMmTree] = useState<CatTreeNode[]>([]);
  const [selectedOzonCategoryId, setSelectedOzonCategoryId] = useState('');
  const [selectedMmCategoryId, setSelectedMmCategoryId] = useState('');
  const [selectedOzonCategoryPath, setSelectedOzonCategoryPath] = useState('');
  const [selectedMmCategoryPath, setSelectedMmCategoryPath] = useState('');
  const [selectedCategoryLinks, setSelectedCategoryLinks] = useState<any[]>([]);
  const [selectedOzonCategoryAttrs, setSelectedOzonCategoryAttrs] = useState<any[]>([]);
  const [selectedMmCategoryAttrs, setSelectedMmCategoryAttrs] = useState<any[]>([]);
  const [isLoadingCategoryData, setIsLoadingCategoryData] = useState(false);
  const [selectedGraphEdgeId, setSelectedGraphEdgeId] = useState<string>('');
  const [selectedGraphEdge, setSelectedGraphEdge] = useState<any>(null);
  const [selectedGraphScore, setSelectedGraphScore] = useState('1');
  const [isUpdatingGraphEdge, setIsUpdatingGraphEdge] = useState(false);

  const ozonConns = useMemo(() => connections.filter((c) => c.type === 'ozon'), [connections]);
  const mmConns = useMemo(() => connections.filter((c) => c.type === 'megamarket'), [connections]);
  const graphOverrides = useMemo(() => {
    const all = Array.isArray(stateData?.manual_overrides) ? stateData.manual_overrides : [];
    const filtered = q.trim()
      ? all.filter((x: any) => String(x?.from_name || '').toLowerCase().includes(q.toLowerCase()) || String(x?.to_name || '').toLowerCase().includes(q.toLowerCase()))
      : all;
    return filtered.slice(0, 60);
  }, [stateData, q]);

  const graphFromNodes = useMemo<string[]>(
    () => Array.from(new Set<string>(graphOverrides.map((x: any) => String(x?.from_name || '').trim()).filter(Boolean))),
    [graphOverrides]
  );
  const graphToNodes = useMemo<string[]>(
    () => Array.from(new Set<string>(graphOverrides.map((x: any) => String(x?.to_name || '').trim()).filter(Boolean))),
    [graphOverrides]
  );

  const loadState = async () => {
    setIsLoadingState(true);
    try {
      const res = await api.get('/attribute-star-map/state', { params: { edge_limit: 200 } });
      setStateData(res.data);
    } finally {
      setIsLoadingState(false);
    }
  };

  useEffect(() => {
    api.get('/connections').then((res) => {
      const conns = res.data || [];
      setConnections(conns);
      const oz = conns.find((c: Conn) => c.type === 'ozon');
      const mm = conns.find((c: Conn) => c.type === 'megamarket');
      if (oz) setOzonConnId(oz.id);
      if (mm) setMmConnId(mm.id);
    });
    loadState();
  }, []);

  useEffect(() => {
    const loadTrees = async () => {
      try {
        const [oz, mm] = await Promise.all([
          api.get('/attribute-star-map/categories', { params: { platform: 'ozon' } }),
          api.get('/attribute-star-map/categories', { params: { platform: 'megamarket' } }),
        ]);
        setOzonTree(oz.data?.tree || []);
        setMmTree(mm.data?.tree || []);
      } catch (e: any) {
        alert('Ошибка загрузки деревьев категорий: ' + (e.response?.data?.detail || e.message));
      }
    };
    loadTrees();
  }, []);

  const loadNodeLists = async (leftQ?: string, rightQ?: string) => {
    setIsLoadingNodes(true);
    try {
      const [left, right] = await Promise.all([
        api.get('/attribute-star-map/nodes', { params: { q: (leftQ ?? ozonNodeQ).trim(), platform: 'ozon', limit: 40 } }),
        api.get('/attribute-star-map/nodes', { params: { q: (rightQ ?? mmNodeQ).trim(), platform: 'megamarket', limit: 40 } }),
      ]);
      setOzonNodes(left.data?.hits || []);
      setMmNodes(right.data?.hits || []);
    } catch (e: any) {
      alert('Ошибка загрузки узлов карты: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsLoadingNodes(false);
    }
  };

  useEffect(() => {
    loadNodeLists('', '');
  }, []);

  const handleBuild = async () => {
    if (!ozonConnId || !mmConnId) {
      alert('Выберите подключения Ozon и Megamarket');
      return;
    }
    setIsBuilding(true);
    try {
      const res = await api.post('/attribute-star-map/build', {
        ozon_connection_id: ozonConnId,
        megamarket_connection_id: mmConnId,
        edge_threshold: 0.58,
      });
      const tid = String(res.data?.task_id || '');
      setBuildTaskId(tid);
      setBuildStatus(String(res.data?.status || 'queued'));
      setBuildProgress(0);
      setBuildStage(String(res.data?.stage || 'queued'));
      setBuildMessage(String(res.data?.message || 'Задача поставлена в очередь'));
      alert('Сборка карты запущена в фоне. Страница будет обновлена после завершения.');
    } catch (e: any) {
      alert('Ошибка сборки карты: ' + (e.response?.data?.detail || e.message));
      setIsBuilding(false);
    }
  };

  useEffect(() => {
    if (!buildTaskId) return;
    const timer = setInterval(async () => {
      try {
        const st = await api.get('/attribute-star-map/build/status', { params: { task_id: buildTaskId } });
        const status = String(st.data?.status || '');
        setBuildStatus(status);
        setBuildProgress(Number(st.data?.progress_percent || 0));
        setBuildStage(String(st.data?.stage || ''));
        setBuildMessage(String(st.data?.message || ''));
        if (status === 'completed') {
          clearInterval(timer);
          setIsBuilding(false);
          await loadState();
          const [oz, mm] = await Promise.all([
            api.get('/attribute-star-map/categories', { params: { platform: 'ozon' } }),
            api.get('/attribute-star-map/categories', { params: { platform: 'megamarket' } }),
          ]);
          setOzonTree(oz.data?.tree || []);
          setMmTree(mm.data?.tree || []);
          alert('Карта успешно собрана.');
        } else if (status === 'failed') {
          clearInterval(timer);
          setIsBuilding(false);
          alert('Сборка карты завершилась с ошибкой: ' + String(st.data?.error || 'unknown error'));
        }
      } catch (e) {
        // keep polling transient errors
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [buildTaskId]);

  const handleSearch = async () => {
    if (!q.trim()) return;
    setIsSearching(true);
    try {
      const res = await api.get('/attribute-star-map/search', { params: { q: q.trim(), limit: 25 } });
      setSearchRes(res.data);
    } catch (e: any) {
      alert('Ошибка поиска: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateOverride = async () => {
    if (!fromName.trim() || !toName.trim()) {
      alert('Заполните Ozon атрибут и MM атрибут');
      return;
    }
    setIsSavingOverride(true);
    try {
      await createOverride({
        from_name: fromName.trim(),
        to_name: toName.trim(),
        from_category_id: fromCategoryId.trim() || null,
        to_category_id: toCategoryId.trim() || null,
        score: Number(score || '1'),
      });
      setFromName('');
      setToName('');
      setFromCategoryId('');
      setToCategoryId('');
      setScore('1');
      await loadState();
      if (q.trim()) await handleSearch();
    } catch (e: any) {
      alert('Ошибка сохранения вектора: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsSavingOverride(false);
    }
  };

  const handleDeleteOverride = async (overrideId: string) => {
    if (!overrideId) return;
    try {
      await api.post('/attribute-star-map/manual-vector/delete', null, { params: { override_id: overrideId } });
      await loadState();
      if (q.trim()) await handleSearch();
    } catch (e: any) {
      alert('Ошибка удаления: ' + (e.response?.data?.detail || e.message));
    }
  };

  const createOverride = async (payload: {
    from_name: string;
    to_name: string;
    from_category_id?: string | null;
    to_category_id?: string | null;
    from_attribute_id?: string | null;
    to_attribute_id?: string | null;
    score?: number;
  }) => {
    await api.post('/attribute-star-map/manual-vector', payload);
    await loadState();
    if (q.trim()) await handleSearch();
  };

  const onDragStartOzon = (e: React.DragEvent, node: NodeHit) => {
    const m = node?.metadata || {};
    const payload = {
      from_name: String(m.name || ''),
      from_category_id: String(m.category_id || ''),
      from_attribute_id: String(m.attribute_id || ''),
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onDropToMm = async (e: React.DragEvent, mmNode: NodeHit) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    try {
      const drag = JSON.parse(raw);
      const mm = mmNode?.metadata || {};
      if (!drag?.from_name || !mm?.name) return;
      await createOverride({
        from_name: String(drag.from_name),
        to_name: String(mm.name),
        from_category_id: String(drag.from_category_id || ''),
        to_category_id: String(mm.category_id || ''),
        from_attribute_id: String(drag.from_attribute_id || ''),
        to_attribute_id: String(mm.attribute_id || ''),
        score: 1.0,
      });
      alert('Вектор протянут: связь сохранена в manual overrides.');
    } catch (err: any) {
      alert('Не удалось создать связь: ' + (err?.message || 'ошибка drag-and-drop'));
    }
  };

  const loadSelectedCategoriesData = async (ozCatId: string, mmCatId: string) => {
    if (!ozCatId || !mmCatId) return;
    setIsLoadingCategoryData(true);
    try {
      const [links, ozAttrs, mmAttrs] = await Promise.all([
        api.get('/attribute-star-map/category/links', { params: { ozon_category_id: ozCatId, megamarket_category_id: mmCatId, limit: 1000 } }),
        api.get('/attribute-star-map/category/attributes', { params: { platform: 'ozon', category_id: ozCatId, limit: 2000 } }),
        api.get('/attribute-star-map/category/attributes', { params: { platform: 'megamarket', category_id: mmCatId, limit: 2000 } }),
      ]);
      setSelectedCategoryLinks(links.data?.edges || []);
      setSelectedOzonCategoryAttrs(ozAttrs.data?.attributes || []);
      setSelectedMmCategoryAttrs(mmAttrs.data?.attributes || []);
    } catch (e: any) {
      alert('Ошибка загрузки данных выбранных категорий: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsLoadingCategoryData(false);
    }
  };

  useEffect(() => {
    if (selectedOzonCategoryId && selectedMmCategoryId) {
      loadSelectedCategoriesData(selectedOzonCategoryId, selectedMmCategoryId);
    }
  }, [selectedOzonCategoryId, selectedMmCategoryId]);

  const CategoryTree = ({
    nodes,
    onSelect,
  }: {
    nodes: CatTreeNode[];
    onSelect: (node: CatTreeNode) => void;
  }) => (
    <div className="space-y-1">
      {nodes.map((n, idx) => {
        const children = Array.isArray(n.children) ? n.children : [];
        if (children.length > 0) {
          return (
            <details key={`${n.name}-${idx}`} className="border rounded dark:border-slate-700 px-2 py-1">
              <summary className="cursor-pointer text-sm">{n.name}</summary>
              <div className="pl-3 mt-1">
                <CategoryTree nodes={children} onSelect={onSelect} />
              </div>
            </details>
          );
        }
        return (
          <button
            key={`${n.name}-${idx}`}
            onClick={() => onSelect(n)}
            className="w-full text-left text-xs px-2 py-1 rounded hover:bg-indigo-50 dark:hover:bg-slate-700"
            title={n.full_path || n.name}
          >
            {n.name}
          </button>
        );
      })}
    </div>
  );

  const handleSelectGraphEdge = (edge: any) => {
    setSelectedGraphEdge(edge);
    setSelectedGraphEdgeId(String(edge?.id || ''));
    const sc = Number(edge?.score ?? 1);
    setSelectedGraphScore(Number.isFinite(sc) ? String(sc) : '1');
  };

  const handleUpdateGraphEdgeScore = async () => {
    if (!selectedGraphEdge) return;
    setIsUpdatingGraphEdge(true);
    try {
      await createOverride({
        from_name: String(selectedGraphEdge.from_name || ''),
        to_name: String(selectedGraphEdge.to_name || ''),
        from_category_id: String(selectedGraphEdge.from_category_id || ''),
        to_category_id: String(selectedGraphEdge.to_category_id || ''),
        from_attribute_id: String(selectedGraphEdge.from_attribute_id || ''),
        to_attribute_id: String(selectedGraphEdge.to_attribute_id || ''),
        score: Number(selectedGraphScore || '1'),
      });
      alert('Score связи обновлён.');
    } catch (e: any) {
      alert('Ошибка обновления score: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsUpdatingGraphEdge(false);
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-4">
        <Link to="/syndication" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Star Map атрибутов (Ozon - MM)</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Агент строит карту сам. Здесь оператор может вручную протянуть вектор, если связь ошибочная.
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <label className="flex flex-col">
            <span className="text-xs font-medium mb-1">Ozon подключение</span>
            <select className="border rounded-lg p-2.5 dark:bg-slate-700" value={ozonConnId} onChange={(e) => setOzonConnId(e.target.value)}>
              {ozonConns.map((c) => <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="text-xs font-medium mb-1">Megamarket подключение</span>
            <select className="border rounded-lg p-2.5 dark:bg-slate-700" value={mmConnId} onChange={(e) => setMmConnId(e.target.value)}>
              {mmConns.map((c) => <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button onClick={handleBuild} disabled={isBuilding} className="bg-indigo-600 text-white px-4 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
              {isBuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {isBuilding ? 'Строим...' : 'Перестроить карту'}
            </button>
            <button onClick={loadState} disabled={isLoadingState} className="border px-4 py-2.5 rounded-lg dark:border-slate-600">
              Обновить
            </button>
          </div>
        </div>

        <div className="text-sm text-slate-600 dark:text-slate-300">
          {stateData?.stats ? (
            <span>
              Ozon атрибутов: <b>{stateData.stats.ozon_attributes}</b> | MM атрибутов: <b>{stateData.stats.megamarket_attributes}</b> | Auto edges: <b>{stateData.stats.edges_total}</b> | Manual: <b>{stateData.stats.manual_overrides_total}</b>
            </span>
          ) : 'Статистика карты пока недоступна'}
        </div>
        {!!buildTaskId && (
          <div className="space-y-1">
            <div className="text-xs text-indigo-700 dark:text-indigo-300">
              Build task: <b>{buildTaskId}</b> | status: <b>{buildStatus || 'queued'}</b> | stage: <b>{buildStage || '-'}</b>
            </div>
            <div className="w-full h-2 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className="h-2 bg-indigo-600 transition-all duration-300" style={{ width: `${Math.max(2, Math.min(100, buildProgress || 0))}%` }} />
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-300">
              {buildMessage || 'Сборка выполняется...'} ({buildProgress}%)
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Деревья категорий и связи</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Выберите категорию Ozon и категорию MM — система покажет связи между их атрибутами.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ozon категории</p>
            <div className="max-h-80 overflow-auto border rounded-lg dark:border-slate-700 p-2">
              <CategoryTree
                nodes={ozonTree}
                onSelect={(node) => {
                  setSelectedOzonCategoryId(String(node.category_id || ''));
                  setSelectedOzonCategoryPath(String(node.full_path || node.name || ''));
                }}
              />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">Выбрано: {selectedOzonCategoryPath || '-'}</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Megamarket категории</p>
            <div className="max-h-80 overflow-auto border rounded-lg dark:border-slate-700 p-2">
              <CategoryTree
                nodes={mmTree}
                onSelect={(node) => {
                  setSelectedMmCategoryId(String(node.category_id || ''));
                  setSelectedMmCategoryPath(String(node.full_path || node.name || ''));
                }}
              />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">Выбрано: {selectedMmCategoryPath || '-'}</p>
          </div>
        </div>

        {isLoadingCategoryData && <p className="text-xs text-slate-500">Загрузка связей выбранных категорий...</p>}
        {!!selectedOzonCategoryId && !!selectedMmCategoryId && (
          <div className="grid md:grid-cols-3 gap-3">
            <div className="border rounded-lg dark:border-slate-700 p-2 max-h-72 overflow-auto">
              <p className="text-xs font-semibold mb-2">Атрибуты Ozon ({selectedOzonCategoryAttrs.length})</p>
              {selectedOzonCategoryAttrs.slice(0, 400).map((a: any, idx: number) => (
                <div key={`oz-attr-${idx}-${a?.attribute_id || ''}`} className="text-xs py-1 border-b last:border-b-0 dark:border-slate-700">
                  {a?.name || '-'}
                </div>
              ))}
            </div>
            <div className="border rounded-lg dark:border-slate-700 p-2 max-h-72 overflow-auto">
              <p className="text-xs font-semibold mb-2">Связи ({selectedCategoryLinks.length})</p>
              {selectedCategoryLinks.slice(0, 500).map((e: any, idx: number) => (
                <div key={`cat-link-${idx}-${e?.id || ''}`} className="text-xs py-1 border-b last:border-b-0 dark:border-slate-700">
                  {String(e?.from_name || '-')} {'→'} {String(e?.to_name || '-')} [{e?.manual_override ? 'manual' : 'auto'}]
                </div>
              ))}
            </div>
            <div className="border rounded-lg dark:border-slate-700 p-2 max-h-72 overflow-auto">
              <p className="text-xs font-semibold mb-2">Атрибуты MM ({selectedMmCategoryAttrs.length})</p>
              {selectedMmCategoryAttrs.slice(0, 400).map((a: any, idx: number) => (
                <div key={`mm-attr-${idx}-${a?.attribute_id || ''}`} className="text-xs py-1 border-b last:border-b-0 dark:border-slate-700">
                  {a?.name || '-'}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Drag-and-drop векторов</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Перетащите атрибут из колонки Ozon на атрибут в колонке MM. Это создаст manual override для агента.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                className="border rounded-lg p-2.5 flex-1 dark:bg-slate-700"
                placeholder="Фильтр Ozon атрибутов"
                value={ozonNodeQ}
                onChange={(e) => setOzonNodeQ(e.target.value)}
              />
              <button className="border rounded-lg px-3 dark:border-slate-600" onClick={() => loadNodeLists(ozonNodeQ, mmNodeQ)}>Найти</button>
            </div>
            <div className="max-h-80 overflow-auto border rounded-lg dark:border-slate-700 p-2 space-y-2">
              {ozonNodes.map((n, idx) => {
                const m = n?.metadata || {};
                return (
                  <div
                    key={`oz-${idx}-${m.attribute_id || ''}`}
                    draggable
                    onDragStart={(e) => onDragStartOzon(e, n)}
                    className="cursor-grab active:cursor-grabbing rounded border dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-900/40"
                    title="Перетащите на MM атрибут справа"
                  >
                    <div className="font-medium text-sm">{m.name || '-'}</div>
                    <div className="text-[11px] text-slate-500">cat: {m.category_id || '-'} | attr: {m.attribute_id || '-'}</div>
                  </div>
                );
              })}
              {ozonNodes.length === 0 && <p className="text-xs text-slate-500">Нет узлов Ozon по фильтру.</p>}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                className="border rounded-lg p-2.5 flex-1 dark:bg-slate-700"
                placeholder="Фильтр MM атрибутов"
                value={mmNodeQ}
                onChange={(e) => setMmNodeQ(e.target.value)}
              />
              <button className="border rounded-lg px-3 dark:border-slate-600" onClick={() => loadNodeLists(ozonNodeQ, mmNodeQ)}>Найти</button>
            </div>
            <div className="max-h-80 overflow-auto border rounded-lg dark:border-slate-700 p-2 space-y-2">
              {mmNodes.map((n, idx) => {
                const m = n?.metadata || {};
                return (
                  <div
                    key={`mm-${idx}-${m.attribute_id || ''}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDropToMm(e, n)}
                    className="rounded border dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-900/40"
                    title="Бросьте сюда Ozon атрибут"
                  >
                    <div className="font-medium text-sm">{m.name || '-'}</div>
                    <div className="text-[11px] text-slate-500">cat: {m.category_id || '-'} | attr: {m.attribute_id || '-'}</div>
                  </div>
                );
              })}
              {mmNodes.length === 0 && <p className="text-xs text-slate-500">Нет узлов MM по фильтру.</p>}
            </div>
          </div>
        </div>
        {isLoadingNodes && <p className="text-xs text-slate-500">Загрузка узлов...</p>}
      </div>

      <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Link2 className="w-4 h-4" /> Протянуть вектор вручную</h2>
        <div className="grid md:grid-cols-5 gap-3">
          <input className="border rounded-lg p-2.5 dark:bg-slate-700" placeholder="Ozon атрибут (from)" value={fromName} onChange={(e) => setFromName(e.target.value)} />
          <input className="border rounded-lg p-2.5 dark:bg-slate-700" placeholder="MM атрибут (to)" value={toName} onChange={(e) => setToName(e.target.value)} />
          <input className="border rounded-lg p-2.5 dark:bg-slate-700" placeholder="from category id (опц.)" value={fromCategoryId} onChange={(e) => setFromCategoryId(e.target.value)} />
          <input className="border rounded-lg p-2.5 dark:bg-slate-700" placeholder="to category id (опц.)" value={toCategoryId} onChange={(e) => setToCategoryId(e.target.value)} />
          <input className="border rounded-lg p-2.5 dark:bg-slate-700" placeholder="score 0..1" value={score} onChange={(e) => setScore(e.target.value)} />
        </div>
        <button onClick={handleCreateOverride} disabled={isSavingOverride} className="bg-violet-600 text-white px-4 py-2.5 rounded-lg hover:bg-violet-700 disabled:opacity-50">
          {isSavingOverride ? 'Сохраняем...' : 'Протянуть вектор'}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Визуальный граф ручных векторов</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Слева Ozon, справа MM. Каждая линия — ручная связь, которую агент использует в приоритете.
        </p>
        <div className="border rounded-lg dark:border-slate-700 p-3 overflow-auto">
          {graphOverrides.length === 0 ? (
            <p className="text-xs text-slate-500">Нет ручных связей для отображения.</p>
          ) : (
            <div className="relative min-w-[900px]">
              <svg width="100%" height={Math.max(graphFromNodes.length, graphToNodes.length) * 44 + 40} className="absolute inset-0">
                {graphOverrides.map((e: any, idx: number) => {
                  const fromIdx = graphFromNodes.indexOf(String(e?.from_name || '').trim());
                  const toIdx = graphToNodes.indexOf(String(e?.to_name || '').trim());
                  if (fromIdx < 0 || toIdx < 0) return null;
                  const y1 = 30 + fromIdx * 44;
                  const y2 = 30 + toIdx * 44;
                  const x1 = 280;
                  const x2 = 620;
                  const selected = selectedGraphEdgeId && selectedGraphEdgeId === String(e?.id || '');
                  return (
                    <g key={`edge-svg-${idx}-${e?.id || ''}`}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={selected ? 'rgb(16 185 129)' : 'rgb(99 102 241)'}
                        strokeOpacity={selected ? '0.95' : '0.65'}
                        strokeWidth={selected ? '3.5' : '2'}
                        className="cursor-pointer"
                        onClick={() => handleSelectGraphEdge(e)}
                      />
                      <circle cx={x1} cy={y1} r={selected ? '4' : '3'} fill={selected ? 'rgb(16 185 129)' : 'rgb(99 102 241)'} />
                      <circle cx={x2} cy={y2} r={selected ? '4' : '3'} fill={selected ? 'rgb(16 185 129)' : 'rgb(99 102 241)'} />
                    </g>
                  );
                })}
              </svg>
              <div className="grid grid-cols-[280px_1fr_280px] gap-10 relative">
                <div className="space-y-3">
                  <h3 className="text-xs uppercase tracking-wide text-slate-500">Ozon</h3>
                  {graphFromNodes.map((n, i) => (
                    <div key={`from-${n}-${i}`} className="h-8 rounded border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-2 text-xs flex items-center">
                      {n}
                    </div>
                  ))}
                </div>
                <div />
                <div className="space-y-3">
                  <h3 className="text-xs uppercase tracking-wide text-slate-500">Megamarket</h3>
                  {graphToNodes.map((n, i) => (
                    <div key={`to-${n}-${i}`} className="h-8 rounded border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-2 text-xs flex items-center">
                      {n}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        {selectedGraphEdge && (
          <div className="mt-3 p-3 rounded-lg border dark:border-slate-700 bg-emerald-50/70 dark:bg-emerald-900/20 space-y-2">
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Выбрана связь</p>
            <p className="text-xs text-slate-700 dark:text-slate-300">
              <b>{selectedGraphEdge.from_name}</b> {'→'} <b>{selectedGraphEdge.to_name}</b>
            </p>
            <div className="flex items-center gap-2">
              <input
                className="border rounded-lg p-2 text-sm w-36 dark:bg-slate-700"
                value={selectedGraphScore}
                onChange={(e) => setSelectedGraphScore(e.target.value)}
                placeholder="score 0..1"
              />
              <button
                onClick={handleUpdateGraphEdgeScore}
                disabled={isUpdatingGraphEdge}
                className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
              >
                {isUpdatingGraphEdge ? 'Сохраняем...' : 'Обновить score'}
              </button>
              <button
                onClick={() => handleDeleteOverride(String(selectedGraphEdge.id || ''))}
                className="px-3 py-2 rounded-lg border text-sm text-red-600 dark:border-slate-600"
              >
                Удалить связь
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Поиск по карте</h2>
        <div className="flex gap-2">
          <input className="border rounded-lg p-2.5 flex-1 dark:bg-slate-700" placeholder="Например: Инвертор, Цвет, Объем..." value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={handleSearch} disabled={isSearching} className="bg-slate-800 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 disabled:opacity-50">
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Поиск
          </button>
        </div>
        {Array.isArray(searchRes?.edge_hits) && searchRes.edge_hits.length > 0 && (
          <div className="max-h-72 overflow-auto border rounded-lg dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className="text-left p-2">From (Ozon)</th>
                  <th className="text-left p-2">To (MM)</th>
                  <th className="text-left p-2">Score</th>
                  <th className="text-left p-2">Type</th>
                </tr>
              </thead>
              <tbody>
                {searchRes.edge_hits.map((h: any, idx: number) => {
                  const m = h?.metadata || {};
                  return (
                    <tr key={`${idx}-${m?.from_name || ''}-${m?.to_name || ''}`} className="border-t dark:border-slate-700">
                      <td className="p-2">{m?.from_name || '-'}</td>
                      <td className="p-2">{m?.to_name || '-'}</td>
                      <td className="p-2">{m?.score ?? h?.score ?? '-'}</td>
                      <td className="p-2">{h?.manual_override ? 'manual' : 'auto'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Ручные векторы</h2>
        <div className="max-h-72 overflow-auto border rounded-lg dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="text-left p-2">From (Ozon)</th>
                <th className="text-left p-2">To (MM)</th>
                <th className="text-left p-2">Score</th>
                <th className="text-left p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(stateData?.manual_overrides) && stateData.manual_overrides.length > 0 ? (
                stateData.manual_overrides.map((m: any) => (
                  <tr key={m.id} className="border-t dark:border-slate-700">
                    <td className="p-2">{m.from_name}</td>
                    <td className="p-2">{m.to_name}</td>
                    <td className="p-2">{m.score}</td>
                    <td className="p-2">
                      <button onClick={() => handleDeleteOverride(m.id)} className="text-red-600 hover:underline inline-flex items-center gap-1">
                        <Trash2 className="w-4 h-4" /> Удалить
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td className="p-2 text-slate-500" colSpan={4}>Ручных векторов пока нет.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

