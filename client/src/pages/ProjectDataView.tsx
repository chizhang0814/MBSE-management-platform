import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

// ── 类型定义 ─────────────────────────────────────────────

interface Project { id: number; name: string; description?: string; }

interface DeviceRow {
  id: number; project_id: number;
  设备编号: string; 设备中文名称?: string; 设备英文名称?: string; 设备英文缩写?: string;
  设备件号?: string; 设备供应商名称?: string; 设备所属ATA?: string;
  设备安装位置?: string; 设备DAL?: string;
  壳体是否金属?: string; 金属壳体表面处理?: string; 设备内共地情况?: string;
  壳体接地需求?: string; 壳体接地是否故障电流路径?: string; 其他接地特殊要求?: string;
  设备端连接器数量?: string; 是否选装设备?: string; 设备装机架次?: string;
  设备负责人?: string; 额定电压?: string; 额定电流?: string; 备注?: string;
  connector_count?: number;
}

interface ConnectorRow {
  id: number; device_id: number;
  连接器号: string; 设备端元器件编号?: string; 元器件名称及类型?: string;
  元器件件号及类型?: string; 元器件供应商名称?: string;
  匹配线束端元器件件号?: string; 匹配线束线型?: string;
  是否随设备交付?: string; 备注?: string;
  pin_count?: number;
}

interface PinRow {
  id: number; connector_id: number;
  针孔号: string; 端接尺寸?: string; 屏蔽类型?: string; 备注?: string;
}

interface SignalRow {
  id: number; project_id: number;
  created_by?: string;
  unique_id?: string; 信号名称摘要?: string; 连接类型?: string; 信号方向?: string;
  信号架次有效性?: string;
  推荐导线线规?: string; 推荐导线线型?: string;
  独立电源代码?: string; 敷设代码?: string; 电磁兼容代码?: string;
  余度代码?: string; 功能代码?: string; 接地代码?: string; 极性?: string;
  额定电压?: string; 额定电流?: string; 设备正常工作电压范围?: string;
  是否成品线?: string; 成品线件号?: string; 成品线线规?: string; 成品线类型?: string;
  成品线长度?: string; 成品线载流量?: string; 成品线线路压降?: string; 成品线标识?: string;
  成品线与机上线束对接方式?: string; 成品线安装责任?: string; 备注?: string;
  endpoint_summary?: string;
  can_edit?: boolean;
}

interface SignalEndpoint {
  id?: number; signal_id?: number; endpoint_index?: number;
  device_id?: number; connector_id?: number;
  设备编号: string; 连接器号: string; 针孔号: string;
  信号方向?: string; 屏蔽类型?: string; 端接尺寸?: string; 信号名称?: string; 信号定义?: string;
  设备端元器件编号?: string; 设备中文名称?: string;
}

interface SignalDetail extends SignalRow {
  endpoints: SignalEndpoint[];
}

// ── 辅助：检查对象中是否有"待办"或"补充"值 ──────────────
const hasTodo = (obj: Record<string, any>) =>
  Object.values(obj).some(v => v === '待办' || v === '补充');

// ── 常量 ─────────────────────────────────────────────────

const API_HEADERS = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const API_JSON_HEADERS = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const DEVICE_FIELDS: { key: keyof DeviceRow; label: string }[] = [
  { key: '设备编号', label: '设备编号' },
  { key: '设备中文名称', label: '设备中文名称' },
  { key: '设备英文名称', label: '设备英文名称' },
  { key: '设备英文缩写', label: '设备英文缩写' },
  { key: '设备件号', label: '设备件号' },
  { key: '设备供应商名称', label: '设备供应商名称' },
  { key: '设备所属ATA', label: '设备所属ATA' },
  { key: '设备安装位置', label: '设备安装位置' },
  { key: '设备DAL', label: '设备DAL' },
  { key: '壳体是否金属', label: '壳体是否金属' },
  { key: '金属壳体表面处理', label: '金属壳体表面处理' },
  { key: '设备内共地情况', label: '设备内共地情况' },
  { key: '壳体接地需求', label: '壳体接地需求' },
  { key: '壳体接地是否故障电流路径', label: '壳体接地是否故障电流路径' },
  { key: '其他接地特殊要求', label: '其他接地特殊要求' },
  { key: '设备端连接器数量', label: '设备端连接器数量' },
  { key: '是否选装设备', label: '是否选装设备' },
  { key: '设备装机架次', label: '设备装机架次' },
  { key: '设备负责人', label: '设备负责人' },
  { key: '额定电压', label: '额定电压' },
  { key: '额定电流', label: '额定电流' },
  { key: '备注', label: '备注' },
];

const SIGNAL_FIELDS: { key: keyof SignalRow; label: string }[] = [
  { key: 'unique_id', label: 'Unique ID' },
  { key: '连接类型', label: '连接类型' },
  { key: '信号方向', label: '信号方向' },
  { key: '信号架次有效性', label: '信号架次有效性' },
  { key: '推荐导线线规', label: '推荐导线线规' },
  { key: '推荐导线线型', label: '推荐导线线型' },
  { key: '独立电源代码', label: '独立电源代码' },
  { key: '敷设代码', label: '敷设代码' },
  { key: '电磁兼容代码', label: '电磁兼容代码' },
  { key: '余度代码', label: '余度代码' },
  { key: '功能代码', label: '功能代码' },
  { key: '接地代码', label: '接地代码' },
  { key: '极性', label: '极性' },
  { key: '额定电压', label: '额定电压' },
  { key: '额定电流', label: '额定电流' },
  { key: '设备正常工作电压范围', label: '设备正常工作电压范围' },
  { key: '是否成品线', label: '是否成品线' },
  { key: '成品线件号', label: '成品线件号' },
  { key: '成品线线规', label: '成品线线规' },
  { key: '成品线类型', label: '成品线类型' },
  { key: '成品线长度', label: '成品线长度' },
  { key: '成品线载流量', label: '成品线载流量' },
  { key: '成品线线路压降', label: '成品线线路压降' },
  { key: '成品线标识', label: '成品线标识' },
  { key: '成品线与机上线束对接方式', label: '成品线与机上线束对接方式' },
  { key: '成品线安装责任', label: '成品线安装责任' },
  { key: '备注', label: '备注' },
];

// ── 主组件 ────────────────────────────────────────────────

export default function ProjectDataView() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  // ── 项目选择 ──
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // ── 视图切换 ──
  const [activeView, setActiveView] = useState<'devices' | 'signals'>('devices');
  const [filterMode, setFilterMode] = useState<'all' | 'my'>('all');

  // ── 设备视图状态 ──
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [expandedDeviceId, setExpandedDeviceId] = useState<number | null>(null);
  const [connectors, setConnectors] = useState<Record<number, ConnectorRow[]>>({});
  const [expandedConnectorId, setExpandedConnectorId] = useState<number | null>(null);
  const [pins, setPins] = useState<Record<number, PinRow[]>>({});

  // ── 信号视图状态 ──
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [expandedSignalId, setExpandedSignalId] = useState<number | null>(null);
  const [signalDetails, setSignalDetails] = useState<Record<number, SignalDetail>>({});

  // ── 通用UI状态 ──
  const [loading, setLoading] = useState(false);
  const [lockMap, setLockMap] = useState<Record<number, { lockedBy: string; expiresAt: string }>>({});
  const [connectorLockMap, setConnectorLockMap] = useState<Record<number, { lockedBy: string; expiresAt: string }>>({});
  const [signalLockMap, setSignalLockMap] = useState<Record<number, { lockedBy: string; expiresAt: string }>>({});
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 设备添加/编辑弹窗 ──
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [editingDevice, setEditingDevice] = useState<DeviceRow | null>(null);
  const [deviceForm, setDeviceForm] = useState<Partial<DeviceRow>>({});

  // ── 连接器添加/编辑弹窗 ──
  const [showConnectorModal, setShowConnectorModal] = useState(false);
  const [connectorTargetDeviceId, setConnectorTargetDeviceId] = useState<number | null>(null);
  const [editingConnector, setEditingConnector] = useState<ConnectorRow | null>(null);
  const [connectorForm, setConnectorForm] = useState<Partial<ConnectorRow>>({});

  // ── 针孔添加/编辑弹窗 ──
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinTargetConnectorId, setPinTargetConnectorId] = useState<number | null>(null);
  const [editingPin, setEditingPin] = useState<PinRow | null>(null);
  const [pinForm, setPinForm] = useState<Partial<PinRow>>({});

  // ── 信号添加/编辑弹窗 ──
  const [showSignalModal, setShowSignalModal] = useState(false);
  const [editingSignal, setEditingSignal] = useState<SignalRow | null>(null);
  const [signalForm, setSignalForm] = useState<Partial<SignalRow>>({});
  const [signalEndpoints, setSignalEndpoints] = useState<SignalEndpoint[]>([
    { 设备编号: '', 连接器号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
    { 设备编号: '', 连接器号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
  ]);
  // 端点搜索
  const [epDeviceSearch, setEpDeviceSearch] = useState<string[]>(['', '']);
  const [epDeviceResults, setEpDeviceResults] = useState<DeviceRow[][]>([[], []]);
  const [epConnectorOptions, setEpConnectorOptions] = useState<ConnectorRow[][]>([[], []]);
  const [epPinOptions, setEpPinOptions] = useState<PinRow[][]>([[], []]);

  // ── 权限状态 ──
  const [myPermissions, setMyPermissions] = useState<Array<{ project_name: string; project_role: string }>>([]);

  // ── 初始化 ────────────────────────────────────────────────

  useEffect(() => {
    loadProjects();
    if (user?.role !== 'admin') {
      fetch('/api/auth/profile', { headers: API_HEADERS() })
        .then(r => r.json())
        .then(d => setMyPermissions(d.user?.permissions || []))
        .catch(() => {});
    }
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (lockRefreshRef.current) clearInterval(lockRefreshRef.current);
    };
  }, []);

  useEffect(() => {
    const pidParam = searchParams.get('projectId');
    if (pidParam) setSelectedProjectId(parseInt(pidParam));
  }, [searchParams]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (activeView === 'devices') loadDevices();
    else loadSignals();
  }, [selectedProjectId, activeView, filterMode]);

  // ── 锁轮询 ────────────────────────────────────────────────

  useEffect(() => {
    if (lockRefreshRef.current) clearInterval(lockRefreshRef.current);
    if (!selectedProjectId) return;
    const fetchLocks = async () => {
      try {
        if (activeView === 'devices') {
          const [devRes, connRes] = await Promise.all([
            fetch(`/api/data/locks?table_name=devices`, { headers: API_HEADERS() }),
            fetch(`/api/data/locks?table_name=connectors`, { headers: API_HEADERS() }),
          ]);
          if (devRes.ok) { const d = await devRes.json(); setLockMap(d.locks || {}); }
          if (connRes.ok) { const d = await connRes.json(); setConnectorLockMap(d.locks || {}); }
        } else {
          const res = await fetch(`/api/data/locks?table_name=signals`, { headers: API_HEADERS() });
          if (res.ok) { const d = await res.json(); setSignalLockMap(d.locks || {}); }
        }
      } catch { /* 静默 */ }
    };
    fetchLocks();
    lockRefreshRef.current = setInterval(fetchLocks, 15000);
    return () => { if (lockRefreshRef.current) clearInterval(lockRefreshRef.current); };
  }, [selectedProjectId, activeView]);

  // ── 数据加载 ──────────────────────────────────────────────

  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects', { headers: API_HEADERS() });
      const data = await res.json();
      setProjects(data.projects || []);
      if (!selectedProjectId && data.projects?.length > 0) {
        const pidParam = searchParams.get('projectId');
        setSelectedProjectId(pidParam ? parseInt(pidParam) : data.projects[0].id);
      }
    } catch (e) { console.error('加载项目失败', e); }
  };

  const loadDevices = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const myQ = filterMode === 'my' ? '&myDevices=true' : '';
      const res = await fetch(`/api/devices?projectId=${selectedProjectId}${myQ}`, { headers: API_HEADERS() });
      const data = await res.json();
      setDevices(data.devices || []);
      setExpandedDeviceId(null);
      setConnectors({});
      setExpandedConnectorId(null);
      setPins({});
    } catch (e) { console.error('加载设备失败', e); }
    finally { setLoading(false); }
  };

  const loadSignals = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const myQ = filterMode === 'my' ? '&myDevices=true' : '';
      const res = await fetch(`/api/signals?projectId=${selectedProjectId}${myQ}`, { headers: API_HEADERS() });
      const data = await res.json();
      setSignals(data.signals || []);
      setExpandedSignalId(null);
    } catch (e) { console.error('加载信号失败', e); }
    finally { setLoading(false); }
  };

  const loadConnectors = async (deviceId: number, force = false) => {
    if (!force && connectors[deviceId]) return;
    try {
      const res = await fetch(`/api/devices/${deviceId}/connectors`, { headers: API_HEADERS() });
      const data = await res.json();
      setConnectors(prev => ({ ...prev, [deviceId]: data.connectors || [] }));
    } catch (e) { console.error('加载连接器失败', e); }
  };

  const loadPins = async (deviceId: number, connectorId: number, force = false) => {
    if (!force && pins[connectorId]) return;
    try {
      const res = await fetch(`/api/devices/${deviceId}/connectors/${connectorId}/pins`, { headers: API_HEADERS() });
      const data = await res.json();
      setPins(prev => ({ ...prev, [connectorId]: data.pins || [] }));
    } catch (e) { console.error('加载针孔失败', e); }
  };

  const loadSignalDetail = async (signalId: number) => {
    if (signalDetails[signalId]) return;
    try {
      const res = await fetch(`/api/signals/${signalId}`, { headers: API_HEADERS() });
      const data = await res.json();
      setSignalDetails(prev => ({ ...prev, [signalId]: data.signal }));
    } catch (e) { console.error('加载信号详情失败', e); }
  };

  // ── 设备CRUD ──────────────────────────────────────────────

  const openAddDevice = () => {
    setEditingDevice(null);
    setDeviceForm({ '设备负责人': user?.username || '' });
    setShowDeviceModal(true);
  };

  const openEditDevice = async (device: DeviceRow) => {
    // 获取锁
    try {
      const res = await fetch('/api/data/lock', {
        method: 'POST',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'devices', row_id: device.id })
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || '获取锁失败'); return; }
    } catch { alert('获取锁失败'); return; }

    setEditingDevice(device);
    setDeviceForm({ ...device });
    setShowDeviceModal(true);

    // 心跳
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      fetch('/api/data/lock', {
        method: 'PUT',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'devices', row_id: device.id })
      }).catch(() => {});
    }, 120000);
  };

  const closeDeviceModal = async () => {
    if (editingDevice) {
      await fetch('/api/data/lock', {
        method: 'DELETE',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'devices', row_id: editingDevice.id })
      }).catch(() => {});
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    }
    setShowDeviceModal(false);
    setEditingDevice(null);
    setDeviceForm({});
  };

  const saveDevice = async () => {
    if (!selectedProjectId || !deviceForm['设备编号']) { alert('设备编号不能为空'); return; }
    const ata = (deviceForm as any)['设备所属ATA'] || '';
    if (!ata) { alert('设备所属ATA 不能为空'); return; }
    if (ata !== '其他' && !/^\d{2}-\d{2}$/.test(ata)) { alert('设备所属ATA 格式不正确，应为 XX-XX（X为0-9数字）或"其他"'); return; }
    try {
      const url = editingDevice ? `/api/devices/${editingDevice.id}` : '/api/devices';
      const method = editingDevice ? 'PUT' : 'POST';
      const body = editingDevice ? deviceForm : { project_id: selectedProjectId, ...deviceForm };
      const res = await fetch(url, { method, headers: API_JSON_HEADERS(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      await closeDeviceModal();
      await loadDevices();
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deleteDevice = async (device: DeviceRow) => {
    if (!confirm(`确定要删除设备 ${device.设备编号} 吗？这将同时删除其所有连接器和针孔。`)) return;
    try {
      const res = await fetch(`/api/devices/${device.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      await loadDevices();
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  // ── 连接器CRUD ────────────────────────────────────────────

  const openAddConnector = (deviceId: number) => {
    setConnectorTargetDeviceId(deviceId);
    setEditingConnector(null);
    setConnectorForm({});
    setShowConnectorModal(true);
  };

  const openEditConnector = async (deviceId: number, conn: ConnectorRow) => {
    try {
      const res = await fetch('/api/data/lock', {
        method: 'POST',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'connectors', row_id: conn.id })
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || '获取锁失败'); return; }
    } catch { alert('获取锁失败'); return; }

    setConnectorTargetDeviceId(deviceId);
    setEditingConnector(conn);
    setConnectorForm({ ...conn });
    setShowConnectorModal(true);

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      fetch('/api/data/lock', {
        method: 'PUT',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'connectors', row_id: conn.id })
      }).catch(() => {});
    }, 120000);
  };

  const closeConnectorModal = async () => {
    if (editingConnector) {
      await fetch('/api/data/lock', {
        method: 'DELETE',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'connectors', row_id: editingConnector.id })
      }).catch(() => {});
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    }
    setShowConnectorModal(false);
    setEditingConnector(null);
    setConnectorForm({});
  };

  const saveConnector = async () => {
    if (!connectorTargetDeviceId || !connectorForm['连接器号']) { alert('连接器号不能为空'); return; }
    if (!(connectorForm as any)['设备端元器件编号']) { alert('设备端元器件编号不能为空'); return; }
    try {
      const url = editingConnector
        ? `/api/devices/${connectorTargetDeviceId}/connectors/${editingConnector.id}`
        : `/api/devices/${connectorTargetDeviceId}/connectors`;
      const method = editingConnector ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: API_JSON_HEADERS(), body: JSON.stringify(connectorForm) });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      if (!editingConnector) {
        setDevices(prev => prev.map(d =>
          d.id === connectorTargetDeviceId ? { ...d, connector_count: (d.connector_count ?? 0) + 1 } : d
        ));
      }
      await loadConnectors(connectorTargetDeviceId!, true);
      await closeConnectorModal();
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deleteConnector = async (deviceId: number, connector: ConnectorRow) => {
    if (!confirm(`确定要删除连接器 ${connector.连接器号} 吗？`)) return;
    try {
      const res = await fetch(`/api/devices/${deviceId}/connectors/${connector.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      setDevices(prev => prev.map(d =>
        d.id === deviceId ? { ...d, connector_count: Math.max(0, (d.connector_count ?? 0) - 1) } : d
      ));
      await loadConnectors(deviceId, true);
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  // ── 针孔CRUD ──────────────────────────────────────────────

  const openAddPin = (deviceId: number, connectorId: number) => {
    setPinTargetConnectorId(connectorId);
    setConnectorTargetDeviceId(deviceId);
    setEditingPin(null);
    setPinForm({});
    setShowPinModal(true);
  };

  const openEditPin = async (deviceId: number, connectorId: number, pin: PinRow) => {
    try {
      const res = await fetch('/api/data/lock', {
        method: 'POST',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'pins', row_id: pin.id })
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || '获取锁失败'); return; }
    } catch { alert('获取锁失败'); return; }

    setPinTargetConnectorId(connectorId);
    setConnectorTargetDeviceId(deviceId);
    setEditingPin(pin);
    setPinForm({ ...pin });
    setShowPinModal(true);

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      fetch('/api/data/lock', {
        method: 'PUT',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'pins', row_id: pin.id })
      }).catch(() => {});
    }, 120000);
  };

  const closePinModal = async () => {
    if (editingPin) {
      await fetch('/api/data/lock', {
        method: 'DELETE',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'pins', row_id: editingPin.id })
      }).catch(() => {});
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    }
    setShowPinModal(false);
    setEditingPin(null);
    setPinForm({});
  };

  const savePin = async () => {
    if (!pinTargetConnectorId || !connectorTargetDeviceId || !pinForm['针孔号']) { alert('针孔号不能为空'); return; }
    try {
      const url = editingPin
        ? `/api/devices/${connectorTargetDeviceId}/connectors/${pinTargetConnectorId}/pins/${editingPin.id}`
        : `/api/devices/${connectorTargetDeviceId}/connectors/${pinTargetConnectorId}/pins`;
      const method = editingPin ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: API_JSON_HEADERS(), body: JSON.stringify(pinForm) });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      await loadPins(connectorTargetDeviceId, pinTargetConnectorId, true);
      await closePinModal();
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deletePin = async (deviceId: number, connectorId: number, pin: PinRow) => {
    if (!confirm(`确定要删除针孔 ${pin.针孔号} 吗？`)) return;
    try {
      const res = await fetch(`/api/devices/${deviceId}/connectors/${connectorId}/pins/${pin.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      await loadPins(deviceId, connectorId, true);
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  // ── 信号CRUD ──────────────────────────────────────────────

  const openAddSignal = () => {
    setEditingSignal(null);
    setSignalForm({});
    setSignalEndpoints([
      { 设备编号: '', 连接器号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
      { 设备编号: '', 连接器号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
    ]);
    setEpDeviceSearch(['', '']);
    setEpDeviceResults([[], []]);
    setEpConnectorOptions([[], []]);
    setEpPinOptions([[], []]);
    setShowSignalModal(true);
  };

  const openEditSignal = async (signal: SignalRow) => {
    try {
      const lockRes = await fetch('/api/data/lock', {
        method: 'POST',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'signals', row_id: signal.id })
      });
      if (!lockRes.ok) { const d = await lockRes.json(); alert(d.error || '获取锁失败'); return; }
    } catch { alert('获取锁失败'); return; }

    // 立即在本地锁状态中添加，无需等待下次轮询
    setSignalLockMap(prev => ({ ...prev, [signal.id]: { lockedBy: user?.username || '', expiresAt: '' } }));

    // 直接从 API 获取最新数据，不依赖可能过时的缓存状态
    let freshSignal: any = { ...signal };
    let freshEndpoints: SignalEndpoint[] = [];
    try {
      const res = await fetch(`/api/signals/${signal.id}`, { headers: API_HEADERS() });
      if (res.ok) {
        const data = await res.json();
        freshSignal = data.signal;
        freshEndpoints = data.signal.endpoints || [];
        setSignalDetails(prev => ({ ...prev, [signal.id]: data.signal }));
      }
    } catch (e) { console.error('加载信号详情失败', e); }

    setEditingSignal(signal);
    setSignalForm({ ...freshSignal });
    const epList: SignalEndpoint[] = freshEndpoints.length > 0
      ? freshEndpoints.map(e => ({
          设备编号: e.设备编号 || '',
          连接器号: e.连接器号 || '',
          针孔号: e.针孔号 || '',

          信号名称: e.信号名称 || '',
          信号定义: e.信号定义 || '',
        }))
      : [{ 设备编号: '', 连接器号: '', 针孔号: '', 信号名称: '', 信号定义: '' }];
    setSignalEndpoints(epList);
    setEpDeviceSearch(epList.map(e => e.设备编号));
    setEpDeviceResults(epList.map(() => []));

    // 预加载每个端点的连接器列表和针孔列表
    const connOpts: ConnectorRow[][] = epList.map(() => []);
    const pinOpts: PinRow[][] = epList.map(() => []);
    await Promise.all(freshEndpoints.map(async (e: any, idx: number) => {
      if (e.device_id) {
        try {
          const cRes = await fetch(`/api/devices/${e.device_id}/connectors`, { headers: API_HEADERS() });
          if (cRes.ok) connOpts[idx] = (await cRes.json()).connectors || [];
        } catch { }
      }
      if (e.device_id && e.connector_id) {
        try {
          const pRes = await fetch(`/api/devices/${e.device_id}/connectors/${e.connector_id}/pins`, { headers: API_HEADERS() });
          if (pRes.ok) pinOpts[idx] = (await pRes.json()).pins || [];
        } catch { }
      }
    }));
    setEpConnectorOptions(connOpts);
    setEpPinOptions(pinOpts);
    setShowSignalModal(true);

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      fetch('/api/data/lock', {
        method: 'PUT',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'signals', row_id: signal.id })
      }).catch(() => {});
    }, 120000);
  };

  const closeSignalModal = async () => {
    if (editingSignal) {
      const releasedId = editingSignal.id;
      await fetch('/api/data/lock', {
        method: 'DELETE',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ table_name: 'signals', row_id: releasedId })
      }).catch(() => {});
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      // 立即从本地锁状态中移除，无需等待下次轮询
      setSignalLockMap(prev => { const next = { ...prev }; delete next[releasedId]; return next; });
    }
    setShowSignalModal(false);
    setEditingSignal(null);
    setSignalForm({});
  };

  const saveSignal = async () => {
    if (!selectedProjectId) return;
    const sf = signalForm as any;
    if (!editingSignal && !sf.unique_id?.trim()) { alert('Unique ID 不能为空'); return; }
    if (!sf['信号方向']) { alert('信号方向不能为空'); return; }
    if (!sf['连接类型']) { alert('连接类型不能为空'); return; }
    try {
      const validEndpoints = signalEndpoints.filter(ep => ep.设备编号 && ep.连接器号 && ep.针孔号);
      const body: any = { project_id: selectedProjectId, ...signalForm, endpoints: validEndpoints };
      const url = editingSignal ? `/api/signals/${editingSignal.id}` : '/api/signals';
      const method = editingSignal ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: API_JSON_HEADERS(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      const result = await res.json();
      if (result.endpointErrors?.length > 0) alert(`信号已保存，但部分端点失败:\n${result.endpointErrors.join('\n')}`);
      const prevEditingSignal = editingSignal;
      await closeSignalModal();
      await loadSignals();
      if (prevEditingSignal) setSignalDetails(prev => { const n = { ...prev }; delete n[prevEditingSignal.id]; return n; });
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deleteSignal = async (signal: SignalRow) => {
    if (!confirm(`确定要删除信号 ${signal.unique_id || signal.id} 吗？`)) return;
    try {
      const res = await fetch(`/api/signals/${signal.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      await loadSignals();
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  // ── 信号端点搜索 ──────────────────────────────────────────

  const searchEpDevice = async (idx: number, query: string) => {
    const newSearch = [...epDeviceSearch];
    newSearch[idx] = query;
    setEpDeviceSearch(newSearch);
    if (!query || !selectedProjectId) { const r = [...epDeviceResults]; r[idx] = []; setEpDeviceResults(r); return; }
    try {
      const res = await fetch(`/api/devices/search?projectId=${selectedProjectId}&q=${encodeURIComponent(query)}`, { headers: API_HEADERS() });
      const data = await res.json();
      const r = [...epDeviceResults]; r[idx] = data.devices || []; setEpDeviceResults(r);
    } catch { }
  };

  const selectEpDevice = async (idx: number, device: DeviceRow) => {
    const newSearch = [...epDeviceSearch]; newSearch[idx] = device.设备编号;
    setEpDeviceSearch(newSearch);
    const newResults = [...epDeviceResults]; newResults[idx] = [];
    setEpDeviceResults(newResults);
    const newEp = [...signalEndpoints];
    newEp[idx] = { ...newEp[idx], 设备编号: device.设备编号, 连接器号: '', 针孔号: '' };
    setSignalEndpoints(newEp);
    // 加载连接器
    try {
      const res = await fetch(`/api/devices/${device.id}/connectors`, { headers: API_HEADERS() });
      const data = await res.json();
      const opts = [...epConnectorOptions]; opts[idx] = data.connectors || []; setEpConnectorOptions(opts);
      const pins2 = [...epPinOptions]; pins2[idx] = []; setEpPinOptions(pins2);
    } catch { }
  };

  const selectEpConnector = async (idx: number, connector: ConnectorRow) => {
    const newEp = [...signalEndpoints];
    newEp[idx] = { ...newEp[idx], 连接器号: connector.连接器号, 针孔号: '' };
    setSignalEndpoints(newEp);
    // 加载针孔
    const deviceId = connector.device_id;
    try {
      const res = await fetch(`/api/devices/${deviceId}/connectors/${connector.id}/pins`, { headers: API_HEADERS() });
      const data = await res.json();
      const opts = [...epPinOptions]; opts[idx] = data.pins || []; setEpPinOptions(opts);
    } catch { }
  };

  // ── 权限辅助 ─────────────────────────────────────────────

  const isAdmin = user?.role === 'admin';
  const selectedProjectName = projects.find(p => p.id === selectedProjectId)?.name;
  const myProjectRole = myPermissions.find(p => p.project_name === selectedProjectName)?.project_role;
  const canManageDevices = isAdmin || myProjectRole === '设备管理员';
  const canManageSignals = isAdmin || myProjectRole === '设备管理员';
  const isDeviceOwner = (device: DeviceRow) => isAdmin || device.设备负责人 === user?.username;
  const canDeleteSignal = (signal: SignalRow) => isAdmin || signal.created_by === user?.username;

  // ── 渲染：设备视图 ────────────────────────────────────────

  const renderDeviceView = () => (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">
          设备列表（{devices.length} 台 / 连接器共 {devices.reduce((s, d) => s + (d.connector_count ?? 0), 0)} 个）
        </h2>
        {canManageDevices && (
          <button onClick={openAddDevice} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
            + 添加设备
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : devices.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无设备数据</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs text-gray-500 w-8"></th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">设备编号</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">设备中文名称</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">设备所属ATA</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">DAL</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">设备负责人</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">连接器数</th>
                {(isAdmin || devices.some(d => isDeviceOwner(d))) && <th className="px-4 py-2 text-left text-xs text-gray-500">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {devices.map(device => {
                const isExpanded = expandedDeviceId === device.id;
                const lock = lockMap[device.id];
                const canEditDevice = isDeviceOwner(device);
                return (
                  <React.Fragment key={device.id}>
                    <tr className={`hover:bg-gray-50 ${hasTodo(device) ? 'bg-orange-100' : isExpanded ? 'bg-blue-50' : ''}`}>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={async () => {
                            if (isExpanded) { setExpandedDeviceId(null); }
                            else { setExpandedDeviceId(device.id); await loadConnectors(device.id); }
                          }}
                          className="text-gray-400 hover:text-blue-600 font-mono text-xs"
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td className="px-4 py-2 font-medium">{device.设备编号}</td>
                      <td className="px-4 py-2 text-gray-700">{device.设备中文名称 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600">{device.设备所属ATA || '-'}</td>
                      <td className="px-4 py-2 text-gray-600">{device.设备DAL || '-'}</td>
                      <td className="px-4 py-2 text-gray-600">{device.设备负责人 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600">{device.connector_count ?? 0}</td>
                      {(isAdmin || devices.some(d => isDeviceOwner(d))) && (
                        <td className="px-4 py-2 space-x-2">
                          {canEditDevice && (lock ? (
                            <span className="text-xs text-amber-600">🔒{lock.lockedBy}</span>
                          ) : (
                            <>
                              <button onClick={() => openEditDevice(device)} className="text-blue-600 hover:text-blue-800 text-xs">编辑</button>
                              <button onClick={() => deleteDevice(device)} className="text-red-600 hover:text-red-800 text-xs">删除</button>
                            </>
                          ))}
                        </td>
                      )}
                    </tr>

                    {/* 连接器展开 */}
                    {isExpanded && (
                      <tr key={`${device.id}-connectors`}>
                        <td colSpan={(isAdmin || devices.some(d => isDeviceOwner(d))) ? 8 : 7} className="px-0 py-0 bg-blue-50">
                          <div className="pl-8 pr-4 py-2">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-semibold text-blue-700">连接器列表</span>
                              {isDeviceOwner(device) && (
                                <button onClick={() => openAddConnector(device.id)} className="text-xs text-blue-600 hover:text-blue-800">+ 添加连接器</button>
                              )}
                            </div>
                            {!connectors[device.id] ? (
                              <p className="text-xs text-gray-400">加载中...</p>
                            ) : connectors[device.id].length === 0 ? (
                              <p className="text-xs text-gray-400">暂无连接器</p>
                            ) : (
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="bg-blue-100">
                                    <th className="px-2 py-1 text-left text-gray-600 w-6"></th>
                                    <th className="px-2 py-1 text-left text-gray-600">连接器号</th>
                                    <th className="px-2 py-1 text-left text-gray-600">元器件编号</th>
                                    <th className="px-2 py-1 text-left text-gray-600">元器件名称</th>
                                    <th className="px-2 py-1 text-left text-gray-600">针孔数</th>
                                    {isDeviceOwner(device) && <th className="px-2 py-1 text-left text-gray-600">操作</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {connectors[device.id].map(conn => {
                                    const connExpanded = expandedConnectorId === conn.id;
                                    return (
                                      <>
                                        <tr key={conn.id} className={`border-b border-blue-100 hover:bg-blue-50 ${hasTodo(conn) ? 'bg-orange-100' : connExpanded ? 'bg-indigo-50' : ''}`}>
                                          <td className="px-2 py-1">
                                            <button
                                              onClick={async () => {
                                                if (connExpanded) setExpandedConnectorId(null);
                                                else { setExpandedConnectorId(conn.id); await loadPins(device.id, conn.id); }
                                              }}
                                              className="text-gray-400 hover:text-indigo-600"
                                            >
                                              {connExpanded ? '▼' : '▶'}
                                            </button>
                                          </td>
                                          <td className="px-2 py-1 font-medium">{conn.连接器号}</td>
                                          <td className="px-2 py-1">{conn.设备端元器件编号 || '-'}</td>
                                          <td className="px-2 py-1">{conn.元器件名称及类型 || '-'}</td>
                                          <td className="px-2 py-1">{conn.pin_count ?? 0}</td>
                                          {isDeviceOwner(device) && (
                                            <td className="px-2 py-1 space-x-1">
                                              {connectorLockMap[conn.id] ? (
                                                <span className="text-xs text-amber-600">🔒{connectorLockMap[conn.id].lockedBy}</span>
                                              ) : (
                                                <>
                                                  <button onClick={() => openEditConnector(device.id, conn)} className="text-blue-600">编辑</button>
                                                  <button onClick={() => deleteConnector(device.id, conn)} className="text-red-600">删除</button>
                                                </>
                                              )}
                                            </td>
                                          )}
                                        </tr>

                                        {/* 针孔展开 */}
                                        {connExpanded && (
                                          <tr key={`${conn.id}-pins`}>
                                            <td colSpan={isDeviceOwner(device) ? 6 : 5} className="px-0 py-0">
                                              <div className="pl-8 pr-2 py-1 bg-indigo-50">
                                                <div className="flex justify-between items-center mb-1">
                                                  <span className="text-xs font-semibold text-indigo-600">针孔列表</span>
                                                  {isDeviceOwner(device) && (
                                                    <button onClick={() => openAddPin(device.id, conn.id)} className="text-xs text-indigo-600">+ 添加针孔</button>
                                                  )}
                                                </div>
                                                {!pins[conn.id] ? (
                                                  <p className="text-xs text-gray-400">加载中...</p>
                                                ) : pins[conn.id].length === 0 ? (
                                                  <p className="text-xs text-gray-400">暂无针孔</p>
                                                ) : (
                                                  <table className="w-full text-xs">
                                                    <thead>
                                                      <tr className="bg-indigo-100">
                                                        <th className="px-2 py-1 text-left text-gray-600">针孔号</th>
                                                        <th className="px-2 py-1 text-left text-gray-600">端接尺寸</th>
                                                        <th className="px-2 py-1 text-left text-gray-600">屏蔽类型</th>
                                                        {isDeviceOwner(device) && <th className="px-2 py-1 text-left text-gray-600">操作</th>}
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {pins[conn.id].map(pin => (
                                                        <tr key={pin.id} className={`border-b border-indigo-100 ${hasTodo(pin) ? 'bg-orange-100' : ''}`}>
                                                          <td className="px-2 py-1">{pin.针孔号}</td>
                                                          <td className="px-2 py-1">{pin.端接尺寸 || '-'}</td>
                                                          <td className="px-2 py-1">{pin.屏蔽类型 || '-'}</td>
                                                          {isDeviceOwner(device) && (
                                                            <td className="px-2 py-1 space-x-1">
                                                              <button onClick={() => openEditPin(device.id, conn.id, pin)} className="text-blue-600">编辑</button>
                                                              <button onClick={() => deletePin(device.id, conn.id, pin)} className="text-red-600">删除</button>
                                                            </td>
                                                          )}
                                                        </tr>
                                                      ))}
                                                    </tbody>
                                                  </table>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── 渲染：信号视图 ────────────────────────────────────────

  const renderSignalView = () => (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">信号列表（{signals.length}条）</h2>
        {canManageSignals && (
          <button onClick={openAddSignal} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
            + 添加信号
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : signals.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无信号数据</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs text-gray-500 w-8"></th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">Unique ID</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">信号名称摘要</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">连接类型</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">信号方向</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">端点摘要</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {signals.map(signal => {
                const isExpanded = expandedSignalId === signal.id;
                const detail = signalDetails[signal.id];
                return (
                  <>
                    <tr key={signal.id} className={`hover:bg-gray-50 ${
                      hasTodo(signal) || signalDetails[signal.id]?.endpoints?.some(ep => hasTodo(ep))
                        ? 'bg-orange-100'
                        : isExpanded ? 'bg-green-50' : ''
                    }`}>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={async () => {
                            if (isExpanded) setExpandedSignalId(null);
                            else { setExpandedSignalId(signal.id); await loadSignalDetail(signal.id); }
                          }}
                          className="text-gray-400 hover:text-green-600 font-mono text-xs"
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{signal.unique_id || '-'}</td>
                      <td className="px-4 py-2 text-xs">{signal.信号名称摘要 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600">{signal.连接类型 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 text-xs">{signal.信号方向 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 text-xs">{signal.endpoint_summary || '-'}</td>
                      <td className="px-4 py-2 space-x-2 text-xs">
                        {canManageSignals && (isAdmin || signal.can_edit) && (signalLockMap[signal.id] ? (
                          <span className="text-amber-600">🔒{signalLockMap[signal.id].lockedBy}</span>
                        ) : (
                          <button onClick={() => openEditSignal(signal)} className="text-blue-600 hover:text-blue-800">编辑</button>
                        ))}
                        {canDeleteSignal(signal) && (
                          <button onClick={() => deleteSignal(signal)} className="text-red-600 hover:text-red-800">删除</button>
                        )}
                      </td>
                    </tr>

                    {isExpanded && detail && (
                      <tr key={`${signal.id}-detail`}>
                        <td colSpan={7} className="px-0 py-0 bg-green-50">
                          <div className="pl-8 pr-4 py-3 text-xs">

                            {/* 连接摘要：从端 → 到端 */}
                            {detail.endpoints?.length >= 1 && (() => {
                              const ep0 = detail.endpoints[0];
                              const ep1 = detail.endpoints[1];
                              const id0 = ep0.设备端元器件编号 || `${ep0.设备编号}-${ep0.连接器号}`;
                              const id1 = ep1 ? (ep1.设备端元器件编号 || `${ep1.设备编号}-${ep1.连接器号}`) : '';
                              return (
                                <div className="mb-3 font-semibold text-gray-800 text-sm bg-green-100 px-3 py-1.5 rounded">
                                  {id0}-{ep0.针孔号}
                                  {ep1 && <> &nbsp;→&nbsp; {id1}-{ep1.针孔号}</>}
                                  {(detail as any).信号方向 && <span className="ml-2 text-xs font-normal text-gray-600 bg-white px-1.5 py-0.5 rounded border border-gray-300">{(detail as any).信号方向}</span>}
                                </div>
                              );
                            })()}

                            {/* 信号属性 */}
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">

                              {/* 线缆属性 */}
                              {[
                                { key: '推荐导线线规', label: '推荐导线线规' },
                                { key: '推荐导线线型', label: '推荐导线线型' },
                                { key: '敷设代码',      label: '敷设代码' },
                                { key: '电磁兼容代码',  label: '电磁兼容代码' },
                                { key: '独立电源代码',  label: '独立电源代码' },
                                { key: '接地代码',      label: '接地代码' },
                                { key: '额定电压',      label: '额定电压' },
                                { key: '设备正常工作电压范围', label: '设备正常工作电压范围' },
                                { key: '额定电流',      label: '工作电流' },
                                { key: '是否成品线',    label: '是否成品线' },
                              ].filter(f => !!(detail as any)[f.key]).map(f => (
                                <div key={f.key} className="flex gap-2">
                                  <span className="text-gray-500 w-36 flex-shrink-0">{f.label}:</span>
                                  <span className="text-gray-800">{(detail as any)[f.key]}</span>
                                </div>
                              ))}

                              {/* 成品线字段（仅当 是否成品线 = Y 时显示） */}
                              {(detail.是否成品线 === 'Y' || detail.是否成品线 === 'y') && [
                                { key: '成品线件号',            label: '成品线件号' },
                                { key: '成品线线规',            label: '成品线线规' },
                                { key: '成品线类型',            label: '成品线类型' },
                                { key: '成品线长度',            label: '成品线长度(MM)' },
                                { key: '成品线载流量',          label: '成品线载流量(A)' },
                                { key: '成品线线路压降',        label: '成品线线路压降(V)' },
                                { key: '成品线标识',            label: '成品线标识' },
                                { key: '成品线与机上线束对接方式', label: '成品线对接方式' },
                                { key: '成品线安装责任',        label: '成品线安装责任' },
                              ].filter(f => !!(detail as any)[f.key]).map(f => (
                                <div key={f.key} className="flex gap-2">
                                  <span className="text-gray-500 w-36 flex-shrink-0">{f.label}:</span>
                                  <span className="text-gray-800">{(detail as any)[f.key]}</span>
                                </div>
                              ))}

                              {/* 备注 */}
                              {detail.备注 && (
                                <div className="flex gap-2 col-span-2">
                                  <span className="text-gray-500 w-36 flex-shrink-0">备注:</span>
                                  <span className="text-gray-800">{detail.备注}</span>
                                </div>
                              )}
                            </div>

                            {/* 端点详细信息表 */}
                            {detail.endpoints?.length > 0 && (
                              <div>
                                <p className="font-medium text-gray-700 mb-1">信号端点信息</p>
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-green-100">
                                      <th className="px-2 py-1 text-left">端点</th>
                                      <th className="px-2 py-1 text-left">设备编号</th>
                                      <th className="px-2 py-1 text-left">元器件编号</th>
                                      <th className="px-2 py-1 text-left">针孔号</th>
                                      <th className="px-2 py-1 text-left">端点信号名称</th>
                                      <th className="px-2 py-1 text-left">信号定义</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.endpoints.map((ep, i) => (
                                      <tr key={i} className="border-b border-green-100">
                                        <td className="px-2 py-1 text-gray-500">{i === 0 ? '从端点' : '到端点'}</td>
                                        <td className="px-2 py-1">{ep.设备编号}</td>
                                        <td className="px-2 py-1 font-mono">{ep.设备端元器件编号 || `${ep.设备编号}-${ep.连接器号}`}</td>
                                        <td className="px-2 py-1">{ep.针孔号}</td>
                                        <td className="px-2 py-1">{ep.信号名称 || '-'}</td>
                                        <td className="px-2 py-1 text-gray-600">{ep.信号定义 || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── 主渲染 ────────────────────────────────────────────────

  return (
    <Layout>
      <div className="px-4 py-4">
        {/* 顶部：项目选择 + 视图切换 */}
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">项目：</label>
            <select
              value={selectedProjectId || ''}
              onChange={e => setSelectedProjectId(parseInt(e.target.value))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            >
              <option value="">请选择项目</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="flex bg-gray-100 rounded-md p-0.5">
            <button
              onClick={() => setActiveView('devices')}
              className={`px-3 py-1 rounded text-sm ${activeView === 'devices' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600'}`}
            >
              设备视图
            </button>
            <button
              onClick={() => setActiveView('signals')}
              className={`px-3 py-1 rounded text-sm ${activeView === 'signals' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600'}`}
            >
              信号视图
            </button>
          </div>

          <div className="flex bg-gray-100 rounded-md p-0.5">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 rounded text-sm ${filterMode === 'all' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600'}`}
            >
              全部
            </button>
            <button
              onClick={() => setFilterMode('my')}
              className={`px-3 py-1 rounded text-sm ${filterMode === 'my' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600'}`}
            >
              我的
            </button>
          </div>
        </div>

        {/* 内容区 */}
        {!selectedProjectId ? (
          <div className="text-center py-16 text-gray-400">请先选择项目</div>
        ) : activeView === 'devices' ? renderDeviceView() : renderSignalView()}

        {/* ── 设备弹窗 ── */}
        {showDeviceModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">{editingDevice ? '编辑设备' : '添加设备'}</h2>
              <div className="grid grid-cols-2 gap-4">
                {DEVICE_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-600 mb-1">{f.label}{(f.key === '设备编号' || f.key === '设备所属ATA') ? ' *' : ''}</label>
                    {f.key === '设备负责人' && !isAdmin ? (
                      <div className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-sm text-gray-700">
                        {(deviceForm as any)[f.key] || '-'}
                      </div>
                    ) : f.key === '设备DAL' ? (
                      <select
                        value={(deviceForm as any)[f.key] || ''}
                        onChange={e => setDeviceForm({ ...deviceForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        <option value="">请选择</option>
                        {['A', 'B', 'C', 'D', 'E', '其他'].map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={(deviceForm as any)[f.key] || ''}
                        onChange={e => setDeviceForm({ ...deviceForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={closeDeviceModal} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={saveDevice} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 连接器弹窗 ── */}
        {showConnectorModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">{editingConnector ? '编辑连接器' : '添加连接器'}</h2>
              {[
                { key: '连接器号', label: '连接器号 *' },
                { key: '设备端元器件编号', label: '设备端元器件编号 *' },
                { key: '元器件名称及类型', label: '元器件名称及类型' },
                { key: '元器件件号及类型', label: '元器件件号及类型' },
                { key: '元器件供应商名称', label: '元器件供应商名称' },
                { key: '匹配线束端元器件件号', label: '匹配线束端元器件件号' },
                { key: '匹配线束线型', label: '匹配线束线型' },
                { key: '是否随设备交付', label: '是否随设备交付' },
                { key: '备注', label: '备注' },
              ].map(f => (
                <div key={f.key} className="mb-3">
                  <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                  <input
                    type="text"
                    value={(connectorForm as any)[f.key] || ''}
                    onChange={e => {
                      if (f.key === '连接器号' && !editingConnector) {
                        const device = devices.find(d => d.id === connectorTargetDeviceId);
                        const prevNo = (connectorForm as any)['连接器号'] || '';
                        const prevAuto = device ? `${device.设备编号}-${prevNo}` : '';
                        const curCompId = (connectorForm as any)['设备端元器件编号'] || '';
                        const shouldSync = curCompId === '' || curCompId === prevAuto;
                        setConnectorForm({
                          ...connectorForm,
                          '连接器号': e.target.value,
                          ...(shouldSync && device ? { '设备端元器件编号': `${device.设备编号}-${e.target.value}` } : {}),
                        });
                      } else {
                        setConnectorForm({ ...connectorForm, [f.key]: e.target.value });
                      }
                    }}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                  />
                </div>
              ))}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={closeConnectorModal} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={saveConnector} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 针孔弹窗 ── */}
        {showPinModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm w-full">
              <h2 className="text-xl font-bold mb-4">{editingPin ? '编辑针孔' : '添加针孔'}</h2>
              {[
                { key: '针孔号', label: '针孔号 *' },
                { key: '端接尺寸', label: '端接尺寸' },
                { key: '屏蔽类型', label: '屏蔽类型' },
                { key: '备注', label: '备注' },
              ].map(f => (
                <div key={f.key} className="mb-3">
                  <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                  <input
                    type="text"
                    value={(pinForm as any)[f.key] || ''}
                    onChange={e => setPinForm({ ...pinForm, [f.key]: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                  />
                </div>
              ))}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={closePinModal} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={savePin} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 信号弹窗 ── */}
        {showSignalModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">{editingSignal ? '编辑信号' : '添加信号'}</h2>

              {/* 信号属性 */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Unique ID（编辑时只读显示） */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Unique ID *</label>
                  {editingSignal ? (
                    <div className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-sm text-gray-500 font-mono">
                      {(signalForm as any).unique_id || '-'}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={(signalForm as any).unique_id || ''}
                      onChange={e => setSignalForm({ ...signalForm, unique_id: e.target.value })}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    />
                  )}
                </div>
                {/* 其余字段 */}
                {SIGNAL_FIELDS.filter(f => f.key !== 'unique_id').map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-600 mb-1">
                      {f.label}{(f.key === '信号方向' || f.key === '连接类型') ? ' *' : ''}
                    </label>
                    {f.key === '信号方向' ? (
                      <select
                        value={(signalForm as any)[f.key] || ''}
                        onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        <option value="">请选择</option>
                        {['INPUT', 'OUTPUT', 'BI-Direction', '其他'].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : f.key === '连接类型' ? (
                      <select
                        value={(signalForm as any)[f.key] || ''}
                        onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        <option value="">请选择</option>
                        {['A429', 'RS485', 'CAN', 'Discrete'].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={(signalForm as any)[f.key] || ''}
                        onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* 信号端点构建器 */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium text-sm text-gray-700">信号端点</h3>
                  <button
                    onClick={() => setSignalEndpoints([...signalEndpoints, { 设备编号: '', 连接器号: '', 针孔号: '', 信号名称: '', 信号定义: '' }])}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    + 添加端点
                  </button>
                </div>
                {signalEndpoints.map((ep, idx) => (
                  <div key={idx} className="mb-4 p-3 bg-gray-50 rounded border border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-gray-600">端点 {idx + 1}</span>
                      {signalEndpoints.length > 1 && (
                        <button onClick={() => setSignalEndpoints(signalEndpoints.filter((_, i) => i !== idx))} className="text-xs text-red-500">移除</button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {/* 设备搜索 */}
                      <div className="relative">
                        <label className="block text-xs text-gray-500 mb-0.5">设备编号</label>
                        <input
                          type="text"
                          value={epDeviceSearch[idx] || ep.设备编号}
                          onChange={e => searchEpDevice(idx, e.target.value)}
                          placeholder="搜索设备..."
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        />
                        {epDeviceResults[idx]?.length > 0 && (
                          <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded shadow-lg z-10 max-h-32 overflow-y-auto">
                            {epDeviceResults[idx].map(d => (
                              <button key={d.id} onClick={() => selectEpDevice(idx, d)}
                                className="w-full text-left px-2 py-1 text-xs hover:bg-blue-50">
                                {d.设备编号} {d.设备中文名称 ? `(${d.设备中文名称})` : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* 连接器下拉 */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">连接器号</label>
                        <select
                          value={ep.连接器号}
                          onChange={async e => {
                            const conn = epConnectorOptions[idx].find(c => c.连接器号 === e.target.value);
                            if (conn) await selectEpConnector(idx, conn);
                            else { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 连接器号: e.target.value, 针孔号: '' }; setSignalEndpoints(newEp); }
                          }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        >
                          <option value="">选择连接器</option>
                          {(epConnectorOptions[idx] || []).map(c => <option key={c.id} value={c.连接器号}>{c.连接器号}</option>)}
                        </select>
                      </div>
                      {/* 针孔下拉 */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">针孔号</label>
                        <select
                          value={ep.针孔号}
                          onChange={e => { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 针孔号: e.target.value }; setSignalEndpoints(newEp); }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        >
                          <option value="">选择针孔</option>
                          {(epPinOptions[idx] || []).map(p => <option key={p.id} value={p.针孔号}>{p.针孔号}</option>)}
                        </select>
                      </div>
                      {/* 信号名称 */}
                      <div className="col-span-3">
                        <label className="block text-xs text-gray-500 mb-0.5">端点信号名称</label>
                        <input
                          type="text"
                          value={ep.信号名称 || ''}
                          onChange={e => { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 信号名称: e.target.value }; setSignalEndpoints(newEp); }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        />
                      </div>
                      {/* 信号定义 */}
                      <div className="col-span-3">
                        <label className="block text-xs text-gray-500 mb-0.5">信号定义</label>
                        <input
                          type="text"
                          value={ep.信号定义 || ''}
                          onChange={e => { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 信号定义: e.target.value }; setSignalEndpoints(newEp); }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 mt-4">
                <button onClick={closeSignalModal} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={saveSignal} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
