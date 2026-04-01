import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Save, Settings, Cpu, Cloud, Key } from 'lucide-react';
import { useToast } from '../components/Toast';

export default function SettingsPage() {
  const { toast } = useToast();
  const [deepseekKey, setDeepseekKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.0-flash');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [aiProvider, setAiProvider] = useState('deepseek');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.get('/settings').then(res => {
      const settings = res.data;
      const get = (id: string) => settings.find((s: any) => s.id === id)?.value ?? '';
      setDeepseekKey(get('deepseek_api_key'));
      setGeminiKey(get('gemini_api_key'));
      setGeminiModel(get('gemini_model') || 'gemini-2.0-flash');
      setGoogleClientId(get('google_client_id'));
      setGoogleClientSecret(get('google_client_secret'));
      setAiProvider(get('ai_provider') || 'deepseek');
    });
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await Promise.all([
        api.post('/settings/ai_provider', { value: aiProvider }),
        api.post('/settings/deepseek_api_key', { value: deepseekKey }),
        api.post('/settings/gemini_api_key', { value: geminiKey }),
        api.post('/settings/gemini_model', { value: geminiModel }),
        api.post('/settings/google_client_id', { value: googleClientId }),
        api.post('/settings/google_client_secret', { value: googleClientSecret }),
      ]);
      toast('Настройки сохранены', 'success');
    } catch (e: any) {
      toast('Ошибка при сохранении: ' + e.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const providerCardStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    padding: '16px 18px',
    borderRadius: 12,
    border: active ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)',
    background: active ? 'rgba(99,102,241,0.08)' : '#141422',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
  });

  const inputStyle: React.CSSProperties = { fontFamily: 'monospace' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 680 }}>

      {/* Page header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Settings size={20} color="#6366f1" />
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', margin: 0 }}>
            Настройки
          </h1>
        </div>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, maxWidth: 580 }}>
          Ключи ИИ и OAuth авторизация. Ключи маркетплейсов — в разделе{' '}
          <Link to="/integrations" style={{ color: '#6366f1', textDecoration: 'underline' }}>магазинов и ключей API</Link>.
        </p>
      </div>

      {/* Security warning */}
      <div style={{ background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'rgba(255,220,100,0.75)', lineHeight: 1.5 }}>
        ⚠️ Не пересылайте API-ключи в мессенджеры. Доступ к этой странице — только у доверенных сотрудников.
      </div>

      {/* AI Provider */}
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Cpu size={16} color="#6366f1" />
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>ИИ провайдер</h2>
        </div>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 20, lineHeight: 1.6 }}>
          Выберите модель для автозаполнения атрибутов, чата и агентов.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {/* Gemini */}
          <label style={providerCardStyle(aiProvider === 'gemini')}>
            <input type="radio" name="provider" value="gemini"
              checked={aiProvider === 'gemini'} onChange={e => setAiProvider(e.target.value)}
              style={{ accentColor: '#6366f1', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontSize: 14, marginBottom: 4 }}>
                <Cloud size={14} color="#4ade80" /> Gemini (Google)
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                Gemini 2.0 Flash — быстрый и дешёвый. Ключ получить на <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: '#4ade80' }}>aistudio.google.com</a>.
              </div>
            </div>
          </label>

          {/* DeepSeek */}
          <label style={providerCardStyle(aiProvider === 'deepseek')}>
            <input type="radio" name="provider" value="deepseek"
              checked={aiProvider === 'deepseek'} onChange={e => setAiProvider(e.target.value)}
              style={{ accentColor: '#6366f1', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontSize: 14, marginBottom: 4 }}>
                <Cloud size={14} color="#22d3ee" /> DeepSeek (облако)
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                Нужен ключ с сайта DeepSeek. Хорошо распознаёт сложные задачи маппинга.
              </div>
            </div>
          </label>

          {/* Local */}
          <label style={providerCardStyle(aiProvider === 'local')}>
            <input type="radio" name="provider" value="local"
              checked={aiProvider === 'local'} onChange={e => setAiProvider(e.target.value)}
              style={{ accentColor: '#6366f1', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontSize: 14, marginBottom: 4 }}>
                <Cpu size={14} color="#a855f7" /> Локальный Ollama
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                Запросы идут на Ollama на сервере. Для тестов и закрытого контура.
              </div>
            </div>
          </label>
        </div>

        {/* Gemini settings */}
        {aiProvider === 'gemini' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>Gemini API Key</span>
              <input type="password" className="input-premium" placeholder="AIza..." value={geminiKey}
                onChange={e => setGeminiKey(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>Модель</span>
              <select className="input-premium" value={geminiModel} onChange={e => setGeminiModel(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.85)' }}>
                <option value="gemini-2.0-flash">gemini-2.0-flash (рекомендуется)</option>
                <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite</option>
                <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro</option>
              </select>
            </label>
          </div>
        )}

        {/* DeepSeek key */}
        {aiProvider === 'deepseek' && (
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>Секретный ключ DeepSeek</span>
              <input type="password" className="input-premium"
                placeholder="Вставьте ключ из личного кабинета DeepSeek"
                value={deepseekKey} onChange={e => setDeepseekKey(e.target.value)} style={inputStyle} />
            </label>
          </div>
        )}

        <button onClick={handleSave} disabled={isSaving} className="btn-glow"
          style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: isSaving ? 0.6 : 1 }}>
          <Save size={15} />
          {isSaving ? 'Сохранение…' : 'Сохранить настройки ИИ'}
        </button>
      </div>

      {/* Google OAuth */}
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Key size={16} color="#4ade80" />
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>Google OAuth</h2>
        </div>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 20, lineHeight: 1.6 }}>
          Позволяет пользователям входить через Google аккаунт. Получить Client ID в{' '}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"
            style={{ color: '#4ade80' }}>Google Cloud Console</a>.
        </p>

        <div style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
          <strong style={{ color: 'rgba(74,222,128,0.8)' }}>Инструкция:</strong><br />
          1. Открой <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" style={{ color: '#4ade80' }}>console.cloud.google.com</a> → Создать учётные данные → ID клиента OAuth 2.0<br />
          2. Тип: <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Веб-приложение</strong><br />
          3. Разрешённые URI перенаправления: <code style={{ color: '#4ade80', background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: 4 }}>https://pim.giper.fm.postobot.online/api/v1/auth/google/callback</code><br />
          4. Вставь Client ID и Client Secret ниже
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>Google Client ID</span>
            <input type="text" className="input-premium"
              placeholder="xxxxxxxxxx-xxxxxxxxxxxx.apps.googleusercontent.com"
              value={googleClientId} onChange={e => setGoogleClientId(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>Google Client Secret</span>
            <input type="password" className="input-premium"
              placeholder="GOCSPX-..."
              value={googleClientSecret} onChange={e => setGoogleClientSecret(e.target.value)} style={inputStyle} />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
              После сохранения кнопка "Войти через Google" появится на странице входа.
            </span>
          </label>
        </div>

        <button onClick={handleSave} disabled={isSaving} className="btn-glow"
          style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: isSaving ? 0.6 : 1 }}>
          <Save size={15} />
          {isSaving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>

    </div>
  );
}
