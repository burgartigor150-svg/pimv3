import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';

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
      console.error('payload должен быть valid JSON');
      return;
    }
    await api.post('/admin/approvals/request', { action, payload: parsed });
    await loadApprovals();
  };

  const decide = async (approval_id: string, decision: 'approved' | 'rejected') => {
    await api.post('/admin/approvals/decide', { approval_id, decision });
    await loadApprovals();
  };

  const statusBadge = (status: string) => {
    if (status === 'approved') return <span className="badge badge-success">✓ Approved</span>;
    if (status === 'rejected') return <span className="badge badge-error">✗ Rejected</span>;
    return <span className="badge badge-warning">⏳ Pending</span>;
  };

  return (
    <div style={{ minHeight: '100vh', background: '#03030a', padding: '32px 24px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div className="animate-fade-up">
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', margin: '0 0 6px' }}>
            Админ диалоговая консоль
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>
            Управление запросами на разрешение действий агента
          </p>
        </div>

        {/* Create request card */}
        <div className="animate-fade-up delay-75" style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700, fontSize: 11, margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Запросить разрешение
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Action</span>
              <input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="input-premium"
                placeholder="github_connect"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Payload (JSON)</span>
              <input
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                className="input-premium"
                placeholder='{"repo":"org/repo","reason":"..."}'
              />
            </label>
          </div>
          <button onClick={createRequest} className="btn-glow">
            Создать запрос
          </button>
        </div>

        {/* Approvals queue */}
        <div className="animate-fade-up delay-150" style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <p style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 15, margin: 0 }}>
              Очередь согласований
              {approvals.length > 0 && (
                <span style={{ marginLeft: 8, background: 'rgba(99,102,241,0.2)', color: '#6366f1', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                  {approvals.length}
                </span>
              )}
            </p>
            <button
              onClick={loadApprovals}
              className="btn-ghost-premium"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            >
              <RefreshCw size={13} style={{ opacity: loading ? 0.4 : 1, animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              Обновить
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ height: 80, borderRadius: 10 }} />
              ))}
            </div>
          ) : approvals.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Clock size={32} style={{ color: 'rgba(255,255,255,0.1)', margin: '0 auto 12px' }} />
              <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, margin: 0 }}>Запросов пока нет</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {approvals.map((a, idx) => (
                <div
                  key={a.approval_id}
                  className={`animate-fade-up delay-${Math.min(idx * 75, 300) as any}`}
                  style={{ background: '#141422', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '14px 18px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 13 }}>{a.action}</span>
                      {statusBadge(a.status)}
                    </div>
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>{a.requested_by}</span>
                  </div>
                  <pre style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 16, overflowY: 'auto', maxHeight: 300, margin: '0 0 12px' }}>
                    {JSON.stringify(a.payload || {}, null, 2)}
                  </pre>
                  {a.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => decide(a.approval_id, 'approved')}
                        className="btn-glow"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 16px', background: 'linear-gradient(135deg,#10b981,#059669)' }}
                      >
                        <CheckCircle2 size={13} /> Approve
                      </button>
                      <button
                        onClick={() => decide(a.approval_id, 'rejected')}
                        className="btn-ghost-premium"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}
                      >
                        <XCircle size={13} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
