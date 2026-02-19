import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface TableStat {
  tableName: string;
  displayName: string;
  projectName: string;
  projectId: number;
  tableType?: string;
  rowCount: number;
  deviceCount?: number;
  componentCount?: number;
  interfaceCount?: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalProjects: 0,
    pendingTasks: 0,
    completedTasks: 0,
  });
  const [tableStats, setTableStats] = useState<TableStat[]>([]);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      
      const [tasksRes, tableStatsRes, projectsRes] = await Promise.all([
        fetch('/api/tasks', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/data/tables/stats', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/projects', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const tasks = await tasksRes.json();
      const tableStatsData = await tableStatsRes.json();
      const projectsData = await projectsRes.json();

      // 根据用户角色获取项目数
      const projectCount = projectsData.projects?.length || 0;

      setStats({
        totalProjects: projectCount,
        pendingTasks: tasks.tasks?.filter((t: any) => t.status === 'pending').length || 0,
        completedTasks: tasks.tasks?.filter((t: any) => t.status === 'completed').length || 0,
      });
      setTableStats(tableStatsData.tableStats || []);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Layout>
      <div className="px-4 sm:px-0">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          欢迎, {user?.username}
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-blue-500 rounded-md p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      {user?.role === 'admin' ? '总项目数' : '参与项目数'}
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.totalProjects}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-yellow-500 rounded-md p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      待处理任务
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.pendingTasks}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-green-500 rounded-md p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      已完成任务
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.completedTasks}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 数据表统计 */}
        <div className="mt-8 bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold">数据表统计</h2>
            <p className="text-sm text-gray-500 mt-1">共 {tableStats.length} 个数据表</p>
          </div>
          <div className="p-6">
            {tableStats.length === 0 ? (
              <p className="text-gray-500 text-center py-8">暂无数据表</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        项目名称
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        数据表名称
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        数据行数
                      </th>
                      {user?.role === 'user' && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          负责数量
                        </th>
                      )}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {(() => {
                      // 按项目分组
                      const groupedByProject: { [key: string]: TableStat[] } = {};
                      tableStats.forEach((stat) => {
                        if (!groupedByProject[stat.projectName]) {
                          groupedByProject[stat.projectName] = [];
                        }
                        groupedByProject[stat.projectName].push(stat);
                      });

                      // 生成表格行
                      const rows: JSX.Element[] = [];
                      const projectNames = Object.keys(groupedByProject);
                      
                      projectNames.forEach((projectName, projectIndex) => {
                        const tables = groupedByProject[projectName];
                        const isLastProject = projectIndex === projectNames.length - 1;
                        
                        tables.forEach((stat, tableIndex) => {
                          const isFirstRow = tableIndex === 0;
                          const isLastRow = tableIndex === tables.length - 1;
                          const rowspan = isFirstRow ? tables.length : undefined;
                          // 所有项目的最后一行都显示分隔线
                          const showBorder = isLastRow;
                          
                          rows.push(
                            <tr 
                              key={`${stat.projectId}-${stat.tableName}`} 
                              className={`hover:bg-gray-50 ${showBorder ? 'border-b-2 border-gray-300' : ''}`}
                            >
                              {isFirstRow && (
                                <td 
                                  rowSpan={rowspan}
                                  className={`px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 align-middle ${showBorder ? 'border-b-2 border-gray-300' : ''}`}
                                >
                                  {stat.projectName}
                                </td>
                              )}
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {stat.displayName}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {stat.rowCount.toLocaleString()} 行
                              </td>
                              {user?.role === 'user' && (
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {stat.tableType === 'ata_device' && stat.deviceCount !== undefined
                                    ? stat.deviceCount.toLocaleString()
                                    : stat.tableType === 'device_component' && stat.componentCount !== undefined
                                    ? stat.componentCount.toLocaleString()
                                    : stat.tableType === 'electrical_interface' && stat.interfaceCount !== undefined
                                    ? stat.interfaceCount.toLocaleString()
                                    : '-'}
                                </td>
                              )}
                              <td className="px-6 py-4 whitespace-nowrap text-sm">
                                <button
                                  onClick={() => navigate(`/project-data?projectId=${stat.projectId}&tableName=${encodeURIComponent(stat.tableName)}&fromDashboard=true`)}
                                  className="text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  查看项目数据
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      });

                      return rows;
                    })()}
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


