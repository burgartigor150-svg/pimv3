import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  RefreshCw,
  TrendingUp,
  Cpu,
  ListTodo,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  total_tasks: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  success_rate: number;
  avg_duration_sec: number;
  tasks_today: number;
  last_24h: { hour: number; count: number }[];
}

interface Task {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  updated_at: string;
  duration_sec?: number;
}

interface ParallelStats {
  active_workers: number;
  queued: number;
  processed_today: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  running: '#6366f1',
  completed: '#10b981',
  failed: '#f87171',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидание',
  running: 'Выполняется',
  completed: 'Завершено',
  failed: 'Ошибка',
};

const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  backdropFilter: 'blur(20px)',
  position: 'relative',
  zIndex: 1,
};

// ─── Animated Counter ─────────────────────────────────────────────────────────

function useAnimatedCounter(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    const from = value;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 80;
  const H = 28;
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * W},${H - (v / max) * H}`)
    .join(' ');
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.7}
      />
    </svg>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number;
  suffix?: string;
  color: string;
  icon: React.ReactNode;
  sparkValues?: number[];
  trend?: string;
}

function KpiCard({ label, value, suffix = '', color, icon, sparkValues, trend }: KpiCardProps) {
  const animated = useAnimatedCounter(value);

  return (
    <div
      style={{
        ...CARD_STYLE,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        flex: 1,
        minWidth: 0,
      }}
      className="animate-fade-up"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 32, fontWeight: 700, lineHeight: 1 }}>
            {suffix === '%' ? animated.toFixed(0) : animated.toLocaleString()}
          </span>
          {suffix && (
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16, marginLeft: 4 }}>{suffix}</span>
          )}
        </div>
        {sparkValues && <Sparkline values={sparkValues} color={color} />}
      </div>
      {trend && (
        <span
          className="badge-purple"
          style={{ fontSize: 11, alignSelf: 'flex-start', padding: '2px 8px' }}
        >
          {trend}
        </span>
      )}
    </div>
  );
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function BarChart24h({ data }: { data: { hour: number; count: number }[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  const W = 100;
  const H = 60;
  const barW = W / data.length - 1;

  return (
    <svg width="100%" viewBox={`0 0 ${W * data.length} ${H + 20}`} style={{ display: 'block' }}>
      {data.map((d, i) => {
        const barH = (d.count / max) * H;
        const x = i * W + (W - barW) / 2;
        const y = H - barH;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={3}
              fill="url(#barGrad)"
              opacity={0.85}
            />
            <text
              x={x + barW / 2}
              y={H + 14}
              textAnchor="middle"
              fill="rgba(255,255,255,0.3)"
              fontSize={10}
            >
              {d.hour}
            </text>
          </g>
        );
      })}
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity={0.4} />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Worker Gauge ─────────────────────────────────────────────────────────────

function WorkerGauge({ active, max = 8 }: { active: number; max?: number }) {
  const pct = Math.min(active / max, 1);
  const r = 38;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - pct * 0.75);
  const rotation = -135;

  return (
    <svg width={100} height={80} style={{ display: 'block', margin: '0 auto' }}>
      <circle
        cx={50}
        cy={60}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={8}
        strokeDasharray={`${circ * 0.75} ${circ}`}
        strokeDashoffset={0}
        strokeLinecap="round"
        transform={`rotate(${rotation} 50 60)`}
      />
      <circle
        cx={50}
        cy={60}
        r={r}
        fill="none"
        stroke="url(#gaugeGrad)"
        strokeWidth={8}
        strokeDasharray={`${circ * 0.75} ${circ}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(${rotation} 50 60)`}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
      <text x={50} y={56} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize={18} fontWeight={700}>
        {active}
      </text>
      <text x={50} y={70} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={10}>
        / {max}
      </text>
      <defs>
        <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AgentDashboard() {
  const { toast } = useToast();

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [parallel, setParallel] = useState<ParallelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(15);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [dashRes, tasksRes, parallelRes] = await Promise.all([
        api.get('/agent/dashboard'),
        api.get('/agent/tasks?limit=5&sort=updated_at'),
        api.get('/agent/parallel/stats'),
      ]);
      setDashboard(dashRes.data);
      setTasks(tasksRes.data?.items ?? tasksRes.data ?? []);
      setParallel(parallelRes.data);
    } catch (e: any) {
      toast(e?.message ?? 'Ошибка загрузки данных', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Countdown + auto-refresh
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchAll();
          return 15;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (refreshRef.current) clearTimeout(refreshRef.current);
    };
  }, [fetchAll]);

  const sparkData = dashboard?.last_24h?.map((d) => d.count) ?? [2, 4, 3, 8, 5, 9, 7, 12, 10, 8];

  const kpis: KpiCardProps[] = dashboard
    ? [
        {
          label: 'Всего задач',
          value: dashboard.total_tasks,
          color: '#6366f1',
          icon: <ListTodo size={18} />,
          sparkValues: sparkData,
          trend: `+${dashboard.tasks_today} сегодня`,
        },
        {
          label: 'Выполнено',
          value: dashboard.completed,
          color: '#10b981',
          icon: <CheckCircle2 size={18} />,
          sparkValues: sparkData.map((v) => Math.round(v * 0.7)),
        },
        {
          label: 'Ошибки',
          value: dashboard.failed,
          color: '#f87171',
          icon: <XCircle size={18} />,
          sparkValues: sparkData.map((v) => Math.round(v * 0.1)),
        },
        {
          label: 'Успешность',
          value: dashboard.success_rate,
          suffix: '%',
          color: '#a855f7',
          icon: <TrendingUp size={18} />,
          sparkValues: [80, 82, 85, 88, 87, 90, 91, 89, 92, dashboard.success_rate],
        },
        {
          label: 'Среднее время',
          value: Math.round(dashboard.avg_duration_sec),
          suffix: 'с',
          color: '#f59e0b',
          icon: <Clock size={18} />,
          sparkValues: [12, 10, 14, 9, 11, 8, 10, 9, 11, Math.round(dashboard.avg_duration_sec)],
        },
      ]
    : [];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#03030a',
        color: 'rgba(255,255,255,0.9)',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '32px 40px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Animated orbs */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-15%',
            left: '-10%',
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
            animation: 'orbFloat 12s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-10%',
            right: '-5%',
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(168,85,247,0.10) 0%, transparent 70%)',
            animation: 'orbFloat 16s ease-in-out infinite reverse',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '40%',
            left: '40%',
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 70%)',
            animation: 'orbFloat 20s ease-in-out infinite 4s',
          }}
        />
        <style>{`
          @keyframes orbFloat {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(30px, -20px) scale(1.05); }
            66% { transform: translate(-20px, 15px) scale(0.97); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      </div>

      {/* Content wrapper */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1400, margin: '0 auto' }}>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 32,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' }}>
              Агент{' '}
              <span
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                / Метрики
              </span>
            </h1>
            {/* Live indicator */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: 20,
                padding: '4px 12px',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#10b981',
                  display: 'inline-block',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  boxShadow: '0 0 6px #10b981',
                }}
              />
              <span style={{ color: '#10b981', fontSize: 12, fontWeight: 600 }}>Live</span>
            </div>
          </div>

          {/* Countdown + refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
              Обновление через{' '}
              <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>{countdown}с</span>
            </span>
            <button
              onClick={() => { fetchAll(); setCountdown(15); }}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '6px 12px',
                color: 'rgba(255,255,255,0.6)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
              }}
            >
              <RefreshCw size={14} />
              Обновить
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>
            Загрузка…
          </div>
        ) : (
          <>
            {/* KPI Row */}
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginBottom: 24,
                flexWrap: 'wrap',
              }}
            >
              {kpis.map((kpi) => (
                <KpiCard key={kpi.label} {...kpi} />
              ))}
            </div>

            {/* Middle Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>

              {/* Active tasks */}
              <div style={{ ...CARD_STYLE, padding: 24 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 20,
                  }}
                >
                  <Activity size={18} color="#6366f1" />
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Активные задачи</h2>
                </div>
                {tasks.length === 0 ? (
                  <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>Нет задач</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {tasks.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid rgba(255,255,255,0.05)',
                          borderRadius: 10,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              color: 'rgba(255,255,255,0.85)',
                              fontSize: 13,
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: 220,
                            }}
                          >
                            {t.name ?? `Задача #${t.id}`}
                          </div>
                          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 2 }}>
                            {new Date(t.updated_at).toLocaleTimeString('ru')}
                          </div>
                        </div>
                        <span
                          style={{
                            background: `${STATUS_COLORS[t.status]}22`,
                            border: `1px solid ${STATUS_COLORS[t.status]}44`,
                            color: STATUS_COLORS[t.status],
                            borderRadius: 6,
                            padding: '3px 10px',
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {STATUS_LABELS[t.status] ?? t.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Parallel workers */}
              <div style={{ ...CARD_STYLE, padding: 24 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 20,
                  }}
                >
                  <Cpu size={18} color="#a855f7" />
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Параллельные воркеры</h2>
                </div>

                {parallel ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                    <WorkerGauge active={parallel.active_workers} max={8} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
                      {[
                        { label: 'Активных воркеров', value: parallel.active_workers, color: '#6366f1' },
                        { label: 'В очереди', value: parallel.queued, color: '#f59e0b' },
                        { label: 'Обработано сегодня', value: parallel.processed_today, color: '#10b981' },
                      ].map(({ label, value, color }) => (
                        <div key={label}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: 6,
                            }}
                          >
                            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{label}</span>
                            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 600 }}>
                              {value}
                            </span>
                          </div>
                          <div
                            style={{
                              height: 4,
                              background: 'rgba(255,255,255,0.06)',
                              borderRadius: 2,
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${Math.min((value / Math.max(parallel.processed_today, 1)) * 100, 100)}%`,
                                background: color,
                                borderRadius: 2,
                                transition: 'width 0.8s ease',
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>Нет данных</p>
                )}
              </div>
            </div>

            {/* Bar chart 24h */}
            <div style={{ ...CARD_STYLE, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <Zap size={18} color="#f59e0b" />
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Задачи за 24 часа</h2>
                {dashboard?.tasks_today !== undefined && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      color: 'rgba(255,255,255,0.35)',
                      fontSize: 13,
                    }}
                  >
                    Всего сегодня:{' '}
                    <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{dashboard.tasks_today}</strong>
                  </span>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                {dashboard?.last_24h?.length ? (
                  <BarChart24h data={dashboard.last_24h} />
                ) : (
                  <div
                    style={{
                      height: 80,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'rgba(255,255,255,0.2)',
                      fontSize: 14,
                    }}
                  >
                    Нет данных
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
