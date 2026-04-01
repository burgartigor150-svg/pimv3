import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string | number;
  sku: string;
  name: string;
  category?: string;
  completeness?: number; // 0-100
  [key: string]: unknown;
}

interface BulkTask {
  task_id: string;
  status: string;
  progress?: number;
  total?: number;
  message?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CompletenessBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const color =
    pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor =
    pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1 bg-[#1e1e2c] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-medium tabular-nums ${textColor}`}>{pct}%</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProductsPage() {
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [newProduct, setNewProduct] = useState({ sku: '', name: '', category: '' });
  const [showImport, setShowImport] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [bulkQueries, setBulkQueries] = useState('');
  const [bulkTaskId, setBulkTaskId] = useState<string | null>(null);
  const [bulkTask, setBulkTask] = useState<BulkTask | null>(null);
  const [importSku, setImportSku] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch products ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetchProducts();
  }, []);

  async function fetchProducts() {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/products');
      const data = await res.json();
      const list: Product[] = Array.isArray(data) ? data : data.products ?? [];
      setProducts(list);
      const cats = Array.from(new Set(list.map((p) => p.category).filter(Boolean))) as string[];
      setCategories(cats);
    } catch (e) {
      console.error('Failed to fetch products', e);
    } finally {
      setIsLoading(false);
    }
  }

  // ── Bulk task polling ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!bulkTaskId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/import/tasks/${bulkTaskId}`);
        const task: BulkTask = await res.json();
        setBulkTask(task);
        if (task.status === 'completed' || task.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (task.status === 'completed') {
            fetchProducts();
          }
        }
      } catch (e) {
        console.error('Polling error', e);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [bulkTaskId]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!importSku.trim()) return;
    try {
      const res = await fetch('/api/v1/import/product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: importSku }),
      });
      const data = await res.json();
      console.log('Import result', data);
      setShowImport(false);
      setImportSku('');
      fetchProducts();
    } catch (e) {
      console.error('Import failed', e);
    }
  }

  async function handleBulkImport() {
    if (!bulkQueries.trim()) return;
    try {
      const queries = bulkQueries.split('\n').map((q) => q.trim()).filter(Boolean);
      const res = await fetch('/api/v1/import/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
      });
      const data = await res.json();
      console.log('Bulk import started', data);
      setBulkTaskId(data.task_id);
      setShowBulkImport(false);
    } catch (e) {
      console.error('Bulk import failed', e);
    }
  }

  async function handleBulkGenerate() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      const res = await fetch('/api/v1/ai/generate-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      console.log('Bulk generate started', data);
      setBulkTaskId(data.task_id);
    } catch (e) {
      console.error('Bulk generate failed', e);
    }
  }

  async function handleDelete(id: string | number) {
    try {
      await fetch(`/api/v1/products/${id}`, { method: 'DELETE' });
      setProducts((prev) => prev.filter((p) => p.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      console.error('Delete failed', e);
    }
  }

  async function handleCreate() {
    try {
      const res = await fetch('/api/v1/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProduct),
      });
      const data = await res.json();
      console.log('Created product', data);
      setShowCreate(false);
      setNewProduct({ sku: '', name: '', category: '' });
      fetchProducts();
    } catch (e) {
      console.error('Create failed', e);
    }
  }

  async function handleExportSelected() {
    const ids = Array.from(selectedIds);
    try {
      const res = await fetch('/api/v1/products/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'products.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const filtered = products.filter((p) => {
    const matchCat = !selectedCategory || p.category === selectedCategory;
    const matchSearch =
      !search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  function toggleAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.add(p.id));
        return next;
      });
    }
  }

  function toggleOne(id: string | number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const bulkProgress =
    bulkTask && bulkTask.total
      ? Math.round(((bulkTask.progress ?? 0) / bulkTask.total) * 100)
      : 0;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0d0d10] text-slate-100 pb-24">
      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="px-6 pt-8 pb-4">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-100">Каталог товаров</h1>
            <span className="text-xs font-medium bg-[#1c1c28] border border-[#1e1e2c] text-slate-400 px-2.5 py-0.5 rounded-full">
              {products.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
            >
              Импорт по SKU
            </button>
            <button
              onClick={() => setShowBulkImport(true)}
              className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
            >
              Массовый импорт
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
            >
              + Создать
            </button>
          </div>
        </div>

        {/* Search / filter bar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
              />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию или SKU..."
              className="w-full bg-[#0d0d10] border border-[#28283a] rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 outline-none transition-colors"
            />
          </div>
          {categories.length > 0 && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-300 focus:border-indigo-500 outline-none"
            >
              <option value="">Все категории</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="px-6">
        <div className="bg-[#13131a] border border-[#1e1e2c] rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2.5rem_1fr_2fr_1fr_140px_80px] bg-[#1c1c28] px-4 py-2.5 text-slate-500 text-xs uppercase tracking-wide font-medium">
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
              />
            </div>
            <div>SKU</div>
            <div>Название</div>
            <div>Категория</div>
            <div>Заполненность</div>
            <div></div>
          </div>

          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-600">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Загрузка...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-600">
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 3H8L6 7h12l-2-4z"
                />
              </svg>
              <div className="text-center">
                <p className="text-sm font-medium text-slate-500">Нет товаров</p>
                <p className="text-xs text-slate-700 mt-1">Импортируйте товары по SKU или создайте вручную</p>
              </div>
              <button
                onClick={() => setShowImport(true)}
                className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
              >
                Импортировать
              </button>
            </div>
          ) : (
            filtered.map((product) => (
              <div
                key={product.id}
                className="grid grid-cols-[2.5rem_1fr_2fr_1fr_140px_80px] px-4 py-3 items-center border-b border-[#1e1e2c] hover:bg-[#1c1c28] transition-colors group last:border-0"
              >
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(product.id)}
                    onChange={() => toggleOne(product.id)}
                    className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
                  />
                </div>
                <div className="font-mono text-xs text-slate-400 truncate pr-2">{product.sku}</div>
                <div className="text-sm text-slate-200 truncate pr-2">{product.name}</div>
                <div className="pr-2">
                  {product.category ? (
                    <span className="text-xs bg-[#1c1c28] border border-[#28283a] text-slate-400 px-2 py-0.5 rounded-full">
                      {product.category}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-700">—</span>
                  )}
                </div>
                <div>
                  <CompletenessBar value={product.completeness as number ?? 0} />
                </div>
                <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => navigate(`/products/${product.id}`)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all"
                    title="Открыть"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(product.id)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title="Удалить"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Bulk actions bar ───────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#13131a] border-t border-[#1e1e2c] p-4 z-40">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <span className="text-sm text-slate-400">
              Выбрано{' '}
              <span className="text-slate-100 font-semibold">{selectedIds.size}</span>{' '}
              {selectedIds.size === 1 ? 'товар' : selectedIds.size < 5 ? 'товара' : 'товаров'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-400 px-3 py-1.5 rounded-lg text-sm transition-all"
              >
                Снять выбор
              </button>
              <button
                onClick={handleExportSelected}
                className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
              >
                Выгрузить
              </button>
              <button
                onClick={handleBulkGenerate}
                className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
              >
                Генерация ИИ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk progress toast ────────────────────────────────────────────── */}
      {bulkTask && bulkTask.status !== 'completed' && bulkTask.status !== 'failed' && (
        <div className="fixed bottom-4 right-4 bg-[#13131a] border border-[#1e1e2c] rounded-xl p-4 shadow-xl w-80 z-50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium text-slate-200">
                {bulkTask.status === 'running' ? 'Обработка...' : bulkTask.status}
              </span>
            </div>
            <button
              onClick={() => setBulkTask(null)}
              className="text-slate-600 hover:text-slate-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {bulkTask.message && (
            <p className="text-xs text-slate-500 mb-2">{bulkTask.message}</p>
          )}
          <div className="h-1.5 bg-[#1e1e2c] rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${bulkProgress}%` }}
            />
          </div>
          {bulkTask.total ? (
            <p className="text-xs text-slate-600 mt-1.5 text-right">
              {bulkTask.progress ?? 0} / {bulkTask.total}
            </p>
          ) : null}
        </div>
      )}

      {bulkTask?.status === 'completed' && (
        <div className="fixed bottom-4 right-4 bg-[#13131a] border border-emerald-500/30 rounded-xl p-4 shadow-xl w-80 z-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm font-medium text-emerald-400">Готово</span>
            </div>
            <button
              onClick={() => setBulkTask(null)}
              className="text-slate-600 hover:text-slate-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Import by SKU modal ────────────────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#13131a] border border-[#1e1e2c] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-100">Импорт по SKU</h2>
              <button
                onClick={() => setShowImport(false)}
                className="text-slate-600 hover:text-slate-400 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Артикул (SKU)</label>
                <input
                  value={importSku}
                  onChange={(e) => setImportSku(e.target.value)}
                  placeholder="Введите SKU товара"
                  className="w-full bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-700 focus:border-indigo-500 outline-none transition-colors"
                  onKeyDown={(e) => e.key === 'Enter' && handleImport()}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowImport(false)}
                className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
              >
                Отмена
              </button>
              <button
                onClick={handleImport}
                disabled={!importSku.trim()}
                className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
              >
                Импортировать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk import modal ──────────────────────────────────────────────── */}
      {showBulkImport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#13131a] border border-[#1e1e2c] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-100">Массовый импорт</h2>
              <button
                onClick={() => setShowBulkImport(false)}
                className="text-slate-600 hover:text-slate-400 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">
                  Запросы — каждый с новой строки
                </label>
                <textarea
                  value={bulkQueries}
                  onChange={(e) => setBulkQueries(e.target.value)}
                  placeholder={'Iphone 15 Pro\nSamsung Galaxy S24\nAirPods Pro 2'}
                  rows={8}
                  className="w-full bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-700 focus:border-indigo-500 outline-none transition-colors resize-none font-mono"
                />
                <p className="text-xs text-slate-700 mt-1">
                  {bulkQueries.split('\n').filter(Boolean).length} запросов
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowBulkImport(false)}
                className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
              >
                Отмена
              </button>
              <button
                onClick={handleBulkImport}
                disabled={!bulkQueries.trim()}
                className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
              >
                Запустить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create product modal ───────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#13131a] border border-[#1e1e2c] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-100">Новый товар</h2>
              <button
                onClick={() => setShowCreate(false)}
                className="text-slate-600 hover:text-slate-400 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              {(['sku', 'name', 'category'] as const).map((field) => (
                <div key={field}>
                  <label className="block text-xs text-slate-500 mb-1.5 capitalize">
                    {field === 'sku' ? 'Артикул (SKU)' : field === 'name' ? 'Название' : 'Категория'}
                  </label>
                  <input
                    value={newProduct[field]}
                    onChange={(e) => setNewProduct((p) => ({ ...p, [field]: e.target.value }))}
                    placeholder={field === 'sku' ? 'SKU-001' : field === 'name' ? 'Название товара' : 'Электроника'}
                    className="w-full bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-700 focus:border-indigo-500 outline-none transition-colors"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
              >
                Отмена
              </button>
              <button
                onClick={handleCreate}
                disabled={!newProduct.sku.trim() || !newProduct.name.trim()}
                className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
