import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

async function isProjectAdmin(db: Database, username: string, projectId: number): Promise<boolean> {
  const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
  const perms: Array<{ project_name: string; project_role: string }> = userRow?.permissions
    ? JSON.parse(userRow.permissions)
    : [];
  const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!projectRow) return false;
  return perms.some(p => p.project_name === projectRow.name && p.project_role === '项目管理员');
}

async function canWrite(db: Database, username: string, projectId: number): Promise<boolean> {
  const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
  const perms: Array<{ project_name: string; project_role: string }> = userRow?.permissions
    ? JSON.parse(userRow.permissions)
    : [];
  const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!projectRow) return false;
  return perms.some(p =>
    p.project_name === projectRow.name &&
    (p.project_role === '项目管理员' || p.project_role === '设备管理员')
  );
}

export function sectionConnectorRoutes(db: Database) {
  const router = express.Router();

  // ── GET /api/section-connectors?projectId=N ─────────────
  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.query.projectId as string);
      if (isNaN(projectId)) return res.status(400).json({ error: '缺少 projectId' });

      const username = req.user!.username;
      const role = req.user!.role;

      let where = `sc.project_id = ?`;
      const params: any[] = [projectId];

      if (role !== 'admin') {
        const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
        const perms: Array<{ project_name: string }> = userRow?.permissions
          ? JSON.parse(userRow.permissions)
          : [];
        const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
        const hasProjectPerm = perms.some(p => p.project_name === projectRow?.name);
        if (!hasProjectPerm) {
          where += ' AND sc.负责人 = ?';
          params.push(username);
        }
      }

      const sql = `
        SELECT sc.*, COUNT(c.id) as connector_count
        FROM section_connectors sc
        LEFT JOIN sc_connectors c ON c.section_connector_id = sc.id
        WHERE ${where}
        GROUP BY sc.id
        ORDER BY sc.设备名称
      `;
      const rows = await db.query(sql, params);
      res.json({ sectionConnectors: rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取断面连接器失败' });
    }
  });

  // ── POST /api/section-connectors ────────────────────────
  router.post('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const { project_id, ...fields } = req.body;
      if (!project_id || !String(fields['设备名称'] || '').trim()) {
        return res.status(400).json({ error: '缺少必填字段: 设备名称' });
      }

      const username = req.user!.username;
      const role = req.user!.role;

      if (role !== 'admin' && !(await canWrite(db, username, project_id))) {
        return res.status(403).json({ error: '无权限创建断面连接器' });
      }

      if (role !== 'admin') fields['负责人'] = username;

      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const result = await db.run(
        `INSERT INTO section_connectors (project_id, ${cols}) VALUES (?, ${placeholders})`,
        [project_id, ...Object.values(fields)]
      );

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES ('section_connectors', ?, ?, 'section_connectors', ?, ?, '新增断面连接器', 'approved')`,
        [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
      );

      res.json({ success: true, id: result.lastID });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该项目中设备名称已存在' });
      }
      res.status(500).json({ error: error.message || '创建断面连接器失败' });
    }
  });

  // ── PUT /api/section-connectors/:id ─────────────────────
  router.put('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const row = await db.get('SELECT * FROM section_connectors WHERE id = ?', [id]);
      if (!row) return res.status(404).json({ error: '断面连接器不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      if (role !== 'admin'
        && !(await isProjectAdmin(db, username, row.project_id))
        && row.负责人 !== username) {
        return res.status(403).json({ error: '无权限修改此断面连接器' });
      }

      const fields = { ...req.body };
      delete fields.id; delete fields.project_id;
      delete fields.created_at; delete fields.updated_at;

      if (!String(fields['设备名称'] || '').trim()) {
        return res.status(400).json({ error: '设备名称不能为空' });
      }

      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
      await db.run(
        `UPDATE section_connectors SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...Object.values(fields), id]
      );

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
         VALUES ('section_connectors', ?, ?, 'section_connectors', ?, ?, ?, '修改断面连接器', 'approved')`,
        [id, id, req.user!.id, JSON.stringify(row), JSON.stringify(fields)]
      );

      res.json({ success: true });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该项目中设备名称已存在' });
      }
      res.status(500).json({ error: error.message || '更新断面连接器失败' });
    }
  });

  // ── DELETE /api/section-connectors/:id ──────────────────
  router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const row = await db.get('SELECT * FROM section_connectors WHERE id = ?', [id]);
      if (!row) return res.status(404).json({ error: '断面连接器不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      if (role !== 'admin'
        && !(await isProjectAdmin(db, username, row.project_id))
        && row.负责人 !== username) {
        return res.status(403).json({ error: '无权限删除此断面连接器' });
      }

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
         VALUES ('section_connectors', ?, ?, 'section_connectors', ?, ?, '删除断面连接器', 'approved')`,
        [id, id, req.user!.id, JSON.stringify(row)]
      );

      await db.run('DELETE FROM section_connectors WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除断面连接器失败' });
    }
  });

  // ═══════════════════════════════════════════════════════
  // 断面连接器下的连接器 CRUD
  // ═══════════════════════════════════════════════════════

  // ── GET /api/section-connectors/:scId/connectors ────────
  router.get('/:scId/connectors', authenticate, async (req: AuthRequest, res) => {
    try {
      const scId = parseInt(req.params.scId);
      const sc = await db.get('SELECT * FROM section_connectors WHERE id = ?', [scId]);
      if (!sc) return res.status(404).json({ error: '断面连接器不存在' });

      const rows = await db.query(`
        SELECT c.*, COUNT(p.id) as pin_count
        FROM sc_connectors c
        LEFT JOIN sc_pins p ON p.sc_connector_id = c.id
        WHERE c.section_connector_id = ?
        GROUP BY c.id
        ORDER BY c.连接器号
      `, [scId]);
      res.json({ connectors: rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取连接器失败' });
    }
  });

  // ── POST /api/section-connectors/:scId/connectors ───────
  router.post('/:scId/connectors', authenticate, async (req: AuthRequest, res) => {
    try {
      const scId = parseInt(req.params.scId);
      const sc = await db.get('SELECT * FROM section_connectors WHERE id = ?', [scId]);
      if (!sc) return res.status(404).json({ error: '断面连接器不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      const canEdit = role === 'admin'
        || (await isProjectAdmin(db, username, sc.project_id))
        || sc.负责人 === username;
      if (!canEdit) return res.status(403).json({ error: '无权限添加连接器' });

      const fields = { ...req.body };
      if (!String(fields['连接器号'] || '').trim()) {
        return res.status(400).json({ error: '连接器号不能为空' });
      }
      delete fields.id; delete fields.section_connector_id;

      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const result = await db.run(
        `INSERT INTO sc_connectors (section_connector_id, ${cols}) VALUES (?, ${placeholders})`,
        [scId, ...Object.values(fields)]
      );

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES ('sc_connectors', ?, ?, 'sc_connectors', ?, ?, '新增SC连接器', 'approved')`,
        [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
      );

      res.json({ success: true, id: result.lastID });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该断面连接器下连接器号已存在' });
      }
      res.status(500).json({ error: error.message || '创建连接器失败' });
    }
  });

  // ── PUT /api/section-connectors/:scId/connectors/:connId ─
  router.put('/:scId/connectors/:connId', authenticate, async (req: AuthRequest, res) => {
    try {
      const scId = parseInt(req.params.scId);
      const connId = parseInt(req.params.connId);
      const sc = await db.get('SELECT * FROM section_connectors WHERE id = ?', [scId]);
      if (!sc) return res.status(404).json({ error: '断面连接器不存在' });
      const conn = await db.get('SELECT * FROM sc_connectors WHERE id = ? AND section_connector_id = ?', [connId, scId]);
      if (!conn) return res.status(404).json({ error: '连接器不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      const canEdit = role === 'admin'
        || (await isProjectAdmin(db, username, sc.project_id))
        || sc.负责人 === username;
      if (!canEdit) return res.status(403).json({ error: '无权限修改连接器' });

      const fields = { ...req.body };
      delete fields.id; delete fields.section_connector_id;
      delete fields.created_at; delete fields.updated_at;

      if (!String(fields['连接器号'] || '').trim()) {
        return res.status(400).json({ error: '连接器号不能为空' });
      }

      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
      await db.run(
        `UPDATE sc_connectors SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...Object.values(fields), connId]
      );

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
         VALUES ('sc_connectors', ?, ?, 'sc_connectors', ?, ?, ?, '修改SC连接器', 'approved')`,
        [connId, connId, req.user!.id, JSON.stringify(conn), JSON.stringify(fields)]
      );

      res.json({ success: true });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该断面连接器下连接器号已存在' });
      }
      res.status(500).json({ error: error.message || '更新连接器失败' });
    }
  });

  // ── DELETE /api/section-connectors/:scId/connectors/:connId
  router.delete('/:scId/connectors/:connId', authenticate, async (req: AuthRequest, res) => {
    try {
      const scId = parseInt(req.params.scId);
      const connId = parseInt(req.params.connId);
      const sc = await db.get('SELECT * FROM section_connectors WHERE id = ?', [scId]);
      if (!sc) return res.status(404).json({ error: '断面连接器不存在' });
      const conn = await db.get('SELECT * FROM sc_connectors WHERE id = ? AND section_connector_id = ?', [connId, scId]);
      if (!conn) return res.status(404).json({ error: '连接器不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      const canEdit = role === 'admin'
        || (await isProjectAdmin(db, username, sc.project_id))
        || sc.负责人 === username;
      if (!canEdit) return res.status(403).json({ error: '无权限删除连接器' });

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
         VALUES ('sc_connectors', ?, ?, 'sc_connectors', ?, ?, '删除SC连接器', 'approved')`,
        [connId, connId, req.user!.id, JSON.stringify(conn)]
      );

      await db.run('DELETE FROM sc_connectors WHERE id = ?', [connId]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除连接器失败' });
    }
  });

  // ═══════════════════════════════════════════════════════
  // 断面连接器下连接器的针孔 CRUD
  // ═══════════════════════════════════════════════════════

  // ── GET /api/section-connectors/:scId/connectors/:connId/pins
  router.get('/:scId/connectors/:connId/pins', authenticate, async (req: AuthRequest, res) => {
    try {
      const scId = parseInt(req.params.scId);
      const connId = parseInt(req.params.connId);
      const conn = await db.get('SELECT * FROM sc_connectors WHERE id = ? AND section_connector_id = ?', [connId, scId]);
      if (!conn) return res.status(404).json({ error: '连接器不存在' });

      const rows = await db.query(
        `SELECT * FROM sc_pins WHERE sc_connector_id = ? ORDER BY 针孔号`,
        [connId]
      );
      res.json({ pins: rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取针孔失败' });
    }
  });

  // ── POST /api/section-connectors/:scId/connectors/:connId/pins
  router.post('/:scId/connectors/:connId/pins', authenticate, async (req: AuthRequest, res) => {
    try {
      const scId = parseInt(req.params.scId);
      const connId = parseInt(req.params.connId);
      const sc = await db.get('SELECT * FROM section_connectors WHERE id = ?', [scId]);
      if (!sc) return res.status(404).json({ error: '断面连接器不存在' });
      const conn = await db.get('SELECT * FROM sc_connectors WHERE id = ? AND section_connector_id = ?', [connId, scId]);
      if (!conn) return res.status(404).json({ error: '连接器不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      const canEdit = role === 'admin'
        || (await isProjectAdmin(db, username, sc.project_id))
        || sc.负责人 === username;
      if (!canEdit) return res.status(403).json({ error: '无权限添加针孔' });

      const fields = { ...req.body };
      if (!String(fields['针孔号'] || '').trim()) {
        return res.status(400).json({ error: '针孔号不能为空' });
      }
      delete fields.id; delete fields.sc_connector_id;

      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const result = await db.run(
        `INSERT INTO sc_pins (sc_connector_id, ${cols}) VALUES (?, ${placeholders})`,
        [connId, ...Object.values(fields)]
      );

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES ('sc_pins', ?, ?, 'sc_pins', ?, ?, '新增SC针孔', 'approved')`,
        [result.lastID, result.lastID, req.user!.id, JSON.stringify(fields)]
      );

      res.json({ success: true, id: result.lastID });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该连接器下针孔号已存在' });
      }
      res.status(500).json({ error: error.message || '创建针孔失败' });
    }
  });

  // ── PUT /api/section-connectors/:scId/connectors/:connId/pins/:pinId
  router.put('/:scId/connectors/:connId/pins/:pinId', authenticate, async (req: AuthRequest, res) => {
    try {
      const scId = parseInt(req.params.scId);
      const connId = parseInt(req.params.connId);
      const pinId = parseInt(req.params.pinId);
      const sc = await db.get('SELECT * FROM section_connectors WHERE id = ?', [scId]);
      if (!sc) return res.status(404).json({ error: '断面连接器不存在' });
      const pin = await db.get('SELECT * FROM sc_pins WHERE id = ? AND sc_connector_id = ?', [pinId, connId]);
      if (!pin) return res.status(404).json({ error: '针孔不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      const canEdit = role === 'admin'
        || (await isProjectAdmin(db, username, sc.project_id))
        || sc.负责人 === username;
      if (!canEdit) return res.status(403).json({ error: '无权限修改针孔' });

      const fields = { ...req.body };
      delete fields.id; delete fields.sc_connector_id;
      delete fields.created_at; delete fields.updated_at;

      if (!String(fields['针孔号'] || '').trim()) {
        return res.status(400).json({ error: '针孔号不能为空' });
      }

      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
      await db.run(
        `UPDATE sc_pins SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...Object.values(fields), pinId]
      );

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
         VALUES ('sc_pins', ?, ?, 'sc_pins', ?, ?, ?, '修改SC针孔', 'approved')`,
        [pinId, pinId, req.user!.id, JSON.stringify(pin), JSON.stringify(fields)]
      );

      res.json({ success: true });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: '该连接器下针孔号已存在' });
      }
      res.status(500).json({ error: error.message || '更新针孔失败' });
    }
  });

  // ── DELETE /api/section-connectors/:scId/connectors/:connId/pins/:pinId
  router.delete('/:scId/connectors/:connId/pins/:pinId', authenticate, async (req: AuthRequest, res) => {
    try {
      const scId = parseInt(req.params.scId);
      const connId = parseInt(req.params.connId);
      const pinId = parseInt(req.params.pinId);
      const sc = await db.get('SELECT * FROM section_connectors WHERE id = ?', [scId]);
      if (!sc) return res.status(404).json({ error: '断面连接器不存在' });
      const pin = await db.get('SELECT * FROM sc_pins WHERE id = ? AND sc_connector_id = ?', [pinId, connId]);
      if (!pin) return res.status(404).json({ error: '针孔不存在' });

      const username = req.user!.username;
      const role = req.user!.role;

      const canEdit = role === 'admin'
        || (await isProjectAdmin(db, username, sc.project_id))
        || sc.负责人 === username;
      if (!canEdit) return res.status(403).json({ error: '无权限删除针孔' });

      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
         VALUES ('sc_pins', ?, ?, 'sc_pins', ?, ?, '删除SC针孔', 'approved')`,
        [pinId, pinId, req.user!.id, JSON.stringify(pin)]
      );

      await db.run('DELETE FROM sc_pins WHERE id = ?', [pinId]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除针孔失败' });
    }
  });

  return router;
}
