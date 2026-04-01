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

function StatusDot({ status }: { status: TaskStatus }) {
  const bg =
    status === 'running' ? '#22d3ee' :
    status === 'completed' ? '#10b981' :
    status === 'failed' ? '#f87171' :
    status === 'cancelled' ? 'rgba(255,255,255,0.2)' :
    'rgba(255,255,255,0.15)'
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%', background: bg,
      display: 'inline-block', flexShrink: 0,
      animation: status === 'running' ? 'glow-pulse 1.5s ease infinite' : undefined,
    }} />
  )
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Ожидание',
  running: 'Выполняется',
  completed: 'Завершено',
  failed: 'Ошибка',
  cancelled: 'Отменено',
}

const STATUS_BADGE_CLS: Record<TaskStatus, string> = {
  pending: 'badge badge-neutral',
  running: 'badge badge-info',
  completed: 'badge badge-success',
  failed: 'badge badge-error',
  cancelled: 'badge badge-neutral',
}

const TYPE_COLOR: Record<TaskType, string> = {
  design: 'badge badge-purple',
  backend: 'badge badge-info',
  'api-integration': 'badge badge-info',
  'docs-ingest': 'badge badge-warning',
  frontend: 'badge badge-purple',
  qa: 'badge badge-success',
}

const PRIORITY_CONFIG: Record<
  Priority,
  { label: string; activeStyle: React.CSSProperties; inactiveStyle: React.CSSProperties }
> = {
  critical: {
    label: 'Critical',
    activeStyle: { background: '#f87171', color: '#fff', border: '1px solid #f87171' },
    inactiveStyle: { background: 'transparent', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' },
  },
  high: {
    label: 'High',
    activeStyle: { background: '#fb923c', color: '#fff', border: '1px solid #fb923c' },
    inactiveStyle: { background: 'transparent', color: '#fb923c', border: '1px solid rgba(251,146,60,0.25)' },
  },
  normal: {
    label: 'Normal',
    activeStyle: { background: '#6366f1', color: '#fff', border: '1px solid #6366f1' },
    inactiveStyle: { background: 'transparent', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.12)' },
  },
  low: {
    label: 'Low',
    activeStyle: { background: '#22d3ee', color: '#03030a', border: '1px solid #22d3ee' },
    inactiveStyle: { background: 'transparent', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.25)' },
  },
}

const TASK_TYPES: TaskType[] = [
  'design', 'backend', 'api-integration', 'docs-ingest', 'frontend', 'qa',
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function Input({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </label>
      )}
      <input className="input-premium" {...props} />
    </div>
  )
}

function Textarea({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </label>
      )}
      <textarea
        style={{
          background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8, padding: '8px 12px', fontSize: 14, color: 'rgba(255,255,255,0.9)',
          outline: 'none', width: '100%', resize: 'none', fontFamily: 'inherit',
          transition: 'border-color 0.2s',
        }}
        rows={4}
        {...props}
      />
    </div>
  )
}

function SelectField({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </label>
      )}
      <select
        style={{
          background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8, padding: '8px 12px', fontSize: 14, color: 'rgba(255,255,255,0.9)',
          outline: 'none', width: '100%', appearance: 'none',
        }}
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
      .catch(() => {})
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
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '24px', maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.95)', marginBottom: 24, marginTop: 0 }}>
          Создать задачу агента
        </h2>

        {templates.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, marginTop: 0 }}>
              Шаблоны
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="btn-ghost-premium"
                  style={{ fontSize: 13 }}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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

          <SelectField
            label="Тип задачи"
            value={type}
            onChange={(e) => setType(e.target.value as TaskType)}
          >
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </SelectField>

          {/* Priority selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
              Приоритет
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {(Object.keys(PRIORITY_CONFIG) as Priority[]).map((p) => {
                const cfg = PRIORITY_CONFIG[p]
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 13,
                      fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                      ...(priority === p ? cfg.activeStyle : cfg.inactiveStyle),
                    }}
                  >
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Depends on */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
              Зависит от
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input-premium"
                style={{ flex: 1 }}
                placeholder="ID задачи..."
                value={dependsOnInput}
                onChange={(e) => setDependsOnInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addDependency() }
                }}
              />
              <button
                type="button"
                onClick={addDependency}
                className="btn-ghost-premium"
                style={{ whiteSpace: 'nowrap', fontSize: 13 }}
              >
                + Добавить
              </button>
            </div>
            {dependsOn.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {dependsOn.map((id) => (
                  <span
                    key={id}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: 'rgba(99,102,241,0.12)', color: '#a5b4fc',
                      border: '1px solid rgba(99,102,241,0.25)',
                      padding: '2px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace',
                    }}
                  >
                    {id}
                    <button
                      type="button"
                      onClick={() => removeDependency(id)}
                      style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1, opacity: 0.7 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
            <button
              type="submit"
              disabled={submitting}
              className="btn-glow"
              style={{ opacity: submitting ? 0.6 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}
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

  useEffect(() => {
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [task.logs, activeTab])

  useEffect(() => {
    if (activeTab !== 'diff') return
    setDiffLoading(true)
    apiFetch<{ diff: string }>(`/tasks/${task.id}/diff`)
      .then((res) => setDiff(res.diff))
      .catch((err) => toastError(`Не удалось загрузить diff: ${err.message}`))
      .finally(() => setDiffLoading(false))
  }, [activeTab, task.id, toastError])

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.95)', margin: 0, lineHeight: 1.4 }}>
            {task.title}
          </h2>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <span className={TYPE_COLOR[task.type]}>{task.type}</span>
            <span className={STATUS_BADGE_CLS[task.status]}>{STATUS_LABEL[task.status]}</span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: 0 }}>{timeAgo(task.createdAt)}</p>

        {task.status === 'running' && (
          <div className="progress-track" style={{ marginTop: 12, height: 3 }}>
            <div className="progress-fill" style={{ width: '60%', animation: 'progress-indeterminate 2s ease-in-out infinite' }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={handleRerun} className="btn-ghost-premium" style={{ fontSize: 13 }}>
            ↺ Перезапустить
          </button>
          <button onClick={handlePRDescription} className="btn-ghost-premium" style={{ fontSize: 13 }}>
            PR Description
          </button>
          <button
            onClick={handleRollback}
            className="btn-ghost-premium"
            style={{ fontSize: 13, color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
          >
            Откат
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 24px' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 16px', fontSize: 13, fontWeight: 500, background: 'none', border: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? '#6366f1' : 'transparent'}`,
              color: activeTab === tab.id ? '#818cf8' : 'rgba(255,255,255,0.4)',
              cursor: 'pointer', transition: 'color 0.15s', marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Details tab */}
        {activeTab === 'details' && (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {task.description && (
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: 0 }}>
                  Описание
                </p>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6, margin: 0 }}>{task.description}</p>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, marginTop: 0 }}>ID</p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', margin: 0 }}>{task.id}</p>
              </div>
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, marginTop: 0 }}>Приоритет</p>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', textTransform: 'capitalize', margin: 0 }}>{task.priority ?? 'normal'}</p>
              </div>
              {task.updatedAt && (
                <div>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, marginTop: 0 }}>Обновлено</p>
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>{timeAgo(task.updatedAt)}</p>
                </div>
              )}
              {task.dependsOn && task.dependsOn.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, marginTop: 0 }}>Зависит от</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {task.dependsOn.map((id) => (
                      <span key={id} style={{ fontSize: 12, color: '#a5b4fc', fontFamily: 'monospace', background: 'rgba(99,102,241,0.1)', padding: '1px 6px', borderRadius: 4 }}>
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {task.result && (
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: 0 }}>
                  Результат
                </p>
                <pre style={{
                  fontSize: 13, color: 'rgba(255,255,255,0.65)', background: '#0f0f1a',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
                  padding: 16, overflowX: 'auto', whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace', lineHeight: 1.6, margin: 0,
                }}>
                  {task.result}
                </pre>
              </div>
            )}
            {task.error && (
              <div>
                <p style={{ fontSize: 11, color: '#f87171', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: 0 }}>
                  Ошибка
                </p>
                <pre style={{
                  fontSize: 13, color: '#fca5a5', background: 'rgba(248,113,113,0.05)',
                  border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8,
                  padding: 16, overflowX: 'auto', whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace', lineHeight: 1.6, margin: 0,
                }}>
                  {task.error}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Logs tab */}
        {activeTab === 'logs' && (
          <div style={{ padding: 16 }}>
            {task.logs && task.logs.length > 0 ? (
              <div style={{
                background: '#0a0a12', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: 12,
                color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, overflowX: 'auto',
              }}>
                {task.logs.map((line, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12 }}>
                    <span style={{ color: 'rgba(255,255,255,0.15)', userSelect: 'none', minWidth: 32, textAlign: 'right' }}>
                      {String(i + 1).padStart(4, ' ')}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.6)' }}>{line}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>
                Логи отсутствуют
              </div>
            )}
          </div>
        )}

        {/* Diff tab */}
        {activeTab === 'diff' && (
          <div style={{ padding: 16 }}>
            {diffLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
                Загрузка diff...
              </div>
            ) : diff ? (
              <pre style={{
                background: '#0a0a12', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: 12,
                color: 'rgba(255,255,255,0.6)', overflowX: 'auto', lineHeight: 1.7,
                whiteSpace: 'pre', margin: 0,
              }}>
                {diff.split('\n').map((line, i) => {
                  let style: React.CSSProperties = { display: 'block', color: 'rgba(255,255,255,0.4)' }
                  if (line.startsWith('+') && !line.startsWith('+++'))
                    style = { display: 'block', color: '#10b981', background: 'rgba(16,185,129,0.06)' }
                  if (line.startsWith('-') && !line.startsWith('---'))
                    style = { display: 'block', color: '#f87171', background: 'rgba(248,113,113,0.06)' }
                  if (line.startsWith('@@'))
                    style = { display: 'block', color: '#818cf8' }
                  return <span key={i} style={style}>{line}</span>
                })}
              </pre>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>
                Diff недоступен
              </div>
            )}
          </div>
        )}

        {/* Metrics tab */}
        {activeTab === 'metrics' && (
          <div style={{ padding: 24 }}>
            {metricsLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
                Загрузка метрик...
              </div>
            ) : metrics ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Токены', value: metrics.tokens?.toLocaleString() ?? '—', accent: '#6366f1' },
                  { label: 'Шаги', value: metrics.steps?.toLocaleString() ?? '—', accent: '#a855f7' },
                  {
                    label: 'Стоимость',
                    value: metrics.cost !== undefined ? `$${metrics.cost.toFixed(4)}` : '—',
                    accent: '#22d3ee',
                  },
                  {
                    label: 'Длительность',
                    value:
                      metrics.durationMs !== undefined
                        ? metrics.durationMs < 1000
                          ? `${metrics.durationMs}ms`
                          : `${(metrics.durationMs / 1000).toFixed(1)}s`
                        : '—',
                    accent: '#10b981',
                  },
                ].map(({ label, value, accent }) => (
                  <div
                    key={label}
                    className="super-box"
                    style={{ padding: 20, borderRadius: 12 }}
                  >
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, marginTop: 0 }}>
                      {label}
                    </p>
                    <p style={{ fontSize: 28, fontWeight: 700, color: accent, margin: 0, letterSpacing: '-0.02em' }}>{value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>
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
    <div style={{ width: 240, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      {/* Stats */}
      <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, marginTop: 0 }}>
          Статистика
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="super-box" style={{ flex: 1, padding: '10px 8px', textAlign: 'center', borderRadius: 10 }}>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#22d3ee', margin: 0 }}>{runningCount}</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2, marginBottom: 0 }}>Запущено</p>
          </div>
          <div className="super-box" style={{ flex: 1, padding: '10px 8px', textAlign: 'center', borderRadius: 10 }}>
            <p style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.65)', margin: 0 }}>{pendingCount}</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2, marginBottom: 0 }}>В очереди</p>
          </div>
        </div>
      </div>

      {/* Cron jobs */}
      <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, marginTop: 0 }}>
          Cron задачи
        </p>
        {cronJobs.length === 0 ? (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', margin: 0 }}>Нет активных cron задач</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cronJobs.map((job) => (
              <div key={job.id} className="super-box" style={{ padding: 10, borderRadius: 8 }}>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.name}
                </p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', marginTop: 2, marginBottom: 0 }}>
                  {job.schedule}
                </p>
                <p style={{ fontSize: 11, color: '#6366f1', marginTop: 4, marginBottom: 0 }}>
                  ↻ {new Date(job.nextFireTime).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Queue */}
      <div style={{ padding: 16 }}>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, marginTop: 0 }}>
          Очередь
        </p>
        {queue.length === 0 ? (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', margin: 0 }}>Очередь пуста</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {queue.slice(0, 5).map((item, index) => (
              <div
                key={item.id}
                className="super-box"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8 }}
              >
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', width: 16, flexShrink: 0 }}>{index + 1}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </span>
                <span className={TYPE_COLOR[item.type]} style={{ fontSize: 10 }}>{item.type.slice(0, 3)}</span>
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
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 110px)', overflow: 'hidden', background: '#03030a' }}>
      {/* Left: task list 280px */}
      <div style={{ width: 280, borderRight: '1px solid rgba(255,255,255,0.06)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h1 style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.95)', margin: 0, letterSpacing: '0.01em' }}>
              Agent Console
            </h1>
            {loading && (
              <StatusDot status="running" />
            )}
          </div>
          <button onClick={openCreateForm} className="btn-glow" style={{ width: '100%', justifyContent: 'center' }}>
            + Новая задача
          </button>
        </div>

        {/* Task list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tasks.length === 0 && !loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'rgba(255,255,255,0.2)', fontSize: 13, textAlign: 'center', padding: '0 16px' }}>
              Задач пока нет. Создайте первую.
            </div>
          ) : (
            tasks.map((task) => {
              const isSelected = task.id === selectedId
              return (
                <button
                  key={task.id}
                  onClick={() => handleSelectTask(task.id)}
                  style={{
                    width: '100%', textAlign: 'left', background: isSelected ? 'rgba(99,102,241,0.08)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    borderLeft: `2px solid ${isSelected ? '#6366f1' : 'transparent'}`,
                    padding: isSelected ? '10px 12px 10px 10px' : '10px 12px',
                    cursor: 'pointer', transition: 'background 0.15s', border: 'none',
                    borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'rgba(255,255,255,0.04)',
                    borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: isSelected ? '#6366f1' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusDot status={task.status} />
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {task.title}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, paddingLeft: 16 }}>
                    <span className={TYPE_COLOR[task.type]} style={{ fontSize: 10 }}>{task.type}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>{timeAgo(task.createdAt)}</span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Center: details/form flex:1 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {showCreateForm ? (
          <CreateTaskForm onCreated={handleTaskCreated} />
        ) : selectedTask ? (
          <TaskDetails task={selectedTask} onRefresh={fetchTasks} />
        ) : (
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: '0 24px' }}>
            <div className="glass" style={{ padding: 32, borderRadius: 16, maxWidth: 320 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 20 }}>
                ⚡
              </div>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 16, margin: '0 0 16px' }}>
                Выберите задачу из списка или создайте новую
              </p>
              <button onClick={openCreateForm} className="btn-glow">
                + Новая задача
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right sidebar 240px */}
      <RightSidebar tasks={tasks} />
    </div>
  )
}
