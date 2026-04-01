import axios from 'axios'
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Check, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append('username', email);
      formData.append('password', password);
      const res = await axios.post('/api/v1/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      login(res.data.access_token, res.data.role, email);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неверный логин или пароль');
    } finally {
      setLoading(false);
    }
  };

  const features = [
    'Импорт карточек из любого маркетплейса',
    'ИИ-нормализация атрибутов',
    'Автоматический перенос на площадки',
    'Агент-разработчик для PIM-системы',
  ];

  return (
    <div className="bg-[#0d0d10] lg:grid lg:grid-cols-2 h-screen">
      {/* Left Panel */}
      <div className="bg-[#13131a] border-r border-[#1e1e2c] hidden lg:flex flex-col justify-between p-12">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-slate-100 text-lg font-semibold tracking-tight">PIM.Giper.fm</span>
        </div>

        {/* Tagline + features */}
        <div className="space-y-8">
          <p className="text-slate-400 text-lg leading-relaxed max-w-sm">
            Умный каталог товаров для Ozon, Яндекс Маркет, Wildberries и Мегамаркет
          </p>

          <ul className="space-y-3">
            {features.map((feat, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-emerald-400" />
                </span>
                <span className="text-sm text-slate-300">{feat}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Version badge */}
        <div>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs text-slate-500 bg-[#1c1c28] border border-[#1e1e2c]">
            v3.0
          </span>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex items-center justify-center p-8 h-full">
        <div className="bg-[#13131a] border border-[#1e1e2c] rounded-2xl p-8 w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-6 lg:hidden">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-slate-100 font-semibold">PIM.Giper.fm</span>
          </div>

          <h1 className="text-slate-100 text-xl font-semibold mb-1">Войти в систему</h1>
          <p className="text-slate-500 text-sm mb-6">Введите ваши учётные данные</p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm text-slate-400 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.ru"
                  className="bg-[#0d0d10] border border-[#28283a] rounded-lg pl-9 pr-3 py-2.5 text-slate-100 w-full focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 outline-none text-sm placeholder:text-slate-600 transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm text-slate-400 mb-1.5">
                Пароль
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="bg-[#0d0d10] border border-[#28283a] rounded-lg pl-9 pr-3 py-2.5 text-slate-100 w-full focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 outline-none text-sm placeholder:text-slate-600 transition-colors"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2.5 rounded-lg transition-all active:scale-95 disabled:opacity-50 mt-2 text-sm"
            >
              {loading ? 'Входим…' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
