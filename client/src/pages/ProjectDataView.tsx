import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import HistoryModal from '../components/HistoryModal';
import { useAuth } from '../context/AuthContext';

// ── 类型定义 ─────────────────────────────────────────────

interface Project { id: number; name: string; description?: string; }

interface DeviceRow {
  id: number; project_id: number;
  设备编号: string; 设备中文名称?: string; 设备英文名称?: string; 设备英文缩写?: string;
  设备供应商件号?: string; 设备供应商名称?: string; '设备部件所属系统（4位ATA）'?: string;
  设备安装位置?: string; 设备DAL?: string;
  设备壳体是否金属?: string; 金属壳体表面是否经过特殊处理而不易导电?: string; 设备内共地情况?: string;
  设备壳体接地方式?: string; 壳体接地是否故障电流路径?: string; 其他接地特殊要求?: string;
  设备端连接器或接线柱数量?: string; 是否为选装设备?: string; 是否有特殊布线需求?: string; 设备装机架次?: string; 设备装机构型?: string;
  设备负责人?: string; '设备正常工作电压范围（V）'?: string; 设备物理特性?: string; 备注?: string;
  '设备编号（DOORS）'?: string; '设备LIN号（DOORS）'?: string;
  导入来源?: string; created_by?: string;
  status?: string; validation_errors?: string; import_conflicts?: string; // validation_errors JSON: { messages: string[], fields: string[] } or legacy string[]
  connector_count?: number;
  设备负责人姓名?: string;
  pending_item_type?: 'approval' | 'completion' | null;
  has_pending_sub?: boolean;
  pending_sub_item_type?: 'approval' | 'completion' | null;
  management_claim_requester?: string | null;
}

interface ConnectorRow {
  id: number; device_id: number;
  设备端元器件编号: string; 设备端元器件名称及类型?: string;
  设备端元器件件号类型及件号?: string; 设备端元器件供应商名称?: string;
  匹配的线束端元器件件号?: string; 匹配的线束线型?: string;
  尾附件件号?: string; 触件型号?: string;
  设备端元器件匹配的元器件是否随设备交付?: string; 备注?: string;
  status?: string; pin_count?: number;
  导入来源?: string; import_conflicts?: string; validation_errors?: string;
}

interface SectionConnectorRow {
  id: number; project_id: number;
  设备名称: string; 负责人?: string;
  status?: string; created_at?: string; updated_at?: string;
  connector_count?: number;
}

interface SCConnectorRow {
  id: number; section_connector_id: number;
  连接器号: string; 设备端元器件编号?: string; 设备端元器件名称及类型?: string;
  设备端元器件件号类型及件号?: string; 设备端元器件供应商名称?: string;
  匹配的线束端元器件件号?: string; 匹配的线束线型?: string;
  设备端元器件匹配的元器件是否随设备交付?: string; 备注?: string;
  status?: string; pin_count?: number;
}

interface SCPinRow {
  id: number; sc_connector_id: number;
  针孔号: string; 端接尺寸?: string; 屏蔽类型?: string; 备注?: string;
}

interface PinRow {
  id: number; connector_id: number;
  针孔号: string; 端接尺寸?: string; 屏蔽类型?: string; 备注?: string;
  status?: string;
}

interface SignalRow {
  id: number; project_id: number;
  created_by?: string;
  unique_id?: string; 信号名称摘要?: string; 连接类型?: string; 信号ATA?: string;
  信号架次有效性?: string;
  推荐导线线规?: string; 推荐导线线型?: string;
  独立电源代码?: string; 敷设代码?: string; 电磁兼容代码?: string;
  余度代码?: string; 功能代码?: string; 接地代码?: string; 极性?: string;
  额定电压?: string; 额定电流?: string; 设备正常工作电压范围?: string;
  是否成品线?: string; 成品线件号?: string; 成品线线规?: string; 成品线类型?: string;
  成品线长度?: string; 成品线载流量?: string; 成品线线路压降?: string; 成品线标识?: string;
  成品线与机上线束对接方式?: string; 成品线安装责任?: string; 备注?: string;
  endpoint_summary?: string;
  endpoint_count?: number;
  can_edit?: boolean;
  has_unconfirmed?: number;
  status?: string;
  pending_item_type?: 'approval' | 'completion' | null;
}

interface SignalEndpoint {
  id?: number; signal_id?: number; endpoint_index?: number;
  device_id?: number; connector_id?: number;
  设备编号: string; 设备端元器件编号: string; 针孔号: string;
  屏蔽类型?: string; 端接尺寸?: string; 信号名称?: string; 信号定义?: string;
  设备中文名称?: string; 设备负责人?: string;
  confirmed?: number;
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
  { key: '设备编号（DOORS）', label: '设备编号（DOORS）' },
  { key: '设备LIN号（DOORS）', label: '设备LIN号（DOORS）' },
  { key: '设备英文名称', label: '设备英文名称' },
  { key: '设备英文缩写', label: '设备英文缩写' },
  { key: '设备供应商件号', label: '设备供应商件号' },
  { key: '设备供应商名称', label: '设备供应商名称' },
  { key: '设备部件所属系统（4位ATA）', label: '设备部件所属系统（4位ATA）' },
  { key: '设备安装位置', label: '设备安装位置' },
  { key: '设备DAL', label: '设备DAL' },
  { key: '设备壳体是否金属', label: '设备壳体是否金属' },
  { key: '金属壳体表面是否经过特殊处理而不易导电', label: '金属壳体表面是否经过特殊处理而不易导电' },
  { key: '设备内共地情况', label: '设备内共地情况' },
  { key: '设备壳体接地方式', label: '设备壳体接地方式' },
  { key: '壳体接地是否故障电流路径', label: '壳体接地是否故障电流路径' },
  { key: '其他接地特殊要求', label: '其他接地特殊要求' },
  { key: '设备端连接器或接线柱数量', label: '设备端连接器或接线柱数量' },
  { key: '是否为选装设备', label: '是否为选装设备' },
  { key: '是否有特殊布线需求', label: '是否有特殊布线需求' },
  { key: '设备装机架次', label: '设备装机架次' },
  { key: '设备装机构型', label: '设备装机构型' },
  { key: '设备负责人', label: '设备负责人' },
  { key: '设备正常工作电压范围（V）', label: '设备正常工作电压范围（V）' },
  { key: '设备物理特性', label: '设备物理特性' },
  { key: '备注', label: '备注' },
  { key: 'created_by', label: '创建人' },
  { key: '导入来源', label: '导入来源' },
];

const SIGNAL_FIELDS: { key: keyof SignalRow; label: string }[] = [
  { key: 'unique_id', label: 'Unique ID' },
  { key: '连接类型', label: '连接类型' },
  { key: '信号ATA', label: '信号ATA' },
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
  { key: '额定电流', label: '额定电流（A）' },
  { key: '设备正常工作电压范围', label: '设备正常工作电压范围' },
  { key: '是否成品线', label: '是否成品线' },
  { key: '成品线件号', label: '成品线件号' },
  { key: '成品线线规', label: '成品线线规' },
  { key: '成品线类型', label: '成品线类型' },
  { key: '成品线长度', label: '成品线长度(MM)' },
  { key: '成品线载流量', label: '成品线载流量(A)' },
  { key: '成品线线路压降', label: '成品线线路压降' },
  { key: '成品线标识', label: '成品线标识' },
  { key: '成品线与机上线束对接方式', label: '成品线与机上线束对接方式' },
  { key: '成品线安装责任', label: '成品线安装责任' },
  { key: '备注', label: '备注' },
];

// 解析 validation_errors JSON，兼容旧 string[] 格式和新 { messages, fields } 格式
function parseValidationErrors(raw: string | undefined): { messages: string[], fields: string[] } {
  if (!raw) return { messages: [], fields: [] };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // 旧格式：string[]，无法精确标红，退化为不标红任何字段
      return { messages: parsed, fields: [] };
    }
    if (parsed && Array.isArray(parsed.messages)) {
      return { messages: parsed.messages, fields: Array.isArray(parsed.fields) ? parsed.fields : [] };
    }
    return { messages: [], fields: [] };
  } catch {
    return { messages: [], fields: [] };
  }
}

// ── 主组件 ────────────────────────────────────────────────

export default function ProjectDataView() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  // ── 项目选择 ──
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [showSwitchProjectModal, setShowSwitchProjectModal] = useState(false);
  const [switchProjectTargetId, setSwitchProjectTargetId] = useState<number | ''>('');

  // ── 视图切换 ──
  const [activeView, setActiveView] = useState<'devices' | 'signals' | 'section-connectors'>('devices');
  const [filterMode, setFilterMode] = useState<'all' | 'my' | 'related' | 'pending' | 'my_approval' | 'my_completion' | 'my_tasks' | 'networking'>(user?.role === 'admin' ? 'all' : 'my');

  type ApprovalItem = { id: number; recipient_username: string; item_type: string; status: string; rejection_reason?: string; responded_at?: string; };
  type ApprovalInfo = { request: { id: number; current_phase: string; status: string; action_type: string; requester_username: string; created_at: string; old_payload?: string; payload?: string; } | null; items: ApprovalItem[]; my_pending_item: ApprovalItem | null; };
  const [approvalInfoMap, setApprovalInfoMap] = useState<Record<string, ApprovalInfo>>({});

  const [projectConfigurations, setProjectConfigurations] = useState<{ id: number; name: string }[]>([]);

  // ── 设备视图状态 ──
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [statusSummary, setStatusSummary] = useState<{ devices: { normal: number; Draft: number }; connectors: { normal: number; Draft: number }; pins: { normal: number; Draft: number } } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ entityTable: string; entityId: number; entityLabel: string } | null>(null);
  const [deviceFilters, setDeviceFilters] = useState<Record<string, string>>({});
  const [signalFilters, setSignalFilters] = useState<Record<string, string>>({});
  const [configFilterSelected, setConfigFilterSelected] = useState<string[]>([]);
  const [configFilterOpen, setConfigFilterOpen] = useState(false);
  const [expandedDeviceId, setExpandedDeviceId] = useState<number | null>(null);
  const [connectors, setConnectors] = useState<Record<number, ConnectorRow[]>>({});
  const [expandedConnectorId, setExpandedConnectorId] = useState<number | null>(null);
  const [pins, setPins] = useState<Record<number, PinRow[]>>({});
  const [importDiffMap, setImportDiffMap] = useState<Record<string, { old_values: any; new_values: any } | null>>({});

  // ── 断面连接器视图状态 ──
  const [sectionConnectors, setSectionConnectors] = useState<SectionConnectorRow[]>([]);
  const [showSCModal, setShowSCModal] = useState(false);
  const [editingSC, setEditingSC] = useState<SectionConnectorRow | null>(null);
  const [scForm, setSCForm] = useState<Record<string, string>>({});
  const [expandedSCId, setExpandedSCId] = useState<number | null>(null);
  const [scConnectors, setSCConnectors] = useState<Record<number, SCConnectorRow[]>>({});
  const [expandedSCConnectorId, setExpandedSCConnectorId] = useState<number | null>(null);
  const [scPins, setSCPins] = useState<Record<number, SCPinRow[]>>({});
  // SC connector modal
  const [showSCConnectorModal, setShowSCConnectorModal] = useState(false);
  const [scConnectorTargetSCId, setSCConnectorTargetSCId] = useState<number | null>(null);
  const [editingSCConnector, setEditingSCConnector] = useState<SCConnectorRow | null>(null);
  const [scConnectorForm, setSCConnectorForm] = useState<Partial<SCConnectorRow>>({});
  // SC pin modal
  const [showSCPinModal, setShowSCPinModal] = useState(false);
  const [scPinTargetConnectorId, setSCPinTargetConnectorId] = useState<number | null>(null);
  const [editingSCPin, setEditingSCPin] = useState<SCPinRow | null>(null);
  const [scPinForm, setSCPinForm] = useState<Partial<SCPinRow>>({});

  // ── 信号视图状态 ──
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [signalTotal, setSignalTotal] = useState(0);
  const [expandedSignalId, setExpandedSignalId] = useState<number | null>(null);
  const [signalDetails, setSignalDetails] = useState<Record<number, SignalDetail>>({});
  const [signalDisplayCount, setSignalDisplayCount] = useState(50);
  const signalSentinelRef = useRef<HTMLDivElement | null>(null);
  const signalLoadVersion = useRef(0);

  // ── ATA导出状态 ──
  const [showAtaExportModal, setShowAtaExportModal] = useState(false);
  const [ataExportFilter, setAtaExportFilter] = useState('');
  const [ataExportDevices, setAtaExportDevices] = useState<DeviceRow[]>([]);
  const [ataExportSelectedIds, setAtaExportSelectedIds] = useState<Set<number>>(new Set());
  const [ataExportLoading, setAtaExportLoading] = useState(false);

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
  const [fieldWarnings, setFieldWarnings] = useState<Record<string, { message: string; type: 'error' | 'warning' }>>({});

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
    { 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
    { 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
  ]);
  // 端点搜索
  const [epDeviceSearch, setEpDeviceSearch] = useState<string[]>(['', '']);
  const [epDeviceResults, setEpDeviceResults] = useState<DeviceRow[][]>([[], []]);
  const [epConnectorOptions, setEpConnectorOptions] = useState<ConnectorRow[][]>([[], []]);
  const [epPinOptions, setEpPinOptions] = useState<PinRow[][]>([[], []]);
  const [myDevicesList, setMyDevicesList] = useState<DeviceRow[]>([]);

  // ── 智能助手 ──────────────────────────────────────────────
  type ChatMsg = { role: 'user' | 'assistant'; content: string };
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // ── 权限状态 ──
  const [myPermissions, setMyPermissions] = useState<Array<{ project_name: string; project_role: string }>>([]);
  const [projectMembers, setProjectMembers] = useState<string[]>([]);
  const [memberRoles, setMemberRoles] = useState<Array<{ username: string; project_role: string }>>([]);
  const [employeeNameMap, setEmployeeNameMap] = useState<Record<string, string>>({});

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

  // 信号视图中只有 all/my/related 会影响后端查询，其余为客户端筛选
  const signalServerFilter = filterMode === 'my' ? 'my' : filterMode === 'related' ? 'related' : 'all';
  // 设备/区段视图的所有 filterMode 都需要触发重新加载
  const effectiveFilterKey = activeView === 'signals' ? signalServerFilter : filterMode;

  useEffect(() => {
    if (!selectedProjectId) return;
    if (activeView === 'devices') loadDevices();
    else if (activeView === 'signals') loadSignals();
    else loadSectionConnectors();
  }, [selectedProjectId, activeView, effectiveFilterKey]);

  // 信号视图滚动加载：监听哨兵元素
  useEffect(() => {
    const sentinel = signalSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setSignalDisplayCount(prev => prev + 100);
      }
    }, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  useEffect(() => {
    if (!selectedProjectId) { setProjectMembers([]); setMemberRoles([]); return; }
    fetch(`/api/projects/${selectedProjectId}/members`, { headers: API_HEADERS() })
      .then(r => r.json())
      .then(d => { setProjectMembers(d.members || []); setMemberRoles(d.memberRoles || []); })
      .catch(() => { setProjectMembers([]); setMemberRoles([]); });
    // 从 employees 表获取所有员工 EID→姓名 映射
    fetch('/api/employees', { headers: API_HEADERS() })
      .then(r => r.json())
      .then(d => {
        const map: Record<string, string> = {};
        for (const e of (d.employees || [])) map[e.eid] = e.name;
        setEmployeeNameMap(map);
      })
      .catch(() => {});
    // 加载项目构型列表
    fetch(`/api/projects/${selectedProjectId}/configurations`, { headers: API_HEADERS() })
      .then(r => r.json())
      .then(d => setProjectConfigurations(d.configurations || []))
      .catch(() => setProjectConfigurations([]));
  }, [selectedProjectId]);

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
          const myQ = filterMode === 'my' ? '&myDevices=true' : filterMode === 'related' ? '&relatedDevices=true' : '';
          const [lockRes, sigRes] = await Promise.all([
            fetch(`/api/data/locks?table_name=signals`, { headers: API_HEADERS() }),
            fetch(`/api/signals?projectId=${selectedProjectId}${myQ}`, { headers: API_HEADERS() }),
          ]);
          if (lockRes.ok) { const d = await lockRes.json(); setSignalLockMap(d.locks || {}); }
          if (sigRes.ok) { const d = await sigRes.json(); setSignals(d.signals || []); }
        }
      } catch { /* 静默 */ }
    };
    fetchLocks();
    lockRefreshRef.current = setInterval(fetchLocks, 15000);
    return () => { if (lockRefreshRef.current) clearInterval(lockRefreshRef.current); };
  }, [selectedProjectId, activeView, filterMode]);

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
      const myQ = filterMode === 'my' ? '&myDevices=true' : filterMode === 'related' ? '&relatedDevices=true' : '';
      const res = await fetch(`/api/devices?projectId=${selectedProjectId}${myQ}`, { headers: API_HEADERS() });
      const data = await res.json();
      const devs = data.devices || [];
      setDevices(devs);
      setStatusSummary(data.statusSummary || null);
      setExpandedDeviceId(null);
      setConnectors({});
      setExpandedConnectorId(null);
      setPins({});
    } catch (e) { console.error('加载设备失败', e); }
    finally { setLoading(false); }
  };

  const loadSectionConnectors = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/section-connectors?projectId=${selectedProjectId}`, { headers: API_HEADERS() });
      const data = await res.json();
      setSectionConnectors(data.sectionConnectors || []);
      setExpandedSCId(null);
      setSCConnectors({});
      setExpandedSCConnectorId(null);
      setSCPins({});
    } catch (e) { console.error('加载断面连接器失败', e); }
    finally { setLoading(false); }
  };

  const loadSCConnectors = async (scId: number, force = false) => {
    if (!force && scConnectors[scId]) return;
    try {
      const res = await fetch(`/api/section-connectors/${scId}/connectors`, { headers: API_HEADERS() });
      const data = await res.json();
      setSCConnectors(prev => ({ ...prev, [scId]: data.connectors || [] }));
    } catch (e) { console.error('加载SC连接器失败', e); }
  };

  const loadSCPins = async (scId: number, connId: number, force = false) => {
    if (!force && scPins[connId]) return;
    try {
      const res = await fetch(`/api/section-connectors/${scId}/connectors/${connId}/pins`, { headers: API_HEADERS() });
      const data = await res.json();
      setSCPins(prev => ({ ...prev, [connId]: data.pins || [] }));
    } catch (e) { console.error('加载SC针孔失败', e); }
  };

  const loadSignals = async () => {
    if (!selectedProjectId) return;
    // 递增版本号，让旧的后台循环自动放弃
    const version = ++signalLoadVersion.current;
    setLoading(true);
    const myQ = filterMode === 'my' ? '&myDevices=true' : filterMode === 'related' ? '&relatedDevices=true' : '';
    const baseUrl = `/api/signals?projectId=${selectedProjectId}${myQ}`;
    try {
      // 第一批：50条，快速显示
      const res = await fetch(`${baseUrl}&limit=50&offset=0`, { headers: API_HEADERS() });
      const data = await res.json();
      if (signalLoadVersion.current !== version) return; // 已被新请求取代
      const first: any[] = data.signals || [];
      const total: number = data.total ?? first.length;
      setSignals(first);
      setSignalTotal(total);
      setSignalDisplayCount(50);
      setExpandedSignalId(null);
      setLoading(false);

      // 后台静默拉取剩余，每批200条
      if (total > 50) {
        let offset = 50;
        while (offset < total) {
          if (signalLoadVersion.current !== version) return; // 已过时，停止
          const r = await fetch(`${baseUrl}&limit=200&offset=${offset}`, { headers: API_HEADERS() });
          if (!r.ok || signalLoadVersion.current !== version) break;
          const d = await r.json();
          const batch: any[] = d.signals || [];
          if (batch.length === 0) break;
          if (signalLoadVersion.current !== version) return;
          setSignals(prev => {
            if (signalLoadVersion.current !== version) return prev; // 防止过时批次追加
            return [...prev, ...batch];
          });
          offset += batch.length;
        }
      }
    } catch (e) {
      if (signalLoadVersion.current === version) {
        console.error('加载信号失败', e);
        setLoading(false);
      }
    }
  };

  const loadImportDiff = async (entityTable: string, entityId: number) => {
    const key = `${entityTable}_${entityId}`;
    if (importDiffMap[key] !== undefined) return; // 已加载
    try {
      const res = await fetch(`/api/change-logs?entity_table=${entityTable}&entity_id=${entityId}`, { headers: API_HEADERS() });
      const data = await res.json();
      const importLog = (data.logs || []).find((l: any) => l.reason === '文件导入更新');
      if (importLog) {
        setImportDiffMap(prev => ({ ...prev, [key]: {
          old_values: JSON.parse(importLog.old_values || '{}'),
          new_values: JSON.parse(importLog.new_values || '{}'),
        }}));
      } else {
        setImportDiffMap(prev => ({ ...prev, [key]: null }));
      }
    } catch { setImportDiffMap(prev => ({ ...prev, [key]: null })); }
  };

  const loadApprovalInfo = async (entityType: string, entityId: number) => {
    try {
      const res = await fetch(`/api/approvals/by-entity?entity_type=${entityType}&entity_id=${entityId}`, { headers: API_HEADERS() });
      const data = await res.json();
      setApprovalInfoMap(prev => ({ ...prev, [`${entityType}_${entityId}`]: data }));
    } catch { }
  };

  const handleApprove = async (approvalId: number, entityType: string, entityId: number) => {
    try {
      const res = await fetch(`/api/approvals/${approvalId}/approve`, { method: 'POST', headers: API_JSON_HEADERS(), body: JSON.stringify({}) });
      if (!res.ok) throw new Error((await res.json()).error || '审批失败');
      await loadApprovalInfo(entityType, entityId);
      if (activeView === 'devices') await loadDevices(); else await loadSignals();
    } catch (e: any) { alert(e.message || '审批失败'); }
  };

  const handleReject = async (approvalId: number, entityType: string, entityId: number) => {
    const reason = prompt('请输入拒绝理由（必填）：');
    if (!reason || !reason.trim()) { if (reason !== null) alert('拒绝理由不能为空'); return; }
    try {
      const res = await fetch(`/api/approvals/${approvalId}/reject`, { method: 'POST', headers: API_JSON_HEADERS(), body: JSON.stringify({ reason: reason.trim() }) });
      if (!res.ok) throw new Error((await res.json()).error || '拒绝失败');
      await loadApprovalInfo(entityType, entityId);
      if (activeView === 'devices') await loadDevices(); else await loadSignals();
    } catch (e: any) { alert(e.message || '拒绝失败'); }
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

  const loadSignalDetail = async (signalId: number, forceRefresh = false) => {
    if (!forceRefresh && signalDetails[signalId]) return;
    try {
      const res = await fetch(`/api/signals/${signalId}`, { headers: API_HEADERS() });
      const data = await res.json();
      setSignalDetails(prev => ({ ...prev, [signalId]: data.signal }));
    } catch (e) { console.error('加载信号详情失败', e); }
  };

  // ── 设备字段校验 ────────────────────────────────────────────
  const DUP_CHECK_FIELDS = [
    { field: '设备编号', type: 'error' as const },
    { field: '设备中文名称', type: 'error' as const },
    { field: '设备LIN号（DOORS）', type: 'error' as const },
    { field: '设备编号（DOORS）', type: 'warning' as const },
  ];

  const checkDeviceDuplicates = async (form: Partial<DeviceRow>, excludeId?: number) => {
    if (!selectedProjectId) return;
    const fieldsToCheck: Record<string, string> = {};
    for (const { field } of DUP_CHECK_FIELDS) {
      const val = (form as any)[field];
      if (val && String(val).trim()) fieldsToCheck[field] = String(val).trim();
    }
    if (Object.keys(fieldsToCheck).length === 0) return;
    try {
      const res = await fetch('/api/devices/check-duplicates', {
        method: 'POST',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ project_id: selectedProjectId, fields: fieldsToCheck, exclude_id: excludeId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setFieldWarnings(prev => {
        const next = { ...prev };
        for (const { field, type } of DUP_CHECK_FIELDS) {
          if (data[field]?.exists) {
            next[field] = { message: '已存在相同值的记录', type };
          } else {
            delete next[field];
          }
        }
        return next;
      });
    } catch {}
  };

  const validateATA = (value: string) => {
    const val = value.trim();
    if (val && !/^\d{2}(-\d{2}|-XX)?$/.test(val) && val !== 'N/A') {
      setFieldWarnings(prev => ({ ...prev, '设备部件所属系统（4位ATA）': { message: '格式应为 XX-XX、XX 或 N/A', type: 'error' } }));
    } else {
      setFieldWarnings(prev => { const n = { ...prev }; delete n['设备部件所属系统（4位ATA）']; return n; });
    }
  };

  // ── 设备CRUD ──────────────────────────────────────────────

  const openAddDevice = () => {
    setEditingDevice(null);
    // 设备管理员：默认负责人为自己；总体人员/admin：不预设
    const defaultOwner = myProjectRole === '设备管理员' ? (user?.username || '') : '';
    // 默认选中所有构型
    const defaultConfigs = projectConfigurations.map(c => c.name).join(',');
    setDeviceForm({ '设备负责人': defaultOwner, '设备装机构型': defaultConfigs });
    setFieldWarnings({});
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
    setFieldWarnings({});
    setShowDeviceModal(true);
    // 编辑时立即触发查重
    checkDeviceDuplicates({ ...device }, device.id);
    validateATA(String((device as any)['设备部件所属系统（4位ATA）'] || ''));

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
    setFieldWarnings({});
  };

  const saveDevice = async (forceDraft = false) => {
    if (!selectedProjectId || !deviceForm['设备编号']) { alert('设备编号不能为空'); return; }
    const ata = (deviceForm as any)['设备部件所属系统（4位ATA）'] || '';
    if (!ata) { alert('设备部件所属系统（4位ATA） 不能为空'); return; }
    if (ata !== 'N/A' && !/^\d{2}-(\d{2}|XX)$/.test(ata)) { alert('设备部件所属系统（4位ATA） 格式不正确，应为 XX-XX 或 N/A'); return; }
    // 非 Draft 保存时，检查是否有硬性校验错误
    if (!forceDraft) {
      const hasHardError = Object.values(fieldWarnings).some(w => w.type === 'error');
      if (hasHardError) { alert('存在校验错误（红色标记），请先修正或保存为Draft'); return; }
    }
    try {
      const url = editingDevice ? `/api/devices/${editingDevice.id}` : '/api/devices';
      const method = editingDevice ? 'PUT' : 'POST';
      const body = editingDevice
        ? { ...deviceForm, forceDraft }
        : { project_id: selectedProjectId, ...deviceForm, forceDraft };
      const res = await fetch(url, { method, headers: API_JSON_HEADERS(), body: JSON.stringify(body) });
      if (res.status === 202) {
        alert('已提交审批，等待审批通过后生效');
        await closeDeviceModal();
        await loadDevices();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      const result = await res.json();
      await closeDeviceModal();
      await loadDevices();
      if (result.message === '完善提交成功') alert('完善已提交，等待审批');
      else if (result.message === '编辑并审批通过') alert('已编辑并审批通过');
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deleteDevice = async (device: DeviceRow) => {
    if (!confirm(`确定要删除设备 ${device.设备编号} 吗？这将同时删除其所有连接器和针孔。`)) return;
    try {
      const res = await fetch(`/api/devices/${device.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (res.status === 202) {
        alert('删除请求已提交，等待审批通过后执行删除');
        await loadDevices();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      await loadDevices();
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  const handleClaimManagement = async (device: DeviceRow) => {
    if (!confirm(`确认申请管理设备「${device.设备编号}」的权限？申请将发送给所有总体人员审批。`)) return;
    try {
      const res = await fetch(`/api/devices/${device.id}/claim-management`, {
        method: 'POST',
        headers: API_HEADERS(),
      });
      if (!res.ok) throw new Error((await res.json()).error || '申请失败');
      alert('申请已提交，等待总体人员审批。');
      await loadDevices();
    } catch (e: any) { alert(e.message || '申请失败'); }
  };

  // ── 连接器CRUD ────────────────────────────────────────────

  const openAddConnector = (deviceId: number) => {
    setConnectorTargetDeviceId(deviceId);
    setEditingConnector(null);
    const device = devices.find(d => d.id === deviceId);
    const lin = (device as any)?.['设备LIN号（DOORS）'];
    setConnectorForm(lin ? { '设备端元器件编号': `${lin}-` } : {});
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

  const saveConnector = async (forceDraft = false) => {
    if (!connectorTargetDeviceId || !(connectorForm as any)['设备端元器件编号']) { alert('设备端元器件编号不能为空'); return; }
    try {
      const url = editingConnector
        ? `/api/devices/${connectorTargetDeviceId}/connectors/${editingConnector.id}`
        : `/api/devices/${connectorTargetDeviceId}/connectors`;
      const method = editingConnector ? 'PUT' : 'POST';
      const body = forceDraft ? { ...connectorForm, forceDraft: true } : connectorForm;
      const res = await fetch(url, { method, headers: API_JSON_HEADERS(), body: JSON.stringify(body) });
      if (res.status === 202) {
        alert('已提交审批，等待审批通过后生效');
        await closeConnectorModal();
        await loadConnectors(connectorTargetDeviceId!, true);
        return;
      }
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
    if (!confirm(`确定要删除连接器 ${connector.设备端元器件编号} 吗？`)) return;
    try {
      const res = await fetch(`/api/devices/${deviceId}/connectors/${connector.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (res.status === 202) {
        alert('删除请求已提交，等待审批通过后执行删除');
        await loadConnectors(deviceId, true);
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      setDevices(prev => prev.map(d =>
        d.id === deviceId ? { ...d, connector_count: Math.max(0, (d.connector_count ?? 0) - 1) } : d
      ));
      await loadConnectors(deviceId, true);
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  // ── 断面连接器CRUD ────────────────────────────────────────

  const openAddSC = () => {
    setEditingSC(null);
    setSCForm({ '负责人': user?.username || '' });
    setShowSCModal(true);
  };

  const openEditSC = (sc: SectionConnectorRow) => {
    setEditingSC(sc);
    const { id, project_id, created_at, updated_at, ...fields } = sc;
    setSCForm(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v ?? '')])));
    setShowSCModal(true);
  };

  const saveSC = async () => {
    if (!scForm['设备名称']?.trim()) { alert('设备名称为必填项'); return; }
    try {
      let res: Response;
      if (editingSC) {
        res = await fetch(`/api/section-connectors/${editingSC.id}`, {
          method: 'PUT', headers: API_JSON_HEADERS(), body: JSON.stringify(scForm),
        });
      } else {
        res = await fetch('/api/section-connectors', {
          method: 'POST', headers: API_JSON_HEADERS(),
          body: JSON.stringify({ project_id: selectedProjectId, ...scForm }),
        });
      }
      if (!res.ok) { alert((await res.json()).error || '保存失败'); return; }
      setShowSCModal(false);
      await loadSectionConnectors();
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deleteSC = async (sc: SectionConnectorRow) => {
    if (!confirm(`确定要删除断面连接器 ${sc.设备名称} 吗？`)) return;
    try {
      const res = await fetch(`/api/section-connectors/${sc.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      await loadSectionConnectors();
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  // ── 断面连接器-连接器CRUD ─────────────────────────────────

  const openAddSCConnector = (scId: number) => {
    setSCConnectorTargetSCId(scId);
    setEditingSCConnector(null);
    setSCConnectorForm({});
    setShowSCConnectorModal(true);
  };

  const openEditSCConnector = (scId: number, conn: SCConnectorRow) => {
    setSCConnectorTargetSCId(scId);
    setEditingSCConnector(conn);
    const { id, section_connector_id, ...fields } = conn;
    setSCConnectorForm(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v ?? '')])));
    setShowSCConnectorModal(true);
  };

  const saveSCConnector = async () => {
    if (!String(scConnectorForm['连接器号'] || '').trim()) { alert('连接器号不能为空'); return; }
    try {
      let res: Response;
      if (editingSCConnector) {
        res = await fetch(`/api/section-connectors/${scConnectorTargetSCId}/connectors/${editingSCConnector.id}`, {
          method: 'PUT', headers: API_JSON_HEADERS(), body: JSON.stringify(scConnectorForm),
        });
      } else {
        res = await fetch(`/api/section-connectors/${scConnectorTargetSCId}/connectors`, {
          method: 'POST', headers: API_JSON_HEADERS(), body: JSON.stringify(scConnectorForm),
        });
      }
      if (!res.ok) { alert((await res.json()).error || '保存失败'); return; }
      setShowSCConnectorModal(false);
      if (!editingSCConnector) {
        setSectionConnectors(prev => prev.map(sc =>
          sc.id === scConnectorTargetSCId ? { ...sc, connector_count: (sc.connector_count ?? 0) + 1 } : sc
        ));
      }
      await loadSCConnectors(scConnectorTargetSCId!, true);
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deleteSCConnector = async (scId: number, conn: SCConnectorRow) => {
    if (!confirm(`确定要删除连接器 ${conn.连接器号} 吗？`)) return;
    try {
      const res = await fetch(`/api/section-connectors/${scId}/connectors/${conn.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      setSectionConnectors(prev => prev.map(sc =>
        sc.id === scId ? { ...sc, connector_count: Math.max(0, (sc.connector_count ?? 0) - 1) } : sc
      ));
      await loadSCConnectors(scId, true);
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  // ── 断面连接器-针孔CRUD ───────────────────────────────────

  const openAddSCPin = (scId: number, connId: number) => {
    setSCConnectorTargetSCId(scId);
    setSCPinTargetConnectorId(connId);
    setEditingSCPin(null);
    setSCPinForm({});
    setShowSCPinModal(true);
  };

  const openEditSCPin = (scId: number, connId: number, pin: SCPinRow) => {
    setSCConnectorTargetSCId(scId);
    setSCPinTargetConnectorId(connId);
    setEditingSCPin(pin);
    setSCPinForm({ ...pin });
    setShowSCPinModal(true);
  };

  const saveSCPin = async () => {
    if (!String(scPinForm['针孔号'] || '').trim()) { alert('针孔号不能为空'); return; }
    try {
      let res: Response;
      const scId = scConnectorTargetSCId!;
      const connId = scPinTargetConnectorId!;
      if (editingSCPin) {
        const { id, sc_connector_id, ...fields } = scPinForm as any;
        res = await fetch(`/api/section-connectors/${scId}/connectors/${connId}/pins/${editingSCPin.id}`, {
          method: 'PUT', headers: API_JSON_HEADERS(), body: JSON.stringify(fields),
        });
      } else {
        const { id, sc_connector_id, ...fields } = scPinForm as any;
        res = await fetch(`/api/section-connectors/${scId}/connectors/${connId}/pins`, {
          method: 'POST', headers: API_JSON_HEADERS(), body: JSON.stringify(fields),
        });
      }
      if (!res.ok) { alert((await res.json()).error || '保存失败'); return; }
      setShowSCPinModal(false);
      await loadSCPins(scId, connId, true);
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deleteSCPin = async (scId: number, connId: number, pin: SCPinRow) => {
    if (!confirm(`确定要删除针孔 ${pin.针孔号} 吗？`)) return;
    try {
      const res = await fetch(`/api/section-connectors/${scId}/connectors/${connId}/pins/${pin.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      await loadSCPins(scId, connId, true);
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

  const savePin = async (forceDraft = false) => {
    if (!pinTargetConnectorId || !connectorTargetDeviceId || !pinForm['针孔号']) { alert('针孔号不能为空'); return; }
    try {
      const url = editingPin
        ? `/api/devices/${connectorTargetDeviceId}/connectors/${pinTargetConnectorId}/pins/${editingPin.id}`
        : `/api/devices/${connectorTargetDeviceId}/connectors/${pinTargetConnectorId}/pins`;
      const method = editingPin ? 'PUT' : 'POST';
      const body = forceDraft ? { ...pinForm, forceDraft: true } : pinForm;
      const res = await fetch(url, { method, headers: API_JSON_HEADERS(), body: JSON.stringify(body) });
      if (res.status === 202) {
        alert('已提交审批，等待审批通过后生效');
        await loadPins(connectorTargetDeviceId, pinTargetConnectorId, true);
        await closePinModal();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      await loadPins(connectorTargetDeviceId, pinTargetConnectorId, true);
      await closePinModal();
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deletePin = async (deviceId: number, connectorId: number, pin: PinRow) => {
    if (!confirm(`确定要删除针孔 ${pin.针孔号} 吗？`)) return;
    try {
      const res = await fetch(`/api/devices/${deviceId}/connectors/${connectorId}/pins/${pin.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (res.status === 202) {
        alert('删除请求已提交，等待审批通过后执行删除');
        await loadPins(deviceId, connectorId, true);
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      await loadPins(deviceId, connectorId, true);
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  // ── 信号CRUD ──────────────────────────────────────────────

  const loadMyDevices = async () => {
    if (!selectedProjectId) return;
    try {
      const res = await fetch(`/api/devices?projectId=${selectedProjectId}&myDevices=true`, { headers: API_HEADERS() });
      const data = await res.json();
      setMyDevicesList(data.devices || []);
    } catch { setMyDevicesList([]); }
  };

  const openAddSignal = async () => {
    setEditingSignal(null);
    setSignalForm({});
    setSignalEndpoints([
      { 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
      { 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
    ]);
    setEpDeviceSearch(['', '']);
    setEpDeviceResults([[], []]);
    setEpConnectorOptions([[], []]);
    setEpPinOptions([[], []]);
    await loadMyDevices();
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
      if (res.status === 404) {
        // 信号已被他人删除
        await fetch('/api/data/lock', {
          method: 'DELETE', headers: API_JSON_HEADERS(),
          body: JSON.stringify({ table_name: 'signals', row_id: signal.id })
        }).catch(() => {});
        setSignalLockMap(prev => { const n = { ...prev }; delete n[signal.id]; return n; });
        alert('该信号已被删除，列表将自动刷新');
        await loadSignals();
        return;
      }
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
      ? freshEndpoints.map((e: any) => ({
          设备编号: e.设备编号 || '',
          设备端元器件编号: e.设备端元器件编号 || '',
          针孔号: e.针孔号 || '',
          信号名称: e.信号名称 || '',
          信号定义: e.信号定义 || '',
          设备负责人: e.设备负责人 || '',
          confirmed: e.confirmed,
        }))
      : [{ 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '', 设备负责人: '' }];
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
    await loadMyDevices();
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

  const saveSignal = async (isDraft = false, submitDraft = false) => {
    if (!selectedProjectId) return;
    const sf = signalForm as any;
    // 草稿允许跳过必填校验
    if (!isDraft) {
      if (!editingSignal && !sf.unique_id?.trim()) { alert('Unique ID 不能为空'); return; }
      if (!sf['连接类型']) { alert('连接类型不能为空'); return; }
      if (!sf['是否成品线']) { alert('是否成品线不能为空'); return; }
    } else {
      if (!sf.unique_id?.trim()) { alert('草稿也需要填写 Unique ID'); return; }
    }
    try {
      // 校验端点
      const emptyDeviceEp = signalEndpoints.find(ep => !ep.设备编号);
      if (emptyDeviceEp) {
        alert('每个端点都必须选择设备');
        return;
      }
      for (const ep of signalEndpoints) {
        const isOwn = ep.设备负责人 === user?.username;
        // 设备端元器件编号和针孔必须同时有或同时没有
        if ((ep.设备端元器件编号 && !ep.针孔号) || (!ep.设备端元器件编号 && ep.针孔号)) {
          alert(`端点"${ep.设备编号}"的设备端元器件编号和针孔号必须同时填写或同时留空`);
          return;
        }
        // 自己负责的设备：设备端元器件编号、针孔号、信号名称、信号定义全部必填
        if (isOwn) {
          if (!ep.设备端元器件编号 || !ep.针孔号 || !ep.信号名称 || !ep.信号定义) {
            alert(`端点"${ep.设备编号}"是您负责的设备，设备端元器件编号、针孔号、信号名称、信号定义必须全部填写`);
            return;
          }
        }
      }
      const validEndpoints = signalEndpoints;
      const body: any = {
        project_id: selectedProjectId,
        ...signalForm,
        endpoints: validEndpoints,
        ...(isDraft ? { draft: true } : {}),
        ...(submitDraft ? { submit: true } : {}),
      };
      const url = editingSignal ? `/api/signals/${editingSignal.id}` : '/api/signals';
      const method = editingSignal ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: API_JSON_HEADERS(), body: JSON.stringify(body) });
      if (res.status === 202) {
        alert('已提交审批，等待审批通过后生效');
        await closeSignalModal();
        await loadSignals();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      const result = await res.json();
      if (result.merged) {
        alert(`检测到端点重叠，新端点已自动合并至信号 "${result.mergedIntoUniqueId || result.mergedIntoId}"`);
      } else if (result.endpointErrors?.length > 0) {
        alert(`信号已保存，但部分端点失败:\n${result.endpointErrors.join('\n')}`);
      }
      const prevEditingSignal = editingSignal;
      await closeSignalModal();
      await loadSignals();
      if (prevEditingSignal) setSignalDetails(prev => { const n = { ...prev }; delete n[prevEditingSignal.id]; return n; });
      if (result.message === '完善提交成功') alert('完善已提交，等待审批');
    } catch (e: any) { alert(e.message || '保存失败'); }
  };

  const deleteSignal = async (signal: SignalRow) => {
    if (!confirm(`确定要删除信号 ${signal.unique_id || signal.id} 吗？`)) return;
    try {
      const res = await fetch(`/api/signals/${signal.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (res.status === 202) {
        alert('删除请求已提交，等待审批通过后执行删除');
        await loadSignals();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      await loadSignals();
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  // ── 信号端点搜索 ──────────────────────────────────────────

  const searchEpDevice = async (idx: number, query: string) => {
    const newSearch = [...epDeviceSearch];
    newSearch[idx] = query;
    setEpDeviceSearch(newSearch);
    if (!selectedProjectId) return;
    try {
      const res = await fetch(`/api/devices/search?projectId=${selectedProjectId}&q=${encodeURIComponent(query)}`, { headers: API_HEADERS() });
      const data = await res.json();
      const all: DeviceRow[] = data.devices || [];
      // 我的设备排前面
      const myIds = new Set(myDevicesList.map(d => d.id));
      const sorted = [...all.filter(d => myIds.has(d.id)), ...all.filter(d => !myIds.has(d.id))];
      const r = [...epDeviceResults]; r[idx] = sorted; setEpDeviceResults(r);
    } catch { }
  };

  const selectEpDevice = async (idx: number, device: DeviceRow) => {
    const newSearch = [...epDeviceSearch]; newSearch[idx] = device.设备编号;
    setEpDeviceSearch(newSearch);
    const newResults = [...epDeviceResults]; newResults[idx] = [];
    setEpDeviceResults(newResults);
    const newEp = [...signalEndpoints];
    newEp[idx] = { ...newEp[idx], 设备编号: device.设备编号, 设备端元器件编号: '', 针孔号: '', 设备负责人: device.设备负责人 || '' };
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
    newEp[idx] = { ...newEp[idx], 设备端元器件编号: connector.设备端元器件编号, 针孔号: '' };
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
  const isReadOnly = myProjectRole === '只读';
  const canManageDevices = isAdmin || myProjectRole === '总体人员' || myProjectRole === '设备管理员';
  const canManageSignals = isAdmin || myProjectRole === '总体人员' || myProjectRole === 'EWIS管理员' || myProjectRole === '设备管理员';
  // 总体人员可编辑任意设备（通过审批）；设备管理员/负责人仅自己的设备
  const canEditDevice = (device: DeviceRow) => {
    if (isReadOnly) return false;
    if (isAdmin || myProjectRole === '总体人员') return true;
    if (device.设备负责人 === user?.username) return true;
    return false;
  };
  const canDeleteSignal = (signal: SignalRow) => !isReadOnly && (isAdmin || signal.can_edit === true);

  // ── 渲染：设备视图 ────────────────────────────────────────

  const renderDeviceView = () => (
    <div>
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">
            设备列表（{devices.length} 台 / 连接器共 {devices.reduce((s, d) => s + (d.connector_count ?? 0), 0)} 个）
          </h2>
          {statusSummary && (
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-green-50 text-green-700">
                设备: {statusSummary.devices.normal} 正常{statusSummary.devices.Draft > 0 && <>, <span className="text-yellow-600">{statusSummary.devices.Draft} Draft</span></>}
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                连接器: {statusSummary.connectors.normal} 正常{statusSummary.connectors.Draft > 0 && <>, <span className="text-yellow-600">{statusSummary.connectors.Draft} Draft</span></>}
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700">
                针孔: {statusSummary.pins.normal} 正常{statusSummary.pins.Draft > 0 && <>, <span className="text-yellow-600">{statusSummary.pins.Draft} Draft</span></>}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button
              onClick={async () => {
                if (!selectedProjectId) return;
                if (!confirm('确定要清空当前项目的全部设备及连接器数据吗？此操作不可恢复！')) return;
                const res = await fetch(`/api/devices/project/${selectedProjectId}/all`, { method: 'DELETE', headers: API_HEADERS() });
                if (res.ok) { await loadDevices(); }
                else { alert((await res.json()).error || '清空失败'); }
              }}
              className="bg-red-500 text-white px-3 py-1.5 rounded text-sm hover:bg-red-600"
            >清空设备视图数据</button>
          )}
          {canManageDevices && (
            <button id="tour-add-device" onClick={openAddDevice} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
              + 添加设备
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : devices.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无设备数据</div>
      ) : (() => {
        const filteredDevices = devices.filter(d => {
          // 状态筛选（也包含有待审批子项的设备）
          if (filterMode === 'pending' && d.status !== 'Pending' && !d.has_pending_sub) return false;
          if (filterMode === 'my_approval' && !(
            (d.status === 'Pending' && d.pending_item_type === 'approval') || d.pending_sub_item_type === 'approval'
          )) return false;
          if (filterMode === 'my_completion' && !(
            (d.status === 'Pending' && d.pending_item_type === 'completion') || d.pending_sub_item_type === 'completion'
          )) return false;
          if (filterMode === 'my_tasks' && !(
            (d.status === 'Pending' && (d.pending_item_type === 'approval' || d.pending_item_type === 'completion')) ||
            d.pending_sub_item_type === 'approval' || d.pending_sub_item_type === 'completion'
          )) return false;
          // 列过滤
          for (const [key, val] of Object.entries(deviceFilters)) {
            if (!val) continue;
            if (key === '_config') continue; // handled separately below
            if (key === '_status') {
              if (val === 'sub_pending') {
                if (!d.has_pending_sub) return false;
              } else {
                if (d.status !== val) return false;
              }
              continue;
            }
            const kw = val.toLowerCase();
            if (key === '设备部件所属系统（4位ATA）') {
              const ata2 = (d['设备部件所属系统（4位ATA）'] || '').substring(0, 2);
              if (!ata2.toLowerCase().includes(kw)) return false;
            } else if (key === 'connector_count') {
              if (String(d.connector_count ?? 0) !== val) return false;
            } else {
              const cell = String((d as any)[key] ?? '').toLowerCase();
              if (!cell.includes(kw)) return false;
            }
          }
          // 多选构型过滤：设备须包含所选构型中的至少一个
          if (configFilterSelected.length > 0) {
            const deviceConfigs = (d.设备装机构型 || '').split(',').map((s: string) => s.trim()).filter(Boolean);
            if (!configFilterSelected.some(sel => deviceConfigs.includes(sel))) return false;
          }
          return true;
        });
        const hasAnyFilter = Object.values(deviceFilters).some(v => v) || configFilterSelected.length > 0;
        return (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-2 text-left text-xs text-gray-500 w-8"></th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 max-w-[90px]">设备编号</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 max-w-[80px]">构型</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 min-w-[100px]">状态</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 max-w-[100px]">设备LIN号（DOORS）</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500">设备中文名称</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 max-w-[70px]">ATA（前2位筛选）</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 max-w-[60px]">DAL</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 max-w-[80px]">设备负责人</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 max-w-[60px]">连接器数</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 w-[130px]">操作</th>
              </tr>
              <tr className="bg-white border-b">
                <th className="px-4 py-1"></th>
                {['设备编号'].map(col => (
                  <th key={col} className="px-2 py-1 max-w-[90px]">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="筛选..."
                        value={deviceFilters[col] || ''}
                        onChange={e => setDeviceFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        className="w-full px-1.5 py-0.5 pr-5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                      />
                      {deviceFilters[col] && (
                        <button onClick={() => setDeviceFilters(prev => ({ ...prev, [col]: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs leading-none">&times;</button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-2 py-1 max-w-[80px]">
                  <div className="relative">
                    <button
                      onClick={() => setConfigFilterOpen(o => !o)}
                      className={`w-full px-1.5 py-0.5 text-xs border rounded text-left flex items-center justify-between gap-1 ${configFilterSelected.length > 0 ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-300 bg-white text-gray-600'}`}
                    >
                      <span className="truncate">{configFilterSelected.length === 0 ? '所有' : configFilterSelected.length === projectConfigurations.length ? '所有' : `已选 ${configFilterSelected.length} 个`}</span>
                      {configFilterSelected.length > 0 && (
                        <span onMouseDown={e => { e.stopPropagation(); setConfigFilterSelected([]); }} className="text-violet-400 hover:text-violet-600 leading-none flex-shrink-0">×</span>
                      )}
                    </button>
                    {configFilterOpen && (
                      <div className="absolute top-full left-0 mt-0.5 z-30 bg-white border border-gray-200 rounded shadow-lg min-w-[220px] whitespace-nowrap">
                        <label className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
                          <input
                            type="checkbox"
                            checked={configFilterSelected.length === projectConfigurations.length && projectConfigurations.length > 0}
                            onChange={e => setConfigFilterSelected(e.target.checked ? projectConfigurations.map(c => c.name) : [])}
                            className="accent-violet-600"
                          />
                          <span className="text-xs font-medium text-gray-600">全选</span>
                        </label>
                        {projectConfigurations.map((c, idx) => {
                          const n = idx + 1;
                          const circled = n <= 20 ? String.fromCodePoint(0x245F + n) : n <= 35 ? String.fromCodePoint(0x323C + n) : `(${n})`;
                          return (
                          <label key={c.id} className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={configFilterSelected.includes(c.name)}
                              onChange={e => setConfigFilterSelected(prev => e.target.checked ? [...prev, c.name] : prev.filter(n => n !== c.name))}
                              className="accent-violet-600"
                            />
                            <span className="text-xs"><span className="text-violet-600 font-medium mr-0.5">{circled}</span>{c.name}</span>
                          </label>
                          );
                        })}
                        <div className="border-t border-gray-100 px-2 py-1">
                          <button onClick={() => setConfigFilterOpen(false)} className="text-xs text-gray-400 hover:text-gray-600 w-full text-right">关闭</button>
                        </div>
                      </div>
                    )}
                  </div>
                </th>
                <th className="px-2 py-1">
                  <select
                    value={deviceFilters['_status'] || ''}
                    onChange={e => setDeviceFilters(prev => ({ ...prev, _status: e.target.value }))}
                    className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400 bg-white"
                  >
                    <option value="">全部状态</option>
                    <option value="Draft">Draft</option>
                    <option value="Pending">审批中</option>
                    <option value="normal">已生效</option>
                    <option value="sub_pending">子项待审批/完善</option>
                  </select>
                </th>
                {['设备LIN号（DOORS）', '设备中文名称', '设备部件所属系统（4位ATA）', '设备DAL', '设备负责人'].map(col => {
                  const isDAL = col === '设备DAL';
                  const isATA = col === '设备部件所属系统（4位ATA）';
                  const isLIN = col === '设备LIN号（DOORS）';
                  const narrow = col === '设备负责人';
                  return (
                  <th key={col} className={`px-2 py-1 ${isDAL ? 'max-w-[60px]' : isATA ? 'max-w-[70px]' : isLIN ? 'max-w-[100px]' : narrow ? 'max-w-[80px]' : ''}`}>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="筛选..."
                        value={deviceFilters[col] || ''}
                        onChange={e => setDeviceFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        className="w-full px-1 py-0.5 pr-5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                      />
                      {deviceFilters[col] && (
                        <button onClick={() => setDeviceFilters(prev => ({ ...prev, [col]: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs leading-none">&times;</button>
                      )}
                    </div>
                  </th>
                  );
                })}
                <th className="px-2 py-1 max-w-[60px]">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="筛选..."
                      value={deviceFilters['connector_count'] || ''}
                      onChange={e => {
                        const v = e.target.value;
                        if (v === '' || /^\d+$/.test(v)) setDeviceFilters(prev => ({ ...prev, connector_count: v }));
                      }}
                      className="w-full px-1 py-0.5 pr-5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                    />
                    {deviceFilters['connector_count'] && (
                      <button onClick={() => setDeviceFilters(prev => ({ ...prev, connector_count: '' }))}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs leading-none">&times;</button>
                    )}
                  </div>
                </th>
                <th className="px-4 py-1">
                    {hasAnyFilter && (
                      <button onClick={() => setDeviceFilters({})} className="text-xs text-gray-400 hover:text-red-500">全部清除</button>
                    )}
                  </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredDevices.map((device, index) => {
                const isExpanded = expandedDeviceId === device.id;
                const lock = lockMap[device.id];
                return (
                  <React.Fragment key={device.id}>
                    <tr
                      className={`hover:bg-gray-50 ${hasTodo(device) ? 'bg-orange-100' : isExpanded ? 'bg-blue-50' : ''} cursor-pointer`}
                      onDoubleClick={async () => {
                        if (!isExpanded) {
                          setExpandedDeviceId(device.id);
                          await loadConnectors(device.id);
                          if (device.status === 'Pending') await loadApprovalInfo('device', device.id);
                          if ((device as any).import_status === 'updated') loadImportDiff('devices', device.id);
                        }
                        else { setExpandedDeviceId(null); }
                      }}
                    >
                      <td className="px-4 py-2 text-center">
                        <button
                          id={index === 0 ? 'tour-device-expand' : undefined}
                          onClick={async () => {
                            if (isExpanded) { setExpandedDeviceId(null); }
                            else {
                              setExpandedDeviceId(device.id);
                              await loadConnectors(device.id);
                              if (device.status === 'Pending') await loadApprovalInfo('device', device.id);
                            }
                          }}
                          className="text-gray-400 hover:text-blue-600 font-mono text-xs"
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td className="px-2 py-2 font-medium text-sm max-w-[90px] truncate" title={device.设备编号}>{device.设备编号}</td>
                      <td className="px-2 py-2 text-sm max-w-[80px]">
                        {projectConfigurations.length === 0
                          ? <span className="text-gray-300">—</span>
                          : (() => {
                              const deviceConfigs = (device.设备装机构型 || '').split(',').map(s => s.trim()).filter(Boolean);
                              return projectConfigurations.map((c, idx) => {
                                const n = idx + 1;
                                const circled = n <= 20 ? String.fromCodePoint(0x245F + n) : n <= 35 ? String.fromCodePoint(0x323C + n) : `(${n})`;
                                const has = deviceConfigs.includes(c.name);
                                return <span key={c.id} className={`inline-block w-4 text-center ${has ? 'text-violet-600 font-medium' : 'text-transparent'}`} title={has ? c.name : ''}>{circled}</span>;
                              });
                            })()
                        }
                      </td>
                      <td className="px-2 py-2">
                        {device.status === 'Draft' && (
                          <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 text-xs font-semibold">Draft</span>
                        )}
                        {device.status === 'Pending' && (
                          <>
                            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-semibold">审批中</span>
                            {device.pending_item_type === 'approval' && <span className="ml-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-xs">待我审批</span>}
                            {device.pending_item_type === 'completion' && <span className="ml-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-xs">待我完善</span>}
                          </>
                        )}
                        {device.status === 'normal' && (
                          <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs font-semibold">已生效</span>
                        )}
                        {device.has_pending_sub && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 text-xs" title="包含待审批的连接器或针孔">
                            子项{device.pending_sub_item_type === 'completion' ? '待完善' : '待审批'}
                          </span>
                        )}
                        {device.management_claim_requester && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700 text-xs border border-yellow-200">
                            {device.management_claim_requester} 正在申请管理此设备
                          </span>
                        )}
                        {(device as any).import_status === 'uploaded' && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 text-xs font-semibold">已导入</span>
                        )}
                        {(device as any).import_status === 'updated' && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-semibold">已更新</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-gray-600 text-sm max-w-[100px] truncate" title={device['设备LIN号（DOORS）'] || '-'}>{device['设备LIN号（DOORS）'] || '-'}</td>
                      <td className="px-2 py-2 text-gray-700 text-sm">{device.设备中文名称 || '-'}</td>
                      <td className="px-2 py-2 text-gray-600 text-sm max-w-[70px] truncate" title={device['设备部件所属系统（4位ATA）'] || '-'}>{device['设备部件所属系统（4位ATA）'] || '-'}</td>
                      <td className="px-2 py-2 text-gray-600 text-sm max-w-[60px] truncate" title={device.设备DAL || '-'}>{device.设备DAL || '-'}</td>
                      <td className="px-2 py-2 text-gray-600 text-sm max-w-[80px] truncate" title={`${device.设备负责人 || '-'}${device.设备负责人姓名 ? ` (${device.设备负责人姓名})` : ''}`}>
                        {device.设备负责人 || '-'}
                        {device.设备负责人姓名 && <span className="text-gray-400 ml-1">({device.设备负责人姓名})</span>}
                      </td>
                      <td className="px-2 py-2 text-gray-600 text-sm text-center max-w-[60px]">{device.connector_count ?? 0}</td>
                      <td className="px-2 py-2 space-x-2 whitespace-nowrap w-[130px]">
                          {canEditDevice(device) && (device.status === 'Pending' ? (
                            <span className="text-xs text-gray-400 cursor-not-allowed" title="记录审批中，不可编辑">编辑/删除</span>
                          ) : lock ? (
                            <span className="text-xs text-amber-600">🔒{lock.lockedBy}</span>
                          ) : (
                            <>
                              <button id={index === 0 ? 'tour-device-edit' : undefined} onClick={() => openEditDevice(device)} className="text-blue-600 hover:text-blue-800 text-xs">编辑</button>
                              <button onClick={() => deleteDevice(device)} className="text-red-600 hover:text-red-800 text-xs">删除</button>
                            </>
                          ))}
                          {myProjectRole === '设备管理员' && !device.设备负责人 && !device.management_claim_requester && (
                            <button onClick={() => handleClaimManagement(device)} className="text-purple-600 hover:text-purple-800 text-xs">申请管理权限</button>
                          )}
                          <button onClick={() => setHistoryTarget({ entityTable: 'devices', entityId: device.id, entityLabel: `设备 ${device.设备编号}` })} className="text-gray-500 hover:text-gray-700 text-xs">历史</button>
                        </td>
                    </tr>

                    {isExpanded && (
                      <>
                    {/* 设备详情 */}
                    <tr>
                      <td colSpan={10} className="px-0 py-0 bg-gray-50 border-b border-gray-200">
                        <div className="pl-8 pr-4 py-3">
                          {/* 导入更新 diff */}
                          {(device as any).import_status === 'updated' && (() => {
                            const diff = importDiffMap[`devices_${device.id}`];
                            if (!diff) return null;
                            const keys = Object.keys(diff.new_values);
                            if (keys.length === 0) return null;
                            return (
                              <div className="mb-3 border border-purple-200 rounded bg-purple-50 px-3 py-2 text-xs">
                                <div className="font-semibold text-purple-700 mb-1">文件导入更新了以下字段：</div>
                                <table className="w-auto border-collapse">
                                  <thead><tr className="text-gray-500"><th className="pr-4 text-left font-medium">字段</th><th className="pr-4 text-left font-medium">原值</th><th className="text-left font-medium">新值</th></tr></thead>
                                  <tbody>
                                    {keys.map(k => (
                                      <tr key={k} className="border-t border-purple-100">
                                        <td className="pr-4 py-0.5 text-gray-600">{k}</td>
                                        <td className="pr-4 py-0.5 text-red-600 line-through">{diff.old_values[k] || '-'}</td>
                                        <td className="py-0.5 text-green-700 font-medium">{diff.new_values[k] || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
                          {device.status === 'Draft' && device.import_conflicts && (() => {
                            const conflicts: string[] = (() => {
                              try { return JSON.parse(device.import_conflicts); } catch { return [device.import_conflicts]; }
                            })();
                            if (conflicts.length === 0) return null;
                            return (
                              <div className="mb-3 p-2 bg-yellow-50 border border-yellow-300 rounded text-xs text-yellow-800">
                                <div className="font-semibold mb-1">导入冲突（{conflicts.length}条）：</div>
                                {conflicts.map((c, i) => (
                                  <div key={i} className="ml-2 mb-0.5">• {c}</div>
                                ))}
                              </div>
                            );
                          })()}
                          {(() => {
                            const ve = parseValidationErrors(device.validation_errors);
                            if (ve.messages.length === 0) return null;
                            return (
                              <div className="mb-3 p-2 bg-red-50 border border-red-300 rounded text-xs text-red-800 whitespace-pre-wrap">
                                <span className="font-semibold">校验未通过：</span>{'\n'}{ve.messages.map((v, i) => `${i + 1}. ${v}`).join('\n')}{'\n'}请核对设备信息
                              </div>
                            );
                          })()}
                          <div className="text-xs font-semibold text-gray-600 mb-2">设备详细信息</div>
                          <div className="grid grid-cols-4 gap-x-8 gap-y-1.5 text-xs">
                            {(() => {
                              const ve = parseValidationErrors(device.validation_errors);
                              return DEVICE_FIELDS.map(f => {
                                // 导入来源为空时不显示
                                if (f.key === '导入来源' && !(device as any)['导入来源']) return null;
                                const fk = String(f.key);
                                const isErr = ve.fields.includes(fk);
                                return (
                                  <div key={fk} className="flex gap-1 min-w-0">
                                    <span className={`shrink-0 ${isErr ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{f.label}：</span>
                                    <span className={`truncate ${isErr ? 'text-red-600 font-medium' : 'text-gray-800'}`}
                                      title={(device as any)[f.key] || undefined}>
                                      {(device as any)[f.key] || '-'}
                                    </span>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* 审批进度面板 */}
                    {device.status === 'Pending' && (() => {
                      const approvalInfo = approvalInfoMap[`device_${device.id}`];
                      if (!approvalInfo?.request) return null;
                      const { request, items, my_pending_item } = approvalInfo;
                      const completionItems = items.filter((i: any) => i.item_type === 'completion');
                      const approvalItems = items.filter((i: any) => i.item_type === 'approval');
                      return (
                        <tr key={`${device.id}-approval`}>
                          <td colSpan={10} className="px-0 py-0 bg-yellow-50 border-b border-yellow-200">
                            <div className="pl-8 pr-4 py-3">
                              {(() => {
                                const actionLabelsMap: Record<string, string> = {
                                  create_device: '新建设备', edit_device: '修改设备', delete_device: '删除设备',
                                  create_connector: '新建连接器', edit_connector: '修改连接器', delete_connector: '删除连接器',
                                  create_pin: '新建针孔', edit_pin: '修改针孔', delete_pin: '删除针孔',
                                  create_signal: '新建信号', edit_signal: '修改信号', delete_signal: '删除信号',
                                  request_device_management: '申请设备管理权限',
                                };
                                const actionLabel = actionLabelsMap[request.action_type] || request.action_type;
                                let diffRows: { key: string; oldVal: string; newVal: string }[] = [];
                                try {
                                  const oldObj = request.old_payload ? JSON.parse(request.old_payload) : {};
                                  const newObj = request.payload ? JSON.parse(request.payload) : {};
                                  for (const key of Object.keys(newObj)) {
                                    const ov = oldObj[key] ?? '';
                                    const nv = newObj[key] ?? '';
                                    if (String(ov) !== String(nv)) {
                                      diffRows.push({ key, oldVal: String(ov || '（空）'), newVal: String(nv || '（空）') });
                                    }
                                  }
                                } catch {}
                                return (
                                  <>
                                    <div className="text-xs font-semibold text-gray-600 mb-2">审批进度（{actionLabel}）</div>
                                    {diffRows.length > 0 && (
                                      <div className="mb-2 text-xs border border-gray-200 rounded overflow-hidden">
                                        <div className="bg-gray-100 px-2 py-1 font-medium text-gray-500">变更内容</div>
                                        <table className="w-full">
                                          <tbody>
                                            {diffRows.map(({ key, oldVal, newVal }) => (
                                              <tr key={key} className="border-t border-gray-100">
                                                <td className="px-2 py-1 text-gray-500 font-medium w-40 shrink-0">{key}</td>
                                                <td className="px-2 py-1">
                                                  <span className="line-through text-red-500 mr-1">{oldVal}</span>
                                                  <span className="text-gray-400 mr-1">→</span>
                                                  <span className="text-green-700 font-medium">{newVal}</span>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                              {completionItems.length > 0 && (
                                <div className="mb-2">
                                  <div className="text-xs text-gray-400 mb-1">完善阶段</div>
                                  {completionItems.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                                      <span>{item.status === 'done' ? '✅' : item.status === 'cancelled' ? '❌' : '⏳'}</span>
                                      <span className="font-medium">{item.recipient_username}</span>
                                      <span className="text-gray-500">{item.status === 'done' ? '已完善' : item.status === 'cancelled' ? '已取消' : '待完善'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(request.current_phase === 'approval' || completionItems.every((i: any) => i.status !== 'pending')) && (
                                <div className="mb-2">
                                  <div className="text-xs text-gray-400 mb-1">审批阶段</div>
                                  {approvalItems.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                                      <span>{item.status === 'done' && !item.rejection_reason ? '✅' : item.status === 'cancelled' ? '❌' : '⏳'}</span>
                                      <span className="font-medium">{item.recipient_username}</span>
                                      <span className="text-gray-500">{item.status === 'done' && !item.rejection_reason ? '已通过' : item.status === 'done' && item.rejection_reason ? `已拒绝：${item.rejection_reason}` : item.status === 'cancelled' ? '已取消' : '待审批'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {my_pending_item && (
                                <div className="flex gap-2 mt-2">
                                  {my_pending_item.item_type === 'completion' && (
                                    <button
                                      onClick={() => openEditDevice(device)}
                                      className="px-2 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700"
                                    >完善并提交</button>
                                  )}
                                  {my_pending_item.item_type === 'approval' && request.current_phase === 'approval' && (
                                    <>
                                      <button
                                        onClick={() => handleApprove(request.id, 'device', device.id)}
                                        className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                                      >审批通过</button>
                                      <button
                                        onClick={() => handleReject(request.id, 'device', device.id)}
                                        className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                                      >拒绝</button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}

                    {/* 连接器展开 */}
                    <tr key={`${device.id}-connectors`}>
                        <td colSpan={10} className="px-0 py-0 bg-blue-50">
                          <div className="pl-8 pr-4 py-2">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-semibold text-blue-700">连接器列表</span>
                              {canEditDevice(device) && device.status !== 'Pending' && (
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
                                    <th className="px-2 py-1 text-left text-gray-600">元器件编号</th>
                                    <th className="px-2 py-1 text-left text-gray-600">元器件名称</th>
                                    <th className="px-2 py-1 text-left text-gray-600">针孔数</th>
                                    {canEditDevice(device) && <th className="px-2 py-1 text-left text-gray-600">操作</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {connectors[device.id].map(conn => {
                                    const connExpanded = expandedConnectorId === conn.id;
                                    return (
                                      <>
                                        <tr
                                          key={conn.id}
                                          className={`border-b border-blue-100 hover:bg-blue-50 ${hasTodo(conn) ? 'bg-orange-100' : connExpanded ? 'bg-indigo-50' : ''} cursor-pointer`}
                                          onDoubleClick={async () => {
                                            if (!connExpanded) {
                                              setExpandedConnectorId(conn.id);
                                              await loadPins(device.id, conn.id);
                                              if (conn.status === 'Pending') await loadApprovalInfo('connector', conn.id);
                                              if ((conn as any).import_status === 'updated') loadImportDiff('connectors', conn.id);
                                            }
                                            else { setExpandedConnectorId(null); }
                                          }}
                                        >
                                          <td className="px-2 py-1">
                                            <button
                                              onClick={async () => {
                                                if (connExpanded) setExpandedConnectorId(null);
                                                else {
                                                  setExpandedConnectorId(conn.id);
                                                  await loadPins(device.id, conn.id);
                                                  if (conn.status === 'Pending') await loadApprovalInfo('connector', conn.id);
                                                }
                                              }}
                                              className="text-gray-400 hover:text-indigo-600"
                                            >
                                              {connExpanded ? '▼' : '▶'}
                                            </button>
                                          </td>
                                          <td className="px-2 py-1 font-medium">
                                            {conn.设备端元器件编号}
                                            {conn.status === 'Draft' && (
                                              <span className="ml-1 px-1 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">Draft</span>
                                            )}
                                            {conn.status === 'Pending' && (
                                              <span className="ml-1 px-1 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">审批中</span>
                                            )}
                                            {conn.status === 'normal' && (
                                              <span className="ml-1 px-1 py-0.5 text-xs bg-green-100 text-green-700 rounded">已生效</span>
                                            )}
                                            {(conn as any).import_status === 'uploaded' && (
                                              <span className="ml-1 px-1 py-0.5 text-xs bg-teal-100 text-teal-700 rounded font-semibold">已导入</span>
                                            )}
                                            {(conn as any).import_status === 'updated' && (
                                              <span className="ml-1 px-1 py-0.5 text-xs bg-purple-100 text-purple-700 rounded font-semibold">已更新</span>
                                            )}
                                          </td>
                                          <td className="px-2 py-1">{conn.设备端元器件名称及类型 || '-'}</td>
                                          <td className="px-2 py-1">{conn.pin_count ?? 0}</td>
                                          <td className="px-2 py-1 space-x-1">
                                              {canEditDevice(device) && (conn.status === 'Pending' ? (
                                                <span className="text-xs text-gray-400">审批中</span>
                                              ) : connectorLockMap[conn.id] ? (
                                                <span className="text-xs text-amber-600">🔒{connectorLockMap[conn.id].lockedBy}</span>
                                              ) : (
                                                <>
                                                  <button onClick={() => openEditConnector(device.id, conn)} className="text-blue-600">编辑</button>
                                                  <button onClick={() => deleteConnector(device.id, conn)} className="text-red-600">删除</button>
                                                </>
                                              ))}
                                              <button onClick={() => setHistoryTarget({ entityTable: 'connectors', entityId: conn.id, entityLabel: `连接器 ${conn.设备端元器件编号}` })} className="text-gray-500 hover:text-gray-700">历史</button>
                                            </td>
                                        </tr>

                                        {/* 针孔展开 */}
                                        {connExpanded && (
                                          <tr key={`${conn.id}-pins`}>
                                            <td colSpan={canEditDevice(device) ? 6 : 5} className="px-0 py-0">
                                              <div className="pl-8 pr-2 py-1 bg-indigo-50">
                                                {/* 连接器详情 */}
                                                <div className="mb-2 p-2 bg-white border border-indigo-100 rounded text-xs">
                                                  <div className="font-semibold text-indigo-700 mb-1">连接器详情</div>

                                                  {/* 导入更新 diff */}
                                                  {(conn as any).import_status === 'updated' && (() => {
                                                    const diff = importDiffMap[`connectors_${conn.id}`];
                                                    if (!diff) return null;
                                                    const keys = Object.keys(diff.new_values);
                                                    if (keys.length === 0) return null;
                                                    return (
                                                      <div className="mb-2 border border-purple-200 rounded bg-purple-50 px-3 py-2">
                                                        <div className="font-semibold text-purple-700 mb-1">文件导入更新了以下字段：</div>
                                                        <table className="w-auto border-collapse">
                                                          <thead><tr className="text-gray-500"><th className="pr-4 text-left font-medium">字段</th><th className="pr-4 text-left font-medium">原值</th><th className="text-left font-medium">新值</th></tr></thead>
                                                          <tbody>
                                                            {keys.map(k => (
                                                              <tr key={k} className="border-t border-purple-100">
                                                                <td className="pr-4 py-0.5 text-gray-600">{k}</td>
                                                                <td className="pr-4 py-0.5 text-red-600 line-through">{diff.old_values[k] || '-'}</td>
                                                                <td className="py-0.5 text-green-700 font-medium">{diff.new_values[k] || '-'}</td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      </div>
                                                    );
                                                  })()}

                                                  {/* 导入冲突信息 */}
                                                  {conn.import_conflicts && (() => {
                                                    try {
                                                      const conflicts: string[] = JSON.parse(conn.import_conflicts);
                                                      if (conflicts.length === 0) return null;
                                                      return (
                                                        <div className="mb-2 p-2 bg-yellow-50 border border-yellow-300 rounded">
                                                          <div className="font-semibold text-yellow-800 mb-1">导入冲突记录（{conflicts.length}条）</div>
                                                          {conflicts.map((c, ci) => (
                                                            <div key={ci} className="text-yellow-700 text-xs mb-0.5">- {c}</div>
                                                          ))}
                                                        </div>
                                                      );
                                                    } catch { return null; }
                                                  })()}

                                                  {/* 校验错误信息 */}
                                                  {conn.validation_errors && (() => {
                                                    try {
                                                      const veArr: string[] = JSON.parse(conn.validation_errors);
                                                      if (veArr.length === 0) return null;
                                                      return (
                                                        <div className="mb-2 p-2 bg-red-50 border border-red-300 rounded">
                                                          <div className="font-semibold text-red-700 mb-1">
                                                            校验未通过：以下红色字段存在问题 — {veArr.join('、')}。请核对连接器信息
                                                          </div>
                                                        </div>
                                                      );
                                                    } catch { return null; }
                                                  })()}

                                                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                                    {([
                                                      ['设备端元器件编号', conn.设备端元器件编号],
                                                      ['设备端元器件名称及类型', conn.设备端元器件名称及类型],
                                                      ['设备端元器件件号类型及件号', conn.设备端元器件件号类型及件号],
                                                      ['设备端元器件供应商名称', conn.设备端元器件供应商名称],
                                                      ['匹配的线束端元器件件号', conn.匹配的线束端元器件件号],
                                                      ['匹配的线束线型', conn.匹配的线束线型],
                                                      ['尾附件件号', conn.尾附件件号],
                                                      ['触件型号', conn.触件型号],
                                                      ['随设备交付', conn.设备端元器件匹配的元器件是否随设备交付],
                                                      ['备注', conn.备注],
                                                      ['导入来源', conn.导入来源],
                                                    ] as [string, string | undefined][]).map(([label, val]) => {
                                                      // 解析 validation_errors 判断此字段是否校验失败
                                                      let connVeFields: string[] = [];
                                                      try { connVeFields = JSON.parse(conn.validation_errors || '[]'); } catch {}
                                                      const isVeErr = connVeFields.includes(label) || connVeFields.includes(
                                                        label === '随设备交付' ? '设备端元器件匹配的元器件是否随设备交付' : label
                                                      );
                                                      const isDeliverField = label === '随设备交付';
                                                      const isInvalid = isVeErr || (isDeliverField && val != null && val !== '' && val !== '是' && val !== '否');
                                                      return (
                                                        <div key={label} className="flex gap-1">
                                                          <span className={`shrink-0 ${isInvalid ? 'text-red-600 font-medium' : 'text-gray-500'}`}>{label}：</span>
                                                          <span className={`break-all ${isInvalid ? 'text-red-600 font-medium' : 'text-gray-800'}`}>{val || '-'}</span>
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                </div>
                                                {/* 连接器审批进度 */}
                                                {conn.status === 'Pending' && (() => {
                                                  const ai = approvalInfoMap[`connector_${conn.id}`];
                                                  if (!ai?.request) return null;
                                                  const { request: ar, items: ais, my_pending_item: mpi } = ai;
                                                  return (
                                                    <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                                                      <div className="font-semibold text-gray-600 mb-1">审批进度（{ar.action_type}）</div>
                                                      {ais.map((it: any) => (
                                                        <div key={it.id} className="flex items-center gap-1.5 mb-0.5">
                                                          <span>{it.status === 'done' && !it.rejection_reason ? '✅' : it.status === 'cancelled' ? '❌' : '⏳'}</span>
                                                          <span className="font-medium">{it.recipient_username}</span>
                                                          <span className="text-gray-500">{it.status === 'done' && !it.rejection_reason ? '已通过' : it.status === 'cancelled' ? '已取消' : it.item_type === 'completion' ? '待完善' : '待审批'}</span>
                                                        </div>
                                                      ))}
                                                      {mpi && mpi.item_type === 'approval' && ar.current_phase === 'approval' && (
                                                        <div className="flex gap-2 mt-1">
                                                          <button onClick={() => handleApprove(ar.id, 'connector', conn.id)} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700">审批通过</button>
                                                          <button onClick={() => handleReject(ar.id, 'connector', conn.id)} className="px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700">拒绝</button>
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                })()}
                                                <div className="flex justify-between items-center mb-1">
                                                  <span className="text-xs font-semibold text-indigo-600">针孔列表</span>
                                                  {canEditDevice(device) && conn.status !== 'Pending' && (
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
                                                        {canEditDevice(device) && <th className="px-2 py-1 text-left text-gray-600">操作</th>}
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {pins[conn.id].map(pin => (
                                                        <React.Fragment key={pin.id}>
                                                        <tr className={`border-b border-indigo-100 ${hasTodo(pin) ? 'bg-orange-100' : ''}`}>
                                                          <td className="px-2 py-1">
                                                            {pin.针孔号}
                                                            {pin.status === 'Pending' && <span className="ml-1 px-1 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">审批中</span>}
                                                            {pin.status === 'normal' && <span className="ml-1 px-1 py-0.5 text-xs bg-green-100 text-green-700 rounded">已生效</span>}
                                                            {(pin as any).import_status === 'uploaded' && <span className="ml-1 px-1 py-0.5 text-xs bg-teal-100 text-teal-700 rounded font-semibold">已导入</span>}
                                                            {(pin as any).import_status === 'updated' && <span className="ml-1 px-1 py-0.5 text-xs bg-purple-100 text-purple-700 rounded font-semibold">已更新</span>}
                                                          </td>
                                                          <td className="px-2 py-1">{pin.端接尺寸 || '-'}</td>
                                                          <td className="px-2 py-1">{pin.屏蔽类型 || '-'}</td>
                                                          <td className="px-2 py-1 space-x-1">
                                                              {canEditDevice(device) && (pin.status === 'Pending' ? (
                                                                <button onClick={() => loadApprovalInfo('pin', pin.id)} className="text-xs text-blue-600 hover:text-blue-800">审批详情</button>
                                                              ) : (
                                                                <>
                                                                  <button onClick={() => openEditPin(device.id, conn.id, pin)} className="text-blue-600">编辑</button>
                                                                  <button onClick={() => deletePin(device.id, conn.id, pin)} className="text-red-600">删除</button>
                                                                </>
                                                              ))}
                                                              <button onClick={() => setHistoryTarget({ entityTable: 'pins', entityId: pin.id, entityLabel: `针孔 ${pin.针孔号}` })} className="text-gray-500 hover:text-gray-700">历史</button>
                                                            </td>
                                                        </tr>
                                                        {/* 针孔审批进度（Pending时点击审批详情展示） */}
                                                        {pin.status === 'Pending' && approvalInfoMap[`pin_${pin.id}`]?.request && (() => {
                                                          const ai = approvalInfoMap[`pin_${pin.id}`];
                                                          const { request: ar, items: ais, my_pending_item: mpi } = ai;
                                                          return (
                                                            <tr key={`${pin.id}-approval`}>
                                                              <td colSpan={4} className="px-2 py-1">
                                                                <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs mb-1">
                                                                  <div className="font-semibold text-gray-600 mb-1">针孔 {pin.针孔号} 审批进度</div>
                                                                  {ais.map((it: any) => (
                                                                    <div key={it.id} className="flex items-center gap-1.5 mb-0.5">
                                                                      <span>{it.status === 'done' && !it.rejection_reason ? '✅' : it.status === 'cancelled' ? '❌' : '⏳'}</span>
                                                                      <span className="font-medium">{it.recipient_username}</span>
                                                                      <span className="text-gray-500">{it.status === 'done' && !it.rejection_reason ? '已通过' : it.status === 'cancelled' ? '已取消' : it.item_type === 'completion' ? '待完善' : '待审批'}</span>
                                                                    </div>
                                                                  ))}
                                                                  {mpi && mpi.item_type === 'approval' && ar!.current_phase === 'approval' && (
                                                                    <div className="flex gap-2 mt-1">
                                                                      <button onClick={() => handleApprove(ar!.id, 'pin', pin.id)} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700">审批通过</button>
                                                                      <button onClick={() => handleReject(ar!.id, 'pin', pin.id)} className="px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700">拒绝</button>
                                                                    </div>
                                                                  )}
                                                                </div>
                                                              </td>
                                                            </tr>
                                                          );
                                                        })()}
                                                        </React.Fragment>
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
                      </>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {hasAnyFilter && (
            <div className="px-4 py-1.5 text-xs text-gray-500 bg-gray-50 border-t">
              显示 {filteredDevices.length} / {devices.length} 条设备
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );

  // ── 渲染：断面连接器视图 ─────────────────────────────────


  const canManageSC = isAdmin || myProjectRole === '总体人员' || myProjectRole === '设备管理员';
  const canEditSC = (sc: SectionConnectorRow) =>
    isAdmin || myProjectRole === '总体人员' || sc.负责人 === user?.username;

  const renderSectionConnectorView = () => (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">
          断面连接器列表（{sectionConnectors.length} 个 / 连接器共 {sectionConnectors.reduce((s, sc) => s + (sc.connector_count ?? 0), 0)} 个）
        </h2>
        {canManageSC && (
          <button onClick={openAddSC} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
            + 添加断面连接器
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : sectionConnectors.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无断面连接器数据</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">设备名称</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">连接器数</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">负责人</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">更新时间</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sectionConnectors.map(sc => {
                const isExpanded = expandedSCId === sc.id;
                return (
                  <React.Fragment key={sc.id}>
                    <tr
                      className={`hover:bg-gray-50 ${isExpanded ? 'bg-blue-50' : ''} cursor-pointer`}
                      onDoubleClick={async () => {
                        if (!isExpanded) { setExpandedSCId(sc.id); await loadSCConnectors(sc.id); }
                        else { setExpandedSCId(null); }
                      }}
                    >
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={async () => {
                            if (isExpanded) { setExpandedSCId(null); }
                            else { setExpandedSCId(sc.id); await loadSCConnectors(sc.id); }
                          }}
                          className="text-gray-400 hover:text-blue-600 font-mono text-xs"
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td className="px-4 py-2 font-medium">{sc.设备名称}</td>
                      <td className="px-4 py-2 text-gray-600">{sc.connector_count ?? 0}</td>
                      <td className="px-4 py-2 text-gray-600">{sc.负责人 || '-'}</td>
                      <td className="px-4 py-2 text-gray-400 text-xs">
                        {sc.updated_at ? new Date(sc.updated_at.includes('Z') || sc.updated_at.includes('+')
                          ? sc.updated_at : sc.updated_at.replace(' ', 'T') + 'Z').toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-2 space-x-2 whitespace-nowrap">
                        {canEditSC(sc) && (
                          <>
                            <button onClick={() => openEditSC(sc)} className="text-blue-600 hover:text-blue-800 text-xs">编辑</button>
                            <button onClick={() => deleteSC(sc)} className="text-red-600 hover:text-red-800 text-xs">删除</button>
                          </>
                        )}
                        <button onClick={() => setHistoryTarget({ entityTable: 'section_connectors', entityId: sc.id, entityLabel: `断面连接器 ${sc.设备名称}` })} className="text-gray-500 hover:text-gray-700 text-xs">历史</button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="px-0 py-0 bg-blue-50">
                          <div className="pl-8 pr-4 py-2">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-semibold text-blue-700">连接器列表</span>
                              {canEditSC(sc) && (
                                <button onClick={() => openAddSCConnector(sc.id)} className="text-xs text-blue-600 hover:text-blue-800">+ 添加连接器</button>
                              )}
                            </div>
                            {!scConnectors[sc.id] ? (
                              <p className="text-xs text-gray-400">加载中...</p>
                            ) : scConnectors[sc.id].length === 0 ? (
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
                                    {canEditSC(sc) && <th className="px-2 py-1 text-left text-gray-600">操作</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {scConnectors[sc.id].map(conn => {
                                    const connExpanded = expandedSCConnectorId === conn.id;
                                    return (
                                      <React.Fragment key={conn.id}>
                                        <tr
                                          className={`border-b border-blue-100 hover:bg-blue-50 ${connExpanded ? 'bg-indigo-50' : ''} cursor-pointer`}
                                          onDoubleClick={async () => {
                                            if (!connExpanded) { setExpandedSCConnectorId(conn.id); await loadSCPins(sc.id, conn.id); }
                                            else { setExpandedSCConnectorId(null); }
                                          }}
                                        >
                                          <td className="px-2 py-1">
                                            <button
                                              onClick={async () => {
                                                if (connExpanded) setExpandedSCConnectorId(null);
                                                else { setExpandedSCConnectorId(conn.id); await loadSCPins(sc.id, conn.id); }
                                              }}
                                              className="text-gray-400 hover:text-indigo-600"
                                            >
                                              {connExpanded ? '▼' : '▶'}
                                            </button>
                                          </td>
                                          <td className="px-2 py-1 font-medium">{conn.连接器号}</td>
                                          <td className="px-2 py-1">{conn.设备端元器件编号 || '-'}</td>
                                          <td className="px-2 py-1">{conn.设备端元器件名称及类型 || '-'}</td>
                                          <td className="px-2 py-1">{conn.pin_count ?? 0}</td>
                                          <td className="px-2 py-1 space-x-1">
                                              {canEditSC(sc) && (
                                                <>
                                                  <button onClick={() => openEditSCConnector(sc.id, conn)} className="text-blue-600">编辑</button>
                                                  <button onClick={() => deleteSCConnector(sc.id, conn)} className="text-red-600">删除</button>
                                                </>
                                              )}
                                              <button onClick={() => setHistoryTarget({ entityTable: 'sc_connectors', entityId: conn.id, entityLabel: `SC连接器 ${conn.连接器号}` })} className="text-gray-500 hover:text-gray-700">历史</button>
                                            </td>
                                        </tr>

                                        {connExpanded && (
                                          <tr>
                                            <td colSpan={6} className="px-0 py-0">
                                              <div className="pl-8 pr-2 py-1 bg-indigo-50">
                                                {/* 连接器详情 */}
                                                <div className="mb-2 p-2 bg-white border border-indigo-100 rounded text-xs">
                                                  <div className="font-semibold text-indigo-700 mb-1">连接器详情</div>
                                                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                                    {([
                                                      ['连接器号', conn.连接器号],
                                                      ['设备端元器件编号', conn.设备端元器件编号],
                                                      ['设备端元器件名称及类型', conn.设备端元器件名称及类型],
                                                      ['设备端元器件件号类型及件号', conn.设备端元器件件号类型及件号],
                                                      ['设备端元器件供应商名称', conn.设备端元器件供应商名称],
                                                      ['匹配的线束端元器件件号', conn.匹配的线束端元器件件号],
                                                      ['匹配的线束线型', conn.匹配的线束线型],
                                                      ['随设备交付', conn.设备端元器件匹配的元器件是否随设备交付],
                                                      ['备注', conn.备注],
                                                    ] as [string, string | undefined][]).map(([label, val]) => (
                                                      <div key={label} className="flex gap-1">
                                                        <span className="text-gray-500 shrink-0">{label}：</span>
                                                        <span className="text-gray-800 break-all">{val || '-'}</span>
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                                {/* 针孔 */}
                                                <div className="flex justify-between items-center mb-1">
                                                  <span className="text-xs font-semibold text-indigo-600">针孔列表</span>
                                                  {canEditSC(sc) && (
                                                    <button onClick={() => openAddSCPin(sc.id, conn.id)} className="text-xs text-indigo-600">+ 添加针孔</button>
                                                  )}
                                                </div>
                                                {!scPins[conn.id] ? (
                                                  <p className="text-xs text-gray-400">加载中...</p>
                                                ) : scPins[conn.id].length === 0 ? (
                                                  <p className="text-xs text-gray-400">暂无针孔</p>
                                                ) : (
                                                  <table className="w-full text-xs">
                                                    <thead>
                                                      <tr className="bg-indigo-100">
                                                        <th className="px-2 py-1 text-left text-gray-600">针孔号</th>
                                                        <th className="px-2 py-1 text-left text-gray-600">端接尺寸</th>
                                                        <th className="px-2 py-1 text-left text-gray-600">屏蔽类型</th>
                                                        {canEditSC(sc) && <th className="px-2 py-1 text-left text-gray-600">操作</th>}
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {scPins[conn.id].map(pin => (
                                                        <tr key={pin.id} className="border-b border-indigo-100">
                                                          <td className="px-2 py-1">{pin.针孔号}</td>
                                                          <td className="px-2 py-1">{pin.端接尺寸 || '-'}</td>
                                                          <td className="px-2 py-1">{pin.屏蔽类型 || '-'}</td>
                                                          <td className="px-2 py-1 space-x-1">
                                                              {canEditSC(sc) && (
                                                                <>
                                                                  <button onClick={() => openEditSCPin(sc.id, conn.id, pin)} className="text-blue-600">编辑</button>
                                                                  <button onClick={() => deleteSCPin(sc.id, conn.id, pin)} className="text-red-600">删除</button>
                                                                </>
                                                              )}
                                                              <button onClick={() => setHistoryTarget({ entityTable: 'sc_pins', entityId: pin.id, entityLabel: `SC针孔 ${pin.针孔号}` })} className="text-gray-500 hover:text-gray-700">历史</button>
                                                            </td>
                                                        </tr>
                                                      ))}
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
        <h2 className="text-lg font-semibold">信号列表（{signalTotal}条）</h2>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={async () => {
                if (!selectedProjectId) return;
                if (!confirm('确定要清空当前项目的全部信号及端点数据吗？此操作不可恢复！')) return;
                const res = await fetch(`/api/signals/project/${selectedProjectId}/all`, { method: 'DELETE', headers: API_HEADERS() });
                if (res.ok) { await loadSignals(); }
                else { alert((await res.json()).error || '清空失败'); }
              }}
              className="bg-red-500 text-white px-3 py-1.5 rounded text-sm hover:bg-red-600"
            >清空信号视图数据</button>
          )}
          <button
            onClick={async () => {
              if (!selectedProjectId) return;
              setAtaExportFilter('');
              setAtaExportSelectedIds(new Set());
              setShowAtaExportModal(true);
              const res = await fetch(`/api/devices?projectId=${selectedProjectId}`, { headers: API_HEADERS() });
              const data = await res.json();
              setAtaExportDevices(data.devices || []);
            }}
            className="bg-teal-600 text-white px-3 py-1.5 rounded text-sm hover:bg-teal-700"
          >WB导出</button>
          {canManageSignals && (
            <button onClick={openAddSignal} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
              + 添加信号
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : signals.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无信号数据</div>
      ) : (() => {
        const filteredSignals = signals.filter(s => {
          if (filterMode === 'pending' && s.status !== 'Pending') return false;
          if (filterMode === 'my_approval' && !(s.status === 'Pending' && s.pending_item_type === 'approval')) return false;
          if (filterMode === 'my_completion' && !(s.status === 'Pending' && s.pending_item_type === 'completion')) return false;
          if (filterMode === 'my_tasks' && !(s.status === 'Pending' && (s.pending_item_type === 'approval' || s.pending_item_type === 'completion'))) return false;
          if (filterMode === 'networking' && (s.endpoint_count ?? 0) <= 2) return false;
          // 列过滤
          for (const [key, val] of Object.entries(signalFilters)) {
            if (!val) continue;
            if (key === '_status') {
              if (s.status !== val) return false;
              continue;
            }
            const cell = String((s as any)[key] ?? '').toLowerCase();
            if (!cell.includes(val.toLowerCase())) return false;
          }
          return true;
        });
        const hasAnySignalFilter = Object.values(signalFilters).some(v => v);
        // 有筛选条件时显示全部过滤结果，否则按 displayCount 渐进渲染
        const isFiltering = hasAnySignalFilter || filterMode !== 'all';
        const displayedSignals = isFiltering ? filteredSignals : filteredSignals.slice(0, signalDisplayCount);
        const hasMore = !isFiltering && filteredSignals.length > signalDisplayCount;
        return (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-1.5 text-xs text-gray-500 bg-gray-50 border-b">
            {isFiltering
              ? `显示 ${filteredSignals.length} / ${signals.length} 条信号`
              : `已载入 ${Math.min(signalDisplayCount, filteredSignals.length)} / ${signalTotal} 条信号`}
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-2 text-left text-xs text-gray-500 w-8">#</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 w-8"></th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 max-w-[120px]">Unique ID</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 w-[200px]">状态</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 max-w-[180px]">信号名称摘要</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 w-[80px]">连接类型</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 max-w-[180px]">端点摘要</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 w-[120px]">创建人</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 w-[130px]">操作</th>
              </tr>
              <tr className="bg-white border-b">
                <th className="px-2 py-1"></th>
                <th className="px-2 py-1"></th>
                {/* Unique ID */}
                <th className="px-4 py-1 max-w-[120px]">
                  <div className="relative">
                    <input type="text" placeholder="筛选..." value={signalFilters['unique_id'] || ''}
                      onChange={e => setSignalFilters(prev => ({ ...prev, unique_id: e.target.value }))}
                      className="w-full px-1.5 py-0.5 pr-5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
                    {signalFilters['unique_id'] && (
                      <button onClick={() => setSignalFilters(prev => ({ ...prev, unique_id: '' }))}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs leading-none">&times;</button>
                    )}
                  </div>
                </th>
                {/* 状态 */}
                <th className="px-4 py-1 w-[200px]">
                  <select value={signalFilters['_status'] || ''}
                    onChange={e => setSignalFilters(prev => ({ ...prev, _status: e.target.value }))}
                    className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400 bg-white">
                    <option value="">全部状态</option>
                    <option value="Draft">Draft</option>
                    <option value="Pending">审批中</option>
                    <option value="Active">已生效</option>
                  </select>
                </th>
                {/* 信号名称摘要、连接类型、端点摘要、创建人 */}
                {(['信号名称摘要', '连接类型', 'endpoint_summary', 'created_by'] as const).map(col => (
                  <th key={col} className="px-4 py-1">
                    <div className="relative">
                      <input type="text" placeholder="筛选..." value={signalFilters[col] || ''}
                        onChange={e => setSignalFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        className="w-full px-1.5 py-0.5 pr-5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
                      {signalFilters[col] && (
                        <button onClick={() => setSignalFilters(prev => ({ ...prev, [col]: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs leading-none">&times;</button>
                      )}
                    </div>
                  </th>
                ))}
                {/* 操作列 - 清除按钮 */}
                <th className="px-4 py-1">
                  {hasAnySignalFilter && (
                    <button onClick={() => setSignalFilters({})} className="text-xs text-gray-400 hover:text-red-500">全部清除</button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayedSignals.map((signal, displayIndex) => {
                const isExpanded = expandedSignalId === signal.id;
                const detail = signalDetails[signal.id];
                return (
                  <React.Fragment key={signal.id}>
                    <tr
                      className={`hover:bg-gray-50 ${
                        hasTodo(signal) || signalDetails[signal.id]?.endpoints?.some(ep => hasTodo(ep))
                          ? 'bg-orange-100'
                          : isExpanded ? 'bg-green-50' : ''
                      } cursor-pointer`}
                      onDoubleClick={async () => {
                        if (!isExpanded) {
                          setExpandedSignalId(signal.id);
                          await loadSignalDetail(signal.id, true);
                          if (signal.status === 'Pending') await loadApprovalInfo('signal', signal.id);
                        }
                        else { setExpandedSignalId(null); }
                      }}
                    >
                      <td className="px-2 py-2 text-center text-xs text-gray-400">{displayIndex + 1}</td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={async () => {
                            if (isExpanded) setExpandedSignalId(null);
                            else {
                              setExpandedSignalId(signal.id);
                              await loadSignalDetail(signal.id, true);
                              if (signal.status === 'Pending') await loadApprovalInfo('signal', signal.id);
                              if ((signal as any).import_status === 'updated') loadImportDiff('signals', signal.id);
                            }
                          }}
                          className="text-gray-400 hover:text-green-600 font-mono text-xs"
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs max-w-[120px] truncate" title={signal.unique_id || '-'}>{signal.unique_id || '-'}</td>
                      <td className="px-4 py-2 w-[200px]">
                        {signal.status === 'Draft' && (
                          <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 text-xs font-semibold">Draft</span>
                        )}
                        {signal.status === 'Pending' && (
                          <>
                            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-semibold">审批中</span>
                            {signal.pending_item_type === 'approval' && <span className="ml-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-xs">待我审批</span>}
                            {signal.pending_item_type === 'completion' && <span className="ml-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-xs">待我完善</span>}
                          </>
                        )}
                        {signal.status === 'Active' && (
                          <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs font-semibold">已生效</span>
                        )}
                        {(signal as any).import_status === 'uploaded' && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 text-xs font-semibold">已导入</span>
                        )}
                        {(signal as any).import_status === 'updated' && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-semibold">已更新</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs max-w-[180px] truncate" title={signal.信号名称摘要 || '-'}>{signal.信号名称摘要 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 w-[80px] truncate" title={signal.连接类型 || '-'}>{signal.连接类型 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 text-xs max-w-[180px] truncate" title={signal.endpoint_summary || '-'}>{signal.endpoint_summary || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 text-xs w-[120px] truncate" title={signal.created_by || '-'}>{signal.created_by || '-'}</td>
                      <td className="px-4 py-2 space-x-2 text-xs whitespace-nowrap w-[130px]">
                        {signal.status === 'Pending' ? (
                          <span className="text-gray-400 cursor-not-allowed" title="记录审批中，不可编辑">编辑/删除</span>
                        ) : (
                          <>
                            {canManageSignals && (signalLockMap[signal.id] ? (
                              <span className="text-amber-600">🔒{signalLockMap[signal.id].lockedBy}</span>
                            ) : (
                              <button onClick={() => openEditSignal(signal)} className="text-blue-600 hover:text-blue-800">编辑</button>
                            ))}
                            {canDeleteSignal(signal) && (
                              <button onClick={() => deleteSignal(signal)} className="text-red-600 hover:text-red-800">删除</button>
                            )}
                          </>
                        )}
                        <button onClick={() => setHistoryTarget({ entityTable: 'signals', entityId: signal.id, entityLabel: `信号 ${signal.unique_id || signal.id}` })} className="text-gray-500 hover:text-gray-700">历史</button>
                      </td>
                    </tr>

                    {isExpanded && signal.status === 'Pending' && (() => {
                      const approvalInfo = approvalInfoMap[`signal_${signal.id}`];
                      if (!approvalInfo?.request) return null;
                      const { request, items, my_pending_item } = approvalInfo;
                      const completionItems = items.filter((i: any) => i.item_type === 'completion');
                      const approvalItems = items.filter((i: any) => i.item_type === 'approval');
                      return (
                        <tr key={`${signal.id}-approval`}>
                          <td colSpan={9} className="px-0 py-0 bg-yellow-50 border-b border-yellow-200">
                            <div className="pl-8 pr-4 py-3">
                              <div className="text-xs font-semibold text-gray-600 mb-2">审批进度（{request.action_type}）</div>
                              {completionItems.length > 0 && (
                                <div className="mb-2">
                                  <div className="text-xs text-gray-400 mb-1">完善阶段</div>
                                  {completionItems.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                                      <span>{item.status === 'done' ? '✅' : item.status === 'cancelled' ? '❌' : '⏳'}</span>
                                      <span className="font-medium">{item.recipient_username}</span>
                                      <span className="text-gray-500">{item.status === 'done' ? '已完善' : item.status === 'cancelled' ? '已取消' : '待完善'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(request.current_phase === 'approval' || completionItems.every((i: any) => i.status !== 'pending')) && (
                                <div className="mb-2">
                                  <div className="text-xs text-gray-400 mb-1">审批阶段</div>
                                  {approvalItems.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                                      <span>{item.status === 'done' && !item.rejection_reason ? '✅' : item.status === 'cancelled' ? '❌' : '⏳'}</span>
                                      <span className="font-medium">{item.recipient_username}</span>
                                      <span className="text-gray-500">{item.status === 'done' && !item.rejection_reason ? '已通过' : item.status === 'done' && item.rejection_reason ? `已拒绝：${item.rejection_reason}` : item.status === 'cancelled' ? '已取消' : '待审批'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {my_pending_item && my_pending_item.item_type === 'approval' && request.current_phase === 'approval' && (
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={() => handleApprove(request.id, 'signal', signal.id)}
                                    className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                                  >审批通过</button>
                                  <button
                                    onClick={() => handleReject(request.id, 'signal', signal.id)}
                                    className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                                  >拒绝</button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}

                    {isExpanded && detail && (
                      <tr key={`${signal.id}-detail`}>
                        <td colSpan={9} className="px-0 py-0 bg-green-50">
                          <div className="pl-8 pr-4 py-3 text-xs">

                            {/* 导入更新 diff */}
                            {(signal as any).import_status === 'updated' && (() => {
                              const diff = importDiffMap[`signals_${signal.id}`];
                              if (!diff) return null;
                              const keys = Object.keys(diff.new_values);
                              if (keys.length === 0) return null;
                              return (
                                <div className="mb-3 border border-purple-200 rounded bg-purple-50 px-3 py-2">
                                  <div className="font-semibold text-purple-700 mb-1">文件导入更新了以下字段：</div>
                                  <table className="w-auto border-collapse text-xs">
                                    <thead><tr className="text-gray-500"><th className="pr-4 text-left font-medium">字段</th><th className="pr-4 text-left font-medium">原值</th><th className="text-left font-medium">新值</th></tr></thead>
                                    <tbody>
                                      {keys.map(k => (
                                        <tr key={k} className="border-t border-purple-100">
                                          <td className="pr-4 py-0.5 text-gray-600">{k}</td>
                                          <td className="pr-4 py-0.5 text-red-600 line-through">{diff.old_values[k] || '-'}</td>
                                          <td className="py-0.5 text-green-700 font-medium">{diff.new_values[k] || '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })()}

                            {/* 信号合并历史 */}
                            {(detail as any).import_conflicts && (() => {
                              const conflicts: string[] = (() => {
                                try { return JSON.parse((detail as any).import_conflicts); } catch { return [(detail as any).import_conflicts]; }
                              })();
                              if (conflicts.length === 0) return null;
                              return (
                                <div className="mb-3 border border-amber-200 rounded bg-amber-50 px-3 py-2">
                                  <div className="font-semibold text-amber-700 mb-1">信号合并记录（{conflicts.length}条）</div>
                                  <ul className="list-disc list-inside text-xs text-gray-700 space-y-0.5 max-h-40 overflow-y-auto">
                                    {conflicts.map((c, i) => <li key={i}>{c}</li>)}
                                  </ul>
                                </div>
                              );
                            })()}

                            {/* 连接摘要 */}
                            {detail.endpoints?.length >= 1 && (
                              <div className="mb-3 font-semibold text-gray-800 text-sm bg-green-100 px-3 py-1.5 rounded">
                                {detail.endpoints.map((ep, i) => {
                                  if (!ep.pin_id) {
                                    return (
                                      <span key={i}>
                                        {i > 0 && ' - '}
                                        <span className="text-orange-600">{ep.设备编号}(待完善)</span>
                                      </span>
                                    );
                                  }
                                  const epId = ep.设备端元器件编号 || `${ep.设备编号}(?)`;
                                  return (
                                    <span key={i}>
                                      {i > 0 && ' - '}
                                      {epId}-{ep.针孔号}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {/* 信号属性 */}
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">

                              {/* 信号ATA */}
                              {(() => {
                                const v = (detail as any)['信号ATA'] || '';
                                if (!v) return null;
                                const valid = v === 'N/A' || /^\d{2}-(\d{2}|XX)$/.test(v);
                                if (!valid) return null;
                                return (
                                  <div className="col-span-2 flex gap-2 mb-1">
                                    <span className="text-gray-500 w-36 flex-shrink-0">信号ATA:</span>
                                    <span className="text-gray-800">{v}</span>
                                  </div>
                                );
                              })()}

                              {/* 线缆属性 */}
                              {[
                                { key: '推荐导线线规', label: '推荐导线线规' },
                                { key: '推荐导线线型', label: '推荐导线线型' },
                                { key: '独立电源代码',  label: '独立电源代码' },
                                { key: '敷设代码',      label: '敷设代码' },
                                { key: '电磁兼容代码',  label: '电磁兼容代码' },
                                { key: '功能代码',      label: '功能代码' },
                                { key: '余度代码',      label: '余度代码' },
                                { key: '接地代码',      label: '接地代码' },
                                { key: '极性',          label: '极性' },
                                { key: '额定电压',      label: '额定电压' },
                                { key: '设备正常工作电压范围', label: '设备正常工作电压范围' },
                                { key: '额定电流',      label: '额定电流（A）' },
                                { key: '信号架次有效性', label: '信号架次有效性' },
                                { key: '是否成品线',    label: '是否成品线' },
                                { key: '备注',          label: '备注' },
                              ].map(f => (
                                <div key={f.key} className="flex gap-2">
                                  <span className="text-gray-500 w-36 flex-shrink-0">{f.label}:</span>
                                  <span className="text-gray-800">{(detail as any)[f.key] || '-'}</span>
                                </div>
                              ))}

                              {/* 成品线字段（仅当 是否成品线 = Y 时显示） */}
                              {(detail.是否成品线 === 'Y' || detail.是否成品线 === 'y') && [
                                { key: '成品线件号',            label: '成品线件号' },
                                { key: '成品线线规',            label: '成品线线规' },
                                { key: '成品线类型',            label: '成品线类型' },
                                { key: '成品线长度',            label: '成品线长度(MM)' },
                                { key: '成品线载流量',          label: '成品线载流量(A)' },
                                { key: '成品线线路压降',        label: '成品线线路压降' },
                                { key: '成品线标识',            label: '成品线标识' },
                                { key: '成品线与机上线束对接方式', label: '成品线与机上线束对接方式' },
                                { key: '成品线安装责任',        label: '成品线安装责任' },
                              ].map(f => (
                                <div key={f.key} className="flex gap-2">
                                  <span className="text-gray-500 w-36 flex-shrink-0">{f.label}:</span>
                                  <span className="text-gray-800">{(detail as any)[f.key] || '-'}</span>
                                </div>
                              ))}
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
                                      <th className="px-2 py-1 text-left">信号方向</th>
                                      <th className="px-2 py-1 text-left">备注</th>
                                      <th className="px-2 py-1 text-left">状态</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.endpoints.map((ep, i) => {
                                      const direction = ep.input && ep.output ? 'BI' : ep.input ? 'IN' : ep.output ? 'OUT' : '-';
                                      return (
                                      <tr key={i} className={`border-b border-green-100 ${!ep.pin_id ? 'bg-orange-50' : ''}`}>
                                        <td className="px-2 py-1 text-gray-500">端点{i + 1}</td>
                                        <td className="px-2 py-1">{ep.设备编号}</td>
                                        <td className="px-2 py-1 font-mono">
                                          {ep.pin_id
                                            ? (ep.设备端元器件编号 || ep.设备编号)
                                            : <span className="text-orange-500 italic">待完善</span>
                                          }
                                        </td>
                                        <td className="px-2 py-1">
                                          {ep.pin_id ? ep.针孔号 : <span className="text-orange-500 italic">待完善</span>}
                                        </td>
                                        <td className="px-2 py-1">{ep.信号名称 || '-'}</td>
                                        <td className="px-2 py-1 text-gray-600">{ep.信号定义 || '-'}</td>
                                        <td className="px-2 py-1 text-center font-medium">{direction}</td>
                                        <td className="px-2 py-1 text-gray-600">{(ep as any).备注 || '-'}</td>
                                        <td className="px-2 py-1">
                                          {!ep.pin_id
                                            ? (signal.status === 'Pending' && ep.设备负责人 === user?.username
                                              ? <button
                                                  onClick={() => openEditSignal(signal)}
                                                  className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-xs hover:bg-purple-200 cursor-pointer"
                                                >待我完善并提交</button>
                                              : <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 text-xs">待完善</span>
                                            )
                                            : ep.confirmed === 0
                                              ? <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 text-xs">待确认</span>
                                              : <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs">已确认</span>
                                          }
                                        </td>
                                      </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
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
          {/* 渐进加载哨兵 */}
          {hasMore && (
            <div ref={signalSentinelRef} className="py-3 text-center text-xs text-gray-400">
              滚动加载更多... （已显示 {Math.min(signalDisplayCount, filteredSignals.length)} / {filteredSignals.length} 条）
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );

  // ── 主渲染 ────────────────────────────────────────────────

  return (
    <Layout>
      <div className="px-4 py-4">
        {/* 顶部：项目名称 */}
        <div className="mb-3">
          <span className="text-xl font-bold text-gray-900">
            {selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name ?? '（未知项目）' : '请选择项目'}
          </span>
          <button
            onClick={() => { setSwitchProjectTargetId(selectedProjectId ?? ''); setShowSwitchProjectModal(true); }}
            className="ml-3 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
          >
            切换项目
          </button>
        </div>

        {/* 视图切换 */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex bg-gray-100 rounded-md p-0.5">
            <button
              onClick={() => setActiveView('devices')}
              className={`px-3 py-1 rounded text-sm ${activeView === 'devices' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600'}`}
            >
              设备视图
            </button>
            <button
              onClick={() => setActiveView('section-connectors')}
              className={`px-3 py-1 rounded text-sm ${activeView === 'section-connectors' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600'}`}
            >
              断面连接器
            </button>
            <button
              onClick={() => setActiveView('signals')}
              className={`px-3 py-1 rounded text-sm ${activeView === 'signals' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600'}`}
            >
              信号视图
            </button>
          </div>
        </div>

        {/* 筛选按钮 */}
        <div id="tour-filter-tabs" className="flex flex-wrap items-center gap-3 mb-4 justify-between">
          <div className="flex bg-gray-100 rounded-md p-0.5">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 rounded text-sm ${filterMode === 'all' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600'}`}
            >
              {activeView === 'signals' ? '全部信号' : '全部设备'}
            </button>
            <button
              onClick={() => setFilterMode('my')}
              className={`px-3 py-1 rounded text-sm ${filterMode === 'my' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600'}`}
            >
              {activeView === 'signals' ? '与我有关的信号' : '己方设备'}
            </button>
            {activeView === 'devices' && (
              <button
                onClick={() => setFilterMode('related')}
                className={`px-3 py-1 rounded text-sm ${filterMode === 'related' ? 'bg-white shadow text-teal-600 font-medium' : 'text-gray-600'}`}
              >
                对端设备
              </button>
            )}
            <button
              onClick={() => setFilterMode('my_tasks')}
              className={`px-3 py-1 rounded text-sm ${filterMode === 'my_tasks' ? 'bg-white shadow text-orange-600 font-medium' : 'text-gray-600'}`}
            >
              我的任务
            </button>
            {activeView === 'signals' && (
              <button
                onClick={() => setFilterMode('networking')}
                className={`px-3 py-1 rounded text-sm ${filterMode === 'networking' ? 'bg-white shadow text-green-600 font-medium' : 'text-gray-600'}`}
              >
                组网信号
              </button>
            )}
          </div>

          {/* 智能助手按钮 */}
          <button
            onClick={() => setShowChat(c => !c)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm hover:bg-indigo-100 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            智能助手
          </button>
        </div>

        {/* 智能助手浮窗 */}
        {showChat && (
          <div className="fixed bottom-6 right-6 z-50 w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col" style={{ height: '520px' }}>
            <div className="flex items-center justify-between px-4 py-3 bg-indigo-600 rounded-t-2xl">
              <div className="flex items-center gap-2 text-white font-medium text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                EICD 智能助手
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setChatMessages([])} className="text-indigo-200 hover:text-white text-xs">清空</button>
                <button onClick={() => setShowChat(false)} className="text-indigo-200 hover:text-white">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {chatMessages.length === 0 && (
                <div className="text-center text-gray-400 text-sm mt-8">
                  <p className="text-2xl mb-2">💬</p>
                  <p>你好！我是 EICD 智能助手</p>
                  <p className="mt-1 text-xs">可以问我关于平台操作、字段含义、航空电气规范等问题</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-500 px-3 py-2 rounded-2xl rounded-bl-sm text-sm">
                    <span className="animate-pulse">正在思考...</span>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-100">
              <form onSubmit={async e => {
                e.preventDefault();
                const text = chatInput.trim();
                if (!text || chatLoading) return;
                const newMessages: ChatMsg[] = [...chatMessages, { role: 'user', content: text }];
                setChatMessages(newMessages);
                setChatInput('');
                setChatLoading(true);
                try {
                  const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...API_HEADERS() },
                    body: JSON.stringify({ messages: newMessages }),
                  });
                  const data = await res.json();
                  setChatMessages([...newMessages, { role: 'assistant', content: data.reply || data.error || '助手暂无回复' }]);
                } catch {
                  setChatMessages([...newMessages, { role: 'assistant', content: '网络错误，请稍后再试' }]);
                } finally {
                  setChatLoading(false);
                }
              }} className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="输入问题..."
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
                  disabled={chatLoading}
                />
                <button type="submit" disabled={chatLoading || !chatInput.trim()}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50">
                  发送
                </button>
              </form>
            </div>
          </div>
        )}

        {/* 内容区 */}
        {!selectedProjectId ? (
          <div className="text-center py-16 text-gray-400">
            {projects.length === 0 && !isAdmin
              ? '当前无任何项目权限，请点击右上角灰色齿轮申请项目权限'
              : '请先选择项目'}
          </div>
        ) : activeView === 'devices' ? renderDeviceView()
          : activeView === 'section-connectors' ? renderSectionConnectorView()
          : renderSignalView()}

        {/* ── 切换项目弹窗 ── */}
        {showSwitchProjectModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-80">
              <h2 className="text-lg font-bold mb-4">切换项目</h2>
              <select
                value={switchProjectTargetId}
                onChange={e => setSwitchProjectTargetId(e.target.value === '' ? '' : parseInt(e.target.value))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-4"
              >
                <option value="">请选择项目</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowSwitchProjectModal(false)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (switchProjectTargetId !== '') {
                      setSelectedProjectId(switchProjectTargetId as number);
                    }
                    setShowSwitchProjectModal(false);
                  }}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  确认切换
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 设备弹窗 ── */}
        {showDeviceModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">{editingDevice ? '编辑设备' : '添加设备'}</h2>
              {(() => {
                const editVe = parseValidationErrors(editingDevice?.validation_errors);
                return (
              <div className="grid grid-cols-2 gap-4">
                {DEVICE_FIELDS.map(f => {
                  // 导入来源为空时不显示
                  if (f.key === '导入来源' && !(deviceForm as any)['导入来源']) return null;
                  const isErr = editVe.fields.includes(String(f.key));
                  const fw = fieldWarnings[f.key as string];
                  return (
                  <div key={f.key}>
                    <label className={`block text-xs mb-1 ${isErr ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                      {f.label}{(f.key === '设备编号' || f.key === '设备部件所属系统（4位ATA）') ? <span className="text-red-500"> *</span> : ''}
                      {fw && <span className={`ml-1 ${fw.type === 'error' ? 'text-red-600' : 'text-orange-500'}`}>({fw.message})</span>}
                    </label>
                    {(f.key === 'created_by' || f.key === '导入来源') ? (
                      <div className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-sm text-gray-500 break-all"
                        title={(deviceForm as any)[f.key] || undefined}>
                        {(deviceForm as any)[f.key] || '-'}
                      </div>
                    ) : f.key === '设备负责人' ? (
                      myProjectRole === '设备管理员' && !isAdmin ? (
                        /* 设备管理员：只读，固定为自己 */
                        <div className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-sm text-gray-700">
                          {(deviceForm as any)[f.key] || '-'}
                          {(deviceForm as any)[f.key] && employeeNameMap[(deviceForm as any)[f.key]] && <span className="text-gray-400 ml-1">({employeeNameMap[(deviceForm as any)[f.key]]})</span>}
                        </div>
                      ) : (
                        /* admin / 总体人员：可选择设备管理员 */
                        <select
                          value={(deviceForm as any)[f.key] || ''}
                          onChange={e => setDeviceForm({ ...deviceForm, [f.key]: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        >
                          <option value="">请选择</option>
                          {myProjectRole === '总体人员' && !isAdmin
                            ? /* 总体人员：只能选设备管理员 */
                              memberRoles
                                .filter(r => r.project_role === '设备管理员')
                                .map(r => (
                                  <option key={r.username} value={r.username}>{r.username}{employeeNameMap[r.username] ? ` (${employeeNameMap[r.username]})` : ''}</option>
                                ))
                            : /* admin：可选除总体人员之外的所有成员 */
                              projectMembers
                                .filter(m => !memberRoles.some(r => r.username === m && r.project_role === '总体人员'))
                                .map(m => (
                                  <option key={m} value={m}>{m}{employeeNameMap[m] ? ` (${employeeNameMap[m]})` : ''}</option>
                                ))
                          }
                        </select>
                      )
                    ) : f.key === '设备装机构型' ? (
                      <div className="border border-gray-300 rounded px-2 py-1.5 text-sm max-h-32 overflow-y-auto">
                        {projectConfigurations.length === 0 ? (
                          <span className="text-gray-400 text-xs">暂无构型，请先在项目管理中添加</span>
                        ) : (
                          projectConfigurations.map(c => {
                            const selected = ((deviceForm as any)['设备装机构型'] || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                            const checked = selected.includes(c.name);
                            return (
                              <label key={c.id} className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-gray-50">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => {
                                    const cur = ((deviceForm as any)['设备装机构型'] || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                                    const next = e.target.checked ? [...cur, c.name] : cur.filter((v: string) => v !== c.name);
                                    setDeviceForm({ ...deviceForm, '设备装机构型': next.join(',') });
                                  }}
                                  className="accent-violet-600"
                                />
                                <span>{c.name}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    ) : f.key === '设备部件所属系统（4位ATA）' ? (
                      <div className="flex gap-1">
                        <select
                          value={(() => {
                            const v = ((deviceForm as any)['设备部件所属系统（4位ATA）'] || '').trim();
                            if (v === 'N/A') return 'N/A';
                            const prefix = v.split('-')[0];
                            return ['21','23','24','25','27','30','31','32','33','34','42','45','46','52','86','90','92'].includes(prefix) ? prefix : '';
                          })()}
                          onChange={e => {
                            const sel = e.target.value;
                            if (sel === 'N/A') {
                              setDeviceForm({ ...deviceForm, '设备部件所属系统（4位ATA）': 'N/A' });
                              validateATA('N/A');
                            } else if (sel) {
                              setDeviceForm({ ...deviceForm, '设备部件所属系统（4位ATA）': sel });
                              validateATA(sel);
                            } else {
                              setDeviceForm({ ...deviceForm, '设备部件所属系统（4位ATA）': '' });
                              validateATA('');
                            }
                          }}
                          className="w-20 border border-gray-300 rounded px-1 py-1 text-sm flex-shrink-0"
                        >
                          <option value="">--</option>
                          {['21','23','24','25','27','30','31','32','33','34','42','45','46','52','86','90','92'].map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                          <option value="N/A">N/A</option>
                        </select>
                        <input
                          type="text"
                          value={(deviceForm as any)['设备部件所属系统（4位ATA）'] || ''}
                          onChange={e => {
                            setDeviceForm({ ...deviceForm, '设备部件所属系统（4位ATA）': e.target.value });
                            validateATA(e.target.value);
                          }}
                          onBlur={() => {
                            const v = ((deviceForm as any)['设备部件所属系统（4位ATA）'] || '').trim();
                            if (/^\d{2}$/.test(v)) {
                              const filled = `${v}-XX`;
                              setDeviceForm(prev => ({ ...prev, '设备部件所属系统（4位ATA）': filled }));
                              validateATA(filled);
                            }
                          }}
                          placeholder="如 42-XX"
                          className={`flex-1 border rounded px-2 py-1 text-sm ${fw ? (fw.type === 'error' ? 'border-red-400' : 'border-orange-400') : 'border-gray-300'}`}
                        />
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
                    ) : (f.key === '设备壳体是否金属' || f.key === '是否为选装设备' || f.key === '壳体接地是否故障电流路径' || f.key === '是否有特殊布线需求') ? (
                      <select
                        value={(deviceForm as any)[f.key] || ''}
                        onChange={e => setDeviceForm({ ...deviceForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        <option value="">请选择</option>
                        <option value="是">是</option>
                        <option value="否">否</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={(deviceForm as any)[f.key] || ''}
                        onChange={e => {
                          const newForm = { ...deviceForm, [f.key]: e.target.value };
                          setDeviceForm(newForm);
                        }}
                        onBlur={() => {
                          if (['设备编号', '设备中文名称', '设备LIN号（DOORS）', '设备编号（DOORS）'].includes(f.key as string)) {
                            checkDeviceDuplicates(deviceForm, editingDevice?.id);
                          }
                        }}
                        className={`w-full border rounded px-2 py-1 text-sm ${fw ? (fw.type === 'error' ? 'border-red-400' : 'border-orange-400') : 'border-gray-300'}`}
                      />
                    )}
                  </div>
                  );
                })}
              </div>
                );
              })()}
              {(() => {
                const hasHardError = Object.values(fieldWarnings).some(w => w.type === 'error');
                return (
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={closeDeviceModal} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={() => saveDevice(true)} className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600">保存为Draft</button>
                <button
                  onClick={() => saveDevice(false)}
                  disabled={hasHardError}
                  className={`px-4 py-2 rounded text-white ${hasHardError ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                  title={hasHardError ? '存在校验错误（红色标记），请先修正' : undefined}
                >
                  提交审批
                </button>
              </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── 连接器弹窗 ── */}
        {showConnectorModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">{editingConnector ? '编辑连接器' : '添加连接器'}</h2>
              {[
                { key: '设备端元器件编号', label: '设备端元器件编号 *' },
                { key: '设备端元器件名称及类型', label: '设备端元器件名称及类型' },
                { key: '设备端元器件件号类型及件号', label: '设备端元器件件号类型及件号' },
                { key: '设备端元器件供应商名称', label: '设备端元器件供应商名称' },
                { key: '匹配的线束端元器件件号', label: '匹配的线束端元器件件号' },
                { key: '匹配的线束线型', label: '匹配的线束线型' },
                { key: '尾附件件号', label: '尾附件件号' },
                { key: '触件型号', label: '触件型号' },
                { key: '设备端元器件匹配的元器件是否随设备交付', label: '设备端元器件匹配的元器件是否随设备交付' },
                { key: '备注', label: '备注' },
              ].map(f => {
                const isDeliverField = f.key === '设备端元器件匹配的元器件是否随设备交付';
                const deliverVal = isDeliverField ? String((connectorForm as any)[f.key] || '') : '';
                const deliverInvalid = isDeliverField && deliverVal !== '' && deliverVal !== '是' && deliverVal !== '否';
                return (
                <div key={f.key} className="mb-3">
                  <label className={`block text-xs mb-1 ${deliverInvalid ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                    {f.label.endsWith(' *') ? <>{f.label.slice(0, -2)}<span className="text-red-500"> *</span></> : f.label}
                    {deliverInvalid && <span className="ml-2 font-normal">（当前值：<span className="font-medium">{deliverVal}</span>）</span>}
                  </label>
                  {isDeliverField ? (
                    <select
                      value={deliverInvalid ? '' : deliverVal}
                      onChange={e => setConnectorForm({ ...connectorForm, [f.key]: e.target.value })}
                      className={`w-full border rounded px-2 py-1 text-sm bg-white ${deliverInvalid ? 'border-red-400' : 'border-gray-300'}`}
                    >
                      <option value="">请选择</option>
                      <option value="是">是</option>
                      <option value="否">否</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={(connectorForm as any)[f.key] || ''}
                      onChange={e => {
                        setConnectorForm({ ...connectorForm, [f.key]: e.target.value });
                      }}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    />
                  )}
                </div>
              ); })}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={closeConnectorModal} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={() => saveConnector(true)} className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600">保存为Draft</button>
                <button onClick={() => saveConnector(false)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">提交审批</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 断面连接器弹窗 ── */}
        {showSCModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm w-full">
              <h2 className="text-xl font-bold mb-4">{editingSC ? '编辑断面连接器' : '添加断面连接器'}</h2>
              <div className="mb-3">
                <label className="block text-xs text-gray-600 mb-1">设备名称 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={scForm['设备名称'] || ''}
                  onChange={e => setSCForm({ ...scForm, '设备名称': e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                  placeholder="请输入设备名称"
                />
              </div>
              <div className="mb-3">
                <label className="block text-xs text-gray-600 mb-1">负责人</label>
                {isAdmin ? (
                  <select
                    value={scForm['负责人'] || ''}
                    onChange={e => setSCForm({ ...scForm, '负责人': e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                  >
                    <option value="">请选择（仅限项目成员）</option>
                    {projectMembers.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-sm text-gray-700">
                    {scForm['负责人'] || '-'}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowSCModal(false)} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={saveSC} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 断面连接器-连接器弹窗 ── */}
        {showSCConnectorModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">{editingSCConnector ? '编辑连接器' : '添加连接器'}</h2>
              {[
                { key: '连接器号', label: '连接器号 *' },
                { key: '设备端元器件编号', label: '设备端元器件编号' },
                { key: '设备端元器件名称及类型', label: '设备端元器件名称及类型' },
                { key: '设备端元器件件号类型及件号', label: '设备端元器件件号类型及件号' },
                { key: '设备端元器件供应商名称', label: '设备端元器件供应商名称' },
                { key: '匹配的线束端元器件件号', label: '匹配的线束端元器件件号' },
                { key: '匹配的线束线型', label: '匹配的线束线型' },
                { key: '设备端元器件匹配的元器件是否随设备交付', label: '设备端元器件匹配的元器件是否随设备交付' },
                { key: '备注', label: '备注' },
              ].map(f => {
                const isDeliverField = f.key === '设备端元器件匹配的元器件是否随设备交付';
                return (
                  <div key={f.key} className="mb-3">
                    <label className="block text-xs text-gray-600 mb-1">
                      {f.label.endsWith(' *') ? <>{f.label.slice(0, -2)}<span className="text-red-500"> *</span></> : f.label}
                    </label>
                    {isDeliverField ? (
                      <select
                        value={String((scConnectorForm as any)[f.key] || '')}
                        onChange={e => setSCConnectorForm({ ...scConnectorForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                      >
                        <option value="">请选择</option>
                        <option value="是">是</option>
                        <option value="否">否</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={String((scConnectorForm as any)[f.key] || '')}
                        onChange={e => setSCConnectorForm({ ...scConnectorForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                    )}
                  </div>
                );
              })}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowSCConnectorModal(false)} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={saveSCConnector} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 断面连接器-针孔弹窗 ── */}
        {showSCPinModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm w-full">
              <h2 className="text-xl font-bold mb-4">{editingSCPin ? '编辑针孔' : '添加针孔'}</h2>
              {[
                { key: '针孔号', label: '针孔号 *' },
                { key: '端接尺寸', label: '端接尺寸' },
                { key: '屏蔽类型', label: '屏蔽类型' },
                { key: '备注', label: '备注' },
              ].map(f => (
                <div key={f.key} className="mb-3">
                  <label className="block text-xs text-gray-600 mb-1">
                    {f.label.endsWith(' *') ? <>{f.label.slice(0, -2)}<span className="text-red-500"> *</span></> : f.label}
                  </label>
                  <input
                    type="text"
                    value={String((scPinForm as any)[f.key] || '')}
                    onChange={e => setSCPinForm({ ...scPinForm, [f.key]: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                  />
                </div>
              ))}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowSCPinModal(false)} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={saveSCPin} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
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
                  <label className="block text-xs text-gray-600 mb-1">
                    {f.label.endsWith(' *') ? <>{f.label.slice(0, -2)}<span className="text-red-500"> *</span></> : f.label}
                  </label>
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
                <button onClick={() => savePin(true)} className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600">保存为Draft</button>
                <button onClick={() => savePin(false)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">提交审批</button>
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
                {/* Unique ID */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Unique ID <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={(signalForm as any).unique_id || ''}
                    onChange={e => setSignalForm({ ...signalForm, unique_id: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                  />
                </div>
                {/* 其余字段 */}
                {(() => {
                  const 成品线子字段: (keyof SignalRow)[] = ['成品线件号','成品线线规','成品线类型','成品线长度','成品线载流量','成品线线路压降','成品线标识','成品线与机上线束对接方式','成品线安装责任'];
                  const isY = (signalForm as any)['是否成品线'] === 'Y';
                  return SIGNAL_FIELDS.filter(f => {
                    if (f.key === 'unique_id') return false;
                    if (成品线子字段.includes(f.key) && !isY) return false;
                    return true;
                  }).map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-gray-600 mb-1">
                        {f.label}{(f.key === '连接类型' || f.key === '是否成品线') ? <span className="text-red-500"> *</span> : ''}
                      </label>
                      {f.key === '连接类型' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          {['ARINC 429', 'Discrete', 'CAN Bus', 'RS-422', 'RS-485', 'RS-232', '模拟量', '电源（低压）', '电源（高压）', '千兆网', '普通以太网', '光纤', '射频', '其他（在备注中说明）'].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : f.key === '是否成品线' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          {['Y', 'N'].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : f.key === '极性' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          <option value="正极">正极</option>
                          <option value="负极">负极</option>
                          <option value="地">地</option>
                          <option value="N/A">N/A</option>
                        </select>
                      ) : f.key === '接地代码' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          <option value="A">A：机架地，用于设备机架/壳体接地（Chassis ground）</option>
                          <option value="B">B：交流信号地，用于最大电流≤1A的交流信号接地（AC signal ground，≤1A）</option>
                          <option value="C">C：直流信号地，用于最大电流≤1A的直流信号接地（DC signal ground，≤1A）</option>
                          <option value="D">D：交流电源地，用于最大电流&gt;1A的交流电回路接地（AC power ground，&gt;1A）</option>
                          <option value="E">E：直流电源地，用于最大电流&gt;1A的直流电回路接地（DC power ground，&gt;1A）</option>
                          <option value="H">H：高频无线电设备电源地，用于高频系统电源回线接地（HFRE power ground）</option>
                          <option value="I">I：高频无线电设备信号地，用于高频系统信号线接地（HFRE signal ground）</option>
                          <option value="J">J：屏蔽地，导线屏蔽接地、EMI编织保护屏蔽接地（Shield Ground）</option>
                          <option value="其他">其他（在备注中说明）</option>
                        </select>
                      ) : f.key === '信号ATA' ? (
                        <div className="flex gap-1">
                          <select
                            value={(() => {
                              const v = ((signalForm as any)['信号ATA'] || '').trim();
                              if (v === 'N/A') return 'N/A';
                              const prefix = v.split('-')[0];
                              return ['21','23','24','25','27','30','31','32','33','34','42','45','46','52','86','90','92'].includes(prefix) ? prefix : '';
                            })()}
                            onChange={e => {
                              const sel = e.target.value;
                              if (sel === 'N/A') setSignalForm({ ...signalForm, 信号ATA: 'N/A' });
                              else if (sel) setSignalForm({ ...signalForm, 信号ATA: sel });
                              else setSignalForm({ ...signalForm, 信号ATA: '' });
                            }}
                            className="w-20 border border-gray-300 rounded px-1 py-1 text-sm flex-shrink-0"
                          >
                            <option value="">--</option>
                            {['21','23','24','25','27','30','31','32','33','34','42','45','46','52','86','90','92'].map(v => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                            <option value="N/A">N/A</option>
                          </select>
                          <input
                            type="text"
                            value={(signalForm as any)['信号ATA'] || ''}
                            onChange={e => setSignalForm({ ...signalForm, 信号ATA: e.target.value })}
                            onBlur={() => {
                              const v = ((signalForm as any)['信号ATA'] || '').trim();
                              if (/^\d{2}$/.test(v)) {
                                setSignalForm(prev => ({ ...prev, 信号ATA: `${v}-XX` }));
                              }
                            }}
                            placeholder="如 27-XX"
                            className={`flex-1 border rounded px-2 py-1 text-sm ${
                              (() => {
                                const v = ((signalForm as any)['信号ATA'] || '').trim();
                                return v && v !== 'N/A' && !/^\d{2}-(\d{2}|XX)$/.test(v) ? 'border-red-400' : 'border-gray-300';
                              })()
                            }`}
                          />
                        </div>
                      ) : (
                        <input type="text" value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
                      )}
                    </div>
                  ));
                })()}
              </div>

              {/* 信号端点构建器 */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium text-sm text-gray-700">信号端点</h3>
                  <button
                    onClick={() => {
                      setSignalEndpoints([...signalEndpoints, { 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '' }]);
                      setEpDeviceSearch(prev => [...prev, '']);
                      setEpDeviceResults(prev => [...prev, []]);
                      setEpConnectorOptions(prev => [...prev, []]);
                      setEpPinOptions(prev => [...prev, []]);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    + 添加端点
                  </button>
                </div>
                {signalEndpoints.map((ep, idx) => (
                  <div key={idx} className="mb-4 p-3 bg-gray-50 rounded border border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-gray-600">
                        端点 {idx + 1}
                        {ep.设备负责人 === user?.username
                          ? <span className="ml-1 text-blue-600">（我负责的设备）</span>
                          : ep.设备负责人
                            ? <span className="ml-1 text-gray-500">（{ep.设备负责人}）</span>
                            : null}
                        {ep.confirmed === 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 text-xs">待确认</span>}
                        {ep.confirmed === 1 && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs">已确认</span>}
                      </span>
                      {signalEndpoints.length > 1 && (
                        <button onClick={() => {
                          setSignalEndpoints(signalEndpoints.filter((_, i) => i !== idx));
                          setEpDeviceSearch(prev => prev.filter((_, i) => i !== idx));
                          setEpDeviceResults(prev => prev.filter((_, i) => i !== idx));
                          setEpConnectorOptions(prev => prev.filter((_, i) => i !== idx));
                          setEpPinOptions(prev => prev.filter((_, i) => i !== idx));
                        }} className="text-xs text-red-500">移除</button>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {/* 设备选择 */}
                      <div className="relative">
                        <label className="block text-xs text-gray-500 mb-0.5">设备编号</label>
                        <>
                          <input
                            type="text"
                            value={epDeviceSearch[idx] || ep.设备编号}
                            onChange={e => searchEpDevice(idx, e.target.value)}
                            onFocus={() => { if (!epDeviceSearch[idx] && !ep.设备编号) searchEpDevice(idx, ''); }}
                            placeholder="搜索设备..."
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                          />
                          {epDeviceResults[idx]?.length > 0 && (
                            <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded shadow-lg z-10 max-h-32 overflow-y-auto">
                              {epDeviceResults[idx].map(d => (
                                <button key={d.id} onClick={() => selectEpDevice(idx, d)}
                                  className={`w-full text-left px-2 py-1 text-xs hover:bg-blue-50 ${d.设备负责人 === user?.username ? 'font-medium text-blue-700' : ''}`}>
                                  {d.设备编号} {d.设备中文名称 ? `(${d.设备中文名称})` : ''}
                                  {d.设备负责人 === user?.username && <span className="ml-1 text-blue-400">★</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      </div>
                      {/* 设备负责人（只读） */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">设备负责人</label>
                        <div className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-xs text-gray-600 min-h-[26px]">
                          {ep.设备负责人 || '-'}
                          {ep.设备负责人 && employeeNameMap[ep.设备负责人] && <span className="text-gray-400 ml-1">({employeeNameMap[ep.设备负责人]})</span>}
                        </div>
                      </div>
                      {/* 连接器下拉 */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">设备端元器件编号</label>
                        <select
                          value={ep.设备端元器件编号}
                          onChange={async e => {
                            const conn = epConnectorOptions[idx].find(c => c.设备端元器件编号 === e.target.value);
                            if (conn) await selectEpConnector(idx, conn);
                            else { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 设备端元器件编号: e.target.value, 针孔号: '' }; setSignalEndpoints(newEp); }
                          }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        >
                          <option value="">选择连接器</option>
                          {(epConnectorOptions[idx] || []).map(c => <option key={c.id} value={c.设备端元器件编号}>{c.设备端元器件编号}</option>)}
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
                      <div className="col-span-4">
                        <label className="block text-xs text-gray-500 mb-0.5">端点信号名称</label>
                        <input
                          type="text"
                          value={ep.信号名称 || ''}
                          onChange={e => { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 信号名称: e.target.value }; setSignalEndpoints(newEp); }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        />
                      </div>
                      {/* 信号定义 */}
                      <div className="col-span-4">
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
                {/* 新建信号：保存为Draft + 提交 */}
                {!editingSignal && (
                  <button onClick={() => saveSignal(true)} className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600">保存为Draft</button>
                )}
                {/* 编辑草稿：保存为Draft + 提交 */}
                {editingSignal && editingSignal.status === 'Draft' && (
                  <button onClick={() => saveSignal(false, false)} className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600">保存为Draft</button>
                )}
                {/* 新建 / 草稿：提交按钮 */}
                {(!editingSignal || editingSignal.status === 'Draft') && (
                  <button
                    onClick={() => editingSignal ? saveSignal(false, true) : saveSignal(false)}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    提交
                  </button>
                )}
                {/* 编辑已有 Pending/Active 信号：保存为Draft + 保存 */}
                {editingSignal && editingSignal.status !== 'Draft' && (
                  <button onClick={() => saveSignal(true)} className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600">保存为Draft</button>
                )}
                {editingSignal && editingSignal.status !== 'Draft' && (
                  <button onClick={() => saveSignal()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {historyTarget && (
        <HistoryModal
          entityTable={historyTarget.entityTable}
          entityId={historyTarget.entityId}
          entityLabel={historyTarget.entityLabel}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {/* ATA导出模态框 */}
      {showAtaExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="text-base font-semibold">WB导出 — 按设备选择信号端点对</h3>
              <button onClick={() => setShowAtaExportModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-3 border-b flex items-center gap-3">
              <label className="text-sm text-gray-600 shrink-0">ATA前两位筛选：</label>
              <input
                type="text"
                placeholder="如：27"
                value={ataExportFilter}
                onChange={e => {
                  const v = e.target.value.trim();
                  setAtaExportFilter(v);
                  if (v) {
                    const matched = ataExportDevices
                      .filter(d => {
                        const ata = (d as any)['设备部件所属系统（4位ATA）'] || '';
                        return ata.startsWith(v);
                      })
                      .map(d => d.id);
                    setAtaExportSelectedIds(new Set(matched));
                  } else {
                    setAtaExportSelectedIds(new Set());
                  }
                }}
                className="border rounded px-2 py-1 text-sm w-24"
              />
              <span className="text-sm text-gray-500">
                已选 {ataExportSelectedIds.size} 台设备 / 共 {ataExportDevices.length} 台
              </span>
              <button
                onClick={() => setAtaExportSelectedIds(new Set(ataExportDevices.map(d => d.id)))}
                className="ml-auto text-xs text-blue-600 hover:underline"
              >全选</button>
              <button
                onClick={() => setAtaExportSelectedIds(new Set())}
                className="text-xs text-gray-500 hover:underline"
              >清空</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b">
                    <th className="py-1 w-8 text-left"></th>
                    <th className="py-1 text-left">设备编号</th>
                    <th className="py-1 text-left">设备LIN号</th>
                    <th className="py-1 text-left">ATA</th>
                    <th className="py-1 text-left">设备中文名称</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ataExportDevices].sort((a, b) => {
                    const ataA = ((a as any)['设备部件所属系统（4位ATA）'] || '').slice(0, 2);
                    const ataB = ((b as any)['设备部件所属系统（4位ATA）'] || '').slice(0, 2);
                    return ataA.localeCompare(ataB);
                  }).map(d => {
                    const ata = (d as any)['设备部件所属系统（4位ATA）'] || '';
                    const checked = ataExportSelectedIds.has(d.id);
                    return (
                      <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-0.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setAtaExportSelectedIds(prev => {
                                const next = new Set(prev);
                                if (checked) next.delete(d.id); else next.add(d.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="py-0.5">{(d as any)['设备编号'] || ''}</td>
                        <td className="py-0.5 font-mono">{(d as any)['设备LIN号（DOORS）'] || ''}</td>
                        <td className="py-0.5">{ata}</td>
                        <td className="py-0.5">{(d as any)['设备中文名称'] || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button onClick={() => setShowAtaExportModal(false)} className="px-4 py-1.5 text-sm border rounded hover:bg-gray-50">取消</button>
              <button
                disabled={ataExportSelectedIds.size === 0 || ataExportLoading}
                onClick={async () => {
                  if (!selectedProjectId || ataExportSelectedIds.size === 0) return;
                  setAtaExportLoading(true);
                  try {
                    const res = await fetch('/api/signals/export-pairs', {
                      method: 'POST',
                      headers: { ...API_HEADERS(), 'Content-Type': 'application/json' },
                      body: JSON.stringify({ projectId: selectedProjectId, deviceIds: Array.from(ataExportSelectedIds) }),
                    });
                    if (!res.ok) {
                      const e = await res.json();
                      alert(e.error || '导出失败');
                      return;
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `signal_pairs_export_${new Date().toISOString().slice(0,10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } finally {
                    setAtaExportLoading(false);
                  }
                }}
                className="px-4 py-1.5 text-sm bg-teal-600 text-white rounded hover:bg-teal-700 disabled:opacity-50"
              >
                {ataExportLoading ? '导出中...' : `导出CSV（${ataExportSelectedIds.size}台设备）`}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
