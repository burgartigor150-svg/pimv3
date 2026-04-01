import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Package, Database, FolderOpen, Plug, TrendingUp,
  ArrowUpRight, Zap, Activity, Plus, RefreshCw,
} from 'lucide-react';

// ─── Animated counter ────────────────────────────────────────────────────────

const Counter: React.FC<{ to: number; duration?: number }> = ({ to, duration = 1200 }) => {
  const [val, setVal] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!to) return;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * to));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [to, duration]);
  return <>{val.toLocaleString('ru')}</>;
};

// ─── Mini sparkline ──────────────────────────────────────────────────────────

const Sparkline: React.FC<{ color: string }> = ({ color }) => {
  const pts = [30, 45, 35, 55, 42, 68, 50, 75, 60, 82, 70, 90].map((v, i) => `${i * 18},${100 - v}`).join(' ');
  return (
    <svg width="100%" height="40" viewBox="0 0 198 100" preserveAspectRatio="none" style={{ opacity: 0.7 }}>
      <defs>
        <linearGradient id={`sg-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  glowColor: string;
  trend?: string;
  delay?: number;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, icon, color, glowColor, trend, delay = 0 }) => (
  <div
    className="animate-fade-up"
    style={{
      animationDelay: `${delay}ms`,
      background: 'var(--bg-card)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 22px',
      position: 'relative',
      overflow: 'hidden',
      cursor: 'default',
      transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)';
      (e.currentTarget as HTMLDivElement).style.borderColor = `${color}40`;
      (e.currentTarget as HTMLDivElement).style.boxShadow = `0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px ${color}20`;
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLDivElement).style.transform = '';
      (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.06)';
      (e.currentTarget as HTMLDivElement).style.boxShadow = '';
    }}
  >
    {/* BG glow */}
    <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle, ${glowColor}, transparent 70%)`, opacity: 0.4, pointerEvents: 'none' }} />

    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
      <div style={{ background: `${color}18`, border: `1px solid ${color}30`, borderRadius: 10, padding: 9, color, display: 'flex' }}>
        {icon}
      </div>
      {trend && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 99, padding: '2px 8px' }}>
          <TrendingUp size={10} /> {trend}
        </span>
      )}
    </div>

    <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', lineHeight: 1, marginBottom: 6 }}>
      <Counter to={value} />
    </div>
    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>{label}</div>

    <div style={{ marginTop: 14, marginBottom: -4 }}>
      <Sparkline color={color} />
    </div>
  </div>
);

// ─── Donut chart ─────────────────────────────────────────────────────────────

const DonutChart: React.FC<{ pct: number }> = ({ pct }) => {
  const r = 54, cx = 68, cy = 68;
  const circ = 2 * Math.PI * r;
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDrawn(pct), 200);
    return () => clearTimeout(t);
  }, [pct]);
  const dash = (drawn / 100) * circ;

  return (
    <svg width={136} height={136} viewBox="0 0 136 136">
      <defs>
        <linearGradient id="donut-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={12} />
      {/* Fill */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="url(#donut-grad)"
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ / 4}
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.16,1,0.3,1)', filter: 'drop-shadow(0 0 8px rgba(99,102,241,0.6))' }}
      />
    </svg>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

interface Stats {
  total_products: number;
  total_categories: number;
  total_attributes: number;
  total_connections: number;
  average_completeness: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/v1/stats')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const kpis = [
    { label: 'Товаров в каталоге', value: stats?.total_products ?? 0, icon: <Package size={18} />, color: '#6366f1', glowColor: 'rgba(99,102,241,0.5)', trend: '+12%', delay: 0 },
    { label: 'Категорий', value: stats?.total_categories ?? 0, icon: <FolderOpen size={18} />, color: '#a855f7', glowColor: 'rgba(168,85,247,0.5)', trend: '+5%', delay: 80 },
    { label: 'Атрибутов', value: stats?.total_attributes ?? 0, icon: <Database size={18} />, color: '#22d3ee', glowColor: 'rgba(34,211,238,0.4)', trend: '+3%', delay: 160 },
    { label: 'Подключений', value: stats?.total_connections ?? 0, icon: <Plug size={18} />, color: '#10b981', glowColor: 'rgba(16,185,129,0.4)', trend: 'active', delay: 240 },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Background orbs */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        <div className="orb orb-indigo" style={{ width: 600, height: 600, top: -200, left: -100, animationDuration: '15s' }} />
        <div className="orb orb-purple" style={{ width: 500, height: 500, top: 300, right: -100, animationDuration: '20s', animationDelay: '-5s' }} />
        <div className="orb orb-cyan" style={{ width: 400, height: 400, bottom: -100, left: '40%', animationDuration: '18s', animationDelay: '-8s' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <div className="animate-fade-up" style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', marginBottom: 6, lineHeight: 1.1 }}>
              Добро пожаловать 👋
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', maxWidth: 460, lineHeight: 1.6 }}>
              Единая база товаров → ИИ создаёт идеальную карточку → выгрузка на Ozon, Яндекс, WB, Мегамаркет
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-ghost-premium" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={13} style={{ opacity: loading ? 1 : 0.7, animation: loading ? 'spin-slow 1s linear infinite' : 'none' }} />
              Обновить
            </button>
            <Link to="/products" style={{ textDecoration: 'none' }}>
              <button className="btn-glow" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Plus size={14} /> Добавить товар
              </button>
            </Link>
          </div>
        </div>

        {/* KPI Grid */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, marginBottom: 24 }}>
            {[0,1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 160, borderRadius: 16 }} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, marginBottom: 24 }}>
            {kpis.map(k => <KpiCard key={k.label} {...k} />)}
          </div>
        )}

        {/* Bottom row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, alignItems: 'start' }}>

          {/* Completeness super-box */}
          <div className="super-box animate-fade-up delay-300" style={{ padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: 4 }}>
                  Индекс здоровья каталога
                </h2>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Completeness score по всем товарам</p>
              </div>
              <span className="badge badge-info">
                <Activity size={10} /> live
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <DonutChart pct={stats?.average_completeness ?? 0} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: 'rgba(255,255,255,0.95)', letterSpacing: '-0.04em', lineHeight: 1 }}>
                    {stats?.average_completeness ?? 0}%
                  </span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>заполнено</span>
                </div>
              </div>

              <div style={{ flex: 1 }}>
                {[
                  { label: 'Полные карточки', pct: stats?.average_completeness ?? 0, color: '#6366f1' },
                  { label: 'С изображениями', pct: Math.round((stats?.average_completeness ?? 0) * 0.9), color: '#a855f7' },
                  { label: 'С описанием', pct: Math.round((stats?.average_completeness ?? 0) * 0.75), color: '#22d3ee' },
                ].map(row => (
                  <div key={row.label} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{row.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{row.pct}%</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${row.pct}%`, background: `linear-gradient(90deg, ${row.color}, ${row.color}aa)` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick start card */}
          <div className="animate-fade-up delay-400" style={{
            background: 'linear-gradient(160deg, rgba(99,102,241,0.15), rgba(168,85,247,0.08), rgba(34,211,238,0.05))',
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: 16,
            padding: 24,
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Glow */}
            <div style={{ position: 'absolute', top: -40, right: -40, width: 150, height: 150, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.4), transparent 70%)', pointerEvents: 'none' }} />

            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.95)', marginBottom: 6, position: 'relative' }}>
              <Zap size={15} style={{ display: 'inline', marginRight: 6, color: '#fbbf24', verticalAlign: 'text-bottom' }} />
              Быстрый старт
            </h3>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 20, lineHeight: 1.6, position: 'relative' }}>
              Три шага до первой выгрузки
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>
              {[
                { n: 1, title: 'Подключить магазин', desc: 'API ключи Ozon / Яндекс / WB / MM', path: '/integrations', color: '#6366f1' },
                { n: 2, title: 'Импортировать товары', desc: 'По артикулу из любого маркетплейса', path: '/products', color: '#a855f7' },
                { n: 3, title: 'Перенести карточки', desc: 'ИИ подберёт категорию и поля', path: '/syndication', color: '#22d3ee' },
              ].map(s => (
                <Link key={s.n} to={s.path} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', transition: 'all 0.2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = `${s.color}40`; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.06)'; }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: `${s.color}20`, border: `1px solid ${s.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: s.color, flexShrink: 0 }}>{s.n}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{s.desc}</div>
                  </div>
                  <ArrowUpRight size={13} style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.2)' }} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
