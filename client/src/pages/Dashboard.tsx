import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface ProjectStat {
  projectId: number;
  projectName: string;
  deviceCount: number;
  signalCount: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalProjects: 0,
    pendingTasks: 0,
    completedTasks: 0,
  });
  const [projectStats, setProjectStats] = useState<ProjectStat[]>([]);

  useEffect(() => {
    if (user?.role !== 'admin') {
      // 总体PMO组默认进用户管理页，其他角色进项目数据页
      fetch('/api/users/me/permissions', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const perms = data?.permissions || [];
          const isPMO = perms.some((p: any) => p.project_role === '总体PMO组');
          navigate(isPMO ? '/users' : '/project-data', { replace: true });
        })
        .catch(() => navigate('/project-data', { replace: true }));
      return;
    }
    fetchStats();
  }, [user]);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');

      const [tasksRes, tableStatsRes, projectsRes] = await Promise.all([
        fetch('/api/tasks', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/data/stats', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/projects', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const tasks = await tasksRes.json();
      const tableStatsData = await tableStatsRes.json();
      const projectsData = await projectsRes.json();

      const projectCount = projectsData.projects?.length || 0;

      setStats({
        totalProjects: projectCount,
        pendingTasks: tasks.tasks?.filter((t: any) => t.status === 'pending').length || 0,
        completedTasks: tasks.tasks?.filter((t: any) => t.status === 'completed').length || 0,
      });
      setProjectStats(tableStatsData.tableStats || []);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Layout>
      <div className="px-6 py-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
          欢迎，{user?.username}
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-lg p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-black dark:bg-white rounded-full p-3">
                <svg className="h-5 w-5 text-white dark:text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-4">
                <dt className="text-xs text-black/40 dark:text-white/40 tracking-snug mono-label">
                  {user?.role === 'admin' ? '总项目数' : '参与项目数'}
                </dt>
                <dd className="text-xl font-extrabold text-black dark:text-white tracking-tight mt-0.5">
                  {stats.totalProjects}
                </dd>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-lg p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-black dark:bg-white rounded-full p-3">
                <svg className="h-5 w-5 text-white dark:text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <dt className="text-xs text-black/40 dark:text-white/40 tracking-snug mono-label">
                  待处理任务
                </dt>
                <dd className="text-xl font-extrabold text-black dark:text-white tracking-tight mt-0.5">
                  {stats.pendingTasks}
                </dd>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-lg p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-black dark:bg-white rounded-full p-3">
                <svg className="h-5 w-5 text-white dark:text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <dt className="text-xs text-black/40 dark:text-white/40 tracking-snug mono-label">
                  已完成任务
                </dt>
                <dd className="text-xl font-extrabold text-black dark:text-white tracking-tight mt-0.5">
                  {stats.completedTasks}
                </dd>
              </div>
            </div>
          </div>
        </div>

        {/* 项目数据统计 */}
        <div className="mt-8 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-lg">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
            <h2 className="text-base font-bold text-black dark:text-white tracking-snug">项目数据统计</h2>
            <p className="text-xs text-black/40 dark:text-white/40 mt-1">共 {projectStats.length} 个项目</p>
          </div>
          <div className="p-6">
            {projectStats.length === 0 ? (
              <p className="text-black/30 dark:text-white/30 text-center py-8 text-sm">暂无项目数据</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-white/10">
                      <th className="px-6 py-3 text-left mono-label text-black/40 dark:text-white/40">
                        项目名称
                      </th>
                      <th className="px-6 py-3 text-left mono-label text-black/40 dark:text-white/40">
                        设备数
                      </th>
                      <th className="px-6 py-3 text-left mono-label text-black/40 dark:text-white/40">
                        信号数
                      </th>
                      <th className="px-6 py-3 text-left mono-label text-black/40 dark:text-white/40">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                    {projectStats.map((stat) => (
                      <tr key={stat.projectId} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors">
                        <td className="px-6 py-3.5 whitespace-nowrap text-sm font-bold text-black dark:text-white tracking-snug">
                          {stat.projectName}
                        </td>
                        <td className="px-6 py-3.5 whitespace-nowrap text-sm text-black/60 dark:text-white/60">
                          {(stat.deviceCount || 0).toLocaleString()}
                        </td>
                        <td className="px-6 py-3.5 whitespace-nowrap text-sm text-black/60 dark:text-white/60">
                          {(stat.signalCount || 0).toLocaleString()}
                        </td>
                        <td className="px-6 py-3.5 whitespace-nowrap text-sm">
                          <button
                            onClick={() => navigate(`/project-data?projectId=${stat.projectId}`)}
                            className="text-black dark:text-white underline decoration-1 underline-offset-2 hover:text-black/60 dark:hover:text-white/60 transition-colors"
                          >
                            查看项目数据
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>
    </Layout>
  );
}
