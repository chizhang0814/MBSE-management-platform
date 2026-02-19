/**
 * SysML v2 文本生成引擎
 *
 * 利用 SysML v2 的 def/usage 继承机制：
 *   - part def Device          — 设备类型（定义所有通用属性）
 *   - port def ConnectorPort   — 连接器端口类型
 *   - connection def Signal    — 信号连接类型（定义所有线缆属性）
 *   - part eicdSystem          — 系统实例层（所有 usage）
 *
 * 每个具体设备是 `part : Device` 的 usage，
 * 每条信号是 `connection : Signal` 的 usage，
 * 属性值通过 `:>>` 重定义赋值。
 */

import {
  ataDeviceColumns,
  electricalInterfaceColumns,
} from '../shared/column-schema.js';

import {
  type TableData,
  type DeviceInfo,
  type ConnectionInfo,
  extractEicdStructure,
} from './sysml-data-extractor.js';

// 重新导出 TableData 以保持现有 import 兼容
export type { TableData } from './sysml-data-extractor.js';

// ── 辅助 ──────────────────────────────────────────────────

/** SysML v2 标识符：非 ASCII 或含特殊字符时用单引号包裹 */
function quote(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `'${name.replace(/'/g, "\\'")}'`;
}

/** 从 schema 中收集 Device def 的属性（排除身份属性） */
function getDeviceDefAttrs(): string[] {
  const skip = new Set(['deviceId', 'deviceNameCn']);
  return ataDeviceColumns
    .filter((c) => !skip.has(c.sysmlAttr))
    .map((c) => c.sysmlAttr)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

/** Signal def 的线缆属性（排除端点和身份信息） */
function getSignalDefAttrs(): string[] {
  const skip = new Set([
    'uniqueId', 'signalName', 'signalDefinition', 'connectionType',
    'deviceId1', 'linNumber1', 'connectorNumber1', 'pinNumber1',
    'terminalSize1', 'shieldType1', 'signalDirection1',
    'deviceId2', 'linNumber2', 'connectorNumber2', 'pinNumber2',
    'terminalSize2', 'shieldType2', 'signalDirection2',
  ]);
  return electricalInterfaceColumns
    .filter((c) => !skip.has(c.sysmlAttr))
    .map((c) => c.sysmlAttr)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

/** 连接属性中需跳过的字段 */
const SKIP_CONN_ATTRS = new Set([
  'uniqueId', 'signalName', 'signalDefinition', 'connectionType',
  'deviceId1', 'linNumber1', 'connectorNumber1', 'pinNumber1',
  'terminalSize1', 'shieldType1', 'signalDirection1',
  'deviceId2', 'linNumber2', 'connectorNumber2', 'pinNumber2',
  'terminalSize2', 'shieldType2', 'signalDirection2',
]);

// ── 主生成函数 ────────────────────────────────────────────

export function generateSysml(
  projectName: string,
  tables: TableData[],
): string {
  const { deviceMap, connections } = extractEicdStructure(tables);

  const lines: string[] = [];
  const I = (level: number) => '    '.repeat(level);

  lines.push(`package ${quote(`EICD_${projectName}`)} {`);
  lines.push(`${I(1)}doc /* Generated from MBSE综合管理平台 — ${new Date().toISOString().split('T')[0]} */`);
  lines.push('');

  // ═══════════════════════════════════════════════════════
  // 类型定义层（def）
  // ═══════════════════════════════════════════════════════

  lines.push(`${I(1)}port def ConnectorPort {`);
  lines.push(`${I(2)}attribute pinNumber : String;`);
  lines.push(`${I(2)}attribute terminalSize : String;`);
  lines.push(`${I(2)}attribute shieldType : String;`);
  lines.push(`${I(2)}attribute signalDirection : String;`);
  lines.push(`${I(1)}}`);
  lines.push('');

  lines.push(`${I(1)}part def Device {`);
  lines.push(`${I(2)}doc /* EICD 设备类型定义 — 所有设备共享此结构 */`);
  lines.push(`${I(2)}attribute deviceId : String;`);
  lines.push(`${I(2)}attribute deviceNameCn : String;`);
  for (const attr of getDeviceDefAttrs()) {
    lines.push(`${I(2)}attribute ${attr} : String;`);
  }
  lines.push(`${I(1)}}`);
  lines.push('');

  lines.push(`${I(1)}connection def Signal {`);
  lines.push(`${I(2)}doc /* EICD 信号连接类型定义 — 所有信号连接共享此结构 */`);
  lines.push(`${I(2)}end port source : ConnectorPort;`);
  lines.push(`${I(2)}end port target : ConnectorPort;`);
  lines.push(`${I(2)}attribute signalName : String;`);
  lines.push(`${I(2)}attribute signalDefinition : String;`);
  for (const attr of getSignalDefAttrs()) {
    lines.push(`${I(2)}attribute ${attr} : String;`);
  }
  lines.push(`${I(1)}}`);
  lines.push('');

  // ═══════════════════════════════════════════════════════
  // 实例层（usage）
  // ═══════════════════════════════════════════════════════

  lines.push(`${I(1)}part eicdSystem {`);
  lines.push(`${I(2)}doc /* 系统实例 — 包含所有设备和信号连接 */`);
  lines.push('');

  // ── 设备 usage ──
  if (deviceMap.size > 0) {
    lines.push(`${I(2)}// ── 设备实例 ──`);
    lines.push('');

    for (const dev of deviceMap.values()) {
      lines.push(`${I(2)}part ${quote(dev.deviceId)} : Device {`);
      if (dev.attrs.deviceNameCn) {
        lines.push(`${I(3)}doc /* ${dev.attrs.deviceNameCn} */`);
      }
      lines.push(`${I(3)}attribute :>> deviceId = "${dev.deviceId}";`);
      if (dev.attrs.deviceNameCn) {
        lines.push(`${I(3)}attribute :>> deviceNameCn = "${dev.attrs.deviceNameCn}";`);
      }
      const skipAttrs = new Set(['deviceId', 'deviceNameCn']);
      for (const [attr, val] of Object.entries(dev.attrs)) {
        if (skipAttrs.has(attr)) continue;
        lines.push(`${I(3)}attribute :>> ${attr} = "${val}";`);
      }
      for (const port of dev.ports) {
        lines.push(`${I(3)}port ${quote(port)} : ConnectorPort;`);
      }
      lines.push(`${I(2)}}`);
      lines.push('');
    }
  }

  // ── 信号连接 usage ──
  if (connections.length > 0) {
    lines.push(`${I(2)}// ── 信号连接 ──`);
    lines.push('');

    for (const conn of connections) {
      const connId = conn.uniqueId || conn.signalName;

      if (!conn.dev1 && !conn.dev2) {
        lines.push(`${I(2)}// ${connId}: ${conn.attrs.signalDefinition || conn.signalName} (端点信息缺失)`);
        continue;
      }

      const from = conn.dev1
        ? conn.port1
          ? `${quote(conn.dev1)}.${quote(conn.port1)}`
          : quote(conn.dev1)
        : '/* unknown */';
      const to = conn.dev2
        ? conn.port2
          ? `${quote(conn.dev2)}.${quote(conn.port2)}`
          : quote(conn.dev2)
        : '/* unknown */';

      lines.push(`${I(2)}connection ${quote(connId)} : Signal`);
      lines.push(`${I(3)}connect ${from} to ${to} {`);

      const docParts: string[] = [];
      if (conn.attrs.signalName) docParts.push(conn.attrs.signalName);
      if (conn.attrs.signalDefinition) docParts.push(conn.attrs.signalDefinition);
      if (docParts.length > 0) {
        lines.push(`${I(3)}doc /* ${docParts.join(' — ')} */`);
      }

      if (conn.attrs.signalName) {
        lines.push(`${I(3)}attribute :>> signalName = "${conn.attrs.signalName}";`);
      }
      if (conn.attrs.signalDefinition) {
        lines.push(`${I(3)}attribute :>> signalDefinition = "${conn.attrs.signalDefinition}";`);
      }
      for (const [attr, val] of Object.entries(conn.attrs)) {
        if (SKIP_CONN_ATTRS.has(attr) || attr === 'signalName' || attr === 'signalDefinition') continue;
        lines.push(`${I(3)}attribute :>> ${attr} = "${val}";`);
      }

      lines.push(`${I(2)}}`);
      lines.push('');
    }
  }

  lines.push(`${I(1)}}`);
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
