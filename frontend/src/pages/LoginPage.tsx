import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { Mail, Lock, ArrowRight, Zap, Check } from 'lucide-react';

const FEATURES = [
  'Импорт карточек из Ozon, Яндекс, WB, Мегамаркет',
  'ИИ-нормализация и автозаполнение атрибутов',
  'Массовая выгрузка на любые площадки',
  'Автономный агент-разработчик для PIM',
];

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    // Check if Google OAuth is configured (public endpoint, no token needed)
    axios.get('/api/v1/auth/config').then(r => {
      setGoogleEnabled(!!r.data?.google_enabled);
    }).catch(() => {});

    // Handle OAuth callback from hash fragment (after Google redirect)
    const hash = window.location.hash;
    if (hash.startsWith('#/oauth-callback')) {
      const params = new URLSearchParams(hash.replace('#/oauth-callback?', ''));
      const token = params.get('token');
      const role = params.get('role') || 'admin';
      const emailParam = params.get('email') || '';
      if (token) {
        login(token, role, emailParam);
        navigate('/');
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const fd = new URLSearchParams();
      fd.append('username', email);
      fd.append('password', password);
      const res = await axios.post('/api/v1/auth/login', fd, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      login(res.data.access_token, res.data.role, email);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.status === 401 ? 'Неверный email или пароль' : 'Ошибка подключения к серверу');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = '/api/v1/auth/google/login';
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--bg-void)', position: 'relative', overflow: 'hidden' }}>
      {/* Ambient orbs */}
      <div className="orb orb-indigo" style={{ width: 700, height: 700, top: -200, left: -200, position: 'fixed', zIndex: 0 }} />
      <div className="orb orb-purple" style={{ width: 500, height: 500, bottom: -100, right: -100, position: 'fixed', zIndex: 0 }} />

      {/* Left panel */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '48px 56px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
        {/* Logo */}
        <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 24px rgba(99,102,241,0.5)' }}>
            <Zap size={18} color="white" />
          </div>
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)' }}>
            PIM<span style={{ background: 'linear-gradient(135deg,#818cf8,#c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>.giper.fm</span>
          </span>
        </div>

        {/* Main text */}
        <div className="animate-fade-up delay-150">
          <div className="badge badge-purple" style={{ marginBottom: 20, display: 'inline-flex' }}>
            <Zap size={9} /> Product Intelligence Platform
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-0.04em', color: 'rgba(255,255,255,0.95)', lineHeight: 1.1, marginBottom: 16 }}>
            Умный каталог<br />
            <span style={{ background: 'linear-gradient(135deg,#818cf8 20%,#c084fc 60%,#22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundSize: '200% 200%', animation: 'gradient-shift 4s ease infinite' }}>
              для маркетплейсов
            </span>
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7, maxWidth: 380 }}>
            Агрегируйте данные из всех площадок, обогащайте карточки с помощью ИИ и выгружайте без ручного переноса полей.
          </p>
        </div>

        {/* Features */}
        <div className="animate-fade-up delay-300" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {FEATURES.map(f => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Check size={10} color="#34d399" />
              </div>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>{f}</span>
            </div>
          ))}
        </div>

        {/* Version */}
        <div className="animate-fade-in delay-400" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)' }}>v3.0</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.08)' }}>·</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)' }}>Production</span>
        </div>
      </div>

      {/* Right panel - form */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div className="animate-scale-in" style={{ width: '100%', maxWidth: 380 }}>
          {/* Card */}
          <div style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '36px 32px' }}>
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', marginBottom: 6 }}>Войти в систему</h2>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Введите ваши данные для доступа</p>
            </div>

            {error && (
              <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 13, color: '#f87171' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginBottom: 8, letterSpacing: '0.02em' }}>EMAIL</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.2)' }} />
                  <input
                    type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="admin@company.com"
                    className="input-premium"
                    style={{ paddingLeft: 38 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginBottom: 8, letterSpacing: '0.02em' }}>ПАРОЛЬ</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.2)' }} />
                  <input
                    type="password" required value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input-premium"
                    style={{ paddingLeft: 38 }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-glow"
                style={{ marginTop: 8, padding: '12px 20px', borderRadius: 10, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', opacity: loading ? 0.7 : 1 }}
              >
                {loading ? (
                  <>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', animation: 'spin-slow 0.8s linear infinite' }} />
                    Входим...
                  </>
                ) : (
                  <>Войти <ArrowRight size={15} /></>
                )}
              </button>

              {googleEnabled && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>или</span>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
                  </div>
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                      width: '100%', padding: '11px 16px', borderRadius: 10, fontSize: 14, fontWeight: 500,
                      background: '#fff', color: '#1f1f1f', border: 'none', cursor: 'pointer',
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                    Войти через Google
                  </button>
                </>
              )}
            </form>
          </div>

          {/* Bottom hint */}
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.15)', marginTop: 20 }}>
            Нет доступа? Обратитесь к администратору
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
