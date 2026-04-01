import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Sparkles, Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { connectionOptionLabel } from '../lib/marketplaceUi';

export default function SyndicationPage() {
  const [searchParams] = useSearchParams();
  const ids = searchParams.get('ids')?.split(',') || [];
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedConn, setSelectedConn] = useState('');
  const [taskId, setTaskId] = useState('');
  const [progress, setProgress] = useState<any>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isRepairStarting, setIsRepairStarting] = useState(false);
  const [scanLimit, setScanLimit] = useState('150');
  const selectedConnObj = connections.find((c: any) => c.id === selectedConn);
  const isMegamarketTarget = selectedConnObj?.type === 'megamarket';

  useEffect(() => {
    api.get('/connections').then(res => {
      setConnections(res.data);
      if (res.data.length > 0) setSelectedConn(res.data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!taskId) return;
    const interval = setInterval(() => {
      api.get(`/import/tasks/${taskId}`).then(res => {
        setProgress(res.data);
        if (res.data.status === 'completed' || res.data.status === 'failed') {
          clearInterval(interval);
        }
      }).catch(console.error);
    }, 2000);
    return () => clearInterval(interval);
  }, [taskId]);

  const handleStart = async () => {
    if (!selectedConn || ids.length === 0) return;
    setIsStarting(true);
    try {
      const res = await api.post('/syndicate/bulk', {
        connection_id: selectedConn,
        product_ids: ids
      });
      setTaskId(res.data.task_id);
    } catch (e: any) {
      console.error('Ошибка запуска: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsStarting(false);
    }
  };

  const handleStartMegamarketRepair = async () => {
    if (!selectedConnObj || selectedConnObj.type !== 'megamarket') {
      console.error('Выберите подключение Megamarket');
      return;
    }
    setIsRepairStarting(true);
    try {
      const n = parseInt(scanLimit.trim(), 10);
      const res = await api.post('/syndicate/mm/autofix-existing-errors', {
        connection_id: selectedConnObj.id,
        scan_limit: Number.isNaN(n) ? 150 : n,
      });
      setTaskId(res.data.task_id);
    } catch (e: any) {
      console.error('Ошибка запуска автоисправления: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsRepairStarting(false);
    }
  };

  const pct = progress ? Math.max(5, (progress.processed / progress.total) * 100) : 0;

  return (
    <div style={{ minHeight: '100vh', background: '#03030a', padding: '32px 24px' }}>
      <div className="animate-fade-up" style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 32 }}>
          <Link to="/products" style={{ color: 'rgba(255,255,255,0.35)', marginTop: 4, display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.95)', margin: 0 }}>
              Массовая выгрузка на маркетплейс
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 6, maxWidth: 620, lineHeight: 1.6 }}>
              Для каждого SKU ИИ подберёт категорию и поля под выбранный магазин, затем запросы уйдут в фоне. Один запуск — одна цель.
            </p>
          </div>
        </div>

        {/* Main card */}
        <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>

          {/* State: no ids and no task */}
          {!taskId && ids.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 680 }}>

              {/* Warning banner */}
              <div style={{ background: 'rgba(248,184,29,0.06)', border: '1px solid rgba(248,184,29,0.18)', borderRadius: 12, padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <AlertCircle size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700, fontSize: 13, margin: '0 0 4px' }}>Товары не выбраны</p>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                    Откройте{' '}
                    <Link to="/products" style={{ color: '#6366f1', textDecoration: 'underline' }}>каталог</Link>,
                    {' '}отметьте галочками нужные строки и нажмите «Синдицировать».
                  </p>
                </div>
              </div>

              {/* MM repair block */}
              <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 12, padding: '18px 20px' }}>
                <p style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 14, margin: '0 0 6px' }}>
                  Исправить ошибки в уже выгруженных карточках Megamarket
                </p>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: '0 0 4px', lineHeight: 1.6 }}>
                  Система проверит уже выгруженные SKU, найдет карточки с async-ошибками и запустит жесткий автоцикл исправления.
                </p>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: '0 0 16px', lineHeight: 1.6 }}>
                  Для ручной коррекции semantic-связей атрибутов откройте{' '}
                  <Link to="/attribute-star-map" style={{ color: '#6366f1', textDecoration: 'underline' }}>Star Map векторов</Link>.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Подключение</span>
                    <select
                      className="input-premium"
                      value={selectedConn}
                      onChange={e => setSelectedConn(e.target.value)}
                      style={{ color: 'rgba(255,255,255,0.85)' }}
                    >
                      {connections.map((c: any) =>
                        <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>
                      )}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Сканировать SKU</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="input-premium"
                      value={scanLimit}
                      onChange={(e) => setScanLimit(e.target.value)}
                      placeholder="150"
                    />
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>Лимит карточек из MM getError</span>
                  </label>
                  <button
                    onClick={handleStartMegamarketRepair}
                    disabled={isRepairStarting || !selectedConnObj || selectedConnObj.type !== 'megamarket'}
                    className="btn-glow"
                    style={{ opacity: (isRepairStarting || !selectedConnObj || selectedConnObj?.type !== 'megamarket') ? 0.45 : 1 }}
                  >
                    {isRepairStarting ? 'Запуск…' : 'Исправить ошибки MM'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* State: ids selected, no task yet */}
          {!taskId && ids.length > 0 && (
            <div style={{ maxWidth: 520 }}>
              <div className="animate-fade-up" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Sparkles size={18} style={{ color: '#6366f1', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 14, margin: '0 0 6px' }}>
                    Выбрано товаров: <span style={{ color: '#6366f1' }}>{ids.length}</span>
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                    Система подберёт категорию и сопоставит атрибуты. Процесс идёт в фоне — можно закрыть вкладку.
                  </p>
                  {isMegamarketTarget && (
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 8 }}>
                      Для Megamarket запуск идет в жестком цикле автоисправления ошибок по каждой карточке.
                    </p>
                  )}
                </div>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Куда выгружать</span>
                <select
                  className="input-premium"
                  value={selectedConn}
                  onChange={e => setSelectedConn(e.target.value)}
                  style={{ color: 'rgba(255,255,255,0.85)' }}
                >
                  {connections.map((c: any) =>
                    <option key={c.id} value={c.id}>{connectionOptionLabel(c.name, c.type)}</option>
                  )}
                </select>
              </label>

              <button
                onClick={handleStart}
                disabled={isStarting || ids.length === 0}
                className="btn-glow"
                style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: (isStarting || ids.length === 0) ? 0.5 : 1 }}
              >
                {isStarting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {isStarting ? 'Запуск…' : (isMegamarketTarget ? 'Запустить жесткий автоцикл MM' : 'Запустить выгрузку')}
              </button>
            </div>
          )}

          {/* State: task running/done */}
          {taskId && progress && (
            <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Status row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {progress.status === 'completed'
                    ? <CheckCircle2 size={20} style={{ color: '#10b981' }} />
                    : <Loader2 size={20} className="animate-spin" style={{ color: '#6366f1' }} />}
                  <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 16 }}>
                    {progress.status === 'completed' ? 'Завершено' : 'Выгрузка…'}
                  </span>
                </div>
                {progress.current_sku && (
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                    SKU: {progress.current_sku}
                  </span>
                )}
              </div>

              {/* Progress bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Прогресс</span>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600 }}>{progress.processed} / {progress.total}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                <div style={{ background: '#141422', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.9)', letterSpacing: '-0.03em' }}>{progress.processed}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Обработано</div>
                </div>
                <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.18)', borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#10b981', letterSpacing: '-0.03em' }}>{progress.success}</div>
                  <div style={{ fontSize: 11, color: 'rgba(16,185,129,0.6)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Успешно</div>
                </div>
                <div style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#f87171', letterSpacing: '-0.03em' }}>{progress.failed}</div>
                  <div style={{ fontSize: 11, color: 'rgba(248,113,113,0.6)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>С ошибкой</div>
                </div>
              </div>

              {/* Error banner */}
              {progress.error && (
                <div style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <AlertCircle size={16} style={{ color: '#f87171', flexShrink: 0, marginTop: 2 }} />
                  <p style={{ color: '#f87171', fontSize: 12, fontFamily: 'monospace', margin: 0 }}>
                    Последняя ошибка: {progress.error}
                  </p>
                </div>
              )}

              {/* Agent logs */}
              <div style={{ background: '#141422', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Логи агента и верификатора
                  </span>
                </div>
                <pre style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.4)', border: 'none', borderRadius: 0, padding: 16, overflowY: 'auto', maxHeight: 260, margin: 0 }}>
                  {Array.isArray(progress.logs) && progress.logs.length > 0
                    ? progress.logs.join('\n')
                    : <span style={{ color: 'rgba(255,255,255,0.2)' }}>Логи пока пусты. Они появятся, когда агент начнёт анализ.</span>}
                </pre>
              </div>

              {/* Telemetry events */}
              <div style={{ background: '#141422', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Telemetry events
                  </span>
                </div>
                <pre style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.4)', border: 'none', borderRadius: 0, padding: 16, overflowY: 'auto', maxHeight: 260, margin: 0 }}>
                  {Array.isArray(progress.events) && progress.events.length > 0
                    ? progress.events.map((e: any) => JSON.stringify(e)).join('\n')
                    : <span style={{ color: 'rgba(255,255,255,0.2)' }}>События появятся после первых шагов агента.</span>}
                </pre>
              </div>

              {progress.status === 'completed' && (
                <div style={{ paddingTop: 8 }}>
                  <button onClick={() => setTaskId('')} className="btn-ghost-premium">
                    Выполнить новую выгрузку
                  </button>
                </div>
              )}
            </div>
          )}

          {/* State: task id set but no progress yet */}
          {taskId && !progress && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '40px 0', color: 'rgba(255,255,255,0.35)' }}>
              <Loader2 size={20} className="animate-spin" />
              <span style={{ fontSize: 14 }}>Подключение к очереди задач…</span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
