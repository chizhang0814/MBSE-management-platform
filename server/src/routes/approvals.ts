import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

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

const ACTION_LABELS: Record<string, string> = {
  create_device: '新建设备',
  edit_device: '编辑设备',
  create_connector: '新建连接器',
  edit_connector: '编辑连接器',
};

export function approvalRoutes(db: Database) {
  const router = express.Router();

  // ── GET /api/approvals?status=pending ────────────────────────
  // 项目管理员/admin 查看审批列表
  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const status = (req.query.status as string) || 'pending';
      const username = req.user!.username;
      const role = req.user!.role;

      const statusFilter = (status === 'all') ? null : status;

      let rows: any[];
      if (role === 'admin') {
        const sql = statusFilter
          ? `SELECT ar.*, p.name as project_name FROM approval_requests ar
             JOIN projects p ON ar.project_id = p.id
             WHERE ar.status = ? ORDER BY ar.created_at DESC`
          : `SELECT ar.*, p.name as project_name FROM approval_requests ar
             JOIN projects p ON ar.project_id = p.id
             ORDER BY ar.created_at DESC`;
        rows = await db.query(sql, statusFilter ? [statusFilter] : []);
      } else {
        const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
        const perms: Array<{ project_name: string; project_role: string }> = userRow?.permissions
          ? JSON.parse(userRow.permissions)
          : [];
        const managedProjects = perms
          .filter(p => p.project_role === '项目管理员')
          .map(p => p.project_name);

        if (!managedProjects.length) {
          // 非项目管理员（如设备管理员）：只能看到自己提交的记录
          const sql = statusFilter
            ? `SELECT ar.*, p.name as project_name FROM approval_requests ar
               JOIN projects p ON ar.project_id = p.id
               WHERE ar.requester_id = ? AND ar.status = ?
               ORDER BY ar.created_at DESC`
            : `SELECT ar.*, p.name as project_name FROM approval_requests ar
               JOIN projects p ON ar.project_id = p.id
               WHERE ar.requester_id = ?
               ORDER BY ar.created_at DESC`;
          rows = await db.query(sql, statusFilter ? [req.user!.id, statusFilter] : [req.user!.id]);
        } else {
          // 项目管理员：看到自己管理的项目的记录 + 自己提交的记录
          const placeholders = managedProjects.map(() => '?').join(',');
          const sql = statusFilter
            ? `SELECT ar.*, p.name as project_name FROM approval_requests ar
               JOIN projects p ON ar.project_id = p.id
               WHERE ar.status = ? AND (p.name IN (${placeholders}) OR ar.requester_id = ?)
               ORDER BY ar.created_at DESC`
            : `SELECT ar.*, p.name as project_name FROM approval_requests ar
               JOIN projects p ON ar.project_id = p.id
               WHERE (p.name IN (${placeholders}) OR ar.requester_id = ?)
               ORDER BY ar.created_at DESC`;
          rows = await db.query(sql, statusFilter
            ? [statusFilter, ...managedProjects, req.user!.id]
            : [...managedProjects, req.user!.id]);
        }
      }
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取审批列表失败' });
    }
  });

  // ── GET /api/approvals/my ────────────────────────────────────
  // 申请人查看自己提交的审批记录
  router.get('/my', authenticate, async (req: AuthRequest, res) => {
    try {
      const rows = await db.query(
        `SELECT ar.*, p.name as project_name FROM approval_requests ar
         JOIN projects p ON ar.project_id = p.id
         WHERE ar.requester_id = ? ORDER BY ar.created_at DESC`,
        [req.user!.id]
      );
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取申请记录失败' });
    }
  });

  // ── PUT /api/approvals/:id/approve ──────────────────────────
  router.put('/:id/approve', authenticate, async (req: AuthRequest, res) => {
    try {
      const ar = await db.get('SELECT * FROM approval_requests WHERE id = ?', [req.params.id]);
      if (!ar) return res.status(404).json({ error: '审批请求不存在' });
      if (ar.status !== 'pending') return res.status(400).json({ error: '该请求已处理' });

      if (req.user!.role !== 'admin' && !await isProjectAdmin(db, req.user!.username, ar.project_id)) {
        return res.status(403).json({ error: '无审批权限' });
      }

      const payload = JSON.parse(ar.payload);

      if (ar.action_type === 'create_device') {
        // 设备已在 POST 时创建（status=Pending），审批通过只需更新状态为 normal
        await db.run(`UPDATE devices SET status = 'normal' WHERE id = ?`, [ar.entity_id]);
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, '(审批通过) 新增设备', 'approved')`,
          [ar.entity_id, ar.entity_id, ar.requester_id, ar.payload]
        );
      } else if (ar.action_type === 'edit_device') {
        const oldDevice = await db.get('SELECT * FROM devices WHERE id = ?', [ar.entity_id]);
        const setClauses = Object.keys(payload).map(k => `"${k}" = ?`).join(', ');
        await db.run(
          `UPDATE devices SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [...Object.values(payload), ar.entity_id]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('devices', ?, ?, 'devices', ?, ?, ?, '(审批通过) 修改设备', 'approved')`,
          [ar.entity_id, ar.entity_id, ar.requester_id, JSON.stringify(oldDevice), ar.payload]
        );
      } else if (ar.action_type === 'create_connector') {
        const cols = Object.keys(payload).map(k => `"${k}"`).join(', ');
        const placeholders = Object.keys(payload).map(() => '?').join(', ');
        const connResult = await db.run(
          `INSERT INTO connectors (device_id, ${cols}) VALUES (?, ${placeholders})`,
          [ar.device_id, ...Object.values(payload)]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, '(审批通过) 新增连接器', 'approved')`,
          [connResult.lastID, connResult.lastID, ar.requester_id, ar.payload]
        );
      } else if (ar.action_type === 'edit_connector') {
        const oldConnector = await db.get('SELECT * FROM connectors WHERE id = ?', [ar.entity_id]);
        const setClauses = Object.keys(payload).map(k => `"${k}" = ?`).join(', ');
        await db.run(
          `UPDATE connectors SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [...Object.values(payload), ar.entity_id]
        );
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('connectors', ?, ?, 'connectors', ?, ?, ?, '(审批通过) 修改连接器', 'approved')`,
          [ar.entity_id, ar.entity_id, ar.requester_id, JSON.stringify(oldConnector), ar.payload]
        );
      }

      await db.run(
        `UPDATE approval_requests SET status='approved', reviewed_by_username=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?`,
        [req.user!.username, ar.id]
      );
      await db.run(
        `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?,?,?,?)`,
        [
          ar.requester_username,
          'approval_approved',
          '审批通过',
          `您提交的"${ACTION_LABELS[ar.action_type] || ar.action_type}"请求已由 ${req.user!.username} 审批通过`,
        ]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '审批失败' });
    }
  });

  // ── PUT /api/approvals/:id/reject ───────────────────────────
  router.put('/:id/reject', authenticate, async (req: AuthRequest, res) => {
    try {
      const { reason = '' } = req.body;
      const ar = await db.get('SELECT * FROM approval_requests WHERE id = ?', [req.params.id]);
      if (!ar) return res.status(404).json({ error: '审批请求不存在' });
      if (ar.status !== 'pending') return res.status(400).json({ error: '该请求已处理' });

      if (req.user!.role !== 'admin' && !await isProjectAdmin(db, req.user!.username, ar.project_id)) {
        return res.status(403).json({ error: '无审批权限' });
      }

      await db.run(
        `UPDATE approval_requests SET status='rejected', rejection_reason=?, reviewed_by_username=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?`,
        [reason, req.user!.username, ar.id]
      );

      // 如果是 create_device，将设备状态恢复为 Draft
      if (ar.action_type === 'create_device' && ar.entity_id) {
        await db.run(`UPDATE devices SET status = 'Draft' WHERE id = ?`, [ar.entity_id]);
      }

      await db.run(
        `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?,?,?,?)`,
        [
          ar.requester_username,
          'approval_rejected',
          '审批被拒绝',
          `您提交的"${ACTION_LABELS[ar.action_type] || ar.action_type}"请求被拒绝。原因：${reason || '（未填写原因）'}`,
        ]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '拒绝失败' });
    }
  });

  return router;
}
