import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme, type ThemeMode } from '../context/ThemeContext';

interface Permission {
  project_name: string;
  project_role: string;
}

interface PermissionRequest {
  id: number;
  project_name: string;
  project_role: string;
  status: string;
  created_at: string;
}

interface ProfileData {
  username: string;
  name: string;
  department: string;
  permissions: Permission[];
}

interface Props {
  onClose: () => void;
}

const PROJECT_ROLES = ['总体人员', 'EWIS管理员', '设备管理员', '一级包长', '二级包长'];

export default function ProfileModal({ onClose }: Props) {
  const { user: currentUser, token, updateUser } = useAuth();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const isAdmin = currentUser?.role === 'admin';
  const [profile, setProfile] = useState<ProfileData>({
    username: '',
    name: '',
    department: '',
    permissions: [],
  });
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [reqProject, setReqProject] = useState('');
  const [reqRole, setReqRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [reqMsg, setReqMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [pwdForm, setPwdForm] = useState({ current: '', next: '', confirm: '' });
  const [pwdChanging, setPwdChanging] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    const load = async () => {
      try {
        const [profRes, projRes] = await Promise.all([
          fetch('/api/auth/profile', { headers }),
          fetch('/api/projects/names', { headers }),
        ]);
        if (profRes.ok) {
          const { user, requests: reqs } = await profRes.json();
          setProfile({
            username: user.username,
            name: user.name || '',
            department: user.department || '',
            permissions: user.permissions || [],
          });
          setRequests(reqs || []);
        }
        if (projRes.ok) {
          const { projects: projs } = await projRes.json();
          setProjects((projs || []).map((p: any) => p.name));
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const hasPending = requests.some(r => r.status === 'pending');

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: profile.name, department: profile.department }),
      });
      if (res.ok) {
        updateUser({ employee_name: profile.name });
        setSaveMsg('保存成功');
      } else {
        const data = await res.json();
        setSaveMsg(data.error || '保存失败');
      }
    } catch {
      setSaveMsg('网络错误');
    } finally {
      setSaving(false);
    }
  };

  const handleRequest = async () => {
    if (!reqProject || !reqRole) {
      setReqMsg('请选择项目和角色');
      return;
    }
    setSubmitting(true);
    setReqMsg('');
    try {
      // 先保存姓名和部门，避免用户忘记点"保存"
      await fetch('/api/auth/profile', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: profile.name, department: profile.department }),
      });

      const res = await fetch('/api/auth/permission-request', {
        method: 'POST',
        headers,
        body: JSON.stringify({ project_name: reqProject, project_role: reqRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setReqMsg(data.message);
        setReqProject('');
        setReqRole('');
        // 刷新申请列表
        const profRes = await fetch('/api/auth/profile', { headers });
        if (profRes.ok) {
          const { requests: reqs } = await profRes.json();
          setRequests(reqs || []);
        }
      } else {
        setReqMsg(data.error || '提交失败');
      }
    } catch {
      setReqMsg('网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangePassword = async () => {
    if (!pwdForm.current || !pwdForm.next || !pwdForm.confirm) {
      setPwdMsg('请填写所有密码字段');
      return;
    }
    if (pwdForm.next !== pwdForm.confirm) {
      setPwdMsg('两次输入的新密码不一致');
      return;
    }
    setPwdChanging(true);
    setPwdMsg('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ current_password: pwdForm.current, new_password: pwdForm.next }),
      });
      const data = await res.json();
      if (res.ok) {
        setPwdMsg(data.message);
        setPwdForm({ current: '', next: '', confirm: '' });
      } else {
        setPwdMsg(data.error || '修改失败');
      }
    } catch {
      setPwdMsg('网络错误');
    } finally {
      setPwdChanging(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">个人设置</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12 text-gray-400">加载中...</div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* 基本信息 */}
            <section>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">基本信息</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">用户名（不可修改）</label>
                  <input
                    type="text"
                    value={profile.username}
                    disabled
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">姓名</label>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                    placeholder="请输入姓名"
                  />
                </div>
                {!isAdmin && (
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">所属部门</label>
                    <input
                      type="text"
                      value={profile.department}
                      onChange={e => setProfile(p => ({ ...p, department: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                      placeholder="请输入部门"
                    />
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:bg-blue-300"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
                {saveMsg && (
                  <span className={`text-sm ${saveMsg === '保存成功' ? 'text-green-600' : 'text-red-600'}`}>
                    {saveMsg}
                  </span>
                )}
              </div>
            </section>

            {/* UI 主题 */}
            <section>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">界面主题</h3>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'light', label: '浅色', icon: '☀️', desc: '始终使用白色主题' },
                  { value: 'dark',  label: '深色', icon: '🌙', desc: '始终使用暗色主题' },
                  { value: 'auto',  label: '自动', icon: '🔄', desc: '6:00–18:00 浅色，其余深色' },
                ] as { value: ThemeMode; label: string; icon: string; desc: string }[]).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setThemeMode(opt.value)}
                    className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg border-2 transition-colors text-center ${
                      themeMode === opt.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-500'
                    }`}
                  >
                    <span className="text-xl">{opt.icon}</span>
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-xs text-gray-400 leading-tight">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* 修改密码（所有用户） */}
            <section>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">修改密码</h3>
              <div className="space-y-2">
                <input
                  type="password"
                  value={pwdForm.current}
                  onChange={e => setPwdForm(p => ({ ...p, current: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                  placeholder="当前密码"
                />
                <input
                  type="password"
                  value={pwdForm.next}
                  onChange={e => setPwdForm(p => ({ ...p, next: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                  placeholder="新密码（至少 6 位）"
                />
                <input
                  type="password"
                  value={pwdForm.confirm}
                  onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                  placeholder="确认新密码"
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleChangePassword}
                  disabled={pwdChanging}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:bg-blue-300"
                >
                  {pwdChanging ? '提交中...' : '修改密码'}
                </button>
                {pwdMsg && (
                  <span className={`text-sm ${pwdMsg === '密码修改成功' ? 'text-green-600' : 'text-red-600'}`}>
                    {pwdMsg}
                  </span>
                )}
              </div>
            </section>

            {/* 当前权限（仅普通用户） */}
            {!isAdmin && (
              <section>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">当前项目权限</h3>
                {profile.permissions.length === 0 ? (
                  <p className="text-sm text-gray-400">暂无项目权限</p>
                ) : (
                  <div className="space-y-1">
                    {profile.permissions.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-gray-700">{p.project_name}</span>
                        <span className="text-gray-400">→</span>
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">{p.project_role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* 申请权限（仅普通用户） */}
            {!isAdmin && <section>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">申请项目权限</h3>

              {/* 待审批申请列表（只显示pending的，已处理的不再展示以避免与实际权限混淆） */}
              {requests.filter(r => r.status === 'pending').length > 0 && (
                <div className="mb-3 space-y-1">
                  {requests.filter(r => r.status === 'pending').map(r => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-gray-50 text-gray-400"
                    >
                      <span className="flex-1">
                        {r.project_name} → {r.project_role}
                      </span>
                      <span className="text-xs">待审批</span>
                    </div>
                  ))}
                </div>
              )}

              {hasPending ? (
                <p className="text-sm text-gray-400 italic">您有待审批的申请，请等待管理员处理后再提交新申请。</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={reqProject}
                      onChange={e => setReqProject(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="">选择项目</option>
                      {projects.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <select
                      value={reqRole}
                      onChange={e => setReqRole(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="">选择角色</option>
                      {PROJECT_ROLES.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleRequest}
                      disabled={submitting}
                      className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:bg-green-300"
                    >
                      {submitting ? '提交中...' : '申请'}
                    </button>
                    {reqMsg && (
                      <span className={`text-sm ${reqMsg.includes('失败') || reqMsg.includes('错误') || reqMsg.includes('请') ? 'text-red-600' : 'text-green-600'}`}>
                        {reqMsg}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>}
          </div>
        )}
      </div>
    </div>
  );
}
