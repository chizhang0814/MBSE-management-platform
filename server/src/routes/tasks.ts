import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';

export function taskRoutes(db: Database) {
  const router = express.Router();

  // ── 辅助：根据 entity_table + entity_id 查询实体名称摘要 ──

  async function resolveTaskRowSummary(db: Database, entityTable: string | null, entityId: number | null): Promise<string> {
    if (!entityTable || !entityId) return '';
    try {
      if (entityTable === 'devices') {
        const row = await db.get('SELECT 设备编号, 设备中文名称 FROM devices WHERE id = ?', [entityId]);
        if (row) return `设备 ${row['设备编号']} ${row['设备中文名称'] || ''}`.trim();
      } else if (entityTable === 'signals') {
        const row = await db.get('SELECT unique_id, 信号名称 FROM signals WHERE id = ?', [entityId]);
        if (row) return `信号 ${row['unique_id'] || ''} ${row['信号名称'] || ''}`.trim();
      } else if (entityTable === 'connectors') {
        const row = await db.get(
          'SELECT c.连接器号, d.设备编号 FROM connectors c JOIN devices d ON c.device_id = d.id WHERE c.id = ?',
          [entityId]
        );
        if (row) return `连接器 ${row['设备编号']}.${row['连接器号']}`;
      } else if (entityTable === 'pins') {
        const row = await db.get(
          'SELECT p.针孔号, c.连接器号, d.设备编号 FROM pins p JOIN connectors c ON p.connector_id = c.id JOIN devices d ON c.device_id = d.id WHERE p.id = ?',
          [entityId]
        );
        if (row) return `针孔 ${row['设备编号']}.${row['连接器号']}.${row['针孔号']}`;
      }
    } catch { /* 静默 */ }
    return '';
  }

  // ── 创建任务 ──────────────────────────────────────────────

  router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { data_id, assigned_to, notes, table_name, entity_table, entity_id } = req.body;

      // 支持新格式（entity_table + entity_id）和旧格式（data_id + table_name）
      const finalDataId = entity_id || data_id;
      const finalTableName = entity_table || table_name || 'eicd_data';

      await db.run(
        `INSERT INTO tasks (data_id, table_name, entity_table, entity_id, assigned_by, assigned_to, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [finalDataId, finalTableName, entity_table || null, entity_id || null, req.user!.id, assigned_to, notes, 'pending']
      );

      res.json({ message: '任务创建成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '创建任务失败' });
    }
  });

  // ── 获取所有任务 ──────────────────────────────────────────

  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      let tasksQuery: string;
      let params: any[];

      if (req.user!.role === 'admin') {
        tasksQuery = `
          SELECT t.*,
                 u1.username as assigned_by_name,
                 u2.username as assigned_to_name
          FROM tasks t
          JOIN users u1 ON t.assigned_by = u1.id
          JOIN users u2 ON t.assigned_to = u2.id
          ORDER BY t.created_at DESC
        `;
        params = [];
      } else {
        tasksQuery = `
          SELECT t.*,
                 u1.username as assigned_by_name,
                 u2.username as assigned_to_name
          FROM tasks t
          JOIN users u1 ON t.assigned_by = u1.id
          JOIN users u2 ON t.assigned_to = u2.id
          WHERE t.assigned_to = ?
          ORDER BY t.created_at DESC
        `;
        params = [req.user!.id];
      }

      const tasks = await db.query(tasksQuery, params);

      // 为每个任务附加实体名称摘要
      const tasksWithSummary = await Promise.all(
        tasks.map(async (task: any) => {
          const summary = await resolveTaskRowSummary(db, task.entity_table, task.entity_id);
          return { ...task, entity_summary: summary || task.item_code || '', item_code: '', item_name: '' };
        })
      );

      res.json({ tasks: tasksWithSummary });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取任务失败' });
    }
  });

  // ── 获取单个任务 ──────────────────────────────────────────

  router.get('/:id', authenticate, async (req, res) => {
    try {
      const task = await db.get(
        `SELECT t.*,
                u1.username as assigned_by_name,
                u2.username as assigned_to_name
         FROM tasks t
         JOIN users u1 ON t.assigned_by = u1.id
         JOIN users u2 ON t.assigned_to = u2.id
         WHERE t.id = ?`,
        [req.params.id]
      );

      if (!task) return res.status(404).json({ error: '任务不存在' });

      const summary = await resolveTaskRowSummary(db, task.entity_table, task.entity_id);
      task.entity_summary = summary;

      // 获取变更日志
      const changeLogs = await db.query(
        'SELECT * FROM change_logs WHERE (entity_id = ? AND entity_table = ?) OR (data_id = ? AND table_name = ?) ORDER BY created_at DESC',
        [task.entity_id, task.entity_table, task.data_id, task.table_name || 'eicd_data']
      );

      res.json({ task, changeLogs });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取任务失败' });
    }
  });

  // ── 审查员：提交审查结果 ──────────────────────────────────

  router.post('/:id/submit', authenticate, requireRole('reviewer'), async (req: AuthRequest, res) => {
    try {
      const { needs_change, changes, reason, table_name } = req.body;
      const taskId = req.params.id;

      const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
      const taskTableName = table_name || task?.table_name || 'eicd_data';

      if (needs_change && changes) {
        const result = await db.run(
          `INSERT INTO change_logs (data_id, table_name, entity_table, entity_id, changed_by, old_values, new_values, reason, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.body.data_id || task?.data_id,
            taskTableName,
            task?.entity_table || null,
            task?.entity_id || null,
            req.user!.id,
            JSON.stringify(req.body.old_values),
            JSON.stringify(changes),
            reason,
            'pending'
          ]
        );

        await db.run(
          'UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['submitted', taskId]
        );

        res.json({ message: '提交成功', changeLogId: result.lastID });
      } else {
        await db.run(
          'UPDATE tasks SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['no_change', reason, taskId]
        );
        res.json({ message: '提交成功' });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '提交失败' });
    }
  });

  // ── 管理员：确认修改 ──────────────────────────────────────

  router.post('/:id/confirm', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { change_log_id } = req.body;
      const changeLog = await db.get('SELECT * FROM change_logs WHERE id = ?', [change_log_id]);

      if (!changeLog || changeLog.status !== 'pending') {
        return res.status(400).json({ error: '无效的变更日志' });
      }

      await db.run('UPDATE change_logs SET status = ? WHERE id = ?', ['approved', change_log_id]);
      await db.run(
        'UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['completed', req.params.id]
      );

      res.json({ message: '确认成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '确认失败' });
    }
  });

  // ── 管理员：拒绝修改 ──────────────────────────────────────

  router.post('/:id/reject', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { change_log_id } = req.body;
      await db.run('UPDATE change_logs SET status = ? WHERE id = ?', ['rejected', change_log_id]);
      await db.run(
        'UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['rejected', req.params.id]
      );
      res.json({ message: '已拒绝' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '操作失败' });
    }
  });

  return router;
}
