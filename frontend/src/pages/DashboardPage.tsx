import React, { useEffect, useState } from 'react';
import { Activity, Layers, Package, TrendingUp, Plus, Upload, RefreshCw, ChevronRight, Check } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface DashboardStats {
  total_products: number;
  total_categories: number;
  total_attributes: number;
  total_connections: number;
  average_completeness: number;
}

const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/v1/stats');
        if (!response.ok) throw new Error('Failed to fetch stats');
        const data = await response.json();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const completenessValue = stats?.average_completeness ?? 72;
  const pieData = [
    { name: 'Filled', value: completenessValue },
    { name: 'Empty', value: 100 - completenessValue },
  ];

  const kpiCards = [
    {
      icon: <Package className="w-5 h-5 text-blue-400" />,
      iconBg: 'bg-blue-500/10',
      value: stats?.total_products?.toLocaleString() ?? '—',
      label: 'Товаров',
      trend: '+12% this week',
    },
    {
      icon: <Layers className="w-5 h-5 text-purple-400" />,
      iconBg: 'bg-purple-500/10',
      value: stats?.total_attributes?.toLocaleString() ?? '—',
      label: 'Активных листингов',
      trend: '+5% this week',
    },
    {
      icon: <Activity className="w-5 h-5 text-emerald-400" />,
      iconBg: 'bg-emerald-500/10',
      value: stats?.total_connections?.toLocaleString() ?? '—',
      label: 'Синхронизировано сегодня',
      trend: '+8% this week',
    },
    {
      icon: <TrendingUp className="w-5 h-5 text-orange-400" />,
      iconBg: 'bg-orange-500/10',
      value: stats ? `${stats.average_completeness}%` : '—',
      label: 'Заполненность каталога',
      trend: '+3% this week',
    },
  ];

  const quickSteps = [
    {
      num: '1',
      title: 'Импортируйте товары',
      desc: 'Загрузите каталог из Excel или маркетплейса',
    },
    {
      num: '2',
      title: 'Заполните атрибуты',
      desc: 'ИИ предложит значения автоматически',
    },
    {
      num: '3',
      title: 'Опубликуйте на площадках',
      desc: 'Ozon, Яндекс Маркет, WB одним кликом',
    },
  ];

  return (
    <div className="min-h-screen bg-[#0d0d10] p-6">
      {/* Page Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-slate-100 text-2xl font-semibold">Дашборд</h1>
          <p className="text-slate-500 text-sm mt-1">Обзор состояния вашего каталога товаров</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors">
            <Plus className="w-3.5 h-3.5" />
            Добавить товар
          </button>
          <button className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors">
            <Upload className="w-3.5 h-3.5" />
            Импорт
          </button>
          <button className="bg-[#1c1c28] hover:bg-[#28283a] border border-[#1e1e2c] text-slate-300 px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
            Синхронизировать
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-[#13131a] border border-[#1e1e2c] rounded-xl p-5 animate-pulse"
              >
                <div className="w-12 h-12 bg-[#1c1c28] rounded-lg mb-4" />
                <div className="h-8 bg-[#1c1c28] rounded w-2/3 mb-2" />
                <div className="h-3 bg-[#1c1c28] rounded w-1/2 mb-3" />
                <div className="h-5 bg-[#1c1c28] rounded w-1/3" />
              </div>
            ))
          : kpiCards.map((card, i) => (
              <div
                key={i}
                className="bg-[#13131a] border border-[#1e1e2c] rounded-xl p-5 hover:border-[#28283a] transition-all"
              >
                <div className={`w-12 h-12 ${card.iconBg} rounded-lg flex items-center justify-center mb-4`}>
                  {card.icon}
                </div>
                <div className="text-3xl font-bold text-slate-100 tabular-nums">{card.value}</div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mt-1">{card.label}</div>
                <div className="mt-3">
                  <span className="text-emerald-400 text-xs bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    {card.trend}
                  </span>
                </div>
              </div>
            ))}
      </div>

      {/* Bottom Two-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Donut Chart — 2/3 */}
        <div className="lg:col-span-2 bg-[#13131a] border border-[#1e1e2c] rounded-xl p-5 hover:border-[#28283a] transition-all">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-medium text-slate-200">Заполненность каталога</h2>
              <p className="text-xs text-slate-500 mt-0.5">Процент заполненных атрибутов по всем товарам</p>
            </div>
          </div>

          {loading ? (
            <div className="h-56 flex items-center justify-center">
              <div className="w-40 h-40 rounded-full bg-[#1c1c28] animate-pulse" />
            </div>
          ) : (
            <div className="relative h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={72}
                    outerRadius={96}
                    startAngle={90}
                    endAngle={-270}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    <Cell fill="#6366f1" />
                    <Cell fill="#1e1e2c" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold text-slate-100">{completenessValue}%</span>
                <span className="text-xs text-slate-500 mt-1">Заполнено</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-[#1e1e2c]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
              <span className="text-xs text-slate-400">Заполнено</span>
              <span className="text-xs text-slate-100 font-medium">{completenessValue}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#1e1e2c] border border-slate-600 inline-block" />
              <span className="text-xs text-slate-400">Не заполнено</span>
              <span className="text-xs text-slate-100 font-medium">{100 - completenessValue}%</span>
            </div>
          </div>
        </div>

        {/* Quick Actions — 1/3 */}
        <div className="bg-[#13131a] border border-[#1e1e2c] rounded-xl p-5 hover:border-[#28283a] transition-all flex flex-col">
          <h2 className="text-sm font-medium text-slate-200 mb-1">Быстрый старт</h2>
          <p className="text-xs text-slate-500 mb-5">Три шага для запуска каталога</p>

          <div className="flex-1 space-y-0">
            {quickSteps.map((step, i) => (
              <div key={i} className="flex gap-3">
                {/* Dot + vertical line */}
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/50 text-indigo-400 text-xs flex items-center justify-center flex-shrink-0">
                    {step.num}
                  </div>
                  {i < quickSteps.length - 1 && (
                    <div className="w-px flex-1 bg-[#1e1e2c] my-1" style={{ minHeight: '28px' }} />
                  )}
                </div>
                <div className={i < quickSteps.length - 1 ? 'pb-5' : ''}>
                  <p className="text-sm font-medium text-slate-200 leading-tight">{step.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 mt-6 pt-4 border-t border-[#1e1e2c]">
            <button className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5">
              Начать импорт
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button className="w-full bg-transparent hover:bg-[#1c1c28] border border-[#1e1e2c] text-slate-300 font-medium py-2 rounded-lg text-sm transition-colors">
              Посмотреть документацию
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg">
          Ошибка загрузки данных: {error}
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
