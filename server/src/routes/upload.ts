import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';

export function uploadRoutes(db: Database) {
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

  // 动态创建表的辅助函数
  const createDynamicTable = async (tableName: string, userId: number, originalColumns: string[]) => {
    // 检查表是否已存在
    const checkQuery = `SELECT name FROM sqlite_master WHERE type='table' AND name=?`;
    const existing = await db.get(checkQuery, [tableName]);
    
    if (!existing) {
      // 创建动态列的表
      const columnDefinitions = originalColumns.map(col => {
        // 清理列名，替换特殊字符为下划线（和前端保持一致）
        let cleanName = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        cleanName = cleanName.replace(/\r\n/g, '_');
        // 处理括号，转换为下划线
        cleanName = cleanName.replace(/[()]/g, '_');
        // 处理点号后的数字
        cleanName = cleanName.replace(/\.(\d+)/g, '_$1');
        return `"${cleanName}" TEXT`;
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
      
      // 记录到custom_tables（original_columns将在导入时更新）
      await db.run(
        'INSERT INTO custom_tables (table_name, display_name, original_columns, created_by) VALUES (?, ?, ?, ?)',
        [tableName, tableName, JSON.stringify(originalColumns), userId]
      );
    }
  };

  // 删除表的辅助函数
  const deleteTable = async (tableName: string) => {
    try {
      // 删除表
      await db.run(`DROP TABLE IF EXISTS "${tableName}"`);
      console.log(`已删除数据表: ${tableName}`);
      
      // 删除表元数据
      await db.run('DELETE FROM table_metadata WHERE table_name = ?', [tableName]);
      console.log(`已删除表元数据: ${tableName}`);
      
      // 从custom_tables中删除记录
      await db.run('DELETE FROM custom_tables WHERE table_name = ?', [tableName]);
      console.log(`已删除custom_tables记录: ${tableName}`);
    } catch (error) {
      console.error(`删除表失败: ${tableName}`, error);
    }
  };

  // 清理列名的辅助函数（提取出来供多个地方使用）
  const cleanColumnName = (col: string) => {
    let cleanName = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
    cleanName = cleanName.replace(/\r\n/g, '_');
    cleanName = cleanName.replace(/[()]/g, '_');
    cleanName = cleanName.replace(/\.(\d+)/g, '_$1');
    return cleanName;
  };

  // 更新表元数据的辅助函数
  const updateTableMetadata = async (
    tableName: string, 
    rowData: any, 
    originalColumns: string[]
  ) => {
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

      // 提取设备、连接器、针孔号（支持多种可能的列名）
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
      // 不抛出错误，避免影响主流程
    }
  };

  // 上传并导入xlsx文件
  router.post(
    '/import',
    authenticate,
    requireRole('admin'),
    upload.single('file'),
    async (req, res) => {
      let tableName = ''; // 在外部声明，方便catch块访问
      
      try {
        if (!req.file) {
          return res.status(400).json({ error: '未选择文件' });
        }
        
        // 获取表名
        tableName = (req as any).body.table_name;
        
        if (!tableName || tableName.trim() === '') {
          return res.status(400).json({ error: '表名不能为空' });
        }
        
        // 表名必须唯一，禁止使用系统默认表
        const reservedTables = ['users', 'tasks', 'change_logs', 'uploaded_files', 'custom_tables', 'eicd_data'];
        if (reservedTables.includes(tableName.toLowerCase())) {
          return res.status(400).json({ 
            error: `表名 "${tableName}" 是系统保留名称，请使用其他表名。建议使用有意义的名称，如：project_a_2024、module_b_data 等` 
          });
        }

        // 检查表是否存在
        const checkQuery = `SELECT name FROM sqlite_master WHERE type='table' AND name=?`;
        const existingTable = await db.get(checkQuery, [tableName]);
        
        if (existingTable) {
          // 检查表中是否有数据
          try {
            const dataCount = await db.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
            const count = dataCount[0]?.count || 0;
            
            if (count > 0) {
              return res.status(400).json({ 
                error: `表 "${tableName}" 已存在且包含 ${count} 条数据。请选择不同的表名。` 
              });
            } else {
              return res.status(400).json({ 
                error: `表 "${tableName}" 已存在。请选择不同的表名。` 
              });
            }
          } catch (error) {
            return res.status(400).json({ 
              error: `表 "${tableName}" 已存在。请选择不同的表名。` 
            });
          }
        }
        
        // 读取xlsx文件
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // 转换为JSON
        const jsonData = xlsx.utils.sheet_to_json(worksheet);

        if (!Array.isArray(jsonData) || jsonData.length === 0) {
          return res.status(400).json({ error: 'Excel文件中没有数据' });
        }

        // 获取原始列名（Excel的第一行）
        const originalColumns = Object.keys(jsonData[0]);
        
        // 创建动态表
        const userId = (req as AuthRequest).user!.id;
        await createDynamicTable(tableName, userId, originalColumns);

        // 批量导入数据
        let successCount = 0;
        let errorCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < jsonData.length; i++) {
          const row = jsonData[i];
          const rowNumber = i + 2; // Excel行号（第1行是表头）
          
          try {
            // 动态构建INSERT语句
            const columnNames = originalColumns.map(col => {
              return `"${cleanColumnName(col)}"`;
            }).join(', ');
            
            const placeholders = originalColumns.map(() => '?').join(', ');
            const values = originalColumns.map(colName => {
              const value = (row as any)[colName];
              return value !== undefined && value !== null ? String(value) : '';
            });

            // 动态插入数据到指定表
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
            await updateTableMetadata(tableName, insertedRow, originalColumns);

            successCount++;
          } catch (error: any) {
            errorCount++;
            
            // 打印失败行的详细信息
            const rowInfo = JSON.stringify({
              原始数据: Object.keys(row).slice(0, 5).map(k => `${k}:${(row as any)[k]}`).join(', '),
              错误原因: error.message
            });
            
            errors.push(`第${rowNumber}行导入失败: ${error.message} | 数据: ${rowInfo.substring(0, 250)}`);
            
            // 控制错误数量，避免返回太多
            if (errors.length >= 50) {
              errors.push('... 更多错误已省略');
              break;
            }
          }
        }

        // 记录上传文件信息
        const fileSize = fs.statSync(req.file.path).size;
        const uploadResult = await db.run(
          `INSERT INTO uploaded_files (filename, original_filename, table_name, uploaded_by, total_rows, success_count, error_count, file_size, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.file.filename,
            req.file.originalname,
            tableName,
            (req as AuthRequest).user!.id,
            jsonData.length,
            successCount,
            errorCount,
            fileSize,
            errorCount > 0 ? 'completed_with_errors' : 'completed'
          ]
        );

        // 如果成功行数为0，删除创建的表
        if (successCount === 0) {
          console.log(`成功行数为0，删除数据表: ${tableName}`);
          await deleteTable(tableName);
          return res.json({
            message: '导入完成，但没有成功导入任何数据，已自动删除数据表',
            successCount: 0,
            errorCount: errorCount + jsonData.length, // 所有行都失败
            fileId: uploadResult.lastID,
            errors: errors.slice(0, 10),
          });
        }

        res.json({
          message: '导入完成',
          successCount,
          errorCount,
          fileId: uploadResult.lastID,
          errors: errors.slice(0, 10), // 只返回前10个错误
        });
      } catch (error) {
        console.error('导入失败:', error);
        
        // 如果导入失败，删除已创建的表（如果存在）
        if (tableName) {
          console.log(`导入失败，尝试删除数据表: ${tableName}`);
          await deleteTable(tableName);
        }
        
        res.status(500).json({ error: '文件导入失败，已自动清理创建的数据表' });
      }
    }
  );

  // 获取上传文件列表
  router.get('/files', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const files = await db.query(
        `SELECT uf.*, u.username as uploaded_by_name 
         FROM uploaded_files uf
         JOIN users u ON uf.uploaded_by = u.id
         ORDER BY uf.uploaded_at DESC`
      );
      res.json({ files });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取文件列表失败' });
    }
  });

  // 获取单个文件详情
  router.get('/files/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const file = await db.get(
        `SELECT uf.*, u.username as uploaded_by_name 
         FROM uploaded_files uf
         JOIN users u ON uf.uploaded_by = u.id
         WHERE uf.id = ?`,
        [req.params.id]
      );
      
      if (!file) {
        return res.status(404).json({ error: '文件不存在' });
      }

      // 尝试获取文件内容预览
      let filePath = '';
      let fileExists = false;
      if (file.filename) {
        filePath = path.join('uploads', file.filename);
        fileExists = fs.existsSync(filePath);
      }

      res.json({ file: { ...file, fileExists, filePath } });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取文件详情失败' });
    }
  });

  // 删除上传文件记录（移入deleted文件夹）
  router.delete('/files/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      // 获取文件信息
      const file = await db.get('SELECT * FROM uploaded_files WHERE id = ?', [req.params.id]);
      
      if (!file) {
        return res.status(404).json({ error: '文件记录不存在' });
      }

      // 移动文件到deleted文件夹
      if (file.filename && fs.existsSync(path.join('uploads', file.filename))) {
        const deletedDir = 'uploads/deleted';
        if (!fs.existsSync(deletedDir)) {
          fs.mkdirSync(deletedDir, { recursive: true });
        }
        
        const timestamp = Date.now();
        const deletedFilename = `${timestamp}-${file.filename}`;
        const oldPath = path.join('uploads', file.filename);
        const newPath = path.join(deletedDir, deletedFilename);
        
        fs.renameSync(oldPath, newPath);
      }

      // 删除数据库记录
      await db.run('DELETE FROM uploaded_files WHERE id = ?', [req.params.id]);
      res.json({ message: '文件已移到deleted文件夹，记录已删除' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '删除文件记录失败' });
    }
  });

  // 同步现有文件到数据库
  router.post('/sync-existing', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const uploadsDir = 'uploads';
      const files = await fs.promises.readdir(uploadsDir);
      
      let syncedCount = 0;
      let skippedCount = 0;
      
      for (const filename of files) {
        // 跳过deleted文件夹和隐藏文件
        if (filename === 'deleted' || filename.startsWith('.')) {
          console.log(`Skipping deleted folder or hidden file: ${filename}`);
          skippedCount++;
          continue;
        }
        
        // 检查是否已存在
        const existing = await db.get('SELECT id FROM uploaded_files WHERE filename = ?', [filename]);
        if (existing) {
          skippedCount++;
          continue;
        }

        const filePath = path.join(uploadsDir, filename);
        
        try {
          const stats = await fs.promises.stat(filePath);
          
          // 跳过目录，只处理文件
          if (stats.isDirectory()) {
            console.log(`Skipping directory: ${filename}`);
            skippedCount++;
            continue;
          }
          
          // 跳过非xlsx文件
          if (!filename.toLowerCase().endsWith('.xlsx')) {
            continue;
          }
          
          // 尝试读取Excel获取行数
          let totalRows = 0;
          try {
            const workbook = xlsx.readFile(filePath);
            const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            totalRows = data.length;
          } catch (e) {
            // 忽略错误
          }

          // 尝试从eicd_data表统计实际的导入数据
          let actualImportedCount = 0;
          try {
            const result = await db.query(
              'SELECT COUNT(*) as count FROM eicd_data WHERE created_at >= datetime(?, "-1 hour")',
              [new Date(stats.mtime).toISOString()]
            );
            actualImportedCount = result[0]?.count || 0;
          } catch (e) {
            // 忽略
          }

          const successCount = actualImportedCount > 0 ? actualImportedCount : null;
          const status = actualImportedCount > 0 ? 'completed' : 'historical';

          await db.run(
            `INSERT INTO uploaded_files (filename, original_filename, table_name, uploaded_by, total_rows, success_count, error_count, file_size, status, uploaded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              filename,
              filename.replace(/^\d+-/, ''),
              'eicd_data', // 历史文件默认为eicd_data表
              (req as AuthRequest).user!.id,
              totalRows,
              successCount,
              0,
              stats.size,
              status,
              new Date(stats.mtime).toISOString()
            ]
          );
          syncedCount++;
        } catch (error) {
          console.error(`Failed to sync ${filename}:`, error);
        }
      }

      res.json({ 
        message: `同步完成：成功${syncedCount}个，跳过${skippedCount}个`,
        syncedCount,
        skippedCount
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '同步文件失败' });
    }
  });

  // 获取导入模板
  router.get('/template', (req, res) => {
    try {
      const template = xlsx.utils.aoa_to_sheet([
        ['项目编码', '项目名称', '描述', '规格', '单位', '价格'],
        ['C001', '混凝土', '普通混凝土', 'C30', 'm³', 350.00],
        ['S001', '钢筋', 'HRB400级钢筋', 'Ø12', 't', 4200.00],
        ['T001', '模板', '木模板', '清水模板', 'm²', 45.00],
      ]);

      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, template, '数据模板');

      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=import_template.xlsx');
      res.send(buffer);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '生成模板失败' });
    }
  });

  // 创建空白表格（仅管理员）
  router.post('/create-table', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { tableName, displayName, columns } = req.body;
      const userId = req.user!.id;

      // 验证输入
      if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
        return res.status(400).json({ error: '表名不能为空' });
      }

      // 验证表名格式（必须以字母开头，只能包含字母、数字和下划线）
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tableName.trim())) {
        return res.status(400).json({ error: '表名必须以字母开头，只能包含字母、数字和下划线' });
      }

      if (!columns || !Array.isArray(columns) || columns.length === 0) {
        return res.status(400).json({ error: '至少需要定义一个列' });
      }

      // 验证列名
      for (const col of columns) {
        if (!col || typeof col !== 'string' || col.trim() === '') {
          return res.status(400).json({ error: '列名不能为空' });
        }
      }

      const finalTableName = tableName.trim();

      // 检查表是否已存在
      const checkQuery = `SELECT name FROM sqlite_master WHERE type='table' AND name=?`;
      const existing = await db.get(checkQuery, [finalTableName]);
      
      if (existing) {
        return res.status(400).json({ error: '表名已存在，请选择其他名称' });
      }

      // 创建动态列的表
      const columnDefinitions = columns.map((col: string) => {
        // 清理列名，替换特殊字符为下划线（和前端保持一致）
        let cleanName = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        cleanName = cleanName.replace(/\r\n/g, '_');
        // 处理括号，转换为下划线
        cleanName = cleanName.replace(/[()]/g, '_');
        // 处理点号后的数字
        cleanName = cleanName.replace(/\.(\d+)/g, '_$1');
        return `"${cleanName}" TEXT`;
      }).join(',\n          ');
      
      await db.run(`
        CREATE TABLE IF NOT EXISTS "${finalTableName}" (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ${columnDefinitions},
          status TEXT DEFAULT 'normal',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 记录到custom_tables
      await db.run(
        'INSERT INTO custom_tables (table_name, display_name, original_columns, created_by, record_count) VALUES (?, ?, ?, ?, ?)',
        [
          finalTableName,
          displayName && displayName.trim() ? displayName.trim() : finalTableName,
          JSON.stringify(columns),
          userId,
          0
        ]
      );

      res.json({ 
        success: true, 
        message: '空白表格创建成功',
        tableName: finalTableName,
        columns: columns.length
      });
    } catch (error: any) {
      console.error('创建空白表格失败:', error);
      res.status(500).json({ error: error.message || '创建空白表格失败' });
    }
  });

  return router;
}
