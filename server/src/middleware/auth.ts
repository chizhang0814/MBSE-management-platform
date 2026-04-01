import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { Database } from '../database.js';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    role: string;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  // 从Authorization header获取token
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权访问，请提供有效的认证令牌' });
  }
  
  const token = authHeader.replace('Bearer ', '').trim();
  
  if (!token) {
    return res.status(401).json({ error: '未授权访问，请提供有效的认证令牌' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'eicd_secret_key_2024') as any;
    req.user = decoded;
    next();
  } catch (error: any) {
    // 更详细的错误信息
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '令牌已过期，请重新登录' });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: '无效的令牌，请重新登录' });
    }
    return res.status(401).json({ error: '令牌验证失败，请重新登录' });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: '未授权访问' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }

    next();
  };
};

/** 允许 admin 或任意项目中角色为"总体组"的用户通过 */
export const requireAdminOrZonti = (db: Database) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: '未授权访问' });
    if (req.user.role === 'admin') { next(); return; }
    try {
      const user = await db.get('SELECT permissions FROM users WHERE id = ?', [req.user.id]);
      const perms: any[] = JSON.parse(user?.permissions || '[]');
      if (perms.some((p: any) => p.project_role === '总体组')) { next(); return; }
    } catch {}
    res.status(403).json({ error: '权限不足，需要管理员或总体组角色' });
  };

/** 允许 admin 或任意项目中角色为"总体组"或"系统组"的用户通过 */
export const requireAdminOrZontiOrSystem = (db: Database) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: '未授权访问' });
    if (req.user.role === 'admin') { next(); return; }
    try {
      const user = await db.get('SELECT permissions FROM users WHERE id = ?', [req.user.id]);
      const perms: any[] = JSON.parse(user?.permissions || '[]');
      if (perms.some((p: any) => p.project_role === '总体组' || p.project_role === '系统组')) { next(); return; }
    } catch {}
    res.status(403).json({ error: '权限不足，需要管理员、总体组或系统组角色' });
  };

/** 允许 admin 或任意项目中角色为"总体PMO组"的用户通过 */
export const requireAdminOrPMO = (db: Database) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: '未授权访问' });
    if (req.user.role === 'admin') { next(); return; }
    try {
      const user = await db.get('SELECT permissions FROM users WHERE id = ?', [req.user.id]);
      const perms: any[] = JSON.parse(user?.permissions || '[]');
      if (perms.some((p: any) => p.project_role === '总体PMO组')) { next(); return; }
    } catch {}
    res.status(403).json({ error: '权限不足，需要管理员或总体PMO组角色' });
  };


