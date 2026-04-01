import React, { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Sliders,
  Share2,
  Plug,
  Map,
  Bot,
  Terminal,
  MessageSquare,
  Sparkles,
  Clock,
  Users,
  Settings,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Bell,
  LogOut,
  Zap,
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import AgentDashboard from './pages/AgentDashboard';
import AttributesPage from './pages/AttributesPage';
import IntegrationsPage from './pages/IntegrationsPage';
import SyndicationPage from './pages/SyndicationPage';
import AttributeStarMapPage from './pages/AttributeStarMapPage';
import AgentTaskConsolePage from './pages/AgentTaskConsolePage';
import AgentAssistantPage from './pages/AgentAssistantPage';
import SelfImproveConsolePage from './pages/SelfImproveConsolePage';
import AdminDialogConsolePage from './pages/AdminDialogConsolePage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import ProductDetailsPage from './pages/ProductDetailsPage';
import { ToastProvider } from './components/Toast';


// ─── Placeholder ──────────────────────────────────────────────────────────────

const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => (
  <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
    <div className="w-14 h-14 rounded-2xl bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border-subtle))] flex items-center justify-center mb-4">
      <Zap className="w-6 h-6 text-[rgb(var(--text-faint))]" />
    </div>
    <h2 className="text-[rgb(var(--text-primary))] text-lg font-semibold mb-1">{title}</h2>
    <p className="text-[rgb(var(--text-muted))] text-sm max-w-xs">
      Эта страница находится в разработке
    </p>
  </div>
);

// ─── Nav structure ────────────────────────────────────────────────────────────

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'КАТАЛОГ',
    items: [
      { path: '/dashboard',    label: 'Dashboard',    icon: <LayoutDashboard className="w-4 h-4 flex-shrink-0" /> },
      { path: '/products',     label: 'Products',     icon: <Package          className="w-4 h-4 flex-shrink-0" /> },
      { path: '/attributes',   label: 'Attributes',   icon: <Sliders          className="w-4 h-4 flex-shrink-0" /> },
      { path: '/syndication',  label: 'Syndication',  icon: <Share2           className="w-4 h-4 flex-shrink-0" /> },
    ],
  },
  {
    label: 'МАРКЕТПЛЕЙСЫ',
    items: [
      { path: '/integrations', label: 'Integrations', icon: <Plug             className="w-4 h-4 flex-shrink-0" /> },
      { path: '/star-map',     label: 'Star Map',     icon: <Map              className="w-4 h-4 flex-shrink-0" /> },
    ],
  },
  {
    label: 'АГЕНТ',
    items: [
      { path: '/agent-dashboard', label: 'Agent Dashboard', icon: <Bot           className="w-4 h-4 flex-shrink-0" /> },
      { path: '/agent-console',   label: 'Agent Console',   icon: <Terminal      className="w-4 h-4 flex-shrink-0" /> },
      { path: '/agent-assistant', label: 'Agent Assistant', icon: <MessageSquare className="w-4 h-4 flex-shrink-0" /> },
      { path: '/self-improve',    label: 'Self-Improve',    icon: <Sparkles      className="w-4 h-4 flex-shrink-0" /> },
      { path: '/agent-cron',      label: 'Cron',            icon: <Clock         className="w-4 h-4 flex-shrink-0" /> },
    ],
  },
  {
    label: 'СИСТЕМА',
    items: [
      { path: '/users',         label: 'Users',         icon: <Users       className="w-4 h-4 flex-shrink-0" /> },
      { path: '/settings',      label: 'Settings',      icon: <Settings    className="w-4 h-4 flex-shrink-0" /> },
      { path: '/admin-console', label: 'Admin Console', icon: <ShieldCheck className="w-4 h-4 flex-shrink-0" /> },
    ],
  },
];

// ─── Hooks ────────────────────────────────────────────────────────────────────

function usePageMeta(): { title: string; sectionLabel: string } {
  const { pathname } = useLocation();
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.path === pathname) {
        return { title: item.label, sectionLabel: group.label };
      }
    }
  }
  return { title: '', sectionLabel: '' };
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const { user, logout } = useAuth();
  const email: string = (user as { email?: string } | null)?.email ?? '';

  return (
    <aside
      className="flex flex-col h-full bg-[rgb(var(--bg-card))] border-r border-[rgb(var(--border-subtle))] transition-[width] duration-200 ease-in-out overflow-hidden"
      style={{ width: collapsed ? '56px' : '220px', minWidth: collapsed ? '56px' : '220px' }}
    >
      {/* Logo + toggle */}
      <div className="flex items-center h-14 px-3 border-b border-[rgb(var(--border-subtle))] flex-shrink-0">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <span className="text-[rgb(var(--text-primary))] font-semibold text-sm tracking-tight truncate slide-in">
              PIM
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-[rgb(var(--text-faint))] hover:text-[rgb(var(--text-muted))] hover:bg-[rgb(var(--bg-elevated))] transition-all ml-1"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : <ChevronLeft  className="w-3.5 h-3.5" />
          }
        </button>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 space-y-4">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label}>
            {collapsed ? (
              groupIndex > 0 && (
                <div className="mx-3 mb-2 border-t border-[rgb(var(--border-subtle))]" />
              )
            ) : (
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--text-faint))]">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5 px-2">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }: { isActive: boolean }) =>
                      [
                        'flex items-center gap-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                        collapsed ? 'justify-center px-0 py-2' : 'px-2.5 py-2',
                        isActive
                          ? 'bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))] border-l-2 border-[rgb(var(--accent))]'
                          : 'text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--bg-elevated))]',
                      ].join(' ')
                    }
                  >
                    {item.icon}
                    {!collapsed && (
                      <span className="truncate">{item.label}</span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* User info + logout */}
      <div className="flex-shrink-0 border-t border-[rgb(var(--border-subtle))] p-2">
        {!collapsed ? (
          <div className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[rgb(var(--bg-elevated))] transition-all group">
            <div className="w-7 h-7 rounded-full bg-[rgb(var(--accent))]/20 flex items-center justify-center flex-shrink-0 text-[rgb(var(--accent))] text-xs font-semibold">
              {email.charAt(0).toUpperCase() || 'U'}
            </div>
            <span className="flex-1 text-xs text-[rgb(var(--text-muted))] truncate min-w-0">
              {email || 'user'}
            </span>
            <button
              onClick={logout}
              className="opacity-0 group-hover:opacity-100 text-[rgb(var(--text-faint))] hover:text-red-400 transition-all flex-shrink-0"
              title="Выйти"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={logout}
            className="w-full flex items-center justify-center py-2 rounded-lg text-[rgb(var(--text-faint))] hover:text-red-400 hover:bg-[rgb(var(--bg-elevated))] transition-all"
            title="Выйти"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
};

// ─── Top header bar ───────────────────────────────────────────────────────────

const TopHeader: React.FC = () => {
  const { user } = useAuth();
  const { title, sectionLabel } = usePageMeta();
  const email: string = (user as { email?: string } | null)?.email ?? '';

  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-card))] flex-shrink-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-[rgb(var(--text-faint))]">PIM</span>
        {sectionLabel && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-[rgb(var(--text-faint))]" />
            <span className="text-[rgb(var(--text-faint))]">{sectionLabel}</span>
          </>
        )}
        {title && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-[rgb(var(--text-faint))]" />
            <span className="text-[rgb(var(--text-primary))] font-medium">{title}</span>
          </>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        <button
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--bg-elevated))] transition-all relative"
          title="Уведомления"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[rgb(var(--accent))]" />
        </button>
        <div className="w-7 h-7 rounded-full bg-[rgb(var(--accent))]/20 flex items-center justify-center text-[rgb(var(--accent))] text-xs font-semibold flex-shrink-0">
          {email.charAt(0).toUpperCase() || 'U'}
        </div>
      </div>
    </header>
  );
};

// ─── App shell (authenticated layout) ────────────────────────────────────────

const STORAGE_KEY = 'pim_sidebar_collapsed';

const AppShell: React.FC = () => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-[rgb(var(--bg-base))]">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopHeader />
        <main className="flex-1 overflow-y-auto bg-[rgb(var(--bg-base))]">
          <Routes>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"       element={<DashboardPage />} />
            <Route path="/products"        element={<ProductsPage />} />
            <Route path="/products/:id"     element={<ProductDetailsPage />} />
            <Route path="/attributes"      element={<AttributesPage />} />
            <Route path="/syndication"     element={<SyndicationPage />} />
            <Route path="/integrations"    element={<IntegrationsPage />} />
            <Route path="/star-map"        element={<AttributeStarMapPage />} />
            <Route path="/agent-dashboard" element={<AgentDashboard />} />
            <Route path="/agent-console"   element={<AgentTaskConsolePage />} />
            <Route path="/agent-assistant" element={<AgentAssistantPage />} />
            <Route path="/self-improve"    element={<SelfImproveConsolePage />} />
            <Route path="/agent-cron"      element={<PlaceholderPage title="Cron" />} />
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

// ─── Root App ─────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const { user, isAuthenticated } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        {!user ? (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*"     element={<Navigate to="/login" replace />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<Navigate to="/dashboard" replace />} />
            <Route path="/*"    element={<AppShell />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
};

const AppWithToast: React.FC = () => (
  <ToastProvider>
    <App />
  </ToastProvider>
);
export default AppWithToast;
