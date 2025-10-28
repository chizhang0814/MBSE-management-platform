import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalData: 0,
    pendingTasks: 0,
    completedTasks: 0,
  });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      
      const [dataRes, tasksRes] = await Promise.all([
        fetch('http://localhost:3000/api/data', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('http://localhost:3000/api/tasks', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const data = await dataRes.json();
      const tasks = await tasksRes.json();

      setStats({
        totalData: data.data?.length || 0,
        pendingTasks: tasks.tasks?.filter((t: any) => t.status === 'pending').length || 0,
        completedTasks: tasks.tasks?.filter((t: any) => t.status === 'completed').length || 0,
      });
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
                      总数据量
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.totalData}
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

        <div className="mt-8 bg-white shadow rounded-lg">
          <div className="p-6">
            <h2 className="text-xl font-bold mb-4">快速指南</h2>
            <div className="space-y-3">
              <p className="text-gray-700">
                <strong>作为{user?.role === 'admin' ? '管理员' : '审查员'}，您可以：</strong>
              </p>
              <ul className="list-disc list-inside space-y-2 text-gray-600">
                {user?.role === 'admin' ? (
                  <>
                    <li>在"数据表格"页面查看所有EICD数据</li>
                    <li>指派审查任务给审查员</li>
                    <li>确认或拒绝审查员提交的修改</li>
                    <li>查看变更记录</li>
                  </>
                ) : (
                  <>
                    <li>在"任务管理"页面查看被指派的任务</li>
                    <li>审查数据并决定是否需要修改</li>
                    <li>提交修改建议给管理员确认</li>
                  </>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}


