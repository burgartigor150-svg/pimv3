import React, { useState } from 'react';
import { api } from '../lib/api';

type Msg = {
  role: 'user' | 'assistant';
  text: string;
  taskId?: string;
};

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  PM: '#6366f1',
  AN: '#22d3ee',
  BE: '#10b981',
  FE: '#a855f7',
  DS: '#f87171',
  QA: '#fb923c',
  AG: 'rgba(255,255,255,0.3)',
}

function roleLabel(role: string): string {
  const r = String(role || '').toLowerCase();
  if (r.includes('project')) return 'PM';
  if (r.includes('analyst')) return 'AN';
  if (r.includes('backend')) return 'BE';
  if (r.includes('frontend')) return 'FE';
  if (r.includes('designer')) return 'DS';
  if (r.includes('qa')) return 'QA';
  return 'AG';
}

function roleAnim(role: string, taskStage: string): boolean {
  const st = String(taskStage || '').toLowerCase();
  return !st.includes('failed') && !st.includes('completed');
}

function zoneForStage(stage: string): string {
  const s = String(stage || '').toLowerCase();
  if (s.includes('plan') || s.includes('helper')) return 'meeting';
  if (s.includes('docs_ingest') || s.includes('docs_validate')) return 'research';
  if (s.includes('patch') || s.includes('branch') || s.includes('apply') || s.includes('commit')) return 'coding';
  if (s.includes('tests') || s.includes('quality')) return 'qa';
  if (s.includes('pr') || s.includes('completed')) return 'release';
  if (s.includes('failed')) return 'incident';
  return 'meeting';
}

// ─── Zone definitions ─────────────────────────────────────────────────────────

const zonePos: Record<string, { x: number; y: number; title: string; icon: string }> = {
  meeting:  { x: 14, y: 18, title: 'Переговорка',    icon: '⬡' },
  research: { x: 41, y: 16, title: 'Аналитика',      icon: '◈' },
  coding:   { x: 73, y: 18, title: 'Рабочие места',  icon: '◇' },
  qa:       { x: 22, y: 66, title: 'Тесты',          icon: '◆' },
  release:  { x: 62, y: 68, title: 'Релиз',          icon: '◉' },
  incident: { x: 84, y: 68, title: 'Инцидент',       icon: '▲' },
  rest:     { x: 44, y: 80, title: 'Зона отдыха',    icon: '○' },
}

const ZONE_ACCENT: Record<string, string> = {
  meeting:  '#6366f1',
  research: '#22d3ee',
  coding:   '#a855f7',
  qa:       '#10b981',
  release:  '#6366f1',
  incident: '#f87171',
  rest:     'rgba(255,255,255,0.15)',
}

export default function AgentAssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState('');
  const [taskLogs, setTaskLogs] = useState<string[]>([]);
  const [teamMessages, setTeamMessages] = useState<any[]>([]);
  const [taskStage, setTaskStage] = useState('');
  const [taskStatus, setTaskStatus] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState(0);
  const [prUrl, setPrUrl] = useState('');

  React.useEffect(() => {
    let stop = false;
    const boot = async () => {
      try {
        const r = await api.get('/agent-chat/state');
        if (stop) return;
        const history = Array.isArray(r.data?.history) ? r.data.history : [];
        const restored: Msg[] = history
          .map((h: any) => ({
            role: h?.role === 'assistant' ? 'assistant' : h?.role === 'user' ? 'user' : '',
            text: String(h?.content || ''),
          }))
          .filter((m: Msg | any) => (m.role === 'assistant' || m.role === 'user') && String(m.text || '').trim());
        if (restored.length > 0) {
          setMessages(restored.slice(-40));
        } else {
          setMessages([{
            role: 'assistant',
            text: 'Пиши задачу как есть, с опечатками тоже ок. Я сам построю план, запущу выполнение и буду держать в курсе по статусу.',
          }]);
        }
        const taskId = String(r.data?.active_task_id || '');
        if (taskId) setActiveTaskId(taskId);
      } catch {
        if (stop) return;
        setMessages([{
          role: 'assistant',
          text: 'Пиши задачу как есть, с опечатками тоже ок. Я сам построю план, запущу выполнение и буду держать в курсе по статусу.',
        }]);
      }
    };
    boot();
    return () => { stop = true; };
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const nextHistory = [...messages, { role: 'user' as const, text }];
    setInput('');
    setMessages(nextHistory);
    setBusy(true);
    try {
      const r = await api.post('/agent-chat/message', {
        message: text,
        auto_run: true,
        history: nextHistory.map((m) => ({ role: m.role, content: m.text })),
      });
      const reply = r.data?.assistant_reply || 'Задача принята.';
      const taskId = r.data?.active_task_id || r.data?.task?.task_id || '';
      if (taskId) setActiveTaskId(taskId);
      setMessages((prev) => [...prev, { role: 'assistant', text: reply, taskId }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Не отправилось. Нажми еще раз — сразу продолжу с того же места.' }]);
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    if (!activeTaskId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.get(`/agent-tasks/${activeTaskId}`);
        if (stop) return;
        setTaskLogs(r.data?.logs || []);
        setTeamMessages(r.data?.team_messages || []);
        setTaskStage(r.data?.task?.stage || '');
        setTaskStatus(r.data?.task?.status || '');
        setProgressPercent(Number(r.data?.task?.progress_percent || 0));
        setEtaSeconds(Number(r.data?.task?.eta_seconds || 0));
        const pr = r.data?.task?.result?.github_pr?.pr_url || '';
        setPrUrl(pr);
      } catch {
        if (stop) return;
      }
    };
    tick();
    const t = window.setInterval(tick, 2500);
    return () => { stop = true; window.clearInterval(t); };
  }, [activeTaskId]);

  const latestSpeechByRole: Record<string, string> = {};
  for (const m of teamMessages || []) {
    latestSpeechByRole[String(m.role || 'agent')] = String(m.text || '');
  }

  const activeRoles = Array.from(new Set((teamMessages || []).map((m: any) => String(m.role || 'agent')))).slice(-8);
  const officeStageZone = zoneForStage(taskStage);
  const officeAgents = activeRoles.map((role, idx) => {
    const r = role.toLowerCase();
    let baseZone = officeStageZone;
    if (r.includes('analyst')) baseZone = 'research';
    else if (r.includes('backend') || r.includes('frontend') || r.includes('designer')) baseZone = officeStageZone === 'qa' ? 'coding' : officeStageZone;
    else if (r.includes('qa')) baseZone = officeStageZone === 'release' ? 'qa' : officeStageZone;
    else if (r.includes('project')) baseZone = 'meeting';
    if (String(taskStatus || '').toLowerCase() === 'paused') baseZone = 'rest';
    const zp = zonePos[baseZone] || zonePos.meeting;
    const shift = (idx % 3) * 6 - 6;
    return {
      role,
      code: roleLabel(role),
      x: Math.max(4, Math.min(92, zp.x + shift)),
      y: Math.max(10, Math.min(86, zp.y + (idx % 2 ? 4 : -4))),
      bubble: latestSpeechByRole[role] || '...',
      color: ROLE_COLORS[roleLabel(role)] || ROLE_COLORS.AG,
      animating: roleAnim(role, taskStage),
    };
  });

  const askStatus = async () => {
    if (!activeTaskId) return;
    const text = 'изучил? какой статус сейчас';
    const nextHistory = [...messages, { role: 'user' as const, text }];
    setMessages(nextHistory);
    setBusy(true);
    try {
      const r = await api.post('/agent-chat/message', {
        message: text,
        auto_run: false,
        history: nextHistory.map((m) => ({ role: m.role, content: m.text })),
      });
      setMessages((prev) => [...prev, { role: 'assistant', text: r.data?.assistant_reply || 'Статус обновлён.', taskId: r.data?.active_task_id || activeTaskId }]);
    } finally {
      setBusy(false);
    }
  };

  const pauseTask = async () => {
    if (!activeTaskId) return;
    await api.post(`/agent-tasks/${activeTaskId}/pause`);
  };

  const resumeTask = async () => {
    if (!activeTaskId) return;
    await api.post(`/agent-tasks/${activeTaskId}/resume`);
  };

  const statusColor = taskStatus === 'running' ? '#22d3ee' : taskStatus === 'completed' ? '#10b981' : taskStatus === 'failed' ? '#f87171' : 'rgba(255,255,255,0.3)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: '#03030a', minHeight: '100%', padding: 20, color: 'rgba(255,255,255,0.9)' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'rgba(255,255,255,0.95)', letterSpacing: '-0.01em' }}>
          Ассистент задач
        </h1>
        {activeTaskId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, display: 'inline-block', animation: taskStatus === 'running' ? 'glow-pulse 1.5s ease infinite' : undefined }} />
            <span style={{ fontFamily: 'monospace' }}>{activeTaskId.slice(0, 12)}…</span>
            <span style={{ color: statusColor }}>{taskStatus || '—'}</span>
            {taskStage && <span>· {taskStage}</span>}
          </div>
        )}
      </div>

      {/* Chat + office: two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* LEFT: Chat panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Messages */}
          <div className="glass" style={{ padding: 16, maxHeight: '52vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 14 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '80%',
                  background: m.role === 'user'
                    ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                    : 'rgba(255,255,255,0.05)',
                  border: m.role === 'user'
                    ? '1px solid rgba(99,102,241,0.4)'
                    : '1px solid rgba(255,255,255,0.08)',
                  borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  padding: '10px 14px',
                  fontSize: 13,
                  color: m.role === 'user' ? '#fff' : 'rgba(255,255,255,0.8)',
                  lineHeight: 1.5,
                }}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                  {m.taskId && (
                    <div style={{ marginTop: 4, fontSize: 11, opacity: 0.6, fontFamily: 'monospace' }}>
                      task: {m.taskId}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '14px 14px 14px 4px', padding: '10px 16px',
                }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {[0, 1, 2].map((d) => (
                      <span key={d} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#6366f1', opacity: 0.7,
                        animation: `glow-pulse 1.2s ease ${d * 0.2}s infinite`,
                      }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="glass" style={{ padding: 12, borderRadius: 14, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder='Напиши задачу: "подключи вайлдбериз", "поменяй кнопку логина на зелёный"'
              disabled={busy}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10, padding: '9px 14px', fontSize: 13, color: 'rgba(255,255,255,0.85)',
                outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="btn-glow"
              style={{ opacity: (busy || !input.trim()) ? 0.5 : 1, cursor: (busy || !input.trim()) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
            >
              {busy ? '...' : 'Отправить'}
            </button>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[
              { label: 'Подключи WB', val: 'подключи вайлдбериз' },
              { label: 'Статус задачи', val: 'изучил? что с задачей' },
              { label: 'UI правка', val: 'поменяй цвет кнопки логина на зеленый' },
            ].map((q) => (
              <button
                key={q.label}
                onClick={() => setInput(q.val)}
                className="btn-ghost-premium"
                style={{ fontSize: 12 }}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT: Office visualization */}
        <div className="glass" style={{ borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Офис команды</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
              {officeStageZone}
            </span>
          </div>

          {/* Office canvas */}
          <div style={{ position: 'relative', flex: 1, minHeight: 340, overflow: 'hidden' }}>
            {/* Grid background */}
            <div style={{
              position: 'absolute', inset: 0, opacity: 0.08,
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }} />

            {/* Zone blocks */}
            {Object.entries(zonePos).map(([k, z]) => {
              const isActive = officeStageZone === k;
              const accent = ZONE_ACCENT[k];
              return (
                <div
                  key={k}
                  style={{
                    position: 'absolute',
                    left: `${z.x}%`, top: `${z.y}%`,
                    transform: 'translate(-50%, -50%)',
                    width: 130, height: 52,
                    borderRadius: 10,
                    background: isActive ? `rgba(${hexToRgb(accent)}, 0.12)` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isActive ? accent : 'rgba(255,255,255,0.07)'}`,
                    boxShadow: isActive ? `0 0 16px rgba(${hexToRgb(accent)}, 0.2)` : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 2,
                    transition: 'all 0.4s ease',
                  }}
                >
                  <span style={{ fontSize: 14, color: isActive ? accent : 'rgba(255,255,255,0.2)' }}>{z.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 500, color: isActive ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)', letterSpacing: '0.02em' }}>
                    {z.title}
                  </span>
                </div>
              );
            })}

            {/* Workstations */}
            <div style={{
              position: 'absolute',
              left: `${zonePos.coding.x}%`, top: `${zonePos.coding.y + 13}%`,
              transform: 'translate(-50%, -50%)',
              display: 'flex', gap: 6,
            }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 40, height: 26, borderRadius: 6,
                  background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12,
                }}>
                  ▣
                </div>
              ))}
            </div>

            {/* Meeting table */}
            <div style={{
              position: 'absolute',
              left: `${zonePos.meeting.x}%`, top: `${zonePos.meeting.y + 12}%`,
              transform: 'translate(-50%, -50%)',
              width: 100, height: 28, borderRadius: 20,
              background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: 'rgba(255,255,255,0.3)',
            }}>
              стол
            </div>

            {/* Rest zone */}
            <div style={{
              position: 'absolute',
              left: `${zonePos.rest.x}%`, top: `${zonePos.rest.y + 10}%`,
              transform: 'translate(-50%, -50%)',
              width: 80, height: 26, borderRadius: 8,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: 'rgba(255,255,255,0.2)',
            }}>
              ☕ диван
            </div>

            {/* Agent dots */}
            {officeAgents.map((a, i) => (
              <div
                key={`${a.role}-${i}`}
                style={{
                  position: 'absolute',
                  left: `${a.x}%`, top: `${a.y}%`,
                  transform: 'translate(-50%, -50%)',
                  transition: 'left 0.7s ease, top 0.7s ease',
                }}
              >
                {/* Speech bubble */}
                <div style={{
                  position: 'absolute',
                  bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                  marginBottom: 6,
                  background: 'rgba(15,15,26,0.95)', border: `1px solid rgba(${hexToRgb(a.color)}, 0.3)`,
                  borderRadius: 8, padding: '4px 8px',
                  fontSize: 10, color: 'rgba(255,255,255,0.6)',
                  whiteSpace: 'nowrap', maxWidth: 160,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  pointerEvents: 'none',
                }}>
                  {a.bubble.length > 30 ? a.bubble.slice(0, 30) + '…' : a.bubble}
                </div>

                {/* Glow ring */}
                {a.animating && (
                  <div style={{
                    position: 'absolute', inset: -4, borderRadius: '50%',
                    background: `rgba(${hexToRgb(a.color)}, 0.15)`,
                    animation: 'glow-pulse 1.8s ease infinite',
                  }} />
                )}

                {/* Dot */}
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: `rgba(${hexToRgb(a.color)}, 0.15)`,
                  border: `2px solid ${a.color}`,
                  boxShadow: `0 0 12px rgba(${hexToRgb(a.color)}, 0.4)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: a.color,
                  position: 'relative',
                }}>
                  {a.code}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Task control panel */}
      {activeTaskId && (
        <div className="glass" style={{ padding: 16, borderRadius: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Управление задачей</span>
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
              <button onClick={askStatus} disabled={busy} className="btn-ghost-premium" style={{ fontSize: 12, opacity: busy ? 0.5 : 1 }}>
                Статус
              </button>
              <button onClick={pauseTask} disabled={!activeTaskId} className="btn-ghost-premium" style={{ fontSize: 12, color: '#fb923c', borderColor: 'rgba(251,146,60,0.2)' }}>
                Пауза
              </button>
              <button onClick={resumeTask} disabled={!activeTaskId} className="btn-ghost-premium" style={{ fontSize: 12, color: '#10b981', borderColor: 'rgba(16,185,129,0.2)' }}>
                Продолжить
              </button>
              <a
                href={prUrl || '#'}
                target="_blank" rel="noreferrer"
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  textDecoration: 'none', transition: 'all 0.15s',
                  background: prUrl ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'rgba(255,255,255,0.05)',
                  color: prUrl ? '#fff' : 'rgba(255,255,255,0.2)',
                  border: prUrl ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  pointerEvents: prUrl ? 'auto' : 'none',
                }}
              >
                Открыть PR
              </a>
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>
              <span>Прогресс</span>
              <span>{progressPercent}% · ETA: {etaSeconds}s</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%`, transition: 'width 0.5s ease' }}
              />
            </div>
          </div>

          {/* Logs + team chat */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
            <div style={{
              background: '#0a0a12', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
              padding: 12, height: 200, overflowY: 'auto',
            }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, marginTop: 0 }}>
                Лог действий
              </p>
              <pre style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace', lineHeight: 1.6 }}>
                {taskLogs.join('\n')}
              </pre>
            </div>
            <div style={{
              background: '#0a0a12', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
              padding: 12, height: 200, overflowY: 'auto',
            }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, marginTop: 0 }}>
                Переписка команды
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {teamMessages.map((m: any, i: number) => {
                  const code = roleLabel(m.role);
                  const color = ROLE_COLORS[code] || ROLE_COLORS.AG;
                  return (
                    <div key={i} style={{ fontSize: 12, display: 'flex', gap: 6 }}>
                      <span style={{ fontWeight: 700, color, flexShrink: 0 }}>{code}</span>
                      <span style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>[{m.kind}]</span>
                      <span style={{ color: 'rgba(255,255,255,0.55)' }}>{m.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper: hex to r,g,b string ──────────────────────────────────────────────

function hexToRgb(hex: string): string {
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
    const m = hex.match(/[\d.]+/g);
    if (m) return `${m[0]},${m[1]},${m[2]}`;
    return '255,255,255';
  }
  const h = hex.replace('#', '');
  if (h.length < 6) return '255,255,255';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}
