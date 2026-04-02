import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Database } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { getProjectRoleMembers } from '../shared/approval-helper.js';

export function authRoutes(db: Database) {
  const router = express.Router();

  // 登录
  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;

      const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

      if (!user) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }

      const isValid = await bcrypt.compare(password, user.password);

      if (!isValid) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET || 'eicd_secret_key_2024',
        { expiresIn: '7d' }
      );

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name || null,
          employee_name: user.name || null,
          role: user.role,
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '登录失败' });
    }
  });

  // 注册
  router.post('/register', async (req, res) => {
    try {
      const username = (req.body.username || '').trim();
      const password = (req.body.password || '').trim();

      if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
      }
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: '用户名长度须在 3-20 个字符之间' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: '密码长度不能少于 6 位' });
      }

      const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
      if (existing) {
        return res.status(400).json({ error: '用户名已存在' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        [username, hashedPassword, 'user']
      );

      res.json({ message: '注册成功，请登录' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '注册失败' });
    }
  });

  // 获取当前用户信息
  router.get('/me', authenticate, async (req: any, res) => {
    try {
      const user = await db.get('SELECT id, username, display_name, name, role FROM users WHERE id = ?', [req.user.id]);
      res.json({ user: { ...user, employee_name: user?.name || null } });
    } catch (error) {
      res.status(500).json({ error: '获取用户信息失败' });
    }
  });

  // 获取当前用户完整资料（含权限和申请记录）
  router.get('/profile', authenticate, async (req: any, res) => {
    try {
      const user = await db.get(
        'SELECT id, username, name, department, role, permissions FROM users WHERE id = ?',
        [req.user.id]
      );
      if (!user) return res.status(404).json({ error: '用户不存在' });

      const requests = await db.query(
        'SELECT id, project_name, project_role, status, created_at FROM permission_requests WHERE user_id = ? ORDER BY created_at DESC',
        [req.user.id]
      );

      res.json({
        user: {
          ...user,
          permissions: user.permissions ? JSON.parse(user.permissions) : [],
        },
        requests,
      });
    } catch (error) {
      res.status(500).json({ error: '获取资料失败' });
    }
  });

  // 更新当前用户资料（name, department）
  router.put('/profile', authenticate, async (req: any, res) => {
    try {
      const name = req.body.name !== undefined ? (req.body.name || '').trim() || null : undefined;
      const department = req.body.department !== undefined ? (req.body.department || '').trim() || null : undefined;
      // 兼容旧字段 display_name
      const nameVal = name ?? ((req.body.display_name || '').trim() || null);
      await db.run(
        'UPDATE users SET name = ?, department = ? WHERE id = ?',
        [nameVal, department ?? null, req.user.id]
      );
      res.json({ message: '资料更新成功' });
    } catch (error) {
      res.status(500).json({ error: '更新资料失败' });
    }
  });

  // 修改密码
  router.put('/change-password', authenticate, async (req: any, res) => {
    try {
      const { current_password, new_password } = req.body;
      if (!current_password || !new_password) {
        return res.status(400).json({ error: '请填写当前密码和新密码' });
      }
      if (new_password.length < 6) {
        return res.status(400).json({ error: '新密码不能少于 6 位' });
      }

      const user = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);
      const isValid = await bcrypt.compare(current_password, user.password);
      if (!isValid) {
        return res.status(400).json({ error: '当前密码错误' });
      }

      const hashed = await bcrypt.hash(new_password, 10);
      await db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
      res.json({ message: '密码修改成功' });
    } catch (error) {
      res.status(500).json({ error: '修改密码失败' });
    }
  });

  // 提交权限申请
  router.post('/permission-request', authenticate, async (req: any, res) => {
    try {
      const { project_name, project_role } = req.body;
      if (!project_name || !project_role) {
        return res.status(400).json({ error: '请选择项目和角色' });
      }

      // 检查是否已有待审批的申请
      const pending = await db.get(
        'SELECT id FROM permission_requests WHERE user_id = ? AND status = ?',
        [req.user.id, 'pending']
      );
      if (pending) {
        return res.status(400).json({ error: '您已有待审批的申请，请等待管理员处理后再申请' });
      }

      const result = await db.run(
        'INSERT INTO permission_requests (user_id, project_name, project_role) VALUES (?, ?, ?)',
        [req.user.id, project_name, project_role]
      );

      // 通知所有总体PMO组成员和admin
      try {
        const displayName = req.user.display_name || req.user.username;
        // 查找所有拥有总体PMO组角色的用户（不限项目）
        const allUsers = await db.query('SELECT username, permissions, role FROM users');
        const notifyUsers = new Set<string>();
        for (const u of allUsers) {
          if (u.role === 'admin') { notifyUsers.add(u.username); continue; }
          try {
            const perms = JSON.parse(u.permissions || '[]');
            if (perms.some((p: any) => p.project_role === '总体PMO组')) notifyUsers.add(u.username);
          } catch {}
        }
        for (const u of notifyUsers) {
          await db.run(
            `INSERT INTO notifications (recipient_username, type, title, message, reference_id)
             VALUES (?, 'permission_request', ?, ?, ?)`,
            [u, `权限申请：${req.user.username} 申请加入 ${project_name}`,
             `${displayName} 申请「${project_role}」角色，请审批`,
             result.lastID]
          );
        }
      } catch (e) { console.error('发送权限申请通知失败:', e); }

      res.json({ message: '申请已提交，请等待审批' });
    } catch (error) {
      res.status(500).json({ error: '提交申请失败' });
    }
  });

  return router;
}


