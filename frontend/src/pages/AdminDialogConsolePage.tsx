import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function AdminDialogConsolePage() {
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState('github_connect');
  const [payload, setPayload] = useState('{}');

  const loadApprovals = async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/approvals', { params: { limit: 200 } });
      setApprovals(r.data?.approvals || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApprovals();
  }, []);

  const createRequest = async () => {
    let parsed: any = {};
    try {
      parsed = JSON.parse(payload || '{}');
    } catch {
      alert('payload должен быть valid JSON');
      return;
    }
    await api.post('/admin/approvals/request', { action, payload: parsed });
    await loadApprovals();
  };

  const decide = async (approval_id: string, decision: 'approved' | 'rejected') => {
    await api.post('/admin/approvals/decide', { approval_id, decision });
    await loadApprovals();
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Админ диалоговая консоль</h1>

      <div className="bg-white dark:bg-slate-800 rounded-lg border p-4 space-y-3">
        <h2 className="font-semibold">Запросить админ-разрешение</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="border rounded p-2 dark:bg-slate-700"
            placeholder="action, e.g. github_connect"
          />
          <input
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            className="border rounded p-2 md:col-span-2 dark:bg-slate-700"
            placeholder='{"repo":"org/repo","reason":"..."}'
          />
        </div>
        <button onClick={createRequest} className="px-4 py-2 bg-indigo-600 text-white rounded">
          Создать запрос
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border p-4">
        <h2 className="font-semibold mb-3">Очередь согласований</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Загрузка...</p>
        ) : approvals.length === 0 ? (
          <p className="text-sm text-slate-500">Запросов пока нет.</p>
        ) : (
          <div className="space-y-3">
            {approvals.map((a) => (
              <div key={a.approval_id} className="border rounded p-3 dark:border-slate-700">
                <p className="text-sm"><b>{a.action}</b> | status: <b>{a.status}</b></p>
                <p className="text-xs text-slate-500">by: {a.requested_by}</p>
                <pre className="text-xs mt-2 whitespace-pre-wrap">{JSON.stringify(a.payload || {}, null, 2)}</pre>
                {a.status === 'pending' && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => decide(a.approval_id, 'approved')} className="px-3 py-1 rounded bg-emerald-600 text-white text-sm">
                      Approve
                    </button>
                    <button onClick={() => decide(a.approval_id, 'rejected')} className="px-3 py-1 rounded bg-rose-600 text-white text-sm">
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// Admin Dialog Console Page - placeholder for future implementation
