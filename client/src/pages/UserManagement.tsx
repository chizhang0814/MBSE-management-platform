import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface Permission {
  project_name: string;
  project_role: string;
  reserved: string;
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
          <div className="text-lg text-gray-600">加载中...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 sm:px-0">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">用户管理</h1>
          <button
            onClick={() => handleOpenModal()}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
          >
            + 添加用户
          </button>
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户名(EID)</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">姓名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">部门</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">备注</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">角色</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">权限</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{user.id}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900">{user.username}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{user.name || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{user.department || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{user.remarks || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {user.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {user.role === 'admin' ? (
                      <span className="text-gray-400">不适用</span>
                    ) : (
                      <div className="space-y-1">
                        {user.permissions && user.permissions.length > 0 ? (
                          user.permissions.map((perm, idx) => (
                            <div key={idx} className="text-xs">
                              <span className="font-medium">{perm.project_name}</span>
                              {' → '}
                              <span>{perm.project_role}</span>
                            </div>
                          ))
                        ) : (
                          <span className="text-gray-400 text-xs">无权限</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {new Date(user.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium space-x-2">
                    <button
                      onClick={() => handleOpenModal(user)}
                      className="text-blue-600 hover:text-blue-900"
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 权限申请审批 */}
        {permRequests.filter(r => r.status === 'pending').length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">待审批的权限申请</h2>
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">申请项目</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">申请角色</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">申请时间</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {permRequests.filter(r => r.status === 'pending').map(req => (
                    <tr key={req.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {req.display_name || req.username}
                        <span className="text-gray-400 ml-1">({req.username})</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{req.project_name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{req.project_role}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(req.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <button
                          onClick={() => handleReviewRequest(req.id, 'approve')}
                          className="text-green-600 hover:text-green-900"
                        >
                          批准
                        </button>
                        <button
                          onClick={() => handleReviewRequest(req.id, 'reject')}
                          className="text-red-600 hover:text-red-900"
                        >
                          驳回
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 添加/编辑用户对话框 */}
        {showModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">
                  {editingUser ? '编辑用户' : '添加用户'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">用户名（EID）</label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">姓名</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        placeholder="员工姓名"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">部门</label>
                      <input
                        type="text"
                        value={formData.department}
                        onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        placeholder="所属部门"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
                    <input
                      type="text"
                      value={formData.remarks}
                      onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      placeholder="可选"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      密码
                      {editingUser && <span className="text-gray-500 text-xs ml-2">（留空则不修改）</span>}
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      required={!editingUser}
                      placeholder={editingUser ? '留空则不修改密码' : '请输入密码'}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      角色
                    </label>
                    <select
                      value={formData.role}
                      onChange={(e) =>
                        setFormData({ ...formData, role: e.target.value })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="admin">管理员</option>
                      <option value="user">普通用户</option>
                    </select>
                  </div>

                  {formData.role === 'user' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        权限管理
                      </label>
                      <div className="space-y-3">
                        {formData.permissions.map((perm, idx) => (
                          <div key={idx} className="flex space-x-2 items-end">
                            <div className="flex-1">
                              <label className="block text-xs text-gray-600 mb-1">项目名称</label>
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
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              >
                                <option value="">选择项目</option>
                                {availableProjects.map((project) => (
                                  <option key={project.id} value={project.name}>
                                    {project.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs text-gray-600 mb-1">项目角色</label>
                              <select
                                value={perm.project_role}
                                onChange={(e) => {
                                  const newPerms = [...formData.permissions];
                                  newPerms[idx] = { ...newPerms[idx], project_role: e.target.value };
                                  setFormData({ ...formData, permissions: newPerms });
                                }}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              >
                                <option value="">选择角色</option>
                                <option value="总体人员">总体人员</option>
                                <option value="EWIS管理员">EWIS管理员</option>
                                <option value="设备管理员">设备管理员</option>
                                <option value="一级包长">一级包长</option>
                                <option value="二级包长">二级包长</option>
                                <option value="只读">只读</option>
                              </select>
                            </div>
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
                          className="w-full py-2 border-2 border-dashed border-gray-300 rounded text-gray-600 hover:border-blue-500 hover:text-blue-500 text-sm"
                        >
                          + 添加权限
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex space-x-3 mt-6">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-blue-500 text-white rounded-lg px-4 py-2 hover:bg-blue-600"
                  >
                    {editingUser ? '更新' : '创建'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
