import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Sliders, Share2, Plug, Map,
  Bot, Terminal, MessageSquare, Sparkles, Clock, Users,
  Settings, ShieldCheck, ChevronLeft, ChevronRight,
  Bell, LogOut, Zap, Activity, Search,
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';

// ─── Pages ───────────────────────────────────────────────────────────────────
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import ProductDetailsPage from './pages/ProductDetailsPage';
import AttributesPage from './pages/AttributesPage';
import IntegrationsPage from './pages/IntegrationsPage';
import SyndicationPage from './pages/SyndicationPage';
import AttributeStarMapPage from './pages/AttributeStarMapPage';
import AgentTaskConsolePage from './pages/AgentTaskConsolePage';
import AgentAssistantPage from './pages/AgentAssistantPage';
import AgentDashboard from './pages/AgentDashboard';
import SelfImproveConsolePage from './pages/SelfImproveConsolePage';
import AdminDialogConsolePage from './pages/AdminDialogConsolePage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';

// ─── Nav groups ───────────────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: 'Каталог',
    items: [
      { path: '/dashboard', label: 'Дашборд', icon: <LayoutDashboard size={16} /> },
      { path: '/products', label: 'Товары', icon: <Package size={16} /> },
      { path: '/attributes', label: 'Атрибуты', icon: <Sliders size={16} /> },
      { path: '/syndication', label: 'Выгрузка', icon: <Share2 size={16} /> },
    ],
  },
  {
    label: 'Маркетплейсы',
    items: [
      { path: '/integrations', label: 'Подключения', icon: <Plug size={16} /> },
      { path: '/star-map', label: 'Star Map', icon: <Map size={16} /> },
    ],
  },
  {
    label: 'Агент',
    items: [
      { path: '/agent-dashboard', label: 'Метрики', icon: <Activity size={16} /> },
      { path: '/agent-console', label: 'Консоль', icon: <Terminal size={16} /> },
      { path: '/agent-assistant', label: 'Ассистент', icon: <MessageSquare size={16} /> },
      { path: '/self-improve', label: 'Self-Improve', icon: <Sparkles size={16} /> },
      { path: '/agent-cron', label: 'Расписание', icon: <Clock size={16} /> },
    ],
  },
  {
    label: 'Система',
    items: [
      { path: '/users', label: 'Пользователи', icon: <Users size={16} /> },
      { path: '/settings', label: 'Настройки', icon: <Settings size={16} /> },
      { path: '/admin-console', label: 'Консоль', icon: <ShieldCheck size={16} /> },
    ],
  },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const Sidebar: React.FC<{ collapsed: boolean; onToggle: () => void }> = ({ collapsed, onToggle }) => {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <aside
      style={{
        width: collapsed ? 56 : 220,
        transition: 'width 0.3s cubic-bezier(0.16,1,0.3,1)',
        background: 'rgba(255,255,255,0.02)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0,
        flexShrink: 0,
        overflow: 'hidden',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Logo */}
      <div style={{ padding: '20px 14px 16px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between' }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 16px rgba(99,102,241,0.5)',
            }}>
              <Zap size={14} color="white" />
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'rgba(255,255,255,0.95)', whiteSpace: 'nowrap', letterSpacing: '-0.02em' }}>
              PIM<span style={{ background: 'linear-gradient(135deg,#818cf8,#c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>.giper</span>
            </span>
          </div>
        )}
        {collapsed && (
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 16px rgba(99,102,241,0.5)',
          }}>
            <Zap size={14} color="white" />
          </div>
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: 4, cursor: 'pointer', color: 'rgba(255,255,255,0.4)', display: 'flex', transition: 'all 0.2s' }}
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={onToggle}
          style={{ margin: '0 auto 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '4px', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', display: 'flex' }}
        >
          <ChevronRight size={13} />
        </button>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 0 8px' }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 4 }}>
            {!collapsed && (
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)', padding: '12px 16px 4px' }}>
                {group.label}
              </div>
            )}
            {collapsed && <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '6px 8px' }} />}
            {group.items.map((item) => {
              const active = location.pathname.startsWith(item.path);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: collapsed ? 0 : 10,
                    padding: collapsed ? '9px 0' : '8px 16px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    textDecoration: 'none',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: active ? '#818cf8' : 'rgba(255,255,255,0.45)',
                    background: active ? 'rgba(99,102,241,0.1)' : 'transparent',
                    borderLeft: active ? '2px solid #6366f1' : '2px solid transparent',
                    transition: 'all 0.18s',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    boxShadow: active ? 'inset 4px 0 12px rgba(99,102,241,0.08)' : 'none',
                  }}
                >
                  <span style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }}>{item.icon}</span>
                  {!collapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: collapsed ? '12px 0' : '12px 12px' }}>
        {collapsed ? (
          <button
            onClick={logout}
            title="Выйти"
            style={{ width: '100%', display: 'flex', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '6px 0' }}
          >
            <LogOut size={15} />
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0 }}>
              {(user?.email?.[0] ?? 'U').toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email ?? 'User'}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{(user as any)?.role ?? 'admin'}</div>
            </div>
            <button onClick={logout} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', display: 'flex', padding: 4, borderRadius: 6, transition: 'all 0.2s' }}>
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};

// ─── Top Header ───────────────────────────────────────────────────────────────

const TopHeader: React.FC = () => {
  const location = useLocation();
  const allItems = NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.label })));
  const current = allItems.find(i => location.pathname.startsWith(i.path));

  return (
    <header style={{
      height: 52,
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      background: 'rgba(255,255,255,0.01)',
      backdropFilter: 'blur(20px)',
      flexShrink: 0,
      position: 'sticky',
      top: 0,
      zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>PIM</span>
        {current && <>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.1)' }}>/</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>{current.group}</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.1)' }}>/</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{current.label}</span>
        </>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '6px 12px', color: 'rgba(255,255,255,0.3)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={13} /> Поиск...
          <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: 4, color: 'rgba(255,255,255,0.2)' }}>⌘K</span>
        </button>
        <button style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: 7, cursor: 'pointer', color: 'rgba(255,255,255,0.35)', display: 'flex', position: 'relative' }}>
          <Bell size={15} />
          <span style={{ position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: '50%', background: '#6366f1', border: '1px solid #03030a' }} />
        </button>
      </div>
    </header>
  );
};

// ─── Shell ────────────────────────────────────────────────────────────────────

const AppShell: React.FC = () => {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pim_sb') === '1');
  const toggle = useCallback(() => setCollapsed(v => { localStorage.setItem('pim_sb', v ? '0' : '1'); return !v; }), []);

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-void)', overflow: 'hidden' }}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TopHeader />
        <main style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
          <Routes>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"       element={<DashboardPage />} />
            <Route path="/products"        element={<ProductsPage />} />
            <Route path="/products/:id"    element={<ProductDetailsPage />} />
            <Route path="/attributes"      element={<AttributesPage />} />
            <Route path="/syndication"     element={<SyndicationPage />} />
            <Route path="/integrations"    element={<IntegrationsPage />} />
            <Route path="/star-map"        element={<AttributeStarMapPage />} />
            <Route path="/agent-dashboard" element={<AgentDashboard />} />
            <Route path="/agent-console"   element={<AgentTaskConsolePage />} />
            <Route path="/agent-assistant" element={<AgentAssistantPage />} />
            <Route path="/self-improve"    element={<SelfImproveConsolePage />} />
            <Route path="/agent-cron"      element={<div style={{padding:40,color:'rgba(255,255,255,0.3)',textAlign:'center'}}>Cron — coming soon</div>} />
            <Route path="/users"           element={<UsersPage />} />
            <Route path="/settings"        element={<SettingsPage />} />
            <Route path="/admin-console"   element={<AdminDialogConsolePage />} />
            <Route path="*"               element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const { user } = useAuth();
  return (
    <BrowserRouter>
      <Routes>
        {!user ? (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<Navigate to="/dashboard" replace />} />
            <Route path="/*" element={<AppShell />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
};

const Root: React.FC = () => (
  <ToastProvider>
    <App />
  </ToastProvider>
);

export default Root;
