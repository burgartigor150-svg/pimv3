import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { marketplaceLabel } from '../lib/marketplaceUi';

const MP_COLORS: Record<string, string> = {
  ozon: '#005bff',
  megamarket: '#00b33c',
  wildberries: '#cb11ab',
  yandex: '#fc0',
  wb: '#cb11ab',
  pim: '#6366f1',
};

function mpColor(type: string) {
  return MP_COLORS[type] || '#6366f1';
}

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ---- Global search results component ----
function GlobalSearch({ query, inputStyle }: { query: string; inputStyle: React.CSSProperties }) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const debouncedQuery = useDebounce(query, 300);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string, p: number, append: boolean) => {
    if (!q.trim()) { setResults([]); setTotal(0); setHasMore(false); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await api.get('/attributes/search', {
        params: { q, page: p, limit: 50 },
        signal: ctrl.signal,
      });
      const d = res.data;
      setResults(prev => append ? [...prev, ...d.results] : d.results);
      setTotal(d.total);
      setHasMore(d.has_more);
    } catch (e: any) {
      if (e?.name !== 'CanceledError' && e?.code !== 'ERR_CANCELED') console.error(e);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    doSearch(debouncedQuery, 1, false);
  }, [debouncedQuery, doSearch]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    doSearch(debouncedQuery, next, true);
  };

  if (!query.trim()) return null;

  return (
    <div style={{ background: '#0f0f1a', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
          {loading && results.length === 0 ? 'Поиск...' : `${total} результатов по всем маркетплейсам`}
        </span>
        {loading && <div style={{
          width: 14, height: 14,
          border: '2px solid rgba(99,102,241,0.3)',
          borderTopColor: '#6366f1',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />}
      </div>
      {results.length > 0 && (
        <table className="table-premium" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th style={{ width: 100 }}>Платформа</th>
              <th>ID</th>
              <th>Название</th>
              <th>Тип</th>
              <th>Обязательно</th>
              <th>Категория</th>
            </tr>
          </thead>
          <tbody>
            {results.map((attr: any, i: number) => (
              <tr key={`${attr.platform}-${attr.id}-${i}`}>
                <td style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>{i + 1}</td>
                <td>
                  <span style={{
                    background: `${mpColor(attr.platform)}18`,
                    color: mpColor(attr.platform),
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 600,
                  }}>
                    {attr.platform === 'pim' ? 'PIM' : marketplaceLabel(attr.platform)}
                  </span>
                </td>
                <td>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: mpColor(attr.platform) }}>
                    {attr.code || attr.id}
                  </span>
                </td>
                <td style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>{attr.name}</td>
                <td>
                  <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                    {attr.type || '\u2014'}
                  </span>
                </td>
                <td>
                  {attr.is_required ? (
                    <span className="badge badge-error">Да</span>
                  ) : (
                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>Нет</span>
                  )}
                </td>
                <td style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                  {attr.category_name || '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {results.length === 0 && !loading && (
        <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>
          Ничего не найдено
        </p>
      )}
      {hasMore && (
        <div style={{ padding: '12px 16px', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={loadMore}
            disabled={loading}
            style={{
              background: 'rgba(99,102,241,0.1)',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 8,
              padding: '8px 24px',
              color: '#6366f1',
              fontSize: 13,
              cursor: loading ? 'wait' : 'pointer',
              fontWeight: 500,
            }}
          >
            {loading ? 'Загрузка...' : `Показать ещё (${results.length} из ${total})`}
          </button>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ---- Main page ----
export default function AttributesPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [loading, setLoading] = useState(false);
  const [mpData, setMpData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('common');
  const [tabSearch, setTabSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');

  useEffect(() => {
    api.get('/categories').then(r => setCategories(r.data));
  }, []);

  const fetchAttributes = async (catId: string) => {
    if (!catId) return;
    setLoading(true);
    setMpData(null);
    setActiveTab('common');
    try {
      const res = await api.get(`/categories/${catId}/marketplace-attributes`);
      setMpData(res.data);
      const mps = Object.keys(res.data.marketplaces || {});
      if ((res.data.common_count || 0) === 0 && mps.length > 0) {
        setActiveTab(mps[0]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (catId: string) => {
    setSelectedCatId(catId);
    setTabSearch('');
    setGlobalSearch('');
    fetchAttributes(catId);
  };

  const tabs = useMemo(() => {
    if (!mpData) return [];
    const t: { key: string; label: string; count: number; color: string }[] = [];
    const commonCount = mpData.common_count || 0;
    if (commonCount > 0) {
      t.push({ key: 'common', label: 'Общие', count: commonCount, color: '#6366f1' });
    }
    for (const [mp, data] of Object.entries(mpData.marketplaces || {} as Record<string, any>)) {
      t.push({
        key: mp,
        label: marketplaceLabel(mp),
        count: (data as any).total || 0,
        color: mpColor(mp),
      });
    }
    return t;
  }, [mpData]);

  const currentAttrs = useMemo(() => {
    if (!mpData) return [];
    if (activeTab === 'common') {
      return (mpData.common_attributes || []).map((ca: any) => ({
        id: ca.normalized,
        name: ca.name,
        type: (Object.values(ca.marketplaces || {}) as any[])[0]?.type || '',
        is_required: ca.is_required_any,
        _common: true,
        _variants: ca.marketplaces,
      }));
    }
    const mp = mpData.marketplaces?.[activeTab];
    if (!mp) return [];
    return mp.attributes || [];
  }, [mpData, activeTab]);

  const filteredAttrs = useMemo(() => {
    if (!tabSearch.trim()) return currentAttrs;
    const q = tabSearch.trim().toLowerCase();
    return currentAttrs.filter((a: any) =>
      (a.name || '').toLowerCase().includes(q) ||
      String(a.id || '').toLowerCase().includes(q)
    );
  }, [currentAttrs, tabSearch]);

  const selectedCat = categories.find((c: any) => c.id === selectedCatId);

  const selectStyle: React.CSSProperties = {
    background: '#0f0f1a',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: '10px 14px',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    outline: 'none',
    cursor: 'pointer',
    minWidth: 280,
  };

  const inputStyle: React.CSSProperties = {
    background: '#0f0f1a',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: '8px 14px',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    outline: 'none',
  };

  const isGlobalMode = globalSearch.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', marginBottom: 4 }}>
          Схема атрибутов
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', maxWidth: 620, lineHeight: 1.5 }}>
          Атрибуты стягиваются со всех маркетплейсов. Выберите категорию или ищите атрибуты глобально.
        </p>
      </div>

      {/* Global search bar */}
      <div style={{
        background: '#0f0f1a',
        border: isGlobalMode ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        transition: 'border-color 0.2s',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          style={{ ...inputStyle, flex: 1, maxWidth: 'none', border: 'none', padding: '4px 0', background: 'transparent' }}
          placeholder="Глобальный поиск атрибутов по всем маркетплейсам..."
          value={globalSearch}
          onChange={e => setGlobalSearch(e.target.value)}
        />
        {globalSearch && (
          <button
            onClick={() => setGlobalSearch('')}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
          >
            &times;
          </button>
        )}
      </div>

      {/* Global search results */}
      {isGlobalMode && <GlobalSearch query={globalSearch} inputStyle={inputStyle} />}

      {/* Category mode (hidden when global search active) */}
      {!isGlobalMode && (
        <>
          {/* Category selector */}
          <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>Категория:</span>
            <select
              style={selectStyle}
              value={selectedCatId}
              onChange={e => handleCategoryChange(e.target.value)}
            >
              <option value="">— Выберите категорию —</option>
              {categories.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {selectedCat && (
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
                ID: {selectedCat.id}
              </span>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{
                display: 'inline-block', width: 32, height: 32,
                border: '3px solid rgba(99,102,241,0.3)',
                borderTopColor: '#6366f1',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 12 }}>
                Загружаем атрибуты со всех маркетплейсов...
              </p>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* No category selected */}
          {!selectedCatId && !loading && (
            <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '64px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Выберите категорию</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>
                Атрибуты загрузятся автоматически со всех подключённых маркетплейсов
              </p>
            </div>
          )}

          {/* Category results */}
          {mpData && !loading && (
            <>
              {/* Stats cards */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {Object.entries(mpData.marketplaces || {}).map(([mp, data]: [string, any]) => (
                  <div key={mp} style={{
                    background: '#0f0f1a',
                    border: `1px solid ${mpColor(mp)}33`,
                    borderRadius: 12,
                    padding: '12px 18px',
                    flex: '1 1 180px',
                    minWidth: 180,
                  }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                      {marketplaceLabel(mp)}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: mpColor(mp) }}>
                      {data.total}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
                      {`атрибутов \u00B7 ${data.category_name || mpData.mp_categories?.[mp] || '\u2014'}`}
                    </div>
                  </div>
                ))}
                {(mpData.common_count || 0) > 0 && (
                  <div style={{
                    background: '#0f0f1a',
                    border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: 12,
                    padding: '12px 18px',
                    flex: '1 1 180px',
                    minWidth: 180,
                  }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Общие (ИИ)
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#6366f1' }}>
                      {mpData.common_count}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
                      сопоставлены ИИ
                    </div>
                  </div>
                )}
              </div>

              {/* Errors */}
              {Object.keys(mpData.errors || {}).length > 0 && (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
                  {Object.entries(mpData.errors).map(([mp, err]: [string, any]) => (
                    <div key={mp}><strong>{marketplaceLabel(mp)}:</strong> {err}</div>
                  ))}
                </div>
              )}

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', overflowX: 'auto' }}>
                {tabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => { setActiveTab(tab.key); setTabSearch(''); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
                      padding: '12px 20px',
                      cursor: 'pointer',
                      color: activeTab === tab.key ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
                      fontSize: 14,
                      fontWeight: activeTab === tab.key ? 600 : 400,
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{
                      display: 'inline-block',
                      width: 8, height: 8, borderRadius: '50%',
                      background: tab.color,
                      marginRight: 8,
                      opacity: activeTab === tab.key ? 1 : 0.4,
                    }} />
                    {tab.label}
                    <span style={{
                      marginLeft: 8,
                      background: activeTab === tab.key ? `${tab.color}22` : 'rgba(255,255,255,0.05)',
                      color: activeTab === tab.key ? tab.color : 'rgba(255,255,255,0.3)',
                      padding: '2px 8px',
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 600,
                    }}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Tab filter search */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <input
                  style={{ ...inputStyle, flex: 1, maxWidth: 360 }}
                  placeholder="Фильтр атрибутов в текущей вкладке..."
                  value={tabSearch}
                  onChange={e => setTabSearch(e.target.value)}
                />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
                  {filteredAttrs.length} из {currentAttrs.length}
                </span>
              </div>

              {/* Attributes table */}
              <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, overflow: 'hidden' }}>
                {filteredAttrs.length === 0 ? (
                  <p style={{ textAlign: 'center', padding: '48px 0', fontSize: 14, color: 'rgba(255,255,255,0.25)' }}>
                    {currentAttrs.length === 0
                      ? 'Нет атрибутов для этой вкладки'
                      : 'Ничего не найдено по запросу'}
                  </p>
                ) : (
                  <table className="table-premium" style={{ minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>#</th>
                        <th>ID</th>
                        <th>Название</th>
                        <th>Тип</th>
                        <th>Обязательно</th>
                        {activeTab === 'common' && <th>Маркетплейсы</th>}
                        {activeTab !== 'common' && <th>Словарь</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAttrs.map((attr: any, i: number) => (
                        <tr key={attr.id || i}>
                          <td style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>{i + 1}</td>
                          <td>
                            <span style={{ fontFamily: 'monospace', fontSize: 11, color: mpColor(activeTab === 'common' ? '' : activeTab) }}>
                              {attr.id}
                            </span>
                          </td>
                          <td style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
                            {attr.name}
                          </td>
                          <td>
                            <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                              {attr.type || '\u2014'}
                            </span>
                          </td>
                          <td>
                            {attr.is_required ? (
                              <span className="badge badge-error">Да</span>
                            ) : (
                              <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>Нет</span>
                            )}
                          </td>
                          {activeTab === 'common' && (
                            <td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {Object.entries(attr._variants || {}).map(([mp]: [string, any]) => (
                                  <span key={mp} style={{
                                    background: `${mpColor(mp)}18`,
                                    color: mpColor(mp),
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    fontSize: 10,
                                    fontWeight: 600,
                                  }}>
                                    {marketplaceLabel(mp)}
                                  </span>
                                ))}
                              </div>
                            </td>
                          )}
                          {activeTab !== 'common' && (
                            <td>
                              {(attr.dictionary_options && attr.dictionary_options.length > 0) ? (
                                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                                  {attr.dictionary_options.length} значений
                                </span>
                              ) : (
                                <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11 }}>{'\u2014'}</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* No marketplace data hint */}
              {Object.keys(mpData.marketplaces || {}).length === 0 && (
                <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 12, padding: '16px 20px', fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
                  <strong>Нет данных о маркетплейсных категориях.</strong><br />
                  Чтобы атрибуты подтянулись, товары в этой категории должны быть синдицированы хотя бы на один маркетплейс
                  (поле <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 4 }}>_platforms</code> в attributes_data).
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
