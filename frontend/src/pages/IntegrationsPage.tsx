import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { marketplaceLabel } from '../lib/marketplaceUi';

export default function IntegrationsPage() {
  const [connections, setConnections] = useState([]);
  const [newConn, setNewConn] = useState({
    name: '',
    type: 'ozon',
    api_key: '',
    client_id: '',
    store_id: '',
    warehouse_id: '',
  });

  useEffect(() => {
    fetchConnections();
  }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/connections');
      setConnections(res.data);
    } catch {}
  };

  const handleCreate = async (e: any) => {
    e.preventDefault();
    try {
      const payload = {
        ...newConn,
        warehouse_id: newConn.warehouse_id.trim() || undefined,
      };
      await api.post('/connections', payload);
      setNewConn({ name: '', type: 'ozon', api_key: '', client_id: '', store_id: '', warehouse_id: '' });
      fetchConnections();
    } catch (err) {
      console.error(err);
      alert('Ошибка при сохранении подключения. Возможно Бэкенд ещё не обновлен.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Магазины и ключи API</h2>
        <p className="text-gray-600 dark:text-gray-400 mt-1 max-w-3xl">
          Здесь вы привязываете реальные магазины к системе. Несколько магазинов одной площадки (например, два Ozon) — это <strong>два отдельных подключения</strong>: так ИИ сможет скачать одну и ту же модель с разных витрин и собрать из данных одну полную карточку в каталоге.
        </p>
      </div>

      <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/80 dark:bg-indigo-950/40 p-4 text-sm text-indigo-950 dark:text-indigo-100">
        <p className="font-semibold mb-2">Подсказки по полям</p>
        <ul className="list-disc pl-5 space-y-1 text-indigo-900/90 dark:text-indigo-200/90">
          <li><strong>Ozon</strong> — Client-Id и Api-Key из кабинета продавца.</li>
          <li><strong>Яндекс Маркет</strong> — рекомендуется токен <strong>Api-Key</strong> (поле ключа); при OAuth укажите ещё Client ID. В «businessId» — число кабинета из API.</li>
          <li><strong>Wildberries</strong> — токен категории «Контент».</li>
          <li><strong>Мегамаркет</strong> — токен продавца; при необходимости отдельно укажите склад для цены и остатка.</li>
        </ul>
      </div>
      
      <form onSubmit={handleCreate} className="bg-white dark:bg-slate-800 p-4 rounded shadow grid gap-4 lg:grid-cols-3 items-end">
        <label className="flex flex-col">
          <span className="text-sm font-medium">Маркетплейс</span>
          <select
            className="border rounded p-2 text-black"
            value={newConn.type}
            onChange={(e) =>
              setNewConn({ ...newConn, type: e.target.value, warehouse_id: e.target.value === 'megamarket' ? newConn.warehouse_id : '' })
            }
          >
            <option value="ozon">Ozon</option>
            <option value="yandex">Яндекс.Маркет</option>
            <option value="megamarket">Мегамаркет</option>
            <option value="wildberries">Wildberries</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-sm font-medium">Название магазина (для себя)</span>
          <input required className="border rounded p-2 text-black" value={newConn.name} onChange={e => setNewConn({...newConn, name: e.target.value})} placeholder="Магазин Обуви - Ozon" />
        </label>
        <label className="flex flex-col">
          <span className="text-sm font-medium">API Ключ / Token</span>
          <input required className="border rounded p-2 text-black" value={newConn.api_key} onChange={e => setNewConn({...newConn, api_key: e.target.value})} placeholder="токен..." />
        </label>
        <label className="flex flex-col">
          <span className="text-sm font-medium">
            {newConn.type === 'yandex' ? 'OAuth: Client ID (если только Api-Key — оставьте пустым)' : 'Client ID (если применимо)'}
          </span>
          <input className="border rounded p-2 text-black" value={newConn.client_id} onChange={e => setNewConn({...newConn, client_id: e.target.value})} placeholder={newConn.type === 'yandex' ? 'oauth_client_id для OAuth' : 'client id...'} />
        </label>
        <label className="flex flex-col">
          <span className="text-sm font-medium">
            {newConn.type === 'yandex'
              ? 'Я.Маркет: businessId кабинета (число)'
              : 'Store ID / ФБС (если применимо)'}
          </span>
          <input className="border rounded p-2 text-black" value={newConn.store_id} onChange={e => setNewConn({...newConn, store_id: e.target.value})} placeholder={newConn.type === 'yandex' ? 'из GET /v2/campaigns' : 'store id...'} />
        </label>
        {newConn.type === 'megamarket' && (
          <label className="flex flex-col lg:col-span-2">
            <span className="text-sm font-medium">Мегамаркет: locationId склада</span>
            <input
              className="border rounded p-2 text-black"
              value={newConn.warehouse_id}
              onChange={(e) => setNewConn({ ...newConn, warehouse_id: e.target.value })}
              placeholder="из кабинета / API (для price/updateByOfferId и stock/updateByOfferId)"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Без склада цена и остаток после выгрузки карточки не отправляются (или задайте MEGAMARKET_DEFAULT_LOCATION_ID на сервере).
            </span>
          </label>
        )}
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Подключить магазин</button>
      </form>

      <div className="bg-white dark:bg-slate-800 rounded shadow overflow-hidden mt-4">
        <table className="w-full text-left">
          <thead className="bg-slate-100 dark:bg-slate-900">
            <tr>
              <th className="p-4 border-b">Площадка</th>
              <th className="p-4 border-b">Название</th>
              <th className="p-4 border-b">Client ID</th>
              <th className="p-4 border-b">Склад (MM)</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((c: any) => (
              <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                <td className="p-4 border-b font-semibold text-slate-800 dark:text-slate-200">{marketplaceLabel(c.type)}</td>
                <td className="p-4 border-b">{c.name}</td>
                <td className="p-4 border-b">{c.client_id || '-'}</td>
                <td className="p-4 border-b font-mono text-sm">{c.type === 'megamarket' ? c.warehouse_id || '—' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
