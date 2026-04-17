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
  const deviceRows = (await db.query(
    'SELECT * FROM devices WHERE project_id = ? ORDER BY 设备编号',
    [projectId]
  )).map((r: any) => ({ ...r, '最后修改时间': r.updated_at, _entity_table: 'devices', _entity_id: r.id, _created_at: r.created_at, _updated_at: r.updated_at }));
  const deviceCols = [
    '设备编号', '设备编号（DOORS）', '设备LIN号（DOORS）', '设备中文名称', '设备英文名称', '设备英文缩写',
    '设备供应商件号', '设备供应商名称', '设备部件所属系统（4位ATA）',
    '设备安装位置', '设备DAL', '设备壳体是否金属', '金属壳体表面是否经过特殊处理而不易导电',
    '设备内共地情况', '设备壳体接地方式', '壳体接地是否故障电流路径',
    '其他接地特殊要求', '设备端连接器或接线柱数量', '是否为选装设备', '是否有特殊布线需求', '设备装机架次',
    '设备负责人', '设备等级', '设备正常工作电压范围（V）', '设备物理特性', '备注', '最后修改时间',
  ];

  // ② 设备端元器件表 → device_component 行（pins JOIN connectors JOIN devices）
  const compRows = (await db.query(
    `SELECT c.id as _cid, d.设备编号, d."设备LIN号（DOORS）", d.设备中文名称 as 设备名称,
            c.设备端元器件编号, c."设备端元器件名称及类型",
            c."设备端元器件件号类型及件号", c."设备端元器件供应商名称",
            c."匹配的线束端元器件件号", c."匹配的线束线型", c."尾附件件号", c."触件型号",
            c."设备端元器件匹配的元器件是否随设备交付",
            c.备注, c.updated_at as 最后修改时间, c.created_at as _created_at
     FROM connectors c
     JOIN devices d ON c.device_id = d.id
     WHERE d.project_id = ?
     ORDER BY d.设备编号, c.设备端元器件编号`,
    [projectId]
  )).map((r: any) => ({ ...r, _entity_table: 'connectors', _entity_id: r._cid, _updated_at: r['最后修改时间'] }));
  const compCols = [
    '设备编号', '设备LIN号（DOORS）', '设备名称', '设备端元器件编号', '设备端元器件名称及类型',
    '设备端元器件件号类型及件号', '设备端元器件供应商名称', '匹配的线束端元器件件号',
    '匹配的线束线型', '尾附件件号', '触件型号',
    '设备端元器件匹配的元器件是否随设备交付', '备注', '最后修改时间',
  ];

  // ③ 电气接口数据表 → 每行一对端点（from-to），超过2个端点的信号展开为多行
  const signalRows = await db.query(
    `SELECT * FROM signals WHERE project_id = ?
     ORDER BY
       CASE WHEN signal_group IS NOT NULL AND signal_group != '' THEN 0 ELSE 1 END,
       signal_group,
       CASE WHEN twist_group IS NOT NULL AND twist_group != '' THEN 0 ELSE 1 END,
       twist_group,
       "协议标识", unique_id, id`,
    [projectId]
  );

  const ifaceRowsRaw: Record<string, any>[] = [];
  for (const sig of signalRows) {
    const endpoints = await db.query(
      `SELECT se.id as ep_id, se.endpoint_index, se.端接尺寸 as 端接尺寸_ep, se.信号名称 as 信号名称_ep, se.信号定义 as 信号定义_ep,
              p.针孔号, p.屏蔽类型, c.设备端元器件编号 as 连接器号, d.设备编号, d."设备LIN号（DOORS）" as lin号, d.设备等级
       FROM signal_endpoints se
       JOIN pins p ON se.pin_id = p.id
       JOIN connectors c ON p.connector_id = c.id
       JOIN devices d ON c.device_id = d.id
       WHERE se.signal_id = ?
       ORDER BY se.endpoint_index`,
      [sig.id]
    );

    const edges = await db.query(
      'SELECT * FROM signal_edges WHERE signal_id = ? ORDER BY id',
      [sig.id]
    );

    // 信号基础字段（不含端点相关）
    const base: Record<string, any> = {
      '信号组': sig['signal_group'] || '',
      '绞线组': (sig['signal_group'] && sig['twist_group']) ? sig['signal_group'] + '-' + sig['twist_group'] : (sig['twist_group'] || ''),
      'Unique ID': sig.unique_id,
      '连接类型': sig['连接类型'],
      '协议标识': sig['协议标识'] || '',
      '线类型': sig['线类型'] || '',
      '导线等级': (() => {
        const levels = endpoints.map((e: any) => e.设备等级).filter((v: any) => v);
        if (levels.length === 0) return '';
        const nums = levels.map((v: string) => parseInt(v));
        if (nums.some((n: number) => isNaN(n))) return '';
        return String(endpoints.length <= 2 ? Math.max(...nums) : Math.min(...nums)) + '级';
      })(),
      '推荐导线线规': sig['推荐导线线规'],
      '推荐导线线型': sig['推荐导线线型'],
      '独立电源代码': sig['独立电源代码'],
      '敷设代码': sig['敷设代码'],
      '电磁兼容代码': sig['电磁兼容代码'],
      '余度代码': sig['余度代码'],
      '功能代码': sig['功能代码'],
      '接地代码': sig['接地代码'],
      '极性': sig['极性'],
      '信号ATA': sig['信号ATA'],
      '信号架次有效性': sig['信号架次有效性'],
      '额定电压': sig['额定电压'],
      '额定电流': sig['额定电流'],
      '设备正常工作电压范围': sig['设备正常工作电压范围'],
      '是否成品线': sig['是否成品线'],
      '成品线件号': sig['成品线件号'],
      '成品线线规': sig['成品线线规'],
      '成品线类型': sig['成品线类型'],
      '成品线长度': sig['成品线长度'],
      '成品线载流量': sig['成品线载流量'],
      '成品线线路压降': sig['成品线线路压降'],
      '成品线标识': sig['成品线标识'],
      '成品线与机上线束对接方式': sig['成品线与机上线束对接方式'],
      '成品线安装责任': sig['成品线安装责任'],
      '备注': sig['备注'],
      '最后修改时间': sig['updated_at'],
      _entity_table: 'signals', _entity_id: sig.id,
      _created_at: sig.created_at, _updated_at: sig.updated_at,
      _signal_group: sig.signal_group || '',
    };

    const epMap = new Map(endpoints.map((e: any) => [e.ep_id, e]));

    if (edges.length > 0) {
      // 按 edge 展开：每条 edge 一行
      for (const edge of edges) {
        const from = epMap.get(edge.from_endpoint_id) as any;
        const to = epMap.get(edge.to_endpoint_id) as any;
        if (!from || !to) continue;
        ifaceRowsRaw.push({ ...base,
          '设备（从）': from.设备编号, 'LIN号（从）': from.lin号, '连接器（从）': from.连接器号, '针孔号（从）': from.针孔号, '端接尺寸（从）': from.端接尺寸_ep, '屏蔽类型（从）': from.屏蔽类型, '信号名称（从）': from.信号名称_ep, '信号定义（从）': from.信号定义_ep,
          '设备（到）': to.设备编号,   'LIN号（到）': to.lin号,   '连接器（到）': to.连接器号,   '针孔号（到）': to.针孔号,   '端接尺寸（到）': to.端接尺寸_ep,   '屏蔽类型（到）': to.屏蔽类型,   '信号名称（到）': to.信号名称_ep,   '信号定义（到）': to.信号定义_ep,
        });
      }
    } else if (endpoints.length === 0) {
      // 无端点也无 edge：导出一行空端点
      ifaceRowsRaw.push({ ...base,
        '设备（从）': '', 'LIN号（从）': '', '连接器（从）': '', '针孔号（从）': '', '端接尺寸（从）': '', '屏蔽类型（从）': '', '信号名称（从）': '', '信号定义（从）': '',
        '设备（到）': '', 'LIN号（到）': '', '连接器（到）': '', '针孔号（到）': '', '端接尺寸（到）': '', '屏蔽类型（到）': '', '信号名称（到）': '', '信号定义（到）': '',
      });
    } else {
      // 有端点但无 edge（旧数据兜底）：按原逻辑 ep0 → 其余
      const from = endpoints[0] as any;
      const toList = endpoints.length >= 2 ? endpoints.slice(1) : [endpoints[0]];
      for (const to of toList as any[]) {
        ifaceRowsRaw.push({ ...base,
          '设备（从）': from.设备编号, 'LIN号（从）': from.lin号, '连接器（从）': from.连接器号, '针孔号（从）': from.针孔号, '端接尺寸（从）': from.端接尺寸_ep, '屏蔽类型（从）': from.屏蔽类型, '信号名称（从）': from.信号名称_ep, '信号定义（从）': from.信号定义_ep,
          '设备（到）': to.设备编号,   'LIN号（到）': to.lin号,   '连接器（到）': to.连接器号,   '针孔号（到）': to.针孔号,   '端接尺寸（到）': to.端接尺寸_ep,   '屏蔽类型（到）': to.屏蔽类型,   '信号名称（到）': to.信号名称_ep,   '信号定义（到）': to.信号定义_ep,
        });
      }
    }
  }

  const ifaceCols = [
    '信号组', '绞线组', 'Unique ID', '连接类型', '协议标识', '线类型',
    '设备（从）', 'LIN号（从）', '连接器（从）', '针孔号（从）', '端接尺寸（从）', '屏蔽类型（从）', '信号名称（从）', '信号定义（从）',
    '设备（到）', 'LIN号（到）', '连接器（到）', '针孔号（到）', '端接尺寸（到）', '屏蔽类型（到）', '信号名称（到）', '信号定义（到）',
    '导线等级', '推荐导线线规', '推荐导线线型', '独立电源代码', '敷设代码',
    '电磁兼容代码', '余度代码', '功能代码', '接地代码', '极性',
    '信号ATA', '信号架次有效性', '额定电压', '额定电流', '设备正常工作电压范围',
    '是否成品线', '成品线件号', '成品线线规', '成品线类型', '成品线长度',
    '成品线载流量', '成品线线路压降', '成品线标识', '成品线与机上线束对接方式',
    '成品线安装责任', '备注', '最后修改时间',
  ];

  return [
    { tableType: 'ata_device' as TableType, originalColumns: deviceCols, rows: deviceRows },
    { tableType: 'device_component' as TableType, originalColumns: compCols, rows: compRows },
    { tableType: 'electrical_interface' as TableType, originalColumns: ifaceCols, rows: ifaceRowsRaw },
  ];
}
