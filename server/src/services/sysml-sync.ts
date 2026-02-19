/**
 * SysML v2 同步引擎
 *
 * 将 EICD 数据转为 SysML v2 JSON 元素并推送到 SysML v2 API Services。
 *
 * 关键：API 要求所有元素扁平化为独立的 DataVersion，
 * 子元素通过 owner.@id 引用父元素，不能嵌套在 ownedFeature 中。
 */

import { randomUUID } from 'crypto';
import { Database } from '../database.js';
import { SysmlApiClient, type DataVersion } from './sysml-api-client.js';
import {
  type TableData,
  extractEicdStructure,
} from './sysml-data-extractor.js';

// ── 类型 ──────────────────────────────────────────────────

export interface SyncResult {
  success: boolean;
  sysmlProjectId: string;
  commitId: string;
  elementCount: number;
  error?: string;
}

interface ElementMapEntry {
  eicdTable: string;
  eicdRowId: number;
  sysmlElementId: string;
  elementType: string;
  elementName: string;
}

// ── UUID 管理 ────────────────────────────────────────────

async function loadElementMap(
  db: Database,
  projectId: number,
): Promise<Map<string, string>> {
  const rows = await db.query(
    'SELECT eicd_table, eicd_row_id, sysml_element_id, element_type FROM sysml_element_map WHERE project_id = ?',
    [projectId],
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(`${r.eicd_table}:${r.eicd_row_id}:${r.element_type}`, r.sysml_element_id);
  }
  return map;
}

function getOrCreateUUID(
  existingMap: Map<string, string>,
  newEntries: ElementMapEntry[],
  table: string,
  rowId: number,
  elementType: string,
  elementName: string,
): string {
  const key = `${table}:${rowId}:${elementType}`;
  const existing = existingMap.get(key);
  if (existing) return existing;

  const id = randomUUID();
  existingMap.set(key, id);
  newEntries.push({ eicdTable: table, eicdRowId: rowId, sysmlElementId: id, elementType, elementName });
  return id;
}

// ── 元素构建（扁平化）────────────────────────────────────

function dv(element: Record<string, any>): DataVersion {
  return {
    '@type': 'DataVersion',
    payload: element as any,
    identity: { '@id': element['@id'] },
  };
}

// ── 主同步函数 ────────────────────────────────────────────

export async function syncToSysmlApi(
  db: Database,
  projectId: number,
  projectName: string,
  tables: TableData[],
  apiClient?: SysmlApiClient,
): Promise<SyncResult> {
  const client = apiClient || new SysmlApiClient();

  // 1. 健康检查
  if (!(await client.healthCheck())) {
    throw new Error('SysML v2 API 不可用，请确认服务已启动');
  }

  // 2. 并发检查
  const syncStatus = await db.get(
    'SELECT * FROM sysml_sync_status WHERE project_id = ?',
    [projectId],
  );
  if (syncStatus?.status === 'syncing') {
    throw new Error('同步正在进行中，请稍后再试');
  }

  // 3. 获取或创建 SysML 项目
  let sysmlProjectId: string;
  let lastCommitId: string | null = null;

  if (syncStatus) {
    const existing = await client.getProject(syncStatus.sysml_project_id);
    if (existing) {
      sysmlProjectId = syncStatus.sysml_project_id;
      lastCommitId = syncStatus.last_commit_id;
    } else {
      const proj = await client.createProject(`EICD_${projectName}`, `EICD project: ${projectName}`);
      sysmlProjectId = proj['@id'];
      await db.run('DELETE FROM sysml_element_map WHERE project_id = ?', [projectId]);
      await db.run(
        'UPDATE sysml_sync_status SET sysml_project_id = ?, last_commit_id = NULL WHERE project_id = ?',
        [sysmlProjectId, projectId],
      );
      lastCommitId = null;
    }
  } else {
    const proj = await client.createProject(`EICD_${projectName}`, `EICD project: ${projectName}`);
    sysmlProjectId = proj['@id'];
    await db.run(
      'INSERT INTO sysml_sync_status (project_id, sysml_project_id, status) VALUES (?, ?, ?)',
      [projectId, sysmlProjectId, 'syncing'],
    );
  }

  await db.run('UPDATE sysml_sync_status SET status = ? WHERE project_id = ?', ['syncing', projectId]);

  try {
    // 4. 加载 UUID 映射
    const existingMap = await loadElementMap(db, projectId);
    const newEntries: ElementMapEntry[] = [];

    // 5. 提取 EICD 结构
    const { deviceMap, connections } = extractEicdStructure(tables);

    // 6. 构建扁平化 DataVersion 数组
    const changes: DataVersion[] = [];

    // -- 根包 --
    const pkgId = getOrCreateUUID(existingMap, newEntries, '_meta', 0, 'Package', `EICD_${projectName}`);
    changes.push(dv({ '@type': 'Package', '@id': pkgId, name: `EICD_${projectName}` }));

    // -- 类型定义（扁平，只有 name） --
    const portDefId = getOrCreateUUID(existingMap, newEntries, '_meta', 1, 'PortDefinition', 'ConnectorPort');
    changes.push(dv({ '@type': 'PortDefinition', '@id': portDefId, name: 'ConnectorPort' }));

    const deviceDefId = getOrCreateUUID(existingMap, newEntries, '_meta', 2, 'PartDefinition', 'Device');
    changes.push(dv({ '@type': 'PartDefinition', '@id': deviceDefId, name: 'Device' }));

    const signalDefId = getOrCreateUUID(existingMap, newEntries, '_meta', 3, 'ConnectionDefinition', 'Signal');
    changes.push(dv({ '@type': 'ConnectionDefinition', '@id': signalDefId, name: 'Signal' }));

    // -- 系统实例 --
    const systemPartId = getOrCreateUUID(existingMap, newEntries, '_meta', 4, 'PartUsage', 'eicdSystem');
    changes.push(dv({ '@type': 'PartUsage', '@id': systemPartId, name: 'eicdSystem' }));

    // -- 设备 usage（每个设备 + 每个属性 + 每个端口都是独立元素）--
    let deviceIndex = 0;
    const deviceIdToUUID = new Map<string, string>();

    for (const dev of deviceMap.values()) {
      deviceIndex++;
      const devUUID = getOrCreateUUID(existingMap, newEntries, 'device', deviceIndex, 'PartUsage', dev.deviceId);
      deviceIdToUUID.set(dev.deviceId, devUUID);

      // 设备本身（不嵌套 ownedFeature）
      changes.push(dv({ '@type': 'PartUsage', '@id': devUUID, name: dev.deviceId }));

      // 属性作为独立的 AttributeUsage
      for (const [attr, val] of Object.entries(dev.attrs)) {
        const attrUUID = getOrCreateUUID(
          existingMap, newEntries,
          'device', deviceIndex, `Attr:${attr}`, `${dev.deviceId}.${attr}`,
        );
        changes.push(dv({
          '@type': 'AttributeUsage',
          '@id': attrUUID,
          name: `${attr}=${val}`,
        }));
      }

      // 端口作为独立的 PortUsage
      let portIdx = 0;
      for (const portName of dev.ports) {
        portIdx++;
        const portUUID = getOrCreateUUID(
          existingMap, newEntries,
          'device', deviceIndex, `Port:${portIdx}`, `${dev.deviceId}.${portName}`,
        );
        changes.push(dv({
          '@type': 'PortUsage',
          '@id': portUUID,
          name: portName,
        }));
      }
    }

    // -- 信号连接 usage --
    let connIndex = 0;
    for (const conn of connections) {
      connIndex++;
      const connName = conn.uniqueId || conn.signalName;
      if (!connName) continue;

      const connUUID = getOrCreateUUID(
        existingMap, newEntries,
        'connection', connIndex, 'ConnectionUsage', connName,
      );

      changes.push(dv({
        '@type': 'ConnectionUsage',
        '@id': connUUID,
        name: connName,
      }));

      // 信号属性
      const skipAttrs = new Set([
        'uniqueId', 'deviceId1', 'linNumber1', 'connectorNumber1', 'pinNumber1',
        'terminalSize1', 'shieldType1', 'signalDirection1',
        'deviceId2', 'linNumber2', 'connectorNumber2', 'pinNumber2',
        'terminalSize2', 'shieldType2', 'signalDirection2',
      ]);
      for (const [attr, val] of Object.entries(conn.attrs)) {
        if (skipAttrs.has(attr)) continue;
        const attrUUID = getOrCreateUUID(
          existingMap, newEntries,
          'connection', connIndex, `Attr:${attr}`, `${connName}.${attr}`,
        );
        changes.push(dv({
          '@type': 'AttributeUsage',
          '@id': attrUUID,
          name: `${attr}=${val}`,
        }));
      }
    }

    // 7. 提交
    const commit = await client.createCommit(sysmlProjectId, changes, lastCommitId);

    // 8. 保存新 UUID 映射
    for (const entry of newEntries) {
      await db.run(
        `INSERT OR REPLACE INTO sysml_element_map
         (project_id, eicd_table, eicd_row_id, sysml_element_id, element_type, element_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [projectId, entry.eicdTable, entry.eicdRowId, entry.sysmlElementId, entry.elementType, entry.elementName],
      );
    }

    // 9. 更新状态
    await db.run(
      `UPDATE sysml_sync_status
       SET last_commit_id = ?, last_sync_at = datetime('now'), status = 'synced', error_message = NULL
       WHERE project_id = ?`,
      [commit['@id'], projectId],
    );

    return {
      success: true,
      sysmlProjectId,
      commitId: commit['@id'],
      elementCount: changes.length,
    };
  } catch (err) {
    const errorMsg = (err as Error).message;
    await db.run(
      `UPDATE sysml_sync_status SET status = 'error', error_message = ? WHERE project_id = ?`,
      [errorMsg, projectId],
    ).catch(() => {});
    throw err;
  }
}
