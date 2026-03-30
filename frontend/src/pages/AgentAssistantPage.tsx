import React, { useState } from 'react';
import { api } from '../lib/api';

type Msg = {
  role: 'user' | 'assistant';
  text: string;
  taskId?: string;
};

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
          setMessages([
            {
              role: 'assistant',
              text: 'Пиши задачу как есть, с опечатками тоже ок. Я сам построю план, запущу выполнение и буду держать в курсе по статусу.',
            },
          ]);
        }
        const taskId = String(r.data?.active_task_id || '');
        if (taskId) setActiveTaskId(taskId);
      } catch {
        if (stop) return;
        setMessages([
          {
            role: 'assistant',
            text: 'Пиши задачу как есть, с опечатками тоже ок. Я сам построю план, запущу выполнение и буду держать в курсе по статусу.',
          },
        ]);
      }
    };
    boot();
    return () => {
      stop = true;
    };
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
    } catch (e: any) {
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
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [activeTaskId]);

  const roleLabel = (role: string) => {
    const r = String(role || '').toLowerCase();
    if (r.includes('project')) return 'PM';
    if (r.includes('analyst')) return 'AN';
    if (r.includes('backend')) return 'BE';
    if (r.includes('frontend')) return 'FE';
    if (r.includes('designer')) return 'DS';
    if (r.includes('qa')) return 'QA';
    return 'AG';
  };

  const roleAnim = (role: string) => {
    const st = String(taskStage || '').toLowerCase();
    if (st.includes('patch') || st.includes('apply')) return 'animate-pulse';
    if (st.includes('tests') || st.includes('quality')) return 'animate-bounce';
    if (st.includes('failed')) return 'animate-none';
    if (st.includes('completed')) return 'animate-none';
    return 'animate-pulse';
  };

  const zoneForStage = (stage: string) => {
    const s = String(stage || '').toLowerCase();
    if (s.includes('plan') || s.includes('helper')) return 'meeting';
    if (s.includes('docs_ingest') || s.includes('docs_validate')) return 'research';
    if (s.includes('patch') || s.includes('branch') || s.includes('apply') || s.includes('commit')) return 'coding';
    if (s.includes('tests') || s.includes('quality')) return 'qa';
    if (s.includes('pr') || s.includes('completed')) return 'release';
    if (s.includes('failed')) return 'incident';
    return 'meeting';
  };

  const zonePos: Record<string, { x: number; y: number; title: string; icon: string; cls: string }> = {
    meeting: { x: 14, y: 18, title: 'Переговорка', icon: '🗣️', cls: 'bg-blue-100 border-blue-300' },
    research: { x: 41, y: 16, title: 'Аналитика', icon: '📚', cls: 'bg-sky-100 border-sky-300' },
    coding: { x: 73, y: 18, title: 'Рабочие места', icon: '💻', cls: 'bg-violet-100 border-violet-300' },
    qa: { x: 22, y: 66, title: 'Тесты', icon: '🧪', cls: 'bg-emerald-100 border-emerald-300' },
    release: { x: 62, y: 68, title: 'Релиз', icon: '🚀', cls: 'bg-indigo-100 border-indigo-300' },
    incident: { x: 84, y: 68, title: 'Инцидент', icon: '🚨', cls: 'bg-rose-100 border-rose-300' },
    rest: { x: 44, y: 80, title: 'Зона отдыха', icon: '☕', cls: 'bg-amber-100 border-amber-300' },
  };

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
    if (String(taskStatus || '').toLowerCase() === 'paused') {
      baseZone = 'rest';
    }
    const zp = zonePos[baseZone] || zonePos.meeting;
    const shift = (idx % 3) * 6 - 6;
    return {
      role,
      code: roleLabel(role),
      x: Math.max(4, Math.min(92, zp.x + shift)),
      y: Math.max(10, Math.min(86, zp.y + (idx % 2 ? 4 : -4))),
      bubble: latestSpeechByRole[role] || '...',
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Ассистент задач</h1>
      <div className="bg-white dark:bg-slate-800 border rounded-lg p-4 max-h-[60vh] overflow-auto space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={m.role === 'user' ? 'inline-block bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm' : 'inline-block bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2 text-sm'}>
              <div className="whitespace-pre-wrap">{m.text}</div>
              {m.taskId ? <div className="mt-1 text-xs opacity-80">task_id: {m.taskId}</div> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white dark:bg-slate-800 border rounded-lg p-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder='Напиши задачу в любом стиле: "подключи вайлдбериз", "поменяй кнопку логина на зелёный"'
          className="flex-1 border rounded p-2 dark:bg-slate-700"
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !input.trim()} className="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-50">
          {busy ? 'Отправка...' : 'Отправить'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setInput('подключи вайлдбериз')} className="px-2 py-1 text-xs rounded bg-slate-100 border dark:bg-slate-800">Подключи WB</button>
        <button onClick={() => setInput('изучил? что с задачей')} className="px-2 py-1 text-xs rounded bg-slate-100 border dark:bg-slate-800">Статус</button>
        <button onClick={() => setInput('поменяй цвет кнопки логина на зеленый')} className="px-2 py-1 text-xs rounded bg-slate-100 border dark:bg-slate-800">UI правка</button>
      </div>

      <div className="bg-white dark:bg-slate-800 border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Действия и общение команды</h2>
          <span className="text-xs text-slate-500">task: {activeTaskId || '-'} | status: {taskStatus || '-'} | stage: {taskStage || '-'}</span>
        </div>
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span>Прогресс</span>
            <span>{progressPercent}% | ETA: {etaSeconds}s</span>
          </div>
          <div className="w-full h-2 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div className="h-2 bg-indigo-600 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }} />
          </div>
        </div>
        <div className="flex gap-2 mb-3">
          <button onClick={askStatus} disabled={!activeTaskId || busy} className="px-3 py-1 rounded bg-slate-700 text-white text-xs disabled:opacity-50">Статус</button>
          <button onClick={pauseTask} disabled={!activeTaskId} className="px-3 py-1 rounded bg-amber-600 text-white text-xs disabled:opacity-50">Пауза</button>
          <button onClick={resumeTask} disabled={!activeTaskId} className="px-3 py-1 rounded bg-emerald-600 text-white text-xs disabled:opacity-50">Продолжить</button>
          <a href={prUrl || '#'} target="_blank" rel="noreferrer" className={`px-3 py-1 rounded text-xs ${prUrl ? 'bg-indigo-600 text-white' : 'bg-slate-300 text-slate-500 pointer-events-none'}`}>
            Открыть PR
          </a>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="border rounded p-2 h-[220px] overflow-auto dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
            <p className="text-xs font-semibold mb-2">Лог действий</p>
            <pre className="text-xs whitespace-pre-wrap">{taskLogs.join('\n')}</pre>
          </div>
          <div className="border rounded p-2 h-[220px] overflow-auto dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
            <p className="text-xs font-semibold mb-2">Переписка команды</p>
            <div className="space-y-2">
              {teamMessages.map((m: any, i: number) => (
                <div key={i} className="text-xs">
                  <span className="font-bold text-indigo-600">{roleLabel(m.role)}</span>{' '}
                  <span className="text-slate-500">[{m.kind}]</span>{' '}
                  <span>{m.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-yellow-100 border-2 border-blue-500 rounded-lg p-3">
        <h2 className="font-semibold mb-3">Офис команды (игровой вид)</h2>
        <div className="relative h-[360px] rounded-lg border bg-gradient-to-b from-slate-50 to-slate-200 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none opacity-20" style={{ backgroundImage: 'linear-gradient(to right, #64748b 1px, transparent 1px), linear-gradient(to bottom, #64748b 1px, transparent 1px)', backgroundSize: '36px 36px' }} />
          {Object.entries(zonePos).map(([k, z]) => (
            <div
              key={k}
              className={`absolute w-36 h-16 rounded-lg border text-[11px] flex items-center justify-center font-semibold shadow-sm ${
                officeStageZone === k ? 'ring-2 ring-indigo-500 ' + z.cls : z.cls
              }`}
              style={{ left: `${z.x}%`, top: `${z.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <span className="mr-1">{z.icon}</span>{z.title}
            </div>
          ))}

          {/* Workstations with computers */}
          <div className="absolute" style={{ left: `${zonePos.coding.x}%`, top: `${zonePos.coding.y + 13}%`, transform: 'translate(-50%, -50%)' }}>
            <div className="flex gap-3">
              <div className="w-16 h-10 rounded bg-white border border-slate-300 flex items-center justify-center text-xs">🖥️</div>
              <div className="w-16 h-10 rounded bg-white border border-slate-300 flex items-center justify-center text-xs">🖥️</div>
              <div className="w-16 h-10 rounded bg-white border border-slate-300 flex items-center justify-center text-xs">🖥️</div>
            </div>
          </div>

          {/* Meeting table */}
          <div className="absolute w-28 h-10 rounded-full bg-white border border-slate-300 flex items-center justify-center text-[10px]"
               style={{ left: `${zonePos.meeting.x}%`, top: `${zonePos.meeting.y + 12}%`, transform: 'translate(-50%, -50%)' }}>
            🪑 стол переговоров
          </div>

          {/* Rest zone props */}
          <div className="absolute w-24 h-10 rounded bg-white border border-slate-300 flex items-center justify-center text-[10px]"
               style={{ left: `${zonePos.rest.x}%`, top: `${zonePos.rest.y + 10}%`, transform: 'translate(-50%, -50%)' }}>
            ☕ диван/кофе
          </div>

          {officeAgents.map((a, i) => (
            <div
              key={`${a.role}-${i}`}
              className="absolute transition-all duration-700"
              style={{ left: `${a.x}%`, top: `${a.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <div className="relative">
                <div className={`w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow ${roleAnim(a.role)}`}>
                  {a.code}
                </div>
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-[10px] bg-white border rounded px-2 py-1 max-w-[170px] whitespace-nowrap overflow-hidden text-ellipsis">
                  💬 {a.bubble}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

