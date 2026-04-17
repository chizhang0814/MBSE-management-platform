import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import {
  isZontiRenyuan, isDeviceManager, isEwisAdmin, getProjectRoleMembers,
  submitChangeRequest, checkAndAdvancePhase, ApprovalItemSpec, SPECIAL_ERN_LIN, isPinFrozen,
  isDeviceFrozen, getFrozenDevicesForSignal,
} from '../shared/approval-helper.js';

// 支持协议标识的连接类型集合
const PROTOCOL_CONNECTION_TYPES = new Set([
  'ARINC 429', 'ARINC 453', 'CAN Bus', 'Discrete', 'HDMI',
  'RS-422', 'RS-422（全双工）', 'RS-485',
  '以太网（百兆）', '以太网（千兆）', '模拟量', '电源（低压）', '电源（高压）',
]);

export function signalRoutes(db: Database) {
  const router = express.Router();

  /** 替换信号端点并保留/重建 edges */
  async function replaceEndpointsWithEdges(signalId: number, projectId: number, endpoints: any[]) {
    // 保存旧 edges
    const oldEdges = await db.query(
      `SELECT e.direction, e.source_info,
              se_from.pin_id as from_pin_id, se_to.pin_id as to_pin_id
       FROM signal_edges e
       JOIN signal_endpoints se_from ON e.from_endpoint_id = se_from.id
       JOIN signal_endpoints se_to ON e.to_endpoint_id = se_to.id
       WHERE e.signal_id = ?`,
      [signalId]
    );

    await db.run('DELETE FROM signal_endpoints WHERE signal_id = ?', [signalId]);

    const newEpByPin: Record<number, number> = {};
    const newEpByIdx: Record<number, number> = {};
    for (let i = 0; i < endpoints.length; i++) {
      const ep = endpoints[i];
      if (!ep.设备编号) continue;
      const device = await db.get(
        `SELECT id FROM devices WHERE project_id = ? AND "设备编号" = ?`, [projectId, ep.设备编号]
      );
      if (!device) continue;
      let pinId: number | null = null;
      if (ep.设备端元器件编号 && ep.针孔号) {
        const pin = await db.get(
          `SELECT p.id FROM pins p JOIN connectors c ON p.connector_id = c.id WHERE c.device_id = ? AND c."设备端元器件编号" = ? AND p."针孔号" = ?`,
          [device.id, ep.设备端元器件编号, ep.针孔号]
        );
        if (pin) pinId = pin.id;
      }
      const epRes = await db.run(
        `INSERT INTO signal_endpoints (signal_id, device_id, pin_id, endpoint_index, "端接尺寸", "信号名称", "信号定义", input, output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [signalId, device.id, pinId, i, ep.端接尺寸 || null, ep.信号名称 || null, ep.信号定义 || null, ep.input ?? 0, ep.output ?? 0]
      );
      newEpByIdx[i] = epRes.lastID;
      if (pinId) newEpByPin[pinId] = epRes.lastID;

      // 更新针孔的端接尺寸和屏蔽类型
      if (pinId && (ep.端接尺寸 !== undefined || ep.屏蔽类型 !== undefined)) {
        const pinUpdates: string[] = [];
        const pinVals: any[] = [];
        if (ep.端接尺寸 !== undefined) { pinUpdates.push('"端接尺寸" = ?'); pinVals.push(ep.端接尺寸 || null); }
        if (ep.屏蔽类型 !== undefined) { pinUpdates.push('"屏蔽类型" = ?'); pinVals.push(ep.屏蔽类型 || null); }
        if (pinUpdates.length > 0) {
          await db.run(`UPDATE pins SET ${pinUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...pinVals, pinId]);
        }
      }
    }

    // 检查前端是否提供了手动 edge 信息
    const hasManualEdges = endpoints.some((ep: any, idx: number) => idx > 0 && ep._edgeDirection && ep._edgeDirection !== 'N/A');

    if (!hasManualEdges) {
      // 无手动 edge 信息 → 恢复旧 edges（pin_id 映射）
      for (const oe of oldEdges) {
        const newFromId = oe.from_pin_id ? newEpByPin[oe.from_pin_id] : null;
        const newToId = oe.to_pin_id ? newEpByPin[oe.to_pin_id] : null;
        if (newFromId && newToId) {
          await db.run(
            `INSERT INTO signal_edges (signal_id, from_endpoint_id, to_endpoint_id, direction, source_info) VALUES (?, ?, ?, ?, ?)`,
            [signalId, newFromId, newToId, oe.direction, oe.source_info]
          );
        }
      }
    }

    // 根据前端 _edgeDirection / _edgeTarget 创建新 edges
    for (let i = 1; i < endpoints.length; i++) {
      const ep = endpoints[i];
      const dir = ep._edgeDirection;
      if (!dir || dir === 'N/A') continue;
      const targetIdx = typeof ep._edgeTarget === 'number' ? ep._edgeTarget : 0;
      if (targetIdx < 0 || !(targetIdx in newEpByIdx) || !(i in newEpByIdx) || targetIdx === i) continue;
      if (dir === 'BI-DIR') {
        await db.run(
          `INSERT INTO signal_edges (signal_id, from_endpoint_id, to_endpoint_id, direction) VALUES (?, ?, ?, 'bidirectional')`,
          [signalId, newEpByIdx[targetIdx], newEpByIdx[i]]
        );
      } else if (dir === 'OUTPUT') {
        await db.run(
          `INSERT INTO signal_edges (signal_id, from_endpoint_id, to_endpoint_id, direction) VALUES (?, ?, ?, 'directed')`,
          [signalId, newEpByIdx[i], newEpByIdx[targetIdx]]
        );
      } else if (dir === 'INPUT') {
        await db.run(
          `INSERT INTO signal_edges (signal_id, from_endpoint_id, to_endpoint_id, direction) VALUES (?, ?, ?, 'directed')`,
          [signalId, newEpByIdx[targetIdx], newEpByIdx[i]]
        );
      }
    }

    return newEpByPin;
  }

  // ── 辅助：根据连接类型生成 unique_id ──────────────────────

  /**
   * 提取设备 ATA 前 2 位数字，异常时返回 '00'
   */
  function extractATA2(ata: string | null | undefined): string {
    if (!ata) return '00';
    const m = ata.match(/^(\d{2})/);
    return m ? m[1] : '00';
  }

  /**
   * 查项目内某个 ATA 前 2 位的最大 4 位序号
   * 扫描所有 unique_id 中出现的 N{ata2}{4位} 和 -{ata2}{4位} 模式
   */
  async function getMaxSeqForATA(db: Database, projectId: number, ata2: string): Promise<number> {
    const rows = await db.query(
      `SELECT unique_id FROM signals WHERE project_id = ? AND unique_id IS NOT NULL`,
      [projectId]
    );
    let max = 0;
    const pattern1 = new RegExp(`N${ata2}(\\d{4})`, 'g');  // N{ata2}{4位}
    const pattern2 = new RegExp(`-${ata2}(\\d{4})`, 'g');   // -{ata2}{4位}
    for (const r of rows) {
      const uid = r.unique_id || '';
      let m;
      while ((m = pattern1.exec(uid)) !== null) { const n = parseInt(m[1]); if (n > max) max = n; }
      pattern1.lastIndex = 0;
      while ((m = pattern2.exec(uid)) !== null) { const n = parseInt(m[1]); if (n > max) max = n; }
      pattern2.lastIndex = 0;
    }
    return max;
  }

  /**
   * 根据端点设备 ATA 自动生成信号 Unique ID
   * 格式: N{ATA_A前2位}{4位序号_A}-{ATA_B前2位}{4位序号_B}[-子编号]
   */
  async function generateSignalUniqueId(
    db: Database, projectId: number,
    resolvedEndpoints: Array<{ deviceId: number }>,
    suffix?: string  // 子编号如 '-1', '-2'
  ): Promise<string> {
    // 取前两个端点的设备 ATA
    let ata_a = '00', ata_b = '00';
    const epATAs: Array<{ ata: string; isERN: boolean }> = [];
    for (const ep of resolvedEndpoints.slice(0, 2)) {
      const dev = await db.get(
        `SELECT "设备部件所属系统（4位ATA）" as ata, "设备LIN号（DOORS）" as lin FROM devices WHERE id = ?`,
        [ep.deviceId]
      );
      epATAs.push({
        ata: extractATA2(dev?.ata),
        isERN: (dev?.lin || '') === SPECIAL_ERN_LIN,
      });
    }

    if (epATAs.length >= 2) {
      ata_a = epATAs[0].isERN ? epATAs[1].ata : epATAs[0].ata;
      ata_b = epATAs[1].isERN ? epATAs[0].ata : epATAs[1].ata;
    } else if (epATAs.length === 1) {
      ata_a = epATAs[0].isERN ? '00' : epATAs[0].ata;
      ata_b = ata_a;
    }

    const seqA = await getMaxSeqForATA(db, projectId, ata_a) + 1;
    let seqB: number;
    if (ata_b === ata_a) {
      // 同ATA章节或ERN取对端ATA导致两端相同时，B端序号需在A端基础上继续递增
      seqB = seqA + 1;
    } else {
      seqB = await getMaxSeqForATA(db, projectId, ata_b) + 1;
    }

    const uid = `N${ata_a}${String(seqA).padStart(4, '0')}-${ata_b}${String(seqB).padStart(4, '0')}`;
    return suffix ? uid + suffix : uid;
  }

  // ── 构建端点摘要 ──────────────────────────────────────────

  async function buildSignalSummaries(db: Database, signalId: number): Promise<{ endpoint_summary: string; 信号名称摘要: string }> {
    const endpoints = await db.query(
      `SELECT se.endpoint_index, se.信号名称, se.pin_id,
              p.针孔号, c.设备端元器件编号, d.设备编号
       FROM signal_endpoints se
       JOIN devices d ON se.device_id = d.id
       LEFT JOIN pins p ON se.pin_id = p.id
       LEFT JOIN connectors c ON p.connector_id = c.id
       WHERE se.signal_id = ?
       ORDER BY se.endpoint_index`,
      [signalId]
    );
    if (endpoints.length === 0) return { endpoint_summary: '', 信号名称摘要: '' };

    const addrParts: string[] = [];
    for (const e of endpoints) {
      if (!e.pin_id) {
        addrParts.push(`${e.设备编号}(?)`);
      } else {
        addrParts.push(`${e.设备端元器件编号 || e.设备编号}-${e.针孔号}`);
      }
    }

    const nameParts: string[] = [];
    for (const e of endpoints) {
      if (e.信号名称) nameParts.push(e.信号名称);
    }

    return {
      endpoint_summary: addrParts.join(' - '),
      信号名称摘要: nameParts.join(' - '),
    };
  }

  // ── 辅助：检查用户是否有项目操作权限 ─────────────────────

  async function canOperateSignals(db: Database, username: string, role: string, projectId: number): Promise<boolean> {
    if (role === 'admin') return true;
    return (
      await isDeviceManager(db, username, projectId) ||
      await isEwisAdmin(db, username, projectId)
    );
  }

  // ── 辅助：构建信号端点的审批项 ────────────────────────────

  /**
   * 构建信号审批项（V2 逻辑）
   * @param options.endpointsChanged - 是否有端点变更
   * @param options.newEndpointDeviceIds - 新增端点的设备ID列表（仅这些设备的负责人需要完善）
   * @param options.allEndpoints - 所有端点（用于判断已有端点是否已确认）
   */
  async function buildSignalApprovalItems(
    db: Database,
    projectId: number,
    operatorUsername: string,
    resolvedEndpoints: Array<{ deviceId: number; pinId: number | null }>,
    options?: { endpointsChanged?: boolean; newEndpointDeviceIds?: number[]; isNewSignal?: boolean }
  ): Promise<ApprovalItemSpec[]> {
    const items: ApprovalItemSpec[] = [];
    const { endpointsChanged = true, newEndpointDeviceIds, isNewSignal = false } = options || {};

    if (isNewSignal || (endpointsChanged && !newEndpointDeviceIds)) {
      // 新建信号或端点全量变更：所有其他设备负责人需要完善
      const ownersSeen = new Set<string>();
      for (const { deviceId } of resolvedEndpoints) {
        const ownerRow = await db.get('SELECT 设备负责人 FROM devices WHERE id = ?', [deviceId]);
        const owner = ownerRow?.设备负责人;
        if (!owner || owner === operatorUsername || ownersSeen.has(owner)) continue;
        ownersSeen.add(owner);
        items.push({ recipient_username: owner, item_type: 'completion' });
      }
    } else if (endpointsChanged && newEndpointDeviceIds && newEndpointDeviceIds.length > 0) {
      // 添加新端点：仅新端点的设备负责人需要完善
      const ownersSeen = new Set<string>();
      for (const devId of newEndpointDeviceIds) {
        const ownerRow = await db.get('SELECT 设备负责人 FROM devices WHERE id = ?', [devId]);
        const owner = ownerRow?.设备负责人;
        if (!owner || owner === operatorUsername || ownersSeen.has(owner)) continue;
        ownersSeen.add(owner);
        items.push({ recipient_username: owner, item_type: 'completion' });
      }
    }
    // else: 仅修改信号属性，不创建 completion 项，直接进入 approval

    // 阶段二 approval：总体组（一人通过即生效）
    const zontiList = await getProjectRoleMembers(db, projectId, '总体组');
    zontiList.filter(u => u !== operatorUsername).forEach(u =>
      items.push({ recipient_username: u, item_type: 'approval' })
    );

    return items;
  }

  // ── 获取信号列表 ──────────────────────────────────────────

  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.query.projectId as string);
      if (isNaN(projectId)) return res.status(400).json({ error: '缺少 projectId' });

      const myDevices = req.query.myDevices === 'true';
      const limitParam = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const offsetParam = req.query.offset ? parseInt(req.query.offset as string) : 0;
      const username = req.user!.username;
      const userRole = req.user!.role;

      let hasProjectPermission = false;
      if (userRole === 'user') {
        const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
        const perms: Array<{ project_name: string }> = userRow?.permissions ? JSON.parse(userRow.permissions) : [];
        const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
        hasProjectPermission = perms.some((p: any) => p.project_name === projectRow?.name);
      }

      // 草稿可见性：admin和有项目权限的用户可看所有Draft，无权限用户只看自己的Draft
      const canSeeAllDrafts = userRole === 'admin' || hasProjectPermission;
      const draftClause = canSeeAllDrafts ? '' : `AND (s.status != 'Draft' OR s.created_by = ?)`;

      let sql: string;
      const params: any[] = [projectId];

      if (myDevices || (userRole === 'user' && !hasProjectPermission)) {
        sql = `
          SELECT DISTINCT s.*
          FROM signals s
          WHERE s.project_id = ?
            ${draftClause}
            AND EXISTS (
              SELECT 1 FROM signal_endpoints se
              JOIN devices d ON se.device_id = d.id
              WHERE se.signal_id = s.id AND d.设备负责人 = ?
            )
        `;
        if (!canSeeAllDrafts) params.push(username);
        params.push(username);
      } else {
        sql = `SELECT s.* FROM signals s WHERE s.project_id = ? ${draftClause}`;
        if (!canSeeAllDrafts) params.push(username);
      }
      // 后端分组筛选
      const signalGroupFilter = req.query.signalGroup as string;
      if (signalGroupFilter) {
        if (signalGroupFilter === '_grouped') {
          sql += ' AND s.signal_group IS NOT NULL AND s.signal_group != \'\'';
        } else if (signalGroupFilter === '_ungrouped') {
          sql += ' AND (s.signal_group IS NULL OR s.signal_group = \'\')';
        } else {
          sql += ' AND s.signal_group LIKE ?';
          params.push(signalGroupFilter + '%');
        }
      }
      // 绞线筛选：包含未分配绞线组的绞线信号的整个分组
      const twistFilter = req.query.twistFilter as string;
      if (twistFilter === 'unassigned') {
        sql += ` AND s.signal_group IN (
          SELECT DISTINCT signal_group FROM signals
          WHERE project_id = ? AND signal_group IS NOT NULL AND signal_group != ''
            AND "推荐导线线型" LIKE '%绞%' AND (twist_group IS NULL OR twist_group = '')
        )`;
        params.push(projectId);
      }

      const sortBy = req.query.sortBy as string;
      const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
      if (sortBy === 'updated_at') {
        sql += ` ORDER BY s.updated_at ${sortOrder}, s.id`;
      } else {
        sql += ' ORDER BY s.unique_id, s.id';
      }

      // 获取总数
      const countSql = `SELECT COUNT(*) as total FROM (${sql}) t`;
      const countRow = await db.get(countSql, params);
      const total = countRow?.total ?? 0;

      // 分页
      if (limitParam !== undefined) {
        sql += ` LIMIT ? OFFSET ?`;
        params.push(limitParam, offsetParam);
      }

      const signals = await db.query(sql, params);

      // 获取当前用户在 Pending 信号上的 pending_item_type
      const pendingSignalIds = signals.filter((s: any) => s.status === 'Pending').map((s: any) => s.id);
      const pendingItemMap: Record<number, string | null> = {};
      const pendingReqMap: Record<number, number> = {};
      if (pendingSignalIds.length > 0) {
        const ph = pendingSignalIds.map(() => '?').join(',');
        const pendingItems = await db.query(
          `SELECT ar.entity_id, ai.item_type, ar.id as approval_request_id
           FROM approval_requests ar
           JOIN approval_items ai ON ai.approval_request_id = ar.id
           WHERE ar.entity_type = 'signal'
             AND ar.status = 'pending'
             AND ar.entity_id IN (${ph})
             AND ai.recipient_username = ?
             AND ai.status = 'pending'
             AND ar.current_phase = ai.item_type`,
          [...pendingSignalIds, username]
        );
        for (const pi of pendingItems) { pendingItemMap[pi.entity_id] = pi.item_type; pendingReqMap[pi.entity_id] = pi.approval_request_id; }
        for (const id of pendingSignalIds) {
          if (pendingItemMap[id] === undefined) pendingItemMap[id] = null;
        }
      }

      // ── 批量查询端点摘要（一次 SQL 覆盖所有信号）──────────
      const signalIds = signals.map((s: any) => s.id);
      const summaryMap: Record<number, { endpoint_summary: string; 信号名称摘要: string; endpoint_count: number; 导线等级: string | null }> = {};
      if (signalIds.length > 0) {
        const ph = signalIds.map(() => '?').join(',');
        const allEndpoints = await db.query(
          `SELECT se.signal_id, se.endpoint_index, se.信号名称, se.pin_id,
                  p.针孔号, c.设备端元器件编号, d.设备编号, d.设备等级
           FROM signal_endpoints se
           JOIN devices d ON se.device_id = d.id
           LEFT JOIN pins p ON se.pin_id = p.id
           LEFT JOIN connectors c ON p.connector_id = c.id
           WHERE se.signal_id IN (${ph})
           ORDER BY se.signal_id, se.endpoint_index`,
          signalIds
        );
        const grouped: Record<number, any[]> = {};
        for (const e of allEndpoints) {
          if (!grouped[e.signal_id]) grouped[e.signal_id] = [];
          grouped[e.signal_id].push(e);
        }
        for (const id of signalIds) {
          const eps = grouped[id] || [];
          const addrParts = eps.map((e: any) =>
            e.pin_id ? `${e.设备端元器件编号 || e.设备编号}-${e.针孔号}` : `${e.设备编号}(?)`
          );
          const nameParts = eps.filter((e: any) => e.信号名称).map((e: any) => e.信号名称);

          // 导线等级：从端点所属设备的设备等级计算
          let 导线等级: string | null = null;
          const levels = eps.map((e: any) => e.设备等级).filter((v: any) => v);
          if (levels.length > 0) {
            const nums = levels.map((v: string) => parseInt(v));
            if (nums.every((n: number) => !isNaN(n))) {
              // 2个端点取最大值（最不重要），>2个端点取最小值（最重要）
              导线等级 = String(eps.length <= 2 ? Math.max(...nums) : Math.min(...nums)) + '级';
            }
          }

          summaryMap[id] = { endpoint_summary: addrParts.join(' - '), 信号名称摘要: nameParts.join(' - '), endpoint_count: eps.length, 导线等级 };
        }
      }

      // ── can_edit：项目级权限只查一次，再批量查端点归属 ────
      let projectLevelEdit = userRole === 'admin' || await canOperateSignals(db, username, userRole, projectId);
      const ownSignalIds = new Set<number>();
      if (!projectLevelEdit && signalIds.length > 0) {
        const ph = signalIds.map(() => '?').join(',');
        const ownRows = await db.query(
          `SELECT DISTINCT se.signal_id
           FROM signal_endpoints se
           JOIN devices d ON se.device_id = d.id
           WHERE se.signal_id IN (${ph}) AND d.设备负责人 = ?`,
          [...signalIds, username]
        );
        for (const r of ownRows) ownSignalIds.add(r.signal_id);
      }

      // ── 组装结果 ──────────────────────────────────────────
      const result = signals.map((s: any) => {
        const can_edit = projectLevelEdit || ownSignalIds.has(s.id);
        const pending_item_type = s.status === 'Pending' ? (pendingItemMap[s.id] ?? null) : null;
        const approval_request_id = s.status === 'Pending' ? (pendingReqMap[s.id] ?? null) : null;
        return { ...s, ...(summaryMap[s.id] ?? { endpoint_summary: '', 信号名称摘要: '' }), can_edit, pending_item_type, approval_request_id };
      });

      res.json({ signals: result, total, offset: offsetParam });
    } catch (error: any) {
      console.error('获取信号列表失败:', error);
      res.status(500).json({ error: error.message || '获取信号列表失败' });
    }
  });

  // ── GET /api/signals/groups — 获取项目所有信号组（必须在 /:id 之前）──
  router.get('/groups', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.query.project_id as string);
      if (isNaN(projectId)) return res.status(400).json({ error: '缺少 project_id' });

      const groups = await db.query(
        `SELECT signal_group, GROUP_CONCAT(id) as signal_ids, GROUP_CONCAT(unique_id) as unique_ids,
                GROUP_CONCAT("协议标识") as protocols, MIN("连接类型") as conn_type
         FROM signals WHERE project_id = ? AND signal_group IS NOT NULL
         GROUP BY signal_group ORDER BY signal_group`,
        [projectId]
      );

      res.json({
        groups: groups.map((g: any) => ({
          name: g.signal_group,
          conn_type: g.conn_type,
          signal_ids: g.signal_ids ? g.signal_ids.split(',').map(Number) : [],
          unique_ids: g.unique_ids ? g.unique_ids.split(',') : [],
          protocols: g.protocols ? g.protocols.split(',') : [],
        })),
        group_defs: SIGNAL_GROUP_DEFS,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取信号组失败' });
    }
  });

  // ── 获取单个信号（含完整端点信息）────────────────────────

  router.get('/:id', authenticate, async (req, res) => {
    try {
      const signal = await db.get('SELECT * FROM signals WHERE id = ?', [req.params.id]);
      if (!signal) return res.status(404).json({ error: '信号不存在' });

      const endpoints = await db.query(
        `SELECT se.*,
                p.针孔号, p.端接尺寸 as pin_端接尺寸, p.屏蔽类型 as pin_屏蔽类型,
                c.id as connector_id, c.设备端元器件编号,
                d.id as device_id, d.设备编号, d.设备中文名称, d.设备负责人, d.设备等级
         FROM signal_endpoints se
         JOIN devices d ON se.device_id = d.id
         LEFT JOIN pins p ON se.pin_id = p.id
         LEFT JOIN connectors c ON p.connector_id = c.id
         WHERE se.signal_id = ?
         ORDER BY se.endpoint_index`,
        [signal.id]
      );

      // 导线等级：从端点所属设备的设备等级计算
      let 导线等级: string | null = null;
      const levels = endpoints.map((e: any) => e.设备等级).filter((v: any) => v);
      if (levels.length > 0) {
        const nums = levels.map((v: string) => parseInt(v));
        if (nums.every((n: number) => !isNaN(n))) {
          导线等级 = String(endpoints.length <= 2 ? Math.max(...nums) : Math.min(...nums)) + '级';
        }
      }

      // 查询 edges
      const edges = await db.query(
        `SELECT * FROM signal_edges WHERE signal_id = ?`,
        [signal.id]
      );

      res.json({ signal: { ...signal, endpoints, edges, 导线等级 } });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取信号失败' });
    }
  });

  // ── 创建信号（含端点，事务）──────────────────────────────

  router.post('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const { project_id, endpoints, draft: isDraft, ...signalFields } = req.body;
      delete signalFields['导线等级']; delete signalFields.edges; delete signalFields.signal_group;
      delete signalFields.can_edit; delete signalFields.pending_item_type; delete signalFields.approval_request_id;
      delete signalFields.endpoint_summary; delete signalFields['信号名称摘要']; delete signalFields.endpoint_count;
      delete signalFields.import_status; delete signalFields.import_conflicts;
      // 非协议连接类型时清空协议标识
      if (!PROTOCOL_CONNECTION_TYPES.has(signalFields['连接类型'])) {
        signalFields['协议标识'] = null;
      }
      if (!project_id) return res.status(400).json({ error: '缺少 project_id' });

      const username = req.user!.username;
      const role = req.user!.role;

      if (!await canOperateSignals(db, username, role, project_id)) {
        return res.status(403).json({ error: '无权限，需要系统组、总体组或EWIS管理员角色' });
      }

      signalFields.created_by = username;

      // 系统组：至少一个端点属于当前用户负责的设备
      const isDevMgr = role !== 'admin' && await isDeviceManager(db, username, project_id);
      if (isDevMgr && Array.isArray(endpoints) && endpoints.length > 0) {
        const hasOwnEndpoint = await Promise.any(
          endpoints.map(async (ep: any) => {
            const row = await db.get(
              `SELECT d.id FROM devices d WHERE d.project_id = ? AND d.设备编号 = ? AND d.设备负责人 = ?`,
              [project_id, ep.设备编号, username]
            );
            if (!row) throw new Error('not owner');
            return true;
          })
        ).catch(() => false);
        if (!hasOwnEndpoint) {
          return res.status(403).json({ error: '创建信号失败：至少需要有一个端点属于您负责的设备' });
        }
      }

      // ── 预解析所有端点的 device_id / pin_id ──────────────
      type ResolvedEp = { ep: any; deviceId: number; pinId: number | null };
      const resolved: ResolvedEp[] = [];
      const endpointErrors: string[] = [];

      if (Array.isArray(endpoints)) {
        for (let i = 0; i < endpoints.length; i++) {
          const ep = endpoints[i];
          if (!ep.设备编号) {
            endpointErrors.push(`端点${i + 1}: 必须选择设备`);
            continue;
          }
          const device = await db.get(
            `SELECT id, "设备负责人" FROM devices WHERE project_id = ? AND "设备编号" = ?`,
            [project_id, ep.设备编号]
          );
          if (!device) {
            endpointErrors.push(`端点${i + 1}: 找不到设备 "${ep.设备编号}"`);
            continue;
          }

          const isOwnDevice = device.设备负责人 === username;

          let pinId: number | null = null;
          if (ep.设备端元器件编号 && ep.针孔号) {
            const pin = await db.get(
              `SELECT p.id FROM pins p
               JOIN connectors c ON p.connector_id = c.id
               WHERE c.device_id = ? AND c."设备端元器件编号" = ? AND p."针孔号" = ?`,
              [device.id, ep.设备端元器件编号, ep.针孔号]
            );
            if (!pin) {
              endpointErrors.push(`端点${i + 1}: 设备"${ep.设备编号}"下找不到 ${ep.设备端元器件编号}.${ep.针孔号}`);
              continue;
            }
            pinId = pin.id;
          } else if (isOwnDevice && isDevMgr) {
            endpointErrors.push(`端点${i + 1}: 设备"${ep.设备编号}"是您负责的设备，设备端元器件编号和针孔号必须填写`);
            continue;
          }

          if (isOwnDevice && isDevMgr && (!ep.信号名称 || !ep.信号定义)) {
            endpointErrors.push(`端点${i + 1}: 设备"${ep.设备编号}"是您负责的设备，信号名称和信号定义必须填写`);
            continue;
          }

          resolved.push({ ep, deviceId: device.id, pinId });
        }
      }

      const newPinIds = resolved.filter(r => r.pinId !== null).map(r => r.pinId!);

      // ── 检查端点设备是否已冻结 ─────────────────────
      for (const { deviceId } of resolved) {
        if (await isDeviceFrozen(db, deviceId)) {
          const d = await db.get('SELECT "设备编号" FROM devices WHERE id = ?', [deviceId]);
          return res.status(403).json({ error: `设备「${d?.['设备编号']}」已冻结，不可创建包含该设备的信号` });
        }
      }

      // ── 检查是否有端点被冻结（待删除审批中）─────────
      for (const { pinId } of resolved) {
        if (pinId) {
          const frozenMsg = await isPinFrozen(db, pinId);
          if (frozenMsg) return res.status(403).json({ error: frozenMsg });
        }
      }

      // ── 检测新信号是否包含ERN端点 → 跳过组网 ─────────
      const newDeviceIds = [...new Set(resolved.map(r => r.deviceId))];
      let newHasERN = false;
      if (newDeviceIds.length > 0) {
        const dph = newDeviceIds.map(() => '?').join(',');
        const ernDev = await db.get(
          `SELECT id FROM devices WHERE id IN (${dph}) AND "设备LIN号（DOORS）" = ?`,
          [...newDeviceIds, SPECIAL_ERN_LIN]
        );
        newHasERN = !!ernDev;
      }

      // ── 端点重叠检测（仅对有 pin_id 的完整端点）────────
      // 包含ERN端点的信号不参与组网
      if (newPinIds.length > 0 && !newHasERN) {
        const ph = newPinIds.map(() => '?').join(',');
        const overlapping: Array<{ signal_id: number; overlap_count: number }> = await db.query(
          `SELECT se.signal_id, COUNT(*) as overlap_count
           FROM signal_endpoints se
           JOIN signals s ON se.signal_id = s.id
           WHERE s.project_id = ? AND se.pin_id IN (${ph})
           -- 排除包含ERN端点的已有信号
           AND NOT EXISTS (
             SELECT 1 FROM signal_endpoints se2
             JOIN devices d2 ON se2.device_id = d2.id
             WHERE se2.signal_id = se.signal_id AND d2."设备LIN号（DOORS）" = '${SPECIAL_ERN_LIN}'
           )
           GROUP BY se.signal_id
           ORDER BY overlap_count DESC`,
          [project_id, ...newPinIds]
        );

        if (overlapping.length > 0) {
          const top = overlapping[0];

          if (top.overlap_count >= newPinIds.length) {
            const existing = await db.get('SELECT unique_id FROM signals WHERE id = ?', [top.signal_id]);
            return res.status(409).json({
              error: `所有端点均已存在于信号 "${existing?.unique_id || top.signal_id}" 中，不允许重复创建`,
            });
          }

          const targetSignalRow = await db.get('SELECT unique_id, "连接类型" FROM signals WHERE id = ?', [top.signal_id]);
          if (targetSignalRow?.['连接类型'] !== signalFields['连接类型']) {
            return res.status(409).json({
              error: `端点与信号 "${targetSignalRow?.unique_id || top.signal_id}" 重叠，但连接类型不同（现有：${targetSignalRow?.['连接类型'] || '未设置'}，新建：${signalFields['连接类型'] || '未设置'}），无法合并`,
            });
          }

          const existingPins: Array<{ pin_id: number }> = await db.query(
            'SELECT pin_id FROM signal_endpoints WHERE signal_id = ?',
            [top.signal_id]
          );
          const existingPinSet = new Set(existingPins.map(p => p.pin_id));
          const maxIdxRow = await db.get(
            'SELECT MAX(endpoint_index) as m FROM signal_endpoints WHERE signal_id = ?',
            [top.signal_id]
          );
          let nextIdx: number = (maxIdxRow?.m ?? -1) + 1;

          const mergedNewEpIds: number[] = [];
          for (const { ep, deviceId, pinId } of resolved) {
            if ((pinId && !existingPinSet.has(pinId)) || !pinId) {
              const epRes = await db.run(
                `INSERT INTO signal_endpoints (signal_id, device_id, pin_id, endpoint_index, 信号名称, 信号定义)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [top.signal_id, deviceId, pinId, nextIdx++, ep.信号名称 || null, ep.信号定义 || null]
              );
              mergedNewEpIds.push(epRes.lastID);
            }
          }

          // 为合并的新端点创建 edges（新端点之间互相连接）
          if (mergedNewEpIds.length >= 2) {
            for (let mi = 1; mi < mergedNewEpIds.length; mi++) {
              await db.run(
                `INSERT INTO signal_edges (signal_id, from_endpoint_id, to_endpoint_id, direction) VALUES (?, ?, ?, 'directed')`,
                [top.signal_id, mergedNewEpIds[0], mergedNewEpIds[mi]]
              );
            }
          }

          // 向合并端点中涉及的其他设备负责人发通知
          const mergeOtherOwners: Array<{ 设备负责人: string; 设备编号: string }> = await db.query(
            `SELECT DISTINCT d.设备负责人, d.设备编号
             FROM signal_endpoints se
             JOIN devices d ON se.device_id = d.id
             WHERE se.signal_id = ? AND d.设备负责人 IS NOT NULL AND d.设备负责人 != ?`,
            [top.signal_id, username]
          );
          if (mergeOtherOwners.length > 0) {
            const ownerDevices: Record<string, string[]> = {};
            for (const row of mergeOtherOwners) {
              if (!ownerDevices[row.设备负责人]) ownerDevices[row.设备负责人] = [];
              ownerDevices[row.设备负责人].push(row.设备编号);
            }
            for (const [owner, devs] of Object.entries(ownerDevices)) {
              await db.run(
                `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'signal_endpoint_added', ?, ?)`,
                [
                  owner,
                  `信号端点更新：${targetSignalRow?.unique_id}`,
                  `用户 ${username} 向信号 "${targetSignalRow?.unique_id}" 添加了新端点，包含您负责的设备（${devs.join('、')}）的端点信息。`,
                ]
              );
            }
          }

          return res.json({
            success: true,
            merged: true,
            mergedIntoId: top.signal_id,
            mergedIntoUniqueId: targetSignalRow?.unique_id,
          });
        }
      }

      // ── 无重叠，正常新建 ────────────────────────────────
      // 非 admin 自动生成 Unique ID（保存时生成，防并发）
      if (role !== 'admin' || !signalFields.unique_id?.trim()) {
        signalFields.unique_id = await generateSignalUniqueId(
          db, project_id,
          resolved.map(r => ({ deviceId: r.deviceId }))
        );
      }
      const dupSignal = await db.get(
        'SELECT id FROM signals WHERE project_id = ? AND unique_id = ?',
        [project_id, signalFields.unique_id]
      );
      if (dupSignal) {
        return res.status(409).json({ error: `Unique ID "${signalFields.unique_id}" 在本项目中已存在` });
      }

      const insertStatus = isDraft ? 'Draft' : 'Pending';
      const cols = Object.keys(signalFields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(signalFields).map(() => '?').join(', ');
      const sigResult = await db.run(
        `INSERT INTO signals (project_id, status, ${cols}) VALUES (?, ?, ${placeholders})`,
        [project_id, insertStatus, ...Object.values(signalFields)]
      );
      const signalId = sigResult.lastID;

      const insertedEpIds: number[] = [];
      for (let i = 0; i < resolved.length; i++) {
        const { ep, deviceId, pinId } = resolved[i];
        const epResult = await db.run(
          `INSERT INTO signal_endpoints (signal_id, device_id, pin_id, endpoint_index, 信号名称, 信号定义, input, output)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [signalId, deviceId, pinId, i, ep.信号名称 || null, ep.信号定义 || null, ep.input ?? 0, ep.output ?? 0]
        );
        insertedEpIds.push(epResult.lastID);
      }

      // 创建 edges：根据前端 _edgeDirection / _edgeTarget 字段
      for (let i = 1; i < resolved.length; i++) {
        const ep = resolved[i].ep;
        const dir = ep._edgeDirection || 'N/A';
        if (dir === 'N/A') continue;
        const targetIdx = typeof ep._edgeTarget === 'number' ? ep._edgeTarget : 0;
        if (targetIdx < 0 || targetIdx >= insertedEpIds.length || targetIdx === i) continue;
        if (dir === 'BI-DIR') {
          await db.run(
            `INSERT INTO signal_edges (signal_id, from_endpoint_id, to_endpoint_id, direction) VALUES (?, ?, ?, 'bidirectional')`,
            [signalId, insertedEpIds[targetIdx], insertedEpIds[i]]
          );
        } else if (dir === 'OUTPUT') {
          // 当前端点 → 目标端点
          await db.run(
            `INSERT INTO signal_edges (signal_id, from_endpoint_id, to_endpoint_id, direction) VALUES (?, ?, ?, 'directed')`,
            [signalId, insertedEpIds[i], insertedEpIds[targetIdx]]
          );
        } else if (dir === 'INPUT') {
          // 目标端点 → 当前端点
          await db.run(
            `INSERT INTO signal_edges (signal_id, from_endpoint_id, to_endpoint_id, direction) VALUES (?, ?, ?, 'directed')`,
            [signalId, insertedEpIds[targetIdx], insertedEpIds[i]]
          );
        }
      }

      // admin → 直接写入 Active（非草稿）
      if (role === 'admin' && !isDraft) {
        await db.run('UPDATE signals SET status = ? WHERE id = ?', ['Active', signalId]);
      }

      // 非管理员且非草稿 → 提交审批
      if (role !== 'admin' && !isDraft) {
        const items = await buildSignalApprovalItems(db, project_id, username, resolved.map(r => ({ deviceId: r.deviceId, pinId: r.pinId })), { isNewSignal: true });
        await submitChangeRequest(db, {
          projectId: project_id,
          requesterId: req.user!.id,
          requesterUsername: username,
          actionType: 'create_signal',
          entityType: 'signal',
          entityId: signalId,
          oldPayload: {},
          newPayload: {
            ...signalFields,
            endpoints: resolved.map(({ ep }) => ({
              设备编号: ep.设备编号, 设备端元器件编号: ep.设备端元器件编号, 针孔号: ep.针孔号,
            })),
          },
          items,
        });
      }

      // 写修改日志
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES ('signals', ?, ?, 'signals', ?, ?, '新建信号', 'approved')`,
        [
          signalId, signalId, req.user!.id,
          JSON.stringify({
            ...signalFields,
            endpoints: resolved.map(({ ep }) => ({
              设备编号: ep.设备编号, 设备端元器件编号: ep.设备端元器件编号, 针孔号: ep.针孔号, 信号名称: ep.信号名称 || null,
            })),
          }),
        ]
      );

      res.json({ success: true, id: signalId, unique_id: signalFields.unique_id, endpointErrors });
    } catch (error: any) {
      console.error('创建信号失败:', error);
      res.status(500).json({ error: error.message || '创建信号失败' });
    }
  });

  // ── PUT /api/signals/twist-group — 设置绞线组（必须在 /:id 之前注册）
  router.put('/twist-group', authenticate, async (req: AuthRequest, res) => {
    try {
      const { signal_ids, twist_group, project_id } = req.body;
      if (!Array.isArray(signal_ids) || !project_id) {
        return res.status(400).json({ error: '缺少 signal_ids 或 project_id' });
      }
      const ph = signal_ids.map(() => '?').join(',');
      const sigs = await db.query(
        'SELECT id, signal_group, "推荐导线线型" FROM signals WHERE id IN (' + ph + ') AND project_id = ?',
        [...signal_ids, project_id]
      );
      if (sigs.length !== signal_ids.length) {
        return res.status(400).json({ error: '部分信号不存在' });
      }
      const groups = [...new Set(sigs.map((s: any) => s.signal_group))];
      if (groups.length !== 1 || !groups[0]) {
        return res.status(400).json({ error: '所有信号必须属于同一个信号分组' });
      }
      if (twist_group) {
        const wireTypes = sigs.map((s: any) => s['推荐导线线型'] || '');
        const allTwisted = wireTypes.every((t: string) => /绞/.test(t));
        if (!allTwisted) {
          return res.status(400).json({ error: '绞线组内所有信号的推荐导线线型必须包含"绞"' });
        }
        // 校验：加上已有成员后不超限
        const isDouble = wireTypes.every((t: string) => /双绞/.test(t));
        const isTriple = wireTypes.every((t: string) => /三绞/.test(t));
        const maxSize = isDouble ? 2 : isTriple ? 3 : 0;
        if (maxSize > 0) {
          const existing = await db.get(
            'SELECT COUNT(*) as cnt FROM signals WHERE signal_group = ? AND project_id = ? AND twist_group = ? AND id NOT IN (' + ph + ')',
            [groups[0], project_id, twist_group, ...signal_ids]
          );
          const totalAfter = (existing?.cnt || 0) + signal_ids.length;
          if (totalAfter > maxSize) {
            return res.status(400).json({ error: (isDouble ? '双绞' : '三绞') + '线组最多' + maxSize + '条信号，当前已有' + existing.cnt + '条' });
          }
        }
      }
      await db.run(
        'UPDATE signals SET twist_group = ? WHERE id IN (' + ph + ') AND project_id = ?',
        [twist_group || null, ...signal_ids, project_id]
      );
      res.json({ success: true, updated: signal_ids.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '设置绞线组失败' });
    }
  });

  // ── 更新信号（可含 endpoints 数组替换端点）───────────────

  router.put('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const signalId = parseInt(req.params.id);
      const signal = await db.get('SELECT * FROM signals WHERE id = ?', [signalId]);
      if (!signal) return res.status(404).json({ error: '信号不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      if (!await canOperateSignals(db, username, role, signal.project_id)) {
        return res.status(403).json({ error: '无权限修改信号' });
      }

      const { endpoints, version, submit: shouldSubmit, forceDraft, draft: _draft, ...fields } = req.body;
      delete fields.id; delete fields.project_id; delete fields.created_at; delete fields.status;
      delete fields.pending_item_type; delete fields['导线等级']; delete fields.edges; delete fields.signal_group; delete fields.approval_request_id;
      delete fields.endpoint_summary; delete fields['信号名称摘要']; delete fields.can_edit; delete fields.endpoint_count;
      // 非 admin 不允许修改 unique_id
      if (role !== 'admin') delete fields.unique_id;
      if (!PROTOCOL_CONNECTION_TYPES.has(fields['连接类型'])) {
        fields['协议标识'] = null;
      }

      // Unique ID 唯一性检查（排除当前记录）
      if (fields.unique_id) {
        const dup = await db.get(
          'SELECT id FROM signals WHERE project_id = ? AND unique_id = ? AND id != ?',
          [signal.project_id, fields.unique_id, signalId]
        );
        if (dup) {
          return res.status(400).json({ error: `Unique ID "${fields.unique_id}" 已被其他信号使用` });
        }
      }

      // ── 冻结检查（信号编辑）─────────────────────────────────
      const frozenDevs = await getFrozenDevicesForSignal(db, signalId);
      if (frozenDevs.length > 0 && Array.isArray(endpoints)) {
        // 信号关联冻结设备：检查端点变更是否涉及冻结侧
        const oldEndpoints = await db.query(
          `SELECT se.*, d.id as dev_id, d.status as dev_status, d."设备编号" as dev_num
           FROM signal_endpoints se JOIN devices d ON se.device_id = d.id
           WHERE se.signal_id = ? ORDER BY se.endpoint_index`, [signalId]
        );
        const frozenOldEps = oldEndpoints.filter((e: any) => e.dev_status === 'Frozen');

        // 不允许删除任何端点（保护拓扑完整）
        const oldDevPinKeys = new Set(oldEndpoints.map((e: any) => `${e.dev_id}:${e.pin_id}`));
        const newDevPinKeys = new Set<string>();
        for (const ep of endpoints) {
          if (ep.device_id && ep.pin_id) newDevPinKeys.add(`${ep.device_id}:${ep.pin_id}`);
          // 也可能用 设备编号+针孔号 定位
          if (ep['设备编号'] && ep['针孔号']) {
            const d = await db.get('SELECT id FROM devices WHERE project_id = ? AND "设备编号" = ?', [signal.project_id, ep['设备编号']]);
            const p = await db.get('SELECT p.id FROM pins p JOIN connectors c ON p.connector_id = c.id WHERE c.device_id = ? AND c."设备端元器件编号" = ? AND p."针孔号" = ?',
              [d?.id, ep['设备端元器件编号'], ep['针孔号']]);
            if (d && p) newDevPinKeys.add(`${d.id}:${p.id}`);
          }
        }
        for (const oldEp of frozenOldEps) {
          const key = `${oldEp.dev_id}:${oldEp.pin_id}`;
          if (!newDevPinKeys.has(key)) {
            return res.status(403).json({ error: `不可删除冻结设备「${oldEp.dev_num}」的端点` });
          }
        }

        // 冻结设备的端点字段不允许修改
        for (const ep of endpoints) {
          const devId = ep.device_id || (await db.get('SELECT id FROM devices WHERE project_id = ? AND "设备编号" = ?', [signal.project_id, ep['设备编号']]))?.id;
          if (devId && await isDeviceFrozen(db, devId)) {
            const oldEp = frozenOldEps.find((e: any) => e.dev_id === devId);
            if (oldEp) {
              if ((ep['信号名称'] !== undefined && ep['信号名称'] !== oldEp['信号名称']) ||
                  (ep['信号定义'] !== undefined && ep['信号定义'] !== oldEp['信号定义']) ||
                  (ep.pin_id !== undefined && ep.pin_id !== oldEp.pin_id)) {
                const d = await db.get('SELECT "设备编号" FROM devices WHERE id = ?', [devId]);
                return res.status(403).json({ error: `冻结设备「${d?.['设备编号']}」侧的端点不可修改` });
              }
            }
          }
        }
      }

      // 仅 admin 直接更新不走审批
      const isPrivilegedRole = role === 'admin';

      if (isPrivilegedRole) {
        if (Object.keys(fields).length > 0) {
          const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
          const result = await db.run(
            `UPDATE signals SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
            [...Object.values(fields), signalId, version ?? 1]
          );
          if (result.changes === 0) {
            return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
          }
        }

        if (Array.isArray(endpoints)) {
          await replaceEndpointsWithEdges(signalId, signal.project_id, endpoints);
          const endpointErrors: string[] = [];

          if (forceDraft) {
            await db.run('UPDATE signals SET status = ? WHERE id = ?', ['Draft', signalId]);
          } else {
            const allComplete = (await db.get('SELECT COUNT(*) as cnt FROM signal_endpoints WHERE signal_id = ? AND pin_id IS NULL', [signalId]))?.cnt === 0;
            await db.run('UPDATE signals SET status = ? WHERE id = ?', [allComplete ? 'Active' : 'Active', signalId]);
          }

          await db.run(
            `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
             VALUES ('signals', ?, ?, 'signals', ?, ?, ?, '修改信号', 'approved')`,
            [signalId, signalId, req.user!.id, JSON.stringify(signal), JSON.stringify({ ...fields, endpoints })]
          );
          return res.json({ success: true, endpointErrors });
        }

        if (forceDraft) {
          await db.run('UPDATE signals SET status = ? WHERE id = ?', ['Draft', signalId]);
        }
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('signals', ?, ?, 'signals', ?, ?, ?, '修改信号', 'approved')`,
          [signalId, signalId, req.user!.id, JSON.stringify(signal), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // forceDraft → 直接更新，设为 Draft
      if (forceDraft) {
        if (Object.keys(fields).length > 0) {
          const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
          await db.run(
            `UPDATE signals SET ${setClauses}, status = 'Draft', import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [...Object.values(fields), signalId]
          );
        } else {
          await db.run(`UPDATE signals SET status = 'Draft', import_status = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [signalId]);
        }

        if (Array.isArray(endpoints)) {
          await replaceEndpointsWithEdges(signalId, signal.project_id, endpoints);
        }
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('signals', ?, ?, 'signals', ?, ?, ?, '修改信号(Draft)', 'approved')`,
          [signalId, signalId, req.user!.id, JSON.stringify(signal), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // 若信号已 Pending 且当前用户有待完善项 → 执行完善
      if (signal.status === 'Pending') {
        const pendingCompletion = await db.get(
          `SELECT ai.id, ai.approval_request_id
           FROM approval_items ai
           JOIN approval_requests ar ON ai.approval_request_id = ar.id
           WHERE ar.entity_type = 'signal' AND ar.entity_id = ? AND ar.status = 'pending'
             AND ai.recipient_username = ? AND ai.item_type = 'completion' AND ai.status = 'pending'`,
          [signalId, username]
        );
        if (pendingCompletion) {
          // 应用端点变更
          if (Array.isArray(endpoints)) {
            await replaceEndpointsWithEdges(signalId, signal.project_id, endpoints);
          }
          if (Object.keys(fields).length > 0) {
            const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
            await db.run(
              `UPDATE signals SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [...Object.values(fields), signalId]
            );
          }
          // 标记完善项为 done
          await db.run(
            `UPDATE approval_items SET status = 'done', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [pendingCompletion.id]
          );
          await db.run(
            `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
             VALUES ('signals', ?, ?, 'signals', ?, ?, ?, 'approved')`,
            [signalId, signalId, req.user!.id, JSON.stringify(fields), `${username} 完善信号端点`]
          );
          await checkAndAdvancePhase(db, pendingCompletion.approval_request_id);
          return res.json({ success: true, message: '完善提交成功' });
        }
      }

      // Pending 信号：上面 completion 分支未匹配（用户无待完善项），禁止再次提交审批
      if (signal.status === 'Pending') {
        return res.status(400).json({ error: '该信号正在审批中，无法重复提交修改。请等待审批完成后再编辑。' });
      }

      // ── V2 审批逻辑：根据端点变更情况决定审批流程 ──

      // 获取当前端点（变更前）
      const oldEndpoints: Array<{ device_id: number; pin_id: number | null; confirmed: number }> = await db.query(
        'SELECT device_id, pin_id, confirmed FROM signal_endpoints WHERE signal_id = ?', [signalId]
      );
      const oldDeviceIds = new Set(oldEndpoints.map(e => e.device_id));
      const hasUnconfirmedEndpoints = oldEndpoints.some(e => !e.confirmed);

      // 解析新端点并比较，判断端点是否真正发生了变化
      const resolvedForItems: Array<{ deviceId: number; pinId: number | null }> = [];
      let newEndpointDeviceIds: number[] = [];
      let endpointsChanged = false;

      if (Array.isArray(endpoints)) {
        // 先解析新端点的 device_id 和 pin_id
        for (const ep of endpoints) {
          if (!ep.设备编号) continue;
          const device = await db.get(`SELECT id FROM devices WHERE project_id = ? AND "设备编号" = ?`, [signal.project_id, ep.设备编号]);
          if (!device) continue;
          let pinId: number | null = null;
          if (ep.设备端元器件编号 && ep.针孔号) {
            const pin = await db.get(`SELECT p.id FROM pins p JOIN connectors c ON p.connector_id = c.id WHERE c.device_id = ? AND c."设备端元器件编号" = ? AND p."针孔号" = ?`, [device.id, ep.设备端元器件编号, ep.针孔号]);
            if (pin) pinId = pin.id;
          }
          resolvedForItems.push({ deviceId: device.id, pinId });
          if (!oldDeviceIds.has(device.id)) {
            newEndpointDeviceIds.push(device.id);
          }
        }

        // 比较新旧端点集合（device_id + pin_id 组合）来判断是否真正变化
        const oldEpSet = new Set(oldEndpoints.map(e => `${e.device_id}:${e.pin_id ?? 'null'}`));
        const newEpSet = new Set(resolvedForItems.map(e => `${e.deviceId}:${e.pinId ?? 'null'}`));
        if (oldEpSet.size !== newEpSet.size) {
          endpointsChanged = true;
        } else {
          for (const key of newEpSet) {
            if (!oldEpSet.has(key)) { endpointsChanged = true; break; }
          }
        }
      }

      // 检查：有未确认端点时，不允许仅修改信号属性
      if (!endpointsChanged && hasUnconfirmedEndpoints) {
        return res.status(400).json({ error: '该信号存在未确认的端点，请先完善所有端点信息后再修改信号属性。' });
      }

      // 更新信号字段
      if (Object.keys(fields).length > 0) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        await db.run(
          `UPDATE signals SET ${setClauses}, status = 'Pending', import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [...Object.values(fields), signalId]
        );
      } else {
        await db.run(`UPDATE signals SET status = 'Pending', import_status = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [signalId]);
      }

      // 保存旧端点详情供拒绝时恢复（必须在替换之前查询）
      const oldEndpointDetails = await db.query(
        `SELECT id, device_id, pin_id, endpoint_index, "端接尺寸", "信号名称", "信号定义", input, output, confirmed
         FROM signal_endpoints WHERE signal_id = ?`, [signalId]
      );
      // 用 endpoint_index 替代 endpoint_id 保存边关系，便于恢复时映射
      const oldEpIdToIdx: Record<number, number> = {};
      for (const ep of oldEndpointDetails) oldEpIdToIdx[ep.id] = ep.endpoint_index;
      const rawEdges = await db.query(
        `SELECT from_endpoint_id, to_endpoint_id, direction, source_info
         FROM signal_edges WHERE signal_id = ?`, [signalId]
      );
      const oldEdgeDetails = rawEdges.map((e: any) => ({
        from_index: oldEpIdToIdx[e.from_endpoint_id] ?? -1,
        to_index: oldEpIdToIdx[e.to_endpoint_id] ?? -1,
        direction: e.direction,
        source_info: e.source_info,
      })).filter((e: any) => e.from_index >= 0 && e.to_index >= 0);

      // 替换端点（总是替换以更新信号名称等端点属性）
      if (Array.isArray(endpoints)) {
        await replaceEndpointsWithEdges(signalId, signal.project_id, endpoints);
      }
      // 如果前端没传 endpoints，用旧端点数据
      if (resolvedForItems.length === 0) {
        oldEndpoints.forEach(e => resolvedForItems.push({ deviceId: e.device_id, pinId: e.pin_id }));
      }

      // 精确计算哪些设备的端点发生了变化（新增设备 或 同设备pin变了）
      // 仅删除端点（保留端点不变）不需要 completion
      let changedDeviceIds: number[] | undefined;
      if (endpointsChanged) {
        const oldEpMap = new Map<number, Set<string>>(); // deviceId -> Set<pinId>
        for (const e of oldEndpoints) {
          if (!oldEpMap.has(e.device_id)) oldEpMap.set(e.device_id, new Set());
          oldEpMap.get(e.device_id)!.add(String(e.pin_id ?? 'null'));
        }
        changedDeviceIds = [];
        for (const { deviceId, pinId } of resolvedForItems) {
          const oldPins = oldEpMap.get(deviceId);
          if (!oldPins) {
            // 新增的设备
            changedDeviceIds.push(deviceId);
          } else if (!oldPins.has(String(pinId ?? 'null'))) {
            // 同设备但pin变了
            changedDeviceIds.push(deviceId);
          }
          // else: 该端点完全没变，不需要completion
        }
      }
      const items = await buildSignalApprovalItems(db, signal.project_id, username, resolvedForItems, {
        endpointsChanged,
        newEndpointDeviceIds: changedDeviceIds && changedDeviceIds.length > 0 ? changedDeviceIds : (endpointsChanged ? [] : undefined),
      });

      await submitChangeRequest(db, {
        projectId: signal.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'edit_signal',
        entityType: 'signal',
        entityId: signalId,
        oldPayload: { ...signal, _oldEndpoints: oldEndpointDetails, _oldEdges: oldEdgeDetails },
        newPayload: fields,
        items,
      });

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
         VALUES ('signals', ?, ?, 'signals', ?, ?, ?, '修改信号(待审批)', 'approved')`,
        [signalId, signalId, req.user!.id, JSON.stringify(signal), JSON.stringify(fields)]
      );

      return res.status(202).json({ success: true, pending: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '更新信号失败' });
    }
  });

  // ── 清空项目所有信号 ──────────────────────────────────────

  router.delete('/project/:projectId/all', authenticate, async (req: AuthRequest, res) => {
    try {
      if (req.user!.role !== 'admin') {
        return res.status(403).json({ error: '只有管理员可以清空信号数据' });
      }
      const projectId = parseInt(req.params.projectId);
      const { changes } = await db.run('DELETE FROM signals WHERE project_id = ?', [projectId]);
      res.json({ deleted: changes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 删除信号 ─────────────────────────────────────────────

  router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const signalId = parseInt(req.params.id);
      const signal = await db.get('SELECT * FROM signals WHERE id = ?', [signalId]);
      if (!signal) return res.status(404).json({ error: '信号不存在' });

      // 冻结检查：关联冻结设备的信号不可删除
      const frozenDevs = await getFrozenDevicesForSignal(db, signalId);
      if (frozenDevs.length > 0) {
        return res.status(403).json({ error: `信号关联的设备「${frozenDevs.join('、')}」已冻结，不可删除` });
      }

      const username = req.user!.username;
      const role = req.user!.role;

      // admin → 直接删除
      if (role === 'admin') {
        const epSnapshot = await db.query(
          `SELECT d.设备编号, c."设备端元器件编号", p.针孔号, se.信号名称, d.设备负责人
           FROM signal_endpoints se JOIN devices d ON se.device_id = d.id
           LEFT JOIN pins p ON se.pin_id = p.id LEFT JOIN connectors c ON p.connector_id = c.id
           WHERE se.signal_id = ? ORDER BY se.endpoint_index`,
          [signalId]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
           VALUES ('signals', ?, ?, 'signals', ?, ?, '删除信号', 'approved')`,
          [signalId, signalId, req.user!.id, JSON.stringify({ ...signal, endpoints: epSnapshot })]
        );
        await db.run('DELETE FROM signals WHERE id = ?', [signalId]);
        return res.json({ success: true });
      }

      if (!await canOperateSignals(db, username, role, signal.project_id)) {
        return res.status(403).json({ error: '无权限删除信号' });
      }

      // 系统组：只能删除有自己端点的信号
      const isDevMgr = await isDeviceManager(db, username, signal.project_id);
      if (isDevMgr) {
        const ownEndpoint = await db.get(
          `SELECT se.id FROM signal_endpoints se JOIN devices d ON se.device_id = d.id WHERE se.signal_id = ? AND d.设备负责人 = ? LIMIT 1`,
          [signalId, username]
        );
        if (!ownEndpoint) {
          return res.status(403).json({ error: '无权限：该信号的端点中没有您负责的设备' });
        }
      }

      // 构建审批项（删除信号跳过 completion，直接 approval）
      const currentEps = await db.query(
        'SELECT device_id, pin_id FROM signal_endpoints WHERE signal_id = ?', [signalId]
      );
      const items = await buildSignalApprovalItems(
        db, signal.project_id, username,
        currentEps.map((e: any) => ({ deviceId: e.device_id, pinId: e.pin_id })),
        { endpointsChanged: false }  // 跳过 completion
      );

      await db.run(`UPDATE signals SET status = 'Pending', import_status = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [signalId]);

      await submitChangeRequest(db, {
        projectId: signal.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'delete_signal',
        entityType: 'signal',
        entityId: signalId,
        oldPayload: signal,
        newPayload: {},
        items,
      });

      return res.status(202).json({ pending: true, message: '删除请求已提交，等待审批' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除信号失败' });
    }
  });

  // ── 导出信号端点对 CSV ──────────────────────────────────────
  // POST /api/signals/export-pairs
  // Body: { projectId, deviceIds: number[] }
  // 导出格式与"下载项目数据"的"电气接口数据表"完全一致
  router.post('/export-pairs', authenticate, async (req: AuthRequest, res) => {
    try {
      const { projectId, deviceIds } = req.body as { projectId: number; deviceIds: number[] };
      if (!projectId || !Array.isArray(deviceIds) || deviceIds.length === 0) {
        return res.status(400).json({ error: '缺少 projectId 或 deviceIds' });
      }

      const ph = deviceIds.map(() => '?').join(',');

      // 找出与所选设备有关的所有信号
      const signals = await db.query(
        `SELECT DISTINCT s.*
         FROM signals s
         JOIN signal_endpoints se ON se.signal_id = s.id
         WHERE s.project_id = ? AND se.device_id IN (${ph})
         ORDER BY
           CASE WHEN s.signal_group IS NOT NULL AND s.signal_group != '' THEN 0 ELSE 1 END,
           s.signal_group, s.twist_group, s."协议标识", s.unique_id, s.id`,
        [projectId, ...deviceIds]
      );

      const header = [
        '信号组', '绞线组', 'Unique ID', '连接类型', '协议标识', '线类型',
        '设备（从）', 'LIN号（从）', '连接器（从）', '针孔号（从）', '端接尺寸（从）', '屏蔽类型（从）', '信号名称（从）', '信号定义（从）',
        '设备（到）', 'LIN号（到）', '连接器（到）', '针孔号（到）', '端接尺寸（到）', '屏蔽类型（到）', '信号名称（到）', '信号定义（到）',
        '导线等级', '推荐导线线规', '推荐导线线型', '独立电源代码', '敷设代码',
        '电磁兼容代码', '余度代码', '功能代码', '接地代码', '极性',
        '信号ATA', '信号架次有效性', '额定电压', '额定电流', '设备正常工作电压范围',
        '是否成品线', '成品线件号', '成品线线规', '成品线类型', '成品线长度',
        '成品线载流量', '成品线线路压降', '成品线标识', '成品线与机上线束对接方式',
        '成品线安装责任', '备注',
      ];

      const rows: string[][] = [];

      for (const sig of signals) {
        const endpoints = await db.query(
          `SELECT se.id as ep_id, se.endpoint_index, se.端接尺寸 as 端接尺寸_ep, se.信号名称 as 信号名称_ep, se.信号定义 as 信号定义_ep,
                  p.针孔号, p.屏蔽类型, c.设备端元器件编号 as 连接器号, d.设备编号, d."设备LIN号（DOORS）" as lin号, d.设备等级
           FROM signal_endpoints se
           JOIN pins p ON se.pin_id = p.id
           JOIN connectors c ON p.connector_id = c.id
           JOIN devices d ON c.device_id = d.id
           WHERE se.signal_id = ?
           ORDER BY se.endpoint_index`, [sig.id]
        );

        const edges = await db.query('SELECT * FROM signal_edges WHERE signal_id = ? ORDER BY id', [sig.id]);

        // 导线等级
        const levels = endpoints.map((e: any) => e.设备等级).filter((v: any) => v);
        let wireGrade = '';
        if (levels.length > 0) {
          const nums = levels.map((v: string) => parseInt(v));
          if (nums.every((n: number) => !isNaN(n))) {
            wireGrade = String(endpoints.length <= 2 ? Math.max(...nums) : Math.min(...nums)) + '级';
          }
        }

        const base = [
          sig.signal_group || '',
          (sig.signal_group && sig.twist_group) ? sig.signal_group + '-' + sig.twist_group : (sig.twist_group || ''),
          sig.unique_id || '', sig['连接类型'] || '', sig['协议标识'] || '', sig['线类型'] || '',
        ];
        const tail = [
          wireGrade, sig['推荐导线线规'] || '', sig['推荐导线线型'] || '',
          sig['独立电源代码'] || '', sig['敷设代码'] || '',
          sig['电磁兼容代码'] || '', sig['余度代码'] || '', sig['功能代码'] || '', sig['接地代码'] || '', sig['极性'] || '',
          sig['信号ATA'] || '', sig['信号架次有效性'] || '', sig['额定电压'] || '', sig['额定电流'] || '', sig['设备正常工作电压范围'] || '',
          sig['是否成品线'] || '', sig['成品线件号'] || '', sig['成品线线规'] || '', sig['成品线类型'] || '', sig['成品线长度'] || '',
          sig['成品线载流量'] || '', sig['成品线线路压降'] || '', sig['成品线标识'] || '', sig['成品线与机上线束对接方式'] || '',
          sig['成品线安装责任'] || '', sig['备注'] || '',
        ];

        const epMap = new Map(endpoints.map((e: any) => [e.ep_id, e]));
        const fmtEp = (ep: any) => [ep.设备编号, ep.lin号 || '', ep.连接器号, ep.针孔号, ep.端接尺寸_ep || '', ep.屏蔽类型 || '', ep.信号名称_ep || '', ep.信号定义_ep || ''];
        const emptyEp = ['', '', '', '', '', '', '', ''];

        if (edges.length > 0) {
          for (const edge of edges) {
            const from = epMap.get(edge.from_endpoint_id);
            const to = epMap.get(edge.to_endpoint_id);
            if (!from || !to) continue;
            rows.push([...base, ...fmtEp(from), ...fmtEp(to), ...tail]);
          }
        } else if (endpoints.length === 0) {
          rows.push([...base, ...emptyEp, ...emptyEp, ...tail]);
        } else {
          const from = endpoints[0];
          const toList = endpoints.length >= 2 ? endpoints.slice(1) : [endpoints[0]];
          for (const to of toList) {
            rows.push([...base, ...fmtEp(from), ...fmtEp(to as any), ...tail]);
          }
        }
      }

      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.default.Workbook();
      const ws = workbook.addWorksheet('电气接口数据表');

      const headerFont: any = { bold: true, size: 10 };
      const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
      const headerBorder: any = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      const thinBorder: any = { top: { style: 'thin', color: { argb: 'FFD0D0D0' } }, bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } }, left: { style: 'thin', color: { argb: 'FFD0D0D0' } }, right: { style: 'thin', color: { argb: 'FFD0D0D0' } } };

      // 信号分组背景色
      const groupBgColors: Record<string, string> = {
        'A_429_':'FFE0E7FF','A_453_':'FFDDD6FE','ANLG_2S_':'FFFED7AA','ANLG_3S_':'FFFED7AA',
        'CAN_Bus_':'FFFEF3C7','Discrete_2S_':'FFF3F4F6','ETH100_':'FFD1FAE5','ETH1000_':'FFDBEAFE',
        'HDMI_':'FFFCE7F3','PWR_LV_':'FFFEE2E2','PWR_HV_':'FFFECACA','RS422_F_':'FFEDE9FE',
        'RS422_':'FFF5F3FF','RS485_':'FFCCFBF1','三相电_':'FFFECACA',
      };

      // 表头
      const hRow = ws.addRow(header);
      hRow.eachCell((cell: any) => { cell.font = headerFont; cell.fill = headerFill; cell.border = headerBorder; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });

      // 记录每行的信号组（用于合并和背景色）
      const rowGroups: string[] = [];
      const dataStartRow = 2;

      for (const r of rows) {
        const sg = r[0] || ''; // 第一列是信号组
        rowGroups.push(sg);
        const dataRow = ws.addRow(r);
        dataRow.eachCell((cell: any) => { cell.font = { size: 9 }; cell.border = thinBorder; cell.alignment = { vertical: 'middle' }; });

        // 信号分组背景色
        if (sg) {
          const prefix = Object.keys(groupBgColors).find(p => sg.startsWith(p));
          if (prefix) {
            const groupFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: groupBgColors[prefix] } };
            dataRow.eachCell((cell: any) => { cell.fill = groupFill; });
          }
        }
      }

      // 合并单元格辅助
      const mergeConsecutive = (colIdx: number, rangeStart: number, rangeEnd: number, allowEmpty: boolean) => {
        if (colIdx === 0 || rangeStart > rangeEnd) return;
        let mStart = rangeStart, mVal = ws.getCell(mStart, colIdx).value;
        for (let r = rangeStart + 1; r <= rangeEnd + 1; r++) {
          const curVal = r <= rangeEnd ? ws.getCell(r, colIdx).value : '___SENTINEL___';
          if (curVal === mVal) continue;
          if (r - 1 > mStart && (mVal || allowEmpty)) {
            ws.mergeCells(mStart, colIdx, r - 1, colIdx);
            ws.getCell(mStart, colIdx).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          }
          mStart = r; mVal = curVal;
        }
      };

      const totalRows = rows.length;
      const endRow = dataStartRow + totalRows - 1;
      const groupColIdx = header.indexOf('信号组') + 1;
      const twistColIdx = header.indexOf('绞线组') + 1;
      const uidColIdx = header.indexOf('Unique ID') + 1;

      // 合并信号组列
      if (groupColIdx > 0) mergeConsecutive(groupColIdx, dataStartRow, endRow, false);

      // 合并绞线组列（不跨信号组边界）
      if (twistColIdx > 0 && groupColIdx > 0 && totalRows > 0) {
        let gStart = dataStartRow, gVal = rowGroups[0] || '';
        for (let r = 1; r <= totalRows; r++) {
          const curG = r < totalRows ? (rowGroups[r] || '') : '___SENTINEL___';
          if (curG === gVal) continue;
          if (gVal) mergeConsecutive(twistColIdx, gStart, dataStartRow + r - 1, true);
          gStart = dataStartRow + r; gVal = curG;
        }
      }

      // 合并 Unique ID 列
      if (uidColIdx > 0) mergeConsecutive(uidColIdx, dataStartRow, endRow, false);

      // 冻结
      const freezeCol = header.indexOf('连接类型') + 1;
      ws.views = [{ state: 'frozen' as const, xSplit: freezeCol > 0 ? freezeCol - 1 : 3, ySplit: 1 }];

      // 列宽
      header.forEach((col, ci) => {
        const maxLen = Math.max(col.length, ...rows.slice(0, 50).map(r => String(r[ci] ?? '').length));
        ws.getColumn(ci + 1).width = Math.min(Math.max(maxLen * 1.2 + 2, 8), 35);
      });

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="signal_pairs_export.xlsx"');
      res.send(Buffer.from(buffer as ArrayBuffer));
      res.end();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── 信号分组定义 ─────────────────────────────────────────
  // connTypes: 该分组接受哪些连接类型（组内必须一致）
  // required: 必须包含的协议标识, optional: 可选的协议标识
  type GroupDef = { prefix: string; count: number; protocols: string[]; required?: string[]; optional?: string[]; connTypes: string[] };
  const SIGNAL_GROUP_DEFS: Record<string, GroupDef> = {
    'A_429':       { prefix: 'A_429_',       connTypes: ['ARINC 429'],        count: 2, protocols: ['A429_Positive', 'A429_Negative'] },
    'A_453':       { prefix: 'A_453_',       connTypes: ['ARINC 453'],        count: 2, protocols: ['A453_Positive', 'A453_Negative'] },
    'CAN_Bus':     { prefix: 'CAN_Bus_',     connTypes: ['CAN Bus'],          count: 3, protocols: ['CAN_High', 'CAN_Low', 'CAN_Gnd'], required: ['CAN_High', 'CAN_Low'], optional: ['CAN_Gnd'] },
    'Discrete_2S': { prefix: 'Discrete_2S_', connTypes: ['Discrete'],         count: 2, protocols: ['Positive_+', 'Negative_-'] },
    'HDMI':        { prefix: 'HDMI_',        connTypes: ['HDMI'],             count: 8, protocols: ['HDMI_A+', 'HDMI_A-', 'HDMI_B+', 'HDMI_B-', 'HDMI_C+', 'HDMI_C-', 'HDMI_D+', 'HDMI_D-'] },
    'RS422':       { prefix: 'RS422_',       connTypes: ['RS-422'],           count: 3, protocols: ['RS-422_A', 'RS-422_B', 'RS-422_Gnd'], required: ['RS-422_A', 'RS-422_B'], optional: ['RS-422_Gnd'] },
    'RS422_F':     { prefix: 'RS422_F_',     connTypes: ['RS-422（全双工）'],  count: 5, protocols: ['RS-422_TX_A', 'RS-422_TX_B', 'RS-422_RX_A', 'RS-422_RX_B', 'RS-422_Gnd'], required: ['RS-422_TX_A', 'RS-422_TX_B', 'RS-422_RX_A', 'RS-422_RX_B'], optional: ['RS-422_Gnd'] },
    'RS485':       { prefix: 'RS485_',       connTypes: ['RS-485'],           count: 3, protocols: ['RS-485_A', 'RS-485_B', 'RS-485_Gnd'], required: ['RS-485_A', 'RS-485_B'], optional: ['RS-485_Gnd'] },
    'ETH100':      { prefix: 'ETH100_',      connTypes: ['以太网（百兆）'],    count: 5, protocols: ['ETH_TX+', 'ETH_TX-', 'ETH_RX+', 'ETH_RX-', 'ETH_Gnd'], required: ['ETH_TX+', 'ETH_TX-', 'ETH_RX+', 'ETH_RX-'], optional: ['ETH_Gnd'] },
    'ETH1000':     { prefix: 'ETH1000_',     connTypes: ['以太网（千兆）'],    count: 9, protocols: ['ETH_A+', 'ETH_A-', 'ETH_B+', 'ETH_B-', 'ETH_C+', 'ETH_C-', 'ETH_D+', 'ETH_D-', 'ETH_Gnd'], required: ['ETH_A+', 'ETH_A-', 'ETH_B+', 'ETH_B-', 'ETH_C+', 'ETH_C-', 'ETH_D+', 'ETH_D-'], optional: ['ETH_Gnd'] },
    'ANLG_2S':     { prefix: 'ANLG_2S_',     connTypes: ['模拟量'],            count: 2, protocols: ['模拟量A', '模拟量B'] },
    'ANLG_3S':     { prefix: 'ANLG_3S_',     connTypes: ['模拟量'],            count: 3, protocols: ['模拟量A', '模拟量B', '模拟量C'] },
    'PWR_LV':      { prefix: 'PWR_LV_',      connTypes: ['电源（低压）'],      count: 2, protocols: ['电源（低压）正极', '电源（低压）负极'] },
    'PWR_HV':      { prefix: 'PWR_HV_',      connTypes: ['电源（高压）'],      count: 2, protocols: ['电源（高压）正极', '电源（高压）负极'] },
    '三相电_LV':   { prefix: '三相电_',       connTypes: ['电源（低压）'],      count: 3, protocols: ['电源（低压）正极', '电源（低压）负极', '电源（低压）Gnd'] },
    '三相电_HV':   { prefix: '三相电_',       connTypes: ['电源（高压）'],      count: 3, protocols: ['电源（高压）正极', '电源（高压）负极', '电源（高压）Gnd'] },
  };

  // 根据连接类型+协议标识组合查找最匹配的分组定义
  function findBestGroupDef(connType: string, protocols: string[]): { name: string; def: GroupDef } | null {
    for (const [name, def] of Object.entries(SIGNAL_GROUP_DEFS)) {
      if (!def.connTypes.includes(connType)) continue;
      const defRequired = def.required || def.protocols;
      const defAll = def.protocols;
      if (protocols.length < defRequired.length || protocols.length > defAll.length) continue;
      const hasAllRequired = defRequired.every(p => protocols.includes(p));
      const noExtra = protocols.every(p => defAll.includes(p));
      if (hasAllRequired && noExtra) return { name, def };
    }
    return null;
  }

  // ── 自动赋值绞线组 ──────────────────────────────────────────
  async function autoAssignTwistGroup(groupName: string, projectId: number) {
    const sigs = await db.query(
      'SELECT id, "推荐导线线型" FROM signals WHERE signal_group = ? AND project_id = ? AND (twist_group IS NULL OR twist_group = \'\')',
      [groupName, projectId]
    );
    const doubleSigs = sigs.filter((s: any) => /双绞/.test(s['推荐导线线型'] || ''));
    const tripleSigs = sigs.filter((s: any) => /三绞/.test(s['推荐导线线型'] || ''));
    // 找下一个可用编号
    const existingTwists = await db.query(
      'SELECT DISTINCT twist_group FROM signals WHERE signal_group = ? AND project_id = ? AND twist_group IS NOT NULL',
      [groupName, projectId]
    );
    const usedNums = new Set(existingTwists.map((r: any) => r.twist_group));
    let nextNum = 1;
    const getNext = () => { while (usedNums.has('T' + nextNum)) nextNum++; const n = 'T' + nextNum; usedNums.add(n); nextNum++; return n; };
    // 双绞线恰好2根 → 自动配对
    if (doubleSigs.length === 2) {
      const tName = getNext();
      const ph = doubleSigs.map(() => '?').join(',');
      await db.run('UPDATE signals SET twist_group = ? WHERE id IN (' + ph + ')', [tName, ...doubleSigs.map((s: any) => s.id)]);
    }
    // 三绞线恰好3根 → 自动配对
    if (tripleSigs.length === 3) {
      const tName = getNext();
      const ph = tripleSigs.map(() => '?').join(',');
      await db.run('UPDATE signals SET twist_group = ? WHERE id IN (' + ph + ')', [tName, ...tripleSigs.map((s: any) => s.id)]);
    }
  }

  // ── POST /api/signals/group — 创建信号组 ─────────────────
  router.post('/group', authenticate, async (req: AuthRequest, res) => {
    try {
      const { signal_ids } = req.body;
      if (!Array.isArray(signal_ids) || signal_ids.length < 2) {
        return res.status(400).json({ error: '至少需要选择 2 条信号' });
      }

      // 查询所有信号
      const ph = signal_ids.map(() => '?').join(',');
      const signals = await db.query(`SELECT * FROM signals WHERE id IN (${ph})`, signal_ids);
      if (signals.length !== signal_ids.length) {
        return res.status(400).json({ error: '部分信号不存在' });
      }

      // 检查：所有信号属于同一项目
      const projectIds = [...new Set(signals.map((s: any) => s.project_id))];
      if (projectIds.length !== 1) {
        return res.status(400).json({ error: '所有信号必须属于同一项目' });
      }

      // 检查：没有信号已属于其他组
      const alreadyGrouped = signals.filter((s: any) => s.signal_group);
      if (alreadyGrouped.length > 0) {
        const ids = alreadyGrouped.map((s: any) => `${s.unique_id}(${s.signal_group})`).join('、');
        return res.status(400).json({ error: `以下信号已属于其他组：${ids}` });
      }

      // 检查：连接类型一致
      const connTypes = [...new Set(signals.map((s: any) => s['连接类型']))];
      if (connTypes.length !== 1) {
        return res.status(400).json({ error: `组内信号的连接类型必须一致，当前包含：${connTypes.join('、')}` });
      }

      const connType = connTypes[0];
      const protocols = signals.map((s: any) => s['协议标识']).filter((p: string) => p);
      const match = findBestGroupDef(connType, protocols);
      if (!match) {
        const available = Object.values(SIGNAL_GROUP_DEFS).filter(d => d.connTypes.includes(connType));
        if (available.length === 0) {
          return res.status(400).json({ error: `连接类型"${connType}"不支持信号分组` });
        }
        const options = available.map(d => `${d.protocols.join(' + ')}（${(d.required || d.protocols).length}${d.optional ? '~' + d.protocols.length : ''}条）`).join('；\n');
        return res.status(400).json({ error: `所选信号的协议标识组合不匹配任何分组规则。\n连接类型"${connType}"支持的分组：\n${options}` });
      }
      const groupDef = match.def;

      // 生成编号：查当前项目最大编号
      const existing = await db.query(
        `SELECT signal_group FROM signals WHERE project_id = ? AND signal_group LIKE ?`,
        [projectIds[0], `${groupDef.prefix}%`]
      );
      let maxNum = -1;
      for (const row of existing) {
        const num = parseInt(row.signal_group.slice(groupDef.prefix.length));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
      const groupName = `${groupDef.prefix}${maxNum + 1}`;

      // 更新信号
      await db.run(`UPDATE signals SET signal_group = ? WHERE id IN (${ph})`, [groupName, ...signal_ids]);

      // 自动赋值绞线组
      await autoAssignTwistGroup(groupName, projectIds[0]);

      res.json({ success: true, group_name: groupName });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '创建信号组失败' });
    }
  });

  // ── DELETE /api/signals/group/:name — 解散信号组 ─────────
  router.delete('/group/:name', authenticate, async (req: AuthRequest, res) => {
    try {
      const groupName = req.params.name;
      const projectId = parseInt(req.query.project_id as string);
      if (!groupName || isNaN(projectId)) {
        return res.status(400).json({ error: '缺少 group_name 或 project_id' });
      }

      const result = await db.run(
        `UPDATE signals SET signal_group = NULL, twist_group = NULL WHERE signal_group = ? AND project_id = ?`,
        [groupName, projectId]
      );
      if (result.changes === 0) {
        return res.status(404).json({ error: '未找到该信号组' });
      }

      res.json({ success: true, updated: result.changes });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '解散信号组失败' });
    }
  });

  // twist-group 路由已移至 /:id 之前（第855行）

  return router;
}
