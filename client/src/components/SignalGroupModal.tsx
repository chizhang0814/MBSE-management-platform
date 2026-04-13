import { useState, useEffect } from 'react';
import SignalGroupDiagram from './SignalGroupDiagram';

interface SignalGroupModalProps {
  groupName?: string;
  singleSignalId?: number;
  projectId: number;
  highlightSignalId?: number;
  onClose: () => void;
}

export default function SignalGroupModal({ groupName, singleSignalId, projectId, highlightSignalId, onClose }: SignalGroupModalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<number | null>(null);

  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const isUngrouped = !groupName && !!singleSignalId;

  useEffect(() => {
    const url = isUngrouped
      ? `/api/eicd/single-signal/${singleSignalId}?project_id=${projectId}`
      : `/api/eicd/signal-group/${encodeURIComponent(groupName!)}?project_id=${projectId}`;
    fetch(url, { headers })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [groupName, singleSignalId, projectId]);

  const selectedSig = data?.signals?.find((s: any) => s.id === selectedSignal);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-white/10
                      w-[1500px] max-w-[92vw] h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-white/10 shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {isUngrouped ? `信号连接图 — ${data?.groupName || ''}` : `信号协议组 — ${groupName}`}
            {isUngrouped && <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">（未分组信号）</span>}
          </h3>
          <button onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-white/80 text-lg leading-none">
            ✕
          </button>
        </div>

        {/* Body: split view */}
        <div className="flex-1 overflow-hidden flex min-h-0">
          {/* Left: diagram */}
          <div className="flex-1 overflow-hidden min-w-0">
            {loading && (
              <div className="flex items-center justify-center h-64 text-gray-400">加载中...</div>
            )}
            {error && (
              <div className="flex items-center justify-center h-64 text-red-500">加载失败: {error}</div>
            )}
            {data && (
              <SignalGroupDiagram
                groupName={data.groupName}
                signals={data.signals}
                devices={data.devices}
                highlightSignalId={highlightSignalId}
              />
            )}
          </div>

          {/* Right: signal list panel */}
          <div className="w-80 border-l border-gray-200 dark:border-white/10 overflow-y-auto shrink-0">
            {!data && !loading && (
              <div className="flex items-center justify-center h-full text-gray-400 dark:text-white/40 text-xs">
                无数据
              </div>
            )}
            {data && (
              <div className="p-3">
                <h4 className="text-xs font-semibold text-gray-900 dark:text-white mb-3 pb-2 border-b border-gray-100 dark:border-white/10">
                  信号列表 ({data.signals?.length || 0})
                </h4>
                <div className="space-y-1.5">
                  {data.signals?.map((sig: any) => (
                    <div key={sig.id}
                      className={`p-2 rounded text-xs cursor-pointer border transition-colors ${
                        selectedSignal === sig.id
                          ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600'
                          : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/5'
                      }`}
                      onClick={() => setSelectedSignal(selectedSignal === sig.id ? null : sig.id)}>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-0.5 rounded" style={{ backgroundColor: getSignalColor(sig.id, data.signals) }} />
                        <span className="font-mono font-medium text-gray-900 dark:text-white">{sig.unique_id}</span>
                        <StatusBadge status={sig.status} />
                      </div>
                      {sig.信号名称摘要 && (
                        <div className="mt-1 text-gray-500 dark:text-white/40 truncate">{sig.信号名称摘要}</div>
                      )}
                      {sig.连接类型 && (
                        <div className="mt-0.5 text-gray-400 dark:text-white/30">{sig.连接类型}</div>
                      )}
                      <div className="mt-0.5 text-gray-400 dark:text-white/30">{sig.endpoints?.length || 0} 个端点</div>
                    </div>
                  ))}
                </div>

                {/* Detail for selected signal */}
                {selectedSig && (
                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/10">
                    <h4 className="text-xs font-semibold text-gray-900 dark:text-white mb-2">端点详情</h4>
                    {selectedSig.endpoints?.map((ep: any, i: number) => (
                      <div key={ep.endpointId} className="mb-2 pl-3 border-l-2 border-blue-200 dark:border-blue-800">
                        <div className="text-xs font-medium text-gray-800 dark:text-white/80">
                          端点 {i + 1}: {ep.设备编号}
                        </div>
                        {ep.设备端元器件编号 && (
                          <div className="text-[11px] text-gray-500 dark:text-white/40">连接器: {ep.设备端元器件编号}</div>
                        )}
                        {ep.针孔号 && (
                          <div className="text-[11px] text-gray-500 dark:text-white/40">针孔号: {ep.针孔号}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Color palette matching SignalGroupDiagram ── */

const SIGNAL_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
  '#E11D48', '#84CC16', '#7C3AED', '#0EA5E9', '#D946EF',
];

function getSignalColor(signalId: number, signals: any[]): string {
  const idx = signals.findIndex((s: any) => s.id === signalId);
  return SIGNAL_COLORS[idx >= 0 ? idx % SIGNAL_COLORS.length : 0];
}

function StatusBadge({ status }: { status: string }) {
  const isOk = ['normal', 'Active', 'approved'].includes(status);
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded ${
      isOk
        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
        : status === 'Pending'
          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
          : status === 'Draft'
            ? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/50'
            : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/50'
    }`}>
      {isOk ? '已生效' : status === 'Pending' ? '审批中' : status === 'Draft' ? '草稿' : status}
    </span>
  );
}
