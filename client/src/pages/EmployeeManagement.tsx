import { useState, useEffect } from 'react';
import Layout from '../components/Layout';

interface Employee {
  id: number;
  eid: string;
  name: string;
  remarks: string | null;
  created_at: string;
}

const API_HEADERS = () => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});
const API_JSON_HEADERS = () => ({
  ...API_HEADERS(),
  'Content-Type': 'application/json',
});

export default function EmployeeManagement() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ eid: '', name: '', remarks: '' });
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const fetchEmployees = async () => {
    try {
      const res = await fetch('/api/employees', { headers: API_HEADERS() });
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEmployees(); }, []);

  const handleSubmit = async () => {
    setError('');
    if (!form.eid.trim() || !form.name.trim()) {
      setError('EID 和姓名不能为空');
      return;
    }
    try {
      const url = editingId ? `/api/employees/${editingId}` : '/api/employees';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: API_JSON_HEADERS(),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '操作失败');
        return;
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ eid: '', name: '', remarks: '' });
      fetchEmployees();
    } catch {
      setError('网络错误');
    }
  };

  const handleEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setForm({ eid: emp.eid, name: emp.name, remarks: emp.remarks || '' });
    setShowForm(true);
    setError('');
  };

  const handleDelete = async (emp: Employee) => {
    if (!confirm(`确认删除员工 ${emp.eid}（${emp.name}）？`)) return;
    try {
      await fetch(`/api/employees/${emp.id}`, { method: 'DELETE', headers: API_HEADERS() });
      fetchEmployees();
    } catch {}
  };

  const handleAdd = () => {
    setEditingId(null);
    setForm({ eid: '', name: '', remarks: '' });
    setShowForm(true);
    setError('');
  };

  const filtered = employees.filter(e =>
    e.eid.toLowerCase().includes(search.toLowerCase()) ||
    e.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">人员管理</h1>
          <button
            onClick={handleAdd}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
          >
            添加人员
          </button>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="搜索 EID 或姓名..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64"
          />
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">加载中...</div>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">EID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">备注</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                      {employees.length === 0 ? '暂无人员数据' : '无匹配结果'}
                    </td>
                  </tr>
                ) : (
                  filtered.map(emp => (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-mono text-gray-900">{emp.eid}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{emp.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{emp.remarks || '-'}</td>
                      <td className="px-6 py-4 text-right text-sm space-x-2">
                        <button
                          onClick={() => handleEdit(emp)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(emp)}
                          className="text-red-600 hover:text-red-800"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="px-6 py-3 bg-gray-50 text-xs text-gray-500">
              共 {filtered.length} 条{filtered.length !== employees.length ? ` (总 ${employees.length} 条)` : ''}
            </div>
          </div>
        )}

        {/* 添加/编辑弹窗 */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
              <h2 className="text-lg font-semibold mb-4">{editingId ? '编辑人员' : '添加人员'}</h2>
              {error && <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded mb-3">{error}</div>}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">EID</label>
                  <input
                    type="text"
                    value={form.eid}
                    onChange={e => setForm(f => ({ ...f, eid: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
                    placeholder="员工编号（需与用户名匹配）"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">姓名</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
                    placeholder="员工姓名"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <input
                    type="text"
                    value={form.remarks}
                    onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
                    placeholder="可选"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-5">
                <button
                  onClick={() => { setShowForm(false); setError(''); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingId ? '保存' : '添加'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
