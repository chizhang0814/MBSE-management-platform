import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';

export function templateRoutes(db: Database) {
  const router = express.Router();

  // 表类型常量
  const TABLE_TYPES = {
    ATA_DEVICE: 'ata_device', // ATA章节设备表
    DEVICE_COMPONENT: 'device_component', // 设备端元器件表
    ELECTRICAL_INTERFACE: 'electrical_interface' // 电气接口数据表
  };

  // 获取所有模板
  router.get('/', authenticate, async (req, res) => {
    try {
      const { table_type } = req.query;
      let query = `
        SELECT t.*, u.username as created_by_name 
        FROM templates t
        JOIN users u ON t.created_by = u.id
      `;
      const params: any[] = [];

      if (table_type) {
        query += ' WHERE t.table_type = ?';
        params.push(table_type);
      }

      query += ' ORDER BY t.created_at DESC';

      const templates = await db.query(query, params);
      res.json({ templates });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取模板列表失败' });
    }
  });

  // 获取单个模板详情
  router.get('/:id', authenticate, async (req, res) => {
    try {
      const template = await db.get(
        `SELECT t.*, u.username as created_by_name 
         FROM templates t
         JOIN users u ON t.created_by = u.id
         WHERE t.id = ?`,
        [req.params.id]
      );

      if (!template) {
        return res.status(404).json({ error: '模板不存在' });
      }

      // 解析columns JSON
      template.columns = JSON.parse(template.columns);
      res.json({ template });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取模板详情失败' });
    }
  });

  // 创建模板（仅管理员）
  router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { name, table_type, columns, description } = req.body;
      const userId = req.user!.id;

      // 验证输入
      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: '模板名称不能为空' });
      }

      if (!table_type || !Object.values(TABLE_TYPES).includes(table_type)) {
        return res.status(400).json({ 
          error: `表类型必须是以下之一: ${Object.values(TABLE_TYPES).join(', ')}` 
        });
      }

      if (!columns || !Array.isArray(columns) || columns.length === 0) {
        return res.status(400).json({ error: '至少需要定义一个列' });
      }

      // 验证和清理列名
      const cleanedColumns: string[] = [];
      const validationErrors: string[] = [];

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        
        if (!col || typeof col !== 'string') {
          validationErrors.push(`第${i + 1}列: 列名必须是字符串类型`);
          continue;
        }

        // 去除首尾空格和换行符
        const trimmed = col.trim().replace(/[\r\n]/g, '');
        
        if (!trimmed) {
          validationErrors.push(`第${i + 1}列: 列名不能为空`);
          continue;
        }

        // 检查是否包含非法字符（SQL注入相关字符）
        const dangerousChars = ["'", '"', ';', '--', '/*', '*/', 'xp_', 'sp_', 'exec', 'execute', 'drop', 'delete', 'truncate', 'alter', 'create', 'insert', 'update', 'select', 'union'];
        const lowerCol = trimmed.toLowerCase();
        
        for (const char of dangerousChars) {
          if (lowerCol.includes(char.toLowerCase())) {
            validationErrors.push(`第${i + 1}列 "${trimmed}": 包含非法字符 "${char}"`);
            break;
          }
        }

        // 检查长度
        if (trimmed.length > 100) {
          validationErrors.push(`第${i + 1}列 "${trimmed}": 列名长度不能超过100个字符`);
          continue;
        }

        cleanedColumns.push(trimmed);
      }

      if (validationErrors.length > 0) {
        return res.status(400).json({ 
          error: '列名验证失败：\n' + validationErrors.join('\n') 
        });
      }

      if (cleanedColumns.length === 0) {
        return res.status(400).json({ error: '至少需要定义一个有效的列' });
      }

      // 检查重复列名
      const uniqueColumns = new Set(cleanedColumns);
      if (uniqueColumns.size !== cleanedColumns.length) {
        return res.status(400).json({ error: '列名不能重复，请检查是否有重复的列名' });
      }

      // 检查同名模板是否存在
      const existing = await db.get(
        'SELECT id FROM templates WHERE name = ? AND table_type = ?',
        [name.trim(), table_type]
      );

      if (existing) {
        return res.status(400).json({ error: '该表类型下已存在同名模板' });
      }

      // 创建模板
      const result = await db.run(
        `INSERT INTO templates (name, table_type, columns, description, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [
          name.trim(),
          table_type,
          JSON.stringify(cleanedColumns),
          description ? description.trim() : null,
          userId
        ]
      );

      res.json({
        success: true,
        message: '模板创建成功',
        template: {
          id: result.lastID,
          name: name.trim(),
          table_type,
          columns: cleanedColumns,
          description
        }
      });
    } catch (error: any) {
      console.error('创建模板失败:', error);
      res.status(500).json({ error: error.message || '创建模板失败' });
    }
  });

  // 更新模板（仅管理员）
  router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { name, columns, description } = req.body;
      const templateId = parseInt(req.params.id);

      // 验证模板是否存在
      const existing = await db.get('SELECT * FROM templates WHERE id = ?', [templateId]);
      if (!existing) {
        return res.status(404).json({ error: '模板不存在' });
      }

      // 验证输入
      if (name && (typeof name !== 'string' || name.trim() === '')) {
        return res.status(400).json({ error: '模板名称不能为空' });
      }

      let cleanedColumns: string[] | undefined = undefined;
      
      if (columns) {
        if (!Array.isArray(columns) || columns.length === 0) {
          return res.status(400).json({ error: '至少需要定义一个列' });
        }

        // 验证和清理列名
        const validationErrors: string[] = [];
        cleanedColumns = [];

        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          
          if (!col || typeof col !== 'string') {
            validationErrors.push(`第${i + 1}列: 列名必须是字符串类型`);
            continue;
          }

          // 去除首尾空格和换行符
          const trimmed = col.trim().replace(/[\r\n]/g, '');
          
          if (!trimmed) {
            validationErrors.push(`第${i + 1}列: 列名不能为空`);
            continue;
          }

          // 检查是否包含非法字符
          const dangerousChars = ["'", '"', ';', '--', '/*', '*/', 'xp_', 'sp_', 'exec', 'execute', 'drop', 'delete', 'truncate', 'alter', 'create', 'insert', 'update', 'select', 'union'];
          const lowerCol = trimmed.toLowerCase();
          
          for (const char of dangerousChars) {
            if (lowerCol.includes(char.toLowerCase())) {
              validationErrors.push(`第${i + 1}列 "${trimmed}": 包含非法字符 "${char}"`);
              break;
            }
          }

          // 检查长度
          if (trimmed.length > 100) {
            validationErrors.push(`第${i + 1}列 "${trimmed}": 列名长度不能超过100个字符`);
            continue;
          }

          cleanedColumns.push(trimmed);
        }

        if (validationErrors.length > 0) {
          return res.status(400).json({ 
            error: '列名验证失败：\n' + validationErrors.join('\n') 
          });
        }

        if (cleanedColumns.length === 0) {
          return res.status(400).json({ error: '至少需要定义一个有效的列' });
        }

        // 检查重复列名
        const uniqueColumns = new Set(cleanedColumns);
        if (uniqueColumns.size !== cleanedColumns.length) {
          return res.status(400).json({ error: '列名不能重复，请检查是否有重复的列名' });
        }
      }

      // 检查同名模板是否存在（如果修改了名称）
      if (name && name.trim() !== existing.name) {
        const duplicate = await db.get(
          'SELECT id FROM templates WHERE name = ? AND table_type = ? AND id != ?',
          [name.trim(), existing.table_type, templateId]
        );

        if (duplicate) {
          return res.status(400).json({ error: '该表类型下已存在同名模板' });
        }
      }

      // 更新模板
      const updates: string[] = [];
      const params: any[] = [];

      if (name) {
        updates.push('name = ?');
        params.push(name.trim());
      }

      if (columns && cleanedColumns) {
        updates.push('columns = ?');
        params.push(JSON.stringify(cleanedColumns));
      }

      if (description !== undefined) {
        updates.push('description = ?');
        params.push(description ? description.trim() : null);
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(templateId);

      await db.run(
        `UPDATE templates SET ${updates.join(', ')} WHERE id = ?`,
        params
      );

      res.json({
        success: true,
        message: '模板更新成功'
      });
    } catch (error: any) {
      console.error('更新模板失败:', error);
      res.status(500).json({ error: error.message || '更新模板失败' });
    }
  });

  // 删除模板（仅管理员）
  router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);

      // 检查模板是否存在
      const existing = await db.get('SELECT * FROM templates WHERE id = ?', [templateId]);
      if (!existing) {
        return res.status(404).json({ error: '模板不存在' });
      }

      // 检查是否有project使用此模板
      const usedBy = await db.query(
        'SELECT COUNT(*) as count FROM project_tables WHERE template_id = ?',
        [templateId]
      );

      if (usedBy[0].count > 0) {
        return res.status(400).json({ 
          error: '该模板正在被项目使用，无法删除' 
        });
      }

      // 删除模板
      await db.run('DELETE FROM templates WHERE id = ?', [templateId]);

      res.json({
        success: true,
        message: '模板删除成功'
      });
    } catch (error: any) {
      console.error('删除模板失败:', error);
      res.status(500).json({ error: error.message || '删除模板失败' });
    }
  });

  // 获取表类型列表
  router.get('/types/list', authenticate, (req, res) => {
    res.json({
      types: [
        { value: TABLE_TYPES.ATA_DEVICE, label: 'ATA章节设备表' },
        { value: TABLE_TYPES.DEVICE_COMPONENT, label: '设备端元器件表' },
        { value: TABLE_TYPES.ELECTRICAL_INTERFACE, label: '电气接口数据表' }
      ]
    });
  });

  return router;
}

