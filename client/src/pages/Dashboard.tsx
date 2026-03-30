import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface Project {
  id: number;
  name: string;
}

interface ProjectStats {
  deviceCount: number;
  connectorCount: number;
  pinCount: number;
  signalCount: number;
}

interface CategoryStat {
  count: number;
  topFields: string[];
  daily: { date: string; count: number }[];
}

interface ActivitySummary {
  granularity: 'hour' | 'day';
  daysSinceLastChange: number | null;
  lastChangeAt: string | null;
  stabilityLevel: 'FROZEN' | 'STABLE' | 'ACTIVE' | 'INTENSIVE';
  stabilityLabel: string;
  trendDays: { date: string; label: string; device: number; connector: number; signal: number }[];
  totalChanges: number;
  avgPerDay: number;
  advice: string;
  activeFields: { field: string; count: number }[];
  categories: {
    devices: CategoryStat;
    connectors_pins: CategoryStat;
    signals: CategoryStat;
  };
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [activityRange, setActivityRange] = useState<'24h'|'7d'|'30d'|'180d'|'all'>('24h');
  const [cardIndex, setCardIndex] = useState(0);
  const CARD_COUNT = 4;
  const [chartSeries, setChartSeries] = useState({ device: true, connector: true, signal: true });
  const toggleSeries = (key: keyof typeof chartSeries) =>
    setChartSeries(s => ({ ...s, [key]: !s[key] }));
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [todo, setTodo] = useState<{
    completion: { device: number; connector: number; signal: number };
    approval:   { device: number; connector: number; signal: number };
    draft:      { device: number; signal: number };
    alerts:     { overdue: number };
  } | null>(null);
  const [todoModal, setTodoModal] = useState<'completion' | 'approval' | 'draft' | null>(null);

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/project-data', { replace: true });
      return;
    }
    fetchProjects();
  }, [user]);

  useEffect(() => {
    if (!selectedProject) return;
    fetchStats(selectedProject.id);
    fetchActivity(selectedProject.id, activityRange);
    fetchTodo(selectedProject.id);
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) return;
    fetchActivity(selectedProject.id, activityRange);
  }, [activityRange]);

  const token = () => localStorage.getItem('token');

  const fetchProjects = async () => {
    const res = await fetch('/api/projects', {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const data = await res.json();
    const list: Project[] = data.projects || [];
    setProjects(list);
    if (list.length > 0) setSelectedProject(list[0]);
  };

  const fetchStats = async (projectId: number) => {
    setLoadingStats(true);
    try {
      const res = await fetch(`/api/data/stats?projectId=${projectId}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setStats(data);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchTodo = async (projectId: number) => {
    const res = await fetch(`/api/data/todo?projectId=${projectId}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (res.ok) setTodo(await res.json());
  };

  const fetchActivity = async (projectId: number, range: string) => {
    setLoadingActivity(true);
    try {
      let param: string;
      if (range === 'all')        param = 'all=true';
      else if (range.endsWith('h')) param = `hours=${range.slice(0, -1)}`;
      else                          param = `days=${range.slice(0, -1)}`;
      const res = await fetch(`/api/data/activity?projectId=${projectId}&${param}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setActivity(data);
    } finally {
      setLoadingActivity(false);
    }
  };

  return (
    <Layout>
      <div className="flex h-full gap-4">
        {/* 左侧项目菜单 */}
        <aside className="w-52 flex-shrink-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden sticky top-4">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">项目列表</p>
            </div>
            <nav className="py-1">
              {projects.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-400">暂无项目</p>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProject(p)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                      selectedProject?.id === p.id
                        ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-500'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {p.name}
                  </button>
                ))
              )}
            </nav>
          </div>
        </aside>

        {/* 主内容区 */}
        <main className="flex-1 min-w-0 flex flex-col gap-4">
          {!selectedProject ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              请选择左侧项目
            </div>
          ) : (
            <>
              {/* 项目概览：顶部全宽，四项一行 */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex-shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-700">项目概览</h3>
                  <button
                    onClick={() => navigate(`/project-data?projectId=${selectedProject.id}`)}
                    className="text-xs text-blue-500 hover:text-blue-700"
                  >
                    查看详情 →
                  </button>
                </div>
                {loadingStats ? (
                  <div className="text-center py-4 text-gray-400 text-sm">加载中...</div>
                ) : stats ? (
                  <div className="grid grid-cols-4 gap-3">
                    <StatItem label="设备总数" value={stats.deviceCount} color="blue" icon={<IconAvionics />} />
                    <StatItem label="信号总数" value={stats.signalCount} color="green" icon={<IconDataBus />} />
                    <StatItem label="连接器总数" value={stats.connectorCount} color="purple" icon={<IconConnector />} />
                    <StatItem label="针孔总数" value={stats.pinCount} color="orange" icon={<IconPin />} />
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-4">暂无数据</p>
                )}
              </div>

              {/* 可滑动卡片区：占满剩余空间 */}
              <div className="flex-1 relative bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                {/* 滑轨 */}
                <div
                  className="flex flex-1 transition-transform duration-300 ease-in-out"
                  style={{ width: `${CARD_COUNT * 100}%`, transform: `translateX(-${cardIndex * (100 / CARD_COUNT)}%)` }}
                >
                  {/* 滑动页0：EICD 连接关系定义 */}
                  <div className="flex flex-col p-5 overflow-y-auto" style={{ width: `${100 / CARD_COUNT}%` }}>
                    <div className="flex items-center justify-between mb-4 flex-shrink-0">
                      <h3 className="font-semibold text-gray-700">EICD 连接关系定义</h3>
                      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                        {(['24h','7d','30d','180d','all'] as const).map((r) => (
                          <button
                            key={r}
                            onClick={() => setActivityRange(r)}
                            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                              activityRange === r
                                ? 'bg-white text-blue-600 font-medium shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            {r === '24h' ? '近24时' : r === '7d' ? '近7天' : r === '30d' ? '近30天' : r === '180d' ? '近6个月' : '全生命周期'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {loadingActivity ? (
                      <div className="text-center py-6 text-gray-400 text-sm">加载中...</div>
                    ) : !activity ? (
                      <div className="text-center py-8 text-gray-400 text-sm">暂无数据</div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-stretch gap-3">
                          <div className="flex-1 grid grid-cols-3 gap-2">
                            <MetricBox
                              value={activity.daysSinceLastChange === null ? '—' : `${activity.daysSinceLastChange}天`}
                              label="距上次变更"
                              sub={activity.lastChangeAt ? new Date(activity.lastChangeAt).toLocaleDateString('zh-CN') : '暂无记录'}
                            />
                            <MetricBox
                              value={activity.totalChanges}
                              label={
                                activityRange === 'all'   ? '全生命周期变更次数' :
                                activityRange === '180d'  ? '近6个月变更次数' :
                                activityRange === '30d'   ? '近30天变更次数' :
                                activityRange === '7d'    ? '近7天变更次数' : '近24小时变更次数'
                              }
                              sub={activity.granularity === 'hour' ? `时均 ${(activity.totalChanges / 24).toFixed(1)} 次` : `日均 ${activity.avgPerDay} 次`}
                            />
                            <MetricBox
                              value={`${activity.categories.devices.count + activity.categories.connectors_pins.count} / ${activity.categories.signals.count}`}
                              label="设备+连接器 / 信号"
                              sub="变更项数"
                            />
                          </div>
                        </div>
                        {/* 图表筛选 */}
                        <div className="flex gap-2">
                          {([
                            { key: 'device',    label: '设备变更',      color: 'bg-blue-400' },
                            { key: 'connector', label: '连接器与针孔变更',  color: 'bg-purple-400' },
                            { key: 'signal',    label: '信号变更',      color: 'bg-green-400' },
                          ] as const).map(s => (
                            <button
                              key={s.key}
                              onClick={() => toggleSeries(s.key)}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all ${
                                chartSeries[s.key]
                                  ? 'border-transparent text-white ' + s.color
                                  : 'border-gray-200 text-gray-400 bg-white'
                              }`}
                            >
                              <span className={`w-2 h-2 rounded-full ${chartSeries[s.key] ? 'bg-white' : s.color}`} />
                              {s.label}
                            </button>
                          ))}
                        </div>
                        <DailyChangeChart
                          data={activity.trendDays}
                          granularity={activity.granularity}
                          series={chartSeries}
                          onBarClick={(date) => setDetailDate(date)}
                        />
                        {activity.activeFields.length > 0 && (
                          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">活跃字段</p>
                            <div className="flex flex-wrap gap-2">
                              {activity.activeFields.map((f, i) => (
                                <div
                                  key={f.field}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 shadow-sm"
                                >
                                  <span className="text-xs font-bold text-gray-300">#{i + 1}</span>
                                  <span className="text-xs font-medium text-gray-700">{f.field}</span>
                                  <span className="text-xs text-white bg-blue-400 rounded-full px-1.5 py-0.5 leading-none">{f.count}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {todo && <TodoPanel todo={todo} onNavigate={() => navigate(`/project-data?projectId=${selectedProject!.id}`)} onTypeClick={(type) => setTodoModal(type)} />}
                      </div>
                    )}
                  </div>

                  {/* 滑动页1：RHI 设计 */}
                  <PlaceholderSlide title="RHI 设计" icon="✈️" desc="RHI 设计数据接入后将在此展示" />

                  {/* 滑动页2：生产制造管理 */}
                  <PlaceholderSlide title="生产制造管理" icon="🏭" desc="生产制造管理数据接入后将在此展示" />

                  {/* 滑动页3：EWIS 装配与布置 */}
                  <PlaceholderSlide title="EWIS 装配与布置" icon="🔧" desc="EWIS装配与布置数据接入后将在此展示" />
                </div>

                {/* 左右切换箭头 */}
                {cardIndex > 0 && (
                  <button
                    onClick={() => setCardIndex(i => i - 1)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white border border-gray-200 rounded-full shadow flex items-center justify-center text-gray-500 hover:text-gray-800 hover:shadow-md transition-all z-10"
                  >
                    ‹
                  </button>
                )}
                {cardIndex < CARD_COUNT - 1 && (
                  <button
                    onClick={() => setCardIndex(i => i + 1)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white border border-gray-200 rounded-full shadow flex items-center justify-center text-gray-500 hover:text-gray-800 hover:shadow-md transition-all z-10"
                  >
                    ›
                  </button>
                )}

                {/* 底部指示点 */}
                <div className="flex-shrink-0 flex justify-center gap-2 py-3 border-t border-gray-50">
                  {(['EICD连接关系定义', 'RHI设计', '生产制造管理', 'EWIS装配与布置'] as const).map((label, i) => (
                    <button
                      key={i}
                      onClick={() => setCardIndex(i)}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs transition-colors ${
                        cardIndex === i
                          ? 'bg-blue-100 text-blue-600 font-medium'
                          : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cardIndex === i ? 'bg-blue-500' : 'bg-gray-300'}`} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {detailDate && selectedProject && (
                <DayDetailModal
                  date={detailDate}
                  projectId={selectedProject.id}
                  onClose={() => setDetailDate(null)}
                />
              )}
              {todoModal && selectedProject && (
                <TodoDetailModal
                  type={todoModal}
                  projectId={selectedProject.id}
                  onClose={() => setTodoModal(null)}
                />
              )}
            </>
          )}
        </main>
      </div>
    </Layout>
  );
}

function StatItem({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: 'blue' | 'green' | 'purple' | 'orange';
  icon: ReactNode;
}) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  };
  return (
    <div className={`rounded-lg p-3 ${colorMap[color]}`}>
      <div className="w-6 h-6">{icon}</div>
      <div className="text-2xl font-bold mt-1">{value.toLocaleString()}</div>
      <div className="text-xs opacity-75 mt-0.5">{label}</div>
    </div>
  );
}

// ── 航空电子图标 ────────────────────────────────────────────────

/** 航电设备（LRU 机箱正视图） */
function IconAvionics() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      {/* 外壳 */}
      <rect x="1" y="5" width="22" height="14" rx="1.5"/>
      {/* 显示屏区域 */}
      <rect x="3" y="8" width="10" height="5" rx="0.5" strokeWidth="1" opacity="0.9"/>
      {/* 状态指示灯 */}
      <circle cx="16.5" cy="10.5" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="19"   cy="10.5" r="0.9" fill="currentColor" stroke="none"/>
      {/* 面板下沿分隔线 */}
      <line x1="3" y1="15.5" x2="21" y2="15.5" strokeWidth="0.75" opacity="0.45"/>
      {/* 侧面提手槽 */}
      <line x1="15" y1="8" x2="15" y2="13" strokeWidth="0.75" opacity="0.45"/>
    </svg>
  );
}

/** 信号/数据总线（两端设备 + 双向数据流波形） */
function IconDataBus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      {/* 左侧设备 */}
      <rect x="1" y="9" width="5" height="6" rx="1"/>
      {/* 右侧设备 */}
      <rect x="18" y="9" width="5" height="6" rx="1"/>
      {/* 上行数据（右向，锯齿/脉冲波形） */}
      <polyline points="6,10.5 8.5,10.5 9.5,8.5 11,13 12.5,8.5 13.5,13 14.5,10.5 18,10.5"/>
      {/* 下行数据（左向箭头） */}
      <line x1="6" y1="13.5" x2="18" y2="13.5"/>
      <polyline points="8,11.5 6,13.5 8,15.5"/>
    </svg>
  );
}

/** 圆形航空插座（MIL-C 系列，正视图） */
function IconConnector() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      {/* 外壳 */}
      <circle cx="12" cy="12" r="10"/>
      {/* 对准凸键（上方小突起） */}
      <path d="M11 2.1 Q12 1.2 13 2.1" strokeWidth="1"/>
      {/* 接触面圆环 */}
      <circle cx="12" cy="12" r="6.5" strokeWidth="1"/>
      {/* 针脚排列（5 针型） */}
      <circle cx="10"   cy="10"   r="1.1" fill="currentColor" stroke="none"/>
      <circle cx="14"   cy="10"   r="1.1" fill="currentColor" stroke="none"/>
      <circle cx="8.8"  cy="13.2" r="1.1" fill="currentColor" stroke="none"/>
      <circle cx="12"   cy="14.5" r="1.1" fill="currentColor" stroke="none"/>
      <circle cx="15.2" cy="13.2" r="1.1" fill="currentColor" stroke="none"/>
    </svg>
  );
}

/** 航空插头针脚（单针侧视图） */
function IconPin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      {/* 针身（椭圆体） */}
      <rect x="5" y="8" width="12" height="8" rx="4"/>
      {/* 针尖（锥形接触点） */}
      <path d="M17 12 L21.5 12" strokeWidth="2"/>
      <path d="M19.5 10.2 L21.5 12 L19.5 13.8" strokeWidth="1.2"/>
      {/* 导线连接端 */}
      <line x1="5" y1="12" x2="2" y2="12" strokeWidth="2"/>
      {/* 滚花纹（卡固槽） */}
      <line x1="9"  y1="8" x2="9"  y2="16" strokeWidth="0.75" opacity="0.5"/>
      <line x1="12" y1="8" x2="12" y2="16" strokeWidth="0.75" opacity="0.5"/>
    </svg>
  );
}


function MetricBox({ value, label, sub }: { value: string | number; label: string; sub: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5 flex flex-col justify-between">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-bold text-gray-800 my-0.5">{value}</p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  );
}

function PlaceholderSlide({ title, icon, desc }: { title: string; icon: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center p-5" style={{ width: `${100 / 4}%` }}>
      <span className="text-5xl">{icon}</span>
      <h3 className="text-lg font-semibold text-gray-600">{title}</h3>
      <p className="text-sm text-gray-400">{desc}</p>
    </div>
  );
}

function GlowCursor(props: any) {
  const { x, y, width, height } = props;
  return (
    <rect
      x={x} y={y} width={width} height={height}
      fill="none"
      stroke="#818cf8"
      strokeWidth={1.5}
      rx={3}
      style={{ filter: 'drop-shadow(0 0 5px rgba(129,140,248,0.8))' }}
    />
  );
}

function DailyChangeChart({
  data, granularity, series, onBarClick,
}: {
  data: { date: string; label: string; device: number; connector: number; signal: number }[];
  granularity: 'hour' | 'day';
  series: { device: boolean; connector: boolean; signal: boolean };
  onBarClick: (date: string) => void;
}) {
  // 刻度间隔：按数据量自动稀疏
  const tickInterval = granularity === 'hour'
    ? 3                          // 小时模式：每 4 小时一个刻度
    : data.length > 90 ? 14     // 6 个月 / 全生命周期：每 15 天一个刻度
    : data.length > 14 ? 4      // 30 天：每 5 天一个刻度
    : 0;                         // 7 天：每天一个刻度
  const order = (['device', 'connector', 'signal'] as const).filter(k => series[k]);
  const last = order[order.length - 1];

  const handleBarClick = (barData: any) => {
    if (barData?.date) onBarClick(barData.date);
  };

  // 计算每个时间桶的总变更数，用于趋势折线
  const chartData = data.map(d => ({
    ...d,
    total: (series.device ? d.device : 0) + (series.connector ? d.connector : 0) + (series.signal ? d.signal : 0),
  }));

  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">
        {granularity === 'hour' ? '每小时变更数量（点击柱体查看明细）' : '每日变更数量（点击柱体查看明细）'}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} barSize={10} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={tickInterval} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            cursor={<GlowCursor />}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            formatter={(value, name) => {
              const labels: Record<string, string> = {
                device: '设备变更', connector: '连接器与针孔变更', signal: '信号变更', total: '变更合计',
              };
              return [value, labels[name as string] || name];
            }}
          />
          {series.device    && <Bar dataKey="device"    stackId="a" fill="#60a5fa" radius={last === 'device'    ? [2,2,0,0] : [0,0,0,0]} cursor="pointer" onClick={handleBarClick} />}
          {series.connector && <Bar dataKey="connector" stackId="a" fill="#c084fc" radius={last === 'connector' ? [2,2,0,0] : [0,0,0,0]} cursor="pointer" onClick={handleBarClick} />}
          {series.signal    && <Bar dataKey="signal"    stackId="a" fill="#34d399" radius={last === 'signal'    ? [2,2,0,0] : [0,0,0,0]} cursor="pointer" onClick={handleBarClick} />}
          <Line
            dataKey="total"
            type="monotone"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={(props: any) => {
              // 只在与 X 轴刻度对齐的位置渲染点
              const step = tickInterval + 1;
              const isLast = props.index === chartData.length - 1;
              if (props.index % step !== 0 && !isLast) return <g key={props.index} />;
              return <circle key={props.index} cx={props.cx} cy={props.cy} r={2.5} fill="#f59e0b" />;
            }}
            activeDot={{ r: 4, fill: '#f59e0b' }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 单日变更明细弹窗 ─────────────────────────────────────────
interface DiffRecord {
  id: number;
  entityType: string;
  entityId: number;
  reason: string;
  changedBy: string;
  createdAt: string;
  diff: { field: string; oldVal: string | null; newVal: string | null }[];
}

const ENTITY_COLOR_MAP: Record<string, string> = {
  设备: 'bg-blue-100 text-blue-700',
  连接器: 'bg-purple-100 text-purple-700',
  针孔: 'bg-orange-100 text-orange-700',
  信号: 'bg-green-100 text-green-700',
};

// ── 待办提醒面板 ──────────────────────────────────────────────
type TodoData = {
  completion: { device: number; connector: number; signal: number };
  approval:   { device: number; connector: number; signal: number };
  draft:      { device: number; signal: number };
  alerts:     { overdue: number };
};

function TodoPanel({ todo, onNavigate, onTypeClick }: { todo: TodoData; onNavigate: () => void; onTypeClick: (type: 'completion' | 'approval' | 'draft') => void }) {
  const completionTotal = todo.completion.device + todo.completion.connector + todo.completion.signal;
  const approvalTotal   = todo.approval.device   + todo.approval.connector   + todo.approval.signal;
  const draftTotal      = todo.draft.device + todo.draft.signal;

  const groups: {
    label: string;
    type: 'completion' | 'approval' | 'draft';
    total: number;
    items: { name: string; count: number }[];
    badge: string;
    dot: string;
  }[] = [
    {
      label: '待完善', type: 'completion' as const, total: completionTotal, badge: 'bg-blue-100 text-blue-700 border-blue-200',
      dot: 'bg-blue-400',
      items: [
        { name: '设备',  count: todo.completion.device },
        { name: '连接器', count: todo.completion.connector },
        { name: '信号',  count: todo.completion.signal },
      ].filter(i => i.count > 0),
    },
    {
      label: '待审批', type: 'approval' as const, total: approvalTotal, badge: 'bg-purple-100 text-purple-700 border-purple-200',
      dot: 'bg-purple-400',
      items: [
        { name: '设备',  count: todo.approval.device },
        { name: '连接器', count: todo.approval.connector },
        { name: '信号',  count: todo.approval.signal },
      ].filter(i => i.count > 0),
    },
    {
      label: '草稿', type: 'draft' as const, total: draftTotal, badge: 'bg-gray-100 text-gray-600 border-gray-200',
      dot: 'bg-gray-400',
      items: [
        { name: '设备', count: todo.draft.device },
        { name: '信号', count: todo.draft.signal },
      ].filter(i => i.count > 0),
    },
  ].filter(g => g.total > 0);

  const hasOverdue = todo.alerts.overdue > 0;
  if (groups.length === 0 && !hasOverdue) return null;

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">待办提醒</p>
        <button onClick={onNavigate} className="text-xs text-blue-500 hover:text-blue-700">前往处理 →</button>
      </div>

      {hasOverdue && (
        <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-100">
          <span className="text-red-400 text-sm">⚠️</span>
          <span className="text-xs text-red-600 font-medium">
            {todo.alerts.overdue} 项审批请求超过 7 天未处理
          </span>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {groups.map(g => (
            <button
              key={g.label}
              onClick={() => onTypeClick(g.type)}
              className={`flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-lg bg-white border shadow-sm hover:shadow-md transition-shadow cursor-pointer ${g.badge.split(' ').slice(2).join(' ')}`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${g.dot}`} />
              <span className={`text-xs font-medium ${g.badge.split(' ').slice(1, 2).join(' ')}`}>{g.label}</span>
              <div className="flex gap-1 ml-0.5">
                {g.items.map(item => (
                  <span key={item.name}
                    className={`text-xs px-1.5 py-0.5 rounded-full ${g.badge}`}>
                    {item.name} {item.count}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 待办明细弹窗 ──────────────────────────────────────────────
interface TodoDetailItem {
  id: number;
  entityType: string;
  entityName: string;
  actionType: string;
  daysAgo: number;
  requester: string;
  responsible: string[];
}

const TODO_TYPE_LABEL: Record<string, string> = {
  completion: '待完善',
  approval: '待审批',
  draft: '草稿待提交',
};

function TodoDetailModal({
  type, projectId, onClose,
}: {
  type: 'completion' | 'approval' | 'draft';
  projectId: number;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TodoDetailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`/api/data/todo/detail?projectId=${projectId}&type=${type}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .finally(() => setLoading(false));
  }, [type, projectId]);

  const handleNotify = async () => {
    setPushing(true);
    setPushMsg('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/data/todo/notify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          type,
          items: items.map(i => ({
            id: i.id,
            entityType: i.entityType,
            entityName: i.entityName,
            responsible: i.responsible,
          })),
        }),
      });
      const data = await res.json();
      if (res.ok) setPushMsg(`已向 ${data.notified} 人发送通知`);
      else setPushMsg(data.error || '推送失败');
    } catch {
      setPushMsg('网络错误');
    } finally {
      setPushing(false);
    }
  };

  const label = TODO_TYPE_LABEL[type];
  const responsibleSet = new Set(items.flatMap(i => i.responsible).filter(Boolean));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">{label}任务明细</h2>
            {!loading && (
              <p className="text-xs text-gray-400 mt-0.5">
                共 {items.length} 项 · 涉及责任人 {responsibleSet.size} 人
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-center text-gray-400 py-8">加载中...</p>
          ) : items.length === 0 ? (
            <p className="text-center text-gray-400 py-8">暂无待办项</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left py-2 pr-3 font-medium">类型</th>
                  <th className="text-left py-2 pr-3 font-medium">名称</th>
                  <th className="text-left py-2 pr-3 font-medium">操作</th>
                  <th className="text-left py-2 pr-3 font-medium">提交人</th>
                  <th className="text-left py-2 pr-3 font-medium">责任人</th>
                  <th className="text-right py-2 font-medium">等待</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map(item => (
                  <tr key={`${item.entityType}-${item.id}`} className="hover:bg-gray-50">
                    <td className="py-2.5 pr-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{item.entityType}</span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-gray-700 max-w-[160px] truncate">{item.entityName}</td>
                    <td className="py-2.5 pr-3 text-gray-500">{item.actionType}</td>
                    <td className="py-2.5 pr-3 text-gray-500">{item.requester}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {item.responsible.length > 0
                          ? item.responsible.map(r => (
                              <span key={r} className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded">{r}</span>
                            ))
                          : <span className="text-xs text-gray-300">—</span>
                        }
                      </div>
                    </td>
                    <td className={`py-2.5 text-right text-xs font-medium ${item.daysAgo >= 7 ? 'text-red-500' : 'text-gray-400'}`}>
                      {item.daysAgo === 0 ? '今天' : `${item.daysAgo}天`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 flex-shrink-0 bg-gray-50 rounded-b-xl">
          <div className="flex items-center gap-2">
            {pushMsg && (
              <span className={`text-sm ${pushMsg.includes('失败') || pushMsg.includes('错误') ? 'text-red-500' : 'text-green-600'}`}>
                {pushMsg}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700">关闭</button>
            <button
              onClick={handleNotify}
              disabled={pushing || items.length === 0 || responsibleSet.size === 0}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:bg-blue-300 flex items-center gap-1.5"
            >
              {pushing ? '推送中...' : `一键推送 (${responsibleSet.size}人)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DayDetailModal({ date, projectId, onClose }: { date: string; projectId: number; onClose: () => void }) {
  const [records, setRecords] = useState<DiffRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`/api/data/activity/detail?projectId=${projectId}&date=${date}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setRecords(d.records || []))
      .finally(() => setLoading(false));
  }, [date, projectId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">
            {date.length > 10 ? `${date}:00 时段` : date} 变更明细
          </h2>
            {!loading && <p className="text-xs text-gray-400 mt-0.5">共 {records.length} 条变更记录</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading ? (
            <p className="text-center text-gray-400 py-8">加载中...</p>
          ) : records.length === 0 ? (
            <p className="text-center text-gray-400 py-8">当日无变更记录</p>
          ) : (
            records.map(rec => (
              <div key={rec.id} className="border border-gray-100 rounded-lg overflow-hidden">
                {/* Record header */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ENTITY_COLOR_MAP[rec.entityType] || 'bg-gray-100 text-gray-600'}`}>
                    {rec.entityType}
                  </span>
                  <span className="text-xs text-gray-500">ID {rec.entityId}</span>
                  {rec.reason && <span className="text-xs text-gray-600 font-medium">{rec.reason}</span>}
                  <span className="ml-auto text-xs text-gray-400">{rec.changedBy} · {rec.createdAt.slice(11, 16)}</span>
                </div>
                {/* Diff table */}
                {rec.diff.length === 0 ? (
                  <p className="text-xs text-gray-400 px-4 py-3">无字段差异（新增或删除操作）</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 font-medium">
                        <th className="px-4 py-2 text-left w-1/4 bg-gray-50 border-b border-gray-100">字段</th>
                        <th className="px-4 py-2 text-left w-[37.5%] bg-red-50 border-b border-gray-100 text-red-400">修改前</th>
                        <th className="px-4 py-2 text-left w-[37.5%] bg-green-50 border-b border-gray-100 text-green-500">修改后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.diff.map((d, i) => (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-2 font-medium text-gray-600 bg-gray-50 align-top">{d.field}</td>
                          <td className="px-4 py-2 text-red-500 align-top break-all">
                            {d.oldVal ?? <span className="text-gray-300 italic">空</span>}
                          </td>
                          <td className="px-4 py-2 text-green-600 align-top break-all">
                            {d.newVal ?? <span className="text-gray-300 italic">空</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
