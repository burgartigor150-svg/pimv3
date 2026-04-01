import React, { useState, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type MarketplaceType = 'ozon' | 'yandex' | 'wildberries' | 'megamarket';

interface Connection {
  id: string | number;
  name: string;
  type: MarketplaceType | string;
  api_key?: string;
  client_id?: string;
  status?: string;
  [key: string]: unknown;
}

interface NewConnectionForm {
  name: string;
  type: MarketplaceType | '';
  api_key: string;
  client_id: string;
}

// ─── Marketplace meta ─────────────────────────────────────────────────────────

const MARKETPLACES: {
  type: MarketplaceType;
  label: string;
  initials: string;
  color: string;
  bgColor: string;
  fields: { key: 'api_key' | 'client_id'; label: string; placeholder: string }[];
}[] = [
  {
    type: 'ozon',
    label: 'Ozon',
    initials: 'OZ',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/15',
    fields: [
      { key: 'client_id', label: 'Client ID', placeholder: '123456' },
      { key: 'api_key', label: 'API Key', placeholder: 'xxxx-xxxx-xxxx' },
    ],
  },
  {
    type: 'yandex',
    label: 'Яндекс Маркет',
    initials: 'YM',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/15',
    fields: [
      { key: 'client_id', label: 'Campaign ID', placeholder: '123456' },
      { key: 'api_key', label: 'OAuth Token', placeholder: 'y0_xxxx' },
    ],
  },
  {
    type: 'wildberries',
    label: 'Wildberries',
    initials: 'WB',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/15',
    fields: [{ key: 'api_key', label: 'API Token', placeholder: 'eyJhb...' }],
  },
  {
    type: 'megamarket',
    label: 'Мегамаркет',
    initials: 'MM',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    fields: [
      { key: 'client_id', label: 'Merchant ID', placeholder: '123456' },
      { key: 'api_key', label: 'API Key', placeholder: 'xxxx-xxxx' },
    ],
  },
];

function getMarketplaceMeta(type: string) {
  return MARKETPLACES.find((m) => m.type === type) ?? null;
}

// ─── Connection Card ──────────────────────────────────────────────────────────

function ConnectionCard({
  connection,
  onDelete,
}: {
  connection: Connection;
  onDelete: (id: string | number) => void;
}) {
  const meta = getMarketplaceMeta(connection.type);

  return (
    <div className="bg-[#13131a] border border-[#1e1e2c] rounded-xl p-5 flex flex-col gap-3 hover:border-[#28283a] transition-colors group">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/* Logo placeholder */}
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
              meta ? `${meta.bgColor} ${meta.color}` : 'bg-[#1c1c28] text-slate-400'
            }`}
          >
            {meta ? meta.initials : connection.type.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-slate-100 font-medium text-sm leading-tight">{connection.name}</p>
            <span className="inline-block mt-0.5 text-xs bg-[#1c1c28] text-slate-400 px-2 py-0.5 rounded">
              {meta ? meta.label : connection.type}
            </span>
          </div>
        </div>
        <button
          onClick={() => onDelete(connection.id)}
          className="p-1.5 rounded-lg text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
          title="Удалить подключение"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
        <span className="text-xs text-slate-500">
          {connection.status === 'active' || !connection.status ? 'Подключено' : connection.status}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [connections, setConnections] = useState<Connection[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<NewConnectionForm>({
    name: '',
    type: '',
    api_key: '',
    client_id: '',
  });

  // ── Fetch connections ──────────────────────────────────────────────────────
  useEffect(() => {
    fetchConnections();
  }, []);

  async function fetchConnections() {
    setIsLoading(true);
    try {
      const res = await fetch('/api/integrations');
      const data = await res.json();
      setConnections(Array.isArray(data) ? data : data.connections ?? []);
    } catch (e) {
      console.error('Failed to fetch connections', e);
    } finally {
      setIsLoading(false);
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!form.name.trim() || !form.type) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          api_key: form.api_key,
          client_id: form.client_id,
        }),
      });
      const data = await res.json();
      console.log('Connection added', data);
      setShowAddModal(false);
      setForm({ name: '', type: '', api_key: '', client_id: '' });
      fetchConnections();
    } catch (e) {
      console.error('Failed to add connection', e);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string | number) {
    try {
      await fetch(`/api/integrations/${id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      console.error('Failed to delete connection', e);
    }
  }

  function closeModal() {
    setShowAddModal(false);
    setForm({ name: '', type: '', api_key: '', client_id: '' });
  }

  const selectedMeta = form.type ? getMarketplaceMeta(form.type) : null;
  const canSave = form.name.trim() && form.type && form.api_key.trim();

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0d0d10] text-slate-100 pb-10">
      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="px-6 pt-8 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Подключения к маркетплейсам</h1>
            <p className="text-sm text-slate-600 mt-0.5">Управляйте интеграциями с торговыми площадками</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
          >
            + Добавить
          </button>
        </div>
      </div>

      {/* ── Connections grid ───────────────────────────────────────────────── */}
      <div className="px-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-600">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Загрузка...</span>
          </div>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-600">
            <div className="w-14 h-14 rounded-2xl bg-[#13131a] border border-[#1e1e2c] flex items-center justify-center">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101m-.758-4.899a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1"
                />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-500">Нет подключений</p>
              <p className="text-xs text-slate-700 mt-1">Добавьте первый маркетплейс для синхронизации товаров</p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
            >
              + Добавить подключение
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                onDelete={handleDelete}
              />
            ))}
            {/* Add card */}
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-[#13131a] border border-dashed border-[#28283a] rounded-xl p-5 flex flex-col items-center justify-center gap-2 text-slate-700 hover:text-slate-500 hover:border-[#3a3a54] transition-all min-h-[120px]"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-xs">Добавить</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Add connection modal ───────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#13131a] border border-[#1e1e2c] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-100">Новое подключение</h2>
              <button
                onClick={closeModal}
                className="text-slate-600 hover:text-slate-400 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-5">
              {/* Marketplace selector */}
              <div>
                <label className="block text-xs text-slate-500 mb-2">Площадка</label>
                <div className="grid grid-cols-2 gap-2">
                  {MARKETPLACES.map((mp) => (
                    <button
                      key={mp.type}
                      onClick={() => setForm((f) => ({ ...f, type: mp.type }))}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                        form.type === mp.type
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-[#28283a] bg-[#0d0d10] hover:border-[#3a3a54]'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${mp.bgColor} ${mp.color}`}
                      >
                        {mp.initials}
                      </div>
                      <span className="text-sm text-slate-300 leading-tight">{mp.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Connection name */}
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Название подключения</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Мой магазин"
                  className="w-full bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-700 focus:border-indigo-500 outline-none transition-colors"
                />
              </div>

              {/* Dynamic marketplace fields */}
              {selectedMeta &&
                selectedMeta.fields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs text-slate-500 mb-1.5">{field.label}</label>
                    <input
                      value={form[field.key]}
                      onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-700 focus:border-indigo-500 outline-none transition-colors font-mono"
                    />
                  </div>
                ))}

              {/* Fallback if no marketplace selected yet */}
              {!selectedMeta && (
                <p className="text-xs text-slate-700 text-center py-2">
                  Выберите площадку выше для продолжения
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={closeModal}
                className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
              >
                Отмена
              </button>
              <button
                onClick={handleAdd}
                disabled={!canSave || isSaving}
                className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
              >
                {isSaving && (
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
