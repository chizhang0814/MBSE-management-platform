import express from 'express';
import bcrypt from 'bcryptjs';
import { Database } from '../database.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export function usersRoutes(db: Database) {
  const router = express.Router();

  // 获取所有用户
  router.get('/', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const users = await db.query('SELECT id, username, role, created_at FROM users ORDER BY id DESC');
      res.json({ users });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取用户列表失败' });
    }
  });

  // 获取单个用户
  router.get('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const user = await db.get('SELECT id, username, role, created_at FROM users WHERE id = ?', [req.params.id]);
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      res.json({ user });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取用户失败' });
    }
  });

  // 创建用户
  router.post('/', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { username, password, role } = req.body;

      if (!username || !password || !role) {
        return res.status(400).json({ error: '缺少必要参数' });
      }

      if (!['admin', 'reviewer'].includes(role)) {
        return res.status(400).json({ error: '无效的角色' });
      }

      // 检查用户名是否已存在
      const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
      if (existing) {
        return res.status(400).json({ error: '用户名已存在' });
      }

      // 加密密码
      const hashedPassword = await bcrypt.hash(password, 10);

      await db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [
        username,
        hashedPassword,
        role,
      ]);

      res.json({ message: '用户创建成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '创建用户失败' });
    }
  });

  // 更新用户
  router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { username, password, role } = req.body;
      const userId = req.params.id;

      // 检查用户是否存在
      const existing = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
      if (!existing) {
        return res.status(404).json({ error: '用户不存在' });
      }

      // 如果提供了新用户名，检查是否冲突
      if (username) {
        const conflict = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
        if (conflict) {
          return res.status(400).json({ error: '用户名已被使用' });
        }
      }

      // 更新用户信息
      if (username || role) {
        const updates: string[] = [];
        const params: any[] = [];

        if (username) {
          updates.push('username = ?');
          params.push(username);
        }

        if (role) {
          if (!['admin', 'reviewer'].includes(role)) {
            return res.status(400).json({ error: '无效的角色' });
          }
          updates.push('role = ?');
          params.push(role);
        }

        params.push(userId);
        await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      // 更新密码（如果提供）
      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
      }

      res.json({ message: '用户更新成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '更新用户失败' });
    }
  });

  // 删除用户
  router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const userId = req.params.id;

      // 获取当前用户ID
      const currentUser = (req as any).user;
      if (parseInt(userId) === currentUser.id) {
        return res.status(400).json({ error: '不能删除自己' });
      }

      // 检查用户是否存在
      const existing = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
      if (!existing) {
        return res.status(404).json({ error: '用户不存在' });
      }

      await db.run('DELETE FROM users WHERE id = ?', [userId]);

      res.json({ message: '用户删除成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '删除用户失败' });
    }
  });

  // 重置用户密码
  router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { password } = req.body;
      const userId = req.params.id;

      if (!password) {
        return res.status(400).json({ error: '请提供新密码' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

      res.json({ message: '密码重置成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '重置密码失败' });
    }
  });

  return router;
}
