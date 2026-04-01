import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { RefreshCw, Play, ExternalLink, GitBranch, AlertCircle } from 'lucide-react';

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
      console.error('Нужны sku и task_id');
      return;
    }
    await api.post('/self-improve/trigger', { sku, task_id: taskId, error_excerpt: errorExcerpt });
    await loadIncidents();
  };

  const rerun = async (id: string) => {
    await api.post(`/self-improve/incidents/${id}/run`);
    await openIncident(id);
  };

  const extractPrUrl = (raw: unknown): string => {
    if (!raw) return '';
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) return '';
      if (s.startsWith('http://') || s.startsWith('https://')) return s;
      try {
        const obj = JSON.parse(s);
        return String(obj?.pr_url || obj?.url || '');
      } catch {
        return '';
      }
    }
    if (typeof raw === 'object') {
      const obj = raw as any;
      return String(obj?.pr_url || obj?.url || '');
    }
    return '';
  };

  const incidentStatusBadge = (status: string) => {
    if (status === 'done' || status === 'completed') return <span className="badge badge-success">{status}</span>;
    if (status === 'failed' || status === 'error') return <span className="badge badge-error">{status}</span>;
    if (status === 'running') return <span className="badge badge-info">{status}</span>;
    return <span className="badge badge-warning">{status}</span>;
  };

  return (
    <div style={{ minHeight: '100vh', background: '#03030a', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div className="animate-fade-up">
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', margin: '0 0 8px' }}>
            Self-Improve консоль
          </h1>
          {/* GitHub status bar */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '6px 14px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: githubStatus?.ready ? '#10b981' : '#f87171', flexShrink: 0, display: 'inline-block' }} />
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
              GitHub: <span style={{ color: githubStatus?.ready ? '#10b981' : '#f87171', fontWeight: 600 }}>{githubStatus?.ready ? 'ready' : 'not ready'}</span>
            </span>
            {githubStatus?.mode && (
              <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>mode: <span style={{ color: 'rgba(255,255,255,0.5)' }}>{githubStatus.mode}</span></span>
            )}
            {githubStatus?.repo && (
              <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>repo: <span style={{ color: 'rgba(255,255,255,0.5)' }}>{githubStatus.repo}</span></span>
            )}
          </div>
        </div>

        {/* Manual trigger card */}
        <div className="animate-fade-up delay-75" style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 16px' }}>
            Ручной trigger инцидента
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12, marginBottom: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>SKU</span>
              <input value={sku} onChange={(e) => setSku(e.target.value)} className="input-premium" placeholder="SKU" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Task ID</span>
              <input value={taskId} onChange={(e) => setTaskId(e.target.value)} className="input-premium" placeholder="task_id" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Error excerpt (optional)</span>
              <input value={errorExcerpt} onChange={(e) => setErrorExcerpt(e.target.value)} className="input-premium" placeholder="error excerpt" />
            </label>
          </div>
          <button onClick={triggerManual} className="btn-glow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Play size={14} />
            Запустить self-improve trigger
          </button>
        </div>

        {/* Two-column layout */}
        <div className="animate-fade-up delay-150" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16, alignItems: 'start' }}>

          {/* Incidents list */}
          <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 14 }}>
                Инциденты
                {incidents.length > 0 && (
                  <span style={{ marginLeft: 8, background: 'rgba(99,102,241,0.2)', color: '#6366f1', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                    {incidents.length}
                  </span>
                )}
              </span>
              <button
                onClick={loadIncidents}
                className="btn-ghost-premium"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '5px 12px' }}
              >
                <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                Обновить
              </button>
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 58, borderRadius: 10 }} />)}
              </div>
            ) : incidents.length === 0 ? (
              <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, textAlign: 'center', padding: '32px 0' }}>Инцидентов нет</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 520, overflowY: 'auto' }}>
                {incidents.map((i) => (
                  <button
                    key={i.incident_id}
                    onClick={() => openIncident(i.incident_id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: selected?.incident_id === i.incident_id ? '#1f1f35' : '#141422',
                      border: `1px solid ${selected?.incident_id === i.incident_id ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                      borderRadius: 10,
                      padding: '10px 14px',
                      cursor: 'pointer',
                      transition: 'background 0.15s, border-color 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700, fontSize: 13 }}>{i.sku || '—'}</span>
                      {incidentStatusBadge(i.status)}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{i.stage}</span>
                      <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11 }}>·</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10, fontFamily: 'monospace' }}>{i.incident_id?.slice(0, 8)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Incident detail */}
          <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 20 }}>
            <p style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 14, margin: '0 0 16px' }}>
              Детали инцидента
            </p>
            {!selected ? (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <AlertCircle size={32} style={{ color: 'rgba(255,255,255,0.08)', margin: '0 auto 12px', display: 'block' }} />
                <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, margin: 0 }}>Выберите инцидент слева</p>
              </div>
            ) : (() => {
              const prUrl = extractPrUrl(selected.github_pr);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Meta table */}
                  <div style={{ background: '#141422', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                    {[
                      ['ID', selected.incident_id],
                      ['Status', selected.status],
                      ['Stage', selected.stage],
                      ['Branch', selected.branch || '—'],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontFamily: 'monospace', margin: '3px 0 0', wordBreak: 'break-all' }}>{val}</p>
                      </div>
                    ))}
                    {prUrl && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>PR URL</span>
                        <p style={{ margin: '3px 0 0' }}>
                          <a
                            href={prUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#6366f1', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                          >
                            <ExternalLink size={12} />
                            {prUrl}
                          </a>
                        </p>
                      </div>
                    )}
                    {!prUrl && selected.github_pr && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>PR</span>
                        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontFamily: 'monospace', margin: '3px 0 0' }}>{String(selected.github_pr)}</p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => rerun(selected.incident_id)}
                      className="btn-glow"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 16px' }}
                    >
                      <Play size={12} /> Run pipeline
                    </button>
                    {selected.branch && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#141422', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
                        <GitBranch size={12} style={{ color: 'rgba(255,255,255,0.35)' }} />
                        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, fontFamily: 'monospace' }}>{selected.branch}</span>
                      </div>
                    )}
                  </div>

                  {/* Logs */}
                  <pre style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 16, overflowY: 'auto', maxHeight: 300, margin: 0 }}>
                    {logs.length > 0
                      ? logs.join('\n')
                      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>Логи пусты</span>}
                  </pre>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
