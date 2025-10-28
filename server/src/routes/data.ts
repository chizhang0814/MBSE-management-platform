import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';

export function dataRoutes(db: Database) {
  const router = express.Router();

  // 获取所有可用表
  router.get('/tables', authenticate, async (req, res) => {
    try {
      const tables = await db.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%' 
        AND name NOT IN ('users', 'tasks', 'change_logs', 'uploaded_files', 'custom_tables')
        ORDER BY name
      `);
      res.json({ tables: tables.map((t: any) => t.name) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取表列表失败' });
    }
  });

  // 获取指定表的所有数据
  router.get('/table/:tableName', authenticate, async (req, res) => {
    try {
      const { tableName } = req.params;
      
      // 安全验证：确保表名只包含字母、数字和下划线
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: '无效的表名' });
      }
      
      // 检查表是否存在
      const tableExists = await db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [tableName]
      );
      
      if (!tableExists) {
        return res.status(404).json({ error: '表不存在' });
      }
      
      const data = await db.query(`SELECT * FROM "${tableName}" ORDER BY id ASC`);
      
      // 获取原始列名
      const tableInfo = await db.get(
        'SELECT original_columns FROM custom_tables WHERE table_name = ?',
        [tableName]
      );
      
      let originalColumns = null;
      if (tableInfo && tableInfo.original_columns) {
        try {
          originalColumns = JSON.parse(tableInfo.original_columns);
        } catch (e) {
          console.error('解析列名失败:', e);
        }
      }
      
      res.json({ data, tableName, originalColumns });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取数据失败' });
    }
  });

  // 获取所有数据
  router.get('/', authenticate, async (req, res) => {
    try {
      const tableName = req.query.table as string;
      
      if (!tableName) {
        return res.status(400).json({ error: '请指定表名' });
      }
      
      // 安全验证
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: '无效的表名' });
      }
      
      const data = await db.query(`SELECT * FROM "${tableName}" ORDER BY id ASC`);
      
      // 获取原始列名
      const tableInfo = await db.get(
        'SELECT original_columns FROM custom_tables WHERE table_name = ?',
        [tableName]
      );
      
      let originalColumns = null;
      if (tableInfo && tableInfo.original_columns) {
        try {
          originalColumns = JSON.parse(tableInfo.original_columns);
        } catch (e) {
          console.error('解析列名失败:', e);
        }
      }
      
      res.json({ data, tableName, originalColumns });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取数据失败' });
    }
  });

  // 获取单条数据
  router.get('/item/:id', authenticate, async (req, res) => {
    try {
      const tableName = (req.query.table as string) || 'eicd_data';
      const data = await db.get(`SELECT * FROM "${tableName}" WHERE id = ?`, [req.params.id]);
      if (!data) {
        return res.status(404).json({ error: '数据不存在' });
      }
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: '获取数据失败' });
    }
  });

  // 管理员：更新数据
  router.put('/item/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { item_code, item_name, description, specification, unit, price, table_name } = req.body;
      const tableName = table_name || 'eicd_data';

      await db.run(
        `UPDATE "${tableName}" 
         SET item_code = ?, item_name = ?, description = ?, specification = ?, unit = ?, price = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [item_code, item_name, description, specification, unit, price, req.params.id]
      );

      res.json({ message: '更新成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '更新失败' });
    }
  });

  // 获取变更记录
  router.get('/item/:id/changes', authenticate, async (req, res) => {
    try {
      const changes = await db.query(
        `SELECT cl.*, u.username as changed_by_name 
         FROM change_logs cl 
         JOIN users u ON cl.changed_by = u.id 
         WHERE cl.data_id = ? 
         ORDER BY cl.created_at DESC`,
        [req.params.id]
      );
      res.json({ changes });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取变更记录失败' });
    }
  });

  return router;
}


