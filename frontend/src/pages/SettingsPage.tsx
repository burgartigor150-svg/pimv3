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
      alert('Настройки успешно сохранены!');
    } catch (e: any) {
      alert('Ошибка при сохранении: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h2 className="text-3xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
          <Settings className="w-8 h-8 text-indigo-500" /> Настройки ИИ
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mt-2">
          Здесь задаётся «мозг» для подсказок и автоматических шагов: сбор идеальной карточки, маппинг под маркетплейсы, подсказки в чате. Ключи маркетплейсов настраиваются отдельно в разделе{' '}
          <Link to="/integrations" className="text-indigo-600 dark:text-indigo-400 underline font-medium">магазинов и ключей API</Link>.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/90 dark:bg-amber-950/30 p-4 text-sm text-amber-950 dark:text-amber-100">
        Не пересылайте API-ключ в мессенджеры и не сохраняйте в общих файлах. Доступ к этой странице должен быть только у доверенных сотрудников.
      </div>

      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <h3 className="text-xl font-bold flex items-center gap-2 mb-2 text-slate-900 dark:text-white">
          <Cpu className="w-6 h-6 text-indigo-500" /> Какой ИИ использовать
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          <strong>Облако (DeepSeek)</strong> — удобно для продакшена: не нужен свой сервер с видеокартой. <strong>Локально (Ollama)</strong> — если у вас уже поднят Ollama на машине с бэкендом; качество и скорость зависят от выбранной модели на сервере.
        </p>

        <div className="flex flex-col gap-4 mb-6">
          <label className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${aiProvider === 'deepseek' ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500' : 'border-slate-200 dark:border-slate-700'}`}>
            <input type="radio" name="provider" value="deepseek" checked={aiProvider === 'deepseek'} onChange={(e) => setAiProvider(e.target.value)} className="mt-1" />
            <div>
              <div className="font-bold flex items-center gap-2 text-slate-900 dark:text-white"><Cloud className="w-4 h-4"/> DeepSeek (облако)</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Нужен ключ с сайта DeepSeek. Обычно лучше распознаёт сложные задачи маппинга.</div>
            </div>
          </label>
          <label className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${aiProvider === 'local' ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500' : 'border-slate-200 dark:border-slate-700'}`}>
            <input type="radio" name="provider" value="local" checked={aiProvider === 'local'} onChange={(e) => setAiProvider(e.target.value)} className="mt-1" />
            <div>
              <div className="font-bold flex items-center gap-2 text-slate-900 dark:text-white"><Cpu className="w-4 h-4"/> Локальный Ollama</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Запросы идут на адрес, настроенный на сервере (часто Qwen и аналоги). Подходит для тестов и закрытого контура.</div>
            </div>
          </label>
        </div>
        
        {aiProvider === 'deepseek' && (
          <label className="flex flex-col gap-2 mb-6">
            <span className="font-medium text-sm text-slate-800 dark:text-slate-200">Секретный ключ DeepSeek</span>
            <input 
              type="password"
              className="border p-3 rounded-lg dark:bg-slate-900 dark:border-slate-600 dark:text-white font-mono text-sm"
              placeholder="Вставьте ключ из личного кабинета DeepSeek"
              value={deepseekKey}
              onChange={e => setDeepseekKey(e.target.value)}
            />
            <span className="text-xs text-slate-500">После сохранения ключ хранится на сервере в настройках приложения.</span>
          </label>
        )}

        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="bg-green-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-green-700 flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-5 h-5" /> {isSaving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
