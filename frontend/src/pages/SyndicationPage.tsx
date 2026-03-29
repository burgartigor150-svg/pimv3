import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Sparkles, Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { connectionOptionLabel } from '../lib/marketplaceUi';

export default function SyndicationPage() {
  const [searchParams] = useSearchParams();
  const ids = searchParams.get('ids')?.split(',') || [];
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedConn, setSelectedConn] = useState('');
  const [taskId, setTaskId] = useState('');
  const [progress, setProgress] = useState<any>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isRepairStarting, setIsRepairStarting] = useState(false);
  const [scanLimit, setScanLimit] = useState('150');
  const selectedConnObj = connections.find((c: any) => c.id === selectedConn);
  const isMegamarketTarget = selectedConnObj?.type === 'megamarket';

  useEffect(() => {
    api.get('/connections').then(res => {
      setConnections(res.data);
      if (res.data.length > 0) setSelectedConn(res.data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!taskId) return;
    const interval = setInterval(() => {
      api.get(`/import/tasks/${taskId}`).then(res => {
        setProgress(res.data);
        if (res.data.status === 'completed' || res.data.status === 'failed') {
          clearInterval(interval);
        }
      }).catch(console.error);
    }, 2000);
    return () => clearInterval(interval);
  }, [taskId]);

  const handleStart = async () => {
    if (!selectedConn || ids.length === 0) return;
    setIsStarting(true);
    try {
      const res = await api.post('/syndicate/bulk', {
        connection_id: selectedConn,
        product_ids: ids
      });
      setTaskId(res.data.task_id);
    } catch (e: any) {
      alert('Ошибка запуска: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsStarting(false);
    }
  };

  const handleStartMegamarketRepair = async () => {
    if (!selectedConnObj || selectedConnObj.type !== 'megamarket') {
      alert('Выберите подключение Megamarket');
      return;
    }
    setIsRepairStarting(true);
    try {
      const n = parseInt(scanLimit.trim(), 10);
      const res = await api.post('/syndicate/mm/autofix-existing-errors', {
        connection_id: selectedConnObj.id,
        scan_limit: Number.isNaN(n) ? 150 : n,
      });
      setTaskId(res.data.task_id);
      alert(
        `Найдено ошибок в MM: ${res.data.mm_error_cards_found ?? 0}, ` +
        `сопоставлено локально: ${res.data.matched_local_products ?? 0}, ` +
        `в автоисправление поставлено: ${res.data.queued ?? 0}`
      );
    } catch (e: any) {
      alert('Ошибка запуска автоисправления: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsRepairStarting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-4">
         <Link to="/products" className="text-slate-500 hover:text-slate-800">
            <ArrowLeft className="w-6 h-6" />
         </Link>
         <div>
           <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Массовая выгрузка на маркетплейс</h1>
           <p className="text-slate-500 dark:text-slate-400 text-sm max-w-2xl">
             Сюда вы попадаете из каталога с отмеченными товарами. Для каждого SKU ИИ подберёт категорию и поля под выбранный магазин, затем запросы уйдут в фоне. Один запуск — одна цель (один подключённый магазин).
           </p>
         </div>
      </div>

      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        {!taskId && ids.length === 0 ? (
          <div className="max-w-2xl space-y-4">
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex gap-3">
              <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
              <div>
                <h3 className="font-bold text-amber-900 dark:text-amber-200 mb-1">Товары не выбраны</h3>
                <p className="text-sm text-amber-800 dark:text-amber-300/90">
                  Откройте <Link to="/products" className="underline font-medium">каталог</Link>, отметьте галочками нужные строки и нажмите «Синдицировать» — страница откроется уже со списком.
                </p>
              </div>
            </div>
            <div className="p-4 border rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900/40">
              <h3 className="font-bold text-indigo-900 dark:text-indigo-200 mb-2">Исправить ошибки в уже выгруженных карточках Megamarket</h3>
              <p className="text-sm text-indigo-800/90 dark:text-indigo-300/90 mb-3">
                Этот режим не требует выбора товаров в каталоге: система проверит уже выгруженные SKU, найдет карточки с async-ошибками и запустит жесткий автоцикл исправления.
              </p>
              <p className="text-xs text-indigo-700/90 dark:text-indigo-300/90 mb-3">
                Для ручной коррекции semantic-связей атрибутов откройте страницу <Link to="/attribute-star-map" className="underline font-semibold">Star Map векторов</Link>.
              </p>
              <div className="grid md:grid-cols-3 gap-3 items-end">
                <label className="flex flex-col">
                  <span className="text-xs font-medium mb-1 text-slate-700 dark:text-slate-200">Подключение</span>
                  <select
                    className="border rounded-lg p-2.5 text-black dark:text-white dark:bg-slate-700"
                    value={selectedConn}
                    onChange={e => setSelectedConn(e.target.value)}
                  >
                    {connections.map((c: any) =>
                      <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>
                    )}
                  </select>
                </label>
                <label className="flex flex-col">
                  <span className="text-xs font-medium mb-1 text-slate-700 dark:text-slate-200">Сколько SKU сканировать</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="border rounded-lg p-2.5 text-black dark:text-white dark:bg-slate-700"
                    value={scanLimit}
                    onChange={(e) => setScanLimit(e.target.value)}
                    placeholder="150"
                  />
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Лимит карточек с ошибками, полученных из MM getError.
                  </span>
                </label>
                <button
                  onClick={handleStartMegamarketRepair}
                  disabled={isRepairStarting || !selectedConnObj || selectedConnObj.type !== 'megamarket'}
                  className="bg-violet-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  {isRepairStarting ? 'Запуск…' : 'Исправить ошибки MM'}
                </button>
              </div>
            </div>
          </div>
        ) : !taskId ? (
          <div className="max-w-xl">
            <div className="mb-6 p-4 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300 rounded-lg flex items-start gap-3">
              <Sparkles className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold mb-1">Выбрано товаров: {ids.length}</h3>
                <p className="text-sm opacity-90">
                  Для каждого товара система подберёт категорию на выбранной площадке и сопоставит атрибуты с официальной схемой API. Процесс идёт в фоне: можно закрыть вкладку и вернуться позже (статус в Redis).
                </p>
                {isMegamarketTarget && (
                  <p className="text-xs mt-2 opacity-90">
                    Для Megamarket запуск идет в жестком цикле автоисправления ошибок по каждой карточке.
                  </p>
                )}
              </div>
            </div>

            <label className="flex flex-col mb-6">
              <span className="text-sm font-medium mb-2 text-slate-700 dark:text-slate-200">Куда выгружать</span>
              <select 
                className="border rounded-lg p-3 text-black dark:text-white dark:bg-slate-700 focus:ring-2 focus:ring-indigo-500"
                value={selectedConn} 
                onChange={e => setSelectedConn(e.target.value)}
              >
                {connections.map((c: any) => 
                  <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>
                )}
              </select>
            </label>

            <button 
              onClick={handleStart}
              disabled={isStarting || ids.length === 0}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-8 py-3 rounded-lg font-medium flex items-center gap-2 hover:shadow-lg transition-all disabled:opacity-50"
            >
              {isStarting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              {isStarting ? 'Запуск…' : (isMegamarketTarget ? 'Запустить жесткий автоцикл MM' : 'Запустить выгрузку')}
            </button>
          </div>
        ) : progress ? (
          <div className="space-y-6">
            <div className="flex justify-between items-end mb-2">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  {progress.status === 'completed' ? <CheckCircle2 className="text-green-500" /> : <Loader2 className="animate-spin text-indigo-500" />}
                  Статус: {progress.status === 'completed' ? 'Завершено' : 'Выгрузка...'}
                </h3>
              </div>
              <span className="text-slate-500 font-medium">
                 Товар: {progress.current_sku}
              </span>
            </div>
            
            <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-4 overflow-hidden">
               <div 
                 className="bg-gradient-to-r from-purple-500 to-indigo-500 h-4 transition-all duration-500"
                 style={{ width: `${Math.max(5, (progress.processed / progress.total) * 100)}%` }}
               />
            </div>
            
            <div className="grid grid-cols-3 gap-4 text-center mt-6">
               <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg">
                 <div className="text-3xl font-bold text-slate-800 dark:text-white">{progress.processed} / {progress.total}</div>
                 <div className="text-sm text-slate-500">Обработано</div>
               </div>
               <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                 <div className="text-3xl font-bold text-green-600">{progress.success}</div>
                 <div className="text-sm text-green-600/80">Успешно в API</div>
               </div>
               <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                 <div className="text-3xl font-bold text-red-600">{progress.failed}</div>
                 <div className="text-sm text-red-600/80">С ошибкой</div>
               </div>
            </div>

            {progress.error && (
               <div className="p-4 bg-red-100 text-red-800 rounded-lg flex gap-2 items-start mt-4">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm font-mono">Последняя ошибка: {progress.error}</p>
               </div>
            )}

            <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Логи агента и верификатора
                </p>
              </div>
              <div className="max-h-72 overflow-auto p-3 bg-white dark:bg-slate-900">
                {Array.isArray(progress.logs) && progress.logs.length > 0 ? (
                  <pre className="text-xs leading-5 font-mono text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
                    {progress.logs.join('\n')}
                  </pre>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Логи пока пусты. Они появятся, когда агент начнёт анализ/проверку карточки.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Структурированные события (telemetry)
                </p>
              </div>
              <div className="max-h-72 overflow-auto p-3 bg-white dark:bg-slate-900">
                {Array.isArray(progress.events) && progress.events.length > 0 ? (
                  <pre className="text-xs leading-5 font-mono text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
                    {progress.events.map((e: any) => JSON.stringify(e)).join('\n')}
                  </pre>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    События появятся после первых шагов агента.
                  </p>
                )}
              </div>
            </div>
            
            {progress.status === 'completed' && (
              <button 
                onClick={() => setTaskId('')}
                className="mt-8 bg-slate-200 dark:bg-slate-700 px-6 py-2 rounded font-medium"
              >
                Выполнить новую выгрузку
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-slate-500 p-8">
            <Loader2 className="w-6 h-6 animate-spin" /> Подключение к очереди задач...
          </div>
        )}
      </div>
    </div>
  );
}
