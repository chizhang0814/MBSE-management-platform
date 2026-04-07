import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import {
  isZontiRenyuan, isDeviceManager, isEwisAdmin, getProjectRoleMembers,
  submitChangeRequest, checkAndAdvancePhase, ApprovalItemSpec, SPECIAL_ERN_LIN, isPinFrozen,
} from '../shared/approval-helper.js';

// 支持协议标识的连接类型集合
const PROTOCOL_CONNECTION_TYPES = new Set([
  'ARINC 429', 'CAN Bus', '电源（低压）', '电源（高压）',
  'RS-422', 'RS-422（全双工）', 'RS-485', '以太网（百兆）', '以太网（千兆）',
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

  async function generateUniqueId(db: Database, projectId: number, connectionType: string): Promise<string> {
    let prefix = '';
    if (connectionType === '1to1信号' || connectionType === '1to1') prefix = 'DATA_';
    else if (connectionType === '网络') prefix = 'NET_';
    else if (connectionType === 'ERN' || connectionType === '接地') prefix = 'ERN_';
    else return `SIG_${Date.now()}`;

    const rows = await db.query(
      `SELECT unique_id FROM signals WHERE project_id = ? AND unique_id LIKE ? AND unique_id IS NOT NULL`,
      [projectId, `${prefix}%`]
    );
    let maxNum = 0;
    for (const r of rows) {
      const match = r.unique_id?.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`));
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    return `${prefix}${String(maxNum + 1).padStart(5, '0')}`;
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

  async function buildSignalApprovalItems(
    db: Database,
    projectId: number,
    operatorUsername: string,
    resolvedEndpoints: Array<{ deviceId: number; pinId: number | null }>
  ): Promise<ApprovalItemSpec[]> {
    const items: ApprovalItemSpec[] = [];

    // 阶段一 completion：其他设备负责人（全部通过才进阶段二）
    const ownersSeen = new Set<string>();
    for (const { deviceId } of resolvedEndpoints) {
      const ownerRow = await db.get('SELECT 设备负责人 FROM devices WHERE id = ?', [deviceId]);
      const owner = ownerRow?.设备负责人;
      if (!owner || owner === operatorUsername || ownersSeen.has(owner)) continue;
      ownersSeen.add(owner);
      items.push({ recipient_username: owner, item_type: 'completion' });
    }

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
      if (pendingSignalIds.length > 0) {
        const ph = pendingSignalIds.map(() => '?').join(',');
        const pendingItems = await db.query(
          `SELECT ar.entity_id, ai.item_type
           FROM approval_requests ar
           JOIN approval_items ai ON ai.approval_request_id = ar.id
           WHERE ar.entity_type = 'signal'
             AND ar.status = 'pending'
             AND ar.entity_id IN (${ph})
             AND ai.recipient_username = ?
             AND ai.status = 'pending'`,
          [...pendingSignalIds, username]
        );
        for (const pi of pendingItems) pendingItemMap[pi.entity_id] = pi.item_type;
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
        return { ...s, ...(summaryMap[s.id] ?? { endpoint_summary: '', 信号名称摘要: '' }), can_edit, pending_item_type };
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
          signal_ids: g.signal_ids.split(',').map(Number),
          unique_ids: g.unique_ids.split(','),
          protocols: g.protocols.split(','),
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
      if (!signalFields.unique_id) {
        return res.status(400).json({ error: 'Unique ID 不能为空' });
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
        const items = await buildSignalApprovalItems(db, project_id, username, resolved.map(r => ({ deviceId: r.deviceId, pinId: r.pinId })));
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
      delete fields.pending_item_type; delete fields['导线等级']; delete fields.edges; delete fields.signal_group;
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

      // 非 admin、非 forceDraft → 提交审批
      if (Object.keys(fields).length > 0) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        await db.run(
          `UPDATE signals SET ${setClauses}, status = 'Pending', import_status = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [...Object.values(fields), signalId]
        );
      } else {
        await db.run(`UPDATE signals SET status = 'Pending', import_status = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [signalId]);
      }

      // 替换端点
      const resolvedForItems: Array<{ deviceId: number; pinId: number | null }> = [];
      if (Array.isArray(endpoints)) {
        const newEpByPin = await replaceEndpointsWithEdges(signalId, signal.project_id, endpoints);
        // 收集 resolvedForItems 用于构建审批人
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
        }
      } else {
        // No endpoint change: get current endpoints for approval items
        const currentEps = await db.query(
          'SELECT device_id, pin_id FROM signal_endpoints WHERE signal_id = ?', [signalId]
        );
        currentEps.forEach((e: any) => resolvedForItems.push({ deviceId: e.device_id, pinId: e.pin_id }));
      }

      const items = await buildSignalApprovalItems(db, signal.project_id, username, resolvedForItems);

      await submitChangeRequest(db, {
        projectId: signal.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'edit_signal',
        entityType: 'signal',
        entityId: signalId,
        oldPayload: signal,
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

      // 构建审批项
      const currentEps = await db.query(
        'SELECT device_id, pin_id FROM signal_endpoints WHERE signal_id = ?', [signalId]
      );
      const items = await buildSignalApprovalItems(
        db, signal.project_id, username,
        currentEps.map((e: any) => ({ deviceId: e.device_id, pinId: e.pin_id }))
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
  router.post('/export-pairs', authenticate, async (req: AuthRequest, res) => {
    try {
      const { projectId, deviceIds } = req.body as { projectId: number; deviceIds: number[] };
      if (!projectId || !Array.isArray(deviceIds) || deviceIds.length === 0) {
        return res.status(400).json({ error: '缺少 projectId 或 deviceIds' });
      }

      const ph = deviceIds.map(() => '?').join(',');

      // 找出与所选设备有关的所有信号
      const signals = await db.query(
        `SELECT DISTINCT s.id, s.unique_id, s."连接类型", s."信号ATA", s."信号架次有效性",
                s."推荐导线线规", s."推荐导线线型",
                s."独立电源代码", s."敷设代码", s."电磁兼容代码", s."功能代码", s."余度代码",
                s."接地代码", s."极性", s."额定电压", s."额定电流", s."设备正常工作电压范围",
                s."是否成品线", s."成品线件号", s."成品线线规", s."成品线类型",
                s."成品线长度", s."成品线载流量", s."成品线线路压降", s."成品线标识",
                s."成品线与机上线束对接方式", s."成品线安装责任", s."备注"
         FROM signals s
         JOIN signal_endpoints se ON se.signal_id = s.id
         WHERE s.project_id = ? AND se.device_id IN (${ph})`,
        [projectId, ...deviceIds]
      );

      // 批量查所有相关信号的端点（一次查询，避免 N+1）
      const signalIds = signals.map((s: any) => s.id);
      const epPh = signalIds.map(() => '?').join(',');
      const allEndpoints = await db.query(
        `SELECT se.signal_id, se.id, se.device_id, se.pin_id,
                COALESCE(se."端接尺寸", p.端接尺寸) AS 端接尺寸,
                p.针孔号,
                c."设备端元器件编号"
         FROM signal_endpoints se
         LEFT JOIN pins p ON se.pin_id = p.id
         LEFT JOIN connectors c ON p.connector_id = c.id
         WHERE se.signal_id IN (${epPh})
         ORDER BY se.signal_id, se.endpoint_index, se.id`,
        signalIds
      );
      const endpointsBySig: Record<number, any[]> = {};
      for (const ep of allEndpoints) {
        if (!endpointsBySig[ep.signal_id]) endpointsBySig[ep.signal_id] = [];
        endpointsBySig[ep.signal_id].push(ep);
      }

      const rows: string[][] = [];

      for (const sig of signals) {
        const endpoints = endpointsBySig[sig.id] || [];

        if (endpoints.length < 2) continue;

        const selectedSet = new Set(deviceIds.map(Number));

        // 生成所有满足条件的端点对（至少一个端点属于所选设备，且两端不同）
        for (let i = 0; i < endpoints.length; i++) {
          for (let j = i + 1; j < endpoints.length; j++) {
            const a = endpoints[i];
            const b = endpoints[j];
            const aSelected = selectedSet.has(Number(a.device_id));
            const bSelected = selectedSet.has(Number(b.device_id));

            if (!aSelected && !bSelected) continue;

            // 决定从/到：所选设备作为从端；若两端都被选中，按 deviceIds 中的索引顺序决定
            let fromEp, toEp;
            if (aSelected && !bSelected) {
              fromEp = a; toEp = b;
            } else if (!aSelected && bSelected) {
              fromEp = b; toEp = a;
            } else {
              const aIdx = deviceIds.indexOf(Number(a.device_id));
              const bIdx = deviceIds.indexOf(Number(b.device_id));
              fromEp = aIdx <= bIdx ? a : b;
              toEp   = aIdx <= bIdx ? b : a;
            }

            const 敷设字母 = [
              sig.独立电源代码 || '',
              sig.敷设代码 || '',
              sig.电磁兼容代码 || '',
              sig.功能代码 || '',
              sig.余度代码 || '',
            ].join('-');

            rows.push([
              sig.unique_id || '',                          // Unique ID
              sig.连接类型 || '',                            // 连接类型
              sig.信号ATA || '',                             // 信号ATA
              sig.信号架次有效性 || '',                       // 信号架次有效性
              '',                                           // 线束号
              fromEp['设备端元器件编号'] || '',              // 端元器件编号（从）
              fromEp['针孔号'] || '',                        // 针孔号（从）
              '',                                           // 端接代号（从）
              '',                                           // 导线号
              sig.推荐导线线型 || '',                        // 导线材料
              fromEp['端接尺寸'] || sig.推荐导线线规 || '',  // AWG
              '',                                           // 长度（mm）
              toEp['设备端元器件编号'] || '',                // 端元器件编号（到）
              toEp['针孔号'] || '',                          // 针孔号（到）
              '',                                           // 端接代号（到）
              敷设字母,                                      // 敷设字母
              sig.接地代码 || '',                            // 接地代码
              sig.极性 || '',                                // 极性
              sig.额定电压 || '',                            // 额定电压
              sig.额定电流 || '',                            // 额定电流（A）
              sig.设备正常工作电压范围 || '',                 // 设备正常工作电压范围
              sig.是否成品线 || '',                          // 是否成品线
              sig.成品线件号 || '',                          // 成品线件号
              sig.成品线线规 || '',                          // 成品线线规
              sig.成品线类型 || '',                          // 成品线类型
              sig.成品线长度 || '',                          // 成品线长度(MM)
              sig.成品线载流量 || '',                        // 成品线载流量(A)
              sig.成品线线路压降 || '',                      // 成品线线路压降
              sig.成品线标识 || '',                          // 成品线标识
              sig.成品线与机上线束对接方式 || '',             // 成品线与机上线束对接方式
              sig.成品线安装责任 || '',                      // 成品线安装责任
              '',                                           // 线路图图内号
              sig.备注 || '',                                // 备注
            ]);
          }
        }
      }

      // 流式写出 CSV（BOM for Excel），逐行发送避免大数据集内存积压
      const header = [
        'Unique ID', '连接类型', '信号ATA', '信号架次有效性',
        '线束号', '端元器件编号（从）', '针孔号（从）', '端接代号（从）',
        '导线号', '导线材料', 'AWG', '长度（mm）',
        '端元器件编号（到）', '针孔号（到）', '端接代号（到）',
        '敷设字母', '接地代码', '极性', '额定电压', '额定电流（A）', '设备正常工作电压范围',
        '是否成品线', '成品线件号', '成品线线规', '成品线类型',
        '成品线长度(MM)', '成品线载流量(A)', '成品线线路压降', '成品线标识',
        '成品线与机上线束对接方式', '成品线安装责任',
        '线路图图内号', '备注',
      ];

      const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="signal_pairs_export.csv"');
      res.write('\uFEFF' + header.map(escape).join(',') + '\r\n');
      for (const r of rows) {
        res.write(r.map(escape).join(',') + '\r\n');
      }
      res.end();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── 信号分组定义 ─────────────────────────────────────────
  const SIGNAL_GROUP_DEFS: Record<string, { prefix: string; count: number; protocols: string[] }> = {
    'ARINC 429':      { prefix: 'A_429_',    count: 2, protocols: ['A429_Positive', 'A429_Negative'] },
    'CAN Bus':        { prefix: 'CAN_Bus_',  count: 3, protocols: ['CAN_High', 'CAN_Low', 'CAN_Gnd'] },
    '电源（低压）':    { prefix: 'PWR_LV_',   count: 2, protocols: ['电源（低压）正极', '电源（低压）负极'] },
    '电源（高压）':    { prefix: 'PWR_HV_',   count: 2, protocols: ['电源（高压）正极', '电源（高压）负极'] },
    'RS-422':         { prefix: 'RS422_',    count: 3, protocols: ['RS-422_A', 'RS-422_B', 'RS-422_Gnd'] },
    'RS-422（全双工）': { prefix: 'RS422_F_',  count: 5, protocols: ['RS-422_TX_A', 'RS-422_TX_B', 'RS-422_RX_A', 'RS-422_RX_B', 'RS-422_Gnd'] },
    'RS-485':         { prefix: 'RS485_',    count: 3, protocols: ['RS-485_A', 'RS-485_B', 'RS-485_Gnd'] },
    '以太网（百兆）':  { prefix: 'ETH100_',   count: 5, protocols: ['ETH_TX+', 'ETH_TX-', 'ETH_RX+', 'ETH_RX-', 'ETH_Gnd'] },
    '以太网（千兆）':  { prefix: 'ETH1000_',  count: 9, protocols: ['ETH_A+', 'ETH_A-', 'ETH_B+', 'ETH_B-', 'ETH_C+', 'ETH_C-', 'ETH_D+', 'ETH_D-', 'ETH_Gnd'] },
  };

  // 连接类型 → 线类型 映射
  const POWER_CONN_TYPES = new Set(['电源（低压）', '电源（高压）']);

  // ── POST /api/signals/group/blank — 创建空白分组 ─────────
  router.post('/group/blank', authenticate, async (req: AuthRequest, res) => {
    try {
      const { project_id, conn_type } = req.body;
      if (!project_id || !conn_type) {
        return res.status(400).json({ error: '缺少 project_id 或 conn_type' });
      }

      const groupDef = SIGNAL_GROUP_DEFS[conn_type];
      if (!groupDef) {
        return res.status(400).json({ error: `连接类型"${conn_type}"不支持信号分组` });
      }

      // 生成组编号
      const existing = await db.query(
        `SELECT signal_group FROM signals WHERE project_id = ? AND signal_group LIKE ?`,
        [project_id, `${groupDef.prefix}%`]
      );
      let maxNum = -1;
      for (const row of existing) {
        const num = parseInt(row.signal_group.slice(groupDef.prefix.length));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
      const groupName = `${groupDef.prefix}${maxNum + 1}`;

      const lineType = POWER_CONN_TYPES.has(conn_type) ? '功率线' : '信号线';
      const username = req.user!.username;
      const createdIds: number[] = [];

      for (const protocol of groupDef.protocols) {
        const uniqueId = `${groupDef.prefix}${protocol}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const result = await db.run(
          `INSERT INTO signals (project_id, unique_id, "连接类型", "协议标识", "线类型", status, signal_group, created_by)
           VALUES (?, ?, ?, ?, ?, 'Draft', ?, ?)`,
          [project_id, uniqueId, conn_type, protocol, lineType, groupName, username]
        );
        createdIds.push(result.lastID);
      }

      res.json({ success: true, group_name: groupName, signal_ids: createdIds });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '创建空白分组失败' });
    }
  });

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
      const groupDef = SIGNAL_GROUP_DEFS[connType];
      if (!groupDef) {
        return res.status(400).json({ error: `连接类型"${connType}"不支持信号分组` });
      }

      // 检查：信号数量
      if (signals.length !== groupDef.count) {
        return res.status(400).json({ error: `${connType} 组需要恰好 ${groupDef.count} 条信号，当前选择了 ${signals.length} 条` });
      }

      // 检查：协议标识完整性
      const protocols = signals.map((s: any) => s['协议标识']);
      const missing = groupDef.protocols.filter(p => !protocols.includes(p));
      const extra = protocols.filter((p: string) => !groupDef.protocols.includes(p));
      if (missing.length > 0 || extra.length > 0) {
        let msg = `${connType} 组的协议标识要求：${groupDef.protocols.join('、')}。`;
        if (missing.length > 0) msg += `\n缺少：${missing.join('、')}`;
        if (extra.length > 0) msg += `\n多余：${extra.join('、')}`;
        return res.status(400).json({ error: msg });
      }

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
        `UPDATE signals SET signal_group = NULL WHERE signal_group = ? AND project_id = ?`,
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

  return router;
}
