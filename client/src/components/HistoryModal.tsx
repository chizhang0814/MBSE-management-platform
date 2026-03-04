import { useState, useEffect } from 'react';

interface HistoryModalProps {
  entityTable: string;
  entityId: number;
  entityLabel: string;
  onClose: () => void;
}

interface ChangeLogEntry {
  id: number;
  entity_table: string;
  entity_id: number;
  changed_by: number;
  changed_by_name: string;
  changed_by_display: string | null;
  old_values: string | null;
  new_values: string | null;
  reason: string;
  status: string;
  created_at: string;
}

interface ApprovalItem {
  id: number;
  recipient_username: string;
  recipient_display_name: string | null;
  item_type: string;
  status: string;
  rejection_reason: string | null;
  responded_at: string | null;
}

interface ApprovalRequest {
  id: number;
  action_type: string;
  status: string;
  current_phase: string;
  requester_username: string;
  requester_display_name: string | null;
  rejected_by_username: string | null;
  created_at: string;
  items: ApprovalItem[];
}

const HIDDEN_FIELDS = new Set([
  'id', 'project_id', 'device_id', 'connector_id', 'sc_connector_id',
  'section_connector_id', 'created_at', 'updated_at', 'version',
  'import_conflicts', 'validation_errors',
]);

function parseUtcDate(s: string): Date {
  return new Date(s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z');
}

function safeParseJSON(s: string | null): Record<string, any> | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function DiffView({ oldStr, newStr }: { oldStr: string | null; newStr: string | null }) {
  const oldObj = safeParseJSON(oldStr);
  const newObj = safeParseJSON(newStr);

  // 新增：显示所有新字段
  if (!oldObj && newObj) {
    const entries = Object.entries(newObj).filter(([k]) => !HIDDEN_FIELDS.has(k) && newObj[k] != null && newObj[k] !== '');
    if (entries.length === 0) return <div className="text-xs text-gray-400">无详细信息</div>;
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <span className="text-gray-500 shrink-0">{k}:</span>
            <span className="text-green-700 break-all">{String(v)}</span>
          </div>
        ))}
      </div>
    );
  }

  // 删除：显示删除前快照
  if (oldObj && !newObj) {
    const entries = Object.entries(oldObj).filter(([k]) => !HIDDEN_FIELDS.has(k) && oldObj[k] != null && oldObj[k] !== '');
    return (
      <div>
        <div className="text-xs text-red-600 font-medium mb-1">记录已删除</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <span className="text-gray-500 shrink-0">{k}:</span>
              <span className="text-red-500 break-all">{String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 修改：只显示变更的字段
  if (oldObj && newObj) {
    const changedKeys = Object.keys(newObj).filter(k =>
      !HIDDEN_FIELDS.has(k) && String(newObj[k] ?? '') !== String(oldObj[k] ?? '')
    );
    if (changedKeys.length === 0) return <div className="text-xs text-gray-400">无字段变更</div>;
    return (
      <div className="space-y-1 text-xs">
        {changedKeys.map(k => (
          <div key={k}>
            <span className="text-gray-600 font-medium">{k}: </span>
            <span className="text-red-500 line-through">{String(oldObj[k] ?? '(空)')}</span>
            {' → '}
            <span className="text-green-700">{String(newObj[k] ?? '(空)')}</span>
          </div>
        ))}
      </div>
    );
  }

  return <div className="text-xs text-gray-400">无详细信息</div>;
}

const REASON_COLORS: Record<string, string> = {
  '新增': 'bg-green-100 text-green-800',
  '修改': 'bg-blue-100 text-blue-800',
  '删除': 'bg-red-100 text-red-800',
  '审批通过': 'bg-purple-100 text-purple-800',
};

function reasonBadgeClass(reason: string): string {
  for (const [key, cls] of Object.entries(REASON_COLORS)) {
    if (reason.includes(key)) return cls;
  }
  return 'bg-gray-100 text-gray-700';
}

// entityTable → entity_type 映射
const TABLE_TO_ENTITY_TYPE: Record<string, string> = {
  devices: 'device', connectors: 'connector', pins: 'pin', signals: 'signal',
};

const ACTION_LABELS: Record<string, string> = {
  create_device: '新建设备', edit_device: '修改设备', delete_device: '删除设备',
  create_connector: '新建连接器', edit_connector: '修改连接器', delete_connector: '删除连接器',
  create_pin: '新建针孔', edit_pin: '修改针孔', delete_pin: '删除针孔',
  create_signal: '新建信号', edit_signal: '修改信号', delete_signal: '删除信号',
};

export default function HistoryModal({ entityTable, entityId, entityLabel, onClose }: HistoryModalProps) {
  const [logs, setLogs] = useState<ChangeLogEntry[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'changes' | 'approvals'>('changes');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    const loadLogs = fetch(`/api/change-logs?entity_table=${entityTable}&entity_id=${entityId}`, { headers })
      .then(r => r.ok ? r.json() : { logs: [] })
      .then(data => setLogs(data.logs || []))
      .catch(() => setLogs([]));

    const entityType = TABLE_TO_ENTITY_TYPE[entityTable];
    const loadApprovals = entityType
      ? fetch(`/api/approvals/history?entity_type=${entityType}&entity_id=${entityId}`, { headers })
          .then(r => r.ok ? r.json() : { requests: [] })
          .then(data => setApprovalHistory(data.requests || []))
          .catch(() => setApprovalHistory([]))
      : Promise.resolve();

    Promise.all([loadLogs, loadApprovals]).finally(() => setLoading(false));
  }, [entityTable, entityId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">{entityLabel} 的修改历史</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b px-6">
          <button
            onClick={() => setTab('changes')}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === 'changes' ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            变更记录 ({logs.length})
          </button>
          {TABLE_TO_ENTITY_TYPE[entityTable] && (
            <button
              onClick={() => setTab('approvals')}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === 'approvals' ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              审批流程 ({approvalHistory.length})
            </button>
          )}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-8">加载中...</div>
          ) : tab === 'changes' ? (
            logs.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8">暂无修改记录</div>
            ) : (
              <div className="space-y-4">
                {logs.map(log => (
                  <div key={log.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${reasonBadgeClass(log.reason)}`}>
                        {log.reason}
                      </span>
                      <span className="text-xs text-gray-600">
                        {log.changed_by_display || log.changed_by_name || `用户#${log.changed_by}`}
                      </span>
                      <span className="text-xs text-gray-400">
                        {parseUtcDate(log.created_at).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <DiffView oldStr={log.old_values} newStr={log.new_values} />
                  </div>
                ))}
              </div>
            )
          ) : (
            approvalHistory.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8">暂无审批记录</div>
            ) : (
              <div className="space-y-4">
                {approvalHistory.map(req => {
                  const statusColor = req.status === 'approved' ? 'bg-green-100 text-green-800'
                    : req.status === 'rejected' ? 'bg-red-100 text-red-800'
                    : 'bg-yellow-100 text-yellow-800';
                  const statusLabel = req.status === 'approved' ? '已通过'
                    : req.status === 'rejected' ? '已拒绝'
                    : '审批中';
                  return (
                    <div key={req.id} className="border border-gray-200 rounded-lg p-4">
                      {/* 审批请求头 */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${statusColor}`}>{statusLabel}</span>
                        <span className="text-xs font-medium text-gray-800">{ACTION_LABELS[req.action_type] || req.action_type}</span>
                        <span className="text-xs text-gray-500">提交人: {req.requester_display_name || req.requester_username}</span>
                        <span className="text-xs text-gray-400">{parseUtcDate(req.created_at).toLocaleString('zh-CN')}</span>
                      </div>
                      {/* 审批明细 */}
                      <div className="space-y-1.5">
                        {req.items.map(item => {
                          const icon = item.status === 'done' && !item.rejection_reason ? '✅'
                            : item.status === 'done' && item.rejection_reason ? '❌'
                            : item.status === 'cancelled' ? '⊘'
                            : '⏳';
                          const typeLabel = item.item_type === 'completion' ? '完善' : '审批';
                          const statusText = item.status === 'done' && !item.rejection_reason
                            ? `已${typeLabel === '完善' ? '完善' : '通过'}`
                            : item.status === 'done' && item.rejection_reason
                            ? `已拒绝`
                            : item.status === 'cancelled' ? '已取消' : `待${typeLabel}`;
                          return (
                            <div key={item.id} className="flex items-start gap-2 text-xs">
                              <span className="mt-0.5">{icon}</span>
                              <div>
                                <span className="font-medium">{item.recipient_display_name || item.recipient_username}</span>
                                <span className={`ml-1.5 px-1.5 py-0.5 rounded text-xs ${item.item_type === 'completion' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                                  {typeLabel}
                                </span>
                                <span className="ml-1.5 text-gray-600">{statusText}</span>
                                {item.responded_at && (
                                  <span className="ml-1.5 text-gray-400">{parseUtcDate(item.responded_at).toLocaleString('zh-CN')}</span>
                                )}
                                {item.rejection_reason && (
                                  <div className="mt-0.5 text-red-600">理由: {item.rejection_reason}</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-sm"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
