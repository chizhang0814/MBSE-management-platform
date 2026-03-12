/**
 * EICD 数据提取共享模块
 *
 * 从三类表数据中提取结构化的设备、端口、连接信息。
 * 被 sysml-generator.ts（文本导出）和 sysml-sync.ts（API 同步）共用。
 */

import {
  ColumnDef,
  TableType,
  columnSchemaMap,
} from '../shared/column-schema.js';
import type { Database } from '../database.js';

// ── 类型 ──────────────────────────────────────────────────

export interface TableData {
  tableType: TableType;
  originalColumns: string[];
  rows: Record<string, any>[];
}

export interface DeviceInfo {
  deviceId: string;
  attrs: Record<string, string>;
  ports: Set<string>;
}

export interface ConnectionInfo {
  uniqueId: string;
  signalName: string;
  attrs: Record<string, string>;
  dev1: string;
  port1: string;
  dev2: string;
  port2: string;
}

export interface EicdStructure {
  deviceMap: Map<string, DeviceInfo>;
  connections: ConnectionInfo[];
}

// ── 列名清理 ─────────────────────────────────────────────

export function cleanColumnName(col: string): string {
  let name = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
  name = name.replace(/\r\n/g, '_');
  name = name.replace(/[()]/g, '_');
  name = name.replace(/\.(\d+)/g, '_$1');
  return name;
}

// ── 列名匹配 ─────────────────────────────────────────────

export function buildColumnMapping(
  originalColumns: string[],
  schema: ColumnDef[],
): Map<string, ColumnDef> {
  const mapping = new Map<string, ColumnDef>();
  const used = new Set<string>();

  for (const origCol of originalColumns) {
    const exact = schema.find(
      (s) => !used.has(s.sysmlAttr) && s.originalName === origCol,
    );
    if (exact) {
      mapping.set(origCol, exact);
      used.add(exact.sysmlAttr);
      continue;
    }

    const candidates = schema
      .filter((s) => !used.has(s.sysmlAttr) && origCol.includes(s.originalName))
      .sort((a, b) => b.originalName.length - a.originalName.length);

    if (candidates.length > 0) {
      mapping.set(origCol, candidates[0]);
      used.add(candidates[0].sysmlAttr);
    }
  }

  return mapping;
}

// ── 辅助 ──────────────────────────────────────────────────

export function isEmptyValue(v: any): boolean {
  if (v === undefined || v === null) return true;
  const s = String(v).trim();
  return s === '' || s === 'N/A' || s === 'N';
}

export function getField(row: Record<string, any>, origCol: string): any {
  if (row[origCol] !== undefined) return row[origCol];
  const clean = cleanColumnName(origCol);
  if (row[clean] !== undefined) return row[clean];
  return undefined;
}

export function extractMappedValues(
  row: Record<string, any>,
  mapping: Map<string, ColumnDef>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [origCol, def] of mapping) {
    const v = getField(row, origCol);
    if (!isEmptyValue(v)) {
      result[def.sysmlAttr] = String(v).trim();
    }
  }
  return result;
}

export function extractPortFromComponentId(componentId: string): string | null {
  const idx = componentId.lastIndexOf('-');
  if (idx === -1 || idx === componentId.length - 1) return null;
  return componentId.substring(idx + 1);
}

// ── JSON 数组展开 ────────────────────────────────────────

export function flattenDeviceJsonIfNeeded(
  row: Record<string, any>,
  originalColumns: string[],
): Record<string, any> {
  const hasFlat = originalColumns.some(
    (c) => c === '设备编号_1' || c.includes('设备编号_1'),
  );
  if (hasFlat) return row;

  let devicesRaw: any = undefined;
  for (const key of Object.keys(row)) {
    if (key === '设备' || cleanColumnName(key) === '设备') {
      devicesRaw = row[key];
      break;
    }
  }
  if (!devicesRaw) return row;

  let devices: any[];
  try {
    devices = typeof devicesRaw === 'string' ? JSON.parse(devicesRaw) : devicesRaw;
  } catch {
    return row;
  }
  if (!Array.isArray(devices)) return row;

  const expanded: Record<string, any> = { ...row };

  const fieldMap: [string[], string][] = [
    [['设备编号'], '设备编号'],
    [['设备LIN号'], '设备LIN号'],
    [['端元器件号（连接器号）', '端元器件号', '连接器号'], '端元器件号'],
    [['针孔号'], '针孔号'],
    [['端接尺寸'], '端接尺寸'],
    [['屏蔽类型'], '屏蔽类型'],
    [['信号方向'], '信号方向'],
  ];

  for (let i = 0; i < Math.min(devices.length, 2); i++) {
    const dev = devices[i];
    if (!dev || typeof dev !== 'object') continue;
    const suffix = `_${i + 1}`;

    for (const [srcKeys, baseKey] of fieldMap) {
      let val: any = undefined;
      for (const sk of srcKeys) {
        val = dev[sk] ?? dev[cleanColumnName(sk)];
        if (val !== undefined) break;
      }
      if (val !== undefined) {
        expanded[baseKey + suffix] = val;
        expanded[cleanColumnName(baseKey + suffix)] = val;
      }
    }
  }

  return expanded;
}

// ── 主提取函数 ────────────────────────────────────────────

/**
 * 从三类表数据中提取结构化的设备和连接信息。
 */
export function extractEicdStructure(tables: TableData[]): EicdStructure {
  const byType: Record<string, TableData | undefined> = {};
  for (const t of tables) byType[t.tableType] = t;

  const ataData = byType['ata_device'];
  const compData = byType['device_component'];
  const ifaceData = byType['electrical_interface'];

  // 构建列名映射
  const ataMapping = ataData
    ? buildColumnMapping(ataData.originalColumns, columnSchemaMap.ata_device)
    : new Map<string, ColumnDef>();
  const compMapping = compData
    ? buildColumnMapping(compData.originalColumns, columnSchemaMap.device_component)
    : new Map<string, ColumnDef>();

  const ifaceOrigCols = ifaceData ? [...ifaceData.originalColumns] : [];
  const hasDeviceJson = ifaceOrigCols.some((c) => c === '设备' || c.includes('设备'));
  const hasFlatCols = ifaceOrigCols.some((c) => c === '设备编号_1' || c.includes('设备编号_1'));
  if (hasDeviceJson && !hasFlatCols) {
    ifaceOrigCols.push(
      '设备编号_1', '设备LIN号_1', '端元器件号_1', '针孔号_1',
      '端接尺寸_1', '屏蔽类型_1', '信号方向_1',
      '设备编号_2', '设备LIN号_2', '端元器件号_2', '针孔号_2',
      '端接尺寸_2', '屏蔽类型_2', '信号方向_2',
    );
  }
  const ifaceMapping = ifaceData
    ? buildColumnMapping(ifaceOrigCols, columnSchemaMap.electrical_interface)
    : new Map<string, ColumnDef>();

  // ── 设备提取 ──
  const deviceMap = new Map<string, DeviceInfo>();

  if (ataData) {
    for (const row of ataData.rows) {
      const vals = extractMappedValues(row, ataMapping);
      const id = vals.deviceId;
      if (!id) continue;
      deviceMap.set(id, { deviceId: id, attrs: vals, ports: new Set() });
    }
  }

  // ── 端口关联 ──
  if (compData) {
    for (const row of compData.rows) {
      const vals = extractMappedValues(row, compMapping);
      const devId = vals.deviceId;
      let connector: string | null | undefined = vals.connectorNumber;
      if (!connector && vals.componentId) {
        connector = extractPortFromComponentId(vals.componentId);
      }
      if (devId && connector) {
        if (!deviceMap.has(devId)) {
          deviceMap.set(devId, { deviceId: devId, attrs: { deviceId: devId }, ports: new Set() });
        }
        deviceMap.get(devId)!.ports.add(connector);
      }
    }
  }

  // ── 连接提取 ──
  const connections: ConnectionInfo[] = [];

  if (ifaceData) {
    for (const rawRow of ifaceData.rows) {
      const row = flattenDeviceJsonIfNeeded(rawRow, ifaceData.originalColumns);
      const vals = extractMappedValues(row, ifaceMapping);
      const uid = vals.uniqueId || '';
      const sigName = vals.signalName || '';
      if (!uid && !sigName) continue;

      const port1Raw = vals.connectorNumber1 || '';
      const port2Raw = vals.connectorNumber2 || '';
      const port1 = extractPortFromComponentId(port1Raw) || port1Raw;
      const port2 = extractPortFromComponentId(port2Raw) || port2Raw;

      // 确保连接中引用的设备和端口也在 deviceMap 中
      for (const [devId, portName] of [[vals.deviceId1, port1], [vals.deviceId2, port2]] as [string, string][]) {
        if (devId) {
          if (!deviceMap.has(devId)) {
            deviceMap.set(devId, { deviceId: devId, attrs: { deviceId: devId }, ports: new Set() });
          }
          if (portName) {
            deviceMap.get(devId)!.ports.add(portName);
          }
        }
      }

      connections.push({
        uniqueId: uid,
        signalName: sigName,
        attrs: vals,
        dev1: vals.deviceId1 || '',
        port1,
        dev2: vals.deviceId2 || '',
        port2,
      });
    }
  }

  return { deviceMap, connections };
}

// ── 关系型5表适配器 ────────────────────────────────────────

/**
 * 从5张固定关系型表中读取数据，构建与现有SysML生成器兼容的 TableData[] 格式。
 */
export async function loadTableDataFromRelational(db: Database, projectId: number): Promise<TableData[]> {
  // ① ATA设备表 → ata_device 行
  const deviceRows = await db.query(
    'SELECT * FROM devices WHERE project_id = ? ORDER BY 设备编号',
    [projectId]
  );
  const deviceCols = [
    '设备编号', '设备中文名称', '设备英文名称', '设备英文缩写',
    '设备供应商件号', '设备供应商名称', '设备部件所属系统（4位ATA）',
    '设备安装位置', '设备DAL', '设备壳体是否金属', '金属壳体表面是否经过特殊处理而不易导电',
    '设备内共地情况', '设备壳体接地方式', '壳体接地是否故障电流路径',
    '其他接地特殊要求', '设备端连接器或接线柱数量', '是否为选装设备', '设备装机架次',
    '设备负责人', '设备正常工作电压范围（V）', '设备物理特性', '备注',
  ];

  // ② 设备端元器件表 → device_component 行（pins JOIN connectors JOIN devices）
  const compRows = await db.query(
    `SELECT d.设备编号, d.设备中文名称 as 设备名称,
            c.设备端元器件编号 as 连接器号, c.设备端元器件编号, c."设备端元器件名称及类型",
            c."设备端元器件件号类型及件号", c."设备端元器件供应商名称",
            c."匹配的线束端元器件件号", c."匹配的线束线型", c."设备端元器件匹配的元器件是否随设备交付",
            NULL as 针孔号, NULL as 端接尺寸, c.备注
     FROM connectors c
     JOIN devices d ON c.device_id = d.id
     WHERE d.project_id = ?
     ORDER BY d.设备编号, c.设备端元器件编号`,
    [projectId]
  );
  const compCols = [
    '设备编号', '设备名称', '连接器号', '设备端元器件编号', '设备端元器件名称及类型',
    '设备端元器件件号类型及件号', '设备端元器件供应商名称', '匹配的线束端元器件件号', '匹配的线束线型',
    '设备端元器件匹配的元器件是否随设备交付', '针孔号', '端接尺寸', '备注',
  ];

  // ③ 电气接口数据表 → electrical_interface 行（重建"设备"JSON数组）
  const signalRows = await db.query(
    'SELECT * FROM signals WHERE project_id = ? ORDER BY unique_id, id',
    [projectId]
  );

  const ifaceRowsRaw: Record<string, any>[] = [];
  for (const sig of signalRows) {
    const endpoints = await db.query(
      `SELECT se.endpoint_index, se.端接尺寸 as 端接尺寸_ep,
              p.针孔号, c.设备端元器件编号 as 连接器号, d.设备编号
       FROM signal_endpoints se
       JOIN pins p ON se.pin_id = p.id
       JOIN connectors c ON p.connector_id = c.id
       JOIN devices d ON c.device_id = d.id
       WHERE se.signal_id = ?
       ORDER BY se.endpoint_index`,
      [sig.id]
    );

    const devicesArray = endpoints.map((ep: any) => ({
      '设备编号': ep.设备编号,
      '连接器号': ep.连接器号,
      '针孔号': ep.针孔号,
      '端接尺寸': ep.端接尺寸_ep,
    }));

    ifaceRowsRaw.push({
      ...sig,
      'Unique ID': sig.unique_id,
      '设备': JSON.stringify(devicesArray),
    });
  }

  const ifaceCols = [
    'Unique ID', '信号名称', '信号定义', '连接类型', '设备',
    '推荐导线线规', '推荐导线线型', '独立电源代码', '敷设代码',
    '电磁兼容代码', '余度代码', '功能代码', '接地代码', '极性',
    '信号架次有效性', '额定电压', '额定电流', '设备正常工作电压范围',
    '是否成品线', '成品线件号', '成品线线规', '成品线类型', '成品线长度',
    '成品线载流量', '成品线线路压降', '成品线标识', '成品线与机上线束对接方式',
    '成品线安装责任', '备注',
  ];

  return [
    { tableType: 'ata_device' as TableType, originalColumns: deviceCols, rows: deviceRows },
    { tableType: 'device_component' as TableType, originalColumns: compCols, rows: compRows },
    { tableType: 'electrical_interface' as TableType, originalColumns: ifaceCols, rows: ifaceRowsRaw },
  ];
}
