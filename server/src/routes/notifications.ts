import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export function notificationRoutes(db: Database) {
  const router = express.Router();

  // GET /api/notifications — 获取当前用户的通知列表
  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const notifications = await db.query(
        `SELECT * FROM notifications
         WHERE recipient_username = ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [req.user!.username]
      );
      res.json({ notifications });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取通知失败' });
    }
  });

  // GET /api/notifications/unread-count — 未读数量
  router.get('/unread-count', authenticate, async (req: AuthRequest, res) => {
    try {
      const row = await db.get(
        `SELECT COUNT(*) as count FROM notifications
         WHERE recipient_username = ? AND is_read = 0`,
        [req.user!.username]
      );
      res.json({ count: row?.count ?? 0 });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取未读数量失败' });
    }
  });

  // PUT /api/notifications/read-all — 全部标为已读
  router.put('/read-all', authenticate, async (req: AuthRequest, res) => {
    try {
      await db.run(
        `UPDATE notifications SET is_read = 1 WHERE recipient_username = ?`,
        [req.user!.username]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '标记失败' });
    }
  });

  // PUT /api/notifications/:id/read — 标记单条已读
  router.put('/:id/read', authenticate, async (req: AuthRequest, res) => {
    try {
      await db.run(
        `UPDATE notifications SET is_read = 1
         WHERE id = ? AND recipient_username = ?`,
        [req.params.id, req.user!.username]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '标记失败' });
    }
  });

  return router;
}
