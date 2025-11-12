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
        AND name NOT IN ('users', 'tasks', 'change_logs', 'uploaded_files', 'custom_tables', 'table_metadata')
        ORDER BY name
      `);
      res.json({ tables: tables.map((t: any) => t.name) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取表列表失败' });
    }
  });

  // 获取所有表的统计信息（表名和行数）
  router.get('/tables/stats', authenticate, async (req, res) => {
    try {
      const tables = await db.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%' 
        AND name NOT IN ('users', 'tasks', 'change_logs', 'uploaded_files', 'custom_tables', 'table_metadata')
        ORDER BY name
      `);

      const tableStats = await Promise.all(
        tables.map(async (table: any) => {
          try {
            const result = await db.query(`SELECT COUNT(*) as count FROM "${table.name}"`);
            const count = result[0]?.count || 0;
            return {
              tableName: table.name,
              rowCount: count
            };
          } catch (error) {
            console.error(`获取表 ${table.name} 的统计信息失败:`, error);
            return {
              tableName: table.name,
              rowCount: 0
            };
          }
        })
      );

      res.json({ tableStats });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取表统计信息失败' });
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

  // 获取指定表的列定义（用于复制列定义）
  router.get('/table/:tableName/columns', authenticate, async (req, res) => {
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
      
      // 获取原始列名
      const tableInfo = await db.get(
        'SELECT original_columns, display_name FROM custom_tables WHERE table_name = ?',
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
      
      res.json({ 
        tableName,
        displayName: tableInfo?.display_name || tableName,
        columns: originalColumns || []
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取列定义失败' });
    }
  });

  // 添加新数据行（仅管理员）
  router.post('/table/:tableName/row', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { tableName } = req.params;
      const { rowData } = req.body;
      
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
      
      // 获取原始列名
      const tableInfo = await db.get(
        'SELECT original_columns FROM custom_tables WHERE table_name = ?',
        [tableName]
      );
      
      if (!tableInfo || !tableInfo.original_columns) {
        return res.status(400).json({ error: '无法获取表的列定义' });
      }
      
      let originalColumns: string[] = [];
      try {
        originalColumns = JSON.parse(tableInfo.original_columns);
      } catch (e) {
        return res.status(400).json({ error: '解析列定义失败' });
      }
      
      // 清理列名的辅助函数（与创建表时保持一致）
      const cleanColumnName = (col: string) => {
        let cleanName = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        cleanName = cleanName.replace(/\r\n/g, '_');
        cleanName = cleanName.replace(/[()]/g, '_');
        cleanName = cleanName.replace(/\.(\d+)/g, '_$1');
        return cleanName;
      };
      
      // 自动生成 connection编号 和 Unique ID
      // 查找表中最大的 connection编号
      let maxConnectionNumber = 0;
      if (originalColumns.includes('connection编号')) {
        try {
          const connectionColName = cleanColumnName('connection编号');
          // 先尝试查找所有非空的connection编号值
          const allConnections = await db.query(
            `SELECT "${connectionColName}" FROM "${tableName}" WHERE "${connectionColName}" IS NOT NULL AND "${connectionColName}" != ''`
          );
          
          // 尝试解析为数字，找出最大值
          for (const row of allConnections) {
            const value = row[connectionColName];
            if (value) {
              const numValue = parseInt(String(value));
              if (!isNaN(numValue) && numValue > maxConnectionNumber) {
                maxConnectionNumber = numValue;
              }
            }
          }
        } catch (e) {
          console.log('获取最大connection编号失败，将从1开始:', e);
        }
      }
      
      const newConnectionNumber = maxConnectionNumber + 1;
      
      // 生成 Unique ID：使用时间戳 + 随机数确保唯一性
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const uniqueId = `${timestamp}_${random}`;
      
      // 准备数据，自动填充 connection编号 和 Unique ID
      const finalRowData = { ...rowData };
      if (originalColumns.includes('connection编号')) {
        finalRowData['connection编号'] = String(newConnectionNumber);
      }
      if (originalColumns.includes('Unique ID')) {
        finalRowData['Unique ID'] = uniqueId;
      }
      
      // 构建INSERT语句
      const columnNames = originalColumns.map(col => `"${cleanColumnName(col)}"`).join(', ');
      const placeholders = originalColumns.map(() => '?').join(', ');
      const values = originalColumns.map(colName => {
        const value = finalRowData[colName];
        return value !== undefined && value !== null ? String(value) : '';
      });
      
      // 插入数据
      await db.run(
        `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`,
        values
      );
      
      // 更新表元数据
      const insertedRow: any = {};
      originalColumns.forEach((colName, idx) => {
        const cleanName = cleanColumnName(colName);
        insertedRow[cleanName] = values[idx];
        insertedRow[colName] = values[idx]; // 也保存原始列名
      });
      
      // 更新元数据的辅助函数（内联定义）
      const updateTableMetadata = async (rowData: any) => {
        try {
          // 提取connection编号
          if (originalColumns.includes('connection编号')) {
            const connectionCol = cleanColumnName('connection编号');
            const connectionValue = rowData[connectionCol] || rowData['connection编号'];
            if (connectionValue && String(connectionValue).trim() !== '') {
              await db.run(
                `INSERT OR IGNORE INTO table_metadata (table_name, metadata_type, value) VALUES (?, ?, ?)`,
                [tableName, 'connection_number', String(connectionValue).trim()]
              );
            }
          }

          // 提取Unique ID
          if (originalColumns.includes('Unique ID')) {
            const uniqueIdCol = cleanColumnName('Unique ID');
            const uniqueIdValue = rowData[uniqueIdCol] || rowData['Unique ID'];
            if (uniqueIdValue && String(uniqueIdValue).trim() !== '') {
              await db.run(
                `INSERT OR IGNORE INTO table_metadata (table_name, metadata_type, value) VALUES (?, ?, ?)`,
                [tableName, 'unique_id', String(uniqueIdValue).trim()]
              );
            }
          }

          // 提取设备、连接器、针孔号
          const deviceColumnNames = ['设备', '设备_从'];
          const connectorColumnNames = ['连接器', '连接器_从'];
          const pinColumnNames = ['针孔号', '针孔号_从'];

          let deviceValue = '';
          let connectorValue = '';
          let pinValue = '';

          // 查找设备列
          for (const colName of deviceColumnNames) {
            if (originalColumns.includes(colName)) {
              const cleanCol = cleanColumnName(colName);
              deviceValue = rowData[cleanCol] || rowData[colName] || '';
              if (deviceValue && String(deviceValue).trim() !== '') {
                deviceValue = String(deviceValue).trim();
                break;
              }
            }
          }

          // 查找连接器列
          for (const colName of connectorColumnNames) {
            if (originalColumns.includes(colName)) {
              const cleanCol = cleanColumnName(colName);
              connectorValue = rowData[cleanCol] || rowData[colName] || '';
              if (connectorValue && String(connectorValue).trim() !== '') {
                connectorValue = String(connectorValue).trim();
                break;
              }
            }
          }

          // 查找针孔号列
          for (const colName of pinColumnNames) {
            if (originalColumns.includes(colName)) {
              const cleanCol = cleanColumnName(colName);
              pinValue = rowData[cleanCol] || rowData[colName] || '';
              if (pinValue && String(pinValue).trim() !== '') {
                pinValue = String(pinValue).trim();
                break;
              }
            }
          }

          // 保存设备
          if (deviceValue) {
            await db.run(
              `INSERT OR IGNORE INTO table_metadata (table_name, metadata_type, value) VALUES (?, ?, ?)`,
              [tableName, 'device', deviceValue]
            );
          }

          // 保存连接器（关联到设备）
          if (connectorValue && deviceValue) {
            await db.run(
              `INSERT OR IGNORE INTO table_metadata (table_name, metadata_type, value, parent_value) VALUES (?, ?, ?, ?)`,
              [tableName, 'connector', connectorValue, deviceValue]
            );
          }

          // 保存针孔号（关联到连接器）
          if (pinValue && connectorValue) {
            await db.run(
              `INSERT OR IGNORE INTO table_metadata (table_name, metadata_type, value, parent_value) VALUES (?, ?, ?, ?)`,
              [tableName, 'pin', pinValue, connectorValue]
            );
          }
        } catch (error) {
          console.error(`更新表元数据失败 (${tableName}):`, error);
        }
      };
      
      await updateTableMetadata(insertedRow);
      
      // 更新custom_tables中的记录数
      const countResult = await db.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
      const count = countResult[0]?.count || 0;
      await db.run(
        'UPDATE custom_tables SET record_count = ? WHERE table_name = ?',
        [count, tableName]
      );
      
      res.json({ 
        success: true,
        message: '数据添加成功',
        recordCount: count
      });
    } catch (error: any) {
      console.error('添加数据失败:', error);
      res.status(500).json({ error: error.message || '添加数据失败' });
    }
  });

  // 获取表的元数据（connection编号、Unique ID、设备、连接器、针孔号）
  router.get('/table/:tableName/metadata', authenticate, async (req, res) => {
    try {
      const { tableName } = req.params;
      const { type, parent } = req.query;
      
      // 安全验证
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
      
      let query = 'SELECT value, parent_value FROM table_metadata WHERE table_name = ?';
      const params: any[] = [tableName];
      
      if (type) {
        query += ' AND metadata_type = ?';
        params.push(type as string);
      }
      
      if (parent) {
        query += ' AND parent_value = ?';
        params.push(parent as string);
      }
      
      query += ' ORDER BY value';
      
      const metadata = await db.query(query, params);
      
      res.json({ 
        tableName,
        metadata: metadata.map((row: any) => ({
          value: row.value,
          parentValue: row.parent_value
        }))
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取元数据失败' });
    }
  });

  return router;
}


