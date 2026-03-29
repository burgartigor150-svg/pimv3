import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Users, Trash2, Plus, Mail, Lock } from 'lucide-react';

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
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
           <Users className="w-16 h-16 text-slate-400 mx-auto mb-4" />
           <h2 className="text-2xl font-bold dark:text-white">Доступ запрещен</h2>
           <p className="text-slate-500 mt-2">Управление пользователями доступно только Администратору.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Сотрудники</h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-2xl">
          Кто может заходить в систему. Ключи маркетплейсов и ИИ настраиваются отдельно (магазины и «Настройки ИИ») — их видит любой пользователь с доступом к этим разделам, поэтому выдавайте роли осознанно.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-border rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-border">
              <tr>
                <th className="py-4 px-6 font-medium text-slate-500 text-sm">Email</th>
                <th className="py-4 px-6 font-medium text-slate-500 text-sm">Роль</th>
                <th className="py-4 px-6 font-medium text-slate-500 text-sm text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={3} className="text-center py-8 text-slate-500">Загрузка...</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="py-4 px-6 font-medium">{u.email}</td>
                  <td className="py-4 px-6">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                      {u.role}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right">
                    <button 
                      onClick={() => handleDeleteUser(u.id)}
                      disabled={currentUser.email === u.email}
                      className="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-30"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-border rounded-xl shadow-sm p-6 h-fit">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-blue-500" /> Добавить коллегу
          </h2>
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="email" 
                  required 
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-border rounded-lg py-2 pl-9 pr-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="colleague@company.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="password" 
                  required 
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-border rounded-lg py-2 pl-9 pr-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Минимум 8 символов"
                />
              </div>
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-medium transition-colors">
              Создать аккаунт
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
