import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';

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

      let sql = `
        SELECT d.*,
               (SELECT COUNT(*) FROM connectors c WHERE c.device_id = d.id) as connector_count
        FROM devices d
        WHERE d.project_id = ?
      `;
      const params: any[] = [projectId];

      if (myDevices || userRole === 'user') {
        sql += ' AND d.设备负责人 = ?';
        params.push(username);
      }
      sql += ' ORDER BY d.设备编号';

      const devices = await db.query(sql, params);
      res.json({ devices });
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

      const pattern = `%${q}%`;
      let sql = `
        SELECT d.*
        FROM devices d
        WHERE d.project_id = ?
          AND (d.设备编号 LIKE ? OR d.设备中文名称 LIKE ? OR d.设备英文名称 LIKE ? OR d.设备英文缩写 LIKE ?)
      `;
      const params: any[] = [projectId, pattern, pattern, pattern, pattern];

      if (myDevices || userRole === 'user') {
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

  // POST /api/devices
  router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { project_id, ...fields } = req.body;
      if (!project_id || !fields['设备编号']) {
        return res.status(400).json({ error: '缺少必填字段: project_id, 设备编号' });
      }

      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const values = Object.values(fields);

      const result = await db.run(
        `INSERT INTO devices (project_id, ${cols}) VALUES (?, ${placeholders})`,
        [project_id, ...values]
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

      // 权限检查：普通用户只能修改自己负责的设备
      if (req.user!.role !== 'admin' && device.设备负责人 !== req.user!.username) {
        return res.status(403).json({ error: '无权限修改此设备' });
      }

      const { version, ...fields } = req.body;
      delete fields.id; delete fields.project_id; delete fields.created_at;
      delete fields.connector_count; // 计算字段，非真实列

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

      res.json({ success: true });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '设备编号已存在' });
      }
      res.status(500).json({ error: error.message || '更新设备失败' });
    }
  });

  // DELETE /api/devices/:id
  router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return res.status(404).json({ error: '设备不存在' });

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
  router.post('/:devId/connectors', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const deviceId = parseInt(req.params.devId);
      const { 连接器号, ...rest } = req.body;
      if (!连接器号) return res.status(400).json({ error: '缺少连接器号' });

      const fields: Record<string, any> = { 连接器号, ...rest };
      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');

      const result = await db.run(
        `INSERT INTO connectors (device_id, ${cols}) VALUES (?, ${placeholders})`,
        [deviceId, ...Object.values(fields)]
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
  router.put('/:devId/connectors/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const connectorId = parseInt(req.params.id);
      const { version, ...fields } = req.body;
      delete fields.id; delete fields.device_id; delete fields.created_at;
      delete fields.pin_count; // 计算字段，非真实列

      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
      const result = await db.run(
        `UPDATE connectors SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
        [...Object.values(fields), connectorId, version ?? 1]
      );
      if (result.changes === 0) {
        return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '更新连接器失败' });
    }
  });

  // DELETE /api/devices/:devId/connectors/:id
  router.delete('/:devId/connectors/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
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
  router.post('/:devId/connectors/:connId/pins', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const connectorId = parseInt(req.params.connId);
      const { 针孔号, ...rest } = req.body;
      if (!针孔号) return res.status(400).json({ error: '缺少针孔号' });

      const fields: Record<string, any> = { 针孔号, ...rest };
      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');

      const result = await db.run(
        `INSERT INTO pins (connector_id, ${cols}) VALUES (?, ${placeholders})`,
        [connectorId, ...Object.values(fields)]
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
  router.put('/:devId/connectors/:connId/pins/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const pinId = parseInt(req.params.id);
      const { version, ...fields } = req.body;
      delete fields.id; delete fields.connector_id; delete fields.created_at;

      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
      const result = await db.run(
        `UPDATE pins SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
        [...Object.values(fields), pinId, version ?? 1]
      );
      if (result.changes === 0) {
        return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '更新针孔失败' });
    }
  });

  // DELETE /api/devices/:devId/connectors/:connId/pins/:id
  router.delete('/:devId/connectors/:connId/pins/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
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
