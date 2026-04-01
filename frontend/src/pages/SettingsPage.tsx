import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Save, Settings, Cpu, Cloud } from 'lucide-react';

export default function SettingsPage() {
  const [deepseekKey, setDeepseekKey] = useState('');
  const [aiProvider, setAiProvider] = useState('deepseek');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.get('/settings').then(res => {
      const settings = res.data;
      const dsKey = settings.find((s: any) => s.id === 'deepseek_api_key');
      if (dsKey) setDeepseekKey(dsKey.value);
      const provider = settings.find((s: any) => s.id === 'ai_provider');
      if (provider) setAiProvider(provider.value);
    });
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.post('/settings/deepseek_api_key', { value: deepseekKey });
      await api.post('/settings/ai_provider', { value: aiProvider });
      console.error('Настройки успешно сохранены!');
    } catch (e: any) {
      console.error('Ошибка при сохранении: ' + e.message);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 680 }}>

      {/* Page header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Settings size={20} color="#6366f1" />
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', margin: 0 }}>
            Настройки ИИ
          </h1>
        </div>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, maxWidth: 580 }}>
          Здесь задаётся «мозг» для подсказок и автоматических шагов. Ключи маркетплейсов настраиваются отдельно в разделе{' '}
          <Link to="/integrations" style={{ color: '#6366f1', textDecoration: 'underline' }}>магазинов и ключей API</Link>.
        </p>
      </div>

      {/* Security warning */}
      <div style={{ background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'rgba(255,220,100,0.75)', lineHeight: 1.5 }}>
        ⚠️ Не пересылайте API-ключ в мессенджеры и не сохраняйте в общих файлах. Доступ к этой странице должен быть только у доверенных сотрудников.
      </div>

      {/* Provider selection card */}
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Cpu size={16} color="#6366f1" />
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>Какой ИИ использовать</h2>
        </div>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 20, lineHeight: 1.6 }}>
          <strong style={{ color: 'rgba(255,255,255,0.55)' }}>Облако (DeepSeek)</strong> — удобно для продакшена: не нужен свой сервер с видеокартой.{' '}
          <strong style={{ color: 'rgba(255,255,255,0.55)' }}>Локально (Ollama)</strong> — если у вас уже поднят Ollama на машине с бэкендом.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          <label style={providerCardStyle(aiProvider === 'deepseek')}>
            <input
              type="radio"
              name="provider"
              value="deepseek"
              checked={aiProvider === 'deepseek'}
              onChange={e => setAiProvider(e.target.value)}
              style={{ accentColor: '#6366f1', marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontSize: 14, marginBottom: 4 }}>
                <Cloud size={14} color="#22d3ee" /> DeepSeek (облако)
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                Нужен ключ с сайта DeepSeek. Обычно лучше распознаёт сложные задачи маппинга.
              </div>
            </div>
          </label>

          <label style={providerCardStyle(aiProvider === 'local')}>
            <input
              type="radio"
              name="provider"
              value="local"
              checked={aiProvider === 'local'}
              onChange={e => setAiProvider(e.target.value)}
              style={{ accentColor: '#6366f1', marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontSize: 14, marginBottom: 4 }}>
                <Cpu size={14} color="#a855f7" /> Локальный Ollama
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                Запросы идут на адрес, настроенный на сервере (часто Qwen и аналоги). Подходит для тестов и закрытого контура.
              </div>
            </div>
          </label>
        </div>

        {aiProvider === 'deepseek' && (
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>Секретный ключ DeepSeek</span>
              <input
                type="password"
                className="input-premium"
                placeholder="Вставьте ключ из личного кабинета DeepSeek"
                value={deepseekKey}
                onChange={e => setDeepseekKey(e.target.value)}
                style={{ fontFamily: 'monospace' }}
              />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
                После сохранения ключ хранится на сервере в настройках приложения.
              </span>
            </label>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="btn-glow"
          style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: isSaving ? 0.6 : 1 }}
        >
          <Save size={15} />
          {isSaving ? 'Сохранение…' : 'Сохранить настройки'}
        </button>
      </div>
    </div>
  );
}
