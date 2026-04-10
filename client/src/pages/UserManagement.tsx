import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface Permission {
  project_name: string;
  project_role: string;
  reserved: string;
  can_approve?: boolean;
}

interface User {
  id: number;
  username: string;
  name?: string;
  department?: string;
  remarks?: string;
  display_name?: string;
  role: string;
  permissions?: Permission[];
  created_at: string;
}

interface PermissionRequest {
  id: number;
  user_id: number;
  username: string;
  display_name?: string;
  project_name: string;
  project_role: string;
  status: string;
  created_at: string;
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const [myPerms, setMyPerms] = useState<Permission[]>([]);
  const isPMO = myPerms.some(p => p.project_role === '总体PMO组');
  const canManageUsers = isAdmin || isPMO;
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [availableProjects, setAvailableProjects] = useState<Array<{id: number, name: string}>>([]);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'user',
    name: '',
    department: '',
    remarks: '',
    permissions: [] as Permission[],
  });
  const [permRequests, setPermRequests] = useState<PermissionRequest[]>([]);

  useEffect(() => {
    fetchUsers();
    fetchProjects();
    fetchPermRequests();
    // 加载当前用户权限
    if (!isAdmin) {
      fetch('/api/users/me/permissions', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.permissions) setMyPerms(data.permissions); })
        .catch(() => {});
    }
  }, []);

  const fetchPermRequests = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/users/permission-requests', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPermRequests(data.requests || []);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleReviewRequest = async (id: number, action: 'approve' | 'reject') => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/users/permission-requests/${id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        fetchPermRequests();
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || '操作失败');
      }
    } catch {
      alert('网络错误');
    }
  };
  
  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      setAvailableProjects(result.projects || []);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      setUsers(result.users || []);
    } catch (error) {
      console.error(error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (user?: User) => {
    fetchProjects();
    if (user) {
      setEditingUser(user);
      setFormData({
        username: user.username,
        password: '',
        role: user.role,
        name: user.name || '',
        department: user.department || '',
        remarks: user.remarks || '',
        permissions: user.permissions || [],
      });
    } else {
      setEditingUser(null);
      setFormData({
        username: '',
        password: '',
        role: 'user',
        name: '',
        department: '',
        remarks: '',
        permissions: [],
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingUser(null);
    setFormData({
      username: '',
      password: '',
      role: 'user',
      name: '',
      department: '',
      remarks: '',
      permissions: [],
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingUser && !formData.password) {
      alert('请设置密码');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const url = editingUser
        ? `/api/users/${editingUser.id}`
        : '/api/users';
      const method = editingUser ? 'PUT' : 'POST';

      const body: any = {
        username: formData.username,
        role: formData.role,
        name: formData.name || null,
        department: formData.department || null,
        remarks: formData.remarks || null,
      };

      if (formData.password) {
        body.password = formData.password;
      }

      if (formData.role === 'user' && formData.permissions) {
        body.permissions = formData.permissions;
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        alert(editingUser ? '用户更新成功' : '用户创建成功');
        handleCloseModal();
        fetchUsers();
      } else {
        alert(data.error || '操作失败');
      }
    } catch (error) {
      console.error(error);
      alert('操作失败');
    }
  };

  const handleDelete = async (userId: number) => {
    if (!confirm('确定要删除此用户吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json();

      if (response.ok) {
        alert('用户删除成功');
        fetchUsers();
      } else {
        alert(data.error || '删除失败');
      }
    } catch (error) {
      console.error(error);
      alert('删除失败');
    }
  };

  const handleResetPassword = async (userId: number) => {
    const newPassword = prompt('请输入新密码：');
    if (!newPassword) return;

    if (!confirm(`确定要重置用户密码吗？`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password: newPassword }),
      });

      const data = await response.json();

      if (response.ok) {
        alert('密码重置成功');
      } else {
        alert(data.error || '密码重置失败');
      }
    } catch (error) {
      console.error(error);
      alert('密码重置失败');
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-gray-600 dark:text-white/60">加载中...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-6 py-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">用户管理</h1>

        {/* 区域一：用户组权限说明 */}
        <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-lg p-4 mb-6">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-3">用户组权限说明</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-neutral-800 text-gray-500 dark:text-white/50">
                  <th className="px-3 py-2 text-left">权限</th>
                  <th className="px-3 py-2 text-center">总体组</th>
                  <th className="px-3 py-2 text-center">系统组</th>
                  <th className="px-3 py-2 text-center">总体PMO组</th>
                  <th className="px-3 py-2 text-center">供应商组</th>
                  <th className="px-3 py-2 text-center">其他组</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10 text-gray-700 dark:text-white/70">
                <tr><td className="px-3 py-1.5">添加/编辑/删除设备</td><td className="px-3 py-1.5 text-center">✅ 需审批</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td></tr>
                <tr><td className="px-3 py-1.5">添加/编辑/删除连接器</td><td className="px-3 py-1.5 text-center">✅ 需审批</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td></tr>
                <tr><td className="px-3 py-1.5">添加/编辑/删除针孔</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">✅ 自己设备</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td></tr>
                <tr><td className="px-3 py-1.5">添加/编辑/删除信号</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">✅ 需审批</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td></tr>
                <tr><td className="px-3 py-1.5">导入设备/连接器数据</td><td className="px-3 py-1.5 text-center">✅</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td></tr>
                <tr><td className="px-3 py-1.5">导入信号数据</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">✅</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td></tr>
                <tr><td className="px-3 py-1.5">WB导出 / 下载数据</td><td className="px-3 py-1.5 text-center">✅</td><td className="px-3 py-1.5 text-center">✅</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">✅</td><td className="px-3 py-1.5 text-center">—</td></tr>
                <tr><td className="px-3 py-1.5">用户管理 / 权限审批</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">✅</td><td className="px-3 py-1.5 text-center">—</td><td className="px-3 py-1.5 text-center">—</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 区域二：待审批的权限申请 */}
        {permRequests.filter(r => r.status === 'pending').length > 0 && (
          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-lg p-4 mb-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-3">待审批的权限申请</h2>
            <table className="min-w-full divide-y divide-gray-200 dark:divide-white/10 text-sm">
              <thead className="bg-gray-50 dark:bg-neutral-800">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-white/50">用户</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-white/50">申请项目</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-white/50">申请角色</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-white/50">申请时间</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-white/50">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {permRequests.filter(r => r.status === 'pending').map(req => (
                  <tr key={req.id}>
                    <td className="px-4 py-2">{req.display_name || req.username} <span className="text-gray-400 dark:text-white/40">({req.username})</span></td>
                    <td className="px-4 py-2">{req.project_name}</td>
                    <td className="px-4 py-2">{req.project_role}</td>
                    <td className="px-4 py-2 text-gray-500 dark:text-white/50">{new Date(req.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 space-x-2">
                      <button onClick={() => handleReviewRequest(req.id, 'approve')} className="text-green-600 hover:text-green-900">批准</button>
                      <button onClick={() => handleReviewRequest(req.id, 'reject')} className="text-red-600 hover:text-red-900">驳回</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 区域三：用户管理 */}
        <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
          <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 dark:border-white/10">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">用户列表</h2>
            {canManageUsers && (
              <button onClick={() => handleOpenModal()} className="btn-primary">+ 添加用户</button>
            )}
          </div>
          <table className="min-w-full divide-y divide-gray-200 dark:divide-white/10">
            <thead className="bg-gray-50 dark:bg-neutral-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wider">用户名(EID)</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wider">姓名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wider">部门</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wider">备注</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wider">角色</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wider">权限</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wider">创建时间</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-neutral-900 divide-y divide-gray-200 dark:divide-white/10">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-white/50">{user.id}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-white">{user.username}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">{user.name || <span className="text-gray-300 dark:text-white/30">-</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-white/50">{user.department || <span className="text-gray-300 dark:text-white/30">-</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-white/50 max-w-xs truncate">{user.remarks || <span className="text-gray-300 dark:text-white/30">-</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-black/[0.06] dark:bg-white/[0.1] text-black dark:text-white'
                    }`}>
                      {user.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-white/50">
                    {user.role === 'admin' ? (
                      <span className="text-gray-400 dark:text-white/40">不适用</span>
                    ) : (
                      <div className="space-y-1">
                        {user.permissions && user.permissions.length > 0 ? (
                          user.permissions.map((perm, idx) => (
                            <div key={idx} className="text-xs">
                              <span className="font-medium">{perm.project_name}</span>
                              {' → '}
                              <span>{perm.project_role}</span>
                              {perm.project_role === '总体组' && perm.can_approve && (
                                <span className="ml-1 text-black dark:text-white font-medium">（审批）</span>
                              )}
                            </div>
                          ))
                        ) : (
                          <span className="text-gray-400 dark:text-white/40 text-xs">无权限</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-white/50">
                    {new Date(user.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium space-x-2">
                    {canManageUsers && (
                      <>
                        <button
                          onClick={() => handleOpenModal(user)}
                          className="text-black dark:text-white hover:text-black/60 dark:hover:text-white/60"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleResetPassword(user.id)}
                          className="text-green-600 hover:text-green-900"
                        >
                          重置密码
                        </button>
                        {user.id !== currentUser?.id && (
                          <button
                            onClick={() => handleDelete(user.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            删除
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>


        {/* 添加/编辑用户对话框 */}
        {showModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-white/10 max-w-2xl w-full max-h-[90vh] flex flex-col">
              <div className="flex justify-between items-center px-6 pt-6 pb-4 shrink-0">
                <h3 className="text-xl font-bold">
                  {editingUser ? '编辑用户' : '添加用户'}
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="btn-secondary"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    form="user-form"
                    className="btn-primary"
                  >
                    {editingUser ? '更新' : '创建'}
                  </button>
                </div>
              </div>

              <form id="user-form" onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                <div className="space-y-4 flex-1 overflow-y-auto px-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-2">用户名（EID）</label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full border border-gray-300 dark:border-white/20 rounded-lg px-3 py-2 dark:bg-neutral-800 dark:text-white"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-2">姓名</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full border border-gray-300 dark:border-white/20 rounded-lg px-3 py-2 dark:bg-neutral-800 dark:text-white"
                        placeholder="员工姓名"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-2">部门</label>
                      <input
                        type="text"
                        value={formData.department}
                        onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                        className="w-full border border-gray-300 dark:border-white/20 rounded-lg px-3 py-2 dark:bg-neutral-800 dark:text-white"
                        placeholder="所属部门"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-2">备注</label>
                    <input
                      type="text"
                      value={formData.remarks}
                      onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                      className="w-full border border-gray-300 dark:border-white/20 rounded-lg px-3 py-2 dark:bg-neutral-800 dark:text-white"
                      placeholder="可选"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-2">
                      密码
                      {editingUser && <span className="text-gray-500 dark:text-white/50 text-xs ml-2">（留空则不修改）</span>}
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full border border-gray-300 dark:border-white/20 rounded-lg px-3 py-2 dark:bg-neutral-800 dark:text-white"
                      required={!editingUser}
                      placeholder={editingUser ? '留空则不修改密码' : '请输入密码'}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-2">
                      角色
                    </label>
                    <select
                      value={formData.role}
                      onChange={(e) =>
                        setFormData({ ...formData, role: e.target.value })
                      }
                      className="w-full border border-gray-300 dark:border-white/20 rounded-lg px-3 py-2 dark:bg-neutral-800 dark:text-white"
                    >
                      <option value="admin">管理员</option>
                      <option value="user">普通用户</option>
                    </select>
                  </div>

                  {formData.role === 'user' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-2">
                        权限管理
                      </label>
                      <div className="space-y-3">
                        {formData.permissions.map((perm, idx) => (
                          <div key={idx} className="flex gap-2 items-end">
                            <div className="flex-1 min-w-0">
                              <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">项目名称</label>
                              <select
                                value={perm.project_name}
                                onChange={(e) => {
                                  const newValue = e.target.value;
                                  const newPerms = [...formData.permissions];

                                  // 一个用户在同一项目只能有一种角色
                                  const isDuplicate = newPerms.some((p, i) =>
                                    i !== idx &&
                                    p.project_name === newValue
                                  );

                                  if (isDuplicate) {
                                    alert('该用户在此项目下已有角色，每个项目只能分配一种角色');
                                    return;
                                  }

                                  newPerms[idx] = { ...newPerms[idx], project_name: newValue };
                                  setFormData({ ...formData, permissions: newPerms });
                                }}
                                className="w-full border border-gray-300 dark:border-white/20 rounded px-3 py-2 text-sm dark:bg-neutral-800 dark:text-white"
                              >
                                <option value="">选择项目</option>
                                {availableProjects.map((project) => (
                                  <option key={project.id} value={project.name}>
                                    {project.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-1 min-w-0">
                              <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">项目角色</label>
                              <select
                                disabled={!perm.project_name}
                                value={perm.project_role}
                                onChange={(e) => {
                                  const newRole = e.target.value;
                                  const newPerms = [...formData.permissions];
                                  let can_approve: boolean | undefined = undefined;
                                  if (newRole === '总体组') {
                                    if (newPerms[idx].project_role === '总体组') {
                                      // 角色未变，保留原值
                                      can_approve = newPerms[idx].can_approve ?? false;
                                    } else {
                                      // 刚切换为总体组：若该项目无其他审批人则默认勾选
                                      const projectName = newPerms[idx].project_name;
                                      const hasOtherApprover = users.some(u =>
                                        u.id !== editingUser?.id &&
                                        (u.permissions || []).some(p => p.project_name === projectName && p.project_role === '总体组' && p.can_approve === true)
                                      );
                                      can_approve = !hasOtherApprover;
                                    }
                                  }
                                  newPerms[idx] = { ...newPerms[idx], project_role: newRole, can_approve };
                                  setFormData({ ...formData, permissions: newPerms });
                                }}
                                className="w-full border border-gray-300 dark:border-white/20 rounded px-3 py-2 text-sm dark:bg-neutral-800 dark:text-white"
                              >
                                <option value="">选择角色</option>
                                <option value="总体组">总体组</option>
                                <option value="系统组">系统组</option>
                                <option value="总体PMO组">总体PMO组</option>
                                <option value="供应商组">供应商组</option>
                                <option value="其他组">其他组</option>
                              </select>
                            </div>
                            {perm.project_role === '总体组' && (() => {
                              const otherApproversCount = users.filter(u =>
                                u.id !== editingUser?.id &&
                                (u.permissions || []).some(p => p.project_name === perm.project_name && p.project_role === '总体组' && p.can_approve === true)
                              ).length;
                              const isLastApprover = !!perm.can_approve && otherApproversCount === 0;
                              return (
                                <div className="flex-shrink-0 pb-1">
                                  <label className="block text-xs text-gray-600 dark:text-white/60 mb-1 invisible">审批权</label>
                                  <label className={`flex items-center gap-1.5 whitespace-nowrap select-none ${isLastApprover ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                                    <input
                                      type="checkbox"
                                      checked={!!perm.can_approve}
                                      disabled={isLastApprover}
                                      onChange={(e) => {
                                        const newPerms = [...formData.permissions];
                                        newPerms[idx] = { ...newPerms[idx], can_approve: e.target.checked };
                                        setFormData({ ...formData, permissions: newPerms });
                                      }}
                                      className="w-3.5 h-3.5"
                                    />
                                    <span className="text-xs text-gray-600 dark:text-white/60">
                                      {isLastApprover ? '审批权（唯一，不可取消）' : '具有审批权'}
                                    </span>
                                  </label>
                                </div>
                              );
                            })()}
                            <button
                              type="button"
                              onClick={() => {
                                const newPerms = formData.permissions.filter((_, i) => i !== idx);
                                setFormData({ ...formData, permissions: newPerms });
                              }}
                              className="px-3 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600"
                            >
                              删除
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            // 添加新权限时，检查是否所有必填字段都已填充
                            const hasEmptyPermissions = formData.permissions.some(
                              (p) => !p.project_name || !p.project_role
                            );
                            
                            if (hasEmptyPermissions) {
                              alert('请先完成已添加权限的填写（项目名称和项目角色）');
                              return;
                            }
                            
                            // 添加新的空权限
                            setFormData({
                              ...formData,
                              permissions: [
                                ...formData.permissions,
                                { project_name: '', project_role: '', reserved: '' },
                              ],
                            });
                          }}
                          className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-white/20 rounded text-gray-600 dark:text-white/60 hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white text-sm"
                        >
                          + 添加权限
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 按钮已移至右上角 */}
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
