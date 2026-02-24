import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';

export function dataRoutes(db: Database) {
  const router = express.Router();

  // ── 统计端点（查5张固定表）────────────────────────────────

  // GET /api/data/stats?projectId=N   （可选 projectId，不传则返回全局统计）
  router.get('/stats', authenticate, async (req: any, res) => {
    try {
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;
      const userRole = req.user?.role;
      const username = req.user?.username;

      if (projectId) {
        // 单项目统计
        let deviceCount, connectorCount, pinCount, signalCount;

        if (userRole === 'admin') {
          deviceCount = (await db.get('SELECT COUNT(*) as c FROM devices WHERE project_id = ?', [projectId]))?.c || 0;
          connectorCount = (await db.get(
            'SELECT COUNT(*) as c FROM connectors c JOIN devices d ON c.device_id = d.id WHERE d.project_id = ?',
            [projectId]
          ))?.c || 0;
          pinCount = (await db.get(
            'SELECT COUNT(*) as c FROM pins p JOIN connectors co ON p.connector_id = co.id JOIN devices d ON co.device_id = d.id WHERE d.project_id = ?',
            [projectId]
          ))?.c || 0;
          signalCount = (await db.get('SELECT COUNT(*) as c FROM signals WHERE project_id = ?', [projectId]))?.c || 0;
        } else {
          deviceCount = (await db.get(
            'SELECT COUNT(*) as c FROM devices WHERE project_id = ? AND 设备负责人 = ?',
            [projectId, username]
          ))?.c || 0;
          connectorCount = (await db.get(
            'SELECT COUNT(*) as c FROM connectors c JOIN devices d ON c.device_id = d.id WHERE d.project_id = ? AND d.设备负责人 = ?',
            [projectId, username]
          ))?.c || 0;
          pinCount = (await db.get(
            'SELECT COUNT(*) as c FROM pins p JOIN connectors co ON p.connector_id = co.id JOIN devices d ON co.device_id = d.id WHERE d.project_id = ? AND d.设备负责人 = ?',
            [projectId, username]
          ))?.c || 0;
          signalCount = (await db.get(
            `SELECT COUNT(DISTINCT s.id) as c FROM signals s
             WHERE s.project_id = ?
               AND EXISTS (
                 SELECT 1 FROM signal_endpoints se JOIN pins p ON se.pin_id = p.id
                 JOIN connectors co ON p.connector_id = co.id
                 JOIN devices d ON co.device_id = d.id
                 WHERE se.signal_id = s.id AND d.设备负责人 = ?
               )`,
            [projectId, username]
          ))?.c || 0;
        }

        res.json({ deviceCount, connectorCount, pinCount, signalCount });
      } else {
        // 全局：按项目汇总（兼容旧 /api/data/tables/stats 调用）
        let projects;
        if (userRole === 'admin') {
          projects = await db.query(
            'SELECT p.id as project_id, p.name as project_name FROM projects p ORDER BY p.name'
          );
        } else {
          projects = await db.query(
            `SELECT DISTINCT p.id as project_id, p.name as project_name
             FROM projects p JOIN devices d ON d.project_id = p.id
             WHERE d.设备负责人 = ?
             ORDER BY p.name`,
            [username]
          );
        }

        const tableStats = await Promise.all(projects.map(async (p: any) => {
          let devCount, sigCount;
          if (userRole === 'admin') {
            devCount = (await db.get('SELECT COUNT(*) as c FROM devices WHERE project_id = ?', [p.project_id]))?.c || 0;
            sigCount = (await db.get('SELECT COUNT(*) as c FROM signals WHERE project_id = ?', [p.project_id]))?.c || 0;
          } else {
            devCount = (await db.get(
              'SELECT COUNT(*) as c FROM devices WHERE project_id = ? AND 设备负责人 = ?',
              [p.project_id, username]
            ))?.c || 0;
            sigCount = (await db.get(
              `SELECT COUNT(DISTINCT s.id) as c FROM signals s
               WHERE s.project_id = ?
                 AND EXISTS (
                   SELECT 1 FROM signal_endpoints se JOIN pins pi ON se.pin_id = pi.id
                   JOIN connectors co ON pi.connector_id = co.id
                   JOIN devices d ON co.device_id = d.id
                   WHERE se.signal_id = s.id AND d.设备负责人 = ?
                 )`,
              [p.project_id, username]
            ))?.c || 0;
          }
          return {
            projectId: p.project_id,
            projectName: p.project_name,
            displayName: 'EICD数据',
            tableName: `project_${p.project_id}`,
            tableType: 'relational',
            rowCount: devCount + sigCount,
            deviceCount: devCount,
            signalCount: sigCount,
          };
        }));

        res.json({ tableStats });
      }
    } catch (error: any) {
      console.error('获取统计失败:', error);
      res.status(500).json({ error: error.message || '获取统计失败' });
    }
  });

  // 兼容旧路径 /api/data/tables/stats（重定向到 /api/data/stats）
  router.get('/tables/stats', authenticate, async (req: any, res) => {
    try {
      const userRole = req.user?.role;
      const username = req.user?.username;

      let projects;
      if (userRole === 'admin') {
        projects = await db.query('SELECT p.id as project_id, p.name as project_name FROM projects p ORDER BY p.name');
      } else {
        projects = await db.query(
          `SELECT DISTINCT p.id as project_id, p.name as project_name
           FROM projects p JOIN devices d ON d.project_id = p.id
           WHERE d.设备负责人 = ? ORDER BY p.name`,
          [username]
        );
      }

      const tableStats = await Promise.all(projects.map(async (p: any) => {
        let devCount = 0, sigCount = 0;
        if (userRole === 'admin') {
          devCount = (await db.get('SELECT COUNT(*) as c FROM devices WHERE project_id = ?', [p.project_id]))?.c || 0;
          sigCount = (await db.get('SELECT COUNT(*) as c FROM signals WHERE project_id = ?', [p.project_id]))?.c || 0;
        } else {
          devCount = (await db.get(
            'SELECT COUNT(*) as c FROM devices WHERE project_id = ? AND 设备负责人 = ?',
            [p.project_id, username]
          ))?.c || 0;
        }
        return {
          projectId: p.project_id,
          projectName: p.project_name,
          displayName: 'EICD数据',
          tableName: `project_${p.project_id}`,
          tableType: 'relational',
          rowCount: devCount + sigCount,
          deviceCount: userRole === 'user' ? devCount : undefined,
        };
      }));

      res.json({ tableStats });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取统计失败' });
    }
  });

  // ── 编辑锁 ────────────────────────────────────────────────

  const purgeExpiredLocks = () =>
    db.run("DELETE FROM edit_locks WHERE expires_at <= datetime('now')");

  // 获取表的当前锁状态
  router.get('/locks', authenticate, async (req, res) => {
    try {
      const { table_name } = req.query as { table_name: string };
      if (!table_name) return res.status(400).json({ error: '缺少 table_name' });
      await purgeExpiredLocks();
      const rows = await db.query(
        'SELECT row_id, locked_by, locked_by_name, locked_at, expires_at FROM edit_locks WHERE table_name = ?',
        [table_name]
      );
      const locks: Record<number, { lockedBy: string; lockedAt: string; expiresAt: string }> = {};
      for (const r of rows) {
        locks[r.row_id] = { lockedBy: r.locked_by_name, lockedAt: r.locked_at, expiresAt: r.expires_at };
      }
      res.json({ locks });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 获取锁
  router.post('/lock', authenticate, async (req: AuthRequest, res) => {
    try {
      const { table_name, row_id } = req.body;
      if (!table_name || row_id == null) return res.status(400).json({ error: '缺少参数' });
      const userId = req.user!.id;
      const username = req.user!.username;

      await purgeExpiredLocks();

      const existing = await db.get(
        'SELECT * FROM edit_locks WHERE table_name = ? AND row_id = ?',
        [table_name, row_id]
      );

      if (existing && existing.locked_by !== userId) {
        return res.status(409).json({
          error: `该记录正在被 ${existing.locked_by_name} 编辑，请稍后再试`,
          lockedBy: existing.locked_by_name,
          expiresAt: existing.expires_at,
        });
      }

      await db.run(
        `INSERT OR REPLACE INTO edit_locks (table_name, row_id, locked_by, locked_by_name, locked_at, expires_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+5 minutes'))`,
        [table_name, row_id, userId, username]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 心跳续期
  router.put('/lock', authenticate, async (req: AuthRequest, res) => {
    try {
      const { table_name, row_id } = req.body;
      if (!table_name || row_id == null) return res.status(400).json({ error: '缺少参数' });
      await db.run(
        `UPDATE edit_locks SET expires_at = datetime('now', '+5 minutes')
         WHERE table_name = ? AND row_id = ? AND locked_by = ?`,
        [table_name, row_id, req.user!.id]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 释放锁
  router.delete('/lock', authenticate, async (req: AuthRequest, res) => {
    try {
      const { table_name, row_id } = req.body;
      if (!table_name || row_id == null) return res.status(400).json({ error: '缺少参数' });
      await db.run(
        'DELETE FROM edit_locks WHERE table_name = ? AND row_id = ? AND locked_by = ?',
        [table_name, row_id, req.user!.id]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
