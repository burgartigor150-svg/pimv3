import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

interface ToastContextValue {
  toast: (message: string, type?: Toast['type']) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const ToastContext = createContext<ToastContextValue | null>(null)

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

// ─── Icon components ──────────────────────────────────────────────────────────

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 8l3.5 3.5L13 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconX({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconWarning() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1.5L1 14h14L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 6v4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  )
}

function IconInfo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7v5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="8" cy="4.5" r="0.75" fill="currentColor" />
    </svg>
  )
}

// ─── Config per type ──────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  Toast['type'],
  { borderColor: string; iconColor: string; icon: React.ReactNode }
> = {
  success: {
    borderColor: 'border-l-emerald-500',
    iconColor: 'text-emerald-400',
    icon: <IconCheck />,
  },
  error: {
    borderColor: 'border-l-rose-500',
    iconColor: 'text-rose-400',
    icon: <IconX />,
  },
  warning: {
    borderColor: 'border-l-amber-500',
    iconColor: 'text-amber-400',
    icon: <IconWarning />,
  },
  info: {
    borderColor: 'border-l-sky-500',
    iconColor: 'text-sky-400',
    icon: <IconInfo />,
  },
}

// ─── Single toast item ────────────────────────────────────────────────────────

interface ToastItemProps {
  toast: Toast
  onRemove: (id: string) => void
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    setVisible(false)
    setTimeout(() => onRemove(toast.id), 300)
  }, [onRemove, toast.id])

  useEffect(() => {
    // Trigger slide-in on next tick
    const raf = requestAnimationFrame(() => setVisible(true))

    const duration = toast.duration ?? (toast.type === 'error' ? 6000 : 4000)
    timerRef.current = setTimeout(dismiss, duration)

    return () => {
      cancelAnimationFrame(raf)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [dismiss, toast.duration, toast.type])

  const cfg = TYPE_CONFIG[toast.type]

  return (
    <div
      className={[
        'flex items-start gap-3 min-w-[280px] max-w-[380px]',
        'bg-[#13131a] border border-[#1e1e2c] border-l-4 rounded-xl px-4 py-3 shadow-xl',
        cfg.borderColor,
        'transition-all duration-300 ease-out',
        visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0',
      ].join(' ')}
    >
      {/* Icon */}
      <span className={`mt-0.5 shrink-0 ${cfg.iconColor}`}>{cfg.icon}</span>

      {/* Message */}
      <p className="flex-1 text-sm text-slate-100 leading-snug">{toast.message}</p>

      {/* Close */}
      <button
        onClick={dismiss}
        className="shrink-0 mt-0.5 text-slate-500 hover:text-slate-300 transition-colors"
        aria-label="Dismiss"
      >
        <IconX size={14} />
      </button>
    </div>
  )
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (message: string, type: Toast['type'] = 'info', duration?: number) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setToasts((prev) => [...prev, { id, type, message, duration }])
    },
    [],
  )

  const value: ToastContextValue = {
    toast: addToast,
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    warning: (msg) => addToast(msg, 'warning'),
    info: (msg) => addToast(msg, 'info'),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Portal-like fixed container */}
      <div
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
