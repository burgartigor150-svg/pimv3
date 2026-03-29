import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { connectionOptionLabel } from '../lib/marketplaceUi';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newProduct, setNewProduct] = useState({ sku: '', name: '' });
  const [showImport, setShowImport] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkQueries, setBulkQueries] = useState('');
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [bulkResults, setBulkResults] = useState<any>(null);
  const [bulkTaskId, setBulkTaskId] = useState<string | null>(() => localStorage.getItem('pim_bulk_task_id'));
  const [bulkProgress, setBulkProgress] = useState<any>(null);
  const [connections, setConnections] = useState([]);
  const [importConn, setImportConn] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importQuery, setImportQuery] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchProducts();
    fetchConnections();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (bulkTaskId) {
      interval = setInterval(async () => {
        try {
          const res = await api.get(`/import/tasks/${bulkTaskId}`);
          setBulkProgress(res.data);
          if (res.data.status === 'completed' || res.data.status === 'failed') {
            clearInterval(interval);
            setIsBulkImporting(false);
            setBulkTaskId(null);
            localStorage.removeItem('pim_bulk_task_id');
            fetchProducts();
            if (res.data.status === 'completed') {
              alert(`Загрузка завершена! Успешно: ${res.data.success}, Ошибок: ${res.data.failed}`);
            } else {
              alert(`Сбой фоновой задачи: ${res.data.error}`);
            }
          }
        } catch (e: any) {
          console.error(e);
          if (e.response?.status === 404) {
             clearInterval(interval);
             setIsBulkImporting(false);
             setBulkTaskId(null);
             localStorage.removeItem('pim_bulk_task_id');
             alert('Задача была сброшена, так как кластер воркеров перезапускался. Пожалуйста, запустите массовый импорт еще раз.');
          }
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [bulkTaskId]);

  const fetchProducts = async () => {
    const res = await api.get('/products');
    setProducts(res.data);
  };

  const fetchConnections = async () => {
    const res = await api.get('/connections');
    setConnections(res.data);
    if (res.data.length > 0) setImportConn(res.data[0].id);
  };

  const handleImport = async (e: any) => {
    e.preventDefault();
    setIsImporting(true);
    try {
      const res = await api.post('/import/product', { connection_id: importConn, query: importQuery });
      setShowImport(false);
      navigate(`/products/${res.data.id}`);
    } catch(err: any) {
      alert("Ошибка импорта: " + (err.response?.data?.detail || err.message));
    } finally {
      setIsImporting(false);
    }
  };

  const handleBulkImport = async (e: any) => {
    e.preventDefault();
    setIsBulkImporting(true);
    setBulkResults(null);
    try {
      const queriesList = bulkQueries.split(/[\n,]+/).map(q => q.trim()).filter(q => q);
      const res = await api.post('/import/bulk', { connection_id: importConn, queries: queriesList });
      setBulkTaskId(res.data.task_id);
      localStorage.setItem('pim_bulk_task_id', res.data.task_id);
      setShowBulkImport(false);
      setBulkQueries('');
      // Polling effect handles resetting state and fetching
    } catch(err: any) {
      alert("Ошибка массового импорта: " + (err.response?.data?.detail || err.message));
      setIsBulkImporting(false);
    }
  };

  const handleCreate = async (e: any) => {
    e.preventDefault();
    const res = await api.post('/products', newProduct);
    navigate(`/products/${res.data.id}`);
  };

  const handleBulkGenerate = async () => {
    if (!window.confirm(`Запустить автогенерацию контента для ${selectedIds.length} товаров?`)) return;
    try {
      const res = await api.post('/ai/generate-bulk', { product_ids: selectedIds });
      setBulkTaskId(res.data.task_id);
      localStorage.setItem('pim_bulk_task_id', res.data.task_id);
      setSelectedIds([]);
    } catch (err: any) {
      alert("Ошибка автогенерации: " + (err.response?.data?.detail || err.message));
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Удалить карточку навсегда? Это действие необратимо.')) {
      try {
        await api.delete(`/products/${id}`);
        fetchProducts();
      } catch (err: any) {
        alert("Ошибка: " + err.message);
      }
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {bulkTaskId && bulkProgress && (
        <div className="fixed bottom-6 right-6 bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-2xl border border-blue-200 dark:border-slate-700 w-96 z-50 animate-in slide-in-from-bottom-5">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-bold text-slate-800 dark:text-white flex gap-2 items-center">
              <svg className="w-5 h-5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              {bulkProgress.type === 'ai-generation' ? 'Автогенерация Контента' : 'AI Массовый Импорт'}
            </h4>
            <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{bulkProgress.processed} / {bulkProgress.total}</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 dark:bg-slate-700 overflow-hidden shadow-inner">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 h-3 rounded-full transition-all duration-500 ease-out" style={{ width: `${Math.max(5, (bulkProgress.processed / bulkProgress.total) * 100)}%` }}></div>
          </div>
          <div className="mt-3 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="truncate max-w-[200px]" title={bulkProgress.current_sku}>SKU: {bulkProgress.current_sku || 'Ожидание...'}</span>
            <span className="text-green-600 dark:text-green-400 font-medium">Успешно: {bulkProgress.success}</span>
          </div>
        </div>
      )}
      
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Каталог товаров</h2>
      <p className="text-gray-600 dark:text-gray-400 max-w-3xl">
        Это ваши «золотые» карточки: одна строка = один артикул в базе. Импорт с маркетплейса подтягивает данные; несколько подключённых магазинов помогают ИИ собрать максимально полное описание. Чтобы выгрузить много позиций сразу — отметьте галочками строки и нажмите кнопку ниже.
      </p>
      
      <div className="flex flex-col xl:flex-row justify-between xl:items-end gap-4 bg-white dark:bg-slate-800 p-4 rounded shadow">
        <form onSubmit={handleCreate} className="flex flex-wrap gap-4 items-end">
          {selectedIds.length > 0 ? (
            <div className="flex gap-2">
               <button 
                 type="button"
                 onClick={() => navigate('/syndication?ids=' + selectedIds.join(','))}
                 className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-4 py-2 rounded font-medium shadow-md transition"
               >
                 Выгрузить на МП ({selectedIds.length})
               </button>
            </div>
          ) : null}
          <label className="flex flex-col">
            <span className="text-sm font-medium">Артикул (SKU)</span>
            <input required className="border rounded p-2 text-black dark:text-white dark:bg-slate-700" value={newProduct.sku} onChange={e => setNewProduct({...newProduct, sku: e.target.value})} placeholder="Уникальный ручной SKU" />
          </label>
          <label className="flex flex-col">
            <span className="text-sm font-medium">Название товара</span>
            <input required className="border rounded p-2 text-black dark:text-white dark:bg-slate-700" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} placeholder="Ручное создание" />
          </label>
          <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Создать Пустую Базу</button>
        </form>
        
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowBulkImport(true)} className="bg-emerald-600 font-semibold text-white px-4 py-3 rounded-lg shadow-lg hover:bg-emerald-700 transition flex gap-2 items-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            Массовый Импорт
          </button>
          <button onClick={() => setShowImport(true)} className="bg-indigo-600 font-semibold text-white px-4 py-3 rounded-lg shadow-lg hover:bg-indigo-700 transition flex gap-2 items-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            Импорт 1 товара
          </button>
        </div>
      </div>
      
      {showImport && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleImport} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6 w-full max-w-lg">
            <h2 className="text-2xl font-bold mb-4">Умный Импорт (Zero-Setup)</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">Система скачает 100% данных исходной карточки, включая медиа-галерею, и положит в PIM.</p>
            
            <label className="flex flex-col mb-4">
              <span className="text-sm font-medium mb-1">Выберите магазин-донор</span>
              <select className="border rounded p-2 text-black dark:text-white dark:bg-slate-700" value={importConn} onChange={e => setImportConn(e.target.value)} required>
                {connections.map((c: any) => <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>)}
              </select>
            </label>
            
            <label className="flex flex-col mb-6">
              <span className="text-sm font-medium mb-1">Артикул / Штрихкод / Название</span>
              <input required className="border rounded p-2 text-black dark:text-white dark:bg-slate-700" value={importQuery} onChange={e => setImportQuery(e.target.value)} placeholder="Введите артикул Ozon или WB..." autoFocus />
            </label>
            
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowImport(false)} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 rounded">Отмена</button>
              <button type="submit" disabled={isImporting} className="px-4 py-2 bg-indigo-600 text-white rounded font-medium disabled:opacity-50">
                 {isImporting ? 'Загрузка...' : 'Найти и Импортировать'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showBulkImport && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleBulkImport} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6 w-full max-w-lg">
            <h2 className="text-2xl font-bold mb-4">Массовый Импорт (Bulk)</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">Вставьте список артикулов через запятую или с новой строки. Система скачает их все по очереди.</p>
            
            <label className="flex flex-col mb-4">
              <span className="text-sm font-medium mb-1">Выберите магазин-донор</span>
              <select className="border rounded p-2 text-black dark:text-white dark:bg-slate-700" value={importConn} onChange={e => setImportConn(e.target.value)} required>
                {connections.map((c: any) => <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>)}
              </select>
            </label>
            
            <label className="flex flex-col mb-4">
              <span className="text-sm font-medium mb-1">Список Артикулов (SKU)</span>
              <textarea required className="border rounded p-2 text-black dark:text-white dark:bg-slate-700" rows={5} value={bulkQueries} onChange={e => setBulkQueries(e.target.value)} placeholder="SKU-1&#10;SKU-2&#10;SKU-3" autoFocus />
            </label>
            
            {bulkResults && (
              <div className="mb-4 bg-slate-50 dark:bg-slate-900 p-3 rounded border text-sm">
                <p className="text-green-600 font-bold">Успешно загружено: {bulkResults.success.length}</p>
                <p className="text-yellow-600 font-bold">Пропущено (дубликаты): {bulkResults.skipped.length}</p>
                <p className="text-red-500 font-bold">Ошибки / не найдено: {bulkResults.failed.length}</p>
              </div>
            )}
            
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => {setShowBulkImport(false); setBulkResults(null);}} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 rounded">Закрыть</button>
              <button type="submit" disabled={isBulkImporting} className="px-4 py-2 bg-emerald-600 text-white rounded font-medium disabled:opacity-50">
                 {isBulkImporting ? 'Идет загрузка батча...' : 'Начать Массовый Импорт'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded shadow">
        <div className="flex items-center gap-3">
            <span className="font-medium text-sm text-slate-600 dark:text-slate-300">Каталог:</span>
            <select 
              className="border rounded p-2 text-sm dark:bg-slate-700 min-w-[250px]" 
              value={selectedCategory} 
              onChange={e => setSelectedCategory(e.target.value)}
            >
                <option value="">Все папки</option>
                {Array.from(new Map(products.filter((p: any) => p.category).map((p: any) => [p.category.id, p.category])).values()).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
        </div>
        <div className="text-sm text-slate-500">
           Всего товаров: {products.length}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-100 dark:bg-slate-900">
            <tr>
              <th className="p-4 border-b w-10">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={products.length > 0 && selectedIds.length === products.length}
                  onChange={(e) => setSelectedIds(e.target.checked ? products.map((p: any) => p.id) : [])}
                />
              </th>
              <th className="p-4 border-b">SKU</th>
              <th className="p-4 border-b">Название</th>
              <th className="p-4 border-b">Категория</th>
              <th className="p-4 border-b">Заполненность базы</th>
              <th className="p-4 border-b">Действия</th>
            </tr>
          </thead>
          <tbody>
            {(selectedCategory ? products.filter((p: any) => p.category?.id === selectedCategory) : products).map((p: any) => (
              <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                <td className="p-4 border-b">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    checked={selectedIds.includes(p.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds([...selectedIds, p.id]);
                      else setSelectedIds(selectedIds.filter(id => id !== p.id));
                    }}
                  />
                </td>
                <td className="p-4 border-b">{p.sku}</td>
                <td className="p-4 border-b">{p.name}</td>
                <td className="p-4 border-b">
                  <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded dark:bg-blue-900 dark:text-blue-300 font-medium">
                    {p.category ? p.category.name : '—'}
                  </span>
                </td>
                <td className="p-4 border-b">
                  <div className="w-full bg-slate-200 rounded-full h-2.5 dark:bg-slate-700">
                    <div className={`h-2.5 rounded-full ${p.completeness_score === 100 ? 'bg-green-500' : p.completeness_score > 50 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${p.completeness_score}%` }}></div>
                  </div>
                  <span className="text-xs">{p.completeness_score}%</span>
                </td>
                <td className="p-4 border-b flex items-center gap-4">
                  <button onClick={() => navigate(`/products/${p.id}`)} className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">Карточка и выгрузка</button>
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 bg-red-50 dark:bg-red-900/30 px-3 py-1 rounded text-sm font-semibold">Удалить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
