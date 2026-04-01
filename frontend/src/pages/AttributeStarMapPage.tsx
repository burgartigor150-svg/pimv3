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
    <div className="space-y-0.5">
      {nodes.map((n, idx) => {
        const children = Array.isArray(n.children) ? n.children : [];
        if (children.length > 0) {
          return (
            <details key={`${n.name}-${idx}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }} className="px-2 py-1">
              <summary className="cursor-pointer text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>{n.name}</summary>
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
            className="w-full text-left text-xs px-2 py-1.5 rounded transition-colors"
            style={{ color: 'rgba(255,255,255,0.55)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.12)', e.currentTarget.style.color = 'rgba(255,255,255,0.9)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = 'rgba(255,255,255,0.55)')}
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

  const card: React.CSSProperties = {
    background: '#0f0f1a',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: '20px 24px',
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 12,
  };

  const inputStyle: React.CSSProperties = {
    background: '#141422',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '9px 12px',
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    outline: 'none',
    width: '100%',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
  };

  return (
    <div style={{ background: '#03030a', minHeight: '100vh', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }} className="animate-fade-up">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/syndication" style={{ color: 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.9)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.95)', margin: 0 }}>
            Star Map атрибутов
            <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 400, color: 'rgba(99,102,241,0.9)', background: 'rgba(99,102,241,0.12)', padding: '2px 10px', borderRadius: 20 }}>Ozon → MM</span>
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
            Агент строит карту сам. Здесь оператор может вручную протянуть вектор, если связь ошибочная.
          </p>
        </div>
      </div>

      {/* Build card */}
      <div style={card}>
        <p style={sectionTitle}>Конфигурация сборки</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 12, alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ozon подключение</span>
            <select style={selectStyle} value={ozonConnId} onChange={(e) => setOzonConnId(e.target.value)}>
              {ozonConns.map((c) => <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Megamarket подключение</span>
            <select style={selectStyle} value={mmConnId} onChange={(e) => setMmConnId(e.target.value)}>
              {mmConns.map((c) => <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>)}
            </select>
          </label>
          <button onClick={handleBuild} disabled={isBuilding} className="btn-glow" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', opacity: isBuilding ? 0.6 : 1, cursor: isBuilding ? 'not-allowed' : 'pointer' }}>
            {isBuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isBuilding ? 'Строим...' : 'Перестроить карту'}
          </button>
          <button onClick={loadState} disabled={isLoadingState} className="btn-ghost-premium" style={{ padding: '9px 18px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap', opacity: isLoadingState ? 0.5 : 1 }}>
            Обновить
          </button>
        </div>

        {stateData?.stats && (
          <div style={{ marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[
              { label: 'Ozon атрибутов', value: stateData.stats.ozon_attributes, color: '#6366f1' },
              { label: 'MM атрибутов', value: stateData.stats.megamarket_attributes, color: '#a855f7' },
              { label: 'Auto edges', value: stateData.stats.edges_total, color: '#22d3ee' },
              { label: 'Manual', value: stateData.stats.manual_overrides_total, color: '#10b981' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {!!buildTaskId && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'rgba(99,102,241,0.8)' }}>
              Task: <b style={{ color: '#818cf8' }}>{buildTaskId}</b> | status: <b style={{ color: '#818cf8' }}>{buildStatus || 'queued'}</b> | stage: <b style={{ color: '#818cf8' }}>{buildStage || '-'}</b>
            </div>
            <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{ height: 6, background: 'linear-gradient(90deg,#6366f1,#a855f7)', borderRadius: 3, transition: 'width 0.3s', width: `${Math.max(2, Math.min(100, buildProgress || 0))}%` }} />
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
              {buildMessage || 'Сборка выполняется...'} ({buildProgress}%)
            </div>
          </div>
        )}
      </div>

      {/* Category trees */}
      <div style={card}>
        <p style={sectionTitle}>Деревья категорий и связи</p>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>
          Выберите категорию Ozon и категорию MM — система покажет связи между их атрибутами.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6366f1', marginBottom: 8 }}>Ozon категории</p>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px', background: '#141422' }}>
              <CategoryTree
                nodes={ozonTree}
                onSelect={(node) => {
                  setSelectedOzonCategoryId(String(node.category_id || ''));
                  setSelectedOzonCategoryPath(String(node.full_path || node.name || ''));
                }}
              />
            </div>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>Выбрано: {selectedOzonCategoryPath || '—'}</p>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#a855f7', marginBottom: 8 }}>Megamarket категории</p>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px', background: '#141422' }}>
              <CategoryTree
                nodes={mmTree}
                onSelect={(node) => {
                  setSelectedMmCategoryId(String(node.category_id || ''));
                  setSelectedMmCategoryPath(String(node.full_path || node.name || ''));
                }}
              />
            </div>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>Выбрано: {selectedMmCategoryPath || '—'}</p>
          </div>
        </div>

        {isLoadingCategoryData && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 12 }}>Загрузка связей выбранных категорий...</p>}

        {!!selectedOzonCategoryId && !!selectedMmCategoryId && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
            {[
              { title: `Атрибуты Ozon (${selectedOzonCategoryAttrs.length})`, color: '#6366f1', items: selectedOzonCategoryAttrs.slice(0, 400).map((a: any) => a?.name || '-') },
              { title: `Связи (${selectedCategoryLinks.length})`, color: '#22d3ee', items: selectedCategoryLinks.slice(0, 500).map((e: any) => `${e?.from_name || '-'} → ${e?.to_name || '-'} [${e?.manual_override ? 'manual' : 'auto'}]`) },
              { title: `Атрибуты MM (${selectedMmCategoryAttrs.length})`, color: '#a855f7', items: selectedMmCategoryAttrs.slice(0, 400).map((a: any) => a?.name || '-') },
            ].map((col) => (
              <div key={col.title} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, background: '#141422', maxHeight: 288, overflowY: 'auto' }}>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12, fontWeight: 600, color: col.color }}>{col.title}</div>
                {col.items.map((item, idx) => (
                  <div key={idx} style={{ padding: '6px 12px', fontSize: 12, color: 'rgba(255,255,255,0.55)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{item}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drag-and-drop */}
      <div style={card}>
        <p style={sectionTitle}>Drag-and-drop векторов</p>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>
          Перетащите атрибут из колонки Ozon на атрибут в колонке MM. Это создаст manual override для агента.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Ozon column */}
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                style={inputStyle}
                placeholder="Фильтр Ozon атрибутов"
                value={ozonNodeQ}
                onChange={(e) => setOzonNodeQ(e.target.value)}
              />
              <button className="btn-ghost-premium" style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }} onClick={() => loadNodeLists(ozonNodeQ, mmNodeQ)}>Найти</button>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 8, background: '#141422', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ozonNodes.map((n, idx) => {
                const m = n?.metadata || {};
                return (
                  <div
                    key={`oz-${idx}-${m.attribute_id || ''}`}
                    draggable
                    onDragStart={(e) => onDragStartOzon(e, n)}
                    style={{ cursor: 'grab', borderRadius: 6, border: '1px solid rgba(99,102,241,0.25)', padding: '8px 10px', background: 'rgba(99,102,241,0.06)', transition: 'all 0.15s' }}
                    title="Перетащите на MM атрибут справа"
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)', e.currentTarget.style.background = 'rgba(99,102,241,0.12)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)', e.currentTarget.style.background = 'rgba(99,102,241,0.06)')}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>{m.name || '-'}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>cat: {m.category_id || '-'} | attr: {m.attribute_id || '-'}</div>
                  </div>
                );
              })}
              {ozonNodes.length === 0 && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', padding: 8 }}>Нет узлов Ozon по фильтру.</p>}
            </div>
          </div>

          {/* MM column */}
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                style={inputStyle}
                placeholder="Фильтр MM атрибутов"
                value={mmNodeQ}
                onChange={(e) => setMmNodeQ(e.target.value)}
              />
              <button className="btn-ghost-premium" style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }} onClick={() => loadNodeLists(ozonNodeQ, mmNodeQ)}>Найти</button>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 8, background: '#141422', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {mmNodes.map((n, idx) => {
                const m = n?.metadata || {};
                return (
                  <div
                    key={`mm-${idx}-${m.attribute_id || ''}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDropToMm(e, n)}
                    style={{ borderRadius: 6, border: '1px solid rgba(168,85,247,0.25)', padding: '8px 10px', background: 'rgba(168,85,247,0.06)', transition: 'all 0.15s' }}
                    title="Бросьте сюда Ozon атрибут"
                    onDragEnter={e => (e.currentTarget.style.borderColor = 'rgba(168,85,247,0.7)', e.currentTarget.style.background = 'rgba(168,85,247,0.18)')}
                    onDragLeave={e => (e.currentTarget.style.borderColor = 'rgba(168,85,247,0.25)', e.currentTarget.style.background = 'rgba(168,85,247,0.06)')}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>{m.name || '-'}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>cat: {m.category_id || '-'} | attr: {m.attribute_id || '-'}</div>
                  </div>
                );
              })}
              {mmNodes.length === 0 && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', padding: 8 }}>Нет узлов MM по фильтру.</p>}
            </div>
          </div>
        </div>
        {isLoadingNodes && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 10 }}>Загрузка узлов...</p>}
      </div>

      {/* Manual vector form */}
      <div style={card}>
        <p style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link2 className="w-4 h-4" style={{ color: '#6366f1' } as any} />
          Протянуть вектор вручную
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 12 }}>
          <input style={inputStyle} placeholder="Ozon атрибут (from)" value={fromName} onChange={(e) => setFromName(e.target.value)} />
          <input style={inputStyle} placeholder="MM атрибут (to)" value={toName} onChange={(e) => setToName(e.target.value)} />
          <input style={inputStyle} placeholder="from category id (опц.)" value={fromCategoryId} onChange={(e) => setFromCategoryId(e.target.value)} />
          <input style={inputStyle} placeholder="to category id (опц.)" value={toCategoryId} onChange={(e) => setToCategoryId(e.target.value)} />
          <input style={inputStyle} placeholder="score 0..1" value={score} onChange={(e) => setScore(e.target.value)} />
        </div>
        <button onClick={handleCreateOverride} disabled={isSavingOverride} className="btn-glow" style={{ padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, opacity: isSavingOverride ? 0.6 : 1, cursor: isSavingOverride ? 'not-allowed' : 'pointer' }}>
          {isSavingOverride ? 'Сохраняем...' : 'Протянуть вектор'}
        </button>
      </div>

      {/* Visual graph */}
      <div style={card}>
        <p style={sectionTitle}>Визуальный граф ручных векторов</p>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>
          Слева Ozon, справа MM. Каждая линия — ручная связь, которую агент использует в приоритете.
        </p>
        <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, background: '#141422', padding: 12, overflowX: 'auto' }}>
          {graphOverrides.length === 0 ? (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>Нет ручных связей для отображения.</p>
          ) : (
            <div style={{ position: 'relative', minWidth: 900 }}>
              <svg width="100%" height={Math.max(graphFromNodes.length, graphToNodes.length) * 44 + 40} style={{ position: 'absolute', inset: 0 }}>
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
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={selected ? '#10b981' : '#6366f1'}
                        strokeOpacity={selected ? '0.95' : '0.55'}
                        strokeWidth={selected ? '3.5' : '2'}
                        className="cursor-pointer"
                        onClick={() => handleSelectGraphEdge(e)}
                      />
                      <circle cx={x1} cy={y1} r={selected ? '5' : '3.5'} fill={selected ? '#10b981' : '#6366f1'} />
                      <circle cx={x2} cy={y2} r={selected ? '5' : '3.5'} fill={selected ? '#10b981' : '#a855f7'} />
                    </g>
                  );
                })}
              </svg>
              <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 280px', gap: 40, position: 'relative' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6366f1', marginBottom: 0 }}>Ozon</h3>
                  {graphFromNodes.map((n, i) => (
                    <div key={`from-${n}-${i}`} style={{ height: 32, borderRadius: 6, border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.07)', padding: '0 10px', fontSize: 12, display: 'flex', alignItems: 'center', color: 'rgba(255,255,255,0.75)' }}>
                      {n}
                    </div>
                  ))}
                </div>
                <div />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a855f7', marginBottom: 0 }}>Megamarket</h3>
                  {graphToNodes.map((n, i) => (
                    <div key={`to-${n}-${i}`} style={{ height: 32, borderRadius: 6, border: '1px solid rgba(168,85,247,0.25)', background: 'rgba(168,85,247,0.07)', padding: '0 10px', fontSize: 12, display: 'flex', alignItems: 'center', color: 'rgba(255,255,255,0.75)' }}>
                      {n}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {selectedGraphEdge && (
          <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 8, border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.07)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#10b981', margin: 0 }}>Выбрана связь</p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
              <b style={{ color: '#6366f1' }}>{selectedGraphEdge.from_name}</b>
              <span style={{ margin: '0 8px', color: 'rgba(255,255,255,0.25)' }}>→</span>
              <b style={{ color: '#a855f7' }}>{selectedGraphEdge.to_name}</b>
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                style={{ ...inputStyle, width: 140 }}
                value={selectedGraphScore}
                onChange={(e) => setSelectedGraphScore(e.target.value)}
                placeholder="score 0..1"
              />
              <button onClick={handleUpdateGraphEdgeScore} disabled={isUpdatingGraphEdge} style={{ padding: '8px 16px', borderRadius: 8, background: '#10b981', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: isUpdatingGraphEdge ? 'not-allowed' : 'pointer', opacity: isUpdatingGraphEdge ? 0.6 : 1 }}>
                {isUpdatingGraphEdge ? 'Сохраняем...' : 'Обновить score'}
              </button>
              <button onClick={() => handleDeleteOverride(String(selectedGraphEdge.id || ''))} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.35)', background: 'transparent', color: 'rgba(239,68,68,0.8)', fontSize: 13, cursor: 'pointer' }}>
                Удалить связь
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div style={card}>
        <p style={sectionTitle}>Поиск по карте</p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <input style={inputStyle} placeholder="Например: Инвертор, Цвет, Объем..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
          <button onClick={handleSearch} disabled={isSearching} className="btn-glow" style={{ padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', opacity: isSearching ? 0.6 : 1 }}>
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Поиск
          </button>
        </div>
        {Array.isArray(searchRes?.edge_hits) && searchRes.edge_hits.length > 0 && (
          <div style={{ maxHeight: 288, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
            <table className="table-premium" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#141422' }}>
                  {['From (Ozon)', 'To (MM)', 'Score', 'Type'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {searchRes.edge_hits.map((h: any, idx: number) => {
                  const m = h?.metadata || {};
                  return (
                    <tr key={`${idx}-${m?.from_name || ''}-${m?.to_name || ''}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: '#818cf8' }}>{m?.from_name || '-'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: '#c084fc' }}>{m?.to_name || '-'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>{m?.score ?? h?.score ?? '-'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span className={`badge ${h?.manual_override ? 'badge-purple' : 'badge-cyan'}`} style={{ fontSize: 11 }}>{h?.manual_override ? 'manual' : 'auto'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual overrides list */}
      <div style={card}>
        <p style={sectionTitle}>Ручные векторы</p>
        <div style={{ maxHeight: 288, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
          <table className="table-premium" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#141422' }}>
                {['From (Ozon)', 'To (MM)', 'Score', 'Action'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.isArray(stateData?.manual_overrides) && stateData.manual_overrides.length > 0 ? (
                stateData.manual_overrides.map((m: any) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: '#818cf8' }}>{m.from_name}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: '#c084fc' }}>{m.to_name}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>{m.score}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <button onClick={() => handleDeleteOverride(m.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(239,68,68,0.7)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'rgba(239,68,68,1)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.7)')}
                      >
                        <Trash2 className="w-4 h-4" /> Удалить
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td style={{ padding: '16px 12px', fontSize: 13, color: 'rgba(255,255,255,0.25)' }} colSpan={4}>Ручных векторов пока нет.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
