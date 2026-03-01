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

export default function HistoryModal({ entityTable, entityId, entityLabel, onClose }: HistoryModalProps) {
  const [logs, setLogs] = useState<ChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`/api/change-logs?entity_table=${entityTable}&entity_id=${entityId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : { logs: [] })
      .then(data => setLogs(data.logs || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [entityTable, entityId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">{entityLabel} 的修改历史</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-8">加载中...</div>
          ) : logs.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-8">暂无修改记录</div>
          ) : (
            <div className="space-y-4">
              {logs.map(log => (
                <div key={log.id} className="border border-gray-200 rounded-lg p-4">
                  {/* Entry header */}
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
                  {/* Diff content */}
                  <DiffView oldStr={log.old_values} newStr={log.new_values} />
                </div>
              ))}
            </div>
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
