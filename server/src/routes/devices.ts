import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';
import {
  isZontiRenyuan, isDeviceManager, getProjectRoleMembers,
  submitChangeRequest, ApprovalItemSpec, SPECIAL_ERN_LIN, cascadeDeletePinShared, isPinFrozen,
  renameConnectorsForLINChange,
} from '../shared/approval-helper.js';
import { validateConnectorCompId } from '../shared/column-schema.js';

/** 检查设备是否为固有ERN（通过 devId 或已有 device row） */
async function isERNDeviceById(db: Database, deviceId: number): Promise<boolean> {
  const d = await db.get('SELECT "设备LIN号（DOORS）" as lin FROM devices WHERE id = ?', [deviceId]);
  return String(d?.lin || '').trim() === SPECIAL_ERN_LIN;
}

// ── 级联删除辅助 ──────────────────────────────────────────

interface DeleteImpact {
  pins: Array<{ id: number; 针孔号: string; connector_id: number }>;
  connectors: Array<{ id: number; 设备端元器件编号: string; device_id: number }>;
  signalsDeleted: Array<{ id: number; unique_id: string }>; // 整条信号被删
  signalsModified: Array<{ id: number; unique_id: string; removedEndpoints: number }>; // 仅删除端点
}

/** 计算删除某个 pin 的影响 */
async function pinDeleteImpact(db: Database, pinId: number): Promise<DeleteImpact> {
  const impact: DeleteImpact = { pins: [], connectors: [], signalsDeleted: [], signalsModified: [] };
  const pin = await db.get('SELECT * FROM pins WHERE id = ?', [pinId]);
  if (!pin) return impact;
  impact.pins.push({ id: pin.id, 针孔号: pin['针孔号'], connector_id: pin.connector_id });

  // 查找引用此 pin 的信号端点
  const eps = await db.query(
    `SELECT se.signal_id, s.unique_id, (SELECT COUNT(*) FROM signal_endpoints WHERE signal_id = se.signal_id) as ep_count
     FROM signal_endpoints se JOIN signals s ON se.signal_id = s.id
     WHERE se.pin_id = ?`,
    [pinId]
  );
  const seen = new Set<number>();
  for (const ep of eps) {
    if (seen.has(ep.signal_id)) continue;
    seen.add(ep.signal_id);
    if (ep.ep_count <= 2) {
      impact.signalsDeleted.push({ id: ep.signal_id, unique_id: ep.unique_id || '' });
    } else {
      impact.signalsModified.push({ id: ep.signal_id, unique_id: ep.unique_id || '', removedEndpoints: 1 });
    }
  }
  return impact;
}

/** 计算删除某个 connector 的影响 */
async function connectorDeleteImpact(db: Database, connectorId: number): Promise<DeleteImpact> {
  const impact: DeleteImpact = { pins: [], connectors: [], signalsDeleted: [], signalsModified: [] };
  const conn = await db.get('SELECT * FROM connectors WHERE id = ?', [connectorId]);
  if (!conn) return impact;
  impact.connectors.push({ id: conn.id, 设备端元器件编号: conn['设备端元器件编号'], device_id: conn.device_id });

  const pins = await db.query('SELECT id FROM pins WHERE connector_id = ?', [connectorId]);
  const delSigSet = new Set<number>();
  const modSigMap = new Map<number, { unique_id: string; count: number }>();

  for (const p of pins) {
    const pi = await pinDeleteImpact(db, p.id);
    impact.pins.push(...pi.pins);
    for (const s of pi.signalsDeleted) {
      if (!delSigSet.has(s.id)) { delSigSet.add(s.id); impact.signalsDeleted.push(s); }
      modSigMap.delete(s.id); // 如果之前标为 modified，升级为 deleted
    }
    for (const s of pi.signalsModified) {
      if (delSigSet.has(s.id)) continue;
      const existing = modSigMap.get(s.id);
      if (existing) { existing.count += s.removedEndpoints; }
      else { modSigMap.set(s.id, { unique_id: s.unique_id, count: s.removedEndpoints }); }
    }
  }
  impact.signalsModified = [...modSigMap.entries()].map(([id, v]) => ({ id, unique_id: v.unique_id, removedEndpoints: v.count }));
  return impact;
}

/** 计算删除某个 device 的影响 */
async function deviceDeleteImpact(db: Database, deviceId: number): Promise<DeleteImpact> {
  const impact: DeleteImpact = { pins: [], connectors: [], signalsDeleted: [], signalsModified: [] };
  const connectors = await db.query('SELECT id FROM connectors WHERE device_id = ?', [deviceId]);
  const delSigSet = new Set<number>();
  const modSigMap = new Map<number, { unique_id: string; count: number }>();

  for (const c of connectors) {
    const ci = await connectorDeleteImpact(db, c.id);
    impact.connectors.push(...ci.connectors);
    impact.pins.push(...ci.pins);
    for (const s of ci.signalsDeleted) {
      if (!delSigSet.has(s.id)) { delSigSet.add(s.id); impact.signalsDeleted.push(s); }
      modSigMap.delete(s.id);
    }
    for (const s of ci.signalsModified) {
      if (delSigSet.has(s.id)) continue;
      const existing = modSigMap.get(s.id);
      if (existing) { existing.count += s.removedEndpoints; }
      else { modSigMap.set(s.id, { unique_id: s.unique_id, count: s.removedEndpoints }); }
    }
  }
  impact.signalsModified = [...modSigMap.entries()].map(([id, v]) => ({ id, unique_id: v.unique_id, removedEndpoints: v.count }));
  return impact;
}

// cascadeDeletePin 使用共享版本
const cascadeDeletePin = cascadeDeletePinShared;

/** 执行级联删除 connector */
async function cascadeDeleteConnector(db: Database, connectorId: number, userId: number, parentLog: string[]): Promise<void> {
  const conn = await db.get('SELECT * FROM connectors WHERE id = ?', [connectorId]);
  if (!conn) return;

  const pins = await db.query('SELECT id FROM pins WHERE connector_id = ?', [connectorId]);
  const connLog: string[] = [];
  for (const p of pins) {
    await cascadeDeletePin(db, p.id, userId, connLog);
  }

  // 记录连接器删除日志（包含针孔和信号影响）
  await db.run(
    `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
     VALUES ('connectors', ?, ?, 'connectors', ?, ?, ?, 'approved')`,
    [connectorId, connectorId, userId, JSON.stringify(conn),
     `删除连接器${connLog.length > 0 ? '；影响：' + connLog.join('；') : ''}`]
  );
  await db.run('DELETE FROM connectors WHERE id = ?', [connectorId]);
  parentLog.push(`连接器 ${conn['设备端元器件编号']} 被删除（含 ${pins.length} 个针孔）`);
}

/** 执行级联删除 device */
async function cascadeDeleteDevice(db: Database, deviceId: number, userId: number): Promise<string[]> {
  const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
  if (!device) return [];

  const connectors = await db.query('SELECT id FROM connectors WHERE device_id = ?', [deviceId]);
  const deviceLog: string[] = [];
  for (const c of connectors) {
    await cascadeDeleteConnector(db, c.id, userId, deviceLog);
  }

  // 记录设备删除日志（包含连接器、针孔、信号影响）
  await db.run(
    `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
     VALUES ('devices', ?, ?, 'devices', ?, ?, ?, 'approved')`,
    [deviceId, deviceId, userId, JSON.stringify(device),
     `删除设备${deviceLog.length > 0 ? '；影响：' + deviceLog.join('；') : ''}`]
  );
  await db.run('DELETE FROM devices WHERE id = ?', [deviceId]);
  return deviceLog;
}

export function deviceRoutes(db: Database) {
  const router = express.Router();

  const purgeExpiredLocks = () =>
    db.run("DELETE FROM edit_locks WHERE expires_at <= datetime('now')");

  // ── 设备校验函数（导入和编辑共用）──────────────────────────
  // 返回 { messages: 显示用错误信息, fields: 需标红的字段名 }
  async function validateDevice(merged: Record<string, any>, projectId: number): Promise<{ messages: string[], fields: string[] }> {
    const messages: string[] = [];
    const fields: string[] = [];

    // a) 通过 设备LIN号（DOORS） 在全机设备清单中查找
    const linVal = (merged['设备LIN号（DOORS）'] || '').trim();
    const adlMatch = await db.get(
      `SELECT * FROM aircraft_device_list WHERE project_id = ? AND LIN号_DOORS = ?`,
      [projectId, linVal]
    );
    if (!adlMatch) {
      messages.push(`在DOORS全机设备清单的设备编号管理Sheet里没有设备LIN号（DOORS）为"${linVal}"的设备`);
      fields.push('设备LIN号（DOORS）');
    } else {
      const comparePairs: [string, string, string][] = [
        ['设备编号', (merged['设备编号'] || '').trim(), (adlMatch.电设备编号 || '').trim()],
        ['设备中文名称', (merged['设备中文名称'] || '').trim(), (adlMatch.object_text || '').trim()],
        ['设备编号（DOORS）', (merged['设备编号（DOORS）'] || '').trim(), (adlMatch.设备编号_DOORS || '').trim()],
        ['设备安装位置', (merged['设备安装位置'] || '').trim(), (adlMatch.设备布置区域 || '').trim()],
      ];
      const mismatches = comparePairs.filter(([, importVal, doorsVal]) => importVal !== doorsVal);
      if (mismatches.length > 0) {
        const details = mismatches.map(([col, importVal, doorsVal]) =>
          `      "${col}"列 DOORS内值为"${doorsVal}"，导入值为"${importVal}"`
        ).join('；\n');
        messages.push(`已在DOORS全机设备清单的设备编号管理Sheet里找到设备LIN号（DOORS）为"${linVal}"的设备，但如下信息不符：\n${details}`);
        fields.push(...mismatches.map(([col]) => col));
      }
    }

    // c) 设备DAL
    const dalVal = (merged['设备DAL'] || '').trim();
    if (!['A', 'B', 'C', 'D', 'E', '其他'].includes(dalVal)) {
      messages.push(`设备DAL必须是A/B/C/D/E/其他，当前值为"${dalVal}"`);
      fields.push('设备DAL');
    }

    // d) 设备部件所属系统（4位ATA）
    const ataVal = (merged['设备部件所属系统（4位ATA）'] || '').trim();
    if (!/^\d{2}-\d{2}$/.test(ataVal) && ataVal !== '其他') {
      messages.push(`设备部件所属系统（4位ATA）格式应为12-34的四位数字或"其他"，当前值为"${ataVal}"`);
      fields.push('设备部件所属系统（4位ATA）');
    }

    // e) 设备壳体是否金属
    const isMetalShell = (merged['设备壳体是否金属'] || '').trim();
    if (!['是', '否'].includes(isMetalShell)) {
      messages.push(`设备壳体是否金属必须是"是"或"否"，额外信息请在"备注"中补充，当前值为"${isMetalShell}"`);
      fields.push('设备壳体是否金属');
    }

    // f) 金属壳体表面处理
    const shellTreated = (merged['金属壳体表面是否经过特殊处理而不易导电'] || '').trim();
    if (!['是', '否'].includes(isMetalShell)) {
      messages.push(`金属壳体表面是否经过特殊处理而不易导电：因"设备壳体是否金属"校验未通过，无法判断，当前值为"${shellTreated}"`);
      fields.push('金属壳体表面是否经过特殊处理而不易导电');
    } else if (isMetalShell === '是' && !['是', '否'].includes(shellTreated)) {
      messages.push(`金属壳体表面是否经过特殊处理而不易导电：当"设备壳体是否金属"为"是"时只能填"是"或"否"，额外信息请在"备注"中补充，当前值为"${shellTreated}"`);
      fields.push('金属壳体表面是否经过特殊处理而不易导电');
    } else if (isMetalShell === '否' && shellTreated !== 'N/A') {
      messages.push(`金属壳体表面是否经过特殊处理而不易导电：当"设备壳体是否金属"为"否"时必须填"N/A"，额外信息请在"备注"中补充，当前值为"${shellTreated}"`);
      fields.push('金属壳体表面是否经过特殊处理而不易导电');
    }

    // g) 设备壳体接地方式
    const groundMethod = (merged['设备壳体接地方式'] || '').trim();
    if (!['线搭接', '面搭接', '无'].includes(groundMethod)) {
      messages.push(`设备壳体接地方式必须是"线搭接"/"面搭接"/"无"，额外信息请在"备注"中补充，当前值为"${groundMethod}"`);
      fields.push('设备壳体接地方式');
    }

    // h) 壳体接地是否故障电流路径
    const faultPath = (merged['壳体接地是否故障电流路径'] || '').trim();
    if (!['是', '否'].includes(faultPath)) {
      messages.push(`壳体接地是否故障电流路径必须是"是"或"否"，额外信息请在"备注"中补充，当前值为"${faultPath}"`);
      fields.push('壳体接地是否故障电流路径');
    }

    return { messages, fields };
  }

  // ── 设备列表 ──────────────────────────────────────────────

  // GET /api/devices?projectId=N[&myDevices=true]
  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.query.projectId as string);
      if (isNaN(projectId)) return res.status(400).json({ error: '缺少 projectId' });

      const myDevices = req.query.myDevices === 'true';
      const relatedDevices = req.query.relatedDevices === 'true';
      const username = req.user!.username;
      const userRole = req.user!.role;

      // 检查普通用户是否有该项目的显式权限
      let hasProjectPermission = false;
      if (userRole === 'user') {
        const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
        const perms: Array<{ project_name: string }> = userRow?.permissions ? JSON.parse(userRow.permissions) : [];
        const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
        hasProjectPermission = perms.some((p: any) => p.project_name === projectRow?.name);
      }

      let sql = `
        SELECT d.*,
               (SELECT COUNT(*) FROM connectors c WHERE c.device_id = d.id) as connector_count
        FROM devices d
        WHERE d.project_id = ?
      `;
      const params: any[] = [projectId];

      if (relatedDevices) {
        // 与我有关的设备：通过信号端点与我的设备相连，但不是我负责的
        sql += `
          AND d.id IN (
            SELECT DISTINCT d2.id
            FROM devices d2
            JOIN connectors c2 ON c2.device_id = d2.id
            JOIN pins p2 ON p2.connector_id = c2.id
            JOIN signal_endpoints se2 ON se2.pin_id = p2.id
            WHERE se2.signal_id IN (
              SELECT DISTINCT se3.signal_id
              FROM signal_endpoints se3
              JOIN pins p3 ON p3.id = se3.pin_id
              JOIN connectors c3 ON c3.id = p3.connector_id
              JOIN devices d3 ON d3.id = c3.device_id
              WHERE d3."设备负责人" = ? AND d3.project_id = ?
            )
            AND d2."设备负责人" != ? AND d2.project_id = ?
          )
        `;
        params.push(username, projectId, username, projectId);
      } else if (myDevices || (userRole === 'user' && !hasProjectPermission)) {
        sql += ' AND d."设备负责人" = ?';
        params.push(username);
      }
      const sortBy = req.query.sortBy as string;
      const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
      if (sortBy === 'updated_at') {
        sql += ` ORDER BY d.updated_at ${sortOrder}, d.设备编号`;
      } else {
        sql += ' ORDER BY d.设备编号';
      }

      const devices = await db.query(sql, params);

      // 按状态统计设备/连接器/针孔数量
      const deviceIds: number[] = devices.map((d: any) => d.id);
      const statusSummary = {
        devices: { normal: 0, Draft: 0, Pending: 0 },
        connectors: { normal: 0, Draft: 0 },
        pins: { normal: 0, Draft: 0 },
      };
      for (const d of devices) {
        if (d.status === 'Draft') statusSummary.devices.Draft++;
        else if (d.status === 'Pending') statusSummary.devices.Pending++;
        else statusSummary.devices.normal++;
      }
      if (deviceIds.length > 0) {
        const ph = deviceIds.map(() => '?').join(',');
        const connStats = await db.query(
          `SELECT status, COUNT(*) as cnt FROM connectors WHERE device_id IN (${ph}) GROUP BY status`, deviceIds
        );
        for (const r of connStats) statusSummary.connectors[r.status === 'Draft' ? 'Draft' : 'normal'] += r.cnt;
        const pinStats = await db.query(
          `SELECT p.status, COUNT(*) as cnt FROM pins p JOIN connectors c ON p.connector_id = c.id WHERE c.device_id IN (${ph}) GROUP BY p.status`, deviceIds
        );
        for (const r of pinStats) statusSummary.pins[r.status === 'Draft' ? 'Draft' : 'normal'] += r.cnt;
      }

      // 批量查询设备负责人的员工姓名
      const ownerIds = [...new Set(devices.map((d: any) => d.设备负责人).filter(Boolean))];
      const empNameMap: Record<string, string> = {};
      if (ownerIds.length > 0) {
        const ph = ownerIds.map(() => '?').join(',');
        const emps = await db.query(`SELECT username as eid, name FROM users WHERE username IN (${ph})`, ownerIds);
        for (const e of emps) empNameMap[e.eid] = e.name;
      }
      for (const d of devices) {
        (d as any).设备负责人姓名 = d.设备负责人 ? (empNameMap[d.设备负责人] || null) : null;
      }

      // 获取当前用户在各 Pending 设备上的 pending_item_type
      const pendingDeviceIds = devices.filter((d: any) => d.status === 'Pending').map((d: any) => d.id);
      const pendingItemMap: Record<number, string | null> = {};
      if (pendingDeviceIds.length > 0) {
        const ph2 = pendingDeviceIds.map(() => '?').join(',');
        const pendingItems = await db.query(
          `SELECT ar.entity_id, ai.item_type
           FROM approval_requests ar
           JOIN approval_items ai ON ai.approval_request_id = ar.id
           WHERE ar.entity_type = 'device'
             AND ar.status = 'pending'
             AND ar.entity_id IN (${ph2})
             AND ai.recipient_username = ?
             AND ai.status = 'pending'`,
          [...pendingDeviceIds, username]
        );
        for (const pi of pendingItems) pendingItemMap[pi.entity_id] = pi.item_type;
        for (const id of pendingDeviceIds) {
          if (pendingItemMap[id] === undefined) pendingItemMap[id] = null;
        }
      }
      for (const d of devices) {
        (d as any).pending_item_type = d.status === 'Pending' ? (pendingItemMap[d.id] ?? null) : null;
      }

      // 查询各设备子项（连接器/针孔）是否有待审批/完善项
      // has_pending_sub: 对所有人可见（客观状态）
      // pending_sub_item_type: 当前用户有待处理的类型
      const subHasMap: Record<number, boolean> = {};
      const subItemMap: Record<number, string> = {};
      if (deviceIds.length > 0) {
        const ph3 = deviceIds.map(() => '?').join(',');
        // 连接器级别 - 是否有任何pending
        const connAnyPending = await db.query(
          `SELECT DISTINCT c.device_id
           FROM approval_requests ar
           JOIN connectors c ON ar.entity_id = c.id
           WHERE ar.entity_type = 'connector' AND ar.status = 'pending'
             AND c.device_id IN (${ph3})`,
          deviceIds
        );
        for (const r of connAnyPending) subHasMap[r.device_id] = true;
        // 针孔级别 - 是否有任何pending
        const pinAnyPending = await db.query(
          `SELECT DISTINCT c.device_id
           FROM approval_requests ar
           JOIN pins p ON ar.entity_id = p.id
           JOIN connectors c ON p.connector_id = c.id
           WHERE ar.entity_type = 'pin' AND ar.status = 'pending'
             AND c.device_id IN (${ph3})`,
          deviceIds
        );
        for (const r of pinAnyPending) subHasMap[r.device_id] = true;
        // 当前用户的待处理类型
        const connMyPending = await db.query(
          `SELECT c.device_id, ai.item_type
           FROM approval_requests ar
           JOIN approval_items ai ON ai.approval_request_id = ar.id
           JOIN connectors c ON ar.entity_id = c.id
           WHERE ar.entity_type = 'connector' AND ar.status = 'pending'
             AND c.device_id IN (${ph3})
             AND ai.recipient_username = ? AND ai.status = 'pending'`,
          [...deviceIds, username]
        );
        for (const r of connMyPending) {
          if (!subItemMap[r.device_id]) subItemMap[r.device_id] = r.item_type;
        }
        const pinMyPending = await db.query(
          `SELECT c.device_id, ai.item_type
           FROM approval_requests ar
           JOIN approval_items ai ON ai.approval_request_id = ar.id
           JOIN pins p ON ar.entity_id = p.id
           JOIN connectors c ON p.connector_id = c.id
           WHERE ar.entity_type = 'pin' AND ar.status = 'pending'
             AND c.device_id IN (${ph3})
             AND ai.recipient_username = ? AND ai.status = 'pending'`,
          [...deviceIds, username]
        );
        for (const r of pinMyPending) {
          if (!subItemMap[r.device_id]) subItemMap[r.device_id] = r.item_type;
        }
      }
      for (const d of devices) {
        (d as any).has_pending_sub = subHasMap[d.id] || false;
        (d as any).pending_sub_item_type = subItemMap[d.id] || null;
      }

      // 附加 management_claim_requester 虚拟字段
      if (deviceIds.length > 0) {
        const ph4 = deviceIds.map(() => '?').join(',');
        const claims = await db.query(
          `SELECT entity_id, requester_username FROM approval_requests
           WHERE action_type = 'request_device_management' AND status = 'pending'
           AND entity_id IN (${ph4})`,
          deviceIds
        );
        const claimMap: Record<number, string> = {};
        for (const c of claims) claimMap[c.entity_id] = c.requester_username;
        for (const d of devices) {
          (d as any).management_claim_requester = claimMap[d.id] || null;
        }
      }

      res.json({ devices, statusSummary });
    } catch (error: any) {
      console.error('获取设备列表失败:', error);
      res.status(500).json({ error: error.message || '获取设备列表失败' });
    }
  });

  // GET /api/devices/search?projectId=N&q=TERM
  router.get('/search', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.query.projectId as string);
      const q = (req.query.q as string || '').trim();
      if (isNaN(projectId)) return res.json({ devices: [] });

      const myDevices = req.query.myDevices === 'true';
      const username = req.user!.username;
      const userRole = req.user!.role;

      let hasProjectPermission = false;
      if (userRole === 'user') {
        const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
        const perms: Array<{ project_name: string }> = userRow?.permissions ? JSON.parse(userRow.permissions) : [];
        const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
        hasProjectPermission = perms.some((p: any) => p.project_name === projectRow?.name);
      }

      let sql: string;
      let params: any[];
      if (q) {
        const pattern = `%${q}%`;
        sql = `
          SELECT d.*
          FROM devices d
          WHERE d.project_id = ?
            AND (d.设备编号 LIKE ? OR d.设备中文名称 LIKE ? OR d.设备英文名称 LIKE ? OR d.设备英文缩写 LIKE ?)
        `;
        params = [projectId, pattern, pattern, pattern, pattern];
      } else {
        sql = `SELECT d.* FROM devices d WHERE d.project_id = ?`;
        params = [projectId];
      }

      if (myDevices || (userRole === 'user' && !hasProjectPermission)) {
        sql += ' AND d.设备负责人 = ?';
        params.push(username);
      }
      sql += ` ORDER BY d.设备编号 LIMIT ${q ? 20 : 200}`;

      const devices = await db.query(sql, params);
      res.json({ devices });
    } catch (error: any) {
      console.error('搜索设备失败:', error);
      res.status(500).json({ error: error.message || '搜索设备失败' });
    }
  });

  // GET /api/devices/:id
  router.get('/:id', authenticate, async (req, res) => {
    try {
      const device = await db.get('SELECT * FROM devices WHERE id = ?', [req.params.id]);
      if (!device) return res.status(404).json({ error: '设备不存在' });

      const connectors = await db.query(
        'SELECT c.*, (SELECT COUNT(*) FROM pins p WHERE p.connector_id = c.id) as pin_count FROM connectors c WHERE c.device_id = ? ORDER BY c."设备端元器件编号"',
        [device.id]
      );
      device.connectors = connectors;
      res.json({ device });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取设备失败' });
    }
  });

  // POST /api/devices/check-duplicates — 实时查重
  router.post('/check-duplicates', authenticate, async (req: AuthRequest, res) => {
    try {
      const { project_id, fields, exclude_id } = req.body;
      if (!project_id || !fields || typeof fields !== 'object') {
        return res.status(400).json({ error: '缺少 project_id 或 fields' });
      }
      const ALLOWED = ['设备编号', '设备中文名称', '设备LIN号（DOORS）', '设备编号（DOORS）'];
      const result: Record<string, { exists: boolean }> = {};
      for (const [field, value] of Object.entries(fields as Record<string, string>)) {
        if (!ALLOWED.includes(field) || !value || !String(value).trim()) continue;
        const params: any[] = [project_id, String(value).trim()];
        let sql = `SELECT 1 FROM devices WHERE project_id = ? AND "${field}" = ?`;
        if (exclude_id) { sql += ' AND id != ?'; params.push(exclude_id); }
        sql += ' LIMIT 1';
        const row = await db.get(sql, params);
        result[field] = { exists: !!row };
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || '查重失败' });
    }
  });

  // ── 设备 CRUD ──────────────────────────────────────────────

  // POST /api/devices
  router.post('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const { project_id, forceDraft, ...fields } = req.body;
      if (!project_id || !fields['设备编号']) {
        return res.status(400).json({ error: '缺少必填字段: project_id, 设备编号' });
      }

      const username = req.user!.username;
      const role = req.user!.role;
      const isAdmin = role === 'admin';
      const isZonti = !isAdmin && await isZontiRenyuan(db, username, project_id);

      if (!isAdmin && !isZonti) {
        return res.status(403).json({ error: '无权限，需要总体组角色' });
      }

      // 校验 设备LIN号（DOORS）不能为空
      const linNum = String(fields['设备LIN号（DOORS）'] || '').trim();
      if (!linNum) {
        return res.status(400).json({ error: '设备LIN号（DOORS）不能为空' });
      }
      // 校验项目内唯一
      const linDup = await db.get(
        `SELECT id FROM devices WHERE project_id = ? AND "设备LIN号（DOORS）" = ?`,
        [project_id, linNum]
      );
      if (linDup) {
        return res.status(409).json({ error: `设备LIN号（DOORS）"${linNum}"在本项目中已存在` });
      }

      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');

      // admin → 直接写入
      if (isAdmin) {
        const insertStatus = forceDraft ? 'Draft' : 'normal';
        const result = await db.run(
          `INSERT INTO devices (project_id, status, ${cols}) VALUES (?, ?, ${placeholders})`,
          [project_id, insertStatus, ...Object.values(fields)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, ?, ?)`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields),
           forceDraft ? '新增设备(Draft)' : '新增设备', forceDraft ? 'draft' : 'approved']
        );
        return res.json({ success: true, id: result.lastID });
      }

      // 总体组 → Draft 直接写入，提交则走审批
      if (forceDraft) {
        const result = await db.run(
          `INSERT INTO devices (project_id, status, ${cols}) VALUES (?, 'Draft', ${placeholders})`,
          [project_id, ...Object.values(fields)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, '新增设备(Draft)', 'draft')`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
        );
        return res.json({ success: true, id: result.lastID });
      }

      // 总体组提交审批：校验设备负责人
      if (!fields['设备负责人']) return res.status(400).json({ error: '提交审批时设备负责人不能为空' });

      const result = await db.run(
        `INSERT INTO devices (project_id, status, ${cols}) VALUES (?, 'Pending', ${placeholders})`,
        [project_id, ...Object.values(fields)]
      );

      const zontiList = await getProjectRoleMembers(db, project_id, '总体组');
      const otherZonti = zontiList.filter(u => u !== username);
      if (otherZonti.length === 0) {
        // 没有其他总体组成员，直接生效
        await db.run(`UPDATE devices SET status = 'normal' WHERE id = ?`, [result.lastID]);
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, '新增设备（无需审批）', 'approved')`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
        );
        return res.json({ success: true, id: result.lastID });
      }

      const items: ApprovalItemSpec[] = otherZonti.map(u => ({ recipient_username: u, item_type: 'approval' as const }));
      await submitChangeRequest(db, {
        projectId: project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'create_device',
        entityType: 'device',
        entityId: result.lastID,
        oldPayload: {},
        newPayload: fields,
        items,
      });
      return res.status(202).json({ pending: true, id: result.lastID, message: '已提交审批，等待其他总体组成员审批' });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该项目中设备LIN号（DOORS）已存在' });
      }
      res.status(500).json({ error: error.message || '创建设备失败' });
    }
  });

  // POST /api/devices/:id/claim-management — 系统组申请设备管理权（直接生效）
  router.post('/:id/claim-management', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return res.status(404).json({ error: '设备不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      if (role === 'admin') return res.status(403).json({ error: '管理员可直接分配设备负责人，无需申请' });

      const devMgr = await isDeviceManager(db, username, device.project_id);
      if (!devMgr) return res.status(403).json({ error: '仅系统组可申请管理权限' });

      if (device.设备负责人) return res.status(400).json({ error: '该设备已有负责人' });

      // 直接生效：设置设备负责人
      await db.run(`UPDATE devices SET "设备负责人" = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [username, deviceId]);

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
         VALUES ('devices', ?, ?, 'devices', ?, ?, ?, ?, 'approved')`,
        [deviceId, deviceId, req.user!.id, JSON.stringify({ 设备负责人: null }), JSON.stringify({ 设备负责人: username }), `${username} 申请管理此设备（直接生效）`]
      );

      return res.json({ success: true, message: '已成为该设备的负责人' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '申请失败' });
    }
  });

  // PUT /api/devices/:id
  router.put('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return res.status(404).json({ error: '设备不存在' });

      // 固有ERN设备仅admin可编辑
      const isERN = String(device['设备LIN号（DOORS）'] || '').trim() === SPECIAL_ERN_LIN;
      const username = req.user!.username;
      const role = req.user!.role;
      const isAdmin = role === 'admin';
      if (isERN && !isAdmin) return res.status(403).json({ error: '固有ERN设备不可编辑' });

      const isZonti = !isAdmin && await isZontiRenyuan(db, username, device.project_id);

      if (!isAdmin && !isZonti) {
        return res.status(403).json({ error: '无权限修改此设备' });
      }

      const { version, forceDraft, ...fields } = req.body;
      delete fields.id; delete fields.project_id; delete fields.created_at;
      delete fields.connector_count;
      delete fields.设备负责人姓名;
      delete fields.pending_item_type;
      delete fields.pending_sub_item_type;
      delete fields.has_pending_sub;
      delete fields.management_claim_requester;
      delete fields.import_status;

      // 校验 设备LIN号（DOORS）不能为空（若本次提交了该字段）
      if ('设备LIN号（DOORS）' in fields) {
        const linVal = String(fields['设备LIN号（DOORS）'] || '').trim();
        if (!linVal) {
          return res.status(400).json({ error: '设备LIN号（DOORS）不能为空' });
        }
        // 校验项目内唯一（排除自身）
        const linDupPut = await db.get(
          `SELECT id FROM devices WHERE project_id = ? AND "设备LIN号（DOORS）" = ? AND id != ?`,
          [device.project_id, linVal, deviceId]
        );
        if (linDupPut) {
          return res.status(409).json({ error: `设备LIN号（DOORS）"${linVal}"在本项目中已存在` });
        }
      }

      // 去除 设备部件所属系统（4位ATA） 首尾各类引号（含中文弯引号）
      const ATA_KEY = '设备部件所属系统（4位ATA）';
      if (fields[ATA_KEY] != null) {
        fields[ATA_KEY] = String(fields[ATA_KEY])
          .trim()
          .replace(/^['"\u2018\u2019\u201C\u201D]+|['"\u2018\u2019\u201C\u201D]+$/g, '')
          .trim();
      }

      // admin → 直接更新
      if (isAdmin) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        const result = await db.run(
          `UPDATE devices SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), deviceId, version ?? 1]
        );
        if (result.changes === 0) return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });

        // LIN 号变更 → 自动重命名连接器前缀
        const oldLIN = String(device['设备LIN号（DOORS）'] || '').trim();
        const newLIN = String(fields['设备LIN号（DOORS）'] ?? oldLIN).trim();
        let connRenames: Array<{ id: number; old: string; new: string }> = [];
        if (oldLIN && newLIN && oldLIN !== newLIN) {
          connRenames = await renameConnectorsForLINChange(db, deviceId, oldLIN, newLIN);
          if (connRenames.length > 0) {
            await db.run(
              `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
               VALUES ('devices', ?, ?, 'devices', ?, ?, ?, 'approved')`,
              [deviceId, deviceId, req.user!.id,
               JSON.stringify({ connector_renames: connRenames }),
               `设备LIN号变更(${oldLIN}→${newLIN})，自动重命名 ${connRenames.length} 个连接器前缀`]
            );
          }
        }

        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, ?, ?, ?)`,
          [deviceId, deviceId, req.user!.id, JSON.stringify(device), JSON.stringify(fields),
           forceDraft ? '修改设备(Draft)' : '修改设备', forceDraft ? 'draft' : 'approved']
        );
        const merged = { ...device, ...fields };
        if (forceDraft) {
          const ve = await validateDevice(merged, device.project_id);
          await db.run(`UPDATE devices SET status = 'Draft', import_status = NULL, validation_errors = ? WHERE id = ?`, [JSON.stringify(ve), deviceId]);
        } else {
          const ve = await validateDevice(merged, device.project_id);
          await db.run(`UPDATE devices SET status = ?, import_status = NULL, validation_errors = ? WHERE id = ?`,
            [ve.messages.length > 0 ? 'Draft' : 'normal', JSON.stringify(ve), deviceId]);
        }
        return res.json({ success: true });
      }

      // 总体组 → Draft 直接更新，提交走审批
      if (forceDraft) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        const result = await db.run(
          `UPDATE devices SET ${setClauses}, status = 'Draft', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), deviceId, version ?? 1]
        );
        if (result.changes === 0) return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });

        // LIN 号变更 → 自动重命名连接器前缀
        const oldLINDraft = String(device['设备LIN号（DOORS）'] || '').trim();
        const newLINDraft = String(fields['设备LIN号（DOORS）'] ?? oldLINDraft).trim();
        if (oldLINDraft && newLINDraft && oldLINDraft !== newLINDraft) {
          const renames = await renameConnectorsForLINChange(db, deviceId, oldLINDraft, newLINDraft);
          if (renames.length > 0) {
            await db.run(
              `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
               VALUES ('devices', ?, ?, 'devices', ?, ?, ?, 'approved')`,
              [deviceId, deviceId, req.user!.id,
               JSON.stringify({ connector_renames: renames }),
               `设备LIN号变更(${oldLINDraft}→${newLINDraft})，自动重命名 ${renames.length} 个连接器前缀`]
            );
          }
        }

        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, ?, '修改设备(Draft)', 'draft')`,
          [deviceId, deviceId, req.user!.id, JSON.stringify(device), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // Pending 设备禁止再次提交审批
      if (device.status === 'Pending') {
        return res.status(400).json({ error: '该设备正在审批中，无法重复提交修改。请等待审批完成后再编辑。' });
      }

      // 总体组提交审批：不直接修改设备数据，存入审批请求
      await db.run(`UPDATE devices SET status = 'Pending' WHERE id = ?`, [deviceId]);

      const zontiList = await getProjectRoleMembers(db, device.project_id, '总体组');
      const otherZonti = zontiList.filter(u => u !== username);
      if (otherZonti.length === 0) {
        // 没有其他总体组成员，直接生效
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        await db.run(
          `UPDATE devices SET ${setClauses}, status = 'normal', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [...Object.values(fields), deviceId]
        );

        // LIN 号变更 → 自动重命名连接器前缀
        const oldLIN0 = String(device['设备LIN号（DOORS）'] || '').trim();
        const newLIN0 = String(fields['设备LIN号（DOORS）'] ?? oldLIN0).trim();
        if (oldLIN0 && newLIN0 && oldLIN0 !== newLIN0) {
          const renames = await renameConnectorsForLINChange(db, deviceId, oldLIN0, newLIN0);
          if (renames.length > 0) {
            await db.run(
              `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
               VALUES ('devices', ?, ?, 'devices', ?, ?, ?, 'approved')`,
              [deviceId, deviceId, req.user!.id,
               JSON.stringify({ connector_renames: renames }),
               `设备LIN号变更(${oldLIN0}→${newLIN0})，自动重命名 ${renames.length} 个连接器前缀`]
            );
          }
        }

        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, ?, '修改设备（无需审批）', 'approved')`,
          [deviceId, deviceId, req.user!.id, JSON.stringify(device), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // 若 LIN 号变更，预计算连接器重命名列表放入审批 payload
      const oldLINAppr = String(device['设备LIN号（DOORS）'] || '').trim();
      const newLINAppr = String(fields['设备LIN号（DOORS）'] ?? oldLINAppr).trim();
      let pendingConnRenames: Array<{ id: number; old: string; new: string }> = [];
      if (oldLINAppr && newLINAppr && oldLINAppr !== newLINAppr) {
        const connectors: any[] = await db.query(
          `SELECT id, "设备端元器件编号" FROM connectors WHERE device_id = ?`, [deviceId]
        );
        for (const c of connectors) {
          const compId = c['设备端元器件编号'] || '';
          if (compId.startsWith(oldLINAppr + '-')) {
            pendingConnRenames.push({ id: c.id, old: compId, new: newLINAppr + compId.slice(oldLINAppr.length) });
          }
        }
      }

      const newPayload = pendingConnRenames.length > 0
        ? { ...fields, _connector_renames: pendingConnRenames }
        : fields;

      const items: ApprovalItemSpec[] = otherZonti.map(u => ({ recipient_username: u, item_type: 'approval' as const }));
      await submitChangeRequest(db, {
        projectId: device.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'edit_device',
        entityType: 'device',
        entityId: deviceId,
        oldPayload: device,
        newPayload: newPayload,
        items,
      });
      return res.status(202).json({ pending: true, message: '已提交审批，等待其他总体组成员审批' });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该项目中设备LIN号（DOORS）已存在' });
      }
      res.status(500).json({ error: error.message || '更新设备失败' });
    }
  });

  // 清空项目下全部设备（仅 admin，调试用）
  router.delete('/project/:projectId/all', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      // admin 批量清空：先手动删 signal_endpoints 绕过 pin_id RESTRICT 约束，
      // 再删 devices（CASCADE 删 connectors → pins）。不走 cascadeDeletePinShared，属于预期行为。
      await db.run(`
        DELETE FROM signal_endpoints WHERE device_id IN (
          SELECT id FROM devices WHERE project_id = ? AND "设备LIN号（DOORS）" != ?
        )
      `, [projectId, SPECIAL_ERN_LIN]);
      const { changes } = await db.run(
        `DELETE FROM devices WHERE project_id = ? AND "设备LIN号（DOORS）" != ?`,
        [projectId, SPECIAL_ERN_LIN]
      );
      res.json({ deleted: changes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/devices/:id/delete-impact — 预览删除影响
  router.get('/:id/delete-impact', authenticate, async (req, res) => {
    try {
      const impact = await deviceDeleteImpact(db, parseInt(req.params.id));
      res.json(impact);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // DELETE /api/devices/:id — 级联删除
  router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return res.status(404).json({ error: '设备不存在' });

      const isERN = String(device['设备LIN号（DOORS）'] || '').trim() === SPECIAL_ERN_LIN;
      const username = req.user!.username;
      const role = req.user!.role;
      const isAdmin = role === 'admin';
      if (isERN && !isAdmin) return res.status(403).json({ error: '固有ERN设备不可删除' });

      const isZonti = !isAdmin && await isZontiRenyuan(db, username, device.project_id);
      if (!isAdmin && !isZonti) return res.status(403).json({ error: '无权限删除此设备' });

      // admin → 直接级联删除
      if (isAdmin) {
        await cascadeDeleteDevice(db, deviceId, req.user!.id);
        return res.json({ success: true });
      }

      // 检查子项是否有审批中的
      const pendingSub = await db.get(
        `SELECT ar.id, ar.action_type, ar.entity_type FROM approval_requests ar WHERE ar.status = 'pending' AND (
          (ar.entity_type = 'connector' AND ar.entity_id IN (SELECT id FROM connectors WHERE device_id = ?))
          OR (ar.entity_type = 'pin' AND ar.entity_id IN (SELECT p.id FROM pins p JOIN connectors c ON p.connector_id = c.id WHERE c.device_id = ?))
        ) LIMIT 1`,
        [deviceId, deviceId]
      );
      if (pendingSub) return res.status(403).json({ error: '该设备下有子项正在审批中，请等待审批完成后再删除' });

      // 总体组 → 提交删除审批
      await db.run(`UPDATE devices SET status = 'Pending' WHERE id = ?`, [deviceId]);

      const zontiList = await getProjectRoleMembers(db, device.project_id, '总体组');
      const otherZonti = zontiList.filter(u => u !== username);
      if (otherZonti.length === 0) {
        await cascadeDeleteDevice(db, deviceId, req.user!.id);
        return res.json({ success: true });
      }

      const delImpact = await deviceDeleteImpact(db, deviceId);
      const items: ApprovalItemSpec[] = otherZonti.map(u => ({ recipient_username: u, item_type: 'approval' as const }));
      await submitChangeRequest(db, {
        projectId: device.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'delete_device',
        entityType: 'device',
        entityId: deviceId,
        oldPayload: device,
        newPayload: { _deleteImpact: delImpact },
        items,
      });
      return res.status(202).json({ pending: true, message: '删除请求已提交审批' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除设备失败' });
    }
  });

  // ── 连接器 CRUD ───────────────────────────────────────────

  // GET /api/devices/:devId/connectors
  router.get('/:devId/connectors', authenticate, async (req: AuthRequest, res) => {
    try {
      const connectors = await db.query(
        `SELECT c.*,
                (SELECT COUNT(*) FROM pins p WHERE p.connector_id = c.id) as pin_count
         FROM connectors c WHERE c.device_id = ? ORDER BY c."设备端元器件编号"`,
        [req.params.devId]
      );
      // 为每个连接器检查是否有子项（针孔）在审批中
      const connIds = connectors.map((c: any) => c.id);
      if (connIds.length > 0) {
        const ph = connIds.map(() => '?').join(',');
        const pinPending = await db.query(
          `SELECT DISTINCT c.id as conn_id
           FROM approval_requests ar
           JOIN pins p ON ar.entity_id = p.id
           JOIN connectors c ON p.connector_id = c.id
           WHERE ar.entity_type = 'pin' AND ar.status = 'pending'
             AND c.id IN (${ph})`,
          connIds
        );
        const pendingSet = new Set(pinPending.map((r: any) => r.conn_id));
        for (const c of connectors) {
          (c as any).has_pending_sub = pendingSet.has(c.id);
        }
      }
      res.json({ connectors });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取连接器失败' });
    }
  });

  // POST /api/devices/:devId/connectors
  router.post('/:devId/connectors', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.devId);
      const { forceDraft, ...fields } = req.body as { forceDraft?: boolean; [key: string]: any };
      if (!fields['设备端元器件编号']) return res.status(400).json({ error: '缺少设备端元器件编号' });

      const username = req.user!.username;
      const role = req.user!.role;
      const devRow = await db.get('SELECT 设备负责人, project_id, "设备LIN号（DOORS）" as lin, "设备部件所属系统（4位ATA）" as ata FROM devices WHERE id = ?', [deviceId]);
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      // 固有ERN设备的连接器仅admin可操作
      if (String(devRow.lin || '').trim() === SPECIAL_ERN_LIN && !isAdmin) {
        return res.status(403).json({ error: '固有ERN连接器不可添加' });
      }
      const isZonti = !isAdmin && await isZontiRenyuan(db, username, devRow.project_id);

      if (!isAdmin && !isZonti) {
        return res.status(403).json({ error: '无权限，需要总体组角色' });
      }

      // 连接器编号格式校验
      const compIdErr = validateConnectorCompId(fields['设备端元器件编号'], devRow.lin || '', devRow.ata || '');
      if (compIdErr) return res.status(400).json({ error: compIdErr });

      // 设备级 设备端元器件编号 唯一性校验
      const compId = fields['设备端元器件编号'];
      const dup = await db.get(
        `SELECT id FROM connectors WHERE device_id = ? AND "设备端元器件编号" = ?`,
        [deviceId, compId]
      );
      if (dup) return res.status(409).json({ error: `设备端元器件编号"${compId}"在该设备中已存在` });

      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');

      // admin → 直接写入
      if (isAdmin) {
        const insertStatus = forceDraft ? 'Draft' : 'normal';
        const result = await db.run(
          `INSERT INTO connectors (device_id, status, ${cols}) VALUES (?, ?, ${placeholders})`,
          [deviceId, insertStatus, ...Object.values(fields)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, ?, ?)`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields),
           forceDraft ? '新增连接器(Draft)' : '新增连接器', forceDraft ? 'draft' : 'approved']
        );
        return res.json({ success: true, id: result.lastID });
      }

      // 总体组 → Draft 直接写入，提交则走审批
      if (forceDraft) {
        const result = await db.run(
          `INSERT INTO connectors (device_id, status, ${cols}) VALUES (?, 'Draft', ${placeholders})`,
          [deviceId, ...Object.values(fields)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, '新增连接器(Draft)', 'draft')`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
        );
        return res.json({ success: true, id: result.lastID });
      }

      const result = await db.run(
        `INSERT INTO connectors (device_id, status, ${cols}) VALUES (?, 'Pending', ${placeholders})`,
        [deviceId, ...Object.values(fields)]
      );

      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体组');
      const otherZonti = zontiList.filter(u => u !== username);
      if (otherZonti.length === 0) {
        await db.run(`UPDATE connectors SET status = 'normal' WHERE id = ?`, [result.lastID]);
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, '新增连接器（无需审批）', 'approved')`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
        );
        return res.json({ success: true, id: result.lastID });
      }

      const items: ApprovalItemSpec[] = otherZonti.map(u => ({ recipient_username: u, item_type: 'approval' as const }));
      await submitChangeRequest(db, {
        projectId: devRow.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'create_connector',
        entityType: 'connector',
        entityId: result.lastID,
        deviceId,
        oldPayload: {},
        newPayload: fields,
        items,
      });
      return res.status(202).json({ pending: true, id: result.lastID, message: '已提交审批，等待其他总体组成员审批' });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该设备中设备端元器件编号已存在' });
      }
      res.status(500).json({ error: error.message || '创建连接器失败' });
    }
  });

  // PUT /api/devices/:devId/connectors/:id
  router.put('/:devId/connectors/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const connectorId = parseInt(req.params.id);
      const username = req.user!.username;
      const role = req.user!.role;
      const devRow = await db.get('SELECT 设备负责人, project_id, "设备LIN号（DOORS）" as lin, "设备部件所属系统（4位ATA）" as ata FROM devices WHERE id = ?', [req.params.devId]);
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      if (String(devRow.lin || '').trim() === SPECIAL_ERN_LIN && !isAdmin) {
        return res.status(403).json({ error: '固有ERN连接器不可编辑' });
      }
      const isZonti = !isAdmin && await isZontiRenyuan(db, username, devRow.project_id);

      if (!isAdmin && !isZonti) {
        return res.status(403).json({ error: '无权限修改连接器' });
      }

      const { version, forceDraft, ...fields } = req.body;
      delete fields.id; delete fields.device_id; delete fields.created_at; delete fields.pin_count;

      // 连接器编号格式校验
      if (fields['设备端元器件编号']) {
        const compIdErr = validateConnectorCompId(fields['设备端元器件编号'], devRow.lin || '', devRow.ata || '');
        if (compIdErr) return res.status(400).json({ error: compIdErr });
      }

      // 项目级 设备端元器件编号 唯一性校验（排除自身）
      const compId = fields['设备端元器件编号'];
      if (compId) {
        const dup = await db.get(
          `SELECT c.id FROM connectors c JOIN devices d ON c.device_id = d.id WHERE d.project_id = ? AND c."设备端元器件编号" = ? AND c.id != ?`,
          [devRow.project_id, compId, connectorId]
        );
        if (dup) return res.status(409).json({ error: `设备端元器件编号"${compId}"在本项目中已存在` });
      }

      const oldConnector = await db.get('SELECT * FROM connectors WHERE id = ?', [connectorId]);

      // admin → 直接更新
      if (isAdmin) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        const updateStatus = forceDraft ? 'Draft' : 'normal';
        const result = await db.run(
          `UPDATE connectors SET ${setClauses}, status = ?, import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), updateStatus, connectorId, version ?? 1]
        );
        if (result.changes === 0) return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, ?, ?, ?)`,
          [connectorId, connectorId, req.user!.id, JSON.stringify(oldConnector), JSON.stringify(fields),
           forceDraft ? '修改连接器(Draft)' : '修改连接器', forceDraft ? 'draft' : 'approved']
        );
        return res.json({ success: true });
      }

      // 总体组 → Draft 直接更新，提交走审批
      if (forceDraft) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        const result = await db.run(
          `UPDATE connectors SET ${setClauses}, status = 'Draft', import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), connectorId, version ?? 1]
        );
        if (result.changes === 0) return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, ?, '修改连接器(Draft)', 'draft')`,
          [connectorId, connectorId, req.user!.id, JSON.stringify(oldConnector), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // Pending 连接器禁止再次提交审批
      if (oldConnector.status === 'Pending') {
        return res.status(400).json({ error: '该连接器正在审批中，无法重复提交修改。请等待审批完成后再编辑。' });
      }

      // 总体组提交审批
      await db.run(`UPDATE connectors SET status = 'Pending' WHERE id = ?`, [connectorId]);

      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体组');
      const otherZonti = zontiList.filter(u => u !== username);
      if (otherZonti.length === 0) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        await db.run(
          `UPDATE connectors SET ${setClauses}, status = 'normal', import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [...Object.values(fields), connectorId]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, ?, '修改连接器（无需审批）', 'approved')`,
          [connectorId, connectorId, req.user!.id, JSON.stringify(oldConnector), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      const items: ApprovalItemSpec[] = otherZonti.map(u => ({ recipient_username: u, item_type: 'approval' as const }));
      await submitChangeRequest(db, {
        projectId: devRow.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'edit_connector',
        entityType: 'connector',
        entityId: connectorId,
        deviceId: parseInt(req.params.devId),
        oldPayload: oldConnector,
        newPayload: fields,
        items,
      });
      return res.status(202).json({ pending: true, message: '已提交审批，等待其他总体组成员审批' });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该设备中设备端元器件编号已存在' });
      }
      res.status(500).json({ error: error.message || '更新连接器失败' });
    }
  });

  // GET /api/devices/:devId/connectors/:id/delete-impact
  router.get('/:devId/connectors/:id/delete-impact', authenticate, async (req, res) => {
    try {
      const impact = await connectorDeleteImpact(db, parseInt(req.params.id));
      res.json(impact);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // DELETE /api/devices/:devId/connectors/:id — 级联删除
  router.delete('/:devId/connectors/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const connectorId = parseInt(req.params.id);
      const username = req.user!.username;
      const role = req.user!.role;

      const devRow = await db.get('SELECT 设备负责人, project_id, "设备LIN号（DOORS）" as lin FROM devices WHERE id = ?', [req.params.devId]);
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      if (String(devRow.lin || '').trim() === SPECIAL_ERN_LIN && !isAdmin) {
        return res.status(403).json({ error: '固有ERN连接器不可删除' });
      }
      const isZonti = !isAdmin && await isZontiRenyuan(db, username, devRow.project_id);
      if (!isAdmin && !isZonti) return res.status(403).json({ error: '无权限删除连接器' });

      const connToDelete = await db.get('SELECT * FROM connectors WHERE id = ? AND device_id = ?', [connectorId, req.params.devId]);
      if (!connToDelete) return res.status(404).json({ error: '连接器不存在' });

      // admin → 直接级联删除
      if (isAdmin) {
        const log: string[] = [];
        await cascadeDeleteConnector(db, connectorId, req.user!.id, log);
        return res.json({ success: true });
      }

      // 检查子项（针孔）是否有审批中的
      const pendingPin = await db.get(
        `SELECT ar.id FROM approval_requests ar WHERE ar.status = 'pending'
         AND ar.entity_type = 'pin' AND ar.entity_id IN (SELECT id FROM pins WHERE connector_id = ?)
         LIMIT 1`,
        [connectorId]
      );
      if (pendingPin) return res.status(403).json({ error: '该连接器下有针孔正在审批中，请等待审批完成后再删除' });

      // 总体组 → 提交删除审批
      await db.run(`UPDATE connectors SET status = 'Pending' WHERE id = ?`, [connectorId]);

      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体组');
      const otherZonti = zontiList.filter(u => u !== username);
      if (otherZonti.length === 0) {
        const log: string[] = [];
        await cascadeDeleteConnector(db, connectorId, req.user!.id, log);
        return res.json({ success: true });
      }

      const connDelImpact = await connectorDeleteImpact(db, connectorId);
      const items: ApprovalItemSpec[] = otherZonti.map(u => ({ recipient_username: u, item_type: 'approval' as const }));
      await submitChangeRequest(db, {
        projectId: devRow.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'delete_connector',
        entityType: 'connector',
        entityId: connectorId,
        deviceId: parseInt(req.params.devId),
        oldPayload: connToDelete,
        newPayload: { _deleteImpact: connDelImpact },
        items,
      });
      return res.status(202).json({ pending: true, message: '删除请求已提交审批' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除连接器失败' });
    }
  });

  // ── 合并连接器 ───────────────────────────────────────────

  // POST /api/devices/:devId/connectors/merge
  router.post('/:devId/connectors/merge', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.devId);
      const { targetConnectorId, sourceConnectorIds } = req.body as { targetConnectorId: number; sourceConnectorIds: number[] };

      if (!targetConnectorId || !Array.isArray(sourceConnectorIds) || sourceConnectorIds.length === 0) {
        return res.status(400).json({ error: '缺少目标连接器或源连接器' });
      }

      const username = req.user!.username;
      const role = req.user!.role;
      const devRow = await db.get('SELECT 设备负责人, project_id, "设备LIN号（DOORS）" as lin FROM devices WHERE id = ?', [deviceId]);
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      const isZonti = !isAdmin && await isZontiRenyuan(db, username, devRow.project_id);
      if (!isAdmin && !isZonti) return res.status(403).json({ error: '无权限，需要总体组角色' });

      // 校验目标连接器属于该设备
      const targetConn = await db.get('SELECT * FROM connectors WHERE id = ? AND device_id = ?', [targetConnectorId, deviceId]);
      if (!targetConn) return res.status(404).json({ error: '目标连接器不存在或不属于该设备' });

      const mergeLog: string[] = [];
      let movedPins = 0;

      for (const sourceId of sourceConnectorIds) {
        if (sourceId === targetConnectorId) continue;
        const sourceConn = await db.get('SELECT * FROM connectors WHERE id = ? AND device_id = ?', [sourceId, deviceId]);
        if (!sourceConn) continue;

        const sourceCompId = sourceConn['设备端元器件编号'];
        // 去掉设备LIN号前缀：如 "2101M8103-J2" → "J2"
        const lin = String(devRow.lin || '');
        const shortCompId = sourceCompId.startsWith(lin + '-') ? sourceCompId.slice(lin.length + 1) : sourceCompId;

        // 获取源连接器的所有针孔
        const pins = await db.query('SELECT * FROM pins WHERE connector_id = ?', [sourceId]);

        for (const pin of pins) {
          const newPinNum = `${shortCompId}-${pin['针孔号']}`;
          // 更新针孔：移到目标连接器，重命名针孔号
          await db.run(
            `UPDATE pins SET connector_id = ?, "针孔号" = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [targetConnectorId, newPinNum, pin.id]
          );
          movedPins++;
        }

        // 记录源连接器的删除日志
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, ?, 'approved')`,
          [sourceId, sourceId, req.user!.id, JSON.stringify(sourceConn),
           `合并到连接器 ${targetConn['设备端元器件编号']}（${pins.length} 个针孔迁移）`]
        );

        // 删除空的源连接器
        await db.run('DELETE FROM connectors WHERE id = ?', [sourceId]);
        mergeLog.push(`${sourceCompId}（${pins.length} 个针孔）`);
      }

      // 记录目标连接器的变更日志
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
         VALUES ('connectors', ?, ?, 'connectors', ?, ?, ?, 'approved')`,
        [targetConnectorId, targetConnectorId, req.user!.id, JSON.stringify(targetConn),
         `合并了 ${mergeLog.length} 个连接器：${mergeLog.join('、')}，共迁移 ${movedPins} 个针孔`]
      );

      res.json({ success: true, merged: mergeLog.length, movedPins });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '合并连接器失败' });
    }
  });

  // ── 针孔 CRUD ─────────────────────────────────────────────

  // GET /api/devices/:devId/connectors/:connId/pins
  router.get('/:devId/connectors/:connId/pins', authenticate, async (req, res) => {
    try {
      const pins = await db.query(
        'SELECT * FROM pins WHERE connector_id = ? ORDER BY 针孔号',
        [req.params.connId]
      );
      res.json({ pins });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取针孔失败' });
    }
  });

  // POST /api/devices/:devId/connectors/:connId/pins
  router.post('/:devId/connectors/:connId/pins', authenticate, async (req: AuthRequest, res) => {
    try {
      const connectorId = parseInt(req.params.connId);
      const { 针孔号, forceDraft, ...rest } = req.body;
      if (!针孔号) return res.status(400).json({ error: '缺少针孔号' });

      const username = req.user!.username;
      const role = req.user!.role;
      const devRow = await db.get(
        'SELECT d.设备负责人, d.project_id, d."设备LIN号（DOORS）" as lin FROM devices d JOIN connectors c ON c.device_id = d.id WHERE c.id = ?',
        [connectorId]
      );
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      // 固有ERN设备的针孔仅admin可操作
      if (String(devRow.lin || '').trim() === SPECIAL_ERN_LIN && !isAdmin) {
        return res.status(403).json({ error: '固有ERN针孔不可添加' });
      }
      // 检查设备/连接器是否待删除审批中
      const delDevReq = await db.get(`SELECT id FROM approval_requests WHERE entity_type = 'device' AND entity_id = ? AND action_type = 'delete_device' AND status = 'pending'`, [req.params.devId]);
      if (delDevReq) return res.status(403).json({ error: '设备待删除审批中，不可操作针孔' });
      const delConnReq = await db.get(`SELECT id FROM approval_requests WHERE entity_type = 'connector' AND entity_id = ? AND action_type = 'delete_connector' AND status = 'pending'`, [connectorId]);
      if (delConnReq) return res.status(403).json({ error: '连接器待删除审批中，不可操作针孔' });

      const isDevMgr = !isAdmin && await isDeviceManager(db, username, devRow.project_id);

      if (!isAdmin && !isDevMgr) {
        return res.status(403).json({ error: '无权限，需要系统组角色' });
      }

      // 系统组只能操作自己负责的设备
      if (isDevMgr && devRow.设备负责人 !== username) {
        return res.status(403).json({ error: '只能操作自己负责的设备的针孔' });
      }

      const fields: Record<string, any> = { 针孔号, ...rest };
      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');

      // admin / 总体组 / 系统组 → 直接写入
      const insertStatus = forceDraft ? 'Draft' : 'normal';
      const result = await db.run(
        `INSERT INTO pins (connector_id, status, ${cols}) VALUES (?, ?, ${placeholders})`,
        [connectorId, insertStatus, ...Object.values(fields)]
      );
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES ('pins', ?, ?, 'pins', ?, ?, ?, ?)`,
        [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields),
         forceDraft ? '新增针孔(Draft)' : '新增针孔', forceDraft ? 'draft' : 'approved']
      );
      return res.json({ success: true, id: result.lastID });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该连接器中针孔号已存在' });
      }
      res.status(500).json({ error: error.message || '创建针孔失败' });
    }
  });

  // PUT /api/devices/:devId/connectors/:connId/pins/:id
  router.put('/:devId/connectors/:connId/pins/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const pinId = parseInt(req.params.id);
      const username = req.user!.username;
      const role = req.user!.role;
      const devRow = await db.get(
        'SELECT d.设备负责人, d.project_id, d."设备LIN号（DOORS）" as lin FROM devices d JOIN connectors c ON c.device_id = d.id WHERE c.id = ?',
        [req.params.connId]
      );
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      if (String(devRow.lin || '').trim() === SPECIAL_ERN_LIN && !isAdmin) {
        return res.status(403).json({ error: '固有ERN针孔不可编辑' });
      }
      const isDevMgr = !isAdmin && await isDeviceManager(db, username, devRow.project_id);

      if (!isAdmin && !isDevMgr) {
        return res.status(403).json({ error: '无权限修改针孔' });
      }

      // 系统组只能操作自己负责的设备
      if (isDevMgr && devRow.设备负责人 !== username) {
        return res.status(403).json({ error: '只能操作自己负责的设备的针孔' });
      }

      const { version, forceDraft, ...fields } = req.body;
      delete fields.id; delete fields.connector_id; delete fields.created_at;

      const oldPin = await db.get('SELECT * FROM pins WHERE id = ?', [pinId]);
      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');

      // admin → 直接更新
      if (isAdmin) {
        const result = await db.run(
          `UPDATE pins SET ${setClauses}, status = ?, import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), forceDraft ? 'Draft' : 'normal', pinId, version ?? 1]
        );
        if (result.changes === 0) return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('pins', ?, ?, 'pins', ?, ?, ?, ?, ?)`,
          [pinId, pinId, req.user!.id, JSON.stringify(oldPin), JSON.stringify(fields),
           forceDraft ? '修改针孔(Draft)' : '修改针孔', forceDraft ? 'draft' : 'approved']
        );
        return res.json({ success: true });
      }

      // 系统组 → Draft 直接更新
      if (forceDraft) {
        const result = await db.run(
          `UPDATE pins SET ${setClauses}, status = 'Draft', import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), pinId, version ?? 1]
        );
        if (result.changes === 0) return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('pins', ?, ?, 'pins', ?, ?, ?, '修改针孔(Draft)', 'draft')`,
          [pinId, pinId, req.user!.id, JSON.stringify(oldPin), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // 系统组提交：检查是否有关联信号
      const relatedSignals = await db.query(
        `SELECT DISTINCT se.signal_id FROM signal_endpoints se WHERE se.pin_id = ?`, [pinId]
      );

      if (relatedSignals.length === 0) {
        // 无关联信号 → 直接更新
        const result = await db.run(
          `UPDATE pins SET ${setClauses}, status = 'normal', import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), pinId, version ?? 1]
        );
        if (result.changes === 0) return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('pins', ?, ?, 'pins', ?, ?, ?, '修改针孔', 'approved')`,
          [pinId, pinId, req.user!.id, JSON.stringify(oldPin), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // 有关联信号 → 提交两阶段审批
      await db.run(`UPDATE pins SET status = 'Pending' WHERE id = ?`, [pinId]);

      // 收集审批人：关联信号的其他设备负责人(completion) + 总体组(approval)
      const items: ApprovalItemSpec[] = [];
      const ownersSeen = new Set<string>();
      for (const { signal_id } of relatedSignals) {
        const eps = await db.query(
          `SELECT d.设备负责人 FROM signal_endpoints se JOIN devices d ON se.device_id = d.id WHERE se.signal_id = ?`,
          [signal_id]
        );
        for (const ep of eps) {
          const owner = ep.设备负责人;
          if (owner && owner !== username && !ownersSeen.has(owner)) {
            ownersSeen.add(owner);
            items.push({ recipient_username: owner, item_type: 'completion' });
          }
        }
      }
      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体组');
      zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));

      if (items.length === 0) {
        // 无审批人 → 直接更新
        const result = await db.run(
          `UPDATE pins SET ${setClauses}, status = 'normal', import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), pinId, version ?? 1]
        );
        if (result.changes === 0) return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        return res.json({ success: true });
      }

      await submitChangeRequest(db, {
        projectId: devRow.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'edit_pin',
        entityType: 'pin',
        entityId: pinId,
        deviceId: parseInt(req.params.devId),
        oldPayload: oldPin,
        newPayload: fields,
        items,
      });
      return res.status(202).json({ pending: true, message: '已提交审批' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '更新针孔失败' });
    }
  });

  // DELETE /api/devices/:devId/connectors/:connId/pins/:id
  // GET /api/devices/:devId/connectors/:connId/pins/:id/related-signals
  router.get('/:devId/connectors/:connId/pins/:id/related-signals', authenticate, async (req, res) => {
    try {
      const signals = await db.query(
        `SELECT DISTINCT s.id, s.unique_id, (SELECT COUNT(*) FROM signal_endpoints WHERE signal_id = s.id) as ep_count
         FROM signal_endpoints se JOIN signals s ON se.signal_id = s.id
         WHERE se.pin_id = ?`,
        [req.params.id]
      );
      res.json({ signals });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // GET /api/devices/:devId/connectors/:connId/pins/:id/delete-impact
  router.get('/:devId/connectors/:connId/pins/:id/delete-impact', authenticate, async (req, res) => {
    try {
      const impact = await pinDeleteImpact(db, parseInt(req.params.id));
      res.json(impact);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // DELETE /api/devices/:devId/connectors/:connId/pins/:id — 级联删除
  router.delete('/:devId/connectors/:connId/pins/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const pinId = parseInt(req.params.id);
      const username = req.user!.username;
      const role = req.user!.role;

      const devRow = await db.get(
        'SELECT d.设备负责人, d.project_id, d."设备LIN号（DOORS）" as lin FROM devices d JOIN connectors c ON c.device_id = d.id WHERE c.id = ?',
        [req.params.connId]
      );
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      if (String(devRow.lin || '').trim() === SPECIAL_ERN_LIN && !isAdmin) {
        return res.status(403).json({ error: '固有ERN针孔不可删除' });
      }
      const isDevMgr = !isAdmin && await isDeviceManager(db, username, devRow.project_id);

      if (!isAdmin && !isDevMgr) {
        return res.status(403).json({ error: '无权限删除针孔' });
      }

      if (isDevMgr && devRow.设备负责人 !== username) {
        return res.status(403).json({ error: '只能操作自己负责的设备的针孔' });
      }

      const pinToDelete = await db.get('SELECT * FROM pins WHERE id = ? AND connector_id = ?', [pinId, req.params.connId]);
      if (!pinToDelete) return res.status(404).json({ error: '针孔不存在' });

      // admin → 直接级联删除
      if (isAdmin) {
        const log: string[] = [];
        await cascadeDeletePin(db, pinId, req.user!.id, log);
        return res.json({ success: true });
      }

      // 系统组：检查是否有关联信号
      const relatedSignals = await db.query(
        `SELECT DISTINCT se.signal_id FROM signal_endpoints se WHERE se.pin_id = ?`, [pinId]
      );

      if (relatedSignals.length === 0) {
        // 无关联信号 → 无 signal_endpoints 引用，可安全直接删除（不需走 cascadeDeletePinShared）
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
           VALUES ('pins', ?, ?, 'pins', ?, ?, '删除针孔', 'approved')`,
          [pinId, pinId, req.user!.id, JSON.stringify(pinToDelete)]
        );
        await db.run('DELETE FROM pins WHERE id = ?', [pinId]);
        return res.json({ success: true });
      }

      // 有关联信号 → 提交两阶段审批
      await db.run(`UPDATE pins SET status = 'Pending' WHERE id = ?`, [pinId]);

      const items: ApprovalItemSpec[] = [];
      const ownersSeen = new Set<string>();
      for (const { signal_id } of relatedSignals) {
        const eps = await db.query(
          `SELECT d.设备负责人 FROM signal_endpoints se JOIN devices d ON se.device_id = d.id WHERE se.signal_id = ?`,
          [signal_id]
        );
        for (const ep of eps) {
          const owner = ep.设备负责人;
          if (owner && owner !== username && !ownersSeen.has(owner)) {
            ownersSeen.add(owner);
            items.push({ recipient_username: owner, item_type: 'completion' });
          }
        }
      }
      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体组');
      zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));

      if (items.length === 0) {
        const log: string[] = [];
        await cascadeDeletePin(db, pinId, req.user!.id, log);
        return res.json({ success: true });
      }

      // 获取删除影响信息存入审批请求
      const delImpact = await pinDeleteImpact(db, pinId);

      await submitChangeRequest(db, {
        projectId: devRow.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'delete_pin',
        entityType: 'pin',
        entityId: pinId,
        deviceId: parseInt(req.params.devId),
        oldPayload: pinToDelete,
        newPayload: { _deleteImpact: delImpact },
        items,
      });
      return res.status(202).json({ pending: true, message: '删除请求已提交审批' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除针孔失败' });
    }
  });

  // ── 编辑锁（复用 edit_locks 表）─────────────────────────

  router.get('/locks', authenticate, async (req, res) => {
    try {
      const { table_name } = req.query as { table_name: string };
      if (!table_name) return res.status(400).json({ error: '缺少 table_name' });
      await purgeExpiredLocks();
      const rows = await db.query(
        'SELECT row_id, locked_by, locked_by_name, locked_at, expires_at FROM edit_locks WHERE table_name = ?',
        [table_name]
      );
      const locks: Record<number, any> = {};
      for (const r of rows) {
        locks[r.row_id] = { lockedBy: r.locked_by_name, lockedAt: r.locked_at, expiresAt: r.expires_at };
      }
      res.json({ locks });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
