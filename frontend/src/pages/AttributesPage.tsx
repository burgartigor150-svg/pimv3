import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { connectionOptionLabel } from '../lib/marketplaceUi';

export default function AttributesPage() {
  const [attributes, setAttributes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [connections, setConnections] = useState([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterConnection, setFilterConnection] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAttr, setNewAttr] = useState({ code: '', name: '', type: 'string', is_required: false, category_id: '', connection_id: '' });

  useEffect(() => {
    fetchAttributes();
    fetchCategories();
    fetchConnections();
  }, []);

  const fetchConnections = async () => {
    const res = await api.get('/connections');
    setConnections(res.data);
  };


  const fetchCategories = async () => {
    const res = await api.get('/categories');
    setCategories(res.data);
  };

  const fetchAttributes = async () => {
    const res = await api.get('/attributes');
    setAttributes(res.data);
  };

  const handleCreate = async (e: any) => {
    e.preventDefault();
    const payload = { ...newAttr, category_id: newAttr.category_id || null, connection_id: newAttr.connection_id || null };
    await api.post('/attributes', payload);
    setNewAttr({ code: '', name: '', type: 'string', is_required: false, category_id: '', connection_id: '' });
    fetchAttributes();
  };

  const filteredAttributes = useMemo(() => {
    return attributes.filter((attr: any) => {
      const catId = attr.category ? attr.category.id : attr.category_id;
      const connId = attr.connection ? attr.connection.id : attr.connection_id;
      if (filterCategory && filterCategory !== 'global') {
        if (catId !== filterCategory) return false;
      } else if (filterCategory === 'global') {
        if (catId) return false;
      }
      if (filterConnection && filterConnection !== 'global') {
        if (connId !== filterConnection) return false;
      } else if (filterConnection === 'global') {
        if (connId) return false;
      }
      return true;
    });
  }, [attributes, filterCategory, filterConnection]);

  const typeLabel = (t: string) =>
    t === 'string' ? 'Текст' : t === 'number' ? 'Число' : 'Да / нет';

  return (
    <div className="flex flex-col gap-6 px-1 sm:px-0">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Схема атрибутов</h2>
        <p className="text-slate-600 dark:text-slate-400 mt-1 max-w-3xl">
          Здесь перечислены поля, которые видны в карточке товара и участвуют в заполненности. Большую часть атрибутов система создаёт сама при импорте и при работе ИИ — руками добавляют редко. Привязка к магазину нужна только для специфичных полей одной площадки.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 text-sm text-slate-700 dark:text-slate-300">
        <span className="font-semibold text-slate-800 dark:text-slate-200">Связь с остальным интерфейсом: </span>
        товары — в <Link to="/products" className="text-indigo-600 dark:text-indigo-400 underline font-medium">каталоге</Link>
        , ключи магазинов — в <Link to="/integrations" className="text-indigo-600 dark:text-indigo-400 underline font-medium">магазинах и ключах API</Link>.
      </div>
      
      <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
        <div 
          className="flex justify-between items-center cursor-pointer select-none" 
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          <h3 className="text-lg font-semibold text-blue-600 dark:text-blue-400 hover:underline">
            {showCreateForm ? 'Скрыть форму' : 'Добавить атрибут вручную'}
          </h3>
          <span className="text-sm text-slate-500 dark:text-slate-400 hidden sm:block">Обычно не нужно — атрибуты появляются при импорте и при переносе на маркетплейсы</span>
        </div>
        {showCreateForm && (
        <form onSubmit={handleCreate} className="flex flex-wrap gap-4 items-end mt-4 pt-4 border-t dark:border-slate-700">
        <label className="flex flex-col">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Код (латиницей, без пробелов)</span>
          <input required className="border rounded p-2 text-black dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={newAttr.code} onChange={e => setNewAttr({...newAttr, code: e.target.value})} placeholder="например: color" />
        </label>
        <label className="flex flex-col">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Подпись в интерфейсе</span>
          <input required className="border rounded p-2 text-black dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={newAttr.name} onChange={e => setNewAttr({...newAttr, name: e.target.value})} placeholder="например: Цвет" />
        </label>
        <label className="flex flex-col">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Тип значения</span>
          <select className="border rounded p-2 text-black dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={newAttr.type} onChange={e => setNewAttr({...newAttr, type: e.target.value})}>
            <option value="string">Строка</option>
            <option value="number">Число</option>
            <option value="boolean">Логическое (Да/Нет)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" checked={newAttr.is_required} onChange={e => setNewAttr({...newAttr, is_required: e.target.checked})} />
          <span className="text-sm font-medium">Обязательный</span>
        </label>
        <label className="flex flex-col min-w-[200px]">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Папка каталога</span>
          <select className="border rounded p-2 text-black dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={newAttr.category_id} onChange={e => setNewAttr({...newAttr, category_id: e.target.value})}>
            <option value="">Для всех категорий</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col min-w-[200px]">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Только для магазина (необязательно)</span>
          <select className="border rounded p-2 text-black dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={newAttr.connection_id} onChange={e => setNewAttr({...newAttr, connection_id: e.target.value})}>
            <option value="">Общий атрибут каталога</option>
            {connections.map((conn: any) => (
              <option key={conn.id} value={conn.id}>{connectionOptionLabel(conn.name, conn.type)}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-medium">Сохранить атрибут</button>
        </form>
        )}
      </div>

      <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 sm:items-center mb-[-1rem] border border-slate-200 dark:border-slate-700">
        <span className="font-medium text-sm text-slate-700 dark:text-slate-300 shrink-0">Показать:</span>
        <select className="border rounded p-2 text-sm text-black dark:bg-slate-900 dark:border-slate-600 dark:text-white w-full sm:w-auto sm:min-w-[180px]" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">Все папки</option>
          <option value="global">Только без папки (общие)</option>
          {categories.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="border rounded p-2 text-sm text-black dark:bg-slate-900 dark:border-slate-600 dark:text-white w-full sm:w-auto sm:min-w-[200px]" value={filterConnection} onChange={e => setFilterConnection(e.target.value)}>
          <option value="">Все магазины</option>
          <option value="global">Только без привязки к магазину</option>
          {connections.map((conn: any) => (
            <option key={conn.id} value={conn.id}>{connectionOptionLabel(conn.name, conn.type)}</option>
          ))}
        </select>
      </div>

      {/* Мобильные карточки */}
      <div className="md:hidden flex flex-col gap-3">
        {filteredAttributes.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Нет атрибутов по выбранным фильтрам.</p>
        ) : (
          filteredAttributes.map((attr: any) => (
            <article
              key={attr.id}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm space-y-2"
            >
              <div className="flex justify-between items-start gap-2">
                <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400 break-all">{attr.code}</span>
                <span className="text-xs shrink-0 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                  {typeLabel(attr.type)}
                </span>
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{attr.name}</h3>
              <dl className="grid grid-cols-1 gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-slate-400 dark:text-slate-500 uppercase tracking-wide">Магазин</dt>
                  <dd>
                    {attr.connection ? (
                      <span className="inline-block bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200 px-2 py-1 rounded text-[11px]">
                        {connectionOptionLabel(attr.connection.name, attr.connection.type)}
                      </span>
                    ) : (
                      'Любой магазин'
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-slate-400 dark:text-slate-500 uppercase tracking-wide">Папка</dt>
                  <dd>{attr.category ? attr.category.name : 'Все папки'}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-slate-400 dark:text-slate-500 uppercase tracking-wide">Обязательно</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">{attr.is_required ? 'Да' : 'Нет'}</dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </div>

      {/* Таблица на планшете и десктопе */}
      <div className="hidden md:block bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm overflow-x-auto">
        <table className="w-full text-left min-w-[640px]">
          <thead className="bg-slate-100 dark:bg-slate-900">
            <tr>
              <th className="p-4 border-b dark:border-slate-700">Код</th>
              <th className="p-4 border-b dark:border-slate-700">Подпись</th>
              <th className="p-4 border-b dark:border-slate-700">Магазин</th>
              <th className="p-4 border-b dark:border-slate-700">Папка</th>
              <th className="p-4 border-b dark:border-slate-700">Тип</th>
              <th className="p-4 border-b dark:border-slate-700">Обязательно</th>
            </tr>
          </thead>
          <tbody>
            {filteredAttributes.map((attr: any) => (
              <tr key={attr.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/80">
                <td className="p-4 border-b dark:border-slate-700 font-mono text-sm">{attr.code}</td>
                <td className="p-4 border-b dark:border-slate-700">{attr.name}</td>
                <td className="p-4 border-b dark:border-slate-700">
                  {attr.connection ? (
                    <span className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded dark:bg-orange-900/50 dark:text-orange-200">
                      {connectionOptionLabel(attr.connection.name, attr.connection.type)}
                    </span>
                  ) : (
                    <span className="text-slate-400 text-xs">Любой магазин</span>
                  )}
                </td>
                <td className="p-4 border-b dark:border-slate-700">
                  {attr.category ? (
                    <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded dark:bg-indigo-900/50 dark:text-indigo-200">{attr.category.name}</span>
                  ) : (
                    <span className="text-slate-400 text-xs">Все папки</span>
                  )}
                </td>
                <td className="p-4 border-b dark:border-slate-700">{typeLabel(attr.type)}</td>
                <td className="p-4 border-b dark:border-slate-700">{attr.is_required ? 'Да' : 'Нет'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredAttributes.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-12">Нет атрибутов по выбранным фильтрам.</p>
        )}
      </div>
    </div>
  );
}
