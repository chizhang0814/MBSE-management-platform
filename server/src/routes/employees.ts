import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const requireAdmin = requireRole('admin');

export function employeeRoutes(db: Database) {
  const router = express.Router();

  // 查询所有员工
  router.get('/', authenticate, requireAdmin, async (_req, res) => {
    try {
      const rows = await db.query('SELECT id, eid, name, remarks, created_at FROM employees ORDER BY eid');
      res.json({ employees: rows });
    } catch (error) {
      res.status(500).json({ error: '查询员工列表失败' });
    }
  });

  // 新增员工
  router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
      const { eid, name, remarks } = req.body;
      if (!eid || !name) {
        return res.status(400).json({ error: 'EID 和姓名不能为空' });
      }
      const existing = await db.get('SELECT id FROM employees WHERE eid = ?', [eid]);
      if (existing) {
        return res.status(400).json({ error: '该 EID 已存在' });
      }
      await db.run('INSERT INTO employees (eid, name, remarks) VALUES (?, ?, ?)', [eid, name, remarks || null]);
      res.json({ message: '添加成功' });
    } catch (error) {
      res.status(500).json({ error: '添加员工失败' });
    }
  });

  // 更新员工
  router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
      const { eid, name, remarks } = req.body;
      if (!eid || !name) {
        return res.status(400).json({ error: 'EID 和姓名不能为空' });
      }
      const dup = await db.get('SELECT id FROM employees WHERE eid = ? AND id != ?', [eid, req.params.id]);
      if (dup) {
        return res.status(400).json({ error: '该 EID 已被其他员工使用' });
      }
      await db.run('UPDATE employees SET eid = ?, name = ?, remarks = ? WHERE id = ?', [eid, name, remarks || null, req.params.id]);
      res.json({ message: '更新成功' });
    } catch (error) {
      res.status(500).json({ error: '更新员工失败' });
    }
  });

  // 删除员工
  router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
      await db.run('DELETE FROM employees WHERE id = ?', [req.params.id]);
      res.json({ message: '删除成功' });
    } catch (error) {
      res.status(500).json({ error: '删除员工失败' });
    }
  });

  // 根据 EID 查询员工姓名（公开给已认证用户，用于前端显示）
  router.get('/lookup/:eid', authenticate, async (req, res) => {
    try {
      const emp = await db.get('SELECT name FROM employees WHERE eid = ?', [req.params.eid]);
      res.json({ name: emp?.name || null });
    } catch (error) {
      res.status(500).json({ error: '查询失败' });
    }
  });

  return router;
}
