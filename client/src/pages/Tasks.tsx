import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface Task {
  id: number;
  data_id: number;
  assigned_by: number;
  assigned_to: number;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
  assigned_by_name: string;
  assigned_to_name: string;
  item_code: string;
  item_name: string;
}

interface TaskDetail extends Task {
  [key: string]: any;
}

interface ChangeLog {
  id: number;
  data_id: number;
  changed_by: number;
  old_values: string;
  new_values: string;
  reason: string;
  status: string;
  created_at: string;
}

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [changeLogs, setChangeLogs] = useState<ChangeLog[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [needsChange, setNeedsChange] = useState(false);
  const [formData, setFormData] = useState({
    item_code: '',
    item_name: '',
    description: '',
    specification: '',
    unit: '',
    price: '',
  });
  const [reason, setReason] = useState('');

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:3000/api/tasks', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      setTasks(result.tasks);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetail = async (taskId: number) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:3000/api/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      setSelectedTask(result.task);
      setChangeLogs(result.changeLogs || []);
      if (user?.role === 'reviewer') {
        setFormData({
          item_code: result.task.item_code || '',
          item_name: result.task.item_name || '',
          description: result.task.description || '',
          specification: result.task.specification || '',
          unit: result.task.unit || '',
          price: result.task.price?.toString() || '',
        });
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleSubmitReview = async () => {
    try {
      const token = localStorage.getItem('token');
      
      if (needsChange) {
        await fetch(`http://localhost:3000/api/tasks/${selectedTask?.id}/submit`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            needs_change: true,
            changes: formData,
            old_values: {
              item_code: selectedTask?.item_code,
              item_name: selectedTask?.item_name,
              description: selectedTask?.description,
              specification: selectedTask?.specification,
              unit: selectedTask?.unit,
              price: selectedTask?.price,
            },
            data_id: selectedTask?.data_id,
            reason,
          }),
        });
      } else {
        await fetch(`http://localhost:3000/api/tasks/${selectedTask?.id}/submit`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            needs_change: false,
            reason,
          }),
        });
      }

      alert('提交成功');
      setShowReview(false);
      setSelectedTask(null);
      fetchTasks();
    } catch (error) {
      console.error(error);
      alert('提交失败');
    }
  };

  const handleConfirm = async (changeLogId: number) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`http://localhost:3000/api/tasks/${selectedTask?.id}/confirm`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ change_log_id: changeLogId }),
      });

      alert('确认成功');
      setSelectedTask(null);
      fetchTasks();
      window.location.reload();
    } catch (error) {
      console.error(error);
      alert('确认失败');
    }
  };

  const handleReject = async (changeLogId: number) => {
    const reason = prompt('请输入拒绝原因：');
    if (!reason) return;

    try {
      const token = localStorage.getItem('token');
      await fetch(`http://localhost:3000/api/tasks/${selectedTask?.id}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ change_log_id: changeLogId, reason }),
      });

      alert('已拒绝');
      setSelectedTask(null);
      fetchTasks();
    } catch (error) {
      console.error(error);
      alert('操作失败');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'submitted':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'no_change':
        return 'bg-gray-100 text-gray-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return '待审查';
      case 'submitted':
        return '已提交';
      case 'completed':
        return '已完成';
      case 'no_change':
        return '无需修改';
      case 'rejected':
        return '已拒绝';
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-gray-600">加载中...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 sm:px-0">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">任务管理</h1>

        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">物品编码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">物品名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {user?.role === 'admin' ? '审查员' : '管理员'}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{task.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{task.item_code}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{task.item_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user?.role === 'admin' ? task.assigned_to_name : task.assigned_by_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(task.status)}`}>
                        {getStatusText(task.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(task.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => handleViewDetail(task.id)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 任务详情对话框 */}
        {selectedTask && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 my-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">任务详情</h3>
                <button
                  onClick={() => {
                    setSelectedTask(null);
                    setShowReview(false);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">物品编码</p>
                  <p className="font-semibold">{selectedTask.item_code}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">物品名称</p>
                  <p className="font-semibold">{selectedTask.item_name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">规格</p>
                  <p className="font-semibold">{selectedTask.specification}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">单位</p>
                  <p className="font-semibold">{selectedTask.unit}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">价格</p>
                  <p className="font-semibold">¥{selectedTask.price}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">状态</p>
                  <p className={`inline-block px-2 py-1 rounded text-xs ${getStatusColor(selectedTask.status)}`}>
                    {getStatusText(selectedTask.status)}
                  </p>
                </div>
                {selectedTask.notes && (
                  <div>
                    <p className="text-sm text-gray-500">备注</p>
                    <p className="font-semibold">{selectedTask.notes}</p>
                  </div>
                )}
              </div>

              {user?.role === 'reviewer' && selectedTask.status === 'pending' && (
                <div className="mt-6">
                  <button
                    onClick={() => setShowReview(!showReview)}
                    className="w-full bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600"
                  >
                    {showReview ? '取消审查' : '开始审查'}
                  </button>
                </div>
              )}

              {/* 审查表单 */}
              {showReview && selectedTask.status === 'pending' && (
                <div className="mt-6 border-t pt-6">
                  <h4 className="font-bold mb-4">审查结果</h4>
                  <div className="mb-4">
                    <label className="flex items-center space-x-2">
                      <input
                        type="radio"
                        checked={!needsChange}
                        onChange={() => setNeedsChange(false)}
                      />
                      <span>无需修改</span>
                    </label>
                    <label className="flex items-center space-x-2 mt-2">
                      <input
                        type="radio"
                        checked={needsChange}
                        onChange={() => setNeedsChange(true)}
                      />
                      <span>需要修改</span>
                    </label>
                  </div>

                  {needsChange && (
                    <div className="space-y-4 bg-gray-50 p-4 rounded">
                      <h5 className="font-semibold mb-2">修改内容：</h5>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">物品编码</label>
                        <input
                          type="text"
                          value={formData.item_code}
                          onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">物品名称</label>
                        <input
                          type="text"
                          value={formData.item_name}
                          onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">描述</label>
                        <input
                          type="text"
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">规格</label>
                        <input
                          type="text"
                          value={formData.specification}
                          onChange={(e) => setFormData({ ...formData, specification: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">单位</label>
                        <input
                          type="text"
                          value={formData.unit}
                          onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">价格</label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.price}
                          onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <label className="block text-sm text-gray-700 mb-2">审查原因/备注</label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2"
                      rows={3}
                      required
                    />
                  </div>

                  <div className="mt-4 flex space-x-3">
                    <button
                      onClick={handleSubmitReview}
                      className="flex-1 bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600"
                    >
                      提交审查结果
                    </button>
                  </div>
                </div>
              )}

              {/* 管理员确认/拒绝 */}
              {user?.role === 'admin' && selectedTask.status === 'submitted' && changeLogs.length > 0 && (
                <div className="mt-6 border-t pt-6">
                  <h4 className="font-bold mb-4">待确认的修改</h4>
                  {changeLogs.map((log: ChangeLog) => (
                    <div key={log.id} className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
                      <p className="text-sm text-gray-600 mb-2">修改原因：{log.reason}</p>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="font-semibold text-gray-700 mb-1">原值</p>
                          {log.old_values && Object.entries(JSON.parse(log.old_values)).map(([key, value]: [string, any]) => (
                            <p key={key} className="text-gray-600">
                              {key}: {value}
                            </p>
                          ))}
                        </div>
                        <div>
                          <p className="font-semibold text-green-700 mb-1">新值</p>
                          {log.new_values && Object.entries(JSON.parse(log.new_values)).map(([key, value]: [string, any]) => (
                            <p key={key} className="text-gray-600">
                              {key}: {value}
                            </p>
                          ))}
                        </div>
                      </div>
                      <div className="flex space-x-3 mt-4">
                        <button
                          onClick={() => handleReject(log.id)}
                          className="flex-1 bg-red-500 text-white py-2 rounded-lg hover:bg-red-600"
                        >
                          拒绝修改
                        </button>
                        <button
                          onClick={() => handleConfirm(log.id)}
                          className="flex-1 bg-green-500 text-white py-2 rounded-lg hover:bg-green-600"
                        >
                          确认修改
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
