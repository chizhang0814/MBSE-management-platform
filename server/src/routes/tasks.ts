import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';

export function taskRoutes(db: Database) {
  const router = express.Router();

  // 管理员：创建任务
  router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { data_id, assigned_to, notes, table_name } = req.body;

      await db.run(
        'INSERT INTO tasks (data_id, table_name, assigned_by, assigned_to, notes, status) VALUES (?, ?, ?, ?, ?, ?)',
        [data_id, table_name || 'eicd_data', req.user!.id, assigned_to, notes, 'pending']
      );

      res.json({ message: '任务创建成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '创建任务失败' });
    }
  });

  // 获取所有任务
  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      // 先获取任务列表（不JOIN数据表）
      let tasksQuery;
      let params;

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

      // 为每个任务获取对应的数据（使用动态表名）
      const tasksWithData = await Promise.all(
        tasks.map(async (task: any) => {
          if (task.table_name) {
            try {
              const data = await db.get(
                `SELECT item_code, item_name FROM "${task.table_name}" WHERE id = ?`,
                [task.data_id]
              );
              return { ...task, item_code: data?.item_code || '', item_name: data?.item_name || '' };
            } catch (error) {
              // 表可能不存在，返回空值
              return { ...task, item_code: '', item_name: '' };
            }
          }
          return task;
        })
      );

      res.json({ tasks: tasksWithData });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取任务失败' });
    }
  });

  // 获取单个任务
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

      if (!task) {
        return res.status(404).json({ error: '任务不存在' });
      }

      // 获取对应的数据（使用动态表名）
      let data = null;
      if (task.table_name) {
        try {
          data = await db.get(
            `SELECT * FROM "${task.table_name}" WHERE id = ?`,
            [task.data_id]
          );
        } catch (error) {
          console.error('获取数据失败:', error);
        }
      }

      // 获取相关的变更日志（使用table_name过滤）
      let changeLogsQuery = 'SELECT * FROM change_logs WHERE data_id = ? AND table_name = ? AND status = ? ORDER BY created_at DESC';
      const changeLogs = await db.query(
        changeLogsQuery,
        [task.data_id, task.table_name || 'eicd_data', 'pending']
      );

      res.json({ task: { ...task, ...data }, changeLogs });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取任务失败' });
    }
  });

  // 审查员：提交审查结果
  router.post('/:id/submit', authenticate, requireRole('reviewer'), async (req: AuthRequest, res) => {
    try {
      const { needs_change, changes, reason, table_name } = req.body;
      const taskId = req.params.id;

      // 获取任务信息以确定table_name
      const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
      const taskTableName = table_name || task?.table_name || 'eicd_data';

      if (needs_change && changes) {
        // 需要修改，创建变更日志
        const result = await db.run(
          `INSERT INTO change_logs (data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [req.body.data_id, taskTableName, req.user!.id, JSON.stringify(req.body.old_values), JSON.stringify(changes), reason, 'pending']
        );

        await db.run(
          'UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['submitted', taskId]
        );

        res.json({ message: '提交成功', changeLogId: result.lastID });
      } else {
        // 无需修改
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

  // 管理员：确认修改
  router.post('/:id/confirm', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { change_log_id } = req.body;

      // 获取变更日志
      const changeLog = await db.get('SELECT * FROM change_logs WHERE id = ?', [change_log_id]);

      if (!changeLog || changeLog.status !== 'pending') {
        return res.status(400).json({ error: '无效的变更日志' });
      }

      const newValues = JSON.parse(changeLog.new_values);
      const tableName = changeLog.table_name || 'eicd_data';

      // 更新数据（使用动态表名）
      await db.run(
        `UPDATE "${tableName}"
         SET item_code = ?, item_name = ?, description = ?, specification = ?, unit = ?, price = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newValues.item_code, newValues.item_name, newValues.description, newValues.specification, newValues.unit, newValues.price, changeLog.data_id]
      );

      // 更新变更日志状态
      await db.run(
        'UPDATE change_logs SET status = ? WHERE id = ?',
        ['approved', change_log_id]
      );

      // 更新任务状态
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

  // 管理员：拒绝修改
  router.post('/:id/reject', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { change_log_id, reason } = req.body;

      await db.run(
        'UPDATE change_logs SET status = ? WHERE id = ?',
        ['rejected', change_log_id]
      );

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
