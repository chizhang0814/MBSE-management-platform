import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface ApprovalRequest {
  id: number;
  project_id: number;
  project_name: string;
  requester_username: string;
  action_type: string;
  entity_type: string;
  entity_id: number | null;
  device_id: number | null;
  payload: string;
  status: string;
  rejection_reason: string | null;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  create_device: '新建设备',
  edit_device: '编辑设备',
  create_connector: '新建连接器',
  edit_connector: '编辑连接器',
};

const STATUS_LABELS: Record<string, { text: string; cls: string }> = {
  pending:  { text: '待审批', cls: 'bg-yellow-100 text-yellow-800' },
  approved: { text: '已通过', cls: 'bg-green-100 text-green-800' },
  rejected: { text: '已拒绝', cls: 'bg-red-100 text-red-800' },
};

const API_HEADERS = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const API_JSON_HEADERS = () => ({
  ...API_HEADERS(),
  'Content-Type': 'application/json',
});

function parseUtcDate(s: string): Date {
  return new Date(s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z');
}

export default function ApprovalManagement() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [myPermissions, setMyPermissions] = useState<Array<{ project_name: string; project_role: string }>>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'all' | 'my'>('pending');
  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async (tab: typeof activeTab) => {
    setLoading(true);
    try {
      let url = '';
      if (tab === 'my') {
        url = '/api/approvals/my';
      } else {
        url = `/api/approvals?status=${tab === 'pending' ? 'pending' : ''}`;
        if (tab === 'all') url = '/api/approvals?status=all';
      }
      // 'all' status hack: backend returns all if status not 'pending'/'approved'/'rejected'
      if (tab === 'all') url = '/api/approvals?status=all';
      const res = await fetch(url, { headers: API_HEADERS() });
      if (res.ok) setRows(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(activeTab); }, [activeTab]);

  useEffect(() => {
    if (isAdmin) return;
    fetch('/api/users/me/permissions', { headers: API_HEADERS() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.permissions) setMyPermissions(data.permissions); })
      .catch(() => {});
  }, []);

  const handleApprove = async (id: number) => {
    if (!confirm('确认审批通过？')) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/approvals/${id}/approve`, {
        method: 'PUT', headers: API_JSON_HEADERS(),
      });
      if (res.ok) {
        alert('审批通过，数据已写入系统');
        setSelected(null);
        load(activeTab);
      } else {
        const data = await res.json();
        alert(data.error || '操作失败');
      }
    } finally { setSubmitting(false); }
  };

  const handleReject = async (id: number) => {
    if (!rejectReason.trim()) { alert('请填写拒绝原因'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/approvals/${id}/reject`, {
        method: 'PUT', headers: API_JSON_HEADERS(),
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (res.ok) {
        alert('已拒绝，申请人将收到通知');
        setSelected(null);
        setRejectReason('');
        setShowRejectInput(false);
        load(activeTab);
      } else {
        const data = await res.json();
        alert(data.error || '操作失败');
      }
    } finally { setSubmitting(false); }
  };

  // 只有 admin 或该申请所属项目的项目管理员才能审批（且不能审批自己提交的）
  const canReview = selected
    ? (isAdmin || myPermissions.some(p => p.project_name === selected.project_name && p.project_role === '项目管理员'))
      && selected.requester_username !== user?.username
    : false;

  const payload = selected ? (() => {
    try { return JSON.parse(selected.payload); } catch { return {}; }
  })() : {};

  const tabCls = (t: string) => t === activeTab
    ? 'border-b-2 border-black dark:border-white text-black dark:text-white px-4 py-2 text-sm font-medium'
    : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70 px-4 py-2 text-sm font-medium cursor-pointer';

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-6 py-4">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-white/10 mb-4">
          <span className={tabCls('pending')} onClick={() => setActiveTab('pending')}>待审批</span>
          <span className={tabCls('all')} onClick={() => setActiveTab('all')}>全部记录</span>
          <span className={tabCls('my')} onClick={() => setActiveTab('my')}>我的申请</span>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-gray-400 dark:text-white/40 text-sm">加载中...</p>
        ) : rows.length === 0 ? (
          <p className="text-gray-400 dark:text-white/40 text-sm">暂无记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-neutral-800 border-b dark:border-white/10">
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-white/60">项目</th>
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-white/60">操作类型</th>
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-white/60">申请人</th>
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-white/60">申请时间</th>
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-white/60">状态</th>
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-white/60">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const st = STATUS_LABELS[r.status] || { text: r.status, cls: 'bg-gray-100 text-gray-700' };
                  return (
                    <tr key={r.id} className="border-b dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/[0.04]">
                      <td className="px-4 py-2">{r.project_name}</td>
                      <td className="px-4 py-2">{ACTION_LABELS[r.action_type] || r.action_type}</td>
                      <td className="px-4 py-2">{r.requester_username}</td>
                      <td className="px-4 py-2">{parseUtcDate(r.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${st.cls}`}>{st.text}</span>
                      </td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => { setSelected(r); setShowRejectInput(false); setRejectReason(''); }}
                          className="text-black dark:text-white hover:text-black/60 dark:hover:text-white/60 text-xs"
                        >
                          查看详情
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-white/10 w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center px-6 py-4 border-b dark:border-white/10">
              <div>
                <h2 className="text-lg font-bold">
                  {ACTION_LABELS[selected.action_type] || selected.action_type} 审批详情
                </h2>
                <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">
                  申请人：{selected.requester_username} · 项目：{selected.project_name} · {parseUtcDate(selected.created_at).toLocaleString()}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/60 text-xl">✕</button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {/* Payload */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-white/70 mb-2">提交内容</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm bg-gray-50 dark:bg-neutral-800 rounded p-3">
                  {Object.entries(payload).map(([k, v]) => (
                    <div key={k} className="flex gap-1">
                      <span className="text-gray-500 dark:text-white/50 shrink-0">{k}：</span>
                      <span className="text-gray-800 dark:text-white break-all">{String(v) || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Status info */}
              {selected.status !== 'pending' && (
                <div className="text-sm">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABELS[selected.status]?.cls}`}>
                    {STATUS_LABELS[selected.status]?.text}
                  </span>
                  {selected.reviewed_by_username && (
                    <span className="ml-2 text-gray-500 dark:text-white/50">
                      由 {selected.reviewed_by_username} 于 {parseUtcDate(selected.reviewed_at!).toLocaleString()} 处理
                    </span>
                  )}
                  {selected.rejection_reason && (
                    <p className="mt-1 text-red-600">拒绝原因：{selected.rejection_reason}</p>
                  )}
                </div>
              )}

              {/* Reject input */}
              {showRejectInput && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-1">拒绝原因</label>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 dark:border-white/20 rounded px-3 py-2 text-sm dark:bg-neutral-800 dark:text-white"
                    placeholder="请填写拒绝原因..."
                  />
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t dark:border-white/10 flex justify-end gap-3">
              {selected.status === 'pending' && canReview && (
                <>
                  {showRejectInput ? (
                    <>
                      <button
                        onClick={() => { setShowRejectInput(false); setRejectReason(''); }}
                        className="px-4 py-2 border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04] text-sm dark:text-white"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => handleReject(selected.id)}
                        disabled={submitting}
                        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm disabled:opacity-50"
                      >
                        确认拒绝
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowRejectInput(true)}
                        className="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 text-sm"
                      >
                        拒绝
                      </button>
                      <button
                        onClick={() => handleApprove(selected.id)}
                        disabled={submitting}
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
                      >
                        审批通过
                      </button>
                    </>
                  )}
                </>
              )}
              <button
                onClick={() => setSelected(null)}
                className="px-4 py-2 border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04] text-sm dark:text-white"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
