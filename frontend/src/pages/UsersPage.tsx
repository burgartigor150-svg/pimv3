import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Users, Trash2 } from 'lucide-react';

interface User {
  id: string;
  email: string;
  role: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const { user: currentUser } = useAuth();

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка загрузки пользователей');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users', {
        email: newEmail,
        password: newPassword,
        role: 'manager'
      });
      setNewEmail('');
      setNewPassword('');
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка при создании пользователя');
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('Удалить этого пользователя?')) return;
    try {
      await api.delete(`/users/${id}`);
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка удаления');
    }
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Users size={28} color="rgba(99,102,241,0.6)" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginBottom: 8 }}>Доступ запрещён</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Управление пользователями доступно только Администратору.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Page header */}
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', marginBottom: 4 }}>
          Сотрудники
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', maxWidth: 560, lineHeight: 1.6 }}>
          Кто может заходить в систему. Ключи маркетплейсов и ИИ настраиваются отдельно — выдавайте роли осознанно.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#f87171' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>

        {/* Users table */}
        <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>
              Загрузка...
            </div>
          ) : (
            <table className="table-premium">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Роль</th>
                  <th style={{ textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>{u.email}</td>
                    <td>
                      <span className={u.role === 'admin' ? 'badge badge-purple' : 'badge badge-info'}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        disabled={currentUser?.email === u.email}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: currentUser?.email === u.email ? 'not-allowed' : 'pointer',
                          color: 'rgba(255,255,255,0.25)',
                          padding: 6,
                          borderRadius: 6,
                          display: 'inline-flex',
                          opacity: currentUser?.email === u.email ? 0.3 : 1,
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => { if (currentUser?.email !== u.email) (e.currentTarget as HTMLButtonElement).style.color = '#f87171'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.25)'; }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add user form */}
        <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(99,102,241,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>+</span>
            Добавить коллегу
          </h2>
          <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>Email</span>
              <input
                type="email"
                required
                className="input-premium"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="colleague@company.com"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>Пароль</span>
              <input
                type="password"
                required
                className="input-premium"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Минимум 8 символов"
              />
            </label>
            <button type="submit" className="btn-glow" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
              Создать аккаунт
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
