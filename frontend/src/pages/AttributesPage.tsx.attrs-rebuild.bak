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

  const selectStyle: React.CSSProperties = {
    background: '#0f0f1a',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: '8px 12px',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Page header */}
      <div style={{ marginBottom: 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', marginBottom: 4 }}>
            Схема атрибутов
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', maxWidth: 620, lineHeight: 1.5 }}>
            Поля карточки товара и заполненности. Большинство создаётся при импорте — руками добавляют редко.
          </p>
        </div>
        <button
          className="btn-glow"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? '✕ Скрыть форму' : '+ Добавить атрибут'}
        </button>
      </div>

      {/* Info banner */}
      <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
        <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>Связь с интерфейсом: </span>
        товары — в{' '}
        <Link to="/products" style={{ color: '#6366f1', textDecoration: 'underline' }}>каталоге</Link>
        , ключи магазинов — в{' '}
        <Link to="/integrations" style={{ color: '#6366f1', textDecoration: 'underline' }}>магазинах и ключах API</Link>.
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>
            Обычно не нужно — атрибуты появляются при импорте и при переносе на маркетплейсы
          </p>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>Код (латиницей, без пробелов)</span>
              <input
                required
                className="input-premium"
                style={{ width: 180 }}
                value={newAttr.code}
                onChange={e => setNewAttr({ ...newAttr, code: e.target.value })}
                placeholder="например: color"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>Подпись в интерфейсе</span>
              <input
                required
                className="input-premium"
                style={{ width: 180 }}
                value={newAttr.name}
                onChange={e => setNewAttr({ ...newAttr, name: e.target.value })}
                placeholder="например: Цвет"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>Тип значения</span>
              <select style={selectStyle} value={newAttr.type} onChange={e => setNewAttr({ ...newAttr, type: e.target.value })}>
                <option value="string">Строка</option>
                <option value="number">Число</option>
                <option value="boolean">Логическое (Да/Нет)</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 2, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={newAttr.is_required}
                onChange={e => setNewAttr({ ...newAttr, is_required: e.target.checked })}
                style={{ accentColor: '#6366f1', width: 15, height: 15 }}
              />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>Обязательный</span>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>Папка каталога</span>
              <select style={{ ...selectStyle, minWidth: 200 }} value={newAttr.category_id} onChange={e => setNewAttr({ ...newAttr, category_id: e.target.value })}>
                <option value="">Для всех категорий</option>
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>Только для магазина</span>
              <select style={{ ...selectStyle, minWidth: 220 }} value={newAttr.connection_id} onChange={e => setNewAttr({ ...newAttr, connection_id: e.target.value })}>
                <option value="">Общий атрибут каталога</option>
                {connections.map((conn: any) => (
                  <option key={conn.id} value={conn.id}>{connectionOptionLabel(conn.name, conn.type)}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-glow">Сохранить атрибут</button>
          </form>
        </div>
      )}

      {/* Filters */}
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: 500, flexShrink: 0 }}>Показать:</span>
        <select style={{ ...selectStyle, minWidth: 180 }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">Все папки</option>
          <option value="global">Только без папки (общие)</option>
          {categories.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select style={{ ...selectStyle, minWidth: 220 }} value={filterConnection} onChange={e => setFilterConnection(e.target.value)}>
          <option value="">Все магазины</option>
          <option value="global">Только без привязки к магазину</option>
          {connections.map((conn: any) => (
            <option key={conn.id} value={conn.id}>{connectionOptionLabel(conn.name, conn.type)}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>
          {filteredAttributes.length} атрибутов
        </span>
      </div>

      {/* Table */}
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, overflow: 'hidden' }}>
        {filteredAttributes.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '48px 0', fontSize: 14, color: 'rgba(255,255,255,0.25)' }}>
            Нет атрибутов по выбранным фильтрам.
          </p>
        ) : (
          <table className="table-premium" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Код</th>
                <th>Подпись</th>
                <th>Магазин</th>
                <th>Папка</th>
                <th>Тип</th>
                <th>Обязательно</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttributes.map((attr: any) => (
                <tr key={attr.id}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6366f1' }}>{attr.code}</span>
                  </td>
                  <td style={{ color: 'rgba(255,255,255,0.85)' }}>{attr.name}</td>
                  <td>
                    {attr.connection ? (
                      <span className="badge badge-warning">
                        {connectionOptionLabel(attr.connection.name, attr.connection.type)}
                      </span>
                    ) : (
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>Любой магазин</span>
                    )}
                  </td>
                  <td>
                    {attr.category ? (
                      <span className="badge badge-purple">{attr.category.name}</span>
                    ) : (
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>Все папки</span>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-neutral">{typeLabel(attr.type)}</span>
                  </td>
                  <td>
                    {attr.is_required ? (
                      <span className="badge badge-error">Да</span>
                    ) : (
                      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Нет</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
