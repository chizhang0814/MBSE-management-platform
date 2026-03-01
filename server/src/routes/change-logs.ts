import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export function changeLogRoutes(db: Database) {
  const router = express.Router();

  // GET /api/change-logs?entity_table=xxx&entity_id=xxx
  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const entityTable = req.query.entity_table as string;
      const entityId = parseInt(req.query.entity_id as string);

      if (!entityTable || isNaN(entityId)) {
        return res.status(400).json({ error: '缺少 entity_table 或 entity_id' });
      }

      const allowed = [
        'devices', 'connectors', 'pins', 'signals',
        'section_connectors', 'sc_connectors', 'sc_pins',
      ];
      if (!allowed.includes(entityTable)) {
        return res.status(400).json({ error: '不支持的 entity_table' });
      }

      const logs = await db.query(
        `SELECT cl.*, u.username as changed_by_name, u.display_name as changed_by_display
         FROM change_logs cl
         LEFT JOIN users u ON cl.changed_by = u.id
         WHERE cl.entity_table = ? AND cl.entity_id = ?
         ORDER BY cl.created_at DESC`,
        [entityTable, entityId]
      );

      res.json({ logs });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取变更记录失败' });
    }
  });

  return router;
}
