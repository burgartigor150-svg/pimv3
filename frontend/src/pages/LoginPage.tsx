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
  const { login } = useAuth();
  const navigate = useNavigate();

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
