import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function SelfImproveConsolePage() {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sku, setSku] = useState('');
  const [taskId, setTaskId] = useState('');
  const [errorExcerpt, setErrorExcerpt] = useState('');
  const [githubStatus, setGithubStatus] = useState<any>(null);

  const loadIncidents = async () => {
    setLoading(true);
    try {
      const r = await api.get('/self-improve/incidents', { params: { limit: 200 } });
      setIncidents(r.data?.incidents || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIncidents();
    api.get('/github/automation/status').then((r) => setGithubStatus(r.data?.github || null)).catch(() => null);
  }, []);

  const openIncident = async (id: string) => {
    const r = await api.get(`/self-improve/incidents/${id}`);
    setSelected(r.data?.incident || null);
    setLogs(r.data?.logs || []);
  };

  const triggerManual = async () => {
    if (!sku || !taskId) {
      alert('Нужны sku и task_id');
      return;
    }
    await api.post('/self-improve/trigger', { sku, task_id: taskId, error_excerpt: errorExcerpt });
    await loadIncidents();
  };

  const rerun = async (id: string) => {
    await api.post(`/self-improve/incidents/${id}/run`);
    await openIncident(id);
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Self-Improve консоль</h1>
      <div className="text-xs text-slate-600 dark:text-slate-300">
        GitHub automation: {githubStatus?.ready ? 'ready' : 'not ready'} | repo: {githubStatus?.repo || '-'}
      </div>

      <div className="bg-white dark:bg-slate-800 border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">Ручной trigger инцидента</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <input value={sku} onChange={(e) => setSku(e.target.value)} className="border rounded p-2 dark:bg-slate-700" placeholder="SKU" />
          <input value={taskId} onChange={(e) => setTaskId(e.target.value)} className="border rounded p-2 dark:bg-slate-700" placeholder="task_id" />
          <input value={errorExcerpt} onChange={(e) => setErrorExcerpt(e.target.value)} className="border rounded p-2 dark:bg-slate-700" placeholder="error excerpt (optional)" />
        </div>
        <button onClick={triggerManual} className="px-4 py-2 rounded bg-indigo-600 text-white">Запустить self-improve trigger</button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Инциденты</h2>
            <button onClick={loadIncidents} className="px-3 py-1 rounded border dark:border-slate-600 text-sm">Обновить</button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Загрузка...</p>
          ) : (
            <div className="space-y-2 max-h-[480px] overflow-auto">
              {incidents.map((i) => (
                <button
                  key={i.incident_id}
                  onClick={() => openIncident(i.incident_id)}
                  className="w-full text-left border rounded p-2 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <p className="text-sm"><b>{i.sku || '-'}</b> | {i.status} | {i.stage}</p>
                  <p className="text-xs text-slate-500">{i.incident_id}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 border rounded-lg p-4">
          <h2 className="font-semibold mb-3">Детали инцидента</h2>
          {!selected ? (
            <p className="text-sm text-slate-500">Выбери инцидент слева.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm"><b>ID:</b> {selected.incident_id}</p>
              <p className="text-sm"><b>Status:</b> {selected.status}</p>
              <p className="text-sm"><b>Stage:</b> {selected.stage}</p>
              <p className="text-sm"><b>Branch:</b> {selected.branch || '-'}</p>
              <p className="text-sm"><b>PR:</b> {selected.github_pr || '-'}</p>
              <div className="flex gap-2">
                <button onClick={() => rerun(selected.incident_id)} className="px-3 py-1 rounded bg-emerald-600 text-white text-sm">Run pipeline</button>
              </div>
              <div className="border rounded dark:border-slate-700 p-2 max-h-[260px] overflow-auto">
                <pre className="text-xs whitespace-pre-wrap">{logs.join('\n')}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

