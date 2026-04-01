import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useToast } from '../components/Toast'

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskType =
  | 'design'
  | 'backend'
  | 'api-integration'
  | 'docs-ingest'
  | 'frontend'
  | 'qa'

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

type Priority = 'critical' | 'high' | 'normal' | 'low'

interface AgentTask {
  id: string
  title: string
  description: string
  type: TaskType
  status: TaskStatus
  priority?: Priority
  dependsOn?: string[]
  createdAt: string
  updatedAt?: string
  logs?: string[]
  result?: string
  error?: string
}

interface TaskTemplate {
  id: string
  name: string
  title: string
  description: string
  type: TaskType
}

interface CronJob {
  id: string
  name: string
  schedule: string
  nextFireTime: string
}

interface QueueItem {
  id: string
  title: string
  type: TaskType
  priority?: Priority
  queuedAt: string
}

interface TaskMetrics {
  tokens?: number
  steps?: number
  cost?: number
  durationMs?: number
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const API = '/api/v1/agent'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return `${Math.floor(diff / 86_400_000)} д назад`
}

const STATUS_DOT: Record<TaskStatus, string> = {
  pending: 'bg-slate-500',
  running: 'bg-indigo-400 animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-rose-400',
  cancelled: 'bg-slate-600',
}

const STATUS_BADGE: Record<TaskStatus, string> = {
  pending: 'bg-slate-700 text-slate-300',
  running: 'bg-indigo-500/20 text-indigo-300',
  completed: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-rose-500/20 text-rose-300',
  cancelled: 'bg-slate-700 text-slate-400',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Ожидание',
  running: 'Выполняется',
  completed: 'Завершено',
  failed: 'Ошибка',
  cancelled: 'Отменено',
}

const TYPE_BADGE: Record<TaskType, string> = {
  design: 'bg-purple-500/15 text-purple-300',
  backend: 'bg-sky-500/15 text-sky-300',
  'api-integration': 'bg-teal-500/15 text-teal-300',
  'docs-ingest': 'bg-amber-500/15 text-amber-300',
  frontend: 'bg-pink-500/15 text-pink-300',
  qa: 'bg-lime-500/15 text-lime-300',
}

const PRIORITY_CONFIG: Record<
  Priority,
  { label: string; activeClass: string; inactiveClass: string }
> = {
  critical: {
    label: 'Critical',
    activeClass: 'bg-rose-500 text-white border-rose-500',
    inactiveClass: 'bg-[#1c1c28] text-rose-400 border-[#1e1e2c] hover:border-rose-500/50',
  },
  high: {
    label: 'High',
    activeClass: 'bg-orange-500 text-white border-orange-500',
    inactiveClass: 'bg-[#1c1c28] text-orange-400 border-[#1e1e2c] hover:border-orange-500/50',
  },
  normal: {
    label: 'Normal',
    activeClass: 'bg-slate-500 text-white border-slate-500',
    inactiveClass: 'bg-[#1c1c28] text-slate-400 border-[#1e1e2c] hover:border-slate-500/50',
  },
  low: {
    label: 'Low',
    activeClass: 'bg-sky-500 text-white border-sky-500',
    inactiveClass: 'bg-[#1c1c28] text-sky-400 border-[#1e1e2c] hover:border-sky-500/50',
  },
}

const TASK_TYPES: TaskType[] = [
  'design',
  'backend',
  'api-integration',
  'docs-ingest',
  'frontend',
  'qa',
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

function Input({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</label>}
      <input
        className="bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 outline-none w-full placeholder:text-slate-600 transition-colors"
        {...props}
      />
    </div>
  )
}

function Textarea({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</label>}
      <textarea
        className="bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 outline-none w-full placeholder:text-slate-600 resize-none transition-colors"
        rows={4}
        {...props}
      />
    </div>
  )
}

function Select({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</label>}
      <select
        className="bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 outline-none w-full transition-colors"
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

// ─── Create Task Form ─────────────────────────────────────────────────────────

interface CreateTaskFormProps {
  onCreated: (task: AgentTask) => void
}

function CreateTaskForm({ onCreated }: CreateTaskFormProps) {
  const { success, error: toastError } = useToast()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<TaskType>('backend')
  const [priority, setPriority] = useState<Priority>('normal')
  const [dependsOn, setDependsOn] = useState<string[]>([])
  const [dependsOnInput, setDependsOnInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])

  useEffect(() => {
    apiFetch<TaskTemplate[]>('/templates')
      .then(setTemplates)
      .catch(() => {
        // templates are optional; silently ignore
      })
  }, [])

  function applyTemplate(tpl: TaskTemplate) {
    setTitle(tpl.title)
    setDescription(tpl.description)
    setType(tpl.type)
  }

  function addDependency() {
    const trimmed = dependsOnInput.trim()
    if (trimmed && !dependsOn.includes(trimmed)) {
      setDependsOn((prev) => [...prev, trimmed])
    }
    setDependsOnInput('')
  }

  function removeDependency(id: string) {
    setDependsOn((prev) => prev.filter((d) => d !== id))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toastError('Введите название задачи')
      return
    }
    setSubmitting(true)
    try {
      const task = await apiFetch<AgentTask>('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, description, type, priority, dependsOn }),
      })
      success(`Задача "${task.title}" создана`)
      onCreated(task)
      setTitle('')
      setDescription('')
      setType('backend')
      setPriority('normal')
      setDependsOn([])
    } catch (err) {
      toastError(`Ошибка создания задачи: ${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold text-slate-100 mb-6">Создать задачу агента</h2>

        {/* Template selector */}
        {templates.length > 0 && (
          <div className="mb-6">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">Шаблоны</p>
            <div className="flex flex-wrap gap-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="Название"
            placeholder="Кратко опишите задачу..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <Textarea
            label="Описание"
            placeholder="Детали задачи, контекст, ожидаемый результат..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <Select
            label="Тип задачи"
            value={type}
            onChange={(e) => setType(e.target.value as TaskType)}
          >
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>

          {/* Priority selector */}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Приоритет</p>
            <div className="flex gap-2">
              {(Object.keys(PRIORITY_CONFIG) as Priority[]).map((p) => {
                const cfg = PRIORITY_CONFIG[p]
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex-1 border px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      priority === p ? cfg.activeClass : cfg.inactiveClass
                    }`}
                  >
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Depends on */}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Зависит от</p>
            <div className="flex gap-2">
              <input
                className="bg-[#0d0d10] border border-[#28283a] rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 outline-none flex-1 placeholder:text-slate-600 transition-colors"
                placeholder="ID задачи..."
                value={dependsOnInput}
                onChange={(e) => setDependsOnInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addDependency()
                  }
                }}
              />
              <button
                type="button"
                onClick={addDependency}
                className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-2 rounded-lg text-sm transition-all"
              >
                + Добавить
              </button>
            </div>
            {dependsOn.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {dependsOn.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded-md text-xs"
                  >
                    {id}
                    <button
                      type="button"
                      onClick={() => removeDependency(id)}
                      className="hover:text-indigo-100 ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
            >
              {submitting ? 'Создание...' : 'Создать задачу'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Task Details ─────────────────────────────────────────────────────────────

type DetailTab = 'details' | 'logs' | 'diff' | 'metrics'

interface TaskDetailsProps {
  task: AgentTask
  onRefresh: () => void
}

function TaskDetails({ task, onRefresh }: TaskDetailsProps) {
  const { success, error: toastError, info } = useToast()
  const [activeTab, setActiveTab] = useState<DetailTab>('details')
  const [diff, setDiff] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [metrics, setMetrics] = useState<TaskMetrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs
  useEffect(() => {
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [task.logs, activeTab])

  // Load diff when tab selected
  useEffect(() => {
    if (activeTab !== 'diff') return
    setDiffLoading(true)
    apiFetch<{ diff: string }>(`/tasks/${task.id}/diff`)
      .then((res) => setDiff(res.diff))
      .catch((err) => toastError(`Не удалось загрузить diff: ${err.message}`))
      .finally(() => setDiffLoading(false))
  }, [activeTab, task.id, toastError])

  // Load metrics when tab selected
  useEffect(() => {
    if (activeTab !== 'metrics') return
    setMetricsLoading(true)
    apiFetch<TaskMetrics>(`/metrics/${task.id}`)
      .then(setMetrics)
      .catch((err) => toastError(`Не удалось загрузить метрики: ${err.message}`))
      .finally(() => setMetricsLoading(false))
  }, [activeTab, task.id, toastError])

  async function handleRerun() {
    try {
      await apiFetch(`/tasks/${task.id}/rerun`, { method: 'POST' })
      success('Задача запущена повторно')
      onRefresh()
    } catch (err) {
      toastError(`Ошибка перезапуска: ${(err as Error).message}`)
    }
  }

  async function handlePRDescription() {
    try {
      const res = await apiFetch<{ description: string }>(`/tasks/${task.id}/pr-description`)
      await navigator.clipboard.writeText(res.description)
      success('Описание PR скопировано в буфер')
    } catch (err) {
      toastError(`Ошибка генерации описания PR: ${(err as Error).message}`)
    }
  }

  async function handleRollback() {
    if (!window.confirm('Откатить изменения этой задачи?')) return
    try {
      await apiFetch(`/tasks/${task.id}/rollback`, { method: 'POST' })
      info('Откат выполнен')
      onRefresh()
    } catch (err) {
      toastError(`Ошибка отката: ${(err as Error).message}`)
    }
  }

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'details', label: 'Детали' },
    { id: 'logs', label: 'Логи' },
    { id: 'diff', label: 'Diff' },
    { id: 'metrics', label: 'Метрики' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-[#1e1e2c]">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className="text-base font-semibold text-slate-100 leading-snug">{task.title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={TYPE_BADGE[task.type]}>{task.type}</Badge>
            <Badge className={STATUS_BADGE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
          </div>
        </div>
        <p className="text-xs text-slate-500">{timeAgo(task.createdAt)}</p>

        {/* Progress bar for running tasks */}
        {task.status === 'running' && (
          <div className="mt-3 h-1 bg-[#1e1e2c] rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full animate-[progress_2s_ease-in-out_infinite]" style={{ width: '60%' }} />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleRerun}
            className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
          >
            ↺ Перезапустить
          </button>
          <button
            onClick={handlePRDescription}
            className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm transition-all"
          >
            PR Description
          </button>
          <button
            onClick={handleRollback}
            className="bg-[#1c1c28] hover:bg-[#28283a] border border-rose-900/40 text-rose-400 px-3 py-1.5 rounded-lg text-sm transition-all"
          >
            Откат
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#1e1e2c] px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-300',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {/* Details tab */}
        {activeTab === 'details' && (
          <div className="p-6 flex flex-col gap-5">
            {task.description && (
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Описание</p>
                <p className="text-sm text-slate-300 leading-relaxed">{task.description}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">ID</p>
                <p className="text-sm text-slate-400 font-mono">{task.id}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Приоритет</p>
                <p className="text-sm text-slate-300 capitalize">{task.priority ?? 'normal'}</p>
              </div>
              {task.updatedAt && (
                <div>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Обновлено</p>
                  <p className="text-sm text-slate-400">{timeAgo(task.updatedAt)}</p>
                </div>
              )}
              {task.dependsOn && task.dependsOn.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Зависит от</p>
                  <div className="flex flex-wrap gap-1">
                    {task.dependsOn.map((id) => (
                      <span key={id} className="text-xs text-indigo-400 font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded">
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {task.result && (
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Результат</p>
                <pre className="text-sm text-slate-300 bg-[#0d0d10] border border-[#28283a] rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                  {task.result}
                </pre>
              </div>
            )}
            {task.error && (
              <div>
                <p className="text-xs text-rose-400 font-medium uppercase tracking-wide mb-1">Ошибка</p>
                <pre className="text-sm text-rose-300 bg-rose-500/5 border border-rose-500/20 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                  {task.error}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Logs tab */}
        {activeTab === 'logs' && (
          <div className="p-4">
            {task.logs && task.logs.length > 0 ? (
              <div className="bg-[#0d0d10] border border-[#28283a] rounded-lg p-4 font-mono text-xs text-slate-400 leading-6 overflow-x-auto">
                {task.logs.map((line, i) => (
                  <div key={i} className="hover:text-slate-300 transition-colors">
                    <span className="text-slate-600 select-none mr-3">{String(i + 1).padStart(4, ' ')}</span>
                    {line}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
                Логи отсутствуют
              </div>
            )}
          </div>
        )}

        {/* Diff tab */}
        {activeTab === 'diff' && (
          <div className="p-4">
            {diffLoading ? (
              <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                Загрузка diff...
              </div>
            ) : diff ? (
              <pre className="bg-[#0d0d10] border border-[#28283a] rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto leading-6 whitespace-pre">
                {diff.split('\n').map((line, i) => {
                  let cls = 'text-slate-400'
                  if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-emerald-400 bg-emerald-500/5'
                  if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-rose-400 bg-rose-500/5'
                  if (line.startsWith('@@')) cls = 'text-indigo-400'
                  return (
                    <div key={i} className={`${cls} block`}>
                      {line}
                    </div>
                  )
                })}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
                Diff недоступен
              </div>
            )}
          </div>
        )}

        {/* Metrics tab */}
        {activeTab === 'metrics' && (
          <div className="p-6">
            {metricsLoading ? (
              <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                Загрузка метрик...
              </div>
            ) : metrics ? (
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Токены', value: metrics.tokens?.toLocaleString() ?? '—', unit: '' },
                  { label: 'Шаги', value: metrics.steps?.toLocaleString() ?? '—', unit: '' },
                  {
                    label: 'Стоимость',
                    value: metrics.cost !== undefined ? `$${metrics.cost.toFixed(4)}` : '—',
                    unit: '',
                  },
                  {
                    label: 'Длительность',
                    value:
                      metrics.durationMs !== undefined
                        ? metrics.durationMs < 1000
                          ? `${metrics.durationMs}ms`
                          : `${(metrics.durationMs / 1000).toFixed(1)}s`
                        : '—',
                    unit: '',
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="bg-[#13131a] border border-[#1e1e2c] rounded-xl p-4"
                  >
                    <p className="text-xs text-slate-500 mb-1">{label}</p>
                    <p className="text-2xl font-semibold text-slate-100">{value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
                Метрики недоступны
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Right sidebar ────────────────────────────────────────────────────────────

function RightSidebar({ tasks }: { tasks: AgentTask[] }) {
  const { error: toastError } = useToast()
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])

  const runningCount = tasks.filter((t) => t.status === 'running').length
  const pendingCount = tasks.filter((t) => t.status === 'pending').length

  const fetchSidebarData = useCallback(async () => {
    try {
      const [cronData, queueData] = await Promise.all([
        apiFetch<CronJob[]>('/cron'),
        apiFetch<QueueItem[]>('/queue'),
      ])
      setCronJobs(cronData)
      setQueue(queueData)
    } catch (err) {
      toastError(`Ошибка загрузки данных панели: ${(err as Error).message}`)
    }
  }, [toastError])

  useEffect(() => {
    fetchSidebarData()
    const interval = setInterval(fetchSidebarData, 10_000)
    return () => clearInterval(interval)
  }, [fetchSidebarData])

  return (
    <div className="w-[280px] shrink-0 border-l border-[#1e1e2c] flex flex-col overflow-y-auto">
      {/* Stats */}
      <div className="p-4 border-b border-[#1e1e2c]">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-3">Статистика</p>
        <div className="flex gap-3">
          <div className="flex-1 bg-[#13131a] border border-[#1e1e2c] rounded-xl p-3 text-center">
            <p className="text-2xl font-semibold text-indigo-400">{runningCount}</p>
            <p className="text-xs text-slate-500 mt-0.5">Запущено</p>
          </div>
          <div className="flex-1 bg-[#13131a] border border-[#1e1e2c] rounded-xl p-3 text-center">
            <p className="text-2xl font-semibold text-slate-300">{pendingCount}</p>
            <p className="text-xs text-slate-500 mt-0.5">В очереди</p>
          </div>
        </div>
      </div>

      {/* Cron jobs */}
      <div className="p-4 border-b border-[#1e1e2c]">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-3">Cron задачи</p>
        {cronJobs.length === 0 ? (
          <p className="text-xs text-slate-600">Нет активных cron задач</p>
        ) : (
          <div className="flex flex-col gap-2">
            {cronJobs.map((job) => (
              <div key={job.id} className="bg-[#13131a] border border-[#1e1e2c] rounded-lg p-2.5">
                <p className="text-sm text-slate-200 font-medium truncate">{job.name}</p>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{job.schedule}</p>
                <p className="text-xs text-indigo-400 mt-1">
                  ↻ {new Date(job.nextFireTime).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Queue */}
      <div className="p-4">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-3">Очередь</p>
        {queue.length === 0 ? (
          <p className="text-xs text-slate-600">Очередь пуста</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {queue.slice(0, 5).map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-2 bg-[#13131a] border border-[#1e1e2c] rounded-lg px-3 py-2"
              >
                <span className="text-xs text-slate-600 w-4 shrink-0">{index + 1}</span>
                <span className="text-xs text-slate-300 flex-1 truncate">{item.title}</span>
                <Badge className={TYPE_BADGE[item.type]}>{item.type.slice(0, 3)}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AgentTaskConsolePage() {
  const { error: toastError } = useToast()

  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchTasks = useCallback(async () => {
    try {
      const data = await apiFetch<AgentTask[]>('/tasks')
      setTasks(data)
    } catch (err) {
      toastError(`Ошибка загрузки задач: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  // Initial load + auto-refresh every 3s
  useEffect(() => {
    fetchTasks()
    const interval = setInterval(fetchTasks, 3_000)
    return () => clearInterval(interval)
  }, [fetchTasks])

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null

  function handleTaskCreated(task: AgentTask) {
    setTasks((prev) => [task, ...prev])
    setSelectedId(task.id)
    setShowCreateForm(false)
  }

  function handleSelectTask(id: string) {
    setSelectedId(id)
    setShowCreateForm(false)
  }

  function openCreateForm() {
    setShowCreateForm(true)
    setSelectedId(null)
  }

  return (
    <div className="flex h-screen bg-[#0d0d10] text-slate-100 overflow-hidden">
      {/* Left sidebar — task list */}
      <div className="w-[300px] shrink-0 border-r border-[#1e1e2c] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[#1e1e2c]">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-semibold text-slate-100">Agent Console</h1>
            {loading && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            )}
          </div>
          <button
            onClick={openCreateForm}
            className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all w-full"
          >
            + Новая задача
          </button>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto">
          {tasks.length === 0 && !loading ? (
            <div className="flex items-center justify-center h-32 text-slate-600 text-sm px-4 text-center">
              Задач пока нет. Создайте первую.
            </div>
          ) : (
            tasks.map((task) => {
              const isSelected = task.id === selectedId
              return (
                <button
                  key={task.id}
                  onClick={() => handleSelectTask(task.id)}
                  className={[
                    'w-full text-left bg-[#13131a] border-b border-[#1e1e2c] p-3 cursor-pointer transition-colors',
                    'hover:bg-[#181822]',
                    isSelected ? 'border-l-2 border-l-indigo-500 bg-indigo-500/5 pl-2.5' : 'border-l-2 border-l-transparent',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[task.status]}`}
                    />
                    <span className="text-sm text-slate-200 truncate flex-1">{task.title}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 pl-4">
                    <Badge className={`${TYPE_BADGE[task.type]} text-[10px]`}>{task.type}</Badge>
                    <span className="text-xs text-slate-600 ml-auto">{timeAgo(task.createdAt)}</span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Center panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {showCreateForm ? (
          <CreateTaskForm onCreated={handleTaskCreated} />
        ) : selectedTask ? (
          <TaskDetails task={selectedTask} onRefresh={fetchTasks} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <div className="bg-[#13131a] border border-[#1e1e2c] rounded-xl p-8 max-w-sm">
              <p className="text-slate-400 text-sm mb-4">
                Выберите задачу из списка или создайте новую
              </p>
              <button
                onClick={openCreateForm}
                className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
              >
                + Новая задача
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right sidebar */}
      <RightSidebar tasks={tasks} />
    </div>
  )
}
