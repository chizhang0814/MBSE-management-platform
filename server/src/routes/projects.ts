import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import fs from 'fs';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';
import { columnSchemaMap, TableType } from '../shared/column-schema.js';
import { generateSysml, TableData } from '../services/sysml-generator.js';
import { SysmlApiClient } from '../services/sysml-api-client.js';
import { syncToSysmlApi } from '../services/sysml-sync.js';

export function projectRoutes(db: Database) {
  const router = express.Router();

  // 配置multer用于文件上传
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + file.originalname);
    },
  });

  const upload = multer({ storage });

  // 表类型常量
  const TABLE_TYPES = {
    ATA_DEVICE: 'ata_device',
    DEVICE_COMPONENT: 'device_component',
    ELECTRICAL_INTERFACE: 'electrical_interface'
  };

  // 清理列名的辅助函数
  const cleanColumnName = (col: string) => {
    let cleanName = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
    cleanName = cleanName.replace(/\r\n/g, '_');
    cleanName = cleanName.replace(/[()]/g, '_');
    cleanName = cleanName.replace(/\.(\d+)/g, '_$1');
    return cleanName;
  };

  // 创建动态表的辅助函数
  const createDynamicTable = async (tableName: string, columns: string[]) => {
    const columnDefinitions = columns.map(col => {
      return `"${cleanColumnName(col)}" TEXT`;
    }).join(',\n          ');
    
    await db.run(`
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${columnDefinitions},
        status TEXT DEFAULT 'normal',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  };

  // 获取所有项目
  router.get('/', authenticate, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const username = req.user?.username;
      
      let projects;
      
      if (userRole === 'admin') {
        // 管理员可以看到所有项目
        projects = await db.query(`
          SELECT p.*, u.username as created_by_name,
                 (SELECT COUNT(*) FROM project_tables WHERE project_id = p.id) as table_count
          FROM projects p
          JOIN users u ON p.created_by = u.id
          ORDER BY p.created_at DESC
        `);
      } else {
        // 普通用户：查找用户作为"设备负责人"出现在数据表中的项目
        // 查询所有项目的ATA章节设备表，找到"设备负责人"字段等于当前用户名的记录
        const allProjects = await db.query(`
          SELECT DISTINCT p.id, p.name, p.description, p.created_by, p.created_at, p.updated_at
          FROM projects p
          JOIN project_tables pt ON p.id = pt.project_id
          WHERE pt.table_type = 'ata_device'
        `);
        
        const userProjects: any[] = [];
        
        for (const project of allProjects) {
          // 获取该项目的ATA章节设备表
          const ataTable = await db.get(
            `SELECT table_name FROM project_tables 
             WHERE project_id = ? AND table_type = 'ata_device'`,
            [project.id]
          );
          
          if (ataTable) {
            try {
              // 获取表的列信息
              const tableInfo = await db.query(`PRAGMA table_info("${ataTable.table_name}")`);
              // 查找"设备负责人"列（可能是原始列名或清理后的列名）
              const deviceManagerCol = tableInfo.find((col: any) => 
                col.name === '设备负责人' || col.name.includes('设备负责人')
              );
              
              if (deviceManagerCol) {
                // 查询该表中是否有该用户作为设备负责人的记录
                const cleanColName = deviceManagerCol.name;
                const result = await db.get(
                  `SELECT COUNT(*) as count FROM "${ataTable.table_name}" 
                   WHERE "${cleanColName}" = ?`,
                  [username]
                );
                
                if (result && (result as any).count > 0) {
                  // 用户在该项目的数据表中出现，添加到结果中
                  const createdByUser = await db.get(
                    'SELECT username FROM users WHERE id = ?',
                    [project.created_by]
                  );
                  
                  const tableCount = await db.get(
                    'SELECT COUNT(*) as count FROM project_tables WHERE project_id = ?',
                    [project.id]
                  );
                  
                  userProjects.push({
                    ...project,
                    created_by_name: createdByUser?.username || '',
                    table_count: (tableCount as any)?.count || 0
                  });
                }
              }
            } catch (error) {
              // 如果查询失败，跳过该项目
              console.error(`查询项目 ${project.id} 的数据表失败:`, error);
            }
          }
        }
        
        projects = userProjects;
      }
      
      res.json({ projects });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取项目列表失败' });
    }
  });

  // SysML v2 API 健康检查（放在 /:id 之前，避免被捕获）
  router.get('/sysml-api/health', authenticate, async (req, res) => {
    try {
      const client = new SysmlApiClient();
      const available = await client.healthCheck();
      res.json({ available });
    } catch {
      res.json({ available: false });
    }
  });

  // 获取单个项目详情（包含数据表信息）
  router.get('/:id', authenticate, async (req, res) => {
    try {
      const project = await db.get(
        `SELECT p.*, u.username as created_by_name 
         FROM projects p
         JOIN users u ON p.created_by = u.id
         WHERE p.id = ?`,
        [req.params.id]
      );

      if (!project) {
        return res.status(404).json({ error: '项目不存在' });
      }

      // 获取项目的数据表
      const tables = await db.query(
        `SELECT pt.*, t.name as template_name
         FROM project_tables pt
         LEFT JOIN templates t ON pt.template_id = t.id
         WHERE pt.project_id = ?
         ORDER BY pt.table_type`,
        [req.params.id]
      );

      project.tables = tables;
      res.json({ project });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取项目详情失败' });
    }
  });

  // 创建项目（仅管理员）
  router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { name, description, templates } = req.body;
      const userId = req.user!.id;

      // 验证输入
      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: '项目名称不能为空' });
      }

      // 验证模板选择（必须为三个表类型各选择一个模板）
      if (!templates || typeof templates !== 'object') {
        return res.status(400).json({ error: '必须为三个表类型各选择一个模板' });
      }

      const requiredTypes = Object.values(TABLE_TYPES);
      for (const type of requiredTypes) {
        if (!templates[type] || typeof templates[type] !== 'number') {
          return res.status(400).json({ error: `必须为${type}选择一个模板` });
        }
      }

      // 检查项目名称是否已存在
      const existing = await db.get('SELECT id FROM projects WHERE name = ?', [name.trim()]);
      if (existing) {
        return res.status(400).json({ error: '项目名称已存在' });
      }

      // 验证模板是否存在并获取列定义
      const templateColumns: Record<string, string[]> = {};
      for (const [type, templateId] of Object.entries(templates)) {
        const template = await db.get('SELECT * FROM templates WHERE id = ?', [templateId]);
        if (!template) {
          return res.status(400).json({ error: `模板ID ${templateId} 不存在` });
        }
        templateColumns[type] = JSON.parse(template.columns);
      }

      // 开始事务：创建项目
      const projectResult = await db.run(
        `INSERT INTO projects (name, description, created_by)
         VALUES (?, ?, ?)`,
        [name.trim(), description || null, userId]
      );

      const projectId = projectResult.lastID;

      // 为每个表类型创建数据表
      const tableNames: Record<string, string> = {};
      const tableTypeLabels: Record<string, string> = {
        [TABLE_TYPES.ATA_DEVICE]: 'ATA章节设备表',
        [TABLE_TYPES.DEVICE_COMPONENT]: '设备端元器件表',
        [TABLE_TYPES.ELECTRICAL_INTERFACE]: '电气接口数据表'
      };

      for (const [type, templateId] of Object.entries(templates)) {
        // 生成表名：project_{projectId}_{type}
        const tableName = `project_${projectId}_${type}`;
        const columns = templateColumns[type];

        // 创建数据表
        await createDynamicTable(tableName, columns);

        // 记录到project_tables
        await db.run(
          `INSERT INTO project_tables (project_id, table_type, table_name, template_id, display_name)
           VALUES (?, ?, ?, ?, ?)`,
          [
            projectId,
            type,
            tableName,
            templateId,
            tableTypeLabels[type] || type
          ]
        );

        // 记录到custom_tables（保持兼容性）
        await db.run(
          `INSERT OR IGNORE INTO custom_tables (table_name, display_name, original_columns, created_by, record_count)
           VALUES (?, ?, ?, ?, ?)`,
          [
            tableName,
            tableTypeLabels[type] || type,
            JSON.stringify(columns),
            userId,
            0
          ]
        );

        tableNames[type] = tableName;
      }

      res.json({
        success: true,
        message: '项目创建成功',
        project: {
          id: projectId,
          name: name.trim(),
          description,
          tables: tableNames
        }
      });
    } catch (error: any) {
      console.error('创建项目失败:', error);
      res.status(500).json({ error: error.message || '创建项目失败' });
    }
  });

  // 更新项目（仅管理员）
  router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { name, description } = req.body;
      const projectId = parseInt(req.params.id);

      // 验证项目是否存在
      const existing = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!existing) {
        return res.status(404).json({ error: '项目不存在' });
      }

      // 验证输入
      if (name && (typeof name !== 'string' || name.trim() === '')) {
        return res.status(400).json({ error: '项目名称不能为空' });
      }

      // 检查项目名称是否已存在（如果修改了名称）
      if (name && name.trim() !== existing.name) {
        const duplicate = await db.get(
          'SELECT id FROM projects WHERE name = ? AND id != ?',
          [name.trim(), projectId]
        );

        if (duplicate) {
          return res.status(400).json({ error: '项目名称已存在' });
        }
      }

      // 更新项目
      const updates: string[] = [];
      const params: any[] = [];

      if (name) {
        updates.push('name = ?');
        params.push(name.trim());
      }

      if (description !== undefined) {
        updates.push('description = ?');
        params.push(description || null);
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(projectId);

      await db.run(
        `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
        params
      );

      res.json({
        success: true,
        message: '项目更新成功'
      });
    } catch (error: any) {
      console.error('更新项目失败:', error);
      res.status(500).json({ error: error.message || '更新项目失败' });
    }
  });

  // 删除项目（仅管理员）
  router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);

      // 检查项目是否存在
      const existing = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!existing) {
        return res.status(404).json({ error: '项目不存在' });
      }

      // 获取项目的数据表
      const tables = await db.query(
        'SELECT table_name FROM project_tables WHERE project_id = ?',
        [projectId]
      );

      // 删除数据表（CASCADE会自动删除project_tables记录）
      for (const table of tables) {
        try {
          await db.run(`DROP TABLE IF EXISTS "${table.table_name}"`);
          await db.run('DELETE FROM custom_tables WHERE table_name = ?', [table.table_name]);
          await db.run('DELETE FROM table_metadata WHERE table_name = ?', [table.table_name]);
        } catch (error) {
          console.error(`删除表 ${table.table_name} 失败:`, error);
        }
      }

      // 删除项目（CASCADE会自动删除project_tables记录）
      await db.run('DELETE FROM projects WHERE id = ?', [projectId]);

      res.json({
        success: true,
        message: '项目删除成功'
      });
    } catch (error: any) {
      console.error('删除项目失败:', error);
      res.status(500).json({ error: error.message || '删除项目失败' });
    }
  });

  // 复制项目（仅管理员）
  router.post('/:id/duplicate', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const sourceProjectId = parseInt(req.params.id);
      const { name } = req.body;
      const userId = req.user!.id;

      // 验证输入
      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: '新项目名称不能为空' });
      }

      // 获取源项目
      const sourceProject = await db.get('SELECT * FROM projects WHERE id = ?', [sourceProjectId]);
      if (!sourceProject) {
        return res.status(404).json({ error: '源项目不存在' });
      }

      // 检查新项目名称是否已存在
      const existing = await db.get('SELECT id FROM projects WHERE name = ?', [name.trim()]);
      if (existing) {
        return res.status(400).json({ error: '项目名称已存在' });
      }

      // 获取源项目的数据表
      const sourceTables = await db.query(
        `SELECT pt.*, t.columns as template_columns
         FROM project_tables pt
         LEFT JOIN templates t ON pt.template_id = t.id
         WHERE pt.project_id = ?`,
        [sourceProjectId]
      );

      if (sourceTables.length === 0) {
        return res.status(400).json({ error: '源项目没有数据表' });
      }

      // 创建新项目
      const projectResult = await db.run(
        `INSERT INTO projects (name, description, created_by)
         VALUES (?, ?, ?)`,
        [name.trim(), sourceProject.description, userId]
      );

      const newProjectId = projectResult.lastID;

      // 复制数据表
      const tableNames: Record<string, string> = {};
      for (const sourceTable of sourceTables) {
        const newTableName = `project_${newProjectId}_${sourceTable.table_type}`;
        let columns: string[] = [];

        // 获取列定义（从模板或从现有表结构）
        if (sourceTable.template_columns) {
          columns = JSON.parse(sourceTable.template_columns);
        } else {
          // 从现有表获取列定义
          const tableInfo = await db.query(`PRAGMA table_info("${sourceTable.table_name}")`);
          columns = tableInfo
            .filter((col: any) => !['id', 'status', 'created_at', 'updated_at'].includes(col.name))
            .map((col: any) => col.name);
        }

        // 创建新数据表
        await createDynamicTable(newTableName, columns);

        // 记录到project_tables
        await db.run(
          `INSERT INTO project_tables (project_id, table_type, table_name, template_id, display_name)
           VALUES (?, ?, ?, ?, ?)`,
          [
            newProjectId,
            sourceTable.table_type,
            newTableName,
            sourceTable.template_id,
            sourceTable.display_name
          ]
        );

        // 记录到custom_tables
        await db.run(
          `INSERT OR IGNORE INTO custom_tables (table_name, display_name, original_columns, created_by, record_count)
           VALUES (?, ?, ?, ?, ?)`,
          [
            newTableName,
            sourceTable.display_name,
            JSON.stringify(columns),
            userId,
            0
          ]
        );

        // 复制数据（如果源表有数据）
        try {
          const sourceData = await db.query(`SELECT * FROM "${sourceTable.table_name}"`);
          if (sourceData.length > 0) {
            const columnNames = columns.map(col => `"${cleanColumnName(col)}"`).join(', ');
            const placeholders = columns.map(() => '?').join(', ');

            for (const row of sourceData) {
              const values = columns.map((col: string) => {
                const cleanCol = cleanColumnName(col);
                return row[cleanCol] || row[col] || '';
              });

              await db.run(
                `INSERT INTO "${newTableName}" (${columnNames}) VALUES (${placeholders})`,
                values
              );
            }
          }
        } catch (error) {
          console.error(`复制表数据失败 ${sourceTable.table_name}:`, error);
        }

        tableNames[sourceTable.table_type] = newTableName;
      }

      res.json({
        success: true,
        message: '项目复制成功',
        project: {
          id: newProjectId,
          name: name.trim(),
          tables: tableNames
        }
      });
    } catch (error: any) {
      console.error('复制项目失败:', error);
      res.status(500).json({ error: error.message || '复制项目失败' });
    }
  });

  // 下载项目数据（生成包含三个sheet的xlsx文件）
  router.get('/:id/download', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.params.id);

      // 验证项目是否存在
      const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!project) {
        return res.status(404).json({ error: '项目不存在' });
      }

      // 获取项目的数据表
      const projectTables = await db.query(
        'SELECT * FROM project_tables WHERE project_id = ? ORDER BY table_type',
        [projectId]
      );

      if (projectTables.length !== 3) {
        return res.status(400).json({ error: '项目必须包含三个数据表' });
      }

      // Sheet顺序：第一个是ATA章节设备表，第二个是设备端元器件表，第三个是电气接口数据表
      const sheetOrder = [
        TABLE_TYPES.ATA_DEVICE,
        TABLE_TYPES.DEVICE_COMPONENT,
        TABLE_TYPES.ELECTRICAL_INTERFACE
      ];

      const sheetNames = [
        'ATA章节设备表',
        '设备端元器件表',
        '电气接口数据表'
      ];

      // 创建新的工作簿
      const workbook = xlsx.utils.book_new();

      // 处理每个表
      for (let i = 0; i < 3; i++) {
        const tableType = sheetOrder[i];
        const sheetName = sheetNames[i];
        const projectTable = projectTables.find(pt => pt.table_type === tableType);

        if (!projectTable) {
          // 如果表不存在，创建空sheet
          const emptySheet = xlsx.utils.aoa_to_sheet([[]]);
          xlsx.utils.book_append_sheet(workbook, emptySheet, sheetName);
          continue;
        }

        // 获取表的原始列定义
        const tableInfo = await db.get(
          'SELECT original_columns FROM custom_tables WHERE table_name = ?',
          [projectTable.table_name]
        );

        let originalColumns: string[] = [];
        if (tableInfo && tableInfo.original_columns) {
          try {
            originalColumns = JSON.parse(tableInfo.original_columns);
          } catch (e) {
            console.error('解析列定义失败:', e);
            // 如果解析失败，从表结构获取列名
            const tableInfo2 = await db.query(`PRAGMA table_info("${projectTable.table_name}")`);
            originalColumns = tableInfo2
              .filter((col: any) => !['id', 'status', 'created_at', 'updated_at'].includes(col.name))
              .map((col: any) => col.name);
          }
        } else {
          // 如果没有原始列定义，从表结构获取
          const tableInfo2 = await db.query(`PRAGMA table_info("${projectTable.table_name}")`);
          originalColumns = tableInfo2
            .filter((col: any) => !['id', 'status', 'created_at', 'updated_at'].includes(col.name))
            .map((col: any) => col.name);
        }

        // 获取表数据
        const tableData = await db.query(`SELECT * FROM "${projectTable.table_name}" ORDER BY id ASC`);

        // 准备数据行
        const rows: any[][] = [];
        
        // 添加表头（使用原始列名）
        rows.push(originalColumns);

        // JSON字段解析辅助函数
        const isJsonColumn = (columnName: string): boolean => {
          const jsonColumns = ['设备', '设备_从', '设备_到'];
          return jsonColumns.includes(columnName);
        };

        const parseJsonValue = (value: any, columnName: string): any => {
          if (!isJsonColumn(columnName)) {
            return value;
          }
          
          if (typeof value === 'string' && value.trim() !== '') {
            try {
              return JSON.parse(value);
            } catch (e) {
              return value;
            }
          }
          
          return value;
        };

        // 添加数据行
        for (const row of tableData) {
          const dataRow: any[] = [];
          for (const col of originalColumns) {
            // 尝试使用清理后的列名和原始列名
            const cleanCol = cleanColumnName(col);
            let value = row[col] || row[cleanCol] || '';
            // 如果是JSON列，解析JSON字符串
            value = parseJsonValue(value, col);
            
            // 如果是对象或数组，格式化为JSON字符串以便在Excel中正确显示
            if (typeof value === 'object' && value !== null) {
              try {
                value = JSON.stringify(value, null, 2);
              } catch (e) {
                // 如果序列化失败，使用默认的toString
                value = String(value);
              }
            }
            
            dataRow.push(value);
          }
          rows.push(dataRow);
        }

        // 创建sheet
        const worksheet = xlsx.utils.aoa_to_sheet(rows);
        xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
      }

      // 生成Excel文件buffer
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // 设置响应头
      const filename = `${project.name}_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      
      res.send(buffer);
    } catch (error: any) {
      console.error('下载项目数据失败:', error);
      res.status(500).json({ error: error.message || '下载项目数据失败' });
    }
  });

  // 导出 SysML v2 文本文件
  router.get('/:id/export-sysml', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.params.id);

      // 验证项目是否存在
      const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!project) {
        return res.status(404).json({ error: '项目不存在' });
      }

      // 获取项目的数据表
      const projectTables = await db.query(
        'SELECT * FROM project_tables WHERE project_id = ? ORDER BY table_type',
        [projectId]
      );

      const sheetOrder: TableType[] = ['ata_device', 'device_component', 'electrical_interface'];
      const tablesData: TableData[] = [];

      for (const tableType of sheetOrder) {
        const projectTable = projectTables.find((pt: any) => pt.table_type === tableType);
        if (!projectTable) continue;

        // 获取原始列定义
        const tableInfo = await db.get(
          'SELECT original_columns FROM custom_tables WHERE table_name = ?',
          [projectTable.table_name]
        );

        let originalColumns: string[] = [];
        if (tableInfo && tableInfo.original_columns) {
          try {
            originalColumns = JSON.parse(tableInfo.original_columns);
          } catch {
            const cols = await db.query(`PRAGMA table_info("${projectTable.table_name}")`);
            originalColumns = cols
              .filter((c: any) => !['id', 'status', 'created_at', 'updated_at'].includes(c.name))
              .map((c: any) => c.name);
          }
        } else {
          const cols = await db.query(`PRAGMA table_info("${projectTable.table_name}")`);
          originalColumns = cols
            .filter((c: any) => !['id', 'status', 'created_at', 'updated_at'].includes(c.name))
            .map((c: any) => c.name);
        }

        // 获取表数据
        const rows = await db.query(`SELECT * FROM "${projectTable.table_name}" ORDER BY id ASC`);

        tablesData.push({
          tableType: tableType as TableType,
          originalColumns,
          rows,
        });
      }

      // 生成 SysML v2 文本
      const sysmlText = generateSysml(project.name, tablesData);

      // 返回 .sysml 文件下载
      const filename = `${project.name}_${new Date().toISOString().split('T')[0]}.sysml`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(sysmlText);
    } catch (error: any) {
      console.error('导出SysML失败:', error);
      res.status(500).json({ error: error.message || '导出SysML失败' });
    }
  });

  // 导入项目初始数据（三个sheet的xlsx文件）
  router.post(
    '/:id/import-data',
    authenticate,
    requireRole('admin'),
    upload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        const projectId = parseInt(req.params.id);

        if (!req.file) {
          return res.status(400).json({ error: '未选择文件' });
        }

        // 验证项目是否存在
        const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
        if (!project) {
          return res.status(404).json({ error: '项目不存在' });
        }

        // 获取项目的数据表
        const projectTables = await db.query(
          'SELECT * FROM project_tables WHERE project_id = ? ORDER BY table_type',
          [projectId]
        );

        if (projectTables.length !== 3) {
          return res.status(400).json({ error: '项目必须包含三个数据表' });
        }

        // 读取xlsx文件
        const workbook = xlsx.readFile(req.file.path);
        const sheetNames = workbook.SheetNames;

        if (sheetNames.length < 3) {
          return res.status(400).json({ error: 'Excel文件必须包含至少三个sheet' });
        }

        // Sheet顺序：第一个是ATA章节设备表，第二个是设备端元器件表，第三个是电气接口数据表
        const sheetOrder = [
          TABLE_TYPES.ATA_DEVICE,
          TABLE_TYPES.DEVICE_COMPONENT,
          TABLE_TYPES.ELECTRICAL_INTERFACE
        ];

        const results: any = {};
        let totalSuccess = 0;
        let totalError = 0;

        // 导入每个sheet的数据（只导入前两个：ATA章节设备表和设备端元器件表）
        for (let i = 0; i < 2; i++) {
          const tableType = sheetOrder[i];
          const sheetName = sheetNames[i];
          const projectTable = projectTables.find(pt => pt.table_type === tableType);

          if (!projectTable) {
            results[tableType] = { error: `找不到表类型 ${tableType} 的数据表` };
            continue;
          }

          const worksheet = workbook.Sheets[sheetName];
          const jsonData = xlsx.utils.sheet_to_json(worksheet);

          if (!Array.isArray(jsonData) || jsonData.length === 0) {
            results[tableType] = { success: 0, error: 0, message: 'Sheet中没有数据' };
            continue;
          }

          // 获取列名
          const originalColumns = Object.keys(jsonData[0]);
          const tableName = projectTable.table_name;

          // 获取表的实际列定义
          const tableInfo = await db.query(`PRAGMA table_info("${tableName}")`);
          const tableColumns = tableInfo
            .filter((col: any) => !['id', 'status', 'created_at', 'updated_at'].includes(col.name))
            .map((col: any) => col.name);

          // 批量导入数据
          let successCount = 0;
          let errorCount = 0;
          const errors: string[] = [];

          // 唯一性检查：根据表类型查找需要检查的列
          let uniqueCheckColumns: { original: string; clean: string; label: string }[] = [];
          
          if (tableType === TABLE_TYPES.ATA_DEVICE) {
            // ATA章节设备表：检查设备编号和设备LIN号
            const deviceNumberCol = originalColumns.find(col => 
              col.includes('设备编号') || col === '设备编号'
            );
            const deviceLINCol = originalColumns.find(col => 
              col.includes('设备LIN号') || col === '设备LIN号' || col.includes('LIN号')
            );
            
            if (deviceNumberCol) {
              uniqueCheckColumns.push({
                original: deviceNumberCol,
                clean: cleanColumnName(deviceNumberCol),
                label: '设备编号'
              });
            }
            if (deviceLINCol) {
              uniqueCheckColumns.push({
                original: deviceLINCol,
                clean: cleanColumnName(deviceLINCol),
                label: '设备LIN号'
              });
            }
          } else if (tableType === TABLE_TYPES.DEVICE_COMPONENT) {
            // 设备端元器件表：检查设备端元器件编号
            const componentNumberCol = originalColumns.find(col => 
              col.includes('设备端元器件编号') || col === '设备端元器件编号' ||
              col.includes('端元器件编号') || col.includes('连接器号')
            );
            
            if (componentNumberCol) {
              uniqueCheckColumns.push({
                original: componentNumberCol,
                clean: cleanColumnName(componentNumberCol),
                label: '设备端元器件编号'
              });
            }
          }

          for (let j = 0; j < jsonData.length; j++) {
            const row = jsonData[j];
            const rowNumber = j + 2;

            try {
              // 唯一性检查
              let hasDuplicate = false;
              const duplicateFields: string[] = [];
              
              for (const checkCol of uniqueCheckColumns) {
                const value = (row as any)[checkCol.original];
                if (value !== undefined && value !== null && String(value).trim() !== '') {
                  const cleanValue = String(value).trim();
                  const cleanCol = checkCol.clean;
                  
                  // 查询表中是否已存在该值
                  const existing = await db.get(
                    `SELECT id FROM "${tableName}" WHERE "${cleanCol}" = ?`,
                    [cleanValue]
                  );
                  
                  if (existing) {
                    hasDuplicate = true;
                    duplicateFields.push(`${checkCol.label}: ${cleanValue}`);
                  }
                }
              }
              
              if (hasDuplicate) {
                errorCount++;
                errors.push(`第${rowNumber}行：数据重复，冲突字段 - ${duplicateFields.join('，')}`);
                continue; // 跳过该行，不插入
              }

              // 构建INSERT语句（只插入表中存在的列）
              const insertColumns: string[] = [];
              const insertValues: any[] = [];

              // JSON字段处理辅助函数
              const isJsonColumn = (columnName: string): boolean => {
                const jsonColumns = ['设备', '设备_从', '设备_到'];
                return jsonColumns.includes(columnName);
              };

              const stringifyJsonValue = (value: any, columnName: string): string => {
                if (!isJsonColumn(columnName)) {
                  return value !== undefined && value !== null ? String(value) : '';
                }
                
                // 如果是对象或数组，序列化为JSON字符串
                if (typeof value === 'object' && value !== null) {
                  try {
                    return JSON.stringify(value);
                  } catch (e) {
                    console.error(`序列化JSON失败 (${columnName}):`, e);
                    return '';
                  }
                }
                
                // 如果已经是JSON字符串，直接返回
                if (typeof value === 'string') {
                  return value;
                }
                
                return value !== undefined && value !== null ? String(value) : '';
              };

              for (const col of originalColumns) {
                const cleanCol = cleanColumnName(col);
                if (tableColumns.includes(cleanCol)) {
                  insertColumns.push(`"${cleanCol}"`);
                  const value = (row as any)[col];
                  insertValues.push(stringifyJsonValue(value, col));
                }
              }

              if (insertColumns.length > 0) {
                const columnNames = insertColumns.join(', ');
                const placeholders = insertColumns.map(() => '?').join(', ');

                await db.run(
                  `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`,
                  insertValues
                );

                successCount++;
              } else {
                errorCount++;
                errors.push(`第${rowNumber}行：没有匹配的列`);
              }
            } catch (error: any) {
              errorCount++;
              errors.push(`第${rowNumber}行导入失败: ${error.message}`);
              if (errors.length >= 20) break;
            }
          }

          totalSuccess += successCount;
          totalError += errorCount;

          results[tableType] = {
            sheetName,
            successCount,
            errorCount,
            errors: errors.slice(0, 50) // 增加错误信息数量，以便显示更多详细信息
          };
        }
        
        // 跳过电气接口数据表（第三个sheet）
        if (sheetNames.length > 2) {
          results[TABLE_TYPES.ELECTRICAL_INTERFACE] = {
            sheetName: sheetNames[2],
            successCount: 0,
            errorCount: 0,
            message: '电气接口数据表暂不支持追加操作，已跳过'
          };
        }

        // 记录上传文件信息
        const fileSize = fs.statSync(req.file.path).size;
        await db.run(
          `INSERT INTO uploaded_files (filename, original_filename, table_name, uploaded_by, total_rows, success_count, error_count, file_size, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.file.filename,
            req.file.originalname,
            `project_${projectId}`,
            req.user!.id,
            totalSuccess + totalError,
            totalSuccess,
            totalError,
            fileSize,
            totalError > 0 ? 'completed_with_errors' : 'completed'
          ]
        );

        res.json({
          success: true,
          message: '数据导入完成',
          totalSuccess,
          totalError,
          results
        });
      } catch (error: any) {
        console.error('导入项目数据失败:', error);
        res.status(500).json({ error: error.message || '导入项目数据失败' });
      }
    }
  );

  // 同步项目到 SysML v2 API
  router.post('/:id/sync-sysml', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.params.id);

      const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!project) {
        return res.status(404).json({ error: '项目不存在' });
      }

      // 获取项目数据表
      const projectTables = await db.query(
        'SELECT * FROM project_tables WHERE project_id = ? ORDER BY table_type',
        [projectId]
      );

      const sheetOrder: TableType[] = ['ata_device', 'device_component', 'electrical_interface'];
      const tablesData: TableData[] = [];

      for (const tableType of sheetOrder) {
        const projectTable = projectTables.find((pt: any) => pt.table_type === tableType);
        if (!projectTable) continue;

        const tableInfo = await db.get(
          'SELECT original_columns FROM custom_tables WHERE table_name = ?',
          [projectTable.table_name]
        );

        let originalColumns: string[] = [];
        if (tableInfo?.original_columns) {
          try {
            originalColumns = JSON.parse(tableInfo.original_columns);
          } catch {
            const cols = await db.query(`PRAGMA table_info("${projectTable.table_name}")`);
            originalColumns = cols
              .filter((c: any) => !['id', 'status', 'created_at', 'updated_at'].includes(c.name))
              .map((c: any) => c.name);
          }
        } else {
          const cols = await db.query(`PRAGMA table_info("${projectTable.table_name}")`);
          originalColumns = cols
            .filter((c: any) => !['id', 'status', 'created_at', 'updated_at'].includes(c.name))
            .map((c: any) => c.name);
        }

        const rows = await db.query(`SELECT * FROM "${projectTable.table_name}" ORDER BY id ASC`);
        tablesData.push({ tableType: tableType as TableType, originalColumns, rows });
      }

      const result = await syncToSysmlApi(db, projectId, project.name, tablesData);
      res.json(result);
    } catch (error: any) {
      console.error('SysML同步失败:', error);
      const statusCode = error.message?.includes('不可用') ? 502
        : error.message?.includes('正在进行中') ? 409
        : 500;
      res.status(statusCode).json({ error: error.message || 'SysML同步失败' });
    }
  });

  // 获取项目 SysML 同步状态
  router.get('/:id/sync-sysml/status', authenticate, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const status = await db.get(
        'SELECT * FROM sysml_sync_status WHERE project_id = ?',
        [projectId]
      );
      res.json({ syncStatus: status || null });
    } catch (error: any) {
      console.error('获取同步状态失败:', error);
      res.status(500).json({ error: '获取同步状态失败' });
    }
  });

  return router;
}

