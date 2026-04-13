import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import HistoryModal from '../components/HistoryModal';
import EICDModal from '../components/EICDModal';
import SignalGroupModal from '../components/SignalGroupModal';
import type { Selection } from '../components/EICDDiagram';
import { useAuth } from '../context/AuthContext';

// ── 类型定义 ─────────────────────────────────────────────

interface Project { id: number; name: string; description?: string; }

interface DeviceRow {
  id: number; project_id: number;
  设备编号: string; 设备中文名称?: string; 设备英文名称?: string; 设备英文缩写?: string;
  设备供应商件号?: string; 设备供应商名称?: string; '设备部件所属系统（4位ATA）'?: string;
  设备安装位置?: string; 设备DAL?: string; 设备等级?: string;
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
  unique_id?: string; 信号名称摘要?: string; 连接类型?: string; 协议标识?: string; 信号ATA?: string;
  信号架次有效性?: string;
  推荐导线线规?: string; 推荐导线线型?: string;
  独立电源代码?: string; 敷设代码?: string; 电磁兼容代码?: string;
  线类型?: string;
  余度代码?: string; 功能代码?: string; 接地代码?: string; 极性?: string;
  额定电压?: string; 额定电流?: string; 设备正常工作电压范围?: string;
  是否成品线?: string; 成品线件号?: string; 成品线线规?: string; 成品线类型?: string;
  成品线长度?: string; 成品线载流量?: string; 成品线线路压降?: string; 成品线标识?: string;
  成品线与机上线束对接方式?: string; 成品线安装责任?: string; 备注?: string;
  endpoint_summary?: string;
  endpoint_count?: number;
  导线等级?: string | null;
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
  confirmed?: number; input?: number; output?: number;
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

const SPECIAL_ERN_LIN = '8800G0000';

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
  { key: '设备等级', label: '设备等级' },
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
  { key: '协议标识', label: '协议标识' },
  { key: '线类型', label: '线类型' },
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
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  // ── 视图切换 ──
  const [activeView, setActiveView] = useState<'devices' | 'signals' | 'section-connectors'>('devices');
  const [filterMode, setFilterMode] = useState<'all' | 'my' | 'related' | 'pending' | 'my_approval' | 'my_completion' | 'my_tasks' | 'networking'>('all');
  const [filterModeInitialized, setFilterModeInitialized] = useState(false);

  type ApprovalItem = { id: number; recipient_username: string; item_type: string; status: string; rejection_reason?: string; responded_at?: string; };
  type ApprovalInfo = { request: { id: number; current_phase: string; status: string; action_type: string; requester_username: string; created_at: string; old_payload?: string; payload?: string; project_name?: string; } | null; items: ApprovalItem[]; my_pending_item: ApprovalItem | null; };
  const [approvalInfoMap, setApprovalInfoMap] = useState<Record<string, ApprovalInfo>>({});

  const [projectConfigurations, setProjectConfigurations] = useState<{ id: number; name: string }[]>([]);

  // ── 设备视图状态 ──
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [statusSummary, setStatusSummary] = useState<{ devices: { normal: number; Draft: number }; connectors: { normal: number; Draft: number }; pins: { normal: number; Draft: number } } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ entityTable: string; entityId: number; entityLabel: string } | null>(null);
  const [eicdTarget, setEicdTarget] = useState<{ deviceId: number; projectId: number; label: string } | null>(null);
  const [signalGroupTarget, setSignalGroupTarget] = useState<{ groupName?: string; singleSignalId?: number; projectId: number; signalId: number } | null>(null);
  // ── 导航高亮行 ──
  const [highlightRow, setHighlightRow] = useState<{ type: 'device' | 'connector' | 'pin' | 'signal'; id: number } | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightRowRef = useCallback((node: HTMLTableRowElement | null) => {
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);
  // ── EICD 双击导航：分级闪动后展开 ──
  const flashThenExpand = useCallback((
    hlType: 'device' | 'connector' | 'pin' | 'signal',
    hlId: number,
    afterFlash: () => void,
  ) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightRow({ type: hlType, id: hlId });
    highlightTimerRef.current = setTimeout(() => {
      setHighlightRow(null);
      afterFlash();
    }, 3000); // 与 CSS 动画时长一致（3s）
  }, []);
  // ── 导航等待数据加载后闪动 ──
  const [pendingNav, setPendingNav] = useState<NonNullable<Selection> | null>(null);
  const [deviceFilters, setDeviceFilters] = useState<Record<string, string>>({});
  const [deviceSortOrder, setDeviceSortOrder] = useState<'desc' | 'asc'>('desc');
  const [signalSortOrder, setSignalSortOrder] = useState<'desc' | 'asc'>('desc');
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
  // ── 下载配置 ──
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  // ── 导入/更新设备数据弹窗 ──
  const [showImportDevDataModal, setShowImportDevDataModal] = useState(false);
  const [importDevFile, setImportDevFile] = useState<File | null>(null);
  const [importDevPhase, setImportDevPhase] = useState<'devices' | 'connectors'>('devices');
  const [importDevType, setImportDevType] = useState<'import' | 'update'>('import');
  const [importDevLoading, setImportDevLoading] = useState(false);
  const [importDevResult, setImportDevResult] = useState<any>(null);
  // ── 导入针孔弹窗 ──
  const [showImportPinModal, setShowImportPinModal] = useState(false);
  const [importPinFile, setImportPinFile] = useState<File | null>(null);
  const [importPinLoading, setImportPinLoading] = useState(false);
  const [importPinResult, setImportPinResult] = useState<any>(null);
  // ── 导入/更新信号数据弹窗 ──
  const [showImportSigModal, setShowImportSigModal] = useState(false);
  const [importSigType, setImportSigType] = useState<'import' | 'update'>('import');
  const [importSigFile, setImportSigFile] = useState<File | null>(null);
  const [importSigLoading, setImportSigLoading] = useState(false);
  const [importSigResult, setImportSigResult] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  // ── 信号分组：列表勾选模式 ──
  const [sgCheckMode, setSgCheckMode] = useState(false);
  const [sgCheckedIds, setSgCheckedIds] = useState<number[]>([]);
  const [sgCreating, setSgCreating] = useState(false);
  const [sgBlankType, setSgBlankType] = useState('');
  const [sgGroupFilter, setSgGroupFilter] = useState('');
  // ── 一键审批 ──
  const [batchApprovalIds, setBatchApprovalIds] = useState<number[]>([]);
  const [batchApproving, setBatchApproving] = useState(false);
  const DOWNLOAD_SHEETS = [
    { key: 'devices', name: 'ATA章节设备表', cols: [
      '设备编号', '设备编号（DOORS）', '设备LIN号（DOORS）', '设备中文名称', '设备英文名称', '设备英文缩写',
      '设备供应商件号', '设备供应商名称', '设备部件所属系统（4位ATA）',
      '设备安装位置', '设备DAL', '设备壳体是否金属', '金属壳体表面是否经过特殊处理而不易导电',
      '设备内共地情况', '设备壳体接地方式', '壳体接地是否故障电流路径',
      '其他接地特殊要求', '设备端连接器或接线柱数量', '是否为选装设备', '设备装机架次',
      '设备负责人', '设备正常工作电压范围（V）', '设备物理特性', '备注', '最后修改时间',
    ]},
    { key: 'connectors', name: '设备端元器件表', cols: [
      '设备编号', '设备LIN号（DOORS）', '设备名称', '设备端元器件编号', '设备端元器件名称及类型',
      '设备端元器件件号类型及件号', '设备端元器件供应商名称', '匹配的线束端元器件件号',
      '设备端元器件匹配的元器件是否随设备交付', '备注', '最后修改时间',
    ]},
    { key: 'signals', name: '电气接口数据表', cols: [
      'Unique ID', '连接类型',
      '设备（从）', 'LIN号（从）', '连接器（从）', '针孔号（从）', '端接尺寸（从）', '屏蔽类型（从）', '信号名称（从）', '信号定义（从）',
      '设备（到）', 'LIN号（到）', '连接器（到）', '针孔号（到）', '端接尺寸（到）', '屏蔽类型（到）', '信号名称（到）', '信号定义（到）',
      '推荐导线线规', '推荐导线线型', '独立电源代码', '敷设代码',
      '电磁兼容代码', '余度代码', '功能代码', '接地代码', '极性',
      '信号ATA', '信号架次有效性', '额定电压', '额定电流', '设备正常工作电压范围',
      '是否成品线', '成品线件号', '成品线线规', '成品线类型', '成品线长度',
      '成品线载流量', '成品线线路压降', '成品线标识', '成品线与机上线束对接方式',
      '成品线安装责任', '备注', '最后修改时间',
    ]},
    { key: 'adl', name: '全机设备清单', cols: [] },
  ];
  const [downloadSheets, setDownloadSheets] = useState<Record<string, boolean>>({ devices: true, connectors: true, signals: true, adl: true });
  const [downloadCols, setDownloadCols] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {};
    DOWNLOAD_SHEETS.forEach(s => { m[s.key] = new Set(s.cols); });
    return m;
  });

  const [signalTotal, setSignalTotal] = useState(0);
  const [expandedSignalId, setExpandedSignalId] = useState<number | null>(null);
  const [expandedEdgeEpIds, setExpandedEdgeEpIds] = useState<Set<number>>(new Set());
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
  const [deviceFormSnapshot, setDeviceFormSnapshot] = useState<string>('');
  const [fieldWarnings, setFieldWarnings] = useState<Record<string, { message: string; type: 'error' | 'warning' }>>({});

  // ── 连接器添加/编辑弹窗 ──
  const [showConnectorModal, setShowConnectorModal] = useState(false);
  const [connectorTargetDeviceId, setConnectorTargetDeviceId] = useState<number | null>(null);
  const [editingConnector, setEditingConnector] = useState<ConnectorRow | null>(null);
  const [connectorForm, setConnectorForm] = useState<Partial<ConnectorRow>>({});
  const [connectorFormSnapshot, setConnectorFormSnapshot] = useState<string>('');

  // ── 连接器合并弹窗 ──
  const [showMergeConnModal, setShowMergeConnModal] = useState(false);
  const [mergeConnDeviceId, setMergeConnDeviceId] = useState<number | null>(null);
  const [mergeConnTarget, setMergeConnTarget] = useState<number | ''>('');
  const [mergeConnSources, setMergeConnSources] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);

  // ── 针孔添加/编辑弹窗 ──
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinTargetConnectorId, setPinTargetConnectorId] = useState<number | null>(null);
  const [editingPin, setEditingPin] = useState<PinRow | null>(null);
  const [pinForm, setPinForm] = useState<Partial<PinRow>>({});
  const [pinFormSnapshot, setPinFormSnapshot] = useState<string>('');

  // ── 信号添加/编辑弹窗 ──
  const [showSignalModal, setShowSignalModal] = useState(false);
  const [editingSignal, setEditingSignal] = useState<SignalRow | null>(null);
  const [signalForm, setSignalForm] = useState<Partial<SignalRow>>({});
  const [signalFormSnapshot, setSignalFormSnapshot] = useState<string>('');
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
  }, [selectedProjectId, activeView, effectiveFilterKey, deviceSortOrder, signalSortOrder]);

  // 新通知到达时自动刷新当前视图数据
  const refreshDataRef = useRef(() => {});
  refreshDataRef.current = () => {
    if (!selectedProjectId) return;
    if (activeView === 'devices') loadDevices();
    else if (activeView === 'signals') loadSignals();
    else loadSectionConnectors();
  };
  useEffect(() => {
    const handler = () => refreshDataRef.current();
    window.addEventListener('new-notification', handler);
    return () => window.removeEventListener('new-notification', handler);
  }, []);

  // ── 导航等待数据加载后闪动 ──
  useEffect(() => {
    if (!pendingNav || loading) return;

    if (pendingNav.type === 'signal' && activeView === 'signals') {
      const idx = signals.findIndex(s => s.id === pendingNav.signalId);
      if (idx >= 0) {
        const targetId = signals[idx].id;
        setPendingNav(null);
        if (idx >= signalDisplayCount) {
          setSignalDisplayCount(idx + 50);
          // 等待 React 渲染出该行后再闪动
          setTimeout(() => {
            requestAnimationFrame(() => {
              flashThenExpand('signal', targetId, () => {
                setExpandedSignalId(targetId);
                loadSignalDetail(targetId, true);
              });
            });
          }, 50);
        } else {
          requestAnimationFrame(() => {
            flashThenExpand('signal', targetId, () => {
              setExpandedSignalId(targetId);
              loadSignalDetail(targetId, true);
            });
          });
        }
      }
    } else if (pendingNav.type === 'device' && activeView === 'devices') {
      const found = devices.find(d => d.id === pendingNav.deviceId);
      if (found) {
        setPendingNav(null);
        requestAnimationFrame(() => {
          flashThenExpand('device', found.id, async () => {
            setExpandedDeviceId(found.id);
            await loadConnectors(found.id);
          });
        });
      }
    } else if (pendingNav.type === 'connector' && activeView === 'devices') {
      const found = devices.find(d => d.id === pendingNav.deviceId);
      if (found) {
        setPendingNav(null);
        setExpandedDeviceId(found.id);
        loadConnectors(found.id).then(() => {
          requestAnimationFrame(() => {
            flashThenExpand('connector', pendingNav.connectorId, async () => {
              setExpandedConnectorId(pendingNav.connectorId);
              await loadPins(found.id, pendingNav.connectorId);
            });
          });
        });
      }
    } else if (pendingNav.type === 'pin' && activeView === 'devices') {
      const found = devices.find(d => d.id === pendingNav.deviceId);
      if (found) {
        setPendingNav(null);
        setExpandedDeviceId(found.id);
        loadConnectors(found.id).then(() => {
          setExpandedConnectorId(pendingNav.connectorId);
          loadPins(found.id, pendingNav.connectorId).then(() => {
            requestAnimationFrame(() => {
              flashThenExpand('pin', pendingNav.pinId, () => {});
            });
          });
        });
      }
    }
  }, [pendingNav, signals, devices, activeView, loading]);

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

  // 项目下拉点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setShowProjectDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
          // 锁轮询只刷新锁状态，不重新加载信号数据（避免与分页加载竞争）
          const lockRes = await fetch(`/api/data/locks?table_name=signals`, { headers: API_HEADERS() });
          if (lockRes.ok) { const d = await lockRes.json(); setSignalLockMap(d.locks || {}); }
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
      const sortQ = `&sortBy=updated_at&sortOrder=${deviceSortOrder}`;
      const res = await fetch(`/api/devices?projectId=${selectedProjectId}${myQ}${sortQ}`, { headers: API_HEADERS() });
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
    const baseUrl = `/api/signals?projectId=${selectedProjectId}${myQ}&sortBy=updated_at&sortOrder=${signalSortOrder}`;
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

  const handleApprove = async (approvalId: number, entityType: string, entityId: number, phase?: string) => {
    try {
      const endpoint = phase === 'completion' ? 'complete' : 'approve';
      const body = phase === 'completion' ? { updated_fields: {} } : {};
      const res = await fetch(`/api/approvals/${approvalId}/${endpoint}`, { method: 'POST', headers: API_JSON_HEADERS(), body: JSON.stringify(body) });
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
    // 系统组：默认负责人为自己；总体组/admin：不预设
    const defaultOwner = myProjectRole === '系统组' ? (user?.username || '') : '';
    // 默认选中所有构型
    const defaultConfigs = projectConfigurations.map(c => c.name).join(',');
    const initForm = { '设备负责人': defaultOwner, '设备装机构型': defaultConfigs };
    setDeviceForm(initForm);
    setDeviceFormSnapshot(JSON.stringify(initForm));
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
    setDeviceFormSnapshot(JSON.stringify({ ...device }));
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
    // 非 Draft 保存时，检查设备负责人和硬性校验错误
    if (!forceDraft) {
      if (!(deviceForm as any)['设备负责人']) { alert('设备负责人不能为空'); return; }
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
    try {
      // 先获取影响预览
      const impactRes = await fetch(`/api/devices/${device.id}/delete-impact`, { headers: API_HEADERS() });
      const impact = await impactRes.json();
      const lines = [`确定要删除设备 ${device.设备编号} 吗？\n\n将产生以下影响：`];
      lines.push(`- 删除 ${impact.connectors?.length || 0} 个连接器`);
      lines.push(`- 删除 ${impact.pins?.length || 0} 个针孔`);
      if (impact.signalsDeleted?.length > 0) lines.push(`- 整体删除 ${impact.signalsDeleted.length} 条信号：${impact.signalsDeleted.slice(0, 5).map((s: any) => s.unique_id || s.id).join('、')}${impact.signalsDeleted.length > 5 ? '...' : ''}`);
      if (impact.signalsModified?.length > 0) lines.push(`- 修改 ${impact.signalsModified.length} 条信号（移除端点）：${impact.signalsModified.slice(0, 5).map((s: any) => s.unique_id || s.id).join('、')}${impact.signalsModified.length > 5 ? '...' : ''}`);
      if (!confirm(lines.join('\n'))) return;

      const res = await fetch(`/api/devices/${device.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      await loadDevices();
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  const handleClaimManagement = async (device: DeviceRow) => {
    if (!confirm(`确认申请管理设备「${device.设备编号}」的权限？申请将发送给所有总体组审批。`)) return;
    try {
      const res = await fetch(`/api/devices/${device.id}/claim-management`, {
        method: 'POST',
        headers: API_HEADERS(),
      });
      if (!res.ok) throw new Error((await res.json()).error || '申请失败');
      alert('申请已提交，等待总体组审批。');
      await loadDevices();
    } catch (e: any) { alert(e.message || '申请失败'); }
  };

  // ── 连接器CRUD ────────────────────────────────────────────

  const openAddConnector = (deviceId: number) => {
    setConnectorTargetDeviceId(deviceId);
    setEditingConnector(null);
    const device = devices.find(d => d.id === deviceId);
    const lin = (device as any)?.['设备LIN号（DOORS）'];
    const initForm = lin ? { '设备端元器件编号': `${lin}-` } : {};
    setConnectorForm(initForm);
    setConnectorFormSnapshot(JSON.stringify(initForm));
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
    setConnectorFormSnapshot(JSON.stringify({ ...conn }));
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
    try {
      const impactRes = await fetch(`/api/devices/${deviceId}/connectors/${connector.id}/delete-impact`, { headers: API_HEADERS() });
      const impact = await impactRes.json();
      const lines = [`确定要删除连接器 ${connector.设备端元器件编号} 吗？\n\n将产生以下影响：`];
      lines.push(`- 删除 ${impact.pins?.length || 0} 个针孔`);
      if (impact.signalsDeleted?.length > 0) lines.push(`- 整体删除 ${impact.signalsDeleted.length} 条信号：${impact.signalsDeleted.slice(0, 5).map((s: any) => s.unique_id || s.id).join('、')}${impact.signalsDeleted.length > 5 ? '...' : ''}`);
      if (impact.signalsModified?.length > 0) lines.push(`- 修改 ${impact.signalsModified.length} 条信号（移除端点）：${impact.signalsModified.slice(0, 5).map((s: any) => s.unique_id || s.id).join('、')}${impact.signalsModified.length > 5 ? '...' : ''}`);
      if (!confirm(lines.join('\n'))) return;

      const res = await fetch(`/api/devices/${deviceId}/connectors/${connector.id}`, { method: 'DELETE', headers: API_HEADERS() });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      setDevices(prev => prev.map(d =>
        d.id === deviceId ? { ...d, connector_count: Math.max(0, (d.connector_count ?? 0) - 1) } : d
      ));
      await loadConnectors(deviceId, true);
    } catch (e: any) { alert(e.message || '删除失败'); }
  };

  const openMergeConnModal = (deviceId: number) => {
    setMergeConnDeviceId(deviceId);
    setMergeConnTarget('');
    setMergeConnSources(new Set());
    setShowMergeConnModal(true);
  };

  const executeMergeConnectors = async () => {
    if (!mergeConnDeviceId || !mergeConnTarget || mergeConnSources.size === 0) return;
    setMerging(true);
    try {
      const res = await fetch(`/api/devices/${mergeConnDeviceId}/connectors/merge`, {
        method: 'POST',
        headers: API_JSON_HEADERS(),
        body: JSON.stringify({ targetConnectorId: mergeConnTarget, sourceConnectorIds: [...mergeConnSources] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '合并失败');
      alert(`合并成功！迁移了 ${data.movedPins} 个针孔`);
      setShowMergeConnModal(false);
      await loadConnectors(mergeConnDeviceId, true);
    } catch (e: any) { alert(e.message || '合并失败'); }
    finally { setMerging(false); }
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
    setPinFormSnapshot(JSON.stringify({}));
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
    setPinFormSnapshot(JSON.stringify({ ...pin }));
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
      // 编辑已有针孔且非Draft时，检查关联信号
      if (editingPin && !forceDraft) {
        const impactRes = await fetch(
          `/api/devices/${connectorTargetDeviceId}/connectors/${pinTargetConnectorId}/pins/${editingPin.id}/related-signals`,
          { headers: API_HEADERS() }
        );
        if (impactRes.ok) {
          const { signals: relatedSigs } = await impactRes.json();
          if (relatedSigs && relatedSigs.length > 0) {
            const sigList = relatedSigs.slice(0, 10).map((s: any) => s.unique_id || `#${s.id}`).join('、');
            if (!confirm(`修改此针孔将影响 ${relatedSigs.length} 条信号：${sigList}${relatedSigs.length > 10 ? '...' : ''}\n\n修改将提交审批，确认继续？`)) return;
          }
        }
      }
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
    try {
      const impactRes = await fetch(`/api/devices/${deviceId}/connectors/${connectorId}/pins/${pin.id}/delete-impact`, { headers: API_HEADERS() });
      const impact = await impactRes.json();
      const lines = [`确定要删除针孔 ${pin.针孔号} 吗？`];
      if (impact.signalsDeleted?.length > 0 || impact.signalsModified?.length > 0) {
        lines.push('\n将产生以下影响：');
        if (impact.signalsDeleted?.length > 0) lines.push(`- 整体删除 ${impact.signalsDeleted.length} 条信号：${impact.signalsDeleted.map((s: any) => s.unique_id || s.id).join('、')}`);
        if (impact.signalsModified?.length > 0) lines.push(`- 修改 ${impact.signalsModified.length} 条信号（移除端点）：${impact.signalsModified.map((s: any) => s.unique_id || s.id).join('、')}`);
      }
      if (!confirm(lines.join('\n'))) return;

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
    const initForm = {};
    setSignalForm(initForm);
    setSignalFormSnapshot(JSON.stringify({ form: initForm, endpoints: [
      { 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
      { 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '' },
    ]}));
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
    // 构建 endpoint_id → endpoint_index 映射，用于将 edges 转换为 _edgeDirection/_edgeTarget
    const epIdToIdx: Record<number, number> = {};
    freshEndpoints.forEach((e: any) => { if (e.id) epIdToIdx[e.id] = e.endpoint_index; });
    const freshEdges: any[] = freshSignal.edges || [];

    const epList: SignalEndpoint[] = freshEndpoints.length > 0
      ? freshEndpoints.map((e: any, idx: number) => {
          let _edgeDirection = 'N/A';
          let _edgeTarget = 0;
          if (idx > 0 && e.id) {
            // 查找涉及此端点的 edge
            const edgeAsTo = freshEdges.find((ed: any) => ed.to_endpoint_id === e.id);
            const edgeAsFrom = freshEdges.find((ed: any) => ed.from_endpoint_id === e.id);
            if (edgeAsTo && edgeAsTo.direction === 'bidirectional') {
              _edgeDirection = 'BI-DIR';
              _edgeTarget = epIdToIdx[edgeAsTo.from_endpoint_id] ?? 0;
            } else if (edgeAsTo) {
              // from → this: this is INPUT
              _edgeDirection = 'INPUT';
              _edgeTarget = epIdToIdx[edgeAsTo.from_endpoint_id] ?? 0;
            } else if (edgeAsFrom && edgeAsFrom.direction === 'bidirectional') {
              _edgeDirection = 'BI-DIR';
              _edgeTarget = epIdToIdx[edgeAsFrom.to_endpoint_id] ?? 0;
            } else if (edgeAsFrom) {
              // this → to: this is OUTPUT
              _edgeDirection = 'OUTPUT';
              _edgeTarget = epIdToIdx[edgeAsFrom.to_endpoint_id] ?? 0;
            }
          }
          return {
            设备编号: e.设备编号 || '',
            设备端元器件编号: e.设备端元器件编号 || '',
            针孔号: e.针孔号 || '',
            端接尺寸: e.pin_端接尺寸 || '',
            屏蔽类型: e.pin_屏蔽类型 || '',
            信号名称: e.信号名称 || '',
            信号定义: e.信号定义 || '',
            设备负责人: e.设备负责人 || '',
            confirmed: e.confirmed,
            input: e.input ?? 0,
            output: e.output ?? 0,
            _edgeDirection,
            _edgeTarget,
          };
        })
      : [{ 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '', 设备负责人: '', input: 0, output: 0 }];
    setSignalEndpoints(epList);
    setSignalFormSnapshot(JSON.stringify({ form: { ...freshSignal }, endpoints: epList }));
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
      if (isAdmin && !editingSignal && !sf.unique_id?.trim()) { alert('Unique ID 不能为空'); return; }
      if (!sf['是否成品线']) { alert('是否成品线不能为空'); return; }
    } else {
      if (isAdmin && !sf.unique_id?.trim()) { alert('草稿也需要填写 Unique ID'); return; }
    }
    // 电磁兼容代码 X 必须搭配 ESS 敷设代码
    if (sf['电磁兼容代码'] === 'X' && sf['敷设代码'] !== 'ESS') {
      alert(`电引爆线路（电磁兼容代码 X）必须标注为 ESS 重要线路，当前敷设代码为 ${sf['敷设代码'] || '（未填写）'}，请修改。`);
      return;
    }
    // EFC/ESS 线路建议填写功能代码
    if ((sf['敷设代码'] === 'EFC' || sf['敷设代码'] === 'ESS') && !sf['功能代码']?.trim()) {
      const proceed = window.confirm(`当前信号敷设代码为 ${sf['敷设代码']}，属于取证线路，建议填写功能代码（来源于系统安全性分析）。\n\n是否仍要继续保存？`);
      if (!proceed) return;
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

  // 系统组默认显示"己方设备"，其他角色默认"全部"
  if (!filterModeInitialized && myProjectRole) {
    setFilterModeInitialized(true);
    if (myProjectRole === '系统组') setFilterMode('my');
  }

  const isReadOnly = myProjectRole === '其他组';
  const canExport = isAdmin || myProjectRole === '总体组' || myProjectRole === '系统组' || myProjectRole === '供应商组';
  const canManageDevices = isAdmin || myProjectRole === '总体组';
  const canManageSignals = isAdmin || myProjectRole === 'EWIS管理员' || myProjectRole === '系统组';
  // 总体组可编辑任意设备/连接器；系统组不可编辑设备/连接器
  const canEditDevice = (device: DeviceRow) => {
    if (isReadOnly) return false;
    if (isAdmin || myProjectRole === '总体组') return true;
    return false;
  };
  // 针孔操作：仅 admin 和系统组（自己负责的设备），总体组不可操作针孔
  const canEditPin = (device: DeviceRow) => {
    if (isAdmin) return true;
    if (myProjectRole === '系统组' && device.设备负责人 === user?.username) return true;
    return false;
  };
  const canDeleteSignal = (signal: SignalRow) => !isReadOnly && (isAdmin || signal.can_edit === true);

  // ── 渲染：设备视图 ────────────────────────────────────────

  const renderDeviceView = () => (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-3 shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold whitespace-nowrap">
            设备列表（{devices.length} 台 / 连接器共 {devices.reduce((s, d) => s + (d.connector_count ?? 0), 0)} 个）
          </h2>
          {statusSummary && (
            <div className="flex gap-2 text-xs whitespace-nowrap">
              <span className="px-2 py-0.5 rounded bg-green-50 text-green-700">
                设备: {statusSummary.devices.normal} 正常{statusSummary.devices.Draft > 0 && <>, <span className="text-yellow-600">{statusSummary.devices.Draft} Draft</span></>}
              </span>
              <span className="px-2 py-0.5 rounded bg-black/[0.03] dark:bg-white/[0.06] text-black dark:text-white">
                连接器: {statusSummary.connectors.normal} 正常{statusSummary.connectors.Draft > 0 && <>, <span className="text-yellow-600">{statusSummary.connectors.Draft} Draft</span></>}
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700">
                针孔: {statusSummary.pins.normal} 正常{statusSummary.pins.Draft > 0 && <>, <span className="text-yellow-600">{statusSummary.pins.Draft} Draft</span></>}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {isAdmin && (
            <button
              onClick={async () => {
                if (!selectedProjectId) return;
                if (!confirm('确定要清空当前项目的全部设备及连接器数据吗？（ERN设备将保留）此操作不可恢复！')) return;
                const res = await fetch(`/api/devices/project/${selectedProjectId}/all`, { method: 'DELETE', headers: API_HEADERS() });
                if (res.ok) { await loadDevices(); }
                else { alert((await res.json()).error || '清空失败'); }
              }}
              className="bg-red-500 text-white px-3 py-1.5 rounded-pill text-sm hover:bg-red-600 whitespace-nowrap"
            >清空设备视图数据</button>
          )}
          {(isAdmin || myProjectRole === '系统组') && (
            <button
              onClick={() => { setImportPinFile(null); setImportPinResult(null); setShowImportPinModal(true); }}
              className="btn-secondary text-sm whitespace-nowrap"
            >导入针孔数据</button>
          )}
          {canManageDevices && (
            <>
              <button
                onClick={() => { setImportDevFile(null); setImportDevResult(null); setShowImportDevDataModal(true); }}
                className="btn-secondary text-sm whitespace-nowrap"
              >导入设备和连接器数据</button>
              <button id="tour-add-device" onClick={openAddDevice} className="btn-primary text-sm whitespace-nowrap">
                + 添加设备
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      {loading ? (
        <div className="text-center py-8 text-gray-500 dark:text-white/50">加载中...</div>
      ) : devices.length === 0 ? (
        <div className="text-center py-8 text-gray-400 dark:text-white/40">暂无设备数据</div>
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
        <div className="bg-white dark:bg-neutral-900 rounded-lg shadow">
          <table className="text-sm table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
            <colgroup>
              <col style={{ width: 32 }} />{/* 勾选框 */}
              <col style={{ width: 40 }} />{/* 展开 */}
              <col style={{ width: 200 }} />{/* 设备编号 */}
              <col style={{ width: 100 }} />{/* 构型 */}
              <col style={{ width: 200 }} />{/* 状态 */}
              <col style={{ width: 150 }} />{/* LIN号 */}
              <col style={{ width: 250 }} />{/* 设备中文名称 */}
              <col style={{ width: 100 }} />{/* ATA */}
              <col style={{ width: 50 }} />{/* DAL */}
              <col style={{ width: 50 }} />{/* 等级 */}
              <col style={{ width: 150 }} />{/* 设备负责人 */}
              <col style={{ width: 60 }} />{/* 连接器数 */}
              <col style={{ width: 120 }} />{/* 最后更新 */}
              <col style={{ width: 130 }} />{/* 操作 */}
              <col />{/* 右侧弹性占位 */}
            </colgroup>
            <thead className="bg-gray-50 dark:bg-neutral-800 sticky top-0 z-10">
              <tr>
                <th className="px-1 py-2"></th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50"></th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">设备编号</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">构型</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">状态</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">设备LIN号（DOORS）</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">设备中文名称</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">ATA（前2位筛选）</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">DAL</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">等级</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">设备负责人</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">连接器数</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50 cursor-pointer select-none hover:text-black dark:hover:text-white"
                  onClick={() => setDeviceSortOrder(o => o === 'desc' ? 'asc' : 'desc')}>
                  最后更新 {deviceSortOrder === 'desc' ? '▼' : '▲'}
                </th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">操作</th>
                <th></th>
              </tr>
              <tr className="bg-white dark:bg-neutral-900 border-b">
                <th className="px-1 py-1"></th>
                <th className="px-2 py-1"></th>
                {['设备编号'].map(col => (
                  <th key={col} className="px-2 py-1 max-w-[90px]">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="筛选..."
                        value={deviceFilters[col] || ''}
                        onChange={e => setDeviceFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        className="w-full px-1.5 py-0.5 pr-5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black"
                      />
                      {deviceFilters[col] && (
                        <button onClick={() => setDeviceFilters(prev => ({ ...prev, [col]: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:text-white/60 text-xs leading-none">&times;</button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-2 py-1 max-w-[80px]">
                  <div className="relative">
                    <button
                      onClick={() => setConfigFilterOpen(o => !o)}
                      className={`w-full px-1.5 py-0.5 text-xs border rounded text-left flex items-center justify-between gap-1 ${configFilterSelected.length > 0 ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-300 dark:border-white/20 bg-white dark:bg-neutral-900 text-gray-600 dark:text-white/60'}`}
                    >
                      <span className="truncate">{configFilterSelected.length === 0 ? '所有' : configFilterSelected.length === projectConfigurations.length ? '所有' : `已选 ${configFilterSelected.length} 个`}</span>
                      {configFilterSelected.length > 0 && (
                        <span onMouseDown={e => { e.stopPropagation(); setConfigFilterSelected([]); }} className="text-violet-400 hover:text-violet-600 leading-none flex-shrink-0">×</span>
                      )}
                    </button>
                    {configFilterOpen && (
                      <div className="absolute top-full left-0 mt-0.5 z-30 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded shadow-lg min-w-[220px] whitespace-nowrap">
                        <label className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 dark:hover:bg-white/[0.04] cursor-pointer border-b border-gray-100 dark:border-white/10">
                          <input
                            type="checkbox"
                            checked={configFilterSelected.length === projectConfigurations.length && projectConfigurations.length > 0}
                            onChange={e => setConfigFilterSelected(e.target.checked ? projectConfigurations.map(c => c.name) : [])}
                            className="accent-violet-600"
                          />
                          <span className="text-xs font-medium text-gray-600 dark:text-white/60">全选</span>
                        </label>
                        {projectConfigurations.map((c, idx) => {
                          const n = idx + 1;
                          const circled = n <= 20 ? String.fromCodePoint(0x245F + n) : n <= 35 ? String.fromCodePoint(0x323C + n) : `(${n})`;
                          return (
                          <label key={c.id} className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 dark:hover:bg-white/[0.04] cursor-pointer">
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
                        <div className="border-t border-gray-100 dark:border-white/10 px-2 py-1">
                          <button onClick={() => setConfigFilterOpen(false)} className="text-xs text-gray-400 dark:text-white/40 hover:text-gray-600 dark:text-white/60 w-full text-right">关闭</button>
                        </div>
                      </div>
                    )}
                  </div>
                </th>
                <th className="px-2 py-1">
                  <select
                    value={deviceFilters['_status'] || ''}
                    onChange={e => setDeviceFilters(prev => ({ ...prev, _status: e.target.value }))}
                    className="w-full px-1 py-0.5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black dark:focus:border-white bg-white dark:bg-neutral-800 dark:text-white"
                  >
                    <option value="">全部状态</option>
                    <option value="Draft">Draft</option>
                    <option value="Pending">审批中</option>
                    <option value="normal">已生效</option>
                    <option value="sub_pending">子项待审批/完善</option>
                  </select>
                </th>
                {['设备LIN号（DOORS）', '设备中文名称', '设备部件所属系统（4位ATA）', '设备DAL'].map(col => {
                  const isDAL = col === '设备DAL';
                  const isATA = col === '设备部件所属系统（4位ATA）';
                  const isLIN = col === '设备LIN号（DOORS）';
                  return (
                  <th key={col} className={`px-2 py-1 ${isDAL ? 'max-w-[60px]' : isATA ? 'max-w-[70px]' : isLIN ? 'max-w-[100px]' : ''}`}>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="筛选..."
                        value={deviceFilters[col] || ''}
                        onChange={e => setDeviceFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        className="w-full px-1 py-0.5 pr-5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black"
                      />
                      {deviceFilters[col] && (
                        <button onClick={() => setDeviceFilters(prev => ({ ...prev, [col]: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:text-white/60 text-xs leading-none">&times;</button>
                      )}
                    </div>
                  </th>
                  );
                })}
                <th className="px-2 py-1 max-w-[50px]">
                  <select
                    value={deviceFilters['设备等级'] || ''}
                    onChange={e => setDeviceFilters(prev => ({ ...prev, '设备等级': e.target.value }))}
                    className="w-full px-1 py-0.5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black dark:focus:border-white bg-white dark:bg-neutral-800 dark:text-white"
                  >
                    <option value="">全部</option>
                    {['1级', '2级', '3级', '4级', '5级'].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </th>
                {['设备负责人'].map(col => {
                  const narrow = true;
                  return (
                  <th key={col} className={`px-2 py-1 ${narrow ? 'max-w-[80px]' : ''}`}>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="筛选..."
                        value={deviceFilters[col] || ''}
                        onChange={e => setDeviceFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        className="w-full px-1 py-0.5 pr-5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black"
                      />
                      {deviceFilters[col] && (
                        <button onClick={() => setDeviceFilters(prev => ({ ...prev, [col]: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:text-white/60 text-xs leading-none">&times;</button>
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
                      className="w-full px-1 py-0.5 pr-5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black"
                    />
                    {deviceFilters['connector_count'] && (
                      <button onClick={() => setDeviceFilters(prev => ({ ...prev, connector_count: '' }))}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:text-white/60 text-xs leading-none">&times;</button>
                    )}
                  </div>
                </th>
                <th className="px-4 py-1"></th>
                <th className="px-4 py-1">
                    {hasAnyFilter && (
                      <button onClick={() => setDeviceFilters({})} className="text-xs text-gray-400 dark:text-white/40 hover:text-red-500">全部清除</button>
                    )}
                  </th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {filteredDevices.map((device, index) => {
                const isExpanded = expandedDeviceId === device.id;
                const lock = lockMap[device.id];
                return (
                  <React.Fragment key={device.id}>
                    <tr
                      ref={highlightRow?.type === 'device' && highlightRow.id === device.id ? highlightRowRef : undefined}
                      className={`${highlightRow?.type === 'device' && highlightRow.id === device.id ? 'animate-highlight-row' : `hover:bg-gray-50 dark:hover:bg-white/[0.04] ${hasTodo(device) ? 'bg-orange-100' : isExpanded ? 'bg-black/[0.03] dark:bg-white/[0.06]' : ''}`} cursor-pointer`}
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
                      <td className="px-1 py-2 text-center w-8">
                        {filterMode === 'my_tasks' && (() => {
                          // 收集该设备相关的所有可审批 request_ids（自身 + 子项）
                          const ids: number[] = [];
                          if (device.pending_item_type === 'approval' && (device as any).approval_request_id) ids.push((device as any).approval_request_id);
                          const subIds: number[] = (device as any).sub_approval_request_ids || [];
                          ids.push(...subIds);
                          if (ids.length === 0) return null;
                          const allChecked = ids.every(id => batchApprovalIds.includes(id));
                          return (
                            <input
                              type="checkbox"
                              checked={allChecked}
                              onChange={e => {
                                e.stopPropagation();
                                if (e.target.checked) setBatchApprovalIds(prev => [...new Set([...prev, ...ids])]);
                                else setBatchApprovalIds(prev => prev.filter(id => !ids.includes(id)));
                              }}
                              className="rounded border-gray-300 dark:border-white/20"
                            />
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <div className="flex items-end justify-center gap-1">
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
                            className="text-gray-400 dark:text-white/40 hover:text-black dark:hover:text-white font-mono text-xs leading-none"
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          <button
                            onClick={() => setEicdTarget({
                              deviceId: device.id,
                              projectId: device.project_id,
                              label: `${device.设备编号}${device.设备中文名称 ? ' (' + device.设备中文名称 + ')' : ''}`
                            })}
                            className="text-gray-400 dark:text-white/40 hover:text-black dark:hover:text-white leading-none"
                            title="查看EICD连接图"
                          >
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style={{ display: 'block', position: 'relative', top: '1px' }}><path d="M8 3C4.5 3 1.7 5.3.5 8c1.2 2.7 4 5 7.5 5s6.3-2.3 7.5-5c-1.2-2.7-4-5-7.5-5zm0 8.3c-1.8 0-3.3-1.5-3.3-3.3S6.2 4.7 8 4.7s3.3 1.5 3.3 3.3-1.5 3.3-3.3 3.3zM8 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-2 font-medium text-sm max-w-[90px] truncate" title={device.设备编号}>{device.设备编号}</td>
                      <td className="px-2 py-2 text-sm max-w-[80px]">
                        {projectConfigurations.length === 0
                          ? <span className="text-gray-300 dark:text-white/30">—</span>
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
                            <span className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/15 text-black dark:text-white text-xs font-semibold">审批中</span>
                            {device.pending_item_type === 'approval' && <span className="ml-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-xs">待我审批</span>}
                            {device.pending_item_type === 'completion' && <span className="ml-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-xs">待我完善</span>}
                          </>
                        )}
                        {device.status === 'normal' && (
                          <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs font-semibold">已生效</span>
                        )}
                        {device.has_pending_sub && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 text-xs" title="包含待审批的连接器或针孔">
                            子项待审批
                          </span>
                        )}
                        {device.management_claim_requester && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700 text-xs border border-yellow-200">
                            {device.management_claim_requester} 正在申请管理此设备
                          </span>
                        )}
                        {/* 已导入/已更新标签暂时隐藏 */}
                      </td>
                      <td className="px-2 py-2 text-gray-600 dark:text-white/60 text-sm max-w-[100px] truncate" title={device['设备LIN号（DOORS）'] || '-'}>{device['设备LIN号（DOORS）'] || '-'}</td>
                      <td className="px-2 py-2 text-gray-700 dark:text-white/70 text-sm">{device.设备中文名称 || '-'}</td>
                      <td className="px-2 py-2 text-gray-600 dark:text-white/60 text-sm max-w-[70px] truncate" title={device['设备部件所属系统（4位ATA）'] || '-'}>{device['设备部件所属系统（4位ATA）'] || '-'}</td>
                      <td className="px-2 py-2 text-gray-600 dark:text-white/60 text-sm max-w-[60px] truncate" title={device.设备DAL || '-'}>{device.设备DAL || '-'}</td>
                      <td className="px-2 py-2 text-gray-600 dark:text-white/60 text-sm max-w-[50px] text-center">{device.设备等级 || '-'}</td>
                      <td className="px-2 py-2 text-gray-600 dark:text-white/60 text-sm max-w-[80px] truncate" title={`${device.设备负责人 || '-'}${device.设备负责人姓名 ? ` (${device.设备负责人姓名})` : ''}`}>
                        {device.设备负责人 || '-'}
                        {device.设备负责人姓名 && <span className="text-gray-400 dark:text-white/40 ml-1">({device.设备负责人姓名})</span>}
                      </td>
                      <td className="px-2 py-2 text-gray-600 dark:text-white/60 text-sm text-center max-w-[60px]">{device.connector_count ?? 0}</td>
                      <td className="px-2 py-2 text-gray-400 dark:text-white/40 text-xs max-w-[90px] truncate">{(device as any).updated_at ? new Date((device as any).updated_at).toLocaleDateString() : '-'}</td>
                      <td className="px-2 py-2 space-x-2 whitespace-nowrap w-[130px]">
                        {(() => {
                          const isERN = (device as any)['设备LIN号（DOORS）'] === SPECIAL_ERN_LIN;
                          if (isERN) return <span className="text-xs text-gray-400 dark:text-white/40">固有ERN</span>;
                          return (<>
                          {canEditDevice(device) && (device.status === 'Pending' ? (
                            <span className="text-xs text-gray-400 dark:text-white/40 cursor-not-allowed" title="记录审批中，不可编辑">编辑/删除</span>
                          ) : lock ? (
                            <span className="text-xs text-amber-600">🔒{lock.lockedBy}</span>
                          ) : (
                            <>
                              <button id={index === 0 ? 'tour-device-edit' : undefined} onClick={() => openEditDevice(device)} className="text-black dark:text-white hover:text-black/60 dark:hover:text-white/60 text-xs">编辑</button>
                              <button onClick={() => deleteDevice(device)} className="text-red-600 hover:text-red-800 text-xs">删除</button>
                            </>
                          ))}
                          {myProjectRole === '系统组' && !device.设备负责人 && !device.management_claim_requester && (
                            <button onClick={() => handleClaimManagement(device)} className="text-purple-600 hover:text-purple-800 text-xs">申请管理权限</button>
                          )}
                          <button onClick={() => setHistoryTarget({ entityTable: 'devices', entityId: device.id, entityLabel: `设备 ${device.设备编号}` })} className="text-gray-500 dark:text-white/50 hover:text-gray-700 dark:text-white/70 text-xs">历史</button>
                          </>);
                        })()}
                        </td>
                        <td></td>
                    </tr>

                    {isExpanded && (
                      <>
                    {/* 设备详情 */}
                    <tr>
                      <td colSpan={15} className="px-0 py-0 bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-white/10">
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
                                  <thead><tr className="text-gray-500 dark:text-white/50"><th className="pr-4 text-left font-medium">字段</th><th className="pr-4 text-left font-medium">原值</th><th className="text-left font-medium">新值</th></tr></thead>
                                  <tbody>
                                    {keys.map(k => (
                                      <tr key={k} className="border-t border-purple-100">
                                        <td className="pr-4 py-0.5 text-gray-600 dark:text-white/60">{k}</td>
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
                          <div className="text-xs font-semibold text-gray-600 dark:text-white/60 mb-2">设备详细信息</div>
                          <div className="grid grid-cols-4 gap-x-8 gap-y-1.5 text-xs">
                            {(() => {
                              const ve = parseValidationErrors(device.validation_errors);
                              const isERN = (device as any)['设备LIN号（DOORS）'] === SPECIAL_ERN_LIN;
                              return DEVICE_FIELDS.map(f => {
                                // 导入来源为空时不显示
                                if (f.key === '导入来源' && !(device as any)['导入来源']) return null;
                                const val = (device as any)[f.key];
                                // 固有ERN设备：空字段不显示
                                if (isERN && !val) return null;
                                const fk = String(f.key);
                                const isErr = ve.fields.includes(fk);
                                return (
                                  <div key={fk} className="flex gap-1 min-w-0">
                                    <span className={`shrink-0 ${isErr ? 'text-red-600 font-medium' : 'text-gray-400 dark:text-white/40'}`}>{f.label}：</span>
                                    <span className={`truncate ${isErr ? 'text-red-600 font-medium' : 'text-gray-800 dark:text-white'}`}
                                      title={val || undefined}>
                                      {val || '-'}
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
                          <td colSpan={13} className="px-0 py-0 bg-yellow-50 border-b border-yellow-200">
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
                                let deleteImpact: any = null;
                                let connRenames: any = null;
                                try {
                                  const oldObj = request.old_payload ? JSON.parse(request.old_payload) : {};
                                  const newObj = request.payload ? JSON.parse(request.payload) : {};
                                  if (newObj._deleteImpact) deleteImpact = newObj._deleteImpact;
                                  connRenames = newObj._connector_renames;
                                  for (const key of Object.keys(newObj)) {
                                    if (key === '_deleteImpact' || key === '_connector_renames') continue;
                                    const ov = oldObj[key] ?? '';
                                    const nv = newObj[key] ?? '';
                                    if (String(ov) !== String(nv)) {
                                      diffRows.push({ key, oldVal: String(ov || '（空）'), newVal: String(nv || '（空）') });
                                    }
                                  }
                                } catch {}
                                return (
                                  <>
                                    {request.project_name && (
                                      <div className="text-xs text-black dark:text-white font-medium mb-1">项目：{request.project_name}</div>
                                    )}
                                    <div className="text-xs font-semibold text-gray-600 dark:text-white/60 mb-2">审批进度（{actionLabel}）</div>
                                    {deleteImpact && (
                                      <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
                                        <div className="font-medium mb-1">删除影响：</div>
                                        {deleteImpact.connectors?.length > 0 && <div>删除 {deleteImpact.connectors.length} 个连接器</div>}
                                        {deleteImpact.pins?.length > 0 && <div>删除 {deleteImpact.pins.length} 个针孔</div>}
                                        {deleteImpact.signalsDeleted?.length > 0 && (
                                          <div>整体删除 {deleteImpact.signalsDeleted.length} 条信号：{deleteImpact.signalsDeleted.slice(0, 5).map((s: any) => s.unique_id || `#${s.id}`).join('、')}{deleteImpact.signalsDeleted.length > 5 ? '...' : ''}</div>
                                        )}
                                        {deleteImpact.signalsModified?.length > 0 && (
                                          <div>移除端点 {deleteImpact.signalsModified.length} 条信号：{deleteImpact.signalsModified.slice(0, 5).map((s: any) => `${s.unique_id || '#' + s.id}（减少${s.removedEndpoints}个端点）`).join('、')}{deleteImpact.signalsModified.length > 5 ? '...' : ''}</div>
                                        )}
                                      </div>
                                    )}
                                    {connRenames?.length > 0 && (
                                      <div className="mb-2 text-xs text-black dark:text-white bg-black/[0.03] dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 rounded p-2">
                                        <div className="font-medium mb-1">LIN号变更将自动重命名 {connRenames.length} 个连接器：</div>
                                        {connRenames.slice(0, 10).map((r: any, ri: number) => (
                                          <div key={ri}><span className="line-through text-red-500">{r.old}</span> → <span className="text-green-700 font-medium">{r.new}</span></div>
                                        ))}
                                        {connRenames.length > 10 && <div className="text-gray-500 dark:text-white/50">...及其他 {connRenames.length - 10} 个</div>}
                                      </div>
                                    )}
                                    {diffRows.length > 0 && (
                                      <div className="mb-2 text-xs border border-gray-200 dark:border-white/10 rounded overflow-hidden">
                                        <div className="bg-gray-100 px-2 py-1 font-medium text-gray-500 dark:text-white/50">变更内容</div>
                                        <table className="w-full">
                                          <tbody>
                                            {diffRows.map(({ key, oldVal, newVal }) => (
                                              <tr key={key} className="border-t border-gray-100 dark:border-white/10">
                                                <td className="px-2 py-1 text-gray-500 dark:text-white/50 font-medium w-40 shrink-0">{key}</td>
                                                <td className="px-2 py-1">
                                                  <span className="line-through text-red-500 mr-1">{oldVal}</span>
                                                  <span className="text-gray-400 dark:text-white/40 mr-1">→</span>
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
                                  <div className="text-xs text-gray-400 dark:text-white/40 mb-1">完善阶段</div>
                                  {completionItems.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                                      <span>{item.status === 'done' ? '✅' : item.status === 'cancelled' ? '❌' : '⏳'}</span>
                                      <span className="font-medium">{item.recipient_username}</span>
                                      <span className="text-gray-500 dark:text-white/50">{item.status === 'done' ? '已完善' : item.status === 'cancelled' ? '已取消' : '待完善'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(request.current_phase === 'approval' || completionItems.every((i: any) => i.status !== 'pending')) && (
                                <div className="mb-2">
                                  <div className="text-xs text-gray-400 dark:text-white/40 mb-1">审批阶段</div>
                                  {approvalItems.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                                      <span>{item.status === 'done' && !item.rejection_reason ? '✅' : item.status === 'cancelled' ? '❌' : '⏳'}</span>
                                      <span className="font-medium">{item.recipient_username}</span>
                                      <span className="text-gray-500 dark:text-white/50">{item.status === 'done' && !item.rejection_reason ? '已通过' : item.status === 'done' && item.rejection_reason ? `已拒绝：${item.rejection_reason}` : item.status === 'cancelled' ? '已取消' : '待审批'}</span>
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
                        <td colSpan={13} className="px-0 py-0 bg-black/[0.03] dark:bg-white/[0.06]">
                          <div className="pl-8 pr-4 py-2">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-semibold text-black dark:text-white">连接器列表</span>
                              {canEditDevice(device) && device.status !== 'Pending' && (device as any)['设备LIN号（DOORS）'] !== SPECIAL_ERN_LIN && (
                                <div className="flex gap-2">
                                  <button onClick={() => openAddConnector(device.id)} className="text-xs text-black dark:text-white hover:text-black/60 dark:hover:text-white/60">+ 添加连接器</button>
                                  {(connectors[device.id]?.length ?? 0) >= 2 && (
                                    <button onClick={() => openMergeConnModal(device.id)} className="text-xs text-purple-600 hover:text-purple-800">合并连接器</button>
                                  )}
                                </div>
                              )}
                            </div>
                            {!connectors[device.id] ? (
                              <p className="text-xs text-gray-400 dark:text-white/40">加载中...</p>
                            ) : connectors[device.id].length === 0 ? (
                              <p className="text-xs text-gray-400 dark:text-white/40">暂无连接器</p>
                            ) : (
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="bg-black/[0.06] dark:bg-white/[0.1]">
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60 w-6"></th>
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">元器件编号</th>
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">元器件名称</th>
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">针孔数</th>
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">最后更新</th>
                                    {canEditDevice(device) && <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">操作</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {connectors[device.id].map(conn => {
                                    const connExpanded = expandedConnectorId === conn.id;
                                    return (
                                      <>
                                        <tr
                                          key={conn.id}
                                          ref={highlightRow?.type === 'connector' && highlightRow.id === conn.id ? highlightRowRef : undefined}
                                          className={`border-b border-gray-200 dark:border-white/10 ${highlightRow?.type === 'connector' && highlightRow.id === conn.id ? 'animate-highlight-row' : `hover:bg-black/[0.03] dark:hover:bg-white/[0.06] ${hasTodo(conn) ? 'bg-orange-100' : connExpanded ? 'bg-black/[0.04]' : ''}`} cursor-pointer`}
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
                                              className="text-gray-400 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70"
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
                                              <span className="ml-1 px-1 py-0.5 text-xs bg-black/10 dark:bg-white/15 text-black dark:text-white rounded">审批中</span>
                                            )}
                                            {conn.status !== 'Pending' && (conn as any).has_pending_sub && (
                                              <span className="ml-1 px-1 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">子项待审批</span>
                                            )}
                                            {conn.status === 'normal' && !(conn as any).has_pending_sub && (
                                              <span className="ml-1 px-1 py-0.5 text-xs bg-green-100 text-green-700 rounded">已生效</span>
                                            )}
                                            {/* 已导入/已更新标签暂时隐藏 */}
                                          </td>
                                          <td className="px-2 py-1">{conn.设备端元器件名称及类型 || '-'}</td>
                                          <td className="px-2 py-1">{conn.pin_count ?? 0}</td>
                                          <td className="px-2 py-1 text-gray-400 dark:text-white/40 text-xs">{conn.updated_at ? new Date(conn.updated_at).toLocaleDateString() : '-'}</td>
                                          <td className="px-2 py-1 space-x-1">
                                            {(device as any)['设备LIN号（DOORS）'] === SPECIAL_ERN_LIN ? (
                                              <span className="text-xs text-gray-400 dark:text-white/40">固有ERN</span>
                                            ) : (<>
                                              {canEditDevice(device) && (conn.status === 'Pending' ? (
                                                <span className="text-xs text-gray-400 dark:text-white/40">审批中</span>
                                              ) : connectorLockMap[conn.id] ? (
                                                <span className="text-xs text-amber-600">🔒{connectorLockMap[conn.id].lockedBy}</span>
                                              ) : (
                                                <>
                                                  <button onClick={() => openEditConnector(device.id, conn)} className="text-black dark:text-white">编辑</button>
                                                  <button onClick={() => deleteConnector(device.id, conn)} className="text-red-600">删除</button>
                                                </>
                                              ))}
                                              <button onClick={() => setHistoryTarget({ entityTable: 'connectors', entityId: conn.id, entityLabel: `连接器 ${conn.设备端元器件编号}` })} className="text-gray-500 dark:text-white/50 hover:text-gray-700 dark:text-white/70">历史</button>
                                            </>)}
                                            </td>
                                        </tr>

                                        {/* 针孔展开 */}
                                        {connExpanded && (
                                          <tr key={`${conn.id}-pins`}>
                                            <td colSpan={(canEditDevice(device) || canEditPin(device)) ? 7 : 6} className="px-0 py-0">
                                              <div className="pl-8 pr-2 py-1 bg-black/[0.04] dark:bg-white/[0.08]">
                                                {/* 连接器详情 */}
                                                <div className="mb-2 p-2 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded text-xs">
                                                  <div className="font-semibold text-black dark:text-white mb-1">连接器详情</div>

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
                                                          <thead><tr className="text-gray-500 dark:text-white/50"><th className="pr-4 text-left font-medium">字段</th><th className="pr-4 text-left font-medium">原值</th><th className="text-left font-medium">新值</th></tr></thead>
                                                          <tbody>
                                                            {keys.map(k => (
                                                              <tr key={k} className="border-t border-purple-100">
                                                                <td className="pr-4 py-0.5 text-gray-600 dark:text-white/60">{k}</td>
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
                                                      ['尾附件件号', conn.尾附件件号],
                                                      ['触件型号', conn.触件型号],
                                                      ['随设备交付', conn.设备端元器件匹配的元器件是否随设备交付],
                                                      ['备注', conn.备注],
                                                      ['导入来源', conn.导入来源],
                                                    ] as [string, string | undefined][]).filter(([, val]) => {
                                                      if ((device as any)['设备LIN号（DOORS）'] === SPECIAL_ERN_LIN && !val) return false;
                                                      return true;
                                                    }).map(([label, val]) => {
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
                                                          <span className={`shrink-0 ${isInvalid ? 'text-red-600 font-medium' : 'text-gray-500 dark:text-white/50'}`}>{label}：</span>
                                                          <span className={`break-all ${isInvalid ? 'text-red-600 font-medium' : 'text-gray-800 dark:text-white'}`}>{val || '-'}</span>
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
                                                      {ar.project_name && <div className="text-black dark:text-white font-medium mb-0.5">项目：{ar.project_name}</div>}
                                                      <div className="font-semibold text-gray-600 dark:text-white/60 mb-1">审批进度（{ar.action_type}）</div>
                                                      {ais.map((it: any) => (
                                                        <div key={it.id} className="flex items-center gap-1.5 mb-0.5">
                                                          <span>{it.status === 'done' && !it.rejection_reason ? '✅' : it.status === 'cancelled' ? '❌' : '⏳'}</span>
                                                          <span className="font-medium">{it.recipient_username}</span>
                                                          <span className="text-gray-500 dark:text-white/50">{it.status === 'done' && !it.rejection_reason ? '已通过' : it.status === 'cancelled' ? '已取消' : it.item_type === 'completion' ? '待完善' : '待审批'}</span>
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
                                                  <span className="text-xs font-semibold text-black/70 dark:text-white/70">针孔列表</span>
                                                  {canEditPin(device) && conn.status !== 'Pending' && (device as any)['设备LIN号（DOORS）'] !== SPECIAL_ERN_LIN && (
                                                    <button onClick={() => openAddPin(device.id, conn.id)} className="text-xs text-black/70 dark:text-white/70">+ 添加针孔</button>
                                                  )}
                                                </div>
                                                {!pins[conn.id] ? (
                                                  <p className="text-xs text-gray-400 dark:text-white/40">加载中...</p>
                                                ) : pins[conn.id].length === 0 ? (
                                                  <p className="text-xs text-gray-400 dark:text-white/40">暂无针孔</p>
                                                ) : (
                                                  <table className="w-full text-xs">
                                                    <thead>
                                                      <tr className="bg-black/[0.06] dark:bg-white/[0.1]">
                                                        <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">针孔号</th>
                                                        <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">最后更新</th>
                                                        <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">操作</th>
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {pins[conn.id].map(pin => (
                                                        <React.Fragment key={pin.id}>
                                                        <tr
                                                          ref={highlightRow?.type === 'pin' && highlightRow.id === pin.id ? highlightRowRef : undefined}
                                                          className={`border-b border-gray-200 dark:border-white/10 ${highlightRow?.type === 'pin' && highlightRow.id === pin.id ? 'animate-highlight-row' : `${hasTodo(pin) ? 'bg-orange-100' : ''}`}`}>
                                                          <td className="px-2 py-1">
                                                            {pin.针孔号}
                                                            {pin.status === 'Pending' && <span className="ml-1 px-1 py-0.5 text-xs bg-black/10 dark:bg-white/15 text-black dark:text-white rounded">审批中</span>}
                                                            {(pin as any).pending_item_type === 'approval' && <span className="ml-1 px-1 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">待我审批</span>}
                                                            {(pin as any).pending_item_type === 'completion' && <span className="ml-1 px-1 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">待我完善</span>}
                                                            {pin.status === 'normal' && <span className="ml-1 px-1 py-0.5 text-xs bg-green-100 text-green-700 rounded">已生效</span>}
                                                            {/* 已导入/已更新标签暂时隐藏 */}
                                                          </td>
                                                          <td className="px-2 py-1 text-gray-400 dark:text-white/40 text-xs">{(pin as any).updated_at ? new Date((pin as any).updated_at).toLocaleDateString() : '-'}</td>
                                                          <td className="px-2 py-1 space-x-1">
                                                            {(device as any)['设备LIN号（DOORS）'] === SPECIAL_ERN_LIN ? (
                                                              <span className="text-xs text-gray-400 dark:text-white/40">固有ERN</span>
                                                            ) : (<>
                                                              {pin.status === 'Pending' ? (
                                                                <button onClick={() => loadApprovalInfo('pin', pin.id)} className="text-xs text-black dark:text-white hover:text-black/60 dark:hover:text-white/60">审批详情</button>
                                                              ) : canEditPin(device) ? (
                                                                <>
                                                                  <button onClick={() => openEditPin(device.id, conn.id, pin)} className="text-black dark:text-white">编辑</button>
                                                                  <button onClick={() => deletePin(device.id, conn.id, pin)} className="text-red-600">删除</button>
                                                                </>
                                                              ) : null}
                                                              <button onClick={() => setHistoryTarget({ entityTable: 'pins', entityId: pin.id, entityLabel: `针孔 ${pin.针孔号}` })} className="text-gray-500 dark:text-white/50 hover:text-gray-700 dark:text-white/70">历史</button>
                                                              <button onClick={async () => {
                                                                try {
                                                                  const res = await fetch(`/api/devices/${device.id}/connectors/${conn.id}/pins/${pin.id}/related-signals`, { headers: API_HEADERS() });
                                                                  const data = await res.json();
                                                                  const sigs: { id: number; unique_id: string }[] = data.signals || [];
                                                                  if (sigs.length === 0) { alert('该针孔暂无关联信号'); return; }
                                                                  let targetSig = sigs[0];
                                                                  if (sigs.length > 1) {
                                                                    const choice = window.prompt(
                                                                      `该针孔关联 ${sigs.length} 条信号，请输入序号跳转：\n` +
                                                                      sigs.map((s, i) => `${i + 1}. ${s.unique_id}`).join('\n'),
                                                                      '1'
                                                                    );
                                                                    if (!choice) return;
                                                                    const idx = parseInt(choice) - 1;
                                                                    if (idx < 0 || idx >= sigs.length) return;
                                                                    targetSig = sigs[idx];
                                                                  }
                                                                  // 重置筛选确保目标信号可见
                                                                  setSignalFilters({});
                                                                  setSgGroupFilter('');
                                                                  setSignals([]); // 清空旧信号，防止 pendingNav 匹配到旧数据
                                                                  if (filterMode !== 'all') setFilterMode('all');
                                                                  setActiveView('signals');
                                                                  setPendingNav({ type: 'signal', signalId: targetSig.id });
                                                                } catch { alert('查询关联信号失败'); }
                                                              }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">连接查询</button>
                                                            </>)}
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
                                                                  {ar.project_name && <div className="text-black dark:text-white font-medium mb-0.5">项目：{ar.project_name}</div>}
                                                                  {(() => {
                                                                    const actionLabels: Record<string, string> = {
                                                                      create_pin: '新建针孔', edit_pin: '修改针孔', delete_pin: '删除针孔',
                                                                    };
                                                                    const actionLabel = actionLabels[ar.action_type] || ar.action_type;
                                                                    return <div className="font-semibold text-gray-600 dark:text-white/60 mb-1">针孔 {pin.针孔号} — {actionLabel}</div>;
                                                                  })()}
                                                                  {/* 变更内容 */}
                                                                  {ar.action_type === 'edit_pin' && ar.old_payload && ar.payload && (() => {
                                                                    try {
                                                                      const oldObj = JSON.parse(ar.old_payload);
                                                                      const newObj = JSON.parse(ar.payload);
                                                                      const diffs = Object.keys(newObj).filter(k => String(oldObj[k] || '') !== String(newObj[k] || ''));
                                                                      if (diffs.length === 0) return null;
                                                                      return (
                                                                        <div className="mb-1 text-gray-500 dark:text-white/50">
                                                                          {diffs.map(k => <div key={k}>{k}：{String(oldObj[k] || '（空）')} → {String(newObj[k] || '（空）')}</div>)}
                                                                        </div>
                                                                      );
                                                                    } catch { return null; }
                                                                  })()}
                                                                  {ar.action_type === 'delete_pin' && (() => {
                                                                    try {
                                                                      const payload = JSON.parse(ar.payload || '{}');
                                                                      const impact = payload._deleteImpact;
                                                                      if (!impact) return <div className="mb-1 text-red-600 text-xs">删除此针孔将影响关联信号</div>;
                                                                      return (
                                                                        <div className="mb-1 text-red-600 text-xs">
                                                                          <div className="font-medium">删除此针孔将影响关联信号：</div>
                                                                          {impact.signalsDeleted?.length > 0 && (
                                                                            <div>整体删除 {impact.signalsDeleted.length} 条：{impact.signalsDeleted.map((s: any) => s.unique_id || `#${s.id}`).join('、')}</div>
                                                                          )}
                                                                          {impact.signalsModified?.length > 0 && (
                                                                            <div>移除端点 {impact.signalsModified.length} 条：{impact.signalsModified.map((s: any) => `${s.unique_id || '#' + s.id}（减少${s.removedEndpoints}个端点）`).join('、')}</div>
                                                                          )}
                                                                        </div>
                                                                      );
                                                                    } catch { return <div className="mb-1 text-red-600 text-xs">删除此针孔将影响关联信号</div>; }
                                                                  })()}
                                                                  {/* 审批阶段 */}
                                                                  {(() => {
                                                                    const completionItems = ais.filter((it: any) => it.item_type === 'completion');
                                                                    const approvalItems = ais.filter((it: any) => it.item_type === 'approval');
                                                                    return (<>
                                                                      {completionItems.length > 0 && (
                                                                        <div className="mb-1">
                                                                          <div className="text-gray-400 dark:text-white/40 mb-0.5">阶段一：设备负责人审批</div>
                                                                          {completionItems.map((it: any) => (
                                                                            <div key={it.id} className="flex items-center gap-1.5 mb-0.5">
                                                                              <span>{it.status === 'done' && !it.rejection_reason ? '✅' : it.status === 'cancelled' ? '❌' : '⏳'}</span>
                                                                              <span className="font-medium">{it.recipient_username}</span>
                                                                              <span className="text-gray-500 dark:text-white/50">{it.status === 'done' && !it.rejection_reason ? '已通过' : it.status === 'cancelled' ? '已取消' : '待审批'}</span>
                                                                            </div>
                                                                          ))}
                                                                          {/* 阶段一审批按钮 */}
                                                                          {mpi && mpi.item_type === 'completion' && ar!.current_phase === 'completion' && (
                                                                            <div className="flex gap-2 mt-1">
                                                                              <button onClick={() => handleApprove(ar!.id, 'pin', pin.id, 'completion')} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700">审批通过</button>
                                                                              <button onClick={() => handleReject(ar!.id, 'pin', pin.id)} className="px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700">拒绝</button>
                                                                            </div>
                                                                          )}
                                                                        </div>
                                                                      )}
                                                                      {approvalItems.length > 0 && (
                                                                        <div className="mb-1">
                                                                          <div className="text-gray-400 dark:text-white/40 mb-0.5">
                                                                            阶段二：总体组审批{ar!.current_phase === 'completion' && <span className="text-orange-500 ml-1">（等待阶段一审批完成）</span>}
                                                                          </div>
                                                                          {approvalItems.map((it: any) => (
                                                                            <div key={it.id} className="flex items-center gap-1.5 mb-0.5">
                                                                              <span>{it.status === 'done' && !it.rejection_reason ? '✅' : it.status === 'cancelled' ? '❌' : '⏳'}</span>
                                                                              <span className="font-medium">{it.recipient_username}</span>
                                                                              <span className="text-gray-500 dark:text-white/50">{it.status === 'done' && !it.rejection_reason ? '已通过' : it.status === 'cancelled' ? '已取消' : '待审批'}</span>
                                                                            </div>
                                                                          ))}
                                                                          {/* 阶段二审批按钮 */}
                                                                          {mpi && mpi.item_type === 'approval' && ar!.current_phase === 'approval' && (
                                                                            <div className="flex gap-2 mt-1">
                                                                              <button onClick={() => handleApprove(ar!.id, 'pin', pin.id, 'approval')} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700">审批通过</button>
                                                                              <button onClick={() => handleReject(ar!.id, 'pin', pin.id)} className="px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700">拒绝</button>
                                                                            </div>
                                                                          )}
                                                                        </div>
                                                                      )}
                                                                    </>);
                                                                  })()}
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
            <div className="px-4 py-1.5 text-xs text-gray-500 dark:text-white/50 bg-gray-50 dark:bg-neutral-800 border-t">
              显示 {filteredDevices.length} / {devices.length} 条设备
            </div>
          )}
        </div>
        );
      })()}
      </div>
    </div>
  );

  // ── 渲染：断面连接器视图 ─────────────────────────────────


  const canManageSC = isAdmin || myProjectRole === '总体组' || myProjectRole === '系统组';
  const canEditSC = (sc: SectionConnectorRow) =>
    isAdmin || myProjectRole === '总体组' || sc.负责人 === user?.username;

  const renderSectionConnectorView = () => (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">
          断面连接器列表（{sectionConnectors.length} 个 / 连接器共 {sectionConnectors.reduce((s, sc) => s + (sc.connector_count ?? 0), 0)} 个）
        </h2>
        {canManageSC && (
          <button onClick={openAddSC} className="btn-primary text-sm">
            + 添加断面连接器
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500 dark:text-white/50">加载中...</div>
      ) : sectionConnectors.length === 0 ? (
        <div className="text-center py-8 text-gray-400 dark:text-white/40">暂无断面连接器数据</div>
      ) : (
        <div className="bg-white dark:bg-neutral-900 rounded-lg shadow">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-neutral-800 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">设备名称</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">连接器数</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">负责人</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">更新时间</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {sectionConnectors.map(sc => {
                const isExpanded = expandedSCId === sc.id;
                return (
                  <React.Fragment key={sc.id}>
                    <tr
                      className={`hover:bg-gray-50 dark:hover:bg-white/[0.04] ${isExpanded ? 'bg-black/[0.03] dark:bg-white/[0.06]' : ''} cursor-pointer`}
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
                          className="text-gray-400 dark:text-white/40 hover:text-black dark:hover:text-white font-mono text-xs"
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td className="px-4 py-2 font-medium">{sc.设备名称}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-white/60">{sc.connector_count ?? 0}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-white/60">{sc.负责人 || '-'}</td>
                      <td className="px-4 py-2 text-gray-400 dark:text-white/40 text-xs">
                        {sc.updated_at ? new Date(sc.updated_at.includes('Z') || sc.updated_at.includes('+')
                          ? sc.updated_at : sc.updated_at.replace(' ', 'T') + 'Z').toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-2 space-x-2 whitespace-nowrap">
                        {canEditSC(sc) && (
                          <>
                            <button onClick={() => openEditSC(sc)} className="text-black dark:text-white hover:text-black/60 dark:hover:text-white/60 text-xs">编辑</button>
                            <button onClick={() => deleteSC(sc)} className="text-red-600 hover:text-red-800 text-xs">删除</button>
                          </>
                        )}
                        <button onClick={() => setHistoryTarget({ entityTable: 'section_connectors', entityId: sc.id, entityLabel: `断面连接器 ${sc.设备名称}` })} className="text-gray-500 dark:text-white/50 hover:text-gray-700 dark:text-white/70 text-xs">历史</button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="px-0 py-0 bg-black/[0.03] dark:bg-white/[0.06]">
                          <div className="pl-8 pr-4 py-2">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-semibold text-black dark:text-white">连接器列表</span>
                              {canEditSC(sc) && (
                                <button onClick={() => openAddSCConnector(sc.id)} className="text-xs text-black dark:text-white hover:text-black/60 dark:hover:text-white/60">+ 添加连接器</button>
                              )}
                            </div>
                            {!scConnectors[sc.id] ? (
                              <p className="text-xs text-gray-400 dark:text-white/40">加载中...</p>
                            ) : scConnectors[sc.id].length === 0 ? (
                              <p className="text-xs text-gray-400 dark:text-white/40">暂无连接器</p>
                            ) : (
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="bg-black/[0.06] dark:bg-white/[0.1]">
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60 w-6"></th>
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">连接器号</th>
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">元器件编号</th>
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">元器件名称</th>
                                    <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">针孔数</th>
                                    {canEditSC(sc) && <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">操作</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {scConnectors[sc.id].map(conn => {
                                    const connExpanded = expandedSCConnectorId === conn.id;
                                    return (
                                      <React.Fragment key={conn.id}>
                                        <tr
                                          className={`border-b border-gray-200 dark:border-white/10 hover:bg-black/[0.03] dark:hover:bg-white/[0.06] ${connExpanded ? 'bg-black/[0.04]' : ''} cursor-pointer`}
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
                                              className="text-gray-400 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70"
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
                                                  <button onClick={() => openEditSCConnector(sc.id, conn)} className="text-black dark:text-white">编辑</button>
                                                  <button onClick={() => deleteSCConnector(sc.id, conn)} className="text-red-600">删除</button>
                                                </>
                                              )}
                                              <button onClick={() => setHistoryTarget({ entityTable: 'sc_connectors', entityId: conn.id, entityLabel: `SC连接器 ${conn.连接器号}` })} className="text-gray-500 dark:text-white/50 hover:text-gray-700 dark:text-white/70">历史</button>
                                            </td>
                                        </tr>

                                        {connExpanded && (
                                          <tr>
                                            <td colSpan={6} className="px-0 py-0">
                                              <div className="pl-8 pr-2 py-1 bg-black/[0.04] dark:bg-white/[0.08]">
                                                {/* 连接器详情 */}
                                                <div className="mb-2 p-2 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded text-xs">
                                                  <div className="font-semibold text-black dark:text-white mb-1">连接器详情</div>
                                                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                                    {([
                                                      ['连接器号', conn.连接器号],
                                                      ['设备端元器件编号', conn.设备端元器件编号],
                                                      ['设备端元器件名称及类型', conn.设备端元器件名称及类型],
                                                      ['设备端元器件件号类型及件号', conn.设备端元器件件号类型及件号],
                                                      ['设备端元器件供应商名称', conn.设备端元器件供应商名称],
                                                      ['匹配的线束端元器件件号', conn.匹配的线束端元器件件号],
                                                      ['随设备交付', conn.设备端元器件匹配的元器件是否随设备交付],
                                                      ['备注', conn.备注],
                                                    ] as [string, string | undefined][]).map(([label, val]) => (
                                                      <div key={label} className="flex gap-1">
                                                        <span className="text-gray-500 dark:text-white/50 shrink-0">{label}：</span>
                                                        <span className="text-gray-800 dark:text-white break-all">{val || '-'}</span>
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                                {/* 针孔 */}
                                                <div className="flex justify-between items-center mb-1">
                                                  <span className="text-xs font-semibold text-black/70 dark:text-white/70">针孔列表</span>
                                                  {canEditSC(sc) && (
                                                    <button onClick={() => openAddSCPin(sc.id, conn.id)} className="text-xs text-black/70 dark:text-white/70">+ 添加针孔</button>
                                                  )}
                                                </div>
                                                {!scPins[conn.id] ? (
                                                  <p className="text-xs text-gray-400 dark:text-white/40">加载中...</p>
                                                ) : scPins[conn.id].length === 0 ? (
                                                  <p className="text-xs text-gray-400 dark:text-white/40">暂无针孔</p>
                                                ) : (
                                                  <table className="w-full text-xs">
                                                    <thead>
                                                      <tr className="bg-black/[0.06] dark:bg-white/[0.1]">
                                                        <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">针孔号</th>
                                                        <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">端接尺寸</th>
                                                        <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">屏蔽类型</th>
                                                        {canEditSC(sc) && <th className="px-2 py-1 text-left text-gray-600 dark:text-white/60">操作</th>}
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {scPins[conn.id].map(pin => (
                                                        <tr key={pin.id} className="border-b border-gray-200 dark:border-white/10">
                                                          <td className="px-2 py-1">{pin.针孔号}</td>
                                                          <td className="px-2 py-1">{pin.端接尺寸 || '-'}</td>
                                                          <td className="px-2 py-1">{pin.屏蔽类型 || '-'}</td>
                                                          <td className="px-2 py-1 space-x-1">
                                                              {canEditSC(sc) && (
                                                                <>
                                                                  <button onClick={() => openEditSCPin(sc.id, conn.id, pin)} className="text-black dark:text-white">编辑</button>
                                                                  <button onClick={() => deleteSCPin(sc.id, conn.id, pin)} className="text-red-600">删除</button>
                                                                </>
                                                              )}
                                                              <button onClick={() => setHistoryTarget({ entityTable: 'sc_pins', entityId: pin.id, entityLabel: `SC针孔 ${pin.针孔号}` })} className="text-gray-500 dark:text-white/50 hover:text-gray-700 dark:text-white/70">历史</button>
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
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-3 shrink-0">
        <h2 className="text-lg font-semibold">信号列表（{signalTotal}条）</h2>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              disabled={sgCheckMode}
              onClick={async () => {
                if (!selectedProjectId) return;
                if (!confirm('确定要清空当前项目的全部信号及端点数据吗？此操作不可恢复！')) return;
                const res = await fetch(`/api/signals/project/${selectedProjectId}/all`, { method: 'DELETE', headers: API_HEADERS() });
                if (res.ok) { await loadSignals(); }
                else { alert((await res.json()).error || '清空失败'); }
              }}
              className={`px-3 py-1.5 rounded text-sm ${sgCheckMode ? 'bg-gray-300 text-gray-500 dark:text-white/50 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600'}`}
            >清空信号视图数据</button>
          )}
          {canExport && (
          <button
            disabled={sgCheckMode}
            onClick={async () => {
              if (!selectedProjectId) return;
              setAtaExportFilter('');
              setAtaExportSelectedIds(new Set());
              setShowAtaExportModal(true);
              const res = await fetch(`/api/devices?projectId=${selectedProjectId}`, { headers: API_HEADERS() });
              const data = await res.json();
              setAtaExportDevices(data.devices || []);
            }}
            className={`px-3 py-1.5 rounded text-sm ${sgCheckMode ? 'bg-gray-300 text-gray-500 dark:text-white/50 cursor-not-allowed' : 'bg-teal-600 text-white hover:bg-teal-700'}`}
          >WB导出</button>
          )}
          {canManageSignals && (
            <>
              <button
                disabled={sgCheckMode}
                onClick={() => { setImportSigFile(null); setImportSigResult(null); setImportSigType('import'); setShowImportSigModal(true); }}
                className={`px-3 py-1.5 rounded text-sm ${sgCheckMode ? 'bg-gray-300 text-gray-500 dark:text-white/50 cursor-not-allowed' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
              >导入信号及针孔数据</button>
              {!sgCheckMode && (
                <button
                  onClick={() => { setSgCheckMode(true); setSgCheckedIds([]); }}
                  className="bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 rounded text-sm hover:bg-gray-800 dark:hover:bg-gray-200"
                >信号分组</button>
              )}
              <button
                disabled={sgCheckMode}
                onClick={openAddSignal}
                className={`px-3 py-1.5 rounded text-sm ${sgCheckMode ? 'bg-gray-300 text-gray-500 dark:text-white/50 cursor-not-allowed' : 'bg-black text-white dark:bg-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200'}`}
              >
                + 添加信号
              </button>
            </>
          )}
        </div>
      </div>

      {/* 分组模式操作栏 */}
      {sgCheckMode && (
        <div className="bg-black/[0.04] border-b border-gray-200 dark:border-white/10 px-4 py-2 flex items-center gap-3 shrink-0">
          {/* 左侧：状态 */}
          <span className="text-sm text-black dark:text-white shrink-0">
            <span className="font-semibold">分组模式</span>
            {sgCheckedIds.length > 0 && <span className="ml-1">· 已选 <span className="font-semibold">{sgCheckedIds.length}</span> 条</span>}
          </span>

          <div className="w-px h-5 bg-gray-200 shrink-0" />

          {/* 中间左：创建空白分组 */}
          <select
            value={sgBlankType}
            disabled={sgCheckedIds.length > 0}
            onChange={e => setSgBlankType(e.target.value)}
            className={`border rounded px-2 py-1 text-xs ${sgCheckedIds.length > 0 ? 'border-gray-200 dark:border-white/10 bg-gray-100 text-gray-400 dark:text-white/40 cursor-not-allowed' : 'border-gray-300 dark:border-white/20 bg-white dark:bg-neutral-900'}`}
          >
            <option value="">选择组类型...</option>
            {([
              { type: 'ARINC 429', prefix: 'A_429_', bg: 'rgba(224,231,255,0.7)', text: '#4f46e5' },
              { type: 'CAN Bus', prefix: 'CAN_Bus_', bg: 'rgba(254,243,199,0.7)', text: '#b45309' },
              { type: '电源（低压）', prefix: 'PWR_LV_', bg: 'rgba(254,226,226,0.7)', text: '#dc2626' },
              { type: '电源（高压）', prefix: 'PWR_HV_', bg: 'rgba(254,202,202,0.7)', text: '#991b1b' },
              { type: 'RS-422', prefix: 'RS422_', bg: 'rgba(245,243,255,0.7)', text: '#6d28d9' },
              { type: 'RS-422（全双工）', prefix: 'RS422_F_', bg: 'rgba(237,233,254,0.7)', text: '#7c3aed' },
              { type: 'RS-485', prefix: 'RS485_', bg: 'rgba(204,251,241,0.7)', text: '#0f766e' },
              { type: '以太网（百兆）', prefix: 'ETH100_', bg: 'rgba(220,252,231,0.7)', text: '#15803d' },
              { type: '以太网（千兆）', prefix: 'ETH1000_', bg: 'rgba(224,242,254,0.7)', text: '#0369a1' },
            ]).map(({ type, bg, text }) =>
              <option key={type} value={type} style={{ backgroundColor: bg, color: text }}>{type}</option>
            )}
          </select>
          <button
            disabled={!sgBlankType || sgCreating || sgCheckedIds.length > 0}
            onClick={async () => {
              setSgCreating(true);
              try {
                const res = await fetch('/api/signals/group/blank', {
                  method: 'POST',
                  headers: { ...API_HEADERS(), 'Content-Type': 'application/json' },
                  body: JSON.stringify({ project_id: selectedProjectId, conn_type: sgBlankType }),
                });
                const data = await res.json();
                if (res.ok) {
                  alert(`空白分组「${data.group_name}」创建成功（${data.signal_ids.length}条Draft信号）`);
                  setSgBlankType('');
                  loadSignals();
                } else { alert(data.error || '创建失败'); }
              } catch { alert('操作失败'); }
              finally { setSgCreating(false); }
            }}
            className={`px-2 py-1 rounded text-xs shrink-0 ${!sgBlankType || sgCheckedIds.length > 0 ? 'bg-gray-300 text-gray-500 dark:text-white/50 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
          >创建空白分组</button>

          {/* 中间右：已有信号建组（勾选后显示） */}
          {sgCheckedIds.length > 0 && (
            <>
              <div className="w-px h-5 bg-gray-200 shrink-0" />
              <button
                onClick={() => setSgCheckedIds([])}
                className="px-2 py-1 border border-gray-300 dark:border-white/20 rounded text-xs text-black dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.1] shrink-0"
              >取消选择</button>
              <button
                disabled={sgCreating}
                onClick={async () => {
                  setSgCreating(true);
                  try {
                    const res = await fetch('/api/signals/group', {
                      method: 'POST',
                      headers: { ...API_HEADERS(), 'Content-Type': 'application/json' },
                      body: JSON.stringify({ signal_ids: sgCheckedIds }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                      alert(`信号组「${data.group_name}」创建成功`);
                      setSgCheckedIds([]);
                      loadSignals();
                    } else { alert(data.error || '创建失败'); }
                  } catch { alert('操作失败'); }
                  finally { setSgCreating(false); }
                }}
                className="px-2 py-1 bg-black text-white dark:bg-white dark:text-black rounded text-xs hover:bg-gray-800 dark:hover:bg-gray-200 disabled:bg-gray-400 shrink-0"
              >{sgCreating ? '创建中...' : '已有信号建组'}</button>
            </>
          )}

          {/* 右侧：智能分组 + 退出 */}
          <div className="flex-1" />
          <button
            disabled={sgCreating}
            onClick={async () => {
              if (!confirm('将自动识别高置信度的信号分组（同连接器+名称共干+协议互补），并更新组内信号的连接类型/协议标识/线类型。\n\n是否继续？')) return;
              setSgCreating(true);
              try {
                const res = await fetch('/api/signals/group/auto', {
                  method: 'POST',
                  headers: { ...API_HEADERS(), 'Content-Type': 'application/json' },
                  body: JSON.stringify({ project_id: selectedProjectId }),
                });
                const data = await res.json();
                if (res.ok) {
                  alert(`智能分组完成！\n\n创建 ${data.groups_created} 个分组\n更新 ${data.signals_updated} 条信号`);
                  loadSignals();
                } else { alert(data.error || '智能分组失败'); }
              } catch { alert('操作失败'); }
              finally { setSgCreating(false); }
            }}
            className="px-3 py-1 bg-amber-500 text-white rounded text-sm hover:bg-amber-600 disabled:bg-gray-400 shrink-0"
          >{sgCreating ? '处理中...' : '智能分组'}</button>
          <button
            onClick={() => { setSgCheckMode(false); setSgCheckedIds([]); }}
            className="px-3 py-1 border border-gray-300 dark:border-white/20 rounded text-sm text-black dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.1] shrink-0"
          >退出分组模式</button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
      {loading ? (
        <div className="text-center py-8 text-gray-500 dark:text-white/50">加载中...</div>
      ) : signals.length === 0 ? (
        <div className="text-center py-8 text-gray-400 dark:text-white/40">暂无信号数据</div>
      ) : (() => {
        const filteredSignals = signals.filter(s => {
          if (filterMode === 'pending' && s.status !== 'Pending') return false;
          if (filterMode === 'my_approval' && !(s.status === 'Pending' && s.pending_item_type === 'approval')) return false;
          if (filterMode === 'my_completion' && !(s.status === 'Pending' && s.pending_item_type === 'completion')) return false;
          if (filterMode === 'my_tasks' && !(s.status === 'Pending' && (s.pending_item_type === 'approval' || s.pending_item_type === 'completion'))) return false;
          if (filterMode === 'networking' && (s.endpoint_count ?? 0) <= 2) return false;
          // 分组筛选
          if (sgGroupFilter) {
            const sg = (s as any).signal_group || '';
            if (sgGroupFilter === '_grouped' && !sg) return false;
            if (sgGroupFilter === '_ungrouped' && sg) return false;
            if (sgGroupFilter !== '_grouped' && sgGroupFilter !== '_ungrouped' && !sg.startsWith(sgGroupFilter)) return false;
          }
          // 列过滤
          for (const [key, val] of Object.entries(signalFilters)) {
            if (!val) continue;
            if (key === '_status') {
              if (s.status !== val) return false;
              continue;
            }
            if (key === '导线等级') {
              if ((s.导线等级 || '') !== val) return false;
              continue;
            }
            const cell = String((s as any)[key] ?? '').toLowerCase();
            if (!cell.includes(val.toLowerCase())) return false;
          }
          return true;
        });
        // 同组信号排序挨着：组的位置由组内首条信号决定，组内按协议标识固定顺序
        const GROUP_PROTOCOL_ORDER: Record<string, string[]> = {
          'A_429_': ['A429_Positive', 'A429_Negative'],
          'CAN_Bus_': ['CAN_High', 'CAN_Low', 'CAN_Gnd'],
          'PWR_LV_': ['电源（低压）正极', '电源（低压）负极'],
          'PWR_HV_': ['电源（高压）正极', '电源（高压）负极'],
          'RS422_F_': ['RS-422_TX_A', 'RS-422_TX_B', 'RS-422_RX_A', 'RS-422_RX_B', 'RS-422_Gnd'],
          'RS422_': ['RS-422_A', 'RS-422_B', 'RS-422_Gnd'],
          'RS485_': ['RS-485_A', 'RS-485_B', 'RS-485_Gnd'],
          'ETH100_': ['ETH_TX+', 'ETH_TX-', 'ETH_RX+', 'ETH_RX-', 'ETH_Gnd'],
          'ETH1000_': ['ETH_A+', 'ETH_A-', 'ETH_B+', 'ETH_B-', 'ETH_C+', 'ETH_C-', 'ETH_D+', 'ETH_D-', 'ETH_Gnd'],
        };
        const reorderedSignals = (() => {
          const grouped = new Map<string, typeof filteredSignals>();
          const ungrouped: typeof filteredSignals = [];
          const groupFirstIdx = new Map<string, number>();
          filteredSignals.forEach((s, idx) => {
            const g = (s as any).signal_group;
            if (g) {
              if (!grouped.has(g)) { grouped.set(g, []); groupFirstIdx.set(g, idx); }
              grouped.get(g)!.push(s);
            } else {
              ungrouped.push(s);
            }
          });
          // 无分组信号直接按原序
          if (grouped.size === 0) return filteredSignals;
          // 按组内协议标识排序
          for (const [gName, members] of grouped) {
            const prefix = Object.keys(GROUP_PROTOCOL_ORDER).find(p => gName.startsWith(p));
            if (prefix) {
              const order = GROUP_PROTOCOL_ORDER[prefix];
              members.sort((a, b) => {
                const ai = order.indexOf((a as any)['协议标识'] || '');
                const bi = order.indexOf((b as any)['协议标识'] || '');
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
              });
            }
          }
          // 重建列表：遇到组的首个位置时插入整组
          const result: typeof filteredSignals = [];
          const insertedGroups = new Set<string>();
          filteredSignals.forEach((s, idx) => {
            const g = (s as any).signal_group;
            if (g) {
              if (!insertedGroups.has(g)) {
                insertedGroups.add(g);
                result.push(...grouped.get(g)!);
              }
            } else {
              result.push(s);
            }
          });
          return result;
        })();

        const hasAnySignalFilter = Object.values(signalFilters).some(v => v);
        // 有筛选条件时显示全部过滤结果，否则按 displayCount 渐进渲染
        const isFiltering = hasAnySignalFilter || filterMode !== 'all' || !!sgGroupFilter;
        const displayedSignals = isFiltering ? reorderedSignals : reorderedSignals.slice(0, signalDisplayCount);
        const hasMore = !isFiltering && reorderedSignals.length > signalDisplayCount;
        return (
        <div className="bg-white dark:bg-neutral-900 rounded-lg shadow">
          <div className="px-4 py-1.5 text-xs text-gray-500 dark:text-white/50 bg-gray-50 dark:bg-neutral-800 border-b sticky top-0 z-20">
            {isFiltering
              ? `显示 ${filteredSignals.length} / ${signals.length} 条信号`
              : `已载入 ${Math.min(signalDisplayCount, filteredSignals.length)} / ${signalTotal} 条信号`}
          </div>
          <table className="text-sm table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
            <colgroup>
              <col style={{ width: 32 }} />{/* 勾选框/占位 */}
              <col style={{ width: 32 }} />{/* # 序号 */}
              {sgCheckMode && <col style={{ width: 32 }} />}{/* 分组勾选 */}
              <col style={{ width: 24 }} />{/* 组名 */}
              <col style={{ width: 32 }} />{/* 色带 */}
              <col style={{ width: 250 }} />{/* Unique ID */}
              <col style={{ width: 200 }} />{/* 状态 */}
              <col style={{ width: 300 }} />{/* 信号名称摘要 */}
              <col style={{ width: 80 }} />{/* 连接类型 */}
              <col style={{ width: 70 }} />{/* 导线等级 */}
              <col style={{ width: 300 }} />{/* 端点摘要 */}
              <col style={{ width: 90 }} />{/* 创建人 */}
              <col style={{ width: 90 }} />{/* 最后更新 */}
              <col style={{ width: 130 }} />{/* 操作 */}
              <col />{/* 右侧弹性占位 */}
            </colgroup>
            <thead className="bg-gray-50 dark:bg-neutral-800 sticky top-[29px] z-10">
              <tr>
                {!sgCheckMode && <th className="px-1 py-2"></th>}
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50">#</th>
                {sgCheckMode && <th className="px-1 py-2 text-center text-xs text-gray-500 dark:text-white/50"></th>}
                <th className="py-2 text-xs text-gray-500 dark:text-white/50">组</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500 dark:text-white/50"></th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">Unique ID</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">状态</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">信号名称摘要</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">连接类型</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">导线等级</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">端点摘要</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">创建人</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50 cursor-pointer select-none hover:text-black dark:hover:text-white"
                  onClick={() => setSignalSortOrder(o => o === 'desc' ? 'asc' : 'desc')}>
                  最后更新 {signalSortOrder === 'desc' ? '▼' : '▲'}
                </th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-white/50">操作</th>
                <th></th>
              </tr>
              <tr className="bg-white dark:bg-neutral-900 border-b">
                {!sgCheckMode && <th className="px-1 py-1"></th>}
                <th className="px-1 py-1"></th>
                <th className="p-0 w-6">
                  <select
                    value={sgGroupFilter}
                    onChange={e => setSgGroupFilter(e.target.value)}
                    className="w-full text-xs border border-gray-300 dark:border-white/20 rounded py-0.5 px-0 focus:outline-none"
                    title="按分组筛选"
                  >
                    <option value="">全部</option>
                    <option value="_grouped">已分组</option>
                    <option value="_ungrouped">未分组</option>
                    {(['A_429_','CAN_Bus_','PWR_LV_','PWR_HV_','RS422_','RS422_F_','RS485_','ETH100_','ETH1000_'] as const).map(p =>
                      <option key={p} value={p}>{p.replace(/_$/, '')}</option>
                    )}
                  </select>
                </th>
                {sgCheckMode && <th className="px-1 py-1"></th>}
                <th className="px-2 py-1"></th>
                {/* Unique ID */}
                <th className="px-4 py-1 max-w-[120px]">
                  <div className="relative">
                    <input type="text" placeholder="筛选..." value={signalFilters['unique_id'] || ''}
                      onChange={e => setSignalFilters(prev => ({ ...prev, unique_id: e.target.value }))}
                      className="w-full px-1.5 py-0.5 pr-5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black" />
                    {signalFilters['unique_id'] && (
                      <button onClick={() => setSignalFilters(prev => ({ ...prev, unique_id: '' }))}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:text-white/60 text-xs leading-none">&times;</button>
                    )}
                  </div>
                </th>
                {/* 状态 */}
                <th className="px-4 py-1 w-[200px]">
                  <select value={signalFilters['_status'] || ''}
                    onChange={e => setSignalFilters(prev => ({ ...prev, _status: e.target.value }))}
                    className="w-full px-1 py-0.5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black dark:focus:border-white bg-white dark:bg-neutral-800 dark:text-white">
                    <option value="">全部状态</option>
                    <option value="Draft">Draft</option>
                    <option value="Pending">审批中</option>
                    <option value="Active">已生效</option>
                  </select>
                </th>
                {/* 信号名称摘要、连接类型 */}
                {(['信号名称摘要', '连接类型'] as const).map(col => (
                  <th key={col} className="px-4 py-1">
                    <div className="relative">
                      <input type="text" placeholder="筛选..." value={signalFilters[col] || ''}
                        onChange={e => setSignalFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        className="w-full px-1.5 py-0.5 pr-5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black" />
                      {signalFilters[col] && (
                        <button onClick={() => setSignalFilters(prev => ({ ...prev, [col]: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:text-white/60 text-xs leading-none">&times;</button>
                      )}
                    </div>
                  </th>
                ))}
                {/* 导线等级 - 下拉菜单筛选 */}
                <th className="px-4 py-1 w-[90px]">
                  <select value={signalFilters['导线等级'] || ''}
                    onChange={e => setSignalFilters(prev => ({ ...prev, '导线等级': e.target.value }))}
                    className="w-full px-1 py-0.5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black dark:focus:border-white bg-white dark:bg-neutral-800 dark:text-white">
                    <option value="">全部</option>
                    <option value="1级">1级</option>
                    <option value="2级">2级</option>
                    <option value="3级">3级</option>
                    <option value="4级">4级</option>
                    <option value="5级">5级</option>
                  </select>
                </th>
                {/* 端点摘要、创建人 */}
                {(['endpoint_summary', 'created_by'] as const).map(col => (
                  <th key={col} className="px-4 py-1">
                    <div className="relative">
                      <input type="text" placeholder="筛选..." value={signalFilters[col] || ''}
                        onChange={e => setSignalFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        className="w-full px-1.5 py-0.5 pr-5 text-xs border border-gray-300 dark:border-white/20 rounded focus:outline-none focus:border-black" />
                      {signalFilters[col] && (
                        <button onClick={() => setSignalFilters(prev => ({ ...prev, [col]: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:text-white/60 text-xs leading-none">&times;</button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-4 py-1"></th>
                {/* 操作列 - 清除按钮 */}
                <th className="px-4 py-1">
                  {hasAnySignalFilter && (
                    <button onClick={() => setSignalFilters({})} className="text-xs text-gray-400 dark:text-white/40 hover:text-red-500">全部清除</button>
                  )}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {/* 预计算分组位置信息 */}
              {(() => {
                const groupPosMap = new Map<number, { pos: 'first' | 'middle' | 'last' | 'solo'; groupSize: number }>();
                const groupIdxs = new Map<string, number[]>();
                displayedSignals.forEach((s, i) => {
                  const g = (s as any).signal_group;
                  if (g) {
                    if (!groupIdxs.has(g)) groupIdxs.set(g, []);
                    groupIdxs.get(g)!.push(i);
                  }
                });
                groupIdxs.forEach((idxs) => {
                  idxs.forEach((idx, i) => {
                    const pos = idxs.length === 1 ? 'solo' : i === 0 ? 'first' : i === idxs.length - 1 ? 'last' : 'middle';
                    groupPosMap.set(idx, { pos, groupSize: idxs.length });
                  });
                });
                return displayedSignals.map((signal, displayIndex) => {
                const isExpanded = expandedSignalId === signal.id;
                const groupInfo = groupPosMap.get(displayIndex);
                const detail = signalDetails[signal.id];
                return (
                  <React.Fragment key={signal.id}>
                    {groupInfo?.pos === 'first' && displayIndex > 0 && (
                      <tr><td colSpan={99} className="h-2 bg-transparent p-0 border-none" /></tr>
                    )}
                    {/* 分组视觉：左边框色条 + 序号列组名 */}
                    <tr
                      ref={highlightRow?.type === 'signal' && highlightRow.id === signal.id ? highlightRowRef : undefined}
                      className={`${highlightRow?.type === 'signal' && highlightRow.id === signal.id ? 'animate-highlight-row' : `hover:bg-gray-50 dark:hover:bg-white/[0.04] ${
                        hasTodo(signal) || signalDetails[signal.id]?.endpoints?.some(ep => hasTodo(ep))
                          ? 'bg-orange-100'
                          : isExpanded ? 'bg-green-50 dark:bg-white/[0.06]' : ''
                      }`} cursor-pointer`}
                      style={groupInfo ? {
                        borderLeft: `3px solid ${(() => { const gn = (signal as any).signal_group || ''; const gp = Object.keys({'A_429_':'#818cf8','CAN_Bus_':'#f59e0b','PWR_LV_':'#ef4444','PWR_HV_':'#dc2626','RS422_F_':'#8b5cf6','RS422_':'#a78bfa','RS485_':'#14b8a6','ETH100_':'#22c55e','ETH1000_':'#0ea5e9'}).find(p => gn.startsWith(p)); return gp ? ({'A_429_':'#818cf8','CAN_Bus_':'#f59e0b','PWR_LV_':'#ef4444','PWR_HV_':'#dc2626','RS422_F_':'#8b5cf6','RS422_':'#a78bfa','RS485_':'#14b8a6','ETH100_':'#22c55e','ETH1000_':'#0ea5e9'} as any)[gp] : '#818cf8'; })()}`,
                      } : undefined}
                      onDoubleClick={async () => {
                        if (!isExpanded) {
                          setExpandedSignalId(signal.id);
                          await loadSignalDetail(signal.id, true);
                          if (signal.status === 'Pending') await loadApprovalInfo('signal', signal.id);
                        }
                        else { setExpandedSignalId(null); }
                      }}
                    >
                      {!sgCheckMode && (
                        <td className="px-1 py-2 text-center w-8">
                          {filterMode === 'my_tasks' && signal.pending_item_type === 'approval' && (signal as any).approval_request_id && (
                            <input
                              type="checkbox"
                              checked={batchApprovalIds.includes((signal as any).approval_request_id)}
                              onChange={e => {
                                e.stopPropagation();
                                const rid = (signal as any).approval_request_id;
                                if (e.target.checked) setBatchApprovalIds(prev => [...prev, rid]);
                                else setBatchApprovalIds(prev => prev.filter(id => id !== rid));
                              }}
                              className="rounded border-gray-300 dark:border-white/20"
                            />
                          )}
                        </td>
                      )}
                      <td className="px-2 py-2 text-center text-xs">
                        {groupInfo ? (() => {
                          const gn = (signal as any).signal_group || '';
                          const gp = Object.keys({'A_429_':'#4f46e5','CAN_Bus_':'#b45309','PWR_LV_':'#dc2626','PWR_HV_':'#991b1b','RS422_F_':'#7c3aed','RS422_':'#6d28d9','RS485_':'#0f766e','ETH100_':'#15803d','ETH1000_':'#0369a1'}).find(p => gn.startsWith(p));
                          const textColor = gp ? ({'A_429_':'#4f46e5','CAN_Bus_':'#b45309','PWR_LV_':'#dc2626','PWR_HV_':'#991b1b','RS422_F_':'#7c3aed','RS422_':'#6d28d9','RS485_':'#0f766e','ETH100_':'#15803d','ETH1000_':'#0369a1'} as any)[gp] : '#4f46e5';
                          return <span className="font-medium" style={{ color: textColor }}>{displayIndex + 1}</span>;
                        })() : (
                          <span className="text-gray-400 dark:text-white/40">{displayIndex + 1}</span>
                        )}
                      </td>
                      {sgCheckMode && (
                        <td className="px-1 py-2 text-center">
                          {!(signal as any).signal_group && (
                            <input
                              type="checkbox"
                              checked={sgCheckedIds.includes(signal.id)}
                              onChange={e => {
                                e.stopPropagation();
                                if (e.target.checked) setSgCheckedIds(prev => [...prev, signal.id]);
                                else setSgCheckedIds(prev => prev.filter(id => id !== signal.id));
                              }}
                              className="rounded border-gray-300 dark:border-white/20"
                            />
                          )}
                        </td>
                      )}
                      {/* 组名独立列 */}
                      <td className="p-0 text-center w-6">
                        {groupInfo?.pos === 'first' && (() => {
                          const gn = (signal as any).signal_group || '';
                          const gp = Object.keys({'A_429_':'#4f46e5','CAN_Bus_':'#b45309','PWR_LV_':'#dc2626','PWR_HV_':'#991b1b','RS422_F_':'#7c3aed','RS422_':'#6d28d9','RS485_':'#0f766e','ETH100_':'#15803d','ETH1000_':'#0369a1'}).find(p => gn.startsWith(p));
                          const textColor = gp ? ({'A_429_':'#4f46e5','CAN_Bus_':'#b45309','PWR_LV_':'#dc2626','PWR_HV_':'#991b1b','RS422_F_':'#7c3aed','RS422_':'#6d28d9','RS485_':'#0f766e','ETH100_':'#15803d','ETH1000_':'#0369a1'} as any)[gp] : '#4f46e5';
                          return (
                            <button
                              className="font-mono whitespace-nowrap hover:opacity-70"
                              style={{ color: textColor, fontSize: '9px', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                              title="点击解散该信号组"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm(`确定解散信号组「${gn}」吗？`)) return;
                                try {
                                  const res = await fetch(`/api/signals/group/${encodeURIComponent(gn)}?project_id=${selectedProjectId}`, { method: 'DELETE', headers: API_HEADERS() });
                                  if (res.ok) { loadSignals(); }
                                  else { alert((await res.json()).error || '解散失败'); }
                                } catch { alert('操作失败'); }
                              }}
                            >{gn}</button>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-end justify-center gap-1">
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
                            className="text-gray-400 dark:text-white/40 hover:text-green-600 font-mono text-xs leading-none"
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          {selectedProjectId && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const sg = (signal as any).signal_group;
                                if (sg) {
                                  setSignalGroupTarget({ groupName: sg, projectId: selectedProjectId, signalId: signal.id });
                                } else {
                                  setSignalGroupTarget({ singleSignalId: signal.id, projectId: selectedProjectId, signalId: signal.id });
                                }
                              }}
                              className="leading-none text-gray-400 dark:text-white/40 hover:text-black dark:hover:text-white"
                              title={(signal as any).signal_group ? `查看协议组 ${(signal as any).signal_group} 连接图` : '查看信号连接图（未分组）'}
                            >
                              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style={{ display: 'block', position: 'relative', top: '1px' }}><path d="M8 3C4.5 3 1.7 5.3.5 8c1.2 2.7 4 5 7.5 5s6.3-2.3 7.5-5c-1.2-2.7-4-5-7.5-5zm0 8.3c-1.8 0-3.3-1.5-3.3-3.3S6.2 4.7 8 4.7s3.3 1.5 3.3 3.3-1.5 3.3-3.3 3.3zM8 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs max-w-[120px] truncate" title={signal.unique_id || '-'}>{signal.unique_id || '-'}</td>
                      <td className="px-4 py-2 w-[200px]">
                        {signal.status === 'Draft' && (
                          <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 text-xs font-semibold">Draft</span>
                        )}
                        {signal.status === 'Pending' && (
                          <>
                            <span className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/15 text-black dark:text-white text-xs font-semibold">审批中</span>
                            {signal.pending_item_type === 'approval' && <span className="ml-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-xs">待我审批</span>}
                            {signal.pending_item_type === 'completion' && <span className="ml-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-xs">待我完善</span>}
                          </>
                        )}
                        {signal.status === 'Active' && (
                          <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs font-semibold">已生效</span>
                        )}
                        {/* 已导入/已更新标签暂时隐藏 */}
                      </td>
                      <td className="px-4 py-2 text-xs max-w-[180px] truncate" title={signal.信号名称摘要 || '-'}>{signal.信号名称摘要 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-white/60 w-[80px] truncate" title={signal.连接类型 || '-'}>{signal.连接类型 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-white/60 text-xs w-[90px]">{signal.导线等级 || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-white/60 text-xs max-w-[180px] truncate" title={signal.endpoint_summary || '-'}>{signal.endpoint_summary || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-white/60 text-xs w-[120px] truncate" title={signal.created_by || '-'}>{signal.created_by || '-'}</td>
                      <td className="px-4 py-2 text-gray-400 dark:text-white/40 text-xs max-w-[90px] truncate">{(signal as any).updated_at ? new Date((signal as any).updated_at).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-2 space-x-2 text-xs whitespace-nowrap w-[130px]">
                        {signal.status === 'Pending' ? (
                          <span className="text-gray-400 dark:text-white/40 cursor-not-allowed" title="记录审批中，不可编辑">编辑/删除</span>
                        ) : (
                          <>
                            {canManageSignals && (signalLockMap[signal.id] ? (
                              <span className="text-amber-600">🔒{signalLockMap[signal.id].lockedBy}</span>
                            ) : (
                              <button onClick={() => openEditSignal(signal)} className="text-black dark:text-white hover:text-black/60 dark:hover:text-white/60">编辑</button>
                            ))}
                            {canDeleteSignal(signal) && (
                              <button onClick={() => deleteSignal(signal)} className="text-red-600 hover:text-red-800">删除</button>
                            )}
                          </>
                        )}
                        <button onClick={() => setHistoryTarget({ entityTable: 'signals', entityId: signal.id, entityLabel: `信号 ${signal.unique_id || signal.id}` })} className="text-gray-500 dark:text-white/50 hover:text-gray-700 dark:text-white/70">历史</button>
                      </td>
                      <td></td>
                    </tr>

                    {isExpanded && signal.status === 'Pending' && (() => {
                      const approvalInfo = approvalInfoMap[`signal_${signal.id}`];
                      if (!approvalInfo?.request) return null;
                      const { request, items, my_pending_item } = approvalInfo;
                      const completionItems = items.filter((i: any) => i.item_type === 'completion');
                      const approvalItems = items.filter((i: any) => i.item_type === 'approval');
                      return (
                        <tr key={`${signal.id}-approval`}
                          style={groupInfo ? { borderLeft: `3px solid ${(() => { const gn = (signal as any).signal_group || ''; const gp = Object.keys({'A_429_':'#818cf8','CAN_Bus_':'#f59e0b','PWR_LV_':'#ef4444','PWR_HV_':'#dc2626','RS422_F_':'#8b5cf6','RS422_':'#a78bfa','RS485_':'#14b8a6','ETH100_':'#22c55e','ETH1000_':'#0ea5e9'}).find(p => gn.startsWith(p)); return gp ? ({'A_429_':'#818cf8','CAN_Bus_':'#f59e0b','PWR_LV_':'#ef4444','PWR_HV_':'#dc2626','RS422_F_':'#8b5cf6','RS422_':'#a78bfa','RS485_':'#14b8a6','ETH100_':'#22c55e','ETH1000_':'#0ea5e9'} as any)[gp] : '#818cf8'; })()}` } : undefined}
                        >
                          <td colSpan={11} className="px-0 py-0 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800">
                            <div className="pl-8 pr-4 py-3">
                              {request.project_name && <div className="text-xs text-black dark:text-white font-medium mb-1">项目：{request.project_name}</div>}
                              <div className="text-xs font-semibold text-gray-600 dark:text-white/60 mb-2">审批进度（{request.action_type}）</div>
                              {completionItems.length > 0 && (
                                <div className="mb-2">
                                  <div className="text-xs text-gray-400 dark:text-white/40 mb-1">完善阶段</div>
                                  {completionItems.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                                      <span>{item.status === 'done' ? '✅' : item.status === 'cancelled' ? '❌' : '⏳'}</span>
                                      <span className="font-medium">{item.recipient_username}</span>
                                      <span className="text-gray-500 dark:text-white/50">{item.status === 'done' ? '已完善' : item.status === 'cancelled' ? '已取消' : '待完善'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(request.current_phase === 'approval' || completionItems.every((i: any) => i.status !== 'pending')) && (
                                <div className="mb-2">
                                  <div className="text-xs text-gray-400 dark:text-white/40 mb-1">审批阶段</div>
                                  {approvalItems.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                                      <span>{item.status === 'done' && !item.rejection_reason ? '✅' : item.status === 'cancelled' ? '❌' : '⏳'}</span>
                                      <span className="font-medium">{item.recipient_username}</span>
                                      <span className="text-gray-500 dark:text-white/50">{item.status === 'done' && !item.rejection_reason ? '已通过' : item.status === 'done' && item.rejection_reason ? `已拒绝：${item.rejection_reason}` : item.status === 'cancelled' ? '已取消' : '待审批'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {my_pending_item && ((my_pending_item.item_type === 'completion' && request.current_phase === 'completion') || (my_pending_item.item_type === 'approval' && request.current_phase === 'approval')) && (
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={() => handleApprove(request.id, 'signal', signal.id, request.current_phase)}
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
                      <tr key={`${signal.id}-detail`}
                        style={groupInfo ? { borderLeft: `3px solid ${(() => { const gn = (signal as any).signal_group || ''; const gp = Object.keys({'A_429_':'#818cf8','CAN_Bus_':'#f59e0b','PWR_LV_':'#ef4444','PWR_HV_':'#dc2626','RS422_F_':'#8b5cf6','RS422_':'#a78bfa','RS485_':'#14b8a6','ETH100_':'#22c55e','ETH1000_':'#0ea5e9'}).find(p => gn.startsWith(p)); return gp ? ({'A_429_':'#818cf8','CAN_Bus_':'#f59e0b','PWR_LV_':'#ef4444','PWR_HV_':'#dc2626','RS422_F_':'#8b5cf6','RS422_':'#a78bfa','RS485_':'#14b8a6','ETH100_':'#22c55e','ETH1000_':'#0ea5e9'} as any)[gp] : '#818cf8'; })()}` } : undefined}
                      >
                        <td colSpan={11} className="px-0 py-0 bg-green-50 dark:bg-white/[0.04]">
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
                                    <thead><tr className="text-gray-500 dark:text-white/50"><th className="pr-4 text-left font-medium">字段</th><th className="pr-4 text-left font-medium">原值</th><th className="text-left font-medium">新值</th></tr></thead>
                                    <tbody>
                                      {keys.map(k => (
                                        <tr key={k} className="border-t border-purple-100">
                                          <td className="pr-4 py-0.5 text-gray-600 dark:text-white/60">{k}</td>
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
                                  <ul className="list-disc list-inside text-xs text-gray-700 dark:text-white/70 space-y-0.5 max-h-40 overflow-y-auto">
                                    {conflicts.map((c, i) => <li key={i}>{c}</li>)}
                                  </ul>
                                </div>
                              );
                            })()}

                            {/* 连接摘要 */}
                            {detail.endpoints?.length >= 1 && (
                              <div className="mb-3 font-semibold text-gray-800 dark:text-white text-sm bg-green-100 px-3 py-1.5 rounded">
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
                                    <span className="text-gray-500 dark:text-white/50 w-36 flex-shrink-0">信号ATA:</span>
                                    <span className="text-gray-800 dark:text-white">{v}</span>
                                  </div>
                                );
                              })()}

                              {/* 导线等级（计算值） */}
                              {(detail as any).导线等级 && (
                                <div className="flex gap-2">
                                  <span className="text-gray-500 dark:text-white/50 w-36 flex-shrink-0">导线等级:</span>
                                  <span className="text-gray-800 dark:text-white font-medium">{(detail as any).导线等级}</span>
                                </div>
                              )}

                              {/* 协议标识（仅ARINC 429 / CAN Bus时显示） */}
                              {(detail as any)['协议标识'] && (
                                <div className="flex gap-2">
                                  <span className="text-gray-500 dark:text-white/50 w-36 flex-shrink-0">协议标识:</span>
                                  <span className="text-gray-800 dark:text-white">{(detail as any)['协议标识']}</span>
                                </div>
                              )}

                              {/* 线缆属性 */}
                              {[
                                { key: '线类型',        label: '线类型' },
                                { key: '推荐导线线规', label: '推荐导线线规' },
                                { key: '推荐导线线型', label: '推荐导线线型' },
                                { key: '独立电源代码',  label: '独立电源代码' },
                                { key: '敷设代码',      label: '敷设代码' },
                                { key: '电磁兼容代码',  label: '电磁兼容代码' },
                                { key: '功能代码',      label: '功能代码' },
                                { key: '余度代码',      label: '余度代码' },
                                { key: '接地代码',      label: '接地代码' },
                                ...((detail as any)['线类型'] !== '信号线' ? [
                                  { key: '极性',          label: '极性' },
                                  { key: '额定电压',      label: '额定电压' },
                                  { key: '设备正常工作电压范围', label: '设备正常工作电压范围' },
                                  { key: '额定电流',      label: '额定电流（A）' },
                                ] : []),
                                { key: '信号架次有效性', label: '信号架次有效性' },
                                { key: '是否成品线',    label: '是否成品线' },
                                { key: '备注',          label: '备注' },
                              ].map(f => (
                                <div key={f.key} className="flex gap-2">
                                  <span className="text-gray-500 dark:text-white/50 w-36 flex-shrink-0">{f.label}:</span>
                                  <span className="text-gray-800 dark:text-white">{(detail as any)[f.key] || '-'}</span>
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
                                  <span className="text-gray-500 dark:text-white/50 w-36 flex-shrink-0">{f.label}:</span>
                                  <span className="text-gray-800 dark:text-white">{(detail as any)[f.key] || '-'}</span>
                                </div>
                              ))}
                            </div>

                            {/* 端点详细信息表 */}
                            {detail.endpoints?.length > 0 && (
                              <div>
                                <p className="font-medium text-gray-700 dark:text-white/70 mb-1">信号端点信息</p>
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-green-100">
                                      <th className="px-2 py-1 text-left">端点</th>
                                      <th className="px-2 py-1 text-left">设备编号</th>
                                      <th className="px-2 py-1 text-left">元器件编号</th>
                                      <th className="px-2 py-1 text-left">设备负责人</th>
                                      <th className="px-2 py-1 text-left">针孔号</th>
                                      <th className="px-2 py-1 text-left">端接尺寸</th>
                                      <th className="px-2 py-1 text-left">屏蔽类型</th>
                                      <th className="px-2 py-1 text-left">端点信号名称</th>
                                      <th className="px-2 py-1 text-left">信号定义</th>
                                      <th className="px-2 py-1 text-left">连接</th>
                                      <th className="px-2 py-1 text-left">备注</th>
                                      <th className="px-2 py-1 text-left">状态</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.endpoints.map((ep, i) => {
                                      const epId = (ep as any).id;
                                      const edges = ((detail as any).edges || []) as Array<{ id: number; from_endpoint_id: number; to_endpoint_id: number; direction: string; source_info?: string }>;
                                      const myEdges = edges.filter(e => e.from_endpoint_id === epId || e.to_endpoint_id === epId);
                                      const isEdgeExpanded = expandedEdgeEpIds.has(epId);
                                      return (
                                      <React.Fragment key={i}>
                                      <tr className={`border-b border-green-100 ${!ep.pin_id ? 'bg-orange-50' : ''}`}>
                                        <td className="px-2 py-1 text-gray-500 dark:text-white/50">端点{i + 1}</td>
                                        <td className="px-2 py-1">{ep.设备编号}</td>
                                        <td className="px-2 py-1 font-mono">
                                          {ep.pin_id
                                            ? (ep.设备端元器件编号 || ep.设备编号)
                                            : <span className="text-orange-500 italic">待完善</span>
                                          }
                                        </td>
                                        <td className="px-2 py-1 text-gray-600 dark:text-white/60">{(ep as any).设备负责人 || '-'}</td>
                                        <td className="px-2 py-1">
                                          {ep.pin_id ? ep.针孔号 : <span className="text-orange-500 italic">待完善</span>}
                                        </td>
                                        <td className="px-2 py-1">{(ep as any).pin_端接尺寸 || '-'}</td>
                                        <td className="px-2 py-1">{(ep as any).pin_屏蔽类型 || '-'}</td>
                                        <td className="px-2 py-1">{ep.信号名称 || '-'}</td>
                                        <td className="px-2 py-1 text-gray-600 dark:text-white/60">{ep.信号定义 || '-'}</td>
                                        <td className="px-2 py-1 text-center">
                                          {myEdges.length > 0 ? (
                                            <button
                                              onClick={() => setExpandedEdgeEpIds(prev => {
                                                const n = new Set(prev);
                                                if (n.has(epId)) n.delete(epId); else n.add(epId);
                                                return n;
                                              })}
                                              className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white font-mono text-xs"
                                              title={`${myEdges.length} 条连接`}
                                            >{isEdgeExpanded ? '▼' : '▶'} {myEdges.length}</button>
                                          ) : <span className="text-gray-300 dark:text-white/30">-</span>}
                                        </td>
                                        <td className="px-2 py-1 text-gray-600 dark:text-white/60">{(ep as any).备注 || '-'}</td>
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
                                      {isEdgeExpanded && myEdges.length > 0 && (
                                        <tr>
                                          <td colSpan={12} className="px-0 py-0">
                                            <div className="ml-8 mr-4 my-1 bg-black/[0.03] dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 rounded p-2">
                                              {myEdges.map(edge => {
                                                const isFrom = edge.from_endpoint_id === epId;
                                                const otherEpId = isFrom ? edge.to_endpoint_id : edge.from_endpoint_id;
                                                const otherEp = detail.endpoints.find((e: any) => e.id === otherEpId);
                                                const arrow = edge.direction === 'bidirectional' ? '↔' : isFrom ? '→' : '←';
                                                const dirLabel = edge.direction === 'bidirectional' ? '双向' : '单向';
                                                const otherLabel = otherEp
                                                  ? `${(otherEp as any).设备端元器件编号 || (otherEp as any).设备编号}-${(otherEp as any).针孔号 || '?'} (${(otherEp as any).设备编号})`
                                                  : `endpoint#${otherEpId}`;
                                                return (
                                                  <div key={edge.id} className="flex items-center gap-2 text-xs py-0.5">
                                                    <span className={`font-bold text-sm ${edge.direction === 'bidirectional' ? 'text-purple-600' : 'text-black dark:text-white'}`}>{arrow}</span>
                                                    <span className="font-mono text-gray-800 dark:text-white">{otherLabel}</span>
                                                    <span className="text-gray-400 dark:text-white/40">{dirLabel}</span>
                                                    {edge.source_info && <span className="text-gray-300 dark:text-white/30 ml-auto">{edge.source_info}</span>}
                                                  </div>
                                                );
                                              })}
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
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              });
              })()}
            </tbody>
          </table>
          {/* 渐进加载哨兵 */}
          {hasMore && (
            <div ref={signalSentinelRef} className="py-3 text-center text-xs text-gray-400 dark:text-white/40">
              滚动加载更多... （已显示 {Math.min(signalDisplayCount, reorderedSignals.length)} / {reorderedSignals.length} 条）
            </div>
          )}
        </div>
        );
      })()}

      {/* 底部操作栏已合并到顶部分组模式操作栏 */}

      </div>
    </div>
  );

  // ── 主渲染 ────────────────────────────────────────────────

  return (
    <Layout>
      <div className="px-6 py-4 h-full flex flex-col overflow-hidden">
        {/* 顶部：项目名称 */}
        <div className="mb-3">
          <div className="relative inline-block" ref={projectDropdownRef}>
            <button
              disabled={sgCheckMode}
              onClick={() => setShowProjectDropdown(!showProjectDropdown)}
              className={`inline-flex items-center gap-2 text-3xl font-bold ${sgCheckMode ? 'text-gray-400 dark:text-white/40 cursor-not-allowed' : 'text-gray-900 dark:text-white hover:text-black/70 dark:hover:text-white/70 transition-colors'}`}
            >
              {selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name ?? '（未知项目）' : '请选择项目'}
              <svg className={`w-5 h-5 transition-transform ${showProjectDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showProjectDropdown && projects.length > 0 && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-lg z-50 py-1">
                {projects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setSelectedProjectId(p.id); setShowProjectDropdown(false); }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${p.id === selectedProjectId ? 'bg-black text-white dark:bg-white dark:text-black' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-black dark:text-white'}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedProjectId && canExport && (
            <button
              onClick={() => {
                setDownloadSheets({ devices: true, connectors: true, signals: true, adl: true });
                const m: Record<string, Set<string>> = {};
                DOWNLOAD_SHEETS.forEach(s => { m[s.key] = new Set(s.cols); });
                setDownloadCols(m);
                setShowDownloadModal(true);
              }}
              className="ml-2 btn-secondary text-xs !px-3 !py-1"
            >
              下载项目数据
            </button>
          )}
        </div>

        {/* 视图切换 */}
        <div className={`flex flex-wrap items-center gap-3 mb-3 ${sgCheckMode ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex bg-gray-100 dark:bg-neutral-800 rounded-md p-0.5">
            <button
              onClick={() => setActiveView('devices')}
              className={`px-3 py-1 rounded text-sm ${activeView === 'devices' ? 'bg-white dark:bg-neutral-900 shadow text-black dark:text-white font-medium' : 'text-gray-600 dark:text-white/60'}`}
            >
              设备视图
            </button>
            <button
              onClick={() => setActiveView('section-connectors')}
              className={`px-3 py-1 rounded text-sm ${activeView === 'section-connectors' ? 'bg-white dark:bg-neutral-900 shadow text-black dark:text-white font-medium' : 'text-gray-600 dark:text-white/60'}`}
            >
              断面连接器
            </button>
            <button
              onClick={() => setActiveView('signals')}
              className={`px-3 py-1 rounded text-sm ${activeView === 'signals' ? 'bg-white dark:bg-neutral-900 shadow text-black dark:text-white font-medium' : 'text-gray-600 dark:text-white/60'}`}
            >
              信号视图
            </button>
          </div>
        </div>

        {/* 筛选按钮 */}
        <div id="tour-filter-tabs" className={`flex flex-wrap items-center gap-3 mb-4 justify-between ${sgCheckMode ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex bg-gray-100 dark:bg-neutral-800 rounded-md p-0.5">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 rounded text-sm ${filterMode === 'all' ? 'bg-white dark:bg-neutral-900 shadow text-black dark:text-white font-medium' : 'text-gray-600 dark:text-white/60'}`}
            >
              {activeView === 'signals' ? '全部信号' : '全部设备'}
            </button>
            {(isAdmin || myProjectRole === '系统组') && (
              <button
                onClick={() => setFilterMode('my')}
                className={`px-3 py-1 rounded text-sm ${filterMode === 'my' ? 'bg-white dark:bg-neutral-900 shadow text-black dark:text-white font-medium' : 'text-gray-600 dark:text-white/60'}`}
              >
                {activeView === 'signals' ? '与我有关的信号' : '己方设备'}
              </button>
            )}
            {activeView === 'devices' && (isAdmin || myProjectRole === '系统组') && (
              <button
                onClick={() => setFilterMode('related')}
                className={`px-3 py-1 rounded text-sm ${filterMode === 'related' ? 'bg-white dark:bg-neutral-900 shadow text-teal-600 font-medium' : 'text-gray-600 dark:text-white/60'}`}
              >
                对端设备
              </button>
            )}
            {myProjectRole !== '总体PMO组' && myProjectRole !== '其他组' && (
              <button
                onClick={() => { setFilterMode('my_tasks'); setBatchApprovalIds([]); }}
                className={`px-3 py-1 rounded text-sm ${filterMode === 'my_tasks' ? 'bg-white dark:bg-neutral-900 shadow text-orange-600 font-medium' : 'text-gray-600 dark:text-white/60'}`}
              >
                我的任务
              </button>
            )}
            {activeView === 'signals' && (
              <button
                onClick={() => setFilterMode('networking')}
                className={`px-3 py-1 rounded text-sm ${filterMode === 'networking' ? 'bg-white dark:bg-neutral-900 shadow text-green-600 font-medium' : 'text-gray-600 dark:text-white/60'}`}
              >
                组网信号
              </button>
            )}
          </div>

          {/* 一键审批 */}
          {filterMode === 'my_tasks' && (() => {
            // 收集当前视图所有可审批的 approval_request_id
            const allApprovalIds: number[] = activeView === 'devices'
              ? devices.flatMap((d: any) => {
                  const ids: number[] = [];
                  if (d.pending_item_type === 'approval' && d.approval_request_id) ids.push(d.approval_request_id);
                  if (d.sub_approval_request_ids) ids.push(...d.sub_approval_request_ids);
                  return ids;
                })
              : signals.filter((s: any) => s.pending_item_type === 'approval' && s.approval_request_id).map((s: any) => s.approval_request_id);
            const allChecked = allApprovalIds.length > 0 && allApprovalIds.every(id => batchApprovalIds.includes(id));
            return (
            <div className="flex items-center gap-2 ml-4">
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={e => {
                    if (e.target.checked) setBatchApprovalIds([...new Set([...batchApprovalIds, ...allApprovalIds])]);
                    else setBatchApprovalIds(batchApprovalIds.filter(id => !allApprovalIds.includes(id)));
                  }}
                  className="rounded border-gray-300 dark:border-white/20"
                  disabled={allApprovalIds.length === 0}
                />
                <span className="text-xs text-gray-500 dark:text-white/50">全选</span>
              </label>
              {batchApprovalIds.length > 0 && (
                <span className="text-xs text-gray-500 dark:text-white/50">已选 <span className="font-semibold text-orange-600">{batchApprovalIds.length}</span> 条</span>
              )}
              <button
                onClick={() => setBatchApprovalIds([])}
                className={`px-2 py-1 text-xs rounded ${batchApprovalIds.length > 0 ? 'border border-gray-300 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/[0.04]' : 'hidden'}`}
              >取消选择</button>
              <button
                disabled={batchApprovalIds.length === 0 || batchApproving}
                onClick={async () => {
                  if (!confirm(`确定批量审批通过 ${batchApprovalIds.length} 条待审批任务？`)) return;
                  setBatchApproving(true);
                  try {
                    const res = await fetch('/api/approvals/batch-approve', {
                      method: 'POST',
                      headers: { ...API_HEADERS(), 'Content-Type': 'application/json' },
                      body: JSON.stringify({ request_ids: batchApprovalIds }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                      alert(data.message);
                      setBatchApprovalIds([]);
                      if (activeView === 'devices') loadDevices(); else loadSignals();
                    } else { alert(data.error || '批量审批失败'); }
                  } catch { alert('操作失败'); }
                  finally { setBatchApproving(false); }
                }}
                className={`px-3 py-1 rounded text-xs ${batchApprovalIds.length > 0 && !batchApproving ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-gray-300 text-gray-500 dark:text-white/50 cursor-not-allowed'}`}
              >{batchApproving ? '审批中...' : '一键审批'}</button>
            </div>
            );
          })()}

          {/* 智能助手按钮 */}
          <button
            onClick={() => setShowChat(c => !c)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] border border-gray-200 dark:border-white/10 text-black dark:text-white text-sm hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            智能助手
          </button>
        </div>

        {/* 智能助手浮窗 */}
        {showChat && (
          <div className="fixed bottom-6 right-6 z-50 w-96 bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 flex flex-col" style={{ height: '520px' }}>
            <div className="flex items-center justify-between px-4 py-3 bg-black rounded-t-2xl">
              <div className="flex items-center gap-2 text-white font-medium text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                EICD 智能助手
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setChatMessages([])} className="text-white/60 hover:text-white text-xs">清空</button>
                <button onClick={() => setShowChat(false)} className="text-white/60 hover:text-white">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {chatMessages.length === 0 && (
                <div className="text-center text-gray-400 dark:text-white/40 text-sm mt-8">
                  <p className="text-2xl mb-2">💬</p>
                  <p>你好！我是 EICD 智能助手</p>
                  <p className="mt-1 text-xs">可以问我关于平台操作、字段含义、航空电气规范等问题</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-black text-white dark:bg-white dark:text-black rounded-br-sm'
                      : 'bg-gray-100 text-gray-800 dark:text-white rounded-bl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-500 dark:text-white/50 px-3 py-2 rounded-2xl rounded-bl-sm text-sm">
                    <span className="animate-pulse">正在思考...</span>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-white/10">
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
                  className="flex-1 border border-gray-300 dark:border-white/20 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-black"
                  disabled={chatLoading}
                />
                <button type="submit" disabled={chatLoading || !chatInput.trim()}
                  className="px-3 py-1.5 bg-black text-white dark:bg-white dark:text-black rounded-lg text-sm hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50">
                  发送
                </button>
              </form>
            </div>
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 min-h-0">
        {!selectedProjectId ? (
          <div className="text-center py-16 text-gray-400 dark:text-white/40">
            {projects.length === 0 && !isAdmin
              ? '当前无任何项目权限，请点击右上角灰色齿轮申请项目权限'
              : '请先选择项目'}
          </div>
        ) : activeView === 'devices' ? renderDeviceView()
          : activeView === 'section-connectors' ? renderSectionConnectorView()
          : renderSignalView()}
        </div>

        {/* ── 导入针孔数据弹窗 ── */}
        {showImportPinModal && selectedProjectId && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
                <h2 className="text-xl font-bold">导入针孔数据</h2>
                <button onClick={() => setShowImportPinModal(false)} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-sm">关闭</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {!importPinResult ? (
                  <>
                    <div className="mb-4">
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/devices/pin-import-template?project_id=${selectedProjectId}`, { headers: API_HEADERS() });
                            if (!res.ok) throw new Error('下载失败');
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a'); a.href = url; a.download = `针孔导入模板_${user?.username || 'template'}.xlsx`; a.click();
                            URL.revokeObjectURL(url);
                          } catch { alert('模板下载失败'); }
                        }}
                        className="text-blue-600 hover:text-blue-800 text-sm underline cursor-pointer"
                      >下载导入模板（Excel）</button>
                    </div>
                    <p className="mb-3 text-sm text-gray-600">
                      上传包含针孔数据的 Excel 文件。需包含：设备LIN号（DOORS）、设备端元器件编号、针孔号。
                      {myProjectRole === '系统组' && !isAdmin && <span className="text-orange-600">（仅能导入您负责的设备的针孔）</span>}
                    </p>
                    <input type="file" accept=".xlsx,.xls"
                      onChange={e => setImportPinFile(e.target.files?.[0] || null)}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4"
                    />
                    <button
                      onClick={async () => {
                        if (!importPinFile || !selectedProjectId) return;
                        setImportPinLoading(true);
                        try {
                          const formData = new FormData();
                          formData.append('file', importPinFile);
                          const res = await fetch(`/api/devices/import-pins?project_id=${selectedProjectId}`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                            body: formData,
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || '导入失败');
                          setImportPinResult(data);
                          await loadDevices();
                        } catch (err: any) {
                          setImportPinResult({ error: err.message });
                        } finally {
                          setImportPinLoading(false);
                        }
                      }}
                      disabled={importPinLoading || !importPinFile}
                      className="w-full bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700 disabled:bg-gray-400 text-sm"
                    >{importPinLoading ? '导入中...' : '开始导入'}</button>
                  </>
                ) : importPinResult.error ? (
                  <div>
                    <p className="text-red-600 mb-3">{importPinResult.error}</p>
                    <button onClick={() => setImportPinResult(null)} className="text-blue-600 text-sm">返回重试</button>
                  </div>
                ) : (
                  <div>
                    <div className="mb-3 space-y-1">
                      <p className="text-green-700 font-medium">导入成功 {importPinResult.created} 条</p>
                      {importPinResult.skipped > 0 && <p className="text-gray-500">跳过（已存在） {importPinResult.skipped} 条</p>}
                      {importPinResult.errorCount > 0 && <p className="text-red-600">失败 {importPinResult.errorCount} 条</p>}
                    </div>
                    {importPinResult.errors?.length > 0 && (
                      <div className="border border-red-200 rounded p-2 max-h-40 overflow-y-auto mb-3">
                        <p className="text-xs text-red-600 font-medium mb-1">错误详情：</p>
                        {importPinResult.errors.map((e: string, i: number) => <p key={i} className="text-xs text-red-500">{e}</p>)}
                      </div>
                    )}
                    {importPinResult.skippedList?.length > 0 && (
                      <div className="border border-gray-200 rounded p-2 max-h-32 overflow-y-auto mb-3">
                        <p className="text-xs text-gray-500 font-medium mb-1">跳过详情：</p>
                        {importPinResult.skippedList.map((e: string, i: number) => <p key={i} className="text-xs text-gray-400">{e}</p>)}
                      </div>
                    )}
                    <button onClick={() => setImportPinResult(null)} className="text-blue-600 text-sm">继续导入</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 导入/更新设备数据弹窗 ── */}
        {showImportDevDataModal && selectedProjectId && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-lg w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
                <h2 className="text-xl font-bold">导入设备和连接器数据</h2>
                <button onClick={() => setShowImportDevDataModal(false)} className="px-4 py-2 border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04] text-sm">关闭</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {!importDevResult ? (
                  <>
                    {/* Tab 切换 */}
                    <div className="flex mb-4">
                      <button
                        onClick={() => { setImportDevPhase('devices'); setImportDevFile(null); }}
                        className={`flex-1 px-4 py-2.5 text-sm font-medium border rounded-l-lg ${importDevPhase === 'devices' ? 'bg-black text-white dark:bg-white dark:text-black border-black' : 'bg-white dark:bg-neutral-900 text-gray-600 dark:text-white/60 border-gray-300 dark:border-white/20 hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}
                      >电设备清单</button>
                      <button
                        onClick={() => { setImportDevPhase('connectors'); setImportDevFile(null); }}
                        className={`flex-1 px-4 py-2.5 text-sm font-medium border-t border-b border-r rounded-r-lg ${importDevPhase === 'connectors' ? 'bg-black text-white dark:bg-white dark:text-black border-black' : 'bg-white dark:bg-neutral-900 text-gray-600 dark:text-white/60 border-gray-300 dark:border-white/20 hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}
                      >设备端元器件清单</button>
                    </div>
                    {/* 导入/更新按钮（更新暂时隐藏） */}
                    {/*
                    <div className="flex gap-3 mb-4">
                      <button
                        onClick={() => { setImportDevType('import'); setImportDevFile(null); }}
                        className={`flex-1 px-3 py-2 rounded text-sm border-2 ${importDevType === 'import' ? 'border-black bg-black/[0.03] dark:bg-white/[0.06] text-black dark:text-white font-medium' : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:border-white/20'}`}
                      >导入（新增）</button>
                      <button
                        onClick={() => { setImportDevType('update'); setImportDevFile(null); }}
                        className={`flex-1 px-3 py-2 rounded text-sm border-2 ${importDevType === 'update' ? 'border-orange-500 bg-orange-50 text-orange-700 font-medium' : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:border-white/20'}`}
                      >更新（已有数据）</button>
                    </div>
                    */}
                    <div className="mb-4 text-sm text-gray-600 dark:text-white/60">
                      <p>选择 Excel 文件导入<b>{importDevPhase === 'devices' ? '电设备' : '设备端元器件'}</b>清单数据（新增记录）</p>
                    </div>
                    <input type="file" accept=".xlsx,.xls"
                      onChange={e => setImportDevFile(e.target.files?.[0] || null)}
                      className="w-full border border-gray-300 dark:border-white/20 rounded px-3 py-2 text-sm mb-4"
                    />
                    <button
                      onClick={async () => {
                        if (!importDevFile || !selectedProjectId) return;
                        setImportDevLoading(true);
                        try {
                          const formData = new FormData();
                          formData.append('file', importDevFile);
                          let url: string;
                          if (importDevType === 'import') {
                            url = `/api/projects/${selectedProjectId}/import-data?phase=${importDevPhase}`;
                          } else {
                            url = `/api/projects/${selectedProjectId}/${importDevPhase === 'devices' ? 'update-devices' : 'update-connectors'}`;
                          }
                          const res = await fetch(url, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                            body: formData,
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || '操作失败');
                          setImportDevResult(data);
                          await loadDevices();
                        } catch (err: any) {
                          setImportDevResult({ error: err.message });
                        } finally {
                          setImportDevLoading(false);
                        }
                      }}
                      disabled={importDevLoading || !importDevFile}
                      className="w-full btn-primary disabled:bg-gray-400 text-sm"
                    >{importDevLoading ? '处理中...' : '开始'}</button>
                  </>
                ) : importDevResult.error ? (
                  <div>
                    <p className="text-red-600 mb-3">{importDevResult.error}</p>
                    <button onClick={() => setImportDevResult(null)} className="text-black dark:text-white text-sm">返回重试</button>
                  </div>
                ) : (
                  <div>
                    <div className="mb-3 space-y-1">
                      {importDevResult.updated !== undefined && <p className="text-green-700 font-medium">更新成功 {importDevResult.updated} 条</p>}
                      {importDevResult.results && Object.entries(importDevResult.results).map(([sheet, info]: [string, any]) => (
                        <p key={sheet} className="text-green-700">
                          {sheet}: 成功 {info.success || 0}{info.errors?.length > 0 && <>, 失败 {info.errors.length}</>}
                        </p>
                      ))}
                      {importDevResult.unchanged > 0 && <p className="text-gray-500 dark:text-white/50">数据无变化 {importDevResult.unchanged} 条</p>}
                      {importDevResult.notFound > 0 && <p className="text-yellow-700">未匹配 {importDevResult.notFound} 条</p>}
                    </div>
                    {importDevResult.errors?.length > 0 && (
                      <div className="border border-gray-200 dark:border-white/10 rounded p-2 max-h-40 overflow-y-auto mb-3">
                        {importDevResult.errors.map((e: string, i: number) => <p key={i} className="text-xs text-gray-500 dark:text-white/50">{e}</p>)}
                      </div>
                    )}
                    <button onClick={() => setImportDevResult(null)} className="text-black dark:text-white text-sm">继续操作</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 导入/更新信号数据弹窗 ── */}
        {showImportSigModal && selectedProjectId && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-lg w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
                <h2 className="text-xl font-bold">导入信号及针孔数据</h2>
                <button onClick={() => setShowImportSigModal(false)} className="px-4 py-2 border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04] text-sm">关闭</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {!importSigResult ? (
                  <>
                    {/* 导入/更新切换（更新暂时隐藏） */}
                    {/*
                    <div className="flex gap-3 mb-4">
                      <button
                        onClick={() => { setImportSigType('import'); setImportSigFile(null); }}
                        className={`flex-1 px-3 py-2 rounded text-sm border-2 ${importSigType === 'import' ? 'border-black bg-black/[0.03] dark:bg-white/[0.06] text-black dark:text-white font-medium' : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:border-white/20'}`}
                      >导入电气接口清单</button>
                      <button
                        onClick={() => { setImportSigType('update'); setImportSigFile(null); }}
                        className={`flex-1 px-3 py-2 rounded text-sm border-2 ${importSigType === 'update' ? 'border-orange-500 bg-orange-50 text-orange-700 font-medium' : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:border-white/20'}`}
                      >更新电气接口清单</button>
                    </div>
                    */}
                    <div className="mb-4 text-sm text-gray-600 dark:text-white/60">
                      <p>选择 Excel 文件导入电气接口清单数据（新增信号和端点）</p>
                    </div>
                    <input type="file" accept=".xlsx,.xls"
                      onChange={e => setImportSigFile(e.target.files?.[0] || null)}
                      className="w-full border border-gray-300 dark:border-white/20 rounded px-3 py-2 text-sm mb-4"
                    />
                    <button
                      onClick={async () => {
                        if (!importSigFile || !selectedProjectId) return;
                        setImportSigLoading(true);
                        try {
                          const formData = new FormData();
                          formData.append('file', importSigFile);
                          const url = importSigType === 'import'
                            ? `/api/projects/${selectedProjectId}/import-data?phase=signals`
                            : `/api/projects/${selectedProjectId}/update-signals`;
                          const res = await fetch(url, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                            body: formData,
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || '操作失败');
                          setImportSigResult(data);
                          await loadSignals();
                        } catch (err: any) {
                          setImportSigResult({ error: err.message });
                        } finally {
                          setImportSigLoading(false);
                        }
                      }}
                      disabled={importSigLoading || !importSigFile}
                      className="w-full btn-primary disabled:bg-gray-400 text-sm"
                    >{importSigLoading ? '处理中...' : '开始'}</button>
                  </>
                ) : importSigResult.error ? (
                  <div>
                    <p className="text-red-600 mb-3">{importSigResult.error}</p>
                    <button onClick={() => setImportSigResult(null)} className="text-black dark:text-white text-sm">返回重试</button>
                  </div>
                ) : (
                  <div>
                    <div className="mb-3 space-y-1">
                      {importSigResult.updated !== undefined && <p className="text-green-700 font-medium">更新成功 {importSigResult.updated} 条</p>}
                      {importSigResult.results && Object.entries(importSigResult.results).map(([sheet, info]: [string, any]) => (
                        <p key={sheet} className="text-green-700">
                          {sheet}: 成功 {info.success || 0}{info.merged ? `, 合并 ${info.merged}` : ''}{info.errors?.length > 0 && `, 失败 ${info.errors.length}`}
                        </p>
                      ))}
                      {importSigResult.unchanged > 0 && <p className="text-gray-500 dark:text-white/50">数据无变化 {importSigResult.unchanged} 条</p>}
                      {importSigResult.notFound > 0 && <p className="text-yellow-700">未匹配 {importSigResult.notFound} 条</p>}
                    </div>
                    {importSigResult.errors?.length > 0 && (
                      <div className="border border-gray-200 dark:border-white/10 rounded p-2 max-h-40 overflow-y-auto mb-3">
                        {importSigResult.errors.map((e: string, i: number) => <p key={i} className="text-xs text-gray-500 dark:text-white/50">{e}</p>)}
                      </div>
                    )}
                    <button onClick={() => setImportSigResult(null)} className="text-black dark:text-white text-sm">继续操作</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 管理信号组弹窗已移除，改为列表内联勾选模式 */}

        {/* ── 下载配置弹窗 ── */}
        {showDownloadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
                <h2 className="text-xl font-bold">下载项目数据</h2>
                <div className="flex gap-2">
                  <button onClick={() => setShowDownloadModal(false)} className="px-4 py-2 border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04] text-sm">取消</button>
                  <button
                    onClick={async () => {
                      if (!selectedProjectId) return;
                      setDownloading(true);
                      try {
                        const params = new URLSearchParams();
                        const selectedS = Object.entries(downloadSheets).filter(([, v]) => v).map(([k]) => k);
                        params.set('sheets', selectedS.join(','));
                        for (const s of DOWNLOAD_SHEETS) {
                          if (s.cols.length > 0 && downloadSheets[s.key]) {
                            const selected = s.cols.filter(c => downloadCols[s.key]?.has(c));
                            if (selected.length < s.cols.length) params.set(`cols_${s.key}`, selected.join('||'));
                          }
                        }
                        const res = await fetch(`/api/projects/${selectedProjectId}/download?${params.toString()}`, { headers: API_HEADERS() });
                        if (!res.ok) throw new Error((await res.json()).error || '下载失败');
                        const blob = await res.blob();
                        const projectName = projects.find(p => p.id === selectedProjectId)?.name || '项目';
                        const filename = `${projectName}_${new Date().toISOString().split('T')[0]}.xlsx`;
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = filename;
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);
                        setShowDownloadModal(false);
                      } catch (e: any) { alert(e.message || '下载失败'); }
                      finally { setDownloading(false); }
                    }}
                    disabled={downloading || !Object.values(downloadSheets).some(v => v)}
                    className="px-4 py-2 btn-primary disabled:bg-gray-400 text-sm"
                  >{downloading ? '下载中...' : '下载'}</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {DOWNLOAD_SHEETS.map(sheet => (
                  <div key={sheet.key} className="mb-4 border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-white/10">
                      <input type="checkbox" checked={downloadSheets[sheet.key] || false}
                        onChange={e => setDownloadSheets({ ...downloadSheets, [sheet.key]: e.target.checked })} className="rounded" />
                      <span className="font-medium text-sm">{sheet.name}</span>
                      {sheet.cols.length > 0 && downloadSheets[sheet.key] && (
                        <span className="text-xs text-gray-400 dark:text-white/40 ml-auto">
                          {downloadCols[sheet.key]?.size || 0} / {sheet.cols.length} 列
                          <button onClick={() => setDownloadCols(prev => ({ ...prev, [sheet.key]: new Set(sheet.cols) }))}
                            className="ml-2 text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">全选</button>
                          <button onClick={() => setDownloadCols(prev => ({ ...prev, [sheet.key]: new Set() }))}
                            className="ml-1 text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">清空</button>
                        </span>
                      )}
                    </div>
                    {sheet.cols.length > 0 && downloadSheets[sheet.key] && (
                      <div className="px-3 py-2 grid grid-cols-3 gap-1">
                        {sheet.cols.map(col => (
                          <label key={col} className="flex items-center gap-1 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.04] px-1 py-0.5 rounded">
                            <input type="checkbox" checked={downloadCols[sheet.key]?.has(col) || false}
                              onChange={e => {
                                setDownloadCols(prev => {
                                  const s = new Set(prev[sheet.key]);
                                  if (e.target.checked) s.add(col); else s.delete(col);
                                  return { ...prev, [sheet.key]: s };
                                });
                              }} className="rounded" />
                            <span className="truncate" title={col}>{col}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {sheet.cols.length === 0 && downloadSheets[sheet.key] && (
                      <div className="px-3 py-2 text-xs text-gray-400 dark:text-white/40">导出全部列（不可选择）</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── 切换项目弹窗 ── */}
        {showSwitchProjectModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg p-6 w-80">
              <h2 className="text-lg font-bold mb-4">切换项目</h2>
              <select
                value={switchProjectTargetId}
                onChange={e => setSwitchProjectTargetId(e.target.value === '' ? '' : parseInt(e.target.value))}
                className="w-full border border-gray-300 dark:border-white/20 rounded-md px-3 py-2 text-sm mb-4"
              >
                <option value="">请选择项目</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowSwitchProjectModal(false)}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04]"
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
                  className="px-4 py-2 text-sm btn-primary"
                >
                  确认切换
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 设备弹窗 ── */}
        {showDeviceModal && (() => {
          const devDirty = JSON.stringify(deviceForm) !== deviceFormSnapshot;
          return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col">
              {(() => {
                const editVe = parseValidationErrors(editingDevice?.validation_errors);
                const hasHardError = Object.values(fieldWarnings).some(w => w.type === 'error');
                return (<>
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10 shrink-0">
                <h2 className="text-base font-bold text-black dark:text-white tracking-snug">{editingDevice ? '编辑设备' : '添加设备'}</h2>
                <div className="flex items-center gap-2">
                  {devDirty && (
                    <>
                      <button onClick={() => saveDevice(true)} className="btn-secondary text-xs !px-3 !py-1">保存为 Draft</button>
                      <button
                        onClick={() => saveDevice(false)}
                        disabled={hasHardError}
                        className={`text-xs !px-3 !py-1 ${hasHardError ? 'btn-secondary !text-black/30 dark:text-white/30 !border-gray-200 dark:border-white/10 cursor-not-allowed' : 'btn-primary'}`}
                        title={hasHardError ? '存在校验错误（红色标记），请先修正' : undefined}
                      >提交审批</button>
                      <div className="w-px h-4 bg-gray-200 mx-1" />
                    </>
                  )}
                  <button onClick={closeDeviceModal} className="text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors" title="关闭">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                {DEVICE_FIELDS.map(f => {
                  // 导入来源为空时不显示
                  if (f.key === '导入来源' && !(deviceForm as any)['导入来源']) return null;
                  const isErr = editVe.fields.includes(String(f.key));
                  const fw = fieldWarnings[f.key as string];
                  return (
                  <div key={f.key}>
                    <label className={`block text-xs mb-1 ${isErr ? 'text-red-600 font-medium' : 'text-gray-600 dark:text-white/60'}`}>
                      {f.label}{(f.key === '设备编号' || f.key === '设备部件所属系统（4位ATA）' || f.key === '设备负责人') ? <span className="text-red-500"> *</span> : ''}
                      {fw && <span className={`ml-1 ${fw.type === 'error' ? 'text-red-600' : 'text-orange-500'}`}>({fw.message})</span>}
                    </label>
                    {(f.key === 'created_by' || f.key === '导入来源') ? (
                      <div className="w-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-neutral-800 rounded px-2 py-1 text-sm text-gray-500 dark:text-white/50 break-all"
                        title={(deviceForm as any)[f.key] || undefined}>
                        {(deviceForm as any)[f.key] || '-'}
                      </div>
                    ) : f.key === '设备负责人' ? (
                      myProjectRole === '系统组' && !isAdmin ? (
                        /* 系统组：其他组，固定为自己 */
                        <div className="w-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-neutral-800 rounded px-2 py-1 text-sm text-gray-700 dark:text-white/70">
                          {(deviceForm as any)[f.key] || '-'}
                          {(deviceForm as any)[f.key] && employeeNameMap[(deviceForm as any)[f.key]] && <span className="text-gray-400 dark:text-white/40 ml-1">({employeeNameMap[(deviceForm as any)[f.key]]})</span>}
                        </div>
                      ) : (
                        /* admin / 总体组：可选择系统组 */
                        <select
                          value={(deviceForm as any)[f.key] || ''}
                          onChange={e => setDeviceForm({ ...deviceForm, [f.key]: e.target.value })}
                          className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                        >
                          <option value="">请选择</option>
                          {myProjectRole === '总体组' && !isAdmin
                            ? /* 总体组：只能选系统组 */
                              memberRoles
                                .filter(r => r.project_role === '系统组')
                                .map(r => (
                                  <option key={r.username} value={r.username}>{r.username}{employeeNameMap[r.username] ? ` (${employeeNameMap[r.username]})` : ''}</option>
                                ))
                            : /* admin：可选除总体组之外的所有成员 */
                              projectMembers
                                .filter(m => !memberRoles.some(r => r.username === m && r.project_role === '总体组'))
                                .map(m => (
                                  <option key={m} value={m}>{m}{employeeNameMap[m] ? ` (${employeeNameMap[m]})` : ''}</option>
                                ))
                          }
                        </select>
                      )
                    ) : f.key === '设备装机构型' ? (
                      <div className="border border-gray-300 dark:border-white/20 rounded px-2 py-1.5 text-sm max-h-32 overflow-y-auto">
                        {projectConfigurations.length === 0 ? (
                          <span className="text-gray-400 dark:text-white/40 text-xs">暂无构型，请先在项目管理中添加</span>
                        ) : (
                          projectConfigurations.map(c => {
                            const selected = ((deviceForm as any)['设备装机构型'] || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                            const checked = selected.includes(c.name);
                            return (
                              <label key={c.id} className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.04]">
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
                          className="w-20 border border-gray-300 dark:border-white/20 rounded px-1 py-1 text-sm flex-shrink-0"
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
                          className={`flex-1 border rounded px-2 py-1 text-sm ${fw ? (fw.type === 'error' ? 'border-red-400' : 'border-orange-400') : 'border-gray-300 dark:border-white/20'}`}
                        />
                      </div>
                    ) : f.key === '设备DAL' ? (
                      <select
                        value={(deviceForm as any)[f.key] || ''}
                        onChange={e => setDeviceForm({ ...deviceForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                      >
                        <option value="">请选择</option>
                        {['A', 'B', 'C', 'D', 'E', '其他'].map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    ) : f.key === '设备等级' ? (
                      <select
                        value={(deviceForm as any)[f.key] || ''}
                        onChange={e => setDeviceForm({ ...deviceForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                      >
                        <option value="">请选择</option>
                        {['1级', '2级', '3级', '4级', '5级'].map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    ) : f.key === '设备负责人' ? (
                      <select
                        value={(deviceForm as any)[f.key] || ''}
                        onChange={e => setDeviceForm({ ...deviceForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                      >
                        <option value="">请选择系统组成员</option>
                        {memberRoles.filter(m => m.project_role === '系统组').map(m => (
                          <option key={m.username} value={m.username}>{m.username}</option>
                        ))}
                      </select>
                    ) : (f.key === '设备壳体是否金属' || f.key === '是否为选装设备' || f.key === '壳体接地是否故障电流路径' || f.key === '是否有特殊布线需求') ? (
                      <select
                        value={(deviceForm as any)[f.key] || ''}
                        onChange={e => setDeviceForm({ ...deviceForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
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
                        className={`w-full border rounded px-2 py-1 text-sm ${fw ? (fw.type === 'error' ? 'border-red-400' : 'border-orange-400') : 'border-gray-300 dark:border-white/20'}`}
                      />
                    )}
                  </div>
                  );
                })}
              </div>
              </div>
                </>);
              })()}
            </div>
          </div>
          );
        })()}

        {/* ── 连接器弹窗 ── */}
        {showConnectorModal && (() => {
          const connDirty = JSON.stringify(connectorForm) !== connectorFormSnapshot;
          return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-lg w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10 shrink-0">
                <h2 className="text-base font-bold text-black dark:text-white tracking-snug">{editingConnector ? '编辑连接器' : '添加连接器'}</h2>
                <div className="flex items-center gap-2">
                  {connDirty && (
                    <>
                      <button onClick={() => saveConnector(true)} className="btn-secondary text-xs !px-3 !py-1">保存为 Draft</button>
                      <button onClick={() => saveConnector(false)} className="btn-primary text-xs !px-3 !py-1">提交审批</button>
                      <div className="w-px h-4 bg-gray-200 mx-1" />
                    </>
                  )}
                  <button onClick={closeConnectorModal} className="text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors" title="关闭">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* ── 设备端元器件编号（结构化输入）── */}
              {(() => {
                const targetDevice = devices.find(d => d.id === connectorTargetDeviceId);
                const lin = (targetDevice as any)?.['设备LIN号（DOORS）'] || '';
                const ata = (targetDevice as any)?.['设备部件所属系统（4位ATA）'] || '';
                const currentCompId = String((connectorForm as any)['设备端元器件编号'] || '');

                // 从已有编号解析各段
                const afterLin = currentCompId.startsWith(lin + '-') ? currentCompId.slice(lin.length + 1) : '';

                let mode: 'sp' | 'dism' | 'ata86' | 'normal' = 'normal';
                if (lin === '8810G0000') mode = 'sp';
                else if (lin === '8820G0000') mode = 'dism';
                else if (ata && ata.startsWith('86')) mode = 'ata86';

                // 解析各段
                let suffixType = '', suffixNum = '', dismNum1 = '', dismNum2 = '', dismRP = '';
                if (mode === 'sp') {
                  suffixNum = afterLin.replace(/^SP/, '');
                } else if (mode === 'dism') {
                  const m = afterLin.match(/^D(\d*)(?:-(\d*)(?:-(R|P)?)?)?$/);
                  if (m) { dismNum1 = m[1] || ''; dismNum2 = m[2] || ''; dismRP = m[3] || ''; }
                } else if (mode === 'ata86') {
                  const m = afterLin.match(/^(G|N|P|NA|J)(\d*)$/);
                  if (m) { suffixType = m[1]; suffixNum = m[2] || ''; }
                } else {
                  const m = afterLin.match(/^(J|TB|M|NA)(\d*)(.*)$/);
                  if (m) { suffixType = m[1]; suffixNum = m[2] || ''; if (m[3]) suffixNum += m[3]; }
                }

                // 组装编号
                const buildCompId = (type: string, num: string, n1?: string, n2?: string, rp?: string) => {
                  if (mode === 'sp') return `${lin}-SP${num}`;
                  if (mode === 'dism') return `${lin}-D${n1 || ''}${n2 ? '-' + n2 : ''}${rp ? '-' + rp : ''}`;
                  if (type === 'NA') return `${lin}-NA`;
                  if (type === 'G' || type === 'N' || type === 'P') return `${lin}-${type}`;
                  return `${lin}-${type}${num}`;
                };

                const updateCompId = (newVal: string) => {
                  setConnectorForm({ ...connectorForm, '设备端元器件编号': newVal });
                };

                return (
                <div className="mb-3">
                  <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">设备端元器件编号 <span className="text-red-500">*</span></label>
                  <div className="flex items-center gap-1 text-sm">
                    <span className="text-gray-500 dark:text-white/50 font-mono shrink-0">{lin}-</span>

                    {mode === 'sp' && (<>
                      <span className="text-gray-500 dark:text-white/50 font-mono shrink-0">SP</span>
                      <input type="text" value={suffixNum} maxLength={5} placeholder="5位数字"
                        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 5); updateCompId(`${lin}-SP${v}`); }}
                        className="w-24 border border-gray-300 dark:border-white/20 rounded px-2 py-1 font-mono" />
                    </>)}

                    {mode === 'dism' && (<>
                      <span className="text-gray-500 dark:text-white/50 font-mono shrink-0">D</span>
                      <input type="text" value={dismNum1} maxLength={4} placeholder="4位"
                        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); updateCompId(buildCompId('', '', v, dismNum2, dismRP)); }}
                        className="w-16 border border-gray-300 dark:border-white/20 rounded px-2 py-1 font-mono" />
                      <span className="text-gray-500 dark:text-white/50">-</span>
                      <input type="text" value={dismNum2} maxLength={3} placeholder="3位"
                        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 3); updateCompId(buildCompId('', '', dismNum1, v, dismRP)); }}
                        className="w-14 border border-gray-300 dark:border-white/20 rounded px-2 py-1 font-mono" />
                      <span className="text-gray-500 dark:text-white/50">-</span>
                      <select value={dismRP}
                        onChange={e => updateCompId(buildCompId('', '', dismNum1, dismNum2, e.target.value))}
                        className="border border-gray-300 dark:border-white/20 rounded px-2 py-1 bg-white dark:bg-neutral-900">
                        <option value="">选择</option>
                        <option value="R">R</option>
                        <option value="P">P</option>
                      </select>
                    </>)}

                    {mode === 'ata86' && (<>
                      <select value={suffixType}
                        onChange={e => { const t = e.target.value; updateCompId(buildCompId(t, t === 'J' ? suffixNum : '')); }}
                        className="border border-gray-300 dark:border-white/20 rounded px-2 py-1 bg-white dark:bg-neutral-900">
                        <option value="">选择类型</option>
                        <option value="G">G</option>
                        <option value="N">N</option>
                        <option value="P">P</option>
                        <option value="NA">NA</option>
                        <option value="J">J</option>
                      </select>
                      {suffixType === 'J' && (
                        <input type="text" value={suffixNum} placeholder="数字"
                          onChange={e => { const v = e.target.value.replace(/\D/g, ''); updateCompId(`${lin}-J${v}`); }}
                          className="w-20 border border-gray-300 dark:border-white/20 rounded px-2 py-1 font-mono" />
                      )}
                    </>)}

                    {mode === 'normal' && (<>
                      <select value={suffixType}
                        onChange={e => { const t = e.target.value; updateCompId(buildCompId(t, t === 'NA' ? '' : suffixNum)); }}
                        className="border border-gray-300 dark:border-white/20 rounded px-2 py-1 bg-white dark:bg-neutral-900">
                        <option value="">选择类型</option>
                        <option value="J">J</option>
                        <option value="TB">TB</option>
                        <option value="M">M</option>
                        <option value="NA">NA</option>
                      </select>
                      {suffixType && suffixType !== 'NA' && (
                        <input type="text" value={suffixNum} placeholder="数字"
                          onChange={e => { const v = e.target.value.replace(/\D/g, ''); updateCompId(`${lin}-${suffixType}${v}`); }}
                          className="w-20 border border-gray-300 dark:border-white/20 rounded px-2 py-1 font-mono" />
                      )}
                    </>)}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-white/40 mt-0.5 font-mono">{currentCompId || `${lin}-...`}</div>
                </div>);
              })()}

              {/* ── 其他连接器字段 ── */}
              {[
                { key: '设备端元器件名称及类型', label: '设备端元器件名称及类型' },
                { key: '设备端元器件件号类型及件号', label: '设备端元器件件号类型及件号' },
                { key: '设备端元器件供应商名称', label: '设备端元器件供应商名称' },
                { key: '匹配的线束端元器件件号', label: '匹配的线束端元器件件号' },
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
                  <label className={`block text-xs mb-1 ${deliverInvalid ? 'text-red-600 font-medium' : 'text-gray-600 dark:text-white/60'}`}>
                    {f.label}
                    {deliverInvalid && <span className="ml-2 font-normal">（当前值：<span className="font-medium">{deliverVal}</span>）</span>}
                  </label>
                  {isDeliverField ? (
                    <select
                      value={deliverInvalid ? '' : deliverVal}
                      onChange={e => setConnectorForm({ ...connectorForm, [f.key]: e.target.value })}
                      className={`w-full border rounded px-2 py-1 text-sm bg-white dark:bg-neutral-900 ${deliverInvalid ? 'border-red-400' : 'border-gray-300 dark:border-white/20'}`}
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
                      className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                    />
                  )}
                </div>
              ); })}
              </div>
            </div>
          </div>
          );
        })()}

        {/* ── 断面连接器弹窗 ── */}
        {showSCModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-sm w-full flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
                <h2 className="text-xl font-bold">{editingSC ? '编辑断面连接器' : '添加断面连接器'}</h2>
                <div className="flex gap-2">
                  <button onClick={() => setShowSCModal(false)} className="px-4 py-2 border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04] text-sm">取消</button>
                  <button onClick={saveSC} className="px-4 py-2 btn-primary text-sm">保存</button>
                </div>
              </div>
              <div className="px-6 py-4">
              <div className="mb-3">
                <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">设备名称 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={scForm['设备名称'] || ''}
                  onChange={e => setSCForm({ ...scForm, '设备名称': e.target.value })}
                  className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                  placeholder="请输入设备名称"
                />
              </div>
              <div className="mb-3">
                <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">负责人</label>
                {isAdmin ? (
                  <select
                    value={scForm['负责人'] || ''}
                    onChange={e => setSCForm({ ...scForm, '负责人': e.target.value })}
                    className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm bg-white dark:bg-neutral-900"
                  >
                    <option value="">请选择（仅限项目成员）</option>
                    {projectMembers.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-neutral-800 rounded px-2 py-1 text-sm text-gray-700 dark:text-white/70">
                    {scForm['负责人'] || '-'}
                  </div>
                )}
              </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 断面连接器-连接器弹窗 ── */}
        {showSCConnectorModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-lg w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
                <h2 className="text-xl font-bold">{editingSCConnector ? '编辑连接器' : '添加连接器'}</h2>
                <div className="flex gap-2">
                  <button onClick={() => setShowSCConnectorModal(false)} className="px-4 py-2 border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04] text-sm">取消</button>
                  <button onClick={saveSCConnector} className="px-4 py-2 btn-primary text-sm">保存</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
              {[
                { key: '连接器号', label: '连接器号 *' },
                { key: '设备端元器件编号', label: '设备端元器件编号' },
                { key: '设备端元器件名称及类型', label: '设备端元器件名称及类型' },
                { key: '设备端元器件件号类型及件号', label: '设备端元器件件号类型及件号' },
                { key: '设备端元器件供应商名称', label: '设备端元器件供应商名称' },
                { key: '匹配的线束端元器件件号', label: '匹配的线束端元器件件号' },
                { key: '设备端元器件匹配的元器件是否随设备交付', label: '设备端元器件匹配的元器件是否随设备交付' },
                { key: '备注', label: '备注' },
              ].map(f => {
                const isDeliverField = f.key === '设备端元器件匹配的元器件是否随设备交付';
                return (
                  <div key={f.key} className="mb-3">
                    <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">
                      {f.label.endsWith(' *') ? <>{f.label.slice(0, -2)}<span className="text-red-500"> *</span></> : f.label}
                    </label>
                    {isDeliverField ? (
                      <select
                        value={String((scConnectorForm as any)[f.key] || '')}
                        onChange={e => setSCConnectorForm({ ...scConnectorForm, [f.key]: e.target.value })}
                        className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm bg-white dark:bg-neutral-900"
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
                        className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                      />
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        )}

        {/* ── 断面连接器-针孔弹窗 ── */}
        {showSCPinModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-sm w-full flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
                <h2 className="text-xl font-bold">{editingSCPin ? '编辑针孔' : '添加针孔'}</h2>
                <div className="flex gap-2">
                  <button onClick={() => setShowSCPinModal(false)} className="px-4 py-2 border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04] text-sm">取消</button>
                  <button onClick={saveSCPin} className="px-4 py-2 btn-primary text-sm">保存</button>
                </div>
              </div>
              <div className="px-6 py-4">
              {[
                { key: '针孔号', label: '针孔号 *' },
                { key: '端接尺寸', label: '端接尺寸' },
                { key: '屏蔽类型', label: '屏蔽类型' },
                { key: '备注', label: '备注' },
              ].map(f => (
                <div key={f.key} className="mb-3">
                  <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">
                    {f.label.endsWith(' *') ? <>{f.label.slice(0, -2)}<span className="text-red-500"> *</span></> : f.label}
                  </label>
                  <input
                    type="text"
                    value={String((scPinForm as any)[f.key] || '')}
                    onChange={e => setSCPinForm({ ...scPinForm, [f.key]: e.target.value })}
                    className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                  />
                </div>
              ))}
              </div>
            </div>
          </div>
        )}

        {/* ── 针孔弹窗 ── */}
        {showPinModal && (() => {
          const pinDirty = JSON.stringify(pinForm) !== pinFormSnapshot;
          return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-lg w-full flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10 shrink-0">
                <h2 className="text-base font-bold text-black dark:text-white tracking-snug">{editingPin ? '编辑针孔' : '添加针孔'}</h2>
                <div className="flex items-center gap-2">
                  {pinDirty && (
                    <>
                      <button onClick={() => savePin(true)} className="btn-secondary text-xs !px-3 !py-1">保存为 Draft</button>
                      <button onClick={() => savePin(false)} className="btn-primary text-xs !px-3 !py-1">提交审批</button>
                      <div className="w-px h-4 bg-gray-200 mx-1" />
                    </>
                  )}
                  <button onClick={closePinModal} className="text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors" title="关闭">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              <div className="px-6 py-4">
              {[
                { key: '针孔号', label: '针孔号 *' },
                { key: '备注', label: '备注' },
              ].map(f => (
                <div key={f.key} className="mb-3">
                  <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">
                    {f.label.endsWith(' *') ? <>{f.label.slice(0, -2)}<span className="text-red-500"> *</span></> : f.label}
                  </label>
                  <input
                    type="text"
                    value={(pinForm as any)[f.key] || ''}
                    onChange={e => setPinForm({ ...pinForm, [f.key]: e.target.value })}
                    className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                  />
                </div>
              ))}
              </div>
            </div>
          </div>
          );
        })()}

        {/* ── 合并连接器弹窗 ── */}
        {showMergeConnModal && mergeConnDeviceId && (() => {
          const deviceConns = connectors[mergeConnDeviceId] || [];
          const targetConn = deviceConns.find(c => c.id === mergeConnTarget);
          const sourceConns = deviceConns.filter(c => mergeConnSources.has(c.id));
          return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-xl w-full max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
                <h2 className="text-xl font-bold">合并连接器</h2>
                <div className="flex gap-2">
                  <button onClick={() => setShowMergeConnModal(false)} className="px-4 py-2 border border-gray-300 dark:border-white/20 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04] text-sm">取消</button>
                  <button
                    onClick={executeMergeConnectors}
                    disabled={merging || !mergeConnTarget || mergeConnSources.size === 0}
                    className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400 text-sm"
                  >{merging ? '合并中...' : '确认合并'}</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {/* 选择目标连接器 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-1">目标连接器（合并到）</label>
                  <select
                    value={mergeConnTarget}
                    onChange={e => {
                      const id = Number(e.target.value);
                      setMergeConnTarget(id || '');
                      setMergeConnSources(prev => { const n = new Set(prev); n.delete(id); return n; });
                    }}
                    className="w-full border border-gray-300 dark:border-white/20 rounded px-3 py-2 text-sm"
                  >
                    <option value="">请选择目标连接器</option>
                    {deviceConns.map(c => (
                      <option key={c.id} value={c.id}>{c.设备端元器件编号}（{c.pin_count ?? 0} 个针孔）</option>
                    ))}
                  </select>
                </div>

                {/* 选择源连接器 */}
                {mergeConnTarget && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-white/70 mb-1">要合并的连接器（多选）</label>
                    <div className="border border-gray-200 dark:border-white/10 rounded max-h-48 overflow-y-auto">
                      {deviceConns.filter(c => c.id !== mergeConnTarget).map(c => (
                        <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={mergeConnSources.has(c.id)}
                            onChange={e => {
                              setMergeConnSources(prev => {
                                const n = new Set(prev);
                                if (e.target.checked) n.add(c.id); else n.delete(c.id);
                                return n;
                              });
                            }}
                            className="rounded"
                          />
                          <span>{c.设备端元器件编号}</span>
                          <span className="text-gray-400 dark:text-white/40 text-xs">（{c.pin_count ?? 0} 个针孔）</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* 预览 */}
                {mergeConnTarget && mergeConnSources.size > 0 && (
                  <div className="bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-white/10 rounded p-3 text-xs">
                    <p className="font-medium text-gray-700 dark:text-white/70 mb-2">合并预览</p>
                    <p className="text-gray-600 dark:text-white/60 mb-1">
                      目标 <span className="font-mono font-medium">{targetConn?.设备端元器件编号}</span> 合并后将包含：
                    </p>
                    <ul className="ml-4 text-gray-600 dark:text-white/60 space-y-0.5">
                      <li>原有针孔：{targetConn?.pin_count ?? 0} 个（编号不变）</li>
                      {sourceConns.map(sc => (
                        <li key={sc.id}>
                          来自 <span className="font-mono">{sc.设备端元器件编号}</span>：{sc.pin_count ?? 0} 个针孔
                          {(() => {
                            const dev = devices.find(d => d.id === mergeConnDeviceId);
                            const lin = (dev as any)?.['设备LIN号（DOORS）'] || '';
                            const short = sc.设备端元器件编号.startsWith(lin + '-') ? sc.设备端元器件编号.slice(lin.length + 1) : sc.设备端元器件编号;
                            return <>（针孔号变为 <span className="font-mono">{short}-原针孔号</span>）</>;
                          })()}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-red-600">
                      将删除 {mergeConnSources.size} 个连接器：{sourceConns.map(c => c.设备端元器件编号).join('、')}
                    </p>
                    <p className="text-gray-500 dark:text-white/50 mt-1">信号端点不受影响（pin_id 不变）</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })()}

        {/* ── 信号弹窗 ── */}
        {showSignalModal && (() => {
          const sigDirty = JSON.stringify({ form: signalForm, endpoints: signalEndpoints }) !== signalFormSnapshot;
          return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-neutral-900 rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10 shrink-0">
                <h2 className="text-base font-bold text-black dark:text-white tracking-snug">{editingSignal ? '编辑信号' : '添加信号'}</h2>
                <div className="flex items-center gap-2">
                  {sigDirty && (
                    <>
                      {/* Draft 保存 */}
                      {!editingSignal && (
                        <button onClick={() => saveSignal(true)} className="btn-secondary text-xs !px-3 !py-1">保存为 Draft</button>
                      )}
                      {editingSignal && editingSignal.status === 'Draft' && (
                        <button onClick={() => saveSignal(false, false)} className="btn-secondary text-xs !px-3 !py-1">保存为 Draft</button>
                      )}
                      {editingSignal && editingSignal.status !== 'Draft' && (
                        <button onClick={() => saveSignal(true)} className="btn-secondary text-xs !px-3 !py-1">保存为 Draft</button>
                      )}
                      {/* 提交/保存 */}
                      {(!editingSignal || editingSignal.status === 'Draft') && (
                        <button
                          onClick={() => editingSignal ? saveSignal(false, true) : saveSignal(false)}
                          className="btn-primary text-xs !px-3 !py-1"
                        >提交</button>
                      )}
                      {editingSignal && editingSignal.status !== 'Draft' && (
                        <button onClick={() => saveSignal()} className="btn-primary text-xs !px-3 !py-1">保存</button>
                      )}
                      <div className="w-px h-4 bg-gray-200 mx-1" />
                    </>
                  )}
                  <button onClick={closeSignalModal} className="text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors" title="关闭">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">

              {/* 信号属性 */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Unique ID */}
                <div>
                  <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">
                    Unique ID {isAdmin && <span className="text-red-500">*</span>}
                    {!isAdmin && <span className="text-gray-400 dark:text-white/30 text-xs ml-1">（保存时自动生成）</span>}
                  </label>
                  {isAdmin ? (
                    <input
                      type="text"
                      value={(signalForm as any).unique_id || ''}
                      onChange={e => setSignalForm({ ...signalForm, unique_id: e.target.value })}
                      className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                    />
                  ) : (
                    <input
                      type="text"
                      value={editingSignal ? ((signalForm as any).unique_id || '') : '（保存时自动生成）'}
                      readOnly
                      className="w-full border border-gray-200 dark:border-white/10 rounded px-2 py-1 text-sm bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-white/40 cursor-not-allowed"
                    />
                  )}
                </div>
                {/* 其余字段 */}
                {(() => {
                  const 成品线子字段: (keyof SignalRow)[] = ['成品线件号','成品线线规','成品线类型','成品线长度','成品线载流量','成品线线路压降','成品线标识','成品线与机上线束对接方式','成品线安装责任'];
                  const 功率线字段: (keyof SignalRow)[] = ['极性', '额定电压', '额定电流', '设备正常工作电压范围'];
                  const isY = (signalForm as any)['是否成品线'] === 'Y';
                  const is信号线 = (signalForm as any)['线类型'] === '信号线';
                  const connType = (signalForm as any)['连接类型'] || '';
                  const POWER_CONN_TYPES = new Set(['电源（低压）', '电源（高压）']);
                  const SIGNAL_CONN_TYPES = new Set(['ARINC 429', 'Discrete', 'CAN Bus', 'RS-422', 'RS-422（全双工）', 'RS-485', 'RS-232', '模拟量', '以太网（百兆）', '以太网（千兆）', '光纤', '射频', 'HDMI']);
                  const FREE_CONN_TYPES = new Set(['其他（在备注中说明）']);
                  const PROTOCOL_CONN_TYPES: Record<string, string[]> = {
                    'ARINC 429': ['A429_Positive', 'A429_Negative'],
                    'CAN Bus': ['CAN_High', 'CAN_Low', 'CAN_Gnd'],
                    '电源（低压）': ['电源（低压）正极', '电源（低压）负极'],
                    '电源（高压）': ['电源（高压）正极', '电源（高压）负极'],
                    'RS-422': ['RS-422_A', 'RS-422_B', 'RS-422_Gnd'],
                    'RS-422（全双工）': ['RS-422_TX_A', 'RS-422_TX_B', 'RS-422_RX_A', 'RS-422_RX_B', 'RS-422_Gnd'],
                    'RS-485': ['RS-485_A', 'RS-485_B', 'RS-485_Gnd'],
                    '以太网（百兆）': ['ETH_TX+', 'ETH_TX-', 'ETH_RX+', 'ETH_RX-', 'ETH_Gnd'],
                    '以太网（千兆）': ['ETH_A+', 'ETH_A-', 'ETH_B+', 'ETH_B-', 'ETH_C+', 'ETH_C-', 'ETH_D+', 'ETH_D-', 'ETH_Gnd'],
                  };
                  const show协议标识 = connType in PROTOCOL_CONN_TYPES;
                  return SIGNAL_FIELDS.filter(f => {
                    if (f.key === 'unique_id') return false;
                    if (f.key === '协议标识' && !show协议标识) return false;
                    if (成品线子字段.includes(f.key) && !isY) return false;
                    if (功率线字段.includes(f.key as keyof SignalRow) && is信号线) return false;
                    return true;
                  }).map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-gray-600 dark:text-white/60 mb-1">
                        {f.label}{(f.key === '连接类型' || f.key === '是否成品线') ? <span className="text-red-500"> *</span> : ''}
                      </label>
                      {f.key === '连接类型' ? (() => {
                        const curLineType = (signalForm as any)['线类型'] || '';
                        const allConnTypes = ['ARINC 429', 'CAN Bus', 'Discrete', 'HDMI', 'RS-232', 'RS-422', 'RS-422（全双工）', 'RS-485', '光纤', '模拟量', '射频', '电源（低压）', '电源（高压）', '以太网（百兆）', '以太网（千兆）', '其他（在备注中说明）'];
                        const filteredConnTypes = curLineType === '功率线'
                          ? allConnTypes.filter(v => POWER_CONN_TYPES.has(v) || FREE_CONN_TYPES.has(v))
                          : curLineType === '信号线'
                          ? allConnTypes.filter(v => SIGNAL_CONN_TYPES.has(v) || FREE_CONN_TYPES.has(v))
                          : allConnTypes;
                        return (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => {
                          const newType = e.target.value;
                          const updates: any = { ...signalForm, 连接类型: newType };
                          if (!(newType in PROTOCOL_CONN_TYPES)) updates['协议标识'] = '';
                          // 自动设置线类型
                          if (POWER_CONN_TYPES.has(newType)) updates['线类型'] = '功率线';
                          else if (SIGNAL_CONN_TYPES.has(newType)) updates['线类型'] = '信号线';
                          setSignalForm(updates);
                        }} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          {filteredConnTypes.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        );
                      })() : f.key === '是否成品线' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          {['Y', 'N'].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : f.key === '线类型' ? (
                        <select
                          value={(signalForm as any)[f.key] || ''}
                          onChange={e => {
                            const newType = e.target.value;
                            const curConn = (signalForm as any)['连接类型'] || '';
                            // 校验：功率线连接类型不能选信号线，反之亦然
                            if (newType === '信号线' && POWER_CONN_TYPES.has(curConn)) {
                              alert(`连接类型"${curConn}"属于功率类型，线类型不能选择"信号线"`);
                              return;
                            }
                            if (newType === '功率线' && SIGNAL_CONN_TYPES.has(curConn)) {
                              alert(`连接类型"${curConn}"属于信号类型，线类型不能选择"功率线"`);
                              return;
                            }
                            const updates: any = { ...signalForm, 线类型: newType };
                            if (newType === '信号线') {
                              updates['极性'] = '';
                              updates['额定电压'] = '';
                              updates['额定电流'] = '';
                              updates['设备正常工作电压范围'] = '';
                            }
                            setSignalForm(updates);
                          }}
                          className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                        >
                          <option value="">请选择</option>
                          <option value="功率线">功率线</option>
                          <option value="信号线">信号线</option>
                        </select>
                      ) : f.key === '协议标识' ? (
                        <select value={(signalForm as any)['协议标识'] || ''} onChange={e => setSignalForm({ ...signalForm, '协议标识': e.target.value })} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          {(PROTOCOL_CONN_TYPES[connType] || []).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : f.key === '推荐导线线型' ? (() => {
                        const curVal = (signalForm as any)[f.key] || '';
                        const isOther = curVal.startsWith('其他');
                        const stdOptions = ['单芯屏蔽线', '单芯非屏蔽线', '双绞屏蔽线', '双绞非屏蔽线', '三绞屏蔽线', '三绞非屏蔽线', '同轴'];
                        const selectVal = stdOptions.includes(curVal) ? curVal : isOther ? '__other__' : curVal ? '__other__' : '';
                        return (
                          <div>
                            <select
                              value={selectVal}
                              onChange={e => {
                                if (e.target.value === '__other__') {
                                  const detail = prompt('请输入具体线型说明：', curVal.startsWith('其他（') ? curVal.slice(3, -1) : '');
                                  if (detail !== null && detail.trim()) setSignalForm({ ...signalForm, [f.key]: `其他（${detail.trim()}）` });
                                  else if (detail !== null) alert('说明内容不能为空');
                                } else {
                                  setSignalForm({ ...signalForm, [f.key]: e.target.value });
                                }
                              }}
                              className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm"
                            >
                              <option value="">请选择</option>
                              {stdOptions.map(v => <option key={v} value={v}>{v}</option>)}
                              <option value="__other__">其他（详细说明）</option>
                            </select>
                            {isOther && <div className="mt-1 text-xs text-gray-500 dark:text-white/50">当前值：{curVal}</div>}
                          </div>
                        );
                      })() : f.key === '极性' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          <option value="正极">正极</option>
                          <option value="负极">负极</option>
                          <option value="地">地</option>
                          <option value="N/A">N/A</option>
                        </select>
                      ) : f.key === '独立电源代码' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          {[
                            ['1EPP', '电推进系统供电线（左前/正级）'],
                            ['1EPN', '电推进系统供电线（左前/负级）'],
                            ['2EPP', '电推进系统供电线（右前/正极）'],
                            ['2EPN', '电推进系统供电线（右前/负极）'],
                            ['3EPP', '电推进系统供电线（左后/正极）'],
                            ['3EPN', '电推进系统供电线（左后/负极）'],
                            ['4EPP', '电推进系统供电线（右后/正极）'],
                            ['4EPN', '电推进系统供电线（右后/负极）'],
                            ['1HF', '左馈电线（270V）'],
                            ['2HF', '右馈电线（270V）'],
                            ['3HF', '备用馈电线（270V）'],
                            ['1LF', '左馈电线（28V）'],
                            ['2LF', '右馈电线（28V）'],
                            ['3LF', '备用馈电线（28V）'],
                            ['PP', '主供电线（配电盘箱间互联）'],
                            ['1HP', '左通道供电线（断路器 >15A，270V）'],
                            ['2HP', '右通道供电线（断路器 >15A，270V）'],
                            ['3HP', '备用通道供电线（断路器 >15A，270V）'],
                            ['1HN', '左通道供电线（断路器 ≤15A，270V）'],
                            ['2HN', '右通道供电线（断路器 ≤15A，270V）'],
                            ['3HN', '备用通道供电线（断路器 ≤15A，270V）'],
                            ['1LP', '左通道供电线（断路器 >15A，28V）'],
                            ['2LP', '右通道供电线（断路器 >15A，28V）'],
                            ['3LP', '备用通道供电线（断路器 >15A，28V）'],
                            ['1LN', '左通道供电线（断路器 ≤15A，28V）'],
                            ['2LN', '右通道供电线（断路器 ≤15A，28V）'],
                            ['3LN', '备用通道供电线（断路器 ≤15A，28V）'],
                            ['CC', '同轴'],
                            ['FO', '光纤'],
                            ['CG', '机架地'],
                            ['NN', '非馈电线/非供电线/非同轴/非光纤/非机架地'],
                          ].map(([code, desc]) => (
                            <option key={code} value={code}>{code} — {desc}</option>
                          ))}
                        </select>
                      ) : f.key === '敷设代码' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          {[
                            ['EFC', '电传飞控系统线路（含飞控功能供电线）'],
                            ['ESS', '重要线路（技术性线路、电引爆装置线路等）'],
                            ['NES', '非重要线路（商用性线路，如客舱娱乐等）'],
                          ].map(([code, desc]) => (
                            <option key={code} value={code}>{code} — {desc}</option>
                          ))}
                        </select>
                      ) : f.key === '电磁兼容代码' ? (
                        <>
                          <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm">
                            <option value="">请选择</option>
                            {[
                              ['D', '直流电功率（TRU、蓄电池到汇流条，及直流供电线）'],
                              ['E', '发射（ISDN、A664、高速数据 >1MHz 等）'],
                              ['S', '敏感（低电平模拟信号、视频、非平衡信号、音频、内话）'],
                              ['G', '一般（1553B、ARINC429、离散信号、照明线、平衡信号等）'],
                              ['R', '射频信号（发射/收发同轴电缆）'],
                              ['X', '电引爆线路'],
                              ['Z', '无电磁隔离要求（光纤、机架地等）'],
                            ].map(([code, desc]) => (
                              <option key={code} value={code}>{code} — {desc}</option>
                            ))}
                          </select>
                          {(['FO', 'CG'].includes((signalForm as any)['独立电源代码']) && (signalForm as any)['电磁兼容代码'] !== 'Z') && (
                            <p className="text-red-500 text-xs mt-1">💡 光纤/机架地通常无电磁隔离要求，建议将电磁兼容代码设为 Z。</p>
                          )}
                        </>
                      ) : f.key === '余度代码' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          {[
                            ['A', '余度通道 A'],
                            ['B', '余度通道 B'],
                            ['C', '余度通道 C'],
                            ['D', '余度通道 D'],
                            ['N', '无余度要求'],
                          ].map(([code, desc]) => (
                            <option key={code} value={code}>{code} — {desc}</option>
                          ))}
                        </select>
                      ) : f.key === '接地代码' ? (
                        <select value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm">
                          <option value="">请选择</option>
                          <option value="A">A：机架地（设备机架/壳体接地）</option>
                          <option value="C">C：直流信号地（最大电流 ≤1A 的直流信号接地）</option>
                          <option value="E">E：直流电源地（最大电流 &gt;1A 的直流电回路接地）</option>
                          <option value="G">G：直流主电源地（发电机、TRU、蓄电池回线接地）</option>
                          <option value="H">H：高频无线电设备电源地</option>
                          <option value="I">I：高频无线电设备信号地</option>
                          <option value="J">J：屏蔽地（导线屏蔽、EMI 编织保护屏蔽接地）</option>
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
                            className="w-20 border border-gray-300 dark:border-white/20 rounded px-1 py-1 text-sm flex-shrink-0"
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
                                return v && v !== 'N/A' && !/^\d{2}-(\d{2}|XX)$/.test(v) ? 'border-red-400' : 'border-gray-300 dark:border-white/20';
                              })()
                            }`}
                          />
                        </div>
                      ) : (
                        <input type="text" value={(signalForm as any)[f.key] || ''} onChange={e => setSignalForm({ ...signalForm, [f.key]: e.target.value })} className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-sm" />
                      )}
                    </div>
                  ));
                })()}
              </div>

              {/* 信号端点构建器 */}
              <div className="border border-gray-200 dark:border-white/10 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium text-sm text-gray-700 dark:text-white/70">信号端点</h3>
                  <button
                    onClick={() => {
                      setSignalEndpoints([...signalEndpoints, { 设备编号: '', 设备端元器件编号: '', 针孔号: '', 信号名称: '', 信号定义: '' }]);
                      setEpDeviceSearch(prev => [...prev, '']);
                      setEpDeviceResults(prev => [...prev, []]);
                      setEpConnectorOptions(prev => [...prev, []]);
                      setEpPinOptions(prev => [...prev, []]);
                    }}
                    className="text-xs text-black dark:text-white hover:text-black/60 dark:hover:text-white/60"
                  >
                    + 添加端点
                  </button>
                </div>
                {signalEndpoints.map((ep, idx) => (
                  <div key={idx} className="mb-4 p-3 bg-gray-50 dark:bg-neutral-800 rounded border border-gray-200 dark:border-white/10">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-gray-600 dark:text-white/60">
                        端点 {idx + 1}
                        {ep.设备负责人 === user?.username
                          ? <span className="ml-1 text-black dark:text-white">（我负责的设备）</span>
                          : ep.设备负责人
                            ? <span className="ml-1 text-gray-500 dark:text-white/50">（{ep.设备负责人}）</span>
                            : null}
                        {ep.confirmed === 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 text-xs">待确认</span>}
                        {ep.confirmed === 1 && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs">已确认</span>}
                      </span>
                      {signalEndpoints.length > 2 && (
                        <button onClick={() => {
                          setSignalEndpoints(signalEndpoints.filter((_, i) => i !== idx));
                          setEpDeviceSearch(prev => prev.filter((_, i) => i !== idx));
                          setEpDeviceResults(prev => prev.filter((_, i) => i !== idx));
                          setEpConnectorOptions(prev => prev.filter((_, i) => i !== idx));
                          setEpPinOptions(prev => prev.filter((_, i) => i !== idx));
                        }} className="text-xs text-red-500">移除</button>
                      )}
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {/* 设备选择 */}
                      <div className="relative">
                        <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">设备编号</label>
                        <>
                          <input
                            type="text"
                            value={epDeviceSearch[idx] || ep.设备编号}
                            onChange={e => searchEpDevice(idx, e.target.value)}
                            onFocus={() => { if (!epDeviceSearch[idx] && !ep.设备编号) searchEpDevice(idx, ''); }}
                            placeholder="搜索设备..."
                            className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-xs"
                          />
                          {epDeviceResults[idx]?.length > 0 && (
                            <div className="absolute top-full left-0 right-0 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded shadow-lg z-10 max-h-32 overflow-y-auto">
                              {epDeviceResults[idx].map(d => (
                                <button key={d.id} onClick={() => selectEpDevice(idx, d)}
                                  className={`w-full text-left px-2 py-1 text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.06] ${d.设备负责人 === user?.username ? 'font-medium text-black dark:text-white' : ''}`}>
                                  {d.设备编号} {d.设备中文名称 ? `(${d.设备中文名称})` : ''}
                                  {d.设备负责人 === user?.username && <span className="ml-1 text-black/40 dark:text-white/40">★</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      </div>
                      {/* 设备负责人（其他组） */}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">设备负责人</label>
                        <div className="w-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-neutral-800 rounded px-2 py-1 text-xs text-gray-600 dark:text-white/60 min-h-[26px]">
                          {ep.设备负责人 || '-'}
                          {ep.设备负责人 && employeeNameMap[ep.设备负责人] && <span className="text-gray-400 dark:text-white/40 ml-1">({employeeNameMap[ep.设备负责人]})</span>}
                        </div>
                      </div>
                      {/* 连接器下拉 */}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">设备端元器件编号</label>
                        <select
                          value={ep.设备端元器件编号}
                          onChange={async e => {
                            const conn = epConnectorOptions[idx].find(c => c.设备端元器件编号 === e.target.value);
                            if (conn) await selectEpConnector(idx, conn);
                            else { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 设备端元器件编号: e.target.value, 针孔号: '' }; setSignalEndpoints(newEp); }
                          }}
                          className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-xs"
                        >
                          <option value="">选择连接器</option>
                          {(epConnectorOptions[idx] || []).map(c => <option key={c.id} value={c.设备端元器件编号}>{c.设备端元器件编号}</option>)}
                        </select>
                      </div>
                      {/* 针孔下拉 */}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">针孔号</label>
                        <select
                          value={ep.针孔号}
                          onChange={e => {
                            const newEp = [...signalEndpoints];
                            const selectedPin = (epPinOptions[idx] || []).find((p: any) => p.针孔号 === e.target.value);
                            newEp[idx] = {
                              ...newEp[idx],
                              针孔号: e.target.value,
                              ...(selectedPin ? { 端接尺寸: selectedPin.端接尺寸 || '', 屏蔽类型: selectedPin.屏蔽类型 || '' } : {}),
                            };
                            setSignalEndpoints(newEp);
                          }}
                          className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-xs"
                        >
                          <option value="">选择针孔</option>
                          {(epPinOptions[idx] || []).map(p => <option key={p.id} value={p.针孔号}>{p.针孔号}</option>)}
                        </select>
                      </div>
                      {/* 端接尺寸 */}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">端接尺寸</label>
                        <input
                          type="text"
                          value={ep.端接尺寸 || ''}
                          onChange={e => { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 端接尺寸: e.target.value }; setSignalEndpoints(newEp); }}
                          className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-xs"
                        />
                      </div>
                      {/* 屏蔽类型 */}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">屏蔽类型</label>
                        <select
                          value={ep.屏蔽类型 || ''}
                          onChange={e => { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 屏蔽类型: e.target.value }; setSignalEndpoints(newEp); }}
                          className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-xs"
                        >
                          <option value="">选择</option>
                          <option value="无屏蔽">无屏蔽</option>
                          <option value="非360°屏蔽">非360°屏蔽</option>
                          <option value="360°屏蔽">360°屏蔽</option>
                        </select>
                      </div>
                      {/* 连接关系（从第2个端点开始） */}
                      {idx > 0 && (
                        <>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">传输方向</label>
                            <select
                              value={(ep as any)._edgeDirection || 'N/A'}
                              onChange={e => {
                                const newEp = [...signalEndpoints];
                                (newEp[idx] as any)._edgeDirection = e.target.value;
                                setSignalEndpoints(newEp);
                              }}
                              className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-xs"
                            >
                              <option value="N/A">N/A</option>
                              <option value="INPUT">INPUT</option>
                              <option value="OUTPUT">OUTPUT</option>
                              <option value="BI-DIR">BI-DIR</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">目标端点</label>
                            <select
                              value={(ep as any)._edgeTarget ?? 0}
                              onChange={e => {
                                const newEp = [...signalEndpoints];
                                (newEp[idx] as any)._edgeTarget = parseInt(e.target.value);
                                setSignalEndpoints(newEp);
                              }}
                              className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-xs"
                            >
                              {signalEndpoints.map((other, oi) => oi !== idx ? (
                                <option key={oi} value={oi}>端点{oi + 1}{other.设备编号 ? ` (${other.设备编号})` : ''}</option>
                              ) : null)}
                            </select>
                          </div>
                        </>
                      )}
                      {/* 信号名称 */}
                      <div className="col-span-5">
                        <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">端点信号名称</label>
                        <input
                          type="text"
                          value={ep.信号名称 || ''}
                          onChange={e => { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 信号名称: e.target.value }; setSignalEndpoints(newEp); }}
                          className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-xs"
                        />
                      </div>
                      {/* 信号定义 */}
                      <div className="col-span-5">
                        <label className="block text-xs text-gray-500 dark:text-white/50 mb-0.5">信号定义</label>
                        <input
                          type="text"
                          value={ep.信号定义 || ''}
                          onChange={e => { const newEp = [...signalEndpoints]; newEp[idx] = { ...newEp[idx], 信号定义: e.target.value }; setSignalEndpoints(newEp); }}
                          className="w-full border border-gray-300 dark:border-white/20 rounded px-2 py-1 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              </div>
            </div>
          </div>
          );
        })()}
      </div>

      {historyTarget && (
        <HistoryModal
          entityTable={historyTarget.entityTable}
          entityId={historyTarget.entityId}
          entityLabel={historyTarget.entityLabel}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {eicdTarget && (
        <EICDModal
          deviceId={eicdTarget.deviceId}
          projectId={eicdTarget.projectId}
          deviceLabel={eicdTarget.label}
          onClose={() => setEicdTarget(null)}
          onNavigate={(sel: NonNullable<Selection>) => {
            setEicdTarget(null);
            if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
            setHighlightRow(null);

            if (sel.type === 'signal') {
              // 重置信号筛选，确保目标信号可见
              setSignalFilters({});
              setSgGroupFilter('');
              setSignals([]); // 清空旧信号，防止 pendingNav 匹配到旧数据
              if (filterMode !== 'all') setFilterMode('all');
              setActiveView('signals');
            } else {
              // 重置设备筛选确保目标设备可见
              setDeviceFilters({});
              setConfigFilterSelected([]);
              if (filterMode !== 'all') setFilterMode('all');
              setActiveView('devices');
            }
            setPendingNav(sel);
          }}
        />
      )}

      {signalGroupTarget && (
        <SignalGroupModal
          groupName={signalGroupTarget.groupName}
          singleSignalId={signalGroupTarget.singleSignalId}
          projectId={signalGroupTarget.projectId}
          highlightSignalId={signalGroupTarget.signalId}
          onClose={() => setSignalGroupTarget(null)}
        />
      )}

      {/* ATA导出模态框 */}
      {showAtaExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="text-base font-semibold">WB导出 — 按设备选择信号端点对</h3>
              <button onClick={() => setShowAtaExportModal(false)} className="text-gray-400 dark:text-white/40 hover:text-gray-600 dark:text-white/60 text-xl">×</button>
            </div>
            <div className="px-5 py-3 border-b flex items-center gap-3">
              <label className="text-sm text-gray-600 dark:text-white/60 shrink-0">ATA前两位筛选：</label>
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
              <span className="text-sm text-gray-500 dark:text-white/50">
                已选 {ataExportSelectedIds.size} 台设备 / 共 {ataExportDevices.length} 台
              </span>
              <button
                onClick={() => setAtaExportSelectedIds(new Set(ataExportDevices.map(d => d.id)))}
                className="ml-auto text-xs text-black dark:text-white hover:underline"
              >全选</button>
              <button
                onClick={() => setAtaExportSelectedIds(new Set())}
                className="text-xs text-gray-500 dark:text-white/50 hover:underline"
              >清空</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 dark:text-white/50 border-b">
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
                      <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-white/[0.04]">
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
              <button onClick={() => setShowAtaExportModal(false)} className="px-4 py-1.5 text-sm border rounded hover:bg-gray-50 dark:hover:bg-white/[0.04]">取消</button>
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
