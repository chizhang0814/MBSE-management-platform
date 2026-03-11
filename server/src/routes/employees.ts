import express from 'express';
import bcrypt from 'bcryptjs';
import { Database } from '../database.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const requireAdmin = requireRole('admin');

export function employeeRoutes(db: Database) {
  const router = express.Router();

  // 查询所有人员（从 users 表，排除 admin）
  router.get('/', authenticate, requireAdmin, async (_req, res) => {
    try {
      const rows = await db.query(
        `SELECT id, username as eid, name, remarks, created_at FROM users WHERE role != 'admin' ORDER BY username`
      );
      res.json({ employees: rows });
    } catch (error) {
      res.status(500).json({ error: '查询人员列表失败' });
    }
  });

  // 新增人员（在 users 表中创建账号）
  router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
      const eid = (req.body.eid || '').trim();
      const name = (req.body.name || '').trim();
      const remarks = req.body.remarks ? req.body.remarks.trim() : null;
      if (!eid || !name) {
        return res.status(400).json({ error: 'EID 和姓名不能为空' });
      }
      const existing = await db.get('SELECT id FROM users WHERE username = ?', [eid]);
      if (existing) {
        return res.status(400).json({ error: '该 EID 已存在' });
      }
      const defaultPwd = await bcrypt.hash(eid, 10); // 默认密码为工号本身
      await db.run(
        'INSERT INTO users (username, password, role, name, remarks) VALUES (?, ?, ?, ?, ?)',
        [eid, defaultPwd, 'user', name, remarks || null]
      );
      res.json({ message: '添加成功，初始密码为工号' });
    } catch (error) {
      res.status(500).json({ error: '添加人员失败' });
    }
  });

  // 更新人员姓名/备注
  router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
      const eid = (req.body.eid || '').trim();
      const name = (req.body.name || '').trim();
      const remarks = req.body.remarks ? req.body.remarks.trim() : null;
      if (!eid || !name) {
        return res.status(400).json({ error: 'EID 和姓名不能为空' });
      }
      const dup = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [eid, req.params.id]);
      if (dup) {
        return res.status(400).json({ error: '该 EID 已被其他用户使用' });
      }
      await db.run(
        'UPDATE users SET username = ?, name = ?, remarks = ? WHERE id = ?',
        [eid, name, remarks || null, req.params.id]
      );
      res.json({ message: '更新成功' });
    } catch (error) {
      res.status(500).json({ error: '更新人员失败' });
    }
  });

  // 删除人员
  router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
      await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
      res.json({ message: '删除成功' });
    } catch (error) {
      res.status(500).json({ error: '删除人员失败' });
    }
  });

  // 根据 EID 查询姓名（公开给已认证用户）
  router.get('/lookup/:eid', authenticate, async (req, res) => {
    try {
      const user = await db.get('SELECT name FROM users WHERE username = ?', [req.params.eid]);
      res.json({ name: user?.name || null });
    } catch (error) {
      res.status(500).json({ error: '查询失败' });
    }
  });

  return router;
}
