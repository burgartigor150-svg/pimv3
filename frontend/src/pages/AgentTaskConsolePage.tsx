import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

type AgentTaskType = 'design' | 'backend' | 'api-integration' | 'docs-ingest';

export default function AgentTaskConsolePage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [taskType, setTaskType] = useState<AgentTaskType>('backend');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [namespace, setNamespace] = useState('docs:yandex-market');
  const [docsUrlsText, setDocsUrlsText] = useState('');
  const [validationQuery, setValidationQuery] = useState('authorization');
  const [webQuery, setWebQuery] = useState('Yandex Market API documentation');
  const [maxWebResults, setMaxWebResults] = useState(5);
  const [caps, setCaps] = useState<any>(null);

  const docsUrls = useMemo(
    () =>
      docsUrlsText
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
    [docsUrlsText]
  );

  const loadTasks = async () => {
    setLoading(true);
    try {
      const r = await api.get('/agent-tasks', { params: { limit: 200 } });
      setTasks(r.data?.tasks || []);
    } finally {
      setLoading(false);
    }
  };

  const openTask = async (taskId: string) => {
    const r = await api.get(`/agent-tasks/${taskId}`);
    setSelectedTaskId(taskId);
    setSelected(r.data?.task || null);
    setLogs(r.data?.logs || []);
  };

  useEffect(() => {
    loadTasks();
    api.get('/agent-tasks-capabilities').then((r) => setCaps(r.data?.capabilities || null)).catch(() => null);
  }, []);

  useEffect(() => {
    const t = window.setInterval(async () => {
      await loadTasks();
      if (selectedTaskId) {
        await openTask(selectedTaskId);
      }
    }, 3000);
    return () => window.clearInterval(t);
  }, [selectedTaskId]);

  const createTask = async () => {
    if (!title.trim()) {
      alert('Нужен заголовок задачи');
      return;
    }
    const payload: any = {
      task_type: taskType,
      title: title.trim(),
      description: description.trim(),
      auto_run: true,
    };
    if (taskType === 'docs-ingest') {
      payload.namespace = namespace.trim() || 'docs:yandex-market';
      payload.docs_urls = docsUrls;
      payload.validation_query = validationQuery.trim() || 'authorization';
      payload.web_query = webQuery.trim();
      payload.max_web_results = maxWebResults;
    }
    const r = await api.post('/agent-tasks/create', payload);
    const taskId = r.data?.task?.task_id;
    await loadTasks();
    if (taskId) {
      await openTask(taskId);
    }
  };

  const runTask = async (taskId: string) => {
    await api.post(`/agent-tasks/${taskId}/run`);
    await openTask(taskId);
  };

  const quickAttachYandexDocs = async () => {
    const payload = {
      task_type: 'docs-ingest',
      title: 'Attach Yandex Market API docs',
      description: 'Ingest and validate Yandex Market API docs into vector namespace',
      namespace: namespace.trim() || 'docs:yandex-market',
      docs_urls: docsUrls,
      validation_query: validationQuery.trim() || 'authorization',
      web_query: webQuery.trim(),
      max_web_results: maxWebResults,
      auto_run: true,
    };
    const r = await api.post('/agent-tasks/create', payload);
    const taskId = r.data?.task?.task_id;
    await loadTasks();
    if (taskId) {
      await openTask(taskId);
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Agent Task Console</h1>
      <div className="text-xs text-slate-600 dark:text-slate-300">
        Web ingest: {caps?.web_ingest ? 'on' : 'off'} | Web discovery: {caps?.web_discovery ? 'on' : 'off'} | Context7: {caps?.context7_connected ? 'connected' : 'not connected'}
      </div>
      <div className="text-xs text-emerald-700 dark:text-emerald-300">
        Очередь автономная: задачи стартуют сами сразу после создания. Страницу можно закрывать.
      </div>

      <div className="bg-white dark:bg-slate-800 border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">Новая агентная задача</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <select value={taskType} onChange={(e) => setTaskType(e.target.value as AgentTaskType)} className="border rounded p-2 dark:bg-slate-700">
            <option value="design">design</option>
            <option value="backend">backend</option>
            <option value="api-integration">api-integration</option>
            <option value="docs-ingest">docs-ingest</option>
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded p-2 dark:bg-slate-700" placeholder="Заголовок задачи" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="border rounded p-2 md:col-span-2 dark:bg-slate-700" placeholder="Описание / цель" />
        </div>

        {taskType === 'docs-ingest' && (
          <div className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <input value={namespace} onChange={(e) => setNamespace(e.target.value)} className="border rounded p-2 dark:bg-slate-700" placeholder="namespace, например docs:yandex-market" />
              <input value={validationQuery} onChange={(e) => setValidationQuery(e.target.value)} className="border rounded p-2 dark:bg-slate-700" placeholder="validation query" />
              <input value={webQuery} onChange={(e) => setWebQuery(e.target.value)} className="border rounded p-2 dark:bg-slate-700 md:col-span-2" placeholder="Web query for auto-discovery, e.g. Yandex Market API docs" />
              <input
                type="number"
                min={1}
                max={10}
                value={maxWebResults}
                onChange={(e) => setMaxWebResults(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="border rounded p-2 dark:bg-slate-700"
                placeholder="Max web results"
              />
            </div>
            <textarea
              value={docsUrlsText}
              onChange={(e) => setDocsUrlsText(e.target.value)}
              className="border rounded p-2 w-full h-28 dark:bg-slate-700"
              placeholder={'URL документации, по одному в строке\nhttps://...'}
            />
            <button onClick={quickAttachYandexDocs} className="px-4 py-2 rounded bg-emerald-600 text-white">
              Ingest + Validate + Attach namespace
            </button>
          </div>
        )}

        <button onClick={createTask} className="px-4 py-2 rounded bg-indigo-600 text-white">
          Запустить агентную задачу
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Очередь задач</h2>
            <button onClick={loadTasks} className="px-3 py-1 rounded border dark:border-slate-600 text-sm">Обновить</button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Загрузка...</p>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-auto">
              {tasks.map((t) => (
                <button
                  key={t.task_id}
                  onClick={() => openTask(t.task_id)}
                  className="w-full text-left border rounded p-2 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <p className="text-sm"><b>{t.task_type}</b> | {t.status} | {t.stage}</p>
                  <p className="text-sm">{t.title}</p>
                  <p className="text-xs text-slate-500">{t.task_id}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 border rounded-lg p-4">
          <h2 className="font-semibold mb-3">Детали и realtime-логи</h2>
          {!selected ? (
            <p className="text-sm text-slate-500">Выбери задачу слева.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm"><b>ID:</b> {selected.task_id}</p>
              <p className="text-sm"><b>Type:</b> {selected.task_type}</p>
              <p className="text-sm"><b>Status:</b> {selected.status}</p>
              <p className="text-sm"><b>Stage:</b> {selected.stage}</p>
              <p className="text-sm"><b>Namespace:</b> {selected.namespace || '-'}</p>
              <p className="text-sm"><b>Helpers:</b> {Array.isArray(selected.result?.helpers) ? selected.result.helpers.length : 0}</p>
              <div className="flex gap-2">
                <button onClick={() => runTask(selected.task_id)} className="px-3 py-1 rounded bg-slate-600 text-white text-sm">Перезапустить</button>
              </div>
              {Array.isArray(selected.result?.helpers) && selected.result.helpers.length > 0 ? (
                <div className="border rounded dark:border-slate-700 p-2 max-h-[140px] overflow-auto">
                  <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(selected.result.helpers, null, 2)}</pre>
                </div>
              ) : null}
              <div className="border rounded dark:border-slate-700 p-2 max-h-[180px] overflow-auto">
                <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(selected.result || {}, null, 2)}</pre>
              </div>
              <div className="border rounded dark:border-slate-700 p-2 max-h-[220px] overflow-auto">
                <pre className="text-xs whitespace-pre-wrap">{logs.join('\n')}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

