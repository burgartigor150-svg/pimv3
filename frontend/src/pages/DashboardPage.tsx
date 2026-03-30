import { useState, useEffect } from 'react'
import { Activity, Layers, Database, PlugZap, Sparkles, Server } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { Link } from 'react-router-dom'

export default function DashboardPage() {
  const [stats, setStats] = useState({
    total_products: 0,
    total_categories: 0,
    total_attributes: 0,
    total_connections: 0,
    average_completeness: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/stats')
      .then(res => res.json())
      .then(data => {
        setStats(data)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }, [])

  const completenessData = [
    { name: 'Заполнено', value: stats.average_completeness },
    { name: 'Пустоты', value: 100 - stats.average_completeness }
  ]
  const COLORS = ['#6366f1', '#e2e8f0']

  if (loading) {
    return <div className="p-8 flex items-center justify-center">Загрузка аналитики...</div>
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">Добро пожаловать в <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-red-600">PIM.Giper.fm</span></h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg max-w-3xl">
            Одна база товаров → ИИ собирает «идеальную» карточку из нескольких магазинов → вы выгружаете на Ozon, Яндекс, WB и Мегамаркет без ручного переноса полей.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/integrations"
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200"
          >
            <PlugZap className="w-4 h-4 text-indigo-500" /> Магазины и ключи
          </Link>
          <Link
            to="/products"
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-medium rounded-lg px-4 py-2 shadow-md flex items-center gap-2 transition-all"
          >
            <Layers className="w-4 h-4" /> Открыть каталог
          </Link>
          <Link
            to="/settings"
            className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-4 py-2 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200"
          >
            <Sparkles className="w-4 h-4 text-purple-500" /> Ключ ИИ (DeepSeek)
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className="p-4 bg-blue-50 text-blue-600 rounded-xl"><Layers className="w-7 h-7" /></div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Всего товаров</p>
            <p className="text-3xl font-black text-slate-800 mt-1">{stats.total_products}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className="p-4 bg-purple-50 text-purple-600 rounded-xl"><Database className="w-7 h-7" /></div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Атрибуты</p>
            <p className="text-3xl font-black text-slate-800 mt-1">{stats.total_attributes}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className="p-4 bg-green-50 text-emerald-600 rounded-xl"><Server className="w-7 h-7" /></div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Категории</p>
            <p className="text-3xl font-black text-slate-800 mt-1">{stats.total_categories}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className="p-4 bg-orange-50 text-orange-600 rounded-xl"><PlugZap className="w-7 h-7" /></div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Магазинов подключено</p>
            <p className="text-3xl font-black text-slate-800 mt-1">{stats.total_connections}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="bg-white dark:bg-slate-800 border rounded-2xl p-6 flex flex-col shadow-sm col-span-1 lg:col-span-2">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800"><Activity className="w-5 h-5 text-indigo-500"/> Индекс Здоровья Каталога (Completeness)</h2>
          <div className="flex-1 min-h-[300px] flex items-center justify-center relative">
             <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={completenessData}
                  cx="50%"
                  cy="50%"
                  innerRadius={90}
                  outerRadius={120}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {completenessData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-5xl font-black text-slate-800 dark:text-white">{stats.average_completeness}%</span>
              <span className="text-sm font-medium text-slate-500 uppercase mt-1 tracking-wider">Заполнено</span>
            </div>
          </div>
        </div>

        {/* Quick Actions / Getting Started */}
        <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-2xl p-8 text-white shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-indigo-500/20 rounded-full blur-2xl"></div>
          <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-32 h-32 bg-purple-500/20 rounded-full blur-3xl"></div>
          
          <div className="relative z-10">
            <h2 className="text-2xl font-bold mb-3 text-white">Как пользоваться (по шагам)</h2>
            <p className="text-indigo-200 text-sm mb-6 leading-relaxed">
              {stats.total_products === 0
                ? 'Начните с подключения хотя бы одного магазина — без ключей API система не сможет скачать карточки.'
                : `В каталоге уже ${stats.total_products} товар(ов). Откройте карточку → вкладка «Перенос на маркетплейсы» — или выберите несколько строк в каталоге для массовой выгрузки.`}
            </p>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <div className="w-9 h-9 shrink-0 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-200 font-bold border border-indigo-500/30 text-sm">1</div>
                <div>
                  <span className="text-sm font-semibold text-white block">Магазины и ключи API</span>
                  <span className="text-xs text-indigo-200/90">Каждый магазин Ozon / Яндекс / WB / Мегамаркет — отдельное подключение.</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-9 h-9 shrink-0 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-200 font-bold border border-indigo-500/30 text-sm">2</div>
                <div>
                  <span className="text-sm font-semibold text-white block">Импорт в каталог</span>
                  <span className="text-xs text-indigo-200/90">По артикулу подтягиваются фото и атрибуты; несколько магазинов дают данные для «идеальной» карточки.</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-9 h-9 shrink-0 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-200 font-bold border border-indigo-500/30 text-sm">3</div>
                <div>
                  <span className="text-sm font-semibold text-white block">Перенос на площадку</span>
                  <span className="text-xs text-indigo-200/90">ИИ подбирает категорию и поля; вы проверяете таблицу и нажимаете «Отправить».</span>
                </div>
              </li>
            </ul>
          </div>
          <div className="relative z-10 mt-8 flex flex-col gap-2">
            <Link
              to="/integrations"
              className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-semibold py-3 rounded-xl text-center shadow-lg transition-all"
            >
              Шаг 1: Подключить магазин
            </Link>
            <Link
              to="/products"
              className="w-full bg-white/10 hover:bg-white/15 text-white font-medium py-2.5 rounded-xl text-center border border-white/20 text-sm"
            >
              Перейти в каталог
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
