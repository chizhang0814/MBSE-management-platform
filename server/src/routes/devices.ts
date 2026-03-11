import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';
import {
  isZontiRenyuan, isDeviceManager, getProjectRoleMembers,
  submitChangeRequest, checkAndAdvancePhase, ApprovalItemSpec,
} from '../shared/approval-helper.js';

export function deviceRoutes(db: Database) {
  const router = express.Router();

  const purgeExpiredLocks = () =>
    db.run("DELETE FROM edit_locks WHERE expires_at <= datetime('now')");

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
      sql += ' ORDER BY d.设备编号';

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
      const isDevMgr = !isAdmin && await isDeviceManager(db, username, project_id);
      const isZonti = !isAdmin && !isDevMgr && await isZontiRenyuan(db, username, project_id);

      if (!isAdmin && !isDevMgr && !isZonti) {
        return res.status(403).json({ error: '无权限，需要设备管理员或总体人员角色' });
      }

      // admin → 直接写入
      if (isAdmin) {
        const insertStatus = forceDraft ? 'Draft' : 'normal';
        const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
        const placeholders = Object.keys(fields).map(() => '?').join(', ');
        const result = await db.run(
          `INSERT INTO devices (project_id, status, ${cols}) VALUES (?, ?, ${placeholders})`,
          [project_id, insertStatus, ...Object.values(fields)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, '新增设备', 'approved')`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
        );
        return res.json({ success: true, id: result.lastID });
      }

      // forceDraft → 直接写入 Draft，无需审批
      if (forceDraft) {
        if (isDevMgr) fields['设备负责人'] = username;
        const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
        const placeholders = Object.keys(fields).map(() => '?').join(', ');
        const result = await db.run(
          `INSERT INTO devices (project_id, status, ${cols}) VALUES (?, 'Draft', ${placeholders})`,
          [project_id, ...Object.values(fields)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, '新增设备(Draft)', 'approved')`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
        );
        return res.json({ success: true, id: result.lastID });
      }

      // 设备管理员 / 总体人员 → 提交审批
      const zontiList = await getProjectRoleMembers(db, project_id, '总体人员');
      const items: ApprovalItemSpec[] = [];

      if (isDevMgr) {
        // 设备管理员：负责人强制为自己，所有总体人员发审批
        fields['设备负责人'] = username;
        zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));
      } else {
        // 总体人员：其他总体人员发审批，设备负责人发完善
        zontiList.filter(u => u !== username).forEach(u =>
          items.push({ recipient_username: u, item_type: 'approval' })
        );
        const owner = fields['设备负责人'];
        if (owner && owner !== username) {
          items.push({ recipient_username: owner, item_type: 'completion' });
        }
      }

      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const result = await db.run(
        `INSERT INTO devices (project_id, status, ${cols}) VALUES (?, 'Pending', ${placeholders})`,
        [project_id, ...Object.values(fields)]
      );

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

      return res.status(202).json({ pending: true, id: result.lastID, message: '已提交审批，等待审批通过' });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该项目中设备编号已存在' });
      }
      res.status(500).json({ error: error.message || '创建设备失败' });
    }
  });

  // POST /api/devices/:id/claim-management — 设备管理员申请无负责人设备的管理权
  router.post('/:id/claim-management', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return res.status(404).json({ error: '设备不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      if (role === 'admin') return res.status(403).json({ error: '管理员可直接分配设备负责人，无需申请' });

      const devMgr = await isDeviceManager(db, username, device.project_id);
      if (!devMgr) return res.status(403).json({ error: '仅设备管理员可申请管理权限' });

      if (device.设备负责人) return res.status(400).json({ error: '该设备已有负责人' });

      // 检查是否已有 pending 的管理权申请
      const existing = await db.get(
        `SELECT id FROM approval_requests
         WHERE entity_type = 'device' AND entity_id = ? AND action_type = 'request_device_management' AND status = 'pending'`,
        [deviceId]
      );
      if (existing) return res.status(400).json({ error: '该设备已有待审批的管理权申请' });

      const zontiList = await getProjectRoleMembers(db, device.project_id, '总体人员');
      if (zontiList.length === 0) return res.status(400).json({ error: '项目中暂无总体人员，无法提交审批' });

      const items: ApprovalItemSpec[] = zontiList.map(u => ({ recipient_username: u, item_type: 'approval' as const }));

      await submitChangeRequest(db, {
        projectId: device.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'request_device_management',
        entityType: 'device',
        entityId: deviceId,
        oldPayload: device,
        newPayload: { 设备负责人: username },
        items,
      });

      // 将设备状态改为 Pending（审批中）
      await db.run(`UPDATE devices SET status = 'Pending' WHERE id = ?`, [deviceId]);

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, reason, status)
         VALUES ('devices', ?, ?, 'devices', ?, ?, 'pending')`,
        [deviceId, deviceId, req.user!.id, `${username} 申请管理此设备，等待总体人员审批`]
      );

      return res.json({ success: true, message: '申请已提交，等待总体人员审批' });
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

      const username = req.user!.username;
      const role = req.user!.role;
      const isAdmin = role === 'admin';
      const isDevMgr = !isAdmin && await isDeviceManager(db, username, device.project_id);
      const isZonti = !isAdmin && !isDevMgr && await isZontiRenyuan(db, username, device.project_id);

      // 设备管理员只能编辑自己负责的设备
      if (isDevMgr && device.设备负责人 !== username) {
        return res.status(403).json({ error: '只能编辑自己负责的设备' });
      }

      if (!isAdmin && !isDevMgr && !isZonti) {
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

      // 去除 设备部件所属系统（4位ATA） 首尾各类引号（含中文弯引号）
      const ATA_KEY = '设备部件所属系统（4位ATA）';
      if (fields[ATA_KEY] != null) {
        fields[ATA_KEY] = String(fields[ATA_KEY])
          .trim()
          .replace(/^['"\u2018\u2019\u201C\u201D]+|['"\u2018\u2019\u201C\u201D]+$/g, '')
          .trim();
      }

      // admin → 直接更新（带校验）
      if (isAdmin) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        const values = [...Object.values(fields), deviceId, version ?? 1];
        const result = await db.run(
          `UPDATE devices SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          values
        );
        if (result.changes === 0) {
          return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        }
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, ?, '修改设备', 'approved')`,
          [deviceId, deviceId, req.user!.id, JSON.stringify(device), JSON.stringify(fields)]
        );

        const merged = { ...device, ...fields };
        const projectId = device.project_id;

        if (forceDraft) {
          await db.run(`UPDATE devices SET status = 'Draft' WHERE id = ?`, [deviceId]);
        } else {
          const veErrors: string[] = [];

          const adlMatch = await db.get(
            `SELECT 设备布置区域 FROM aircraft_device_list WHERE project_id = ? AND 电设备编号 = ? AND 设备编号_DOORS = ? AND LIN号_DOORS = ? AND object_text = ?`,
            [projectId,
             (merged['设备编号'] || '').trim(),
             (merged['设备编号（DOORS）'] || '').trim(),
             (merged['设备LIN号（DOORS）'] || '').trim(),
             (merged['设备中文名称'] || '').trim()]
          );
          if (!adlMatch) {
            veErrors.push('设备编号（DOORS）', '设备LIN号（DOORS）', '设备编号', '设备中文名称', '设备安装位置');
          } else {
            if ((adlMatch.设备布置区域 || '').trim() !== (merged['设备安装位置'] || '').trim()) {
              veErrors.push('设备安装位置');
            }
          }

          if (!['A', 'B', 'C', 'D', 'E', '其他'].includes((merged['设备DAL'] || '').trim())) {
            veErrors.push('设备DAL');
          }

          const ataVal = (merged['设备部件所属系统（4位ATA）'] || '').trim();
          if (!/^\d{2}-\d{2}$/.test(ataVal) && ataVal !== '其他') {
            veErrors.push('设备部件所属系统（4位ATA）');
          }

          const isMetalShell = (merged['设备壳体是否金属'] || '').trim();
          if (!['是', '否'].includes(isMetalShell)) veErrors.push('设备壳体是否金属');

          const shellTreated = (merged['金属壳体表面是否经过特殊处理而不易导电'] || '').trim();
          if (isMetalShell === '是' && !['是', '否'].includes(shellTreated)) {
            veErrors.push('金属壳体表面是否经过特殊处理而不易导电');
          } else if (isMetalShell === '否' && shellTreated !== 'N/A') {
            veErrors.push('金属壳体表面是否经过特殊处理而不易导电');
          }

          if (!['线搭接', '面搭接', '无'].includes((merged['设备壳体接地方式'] || '').trim())) {
            veErrors.push('设备壳体接地方式');
          }

          if (!['是', '否'].includes((merged['壳体接地是否故障电流路径'] || '').trim())) {
            veErrors.push('壳体接地是否故障电流路径');
          }

          await db.run(
            `UPDATE devices SET status = ?, validation_errors = ? WHERE id = ?`,
            [veErrors.length > 0 ? 'Draft' : 'normal', JSON.stringify(veErrors), deviceId]
          );
        }

        return res.json({ success: true });
      }

      // forceDraft → 直接更新，设为 Draft
      if (forceDraft) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        const vals = [...Object.values(fields), deviceId, version ?? 1];
        const r = await db.run(
          `UPDATE devices SET ${setClauses}, status = 'Draft', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          vals
        );
        if (r.changes === 0) {
          return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        }
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, ?, '修改设备(Draft)', 'approved')`,
          [deviceId, deviceId, req.user!.id, JSON.stringify(device), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // 若设备已 Pending 且当前用户有待完善项 → 执行完善（而非创建新审批）
      if (device.status === 'Pending') {
        const pendingCompletion = await db.get(
          `SELECT ai.id, ai.approval_request_id
           FROM approval_items ai
           JOIN approval_requests ar ON ai.approval_request_id = ar.id
           WHERE ar.entity_type = 'device' AND ar.entity_id = ? AND ar.status = 'pending'
             AND ai.recipient_username = ? AND ai.item_type = 'completion' AND ai.status = 'pending'`,
          [deviceId, username]
        );
        if (pendingCompletion) {
          // 应用字段变更
          const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
          await db.run(
            `UPDATE devices SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [...Object.values(fields), deviceId]
          );
          // 标记完善项为 done
          await db.run(
            `UPDATE approval_items SET status = 'done', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [pendingCompletion.id]
          );
          // 写 change_log
          await db.run(
            `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
             VALUES ('devices', ?, ?, 'devices', ?, ?, ?, 'approved')`,
            [deviceId, deviceId, req.user!.id, JSON.stringify(fields), `${username} 完善设备字段`]
          );
          // 推进审批流程
          await checkAndAdvancePhase(db, pendingCompletion.approval_request_id);
          return res.json({ success: true, message: '完善提交成功' });
        }

        // 若设备已 Pending 且当前用户有待审批项 → 执行审批通过（编辑并审批）
        const pendingApproval = await db.get(
          `SELECT ai.id, ai.approval_request_id
           FROM approval_items ai
           JOIN approval_requests ar ON ai.approval_request_id = ar.id
           WHERE ar.entity_type = 'device' AND ar.entity_id = ? AND ar.status = 'pending'
             AND ar.current_phase = 'approval'
             AND ai.recipient_username = ? AND ai.item_type = 'approval' AND ai.status = 'pending'`,
          [deviceId, username]
        );
        if (pendingApproval) {
          // 应用字段变更
          const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
          await db.run(
            `UPDATE devices SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [...Object.values(fields), deviceId]
          );
          // 标记审批项为 done
          await db.run(
            `UPDATE approval_items SET status = 'done', edited_payload = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [JSON.stringify(fields), pendingApproval.id]
          );
          // 写 change_log
          await db.run(
            `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
             VALUES ('devices', ?, ?, 'devices', ?, ?, ?, 'approved')`,
            [deviceId, deviceId, req.user!.id, JSON.stringify(fields), `${username} 编辑并审批通过`]
          );
          await checkAndAdvancePhase(db, pendingApproval.approval_request_id);
          return res.json({ success: true, message: '编辑并审批通过' });
        }
      }

      // 非 admin、非 forceDraft → 应用字段变更并提交审批
      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
      await db.run(
        `UPDATE devices SET ${setClauses}, status = 'Pending', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...Object.values(fields), deviceId]
      );

      const zontiList = await getProjectRoleMembers(db, device.project_id, '总体人员');
      const items: ApprovalItemSpec[] = [];

      if (isDevMgr) {
        zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));
      } else {
        // 总体人员：其他总体人员发审批，设备负责人发完善
        zontiList.filter(u => u !== username).forEach(u =>
          items.push({ recipient_username: u, item_type: 'approval' })
        );
        const owner = device.设备负责人;
        if (owner && owner !== username) {
          items.push({ recipient_username: owner, item_type: 'completion' });
        }
      }

      await submitChangeRequest(db, {
        projectId: device.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'edit_device',
        entityType: 'device',
        entityId: deviceId,
        oldPayload: device,
        newPayload: fields,
        items,
      });

      return res.status(202).json({ pending: true, message: '已提交审批，等待审批通过' });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该项目中设备编号已存在' });
      }
      res.status(500).json({ error: error.message || '更新设备失败' });
    }
  });

  // 清空项目下全部设备（仅 admin，调试用）
  router.delete('/project/:projectId/all', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const { changes } = await db.run('DELETE FROM devices WHERE project_id = ?', [projectId]);
      res.json({ deleted: changes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/devices/:id
  router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return res.status(404).json({ error: '设备不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      // admin → 直接删除
      if (role === 'admin') {
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, '删除设备', 'approved')`,
          [deviceId, deviceId, req.user!.id, JSON.stringify(device)]
        );
        await db.run('DELETE FROM devices WHERE id = ?', [deviceId]);
        return res.json({ success: true });
      }

      const isDevMgr = await isDeviceManager(db, username, device.project_id);
      const isZonti = !isDevMgr && await isZontiRenyuan(db, username, device.project_id);

      if (!isDevMgr && !isZonti) {
        return res.status(403).json({ error: '无权限删除此设备' });
      }
      if (isDevMgr && device.设备负责人 !== username) {
        return res.status(403).json({ error: '只能删除自己负责的设备' });
      }

      const zontiList = await getProjectRoleMembers(db, device.project_id, '总体人员');
      const items: ApprovalItemSpec[] = [];

      if (isDevMgr) {
        zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));
      } else {
        // 总体人员：其他总体人员+设备负责人发审批
        zontiList.filter(u => u !== username).forEach(u =>
          items.push({ recipient_username: u, item_type: 'approval' })
        );
        const owner = device.设备负责人;
        if (owner && owner !== username) {
          items.push({ recipient_username: owner, item_type: 'approval' });
        }
      }

      await db.run(
        `UPDATE devices SET status = 'Pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [deviceId]
      );

      await submitChangeRequest(db, {
        projectId: device.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'delete_device',
        entityType: 'device',
        entityId: deviceId,
        oldPayload: device,
        newPayload: {},
        items,
      });

      return res.status(202).json({ pending: true, message: '删除请求已提交，等待审批' });
    } catch (error: any) {
      if (error.message?.includes('FOREIGN KEY')) {
        return res.status(409).json({ error: '设备仍有关联的信号端点，无法删除' });
      }
      res.status(500).json({ error: error.message || '删除设备失败' });
    }
  });

  // ── 连接器 CRUD ───────────────────────────────────────────

  // GET /api/devices/:devId/connectors
  router.get('/:devId/connectors', authenticate, async (req, res) => {
    try {
      const connectors = await db.query(
        `SELECT c.*,
                (SELECT COUNT(*) FROM pins p WHERE p.connector_id = c.id) as pin_count
         FROM connectors c WHERE c.device_id = ? ORDER BY c."设备端元器件编号"`,
        [req.params.devId]
      );
      res.json({ connectors });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取连接器失败' });
    }
  });

  // POST /api/devices/:devId/connectors
  router.post('/:devId/connectors', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.devId);
      const fields: Record<string, any> = { ...req.body };
      if (!fields['设备端元器件编号']) return res.status(400).json({ error: '缺少设备端元器件编号' });

      const username = req.user!.username;
      const role = req.user!.role;
      const devRow = await db.get('SELECT 设备负责人, project_id FROM devices WHERE id = ?', [deviceId]);
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      const isDevMgr = !isAdmin && await isDeviceManager(db, username, devRow.project_id);
      const isZonti = !isAdmin && !isDevMgr && await isZontiRenyuan(db, username, devRow.project_id);

      if (!isAdmin && !isDevMgr && !isZonti) {
        return res.status(403).json({ error: '无权限，需要设备管理员或总体人员角色' });
      }

      // 项目级 设备端元器件编号 唯一性校验
      const compId = fields['设备端元器件编号'];
      const dup = await db.get(
        `SELECT c.id FROM connectors c JOIN devices d ON c.device_id = d.id WHERE d.project_id = ? AND c."设备端元器件编号" = ?`,
        [devRow.project_id, compId]
      );
      if (dup) return res.status(409).json({ error: `设备端元器件编号"${compId}"在本项目中已存在` });

      // admin → 直接写入
      if (isAdmin) {
        const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
        const placeholders = Object.keys(fields).map(() => '?').join(', ');
        const result = await db.run(
          `INSERT INTO connectors (device_id, ${cols}) VALUES (?, ${placeholders})`,
          [deviceId, ...Object.values(fields)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, '新增连接器', 'approved')`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
        );
        return res.json({ success: true, id: result.lastID });
      }

      // 非 admin → 提交审批
      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体人员');
      const items: ApprovalItemSpec[] = [];

      if (isDevMgr) {
        zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));
      } else {
        // 总体人员：其他总体人员+设备负责人发审批
        zontiList.filter(u => u !== username).forEach(u =>
          items.push({ recipient_username: u, item_type: 'approval' })
        );
        const owner = devRow.设备负责人;
        if (owner && owner !== username) {
          items.push({ recipient_username: owner, item_type: 'approval' });
        }
      }

      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const result = await db.run(
        `INSERT INTO connectors (device_id, status, ${cols}) VALUES (?, 'Pending', ${placeholders})`,
        [deviceId, ...Object.values(fields)]
      );

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

      return res.status(202).json({ pending: true, id: result.lastID, message: '已提交审批，等待审批通过' });
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
      const devRow = await db.get('SELECT 设备负责人, project_id FROM devices WHERE id = ?', [req.params.devId]);
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      const isDevMgr = !isAdmin && await isDeviceManager(db, username, devRow.project_id);
      const isZonti = !isAdmin && !isDevMgr && await isZontiRenyuan(db, username, devRow.project_id);

      if (!isAdmin && !isDevMgr && !isZonti) {
        return res.status(403).json({ error: '无权限修改连接器' });
      }

      const { version, ...fields } = req.body;
      delete fields.id; delete fields.device_id; delete fields.created_at; delete fields.pin_count;

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
        const result = await db.run(
          `UPDATE connectors SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), connectorId, version ?? 1]
        );
        if (result.changes === 0) {
          return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        }
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, ?, '修改连接器', 'approved')`,
          [connectorId, connectorId, req.user!.id, JSON.stringify(oldConnector), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // 非 admin → 应用字段变更并提交审批
      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
      await db.run(
        `UPDATE connectors SET ${setClauses}, status = 'Pending', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...Object.values(fields), connectorId]
      );

      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体人员');
      const items: ApprovalItemSpec[] = [];

      if (isDevMgr) {
        zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));
      } else {
        zontiList.filter(u => u !== username).forEach(u =>
          items.push({ recipient_username: u, item_type: 'approval' })
        );
        const owner = devRow.设备负责人;
        if (owner && owner !== username) {
          items.push({ recipient_username: owner, item_type: 'approval' });
        }
      }

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

      return res.status(202).json({ pending: true, message: '已提交审批，等待审批通过' });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该设备中设备端元器件编号已存在' });
      }
      res.status(500).json({ error: error.message || '更新连接器失败' });
    }
  });

  // DELETE /api/devices/:devId/connectors/:id
  router.delete('/:devId/connectors/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const connectorId = parseInt(req.params.id);
      const username = req.user!.username;
      const role = req.user!.role;

      // admin → 直接删除
      if (role === 'admin') {
        const connToDelete = await db.get('SELECT * FROM connectors WHERE id = ? AND device_id = ?', [req.params.id, req.params.devId]);
        if (connToDelete) {
          await db.run(
            `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
             VALUES ('connectors', ?, ?, 'connectors', ?, ?, '删除连接器', 'approved')`,
            [connToDelete.id, connToDelete.id, req.user!.id, JSON.stringify(connToDelete)]
          );
        }
        await db.run('DELETE FROM connectors WHERE id = ? AND device_id = ?', [req.params.id, req.params.devId]);
        return res.json({ success: true });
      }

      const devRow = await db.get('SELECT 设备负责人, project_id FROM devices WHERE id = ?', [req.params.devId]);
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isDevMgr = await isDeviceManager(db, username, devRow.project_id);
      const isZonti = !isDevMgr && await isZontiRenyuan(db, username, devRow.project_id);

      if (!isDevMgr && !isZonti) {
        return res.status(403).json({ error: '无权限删除连接器' });
      }

      const connToDelete = await db.get('SELECT * FROM connectors WHERE id = ? AND device_id = ?', [connectorId, req.params.devId]);
      if (!connToDelete) return res.status(404).json({ error: '连接器不存在' });

      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体人员');
      const items: ApprovalItemSpec[] = [];

      if (isDevMgr) {
        zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));
      } else {
        zontiList.filter(u => u !== username).forEach(u =>
          items.push({ recipient_username: u, item_type: 'approval' })
        );
        const owner = devRow.设备负责人;
        if (owner && owner !== username) {
          items.push({ recipient_username: owner, item_type: 'approval' });
        }
      }

      await db.run(
        `UPDATE connectors SET status = 'Pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [connectorId]
      );

      await submitChangeRequest(db, {
        projectId: devRow.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'delete_connector',
        entityType: 'connector',
        entityId: connectorId,
        deviceId: parseInt(req.params.devId),
        oldPayload: connToDelete,
        newPayload: {},
        items,
      });

      return res.status(202).json({ pending: true, message: '删除连接器请求已提交，等待审批' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除连接器失败' });
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
      const { 针孔号, ...rest } = req.body;
      if (!针孔号) return res.status(400).json({ error: '缺少针孔号' });

      const username = req.user!.username;
      const role = req.user!.role;
      const devRow = await db.get(
        'SELECT d.设备负责人, d.project_id FROM devices d JOIN connectors c ON c.device_id = d.id WHERE c.id = ?',
        [connectorId]
      );
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      const isDevMgr = !isAdmin && await isDeviceManager(db, username, devRow.project_id);
      const isZonti = !isAdmin && !isDevMgr && await isZontiRenyuan(db, username, devRow.project_id);

      if (!isAdmin && !isDevMgr && !isZonti) {
        return res.status(403).json({ error: '无权限，需要设备管理员或总体人员角色' });
      }

      const fields: Record<string, any> = { 针孔号, ...rest };
      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');

      // admin → 直接写入
      if (isAdmin) {
        const result = await db.run(
          `INSERT INTO pins (connector_id, ${cols}) VALUES (?, ${placeholders})`,
          [connectorId, ...Object.values(fields)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('pins', ?, ?, 'pins', ?, ?, '新增针孔', 'approved')`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
        );
        return res.json({ success: true, id: result.lastID });
      }

      // 非 admin → 提交审批
      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体人员');
      const items: ApprovalItemSpec[] = [];

      if (isDevMgr) {
        zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));
      } else {
        zontiList.filter(u => u !== username).forEach(u =>
          items.push({ recipient_username: u, item_type: 'approval' })
        );
        const owner = devRow.设备负责人;
        if (owner && owner !== username) {
          items.push({ recipient_username: owner, item_type: 'approval' });
        }
      }

      const result = await db.run(
        `INSERT INTO pins (connector_id, status, ${cols}) VALUES (?, 'Pending', ${placeholders})`,
        [connectorId, ...Object.values(fields)]
      );

      await submitChangeRequest(db, {
        projectId: devRow.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'create_pin',
        entityType: 'pin',
        entityId: result.lastID,
        deviceId: parseInt(req.params.devId),
        oldPayload: {},
        newPayload: fields,
        items,
      });

      return res.status(202).json({ pending: true, id: result.lastID, message: '已提交审批，等待审批通过' });
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
        'SELECT d.设备负责人, d.project_id FROM devices d JOIN connectors c ON c.device_id = d.id WHERE c.id = ?',
        [req.params.connId]
      );
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isAdmin = role === 'admin';
      const isDevMgr = !isAdmin && await isDeviceManager(db, username, devRow.project_id);
      const isZonti = !isAdmin && !isDevMgr && await isZontiRenyuan(db, username, devRow.project_id);

      if (!isAdmin && !isDevMgr && !isZonti) {
        return res.status(403).json({ error: '无权限修改针孔' });
      }

      const { version, ...fields } = req.body;
      delete fields.id; delete fields.connector_id; delete fields.created_at;

      const oldPin = await db.get('SELECT * FROM pins WHERE id = ?', [pinId]);

      // admin → 直接更新
      if (isAdmin) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        const result = await db.run(
          `UPDATE pins SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), pinId, version ?? 1]
        );
        if (result.changes === 0) {
          return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        }
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('pins', ?, ?, 'pins', ?, ?, ?, '修改针孔', 'approved')`,
          [pinId, pinId, req.user!.id, JSON.stringify(oldPin), JSON.stringify(fields)]
        );
        return res.json({ success: true });
      }

      // 非 admin → 应用字段变更并提交审批
      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
      await db.run(
        `UPDATE pins SET ${setClauses}, status = 'Pending', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...Object.values(fields), pinId]
      );

      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体人员');
      const items: ApprovalItemSpec[] = [];

      if (isDevMgr) {
        zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));
      } else {
        zontiList.filter(u => u !== username).forEach(u =>
          items.push({ recipient_username: u, item_type: 'approval' })
        );
        const owner = devRow.设备负责人;
        if (owner && owner !== username) {
          items.push({ recipient_username: owner, item_type: 'approval' });
        }
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

      return res.status(202).json({ pending: true, message: '已提交审批，等待审批通过' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '更新针孔失败' });
    }
  });

  // DELETE /api/devices/:devId/connectors/:connId/pins/:id
  router.delete('/:devId/connectors/:connId/pins/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const pinId = parseInt(req.params.id);
      const username = req.user!.username;
      const role = req.user!.role;

      // admin → 直接删除
      if (role === 'admin') {
        const pinToDelete = await db.get('SELECT * FROM pins WHERE id = ? AND connector_id = ?', [req.params.id, req.params.connId]);
        if (pinToDelete) {
          await db.run(
            `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
             VALUES ('pins', ?, ?, 'pins', ?, ?, '删除针孔', 'approved')`,
            [pinToDelete.id, pinToDelete.id, req.user!.id, JSON.stringify(pinToDelete)]
          );
        }
        await db.run('DELETE FROM pins WHERE id = ? AND connector_id = ?', [req.params.id, req.params.connId]);
        return res.json({ success: true });
      }

      const devRow = await db.get(
        'SELECT d.设备负责人, d.project_id FROM devices d JOIN connectors c ON c.device_id = d.id WHERE c.id = ?',
        [req.params.connId]
      );
      if (!devRow) return res.status(404).json({ error: '设备不存在' });

      const isDevMgr = await isDeviceManager(db, username, devRow.project_id);
      const isZonti = !isDevMgr && await isZontiRenyuan(db, username, devRow.project_id);

      if (!isDevMgr && !isZonti) {
        return res.status(403).json({ error: '无权限删除针孔' });
      }

      const pinToDelete = await db.get('SELECT * FROM pins WHERE id = ? AND connector_id = ?', [pinId, req.params.connId]);
      if (!pinToDelete) return res.status(404).json({ error: '针孔不存在' });

      const zontiList = await getProjectRoleMembers(db, devRow.project_id, '总体人员');
      const items: ApprovalItemSpec[] = [];

      if (isDevMgr) {
        zontiList.forEach(u => items.push({ recipient_username: u, item_type: 'approval' }));
      } else {
        zontiList.filter(u => u !== username).forEach(u =>
          items.push({ recipient_username: u, item_type: 'approval' })
        );
        const owner = devRow.设备负责人;
        if (owner && owner !== username) {
          items.push({ recipient_username: owner, item_type: 'approval' });
        }
      }

      await db.run(
        `UPDATE pins SET status = 'Pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [pinId]
      );

      await submitChangeRequest(db, {
        projectId: devRow.project_id,
        requesterId: req.user!.id,
        requesterUsername: username,
        actionType: 'delete_pin',
        entityType: 'pin',
        entityId: pinId,
        deviceId: parseInt(req.params.devId),
        oldPayload: pinToDelete,
        newPayload: {},
        items,
      });

      return res.status(202).json({ pending: true, message: '删除针孔请求已提交，等待审批' });
    } catch (error: any) {
      if (error.message?.includes('FOREIGN KEY')) {
        return res.status(409).json({ error: '该针孔已被信号端点引用，无法删除' });
      }
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
