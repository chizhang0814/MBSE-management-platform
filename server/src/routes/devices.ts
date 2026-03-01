import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';

/** 检查用户是否为指定项目的设备管理员 */
async function isDeviceManager(db: Database, username: string, projectId: number): Promise<boolean> {
  const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
  const perms: Array<{ project_name: string; project_role: string }> = userRow?.permissions
    ? JSON.parse(userRow.permissions)
    : [];
  const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!projectRow) return false;
  return perms.some(p => p.project_name === projectRow.name && p.project_role === '设备管理员');
}

/** 检查用户是否为指定项目的项目管理员 */
async function isProjectAdmin(db: Database, username: string, projectId: number): Promise<boolean> {
  const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
  const perms: Array<{ project_name: string; project_role: string }> = userRow?.permissions
    ? JSON.parse(userRow.permissions)
    : [];
  const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!projectRow) return false;
  return perms.some(p => p.project_name === projectRow.name && p.project_role === '项目管理员');
}

/** 提交审批请求（设备管理员操作时调用） */
async function submitApproval(
  db: Database,
  requesterId: number,
  requesterUsername: string,
  projectId: number,
  actionType: string,
  entityType: string,
  entityId: number | null,
  deviceId: number | null,
  payload: Record<string, any>
): Promise<void> {
  await db.run(
    `INSERT INTO approval_requests
      (project_id, requester_id, requester_username, action_type, entity_type, entity_id, device_id, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectId, requesterId, requesterUsername, actionType, entityType, entityId, deviceId, JSON.stringify(payload)]
  );
}

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

      if (myDevices || (userRole === 'user' && !hasProjectPermission)) {
        sql += ' AND d.设备负责人 = ?';
        params.push(username);
      }
      sql += ' ORDER BY d.设备编号';

      const devices = await db.query(sql, params);

      // 按状态统计设备/连接器/针孔数量
      const deviceIds: number[] = devices.map((d: any) => d.id);
      const statusSummary = { devices: { normal: 0, Draft: 0 }, connectors: { normal: 0, Draft: 0 }, pins: { normal: 0, Draft: 0 } };
      for (const d of devices) {
        statusSummary.devices[d.status === 'Draft' ? 'Draft' : 'normal']++;
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
      if (isNaN(projectId) || !q) return res.json({ devices: [] });

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

      const pattern = `%${q}%`;
      let sql = `
        SELECT d.*
        FROM devices d
        WHERE d.project_id = ?
          AND (d.设备编号 LIKE ? OR d.设备中文名称 LIKE ? OR d.设备英文名称 LIKE ? OR d.设备英文缩写 LIKE ?)
      `;
      const params: any[] = [projectId, pattern, pattern, pattern, pattern];

      if (myDevices || (userRole === 'user' && !hasProjectPermission)) {
        sql += ' AND d.设备负责人 = ?';
        params.push(username);
      }
      sql += ' ORDER BY d.设备编号 LIMIT 20';

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
        'SELECT c.*, (SELECT COUNT(*) FROM pins p WHERE p.connector_id = c.id) as pin_count FROM connectors c WHERE c.device_id = ? ORDER BY c.连接器号',
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

  // POST /api/devices
  router.post('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const { project_id, forceDraft, ...fields } = req.body;
      if (!project_id || !fields['设备编号']) {
        return res.status(400).json({ error: '缺少必填字段: project_id, 设备编号' });
      }

      const username = req.user!.username;
      const role = req.user!.role;

      if (role !== 'admin' && !(await isProjectAdmin(db, username, project_id)) &&
          !(await isDeviceManager(db, username, project_id))) {
        return res.status(403).json({ error: '无权限，需要设备管理员角色' });
      }

      // 非管理员强制将设备负责人设为创建人
      if (role !== 'admin') {
        fields['设备负责人'] = username;
      }

      // 设备管理员 → 直接入库（Draft 或 Pending），不再延迟到审批通过后
      if (role !== 'admin' && !(await isProjectAdmin(db, username, project_id))) {
        const status = forceDraft ? 'Draft' : 'Pending';
        const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
        const placeholders = Object.keys(fields).map(() => '?').join(', ');
        const result = await db.run(
          `INSERT INTO devices (project_id, status, ${cols}) VALUES (?, ?, ${placeholders})`,
          [project_id, status, ...Object.values(fields)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, ?, 'approved')`,
          [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields),
           forceDraft ? '新增设备(Draft)' : '新增设备(待审批)']
        );
        if (!forceDraft) {
          await submitApproval(db, req.user!.id, username, project_id,
            'create_device', 'device', result.lastID, null, fields);
          return res.status(202).json({ pending: true, id: result.lastID, message: '已提交审批，等待项目管理员审核' });
        }
        return res.json({ success: true, id: result.lastID });
      }

      // admin / 项目管理员 → 直接写入
      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const values = Object.values(fields);
      const insertStatus = forceDraft ? 'Draft' : 'normal';

      const result = await db.run(
        `INSERT INTO devices (project_id, status, ${cols}) VALUES (?, ?, ${placeholders})`,
        [project_id, insertStatus, ...values]
      );

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES ('devices', ?, ?, 'devices', ?, ?, '新增设备', 'approved')`,
        [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
      );

      res.json({ success: true, id: result.lastID });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该项目中设备编号已存在' });
      }
      res.status(500).json({ error: error.message || '创建设备失败' });
    }
  });

  // PUT /api/devices/:id
  router.put('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return res.status(404).json({ error: '设备不存在' });

      // 权限检查
      const username = req.user!.username;
      const role = req.user!.role;
      if (role !== 'admin' && device.设备负责人 !== username &&
          !(await isProjectAdmin(db, username, device.project_id))) {
        return res.status(403).json({ error: '无权限修改此设备' });
      }

      const { version, forceDraft, ...fields } = req.body;
      delete fields.id; delete fields.project_id; delete fields.created_at;
      delete fields.connector_count; // 计算字段，非真实列

      // 去除 设备部件所属系统（4位ATA） 首尾各类引号（含中文弯引号 U+2018/2019/201C/201D）
      const ATA_KEY = '设备部件所属系统（4位ATA）';
      if (fields[ATA_KEY] != null) {
        fields[ATA_KEY] = String(fields[ATA_KEY])
          .trim()
          .replace(/^['"\u2018\u2019\u201C\u201D]+|['"\u2018\u2019\u201C\u201D]+$/g, '')
          .trim();
      }

      // 设备管理员（设备负责人）
      if (role !== 'admin' && !(await isProjectAdmin(db, username, device.project_id))) {
        if (forceDraft) {
          // forceDraft → 直接更新，设为 Draft，无需审批
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
        // 非 forceDraft → 提交审批
        await submitApproval(db, req.user!.id, username, device.project_id,
          'edit_device', 'device', deviceId, null, fields);
        return res.status(202).json({ pending: true, message: '已提交审批，等待项目管理员审核' });
      }

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

      // ── 校验 a-h ─────────────────────────────────────────────
      const merged = { ...device, ...fields };
      const projectId = device.project_id;

      if (forceDraft) {
        await db.run(`UPDATE devices SET status = 'Draft' WHERE id = ?`, [deviceId]);
      } else {
        const veErrors: string[] = [];

        // a) aircraft_device_list 四列精确匹配
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
          // b) 设备安装位置 vs aircraft_device_list.设备布置区域
          if ((adlMatch.设备布置区域 || '').trim() !== (merged['设备安装位置'] || '').trim()) {
            veErrors.push('设备安装位置');
          }
        }

        // c) 设备DAL
        if (!['A', 'B', 'C', 'D', 'E', '其他'].includes((merged['设备DAL'] || '').trim())) {
          veErrors.push('设备DAL');
        }

        // d) 设备部件所属系统（4位ATA）
        const ataVal = (merged['设备部件所属系统（4位ATA）'] || '').trim();
        if (!/^\d{2}-\d{2}$/.test(ataVal) && ataVal !== '其他') {
          veErrors.push('设备部件所属系统（4位ATA）');
        }

        // e) 设备壳体是否金属
        const isMetalShell = (merged['设备壳体是否金属'] || '').trim();
        if (!['是', '否'].includes(isMetalShell)) veErrors.push('设备壳体是否金属');

        // f) 金属壳体表面处理
        const shellTreated = (merged['金属壳体表面是否经过特殊处理而不易导电'] || '').trim();
        if (isMetalShell === '是' && !['是', '否'].includes(shellTreated)) {
          veErrors.push('金属壳体表面是否经过特殊处理而不易导电');
        } else if (isMetalShell === '否' && shellTreated !== 'N/A') {
          veErrors.push('金属壳体表面是否经过特殊处理而不易导电');
        }

        // g) 设备壳体接地方式
        if (!['线搭接', '面搭接', '无'].includes((merged['设备壳体接地方式'] || '').trim())) {
          veErrors.push('设备壳体接地方式');
        }

        // h) 壳体接地是否故障电流路径
        if (!['是', '否'].includes((merged['壳体接地是否故障电流路径'] || '').trim())) {
          veErrors.push('壳体接地是否故障电流路径');
        }

        await db.run(
          `UPDATE devices SET status = ?, validation_errors = ? WHERE id = ?`,
          [veErrors.length > 0 ? 'Draft' : 'normal', JSON.stringify(veErrors), deviceId]
        );
      }

      res.json({ success: true });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该项目中设备编号已存在' });
      }
      res.status(500).json({ error: error.message || '更新设备失败' });
    }
  });

  // DELETE /api/devices/:id
  // 清空项目下全部设备（仅 admin，临时调试用）
  router.delete('/project/:projectId/all', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const { changes } = await db.run('DELETE FROM devices WHERE project_id = ?', [projectId]);
      res.json({ deleted: changes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return res.status(404).json({ error: '设备不存在' });

      if (req.user!.role !== 'admin' && device.设备负责人 !== req.user!.username) {
        return res.status(403).json({ error: '只能删除自己负责的设备' });
      }

      // 记录删除日志
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
         VALUES ('devices', ?, ?, 'devices', ?, ?, '删除设备', 'approved')`,
        [deviceId, deviceId, req.user!.id, JSON.stringify(device)]
      );

      await db.run('DELETE FROM devices WHERE id = ?', [deviceId]);
      res.json({ success: true });
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
         FROM connectors c WHERE c.device_id = ? ORDER BY c.连接器号`,
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
      const { 连接器号, ...rest } = req.body;
      if (!连接器号) return res.status(400).json({ error: '缺少连接器号' });

      const connUsername = req.user!.username;
      const connRole = req.user!.role;
      const devRow = await db.get('SELECT 设备负责人, project_id FROM devices WHERE id = ?', [deviceId]);

      if (connRole !== 'admin') {
        if (!devRow || devRow.设备负责人 !== connUsername) {
          // 检查是否为项目管理员
          if (!devRow || !(await isProjectAdmin(db, connUsername, devRow.project_id))) {
            return res.status(403).json({ error: '只有该设备的负责人或项目管理员才能新增连接器' });
          }
        }
      }

      // 项目级 设备端元器件编号 唯一性校验
      const compId = rest['设备端元器件编号'];
      if (compId) {
        const dup = await db.get(
          `SELECT c.id FROM connectors c
           JOIN devices d ON c.device_id = d.id
           WHERE d.project_id = ? AND c."设备端元器件编号" = ?`,
          [devRow?.project_id, compId]
        );
        if (dup) return res.status(409).json({ error: `设备端元器件编号"${compId}"在本项目中已存在` });
      }

      const fields: Record<string, any> = { 连接器号, ...rest };

      // 设备负责人（设备管理员）→ 提交审批
      if (connRole !== 'admin' && devRow && !(await isProjectAdmin(db, connUsername, devRow.project_id))) {
        await submitApproval(db, req.user!.id, connUsername, devRow.project_id,
          'create_connector', 'connector', null, deviceId, fields);
        return res.status(202).json({ pending: true, message: '已提交审批，等待项目管理员审核' });
      }

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

      res.json({ success: true, id: result.lastID });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该设备中连接器号已存在' });
      }
      res.status(500).json({ error: error.message || '创建连接器失败' });
    }
  });

  // PUT /api/devices/:devId/connectors/:id
  router.put('/:devId/connectors/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const connectorId = parseInt(req.params.id);

      const putConnUsername = req.user!.username;
      const putConnRole = req.user!.role;
      const putDevRow = await db.get('SELECT 设备负责人, project_id FROM devices WHERE id = ?', [req.params.devId]);

      if (putConnRole !== 'admin') {
        if (!putDevRow || putDevRow.设备负责人 !== putConnUsername) {
          if (!putDevRow || !(await isProjectAdmin(db, putConnUsername, putDevRow.project_id))) {
            return res.status(403).json({ error: '只有该设备的负责人或项目管理员才能修改连接器' });
          }
        }
      }

      const { version, ...fields } = req.body;
      delete fields.id; delete fields.device_id; delete fields.created_at;
      delete fields.pin_count; // 计算字段，非真实列

      // 项目级 设备端元器件编号 唯一性校验（排除自身）
      const compId = fields['设备端元器件编号'];
      if (compId) {
        const dup = await db.get(
          `SELECT c.id FROM connectors c
           JOIN devices d ON c.device_id = d.id
           WHERE d.project_id = ? AND c."设备端元器件编号" = ? AND c.id != ?`,
          [putDevRow?.project_id, compId, connectorId]
        );
        if (dup) return res.status(409).json({ error: `设备端元器件编号"${compId}"在本项目中已存在` });
      }

      // 设备负责人（设备管理员）→ 提交审批
      if (putConnRole !== 'admin' && putDevRow && !(await isProjectAdmin(db, putConnUsername, putDevRow.project_id))) {
        await submitApproval(db, req.user!.id, putConnUsername, putDevRow.project_id,
          'edit_connector', 'connector', connectorId, parseInt(req.params.devId), fields);
        return res.status(202).json({ pending: true, message: '已提交审批，等待项目管理员审核' });
      }

      const oldConnector = await db.get('SELECT * FROM connectors WHERE id = ?', [connectorId]);

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

      res.json({ success: true });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该设备中连接器号已存在' });
      }
      res.status(500).json({ error: error.message || '更新连接器失败' });
    }
  });

  // DELETE /api/devices/:devId/connectors/:id
  router.delete('/:devId/connectors/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      if (req.user!.role !== 'admin') {
        const device = await db.get('SELECT 设备负责人 FROM devices WHERE id = ?', [req.params.devId]);
        if (!device || device.设备负责人 !== req.user!.username) {
          return res.status(403).json({ error: '只有该设备的负责人才能删除连接器' });
        }
      }

      const connToDelete = await db.get('SELECT * FROM connectors WHERE id = ? AND device_id = ?', [req.params.id, req.params.devId]);
      if (connToDelete) {
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, '删除连接器', 'approved')`,
          [connToDelete.id, connToDelete.id, req.user!.id, JSON.stringify(connToDelete)]
        );
      }

      await db.run('DELETE FROM connectors WHERE id = ? AND device_id = ?', [req.params.id, req.params.devId]);
      res.json({ success: true });
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

      if (req.user!.role !== 'admin') {
        const device = await db.get(
          'SELECT d.设备负责人 FROM devices d JOIN connectors c ON c.device_id = d.id WHERE c.id = ?',
          [connectorId]
        );
        if (!device || device.设备负责人 !== req.user!.username) {
          return res.status(403).json({ error: '只有该设备的负责人才能新增针孔' });
        }
      }

      const fields: Record<string, any> = { 针孔号, ...rest };
      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');

      const result = await db.run(
        `INSERT INTO pins (connector_id, ${cols}) VALUES (?, ${placeholders})`,
        [connectorId, ...Object.values(fields)]
      );

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES ('pins', ?, ?, 'pins', ?, ?, '新增针孔', 'approved')`,
        [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
      );

      res.json({ success: true, id: result.lastID });
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

      if (req.user!.role !== 'admin') {
        const device = await db.get(
          'SELECT d.设备负责人 FROM devices d JOIN connectors c ON c.device_id = d.id WHERE c.id = ?',
          [req.params.connId]
        );
        if (!device || device.设备负责人 !== req.user!.username) {
          return res.status(403).json({ error: '只有该设备的负责人才能修改针孔' });
        }
      }

      const { version, ...fields } = req.body;
      delete fields.id; delete fields.connector_id; delete fields.created_at;

      const oldPin = await db.get('SELECT * FROM pins WHERE id = ?', [pinId]);

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

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '更新针孔失败' });
    }
  });

  // DELETE /api/devices/:devId/connectors/:connId/pins/:id
  router.delete('/:devId/connectors/:connId/pins/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      if (req.user!.role !== 'admin') {
        const device = await db.get(
          'SELECT d.设备负责人 FROM devices d JOIN connectors c ON c.device_id = d.id WHERE c.id = ?',
          [req.params.connId]
        );
        if (!device || device.设备负责人 !== req.user!.username) {
          return res.status(403).json({ error: '只有该设备的负责人才能删除针孔' });
        }
      }

      const pinToDelete = await db.get('SELECT * FROM pins WHERE id = ? AND connector_id = ?', [req.params.id, req.params.connId]);
      if (pinToDelete) {
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
           VALUES ('pins', ?, ?, 'pins', ?, ?, '删除针孔', 'approved')`,
          [pinToDelete.id, pinToDelete.id, req.user!.id, JSON.stringify(pinToDelete)]
        );
      }

      await db.run('DELETE FROM pins WHERE id = ? AND connector_id = ?', [req.params.id, req.params.connId]);
      res.json({ success: true });
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
