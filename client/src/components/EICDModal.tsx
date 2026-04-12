import { useState, useEffect } from 'react';
import EICDDiagram from './EICDDiagram';

interface EICDModalProps {
  deviceId: number;
  projectId: number;
  deviceLabel: string;
  onClose: () => void;
}

export default function EICDModal({ deviceId, projectId, deviceLabel, onClose }: EICDModalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`/api/eicd/${deviceId}?project_id=${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [deviceId, projectId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-white/10 w-full max-w-[90vw] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-white/10">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            EICD — {deviceLabel}
          </h3>
          <button onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-white/80 text-lg leading-none">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
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
            />
          )}
        </div>
      </div>
    </div>
  );
}
