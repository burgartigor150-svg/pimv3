import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import { Box, Layers, Settings, Home, Users, Store, Share2, Network, Shield, FlaskConical } from 'lucide-react'
import AttributesPage from './pages/AttributesPage'
import ProductsPage from './pages/ProductsPage'
import ProductDetailsPage from './pages/ProductDetailsPage'
import IntegrationsPage from './pages/IntegrationsPage'
import SettingsPage from './pages/SettingsPage'
import DashboardPage from './pages/DashboardPage'
import ChatWidget from './components/ChatWidget'
import SyndicationPage from './pages/SyndicationPage'
import AttributeStarMapPage from './pages/AttributeStarMapPage'
import AdminDialogConsolePage from './pages/AdminDialogConsolePage'
import SelfImproveConsolePage from './pages/SelfImproveConsolePage'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import UsersPage from './pages/UsersPage'

// Override global fetch to automatically inject Authorization header if logged in
const originalFetch = window.fetch;
window.fetch = async (input, init = {}) => {
  if (typeof input === 'string' && input.startsWith('/api/')) {
    const token = localStorage.getItem('token');
    if (token) {
      init.headers = {
        ...init.headers,
        'Authorization': `Bearer ${token}`
      };
    }
  }
  const response = await originalFetch(input, init);
  if (response.status === 401) {
    localStorage.removeItem('token');
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }
  return response;
};

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 p-2 rounded-md text-sm transition-colors ${
    isActive
      ? 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-900 dark:text-indigo-100 font-semibold shadow-sm'
      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
  }`

function App() {
  return (
    <AuthProvider>
      <Router>
      <div className="flex h-screen bg-background text-foreground">
        {/* Sidebar */}
        <aside className="w-64 border-r border-border bg-slate-50 dark:bg-slate-900 p-4 flex flex-col gap-4">
          <div className="font-extrabold text-2xl mb-6 flex items-center gap-2 tracking-tight">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-1.5 rounded-lg shadow-sm">
              <Box className="w-5 h-5" strokeWidth={2.5} />
            </div>
            <div>
              <span className="text-slate-900 dark:text-white">PIM.</span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-600">Giper.fm</span>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            <NavLink to="/" end className={navLinkClass}>
              <Home className="w-5 h-5 shrink-0" /> Дашборд
            </NavLink>
            <NavLink to="/products" className={navLinkClass}>
              <Layers className="w-5 h-5 shrink-0" /> Каталог товаров
            </NavLink>
            <NavLink to="/attributes" className={navLinkClass}>
              <Settings className="w-5 h-5 shrink-0" /> Схема атрибутов
            </NavLink>
            <NavLink to="/syndication" className={navLinkClass}>
              <Share2 className="w-5 h-5 shrink-0" /> Массовая выгрузка
            </NavLink>
            <NavLink to="/attribute-star-map" className={navLinkClass}>
              <Network className="w-5 h-5 shrink-0" /> Star Map векторов
            </NavLink>
            <NavLink to="/integrations" className={navLinkClass}>
              <Store className="w-5 h-5 shrink-0" /> Магазины и ключи API
            </NavLink>
            <NavLink to="/users" className={navLinkClass}>
              <Users className="w-5 h-5 shrink-0" /> Пользователи
            </NavLink>
            <NavLink to="/settings" className={navLinkClass}>
              <Settings className="w-5 h-5 shrink-0" /> Настройки ИИ
            </NavLink>
            <NavLink to="/admin-dialog-console" className={navLinkClass}>
              <Shield className="w-5 h-5 shrink-0" /> Админ консоль
            </NavLink>
            <NavLink to="/self-improve-console" className={navLinkClass}>
              <FlaskConical className="w-5 h-5 shrink-0" /> Self-Improve
            </NavLink>
          </nav>
          <p className="mt-auto text-[11px] text-slate-500 dark:text-slate-400 leading-snug border-t border-slate-200 dark:border-slate-700 pt-3">
            Сначала подключите магазины, затем импортируйте товары в каталог. Выгрузка на площадки — из карточки или раздела «Массовая выгрузка».
          </p>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8 overflow-y-auto">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/attributes" element={<AttributesPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/:id" element={<ProductDetailsPage />} />
              <Route path="/syndication" element={<SyndicationPage />} />
              <Route path="/attribute-star-map" element={<AttributeStarMapPage />} />
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin-dialog-console" element={<AdminDialogConsolePage />} />
              <Route path="/self-improve-console" element={<SelfImproveConsolePage />} />
            </Route>
          </Routes>
        </main>
        <ChatWidget />
      </div>
      </Router>
    </AuthProvider>
  )
}

export default App
