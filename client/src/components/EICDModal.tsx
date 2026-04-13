import { useState, useEffect } from 'react';
import EICDDiagram, { Selection } from './EICDDiagram';

interface EICDModalProps {
  deviceId: number;
  projectId: number;
  deviceLabel: string;
  onClose: () => void;
  onNavigate?: (sel: NonNullable<Selection>) => void;
}

/* Fields to hide in detail panel (internal/system fields) */
const HIDDEN_KEYS = new Set([
  'id', 'project_id', 'device_id', 'connector_id', 'created_at', 'updated_at',
  'import_conflicts', 'validation_errors', 'import_status', 'version',
  'created_by', 'connectors', 'endpoints', 'edges', 'pending_item_type',
  'has_pending_sub', 'pin_count', '导入来源',
]);

const TYPE_LABEL: Record<string, string> = {
  device: '设备', connector: '连接器', pin: '针孔', signal: '信号',
};

export default function EICDModal({ deviceId, projectId, deviceLabel, onClose, onNavigate }: EICDModalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [detail, setDetail] = useState<{ type: string; data: any } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  /* ── Fetch EICD diagram data ── */
  useEffect(() => {
    fetch(`/api/eicd/${deviceId}?project_id=${projectId}`, { headers })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [deviceId, projectId]);

  /* ── Fetch detail when selection changes ── */
  useEffect(() => {
    if (!selection) { setDetail(null); return; }
    setDetailLoading(true);
    setDetail(null);
    let cancelled = false;

    (async () => {
      try {
        if (selection.type === 'device') {
          const res = await fetch(`/api/devices/${selection.deviceId}`, { headers });
          if (!cancelled && res.ok) {
            const json = await res.json();
            setDetail({ type: 'device', data: json.device });
          }
        } else if (selection.type === 'connector') {
          const res = await fetch(`/api/devices/${selection.deviceId}/connectors`, { headers });
          if (!cancelled && res.ok) {
            const json = await res.json();
            const conn = json.connectors?.find((c: any) => c.id === selection.connectorId);
            setDetail({ type: 'connector', data: conn || null });
          }
        } else if (selection.type === 'pin') {
          const res = await fetch(`/api/devices/${selection.deviceId}/connectors/${selection.connectorId}/pins`, { headers });
          if (!cancelled && res.ok) {
            const json = await res.json();
            const pin = json.pins?.find((p: any) => p.id === selection.pinId);
            setDetail({ type: 'pin', data: pin || null });
          }
        } else if (selection.type === 'signal') {
          const res = await fetch(`/api/signals/${selection.signalId}`, { headers });
          if (!cancelled && res.ok) {
            const json = await res.json();
            setDetail({ type: 'signal', data: json.signal });
          }
        }
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selection]);

  /* ── Double-click handler: confirm then navigate ── */
  const handleDblClick = (sel: NonNullable<Selection>) => {
    const label = TYPE_LABEL[sel.type] || sel.type;
    if (window.confirm(`是否跳转到该${label}？`)) {
      onNavigate?.(sel);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-white/10
                      w-[1500px] max-w-[92vw] h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-white/10 shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            EICD — {deviceLabel}
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
              <EICDDiagram
                mainDevice={data.mainDevice}
                remoteDevices={data.remoteDevices}
                connections={data.connections}
                signalGroups={data.signalGroups}
                selection={selection}
                onSelect={setSelection}
                onDblClick={onNavigate ? handleDblClick : undefined}
              />
            )}
          </div>

          {/* Right: detail panel */}
          <div className="w-80 border-l border-gray-200 dark:border-white/10 overflow-y-auto shrink-0">
            {!selection && (
              <div className="flex items-center justify-center h-full text-gray-400 dark:text-white/40 text-xs text-center px-6 leading-relaxed">
                点击图中的设备、连接器、针孔<br/>或信号线查看详细信息
              </div>
            )}
            {selection && detailLoading && (
              <div className="flex items-center justify-center h-32 text-gray-400 text-xs">加载中...</div>
            )}
            {selection && !detailLoading && !detail?.data && (
              <div className="flex items-center justify-center h-32 text-gray-400 text-xs">无详细信息</div>
            )}
            {selection && !detailLoading && detail?.data && (
              <DetailPanel type={detail.type} data={detail.data} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Detail panel: show ALL fields from the API response ── */

function DetailPanel({ type, data }: { type: string; data: any }) {
  const title = type === 'device' ? '设备详情'
    : type === 'connector' ? '连接器详情'
    : type === 'pin' ? '针孔详情'
    : '信号详情';

  const fields: [string, string][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (HIDDEN_KEYS.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'object') continue;
    fields.push([key, String(value)]);
  }

  return (
    <div className="p-4">
      <h4 className="text-xs font-semibold text-gray-900 dark:text-white mb-3 pb-2 border-b border-gray-100 dark:border-white/10">
        {title}
      </h4>

      <div className="space-y-2">
        {fields.map(([key, value]) => (
          <div key={key} className="text-xs">
            <div className="text-gray-500 dark:text-white/40 mb-0.5">{key}</div>
            <div className="text-gray-900 dark:text-white break-all">
              {key === 'status' || key === 'Status' ? <StatusBadge status={value} /> : value}
            </div>
          </div>
        ))}
      </div>

      {/* Signal endpoints */}
      {type === 'signal' && data.endpoints?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/10">
          <div className="text-xs font-semibold text-gray-700 dark:text-white/60 mb-2">端点信息</div>
          {data.endpoints.map((ep: any, i: number) => (
            <div key={i} className="mb-3 pl-3 border-l-2 border-blue-200 dark:border-blue-800">
              <div className="text-xs font-medium text-gray-800 dark:text-white/80">
                端点 {i + 1}: {ep.设备编号}{ep.设备中文名称 ? ` (${ep.设备中文名称})` : ''}
              </div>
              {ep.设备端元器件编号 && (
                <div className="text-[11px] text-gray-500 dark:text-white/40">连接器: {ep.设备端元器件编号}</div>
              )}
              {ep.针孔号 && (
                <div className="text-[11px] text-gray-500 dark:text-white/40">针孔号: {ep.针孔号}</div>
              )}
              {ep.设备负责人 && (
                <div className="text-[11px] text-gray-500 dark:text-white/40">负责人: {ep.设备负责人}</div>
              )}
              {ep.设备等级 && (
                <div className="text-[11px] text-gray-500 dark:text-white/40">设备等级: {ep.设备等级}</div>
              )}
              {ep.pin_端接尺寸 && (
                <div className="text-[11px] text-gray-500 dark:text-white/40">端接尺寸: {ep.pin_端接尺寸}</div>
              )}
              {ep.pin_屏蔽类型 && (
                <div className="text-[11px] text-gray-500 dark:text-white/40">屏蔽类型: {ep.pin_屏蔽类型}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Signal edges */}
      {type === 'signal' && data.edges?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/10">
          <div className="text-xs font-semibold text-gray-700 dark:text-white/60 mb-2">导线段</div>
          {data.edges.map((edge: any, i: number) => {
            const edgeFields = Object.entries(edge).filter(
              ([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== '' && typeof v !== 'object' && k !== 'signal_id'
            );
            return (
              <div key={i} className="mb-2 pl-3 border-l-2 border-green-200 dark:border-green-800">
                {edgeFields.map(([k, v]) => (
                  <div key={k} className="text-[11px] text-gray-600 dark:text-white/50">
                    <span className="text-gray-400 dark:text-white/30">{k}: </span>{String(v)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Device connectors summary */}
      {type === 'device' && data.connectors?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/10">
          <div className="text-xs font-semibold text-gray-700 dark:text-white/60 mb-2">
            连接器 ({data.connectors.length})
          </div>
          {data.connectors.map((c: any) => (
            <div key={c.id} className="text-[11px] text-gray-600 dark:text-white/50 mb-1">
              {c.设备端元器件编号}
              {c.pin_count != null && <span className="text-gray-400 dark:text-white/30"> ({c.pin_count}针)</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isOk = ['normal', 'Active', 'approved'].includes(status);
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded ${
      isOk
        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
        : status === 'Pending'
          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
          : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/50'
    }`}>
      {status}
    </span>
  );
}
