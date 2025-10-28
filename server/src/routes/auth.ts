import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Database } from '../database.js';
import { authenticate } from '../middleware/auth.js';

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
          role: user.role,
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '登录失败' });
    }
  });

  // 获取当前用户信息
  router.get('/me', authenticate, async (req: any, res) => {
    try {
      const user = await db.get('SELECT id, username, role FROM users WHERE id = ?', [req.user.id]);
      res.json({ user });
    } catch (error) {
      res.status(500).json({ error: '获取用户信息失败' });
    }
  });

  return router;
}


