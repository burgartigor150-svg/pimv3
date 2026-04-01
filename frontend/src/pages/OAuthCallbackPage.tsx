import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function OAuthCallbackPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const role = params.get('role') || 'admin';
    const email = params.get('email') || '';
    const error = params.get('error');

    if (error || !token) {
      navigate('/login?error=' + (error || 'no_token'), { replace: true });
      return;
    }

    login(token, role, email);
    navigate('/', { replace: true });
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid rgba(99,102,241,0.3)', borderTopColor: '#6366f1', animation: 'spin-slow 0.8s linear infinite' }} />
        <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Авторизация через Google...</span>
      </div>
    </div>
  );
}
