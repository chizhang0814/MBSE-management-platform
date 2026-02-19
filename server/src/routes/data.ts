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
        AND name NOT IN ('users', 'tasks', 'change_logs', 'uploaded_files', 'custom_tables', 'table_metadata', 'templates', 'projects', 'project_tables')
        ORDER BY name
      `);
      res.json({ tables: tables.map((t: any) => t.name) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取表列表失败' });
    }
  });

  // 获取项目的数据表列表
  router.get('/project/:projectId/tables', authenticate, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);

      // 验证项目是否存在
      const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
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
        [projectId]
      );

      // 为每个表添加行数统计
      const tablesWithCount = await Promise.all(
        tables.map(async (table: any) => {
          try {
            const countResult = await db.query(`SELECT COUNT(*) as count FROM "${table.table_name}"`);
            return {
              ...table,
              row_count: countResult[0]?.count || 0
            };
          } catch (error) {
            console.error(`获取表 ${table.table_name} 行数失败:`, error);
            return {
              ...table,
              row_count: 0
            };
          }
        })
      );

      res.json({ tables: tablesWithCount });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取项目数据表列表失败' });
    }
  });

  // 获取所有表的统计信息（表名、行数、项目名称、显示名称）
  router.get('/tables/stats', authenticate, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const username = req.user?.username;
      
      let projectTables;
      
      if (userRole === 'admin') {
        // 管理员可以看到所有项目的数据表
          projectTables = await db.query(`
            SELECT 
              pt.table_name,
              pt.display_name,
              pt.project_id,
              pt.table_type,
              p.name as project_name
            FROM project_tables pt
            JOIN projects p ON pt.project_id = p.id
            ORDER BY p.name, pt.table_type
          `);
      } else {
        // 普通用户：查找用户作为"设备负责人"出现在数据表中的项目
        // 查询所有项目的ATA章节设备表，找到"设备负责人"字段等于当前用户名的记录
        const allProjects = await db.query(`
          SELECT DISTINCT p.id, p.name
          FROM projects p
          JOIN project_tables pt ON p.id = pt.project_id
          WHERE pt.table_type = 'ata_device'
        `);
        
        const userProjectIds: number[] = [];
        
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
                  userProjectIds.push(project.id);
                }
              }
            } catch (error) {
              // 如果查询失败，跳过该项目
              console.error(`查询项目 ${project.id} 的数据表失败:`, error);
            }
          }
        }
        
        if (userProjectIds.length === 0) {
          projectTables = [];
        } else {
          // 使用 IN 子句查询用户参与的项目的数据表
          const placeholders = userProjectIds.map(() => '?').join(',');
          projectTables = await db.query(`
            SELECT 
              pt.table_name,
              pt.display_name,
              pt.project_id,
              pt.table_type,
              p.name as project_name
            FROM project_tables pt
            JOIN projects p ON pt.project_id = p.id
            WHERE pt.project_id IN (${placeholders})
            ORDER BY p.name, pt.table_type
          `, userProjectIds);
        }
      }

      // 辅助函数：清理列名
      const cleanColumnName = (col: string) => {
        let cleanName = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        cleanName = cleanName.replace(/\r\n/g, '_');
        cleanName = cleanName.replace(/[()]/g, '_');
        cleanName = cleanName.replace(/\.(\d+)/g, '_$1');
        return cleanName;
      };

      const tableStats = await Promise.all(
        projectTables.map(async (table: any) => {
          try {
            const result = await db.query(`SELECT COUNT(*) as count FROM "${table.table_name}"`);
            const count = result[0]?.count || 0;
            
            // 初始化统计信息
            let deviceCount = 0;
            let componentCount = 0;
            let interfaceCount = 0;
            
            // 如果是普通用户，需要统计用户负责的数量
            if (userRole === 'user' && username) {
              // 获取项目的所有表信息
              const projectTablesInfo = await db.query(
                `SELECT table_name, table_type FROM project_tables WHERE project_id = ?`,
                [table.project_id]
              );
              
              // 找到ATA章节设备表
              const ataDeviceTable = projectTablesInfo.find((t: any) => t.table_type === 'ata_device');
              // 找到设备端元器件表
              const deviceComponentTable = projectTablesInfo.find((t: any) => t.table_type === 'device_component');
              // 找到电气接口数据表
              const electricalInterfaceTable = projectTablesInfo.find((t: any) => t.table_type === 'electrical_interface');
              
              if (ataDeviceTable) {
                try {
                  // 获取ATA章节设备表的列信息
                  const ataTableInfo = await db.query(`PRAGMA table_info("${ataDeviceTable.table_name}")`);
                  const deviceManagerCol = ataTableInfo.find((col: any) => 
                    col.name === '设备负责人' || col.name.includes('设备负责人')
                  );
                  
                  if (deviceManagerCol) {
                    // 统计该用户负责的设备数量
                    const deviceResult = await db.get(
                      `SELECT COUNT(*) as count FROM "${ataDeviceTable.table_name}" 
                       WHERE "${deviceManagerCol.name}" = ?`,
                      [username]
                    );
                    deviceCount = (deviceResult as any)?.count || 0;
                    
                    // 如果用户有负责的设备，统计设备端元器件数量和电气接口数量
                    if (deviceCount > 0) {
                      // 获取该用户负责的所有设备编号
                      const deviceNumberCol = ataTableInfo.find((col: any) => 
                        col.name === '设备编号' || col.name.includes('设备编号')
                      );
                      
                      if (deviceNumberCol) {
                        const userDevices = await db.query(
                          `SELECT "${deviceNumberCol.name}" as device_number FROM "${ataDeviceTable.table_name}" 
                           WHERE "${deviceManagerCol.name}" = ?`,
                          [username]
                        );
                        
                        if (userDevices.length > 0) {
                          const deviceNumbers = userDevices.map((d: any) => d.device_number).filter((d: any) => d);
                          
                          if (deviceNumbers.length > 0) {
                            // 统计设备端元器件数量
                            if (deviceComponentTable) {
                              try {
                                // 获取设备端元器件表的列信息
                                const componentTableInfo = await db.get(
                                  'SELECT original_columns FROM custom_tables WHERE table_name = ?',
                                  [deviceComponentTable.table_name]
                                );
                                
                                if (componentTableInfo && componentTableInfo.original_columns) {
                                  const originalColumns = JSON.parse(componentTableInfo.original_columns);
                                  const componentDeviceNumberCol = originalColumns.find((col: string) => 
                                    col.includes('设备编号') || col === '设备编号'
                                  );
                                  
                                  if (componentDeviceNumberCol) {
                                    const cleanComponentDeviceNumberCol = cleanColumnName(componentDeviceNumberCol);
                                    const placeholders = deviceNumbers.map(() => '?').join(',');
                                    const componentResult = await db.get(
                                      `SELECT COUNT(*) as count FROM "${deviceComponentTable.table_name}" 
                                       WHERE "${cleanComponentDeviceNumberCol}" IN (${placeholders})`,
                                      deviceNumbers
                                    );
                                    componentCount = (componentResult as any)?.count || 0;
                                  }
                                }
                              } catch (error) {
                                console.error(`统计设备端元器件数量失败:`, error);
                              }
                            }
                            
                            // 统计电气接口数量
                            if (electricalInterfaceTable) {
                              try {
                                // 获取电气接口数据表的所有数据
                                const interfaceData = await db.query(`SELECT * FROM "${electricalInterfaceTable.table_name}"`);
                                
                                // 获取表的列信息，查找"设备"列
                                const interfaceTableInfo = await db.get(
                                  'SELECT original_columns FROM custom_tables WHERE table_name = ?',
                                  [electricalInterfaceTable.table_name]
                                );
                                
                                if (interfaceTableInfo && interfaceTableInfo.original_columns) {
                                  const originalColumns = JSON.parse(interfaceTableInfo.original_columns);
                                  const deviceCol = originalColumns.find((col: string) => col === '设备');
                                  
                                  if (deviceCol) {
                                    const cleanDeviceCol = cleanColumnName(deviceCol);
                                    
                                    // 遍历所有接口数据，检查设备字段中是否包含用户负责的设备
                                    for (const row of interfaceData) {
                                      const deviceValue = row[deviceCol] || row[cleanDeviceCol];
                                      
                                      if (deviceValue) {
                                        let deviceArray: any[] = [];
                                        
                                        // 解析设备字段（可能是JSON字符串、数组或对象）
                                        if (typeof deviceValue === 'string') {
                                          try {
                                            const parsed = JSON.parse(deviceValue);
                                            deviceArray = Array.isArray(parsed) ? parsed : [parsed];
                                          } catch (e) {
                                            // 解析失败，跳过
                                          }
                                        } else if (Array.isArray(deviceValue)) {
                                          deviceArray = deviceValue;
                                        } else if (typeof deviceValue === 'object' && deviceValue !== null) {
                                          deviceArray = [deviceValue];
                                        }
                                        
                                        // 检查设备数组中是否有用户负责的设备
                                        const hasUserDevice = deviceArray.some((device: any) => {
                                          const deviceNum = device.设备编号 || device['设备编号'] || '';
                                          return deviceNumbers.includes(deviceNum);
                                        });
                                        
                                        if (hasUserDevice) {
                                          interfaceCount++;
                                        }
                                      }
                                    }
                                  }
                                }
                              } catch (error) {
                                console.error(`统计电气接口数量失败:`, error);
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                } catch (error) {
                  console.error(`获取ATA章节设备表信息失败:`, error);
                }
              }
            }
            
            return {
              tableName: table.table_name,
              displayName: table.display_name || table.table_name,
              projectName: table.project_name,
              projectId: table.project_id,
              tableType: table.table_type,
              rowCount: count,
              deviceCount: userRole === 'user' ? deviceCount : undefined,
              componentCount: userRole === 'user' ? componentCount : undefined,
              interfaceCount: userRole === 'user' ? interfaceCount : undefined
            };
          } catch (error) {
            console.error(`获取表 ${table.table_name} 的统计信息失败:`, error);
            return {
              tableName: table.table_name,
              displayName: table.display_name || table.table_name,
              projectName: table.project_name,
              projectId: table.project_id,
              tableType: table.table_type,
              rowCount: 0,
              deviceCount: userRole === 'user' ? 0 : undefined,
              componentCount: userRole === 'user' ? 0 : undefined,
              interfaceCount: userRole === 'user' ? 0 : undefined
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

  // JSON字段处理辅助函数
  const isJsonColumn = (columnName: string): boolean => {
    // 定义需要JSON处理的列名（可以根据需要扩展）
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
        // 如果不是有效的JSON，返回原值
        return value;
      }
    }
    
    return value;
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
      
      // 解析JSON字段
      const parsedData = data.map((row: any) => {
        const parsedRow: any = { ...row };
        if (originalColumns) {
          originalColumns.forEach((col: string) => {
            const cleanCol = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
            if (row[col] !== undefined) {
              parsedRow[col] = parseJsonValue(row[col], col);
            } else if (row[cleanCol] !== undefined) {
              parsedRow[col] = parseJsonValue(row[cleanCol], col);
              parsedRow[cleanCol] = parseJsonValue(row[cleanCol], col);
            }
          });
        }
        return parsedRow;
      });
      
      res.json({ data: parsedData, tableName, originalColumns });
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
      
      // 解析JSON字段
      const parsedData = data.map((row: any) => {
        const parsedRow: any = { ...row };
        if (originalColumns) {
          originalColumns.forEach((col: string) => {
            const cleanCol = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
            if (row[col] !== undefined) {
              parsedRow[col] = parseJsonValue(row[col], col);
            } else if (row[cleanCol] !== undefined) {
              parsedRow[col] = parseJsonValue(row[cleanCol], col);
              parsedRow[cleanCol] = parseJsonValue(row[cleanCol], col);
            }
          });
        }
        return parsedRow;
      });
      
      res.json({ data: parsedData, tableName, originalColumns });
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
      
      // 获取原始列名并解析JSON字段
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
      
      // 解析JSON字段
      const parsedRow: any = { ...data };
      if (originalColumns) {
        originalColumns.forEach((col: string) => {
          const cleanCol = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          if (data[col] !== undefined) {
            parsedRow[col] = parseJsonValue(data[col], col);
          } else if (data[cleanCol] !== undefined) {
            parsedRow[col] = parseJsonValue(data[cleanCol], col);
            parsedRow[cleanCol] = parseJsonValue(data[cleanCol], col);
          }
        });
      }
      
      res.json({ data: parsedRow });
    } catch (error) {
      res.status(500).json({ error: '获取数据失败' });
    }
  });

  // 管理员：更新数据
  router.put('/item/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { table_name, ...updateFields } = req.body;
      const tableName = table_name || 'eicd_data';

      // 安全验证表名
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

      // 获取表的列定义
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

      // 清理列名的辅助函数
      const cleanColumnName = (col: string) => {
        let cleanName = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        cleanName = cleanName.replace(/\r\n/g, '_');
        cleanName = cleanName.replace(/[()]/g, '_');
        cleanName = cleanName.replace(/\.(\d+)/g, '_$1');
        return cleanName;
      };

      // 构建动态UPDATE语句
      const updates: string[] = [];
      const values: any[] = [];

      for (const col of originalColumns) {
        if (updateFields.hasOwnProperty(col)) {
          const cleanCol = cleanColumnName(col);
          updates.push(`"${cleanCol}" = ?`);
          // 如果是JSON列，序列化为JSON字符串
          const value = updateFields[col];
          values.push(stringifyJsonValue(value, col));
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: '没有要更新的字段' });
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.params.id);

      await db.run(
        `UPDATE "${tableName}" SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      res.json({ message: '更新成功' });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || '更新失败' });
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

  // 添加新数据行
  router.post('/table/:tableName/row', authenticate, async (req: any, res) => {
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
      
      // 获取表的类型和列定义
      const projectTable = await db.get(
        'SELECT pt.table_type FROM project_tables pt WHERE pt.table_name = ?',
        [tableName]
      );
      
      const tableInfo = await db.get(
        'SELECT original_columns FROM custom_tables WHERE table_name = ?',
        [tableName]
      );
      
      if (!tableInfo || !tableInfo.original_columns) {
        return res.status(400).json({ error: '无法获取表的列定义' });
      }
      
      // 权限检查：普通用户只能添加特定表类型的数据
      const userRole = req.user?.role;
      if (userRole === 'user') {
        const allowedTableTypes = ['electrical_interface', 'ata_device', 'device_component'];
        if (!projectTable || !allowedTableTypes.includes(projectTable.table_type)) {
          return res.status(403).json({ error: '权限不足：您没有权限向此表添加数据' });
        }
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
      
      // 准备数据，自动填充 connection编号
      const finalRowData = { ...rowData };
      if (originalColumns.includes('connection编号')) {
        finalRowData['connection编号'] = String(newConnectionNumber);
      }
      
      // 检查是否是电气接口数据表，如果是且rowData中有"连接类型"但originalColumns中没有，需要动态添加列
      const tableTypeInfo = await db.get(
        'SELECT table_type FROM project_tables WHERE table_name = ?',
        [tableName]
      );
      
      if (tableTypeInfo && tableTypeInfo.table_type === 'electrical_interface' && 
          finalRowData['连接类型'] && !originalColumns.includes('连接类型')) {
        // 动态添加"连接类型"列
        const cleanConnectionTypeCol = cleanColumnName('连接类型');
        try {
          await db.run(`ALTER TABLE "${tableName}" ADD COLUMN "${cleanConnectionTypeCol}" TEXT`);
          // 更新originalColumns
          originalColumns.push('连接类型');
          await db.run(
            'UPDATE custom_tables SET original_columns = ? WHERE table_name = ?',
            [JSON.stringify(originalColumns), tableName]
          );
          console.log(`已为表 ${tableName} 动态添加"连接类型"列`);
        } catch (error: any) {
          // 如果列已存在（可能是并发添加），忽略错误
          const errorMsg = error.message || String(error);
          if (errorMsg.includes('duplicate column') || errorMsg.includes('already exists') || 
              errorMsg.includes('UNIQUE constraint failed')) {
            // 列已存在，但originalColumns中没有，更新originalColumns
            if (!originalColumns.includes('连接类型')) {
              originalColumns.push('连接类型');
              await db.run(
                'UPDATE custom_tables SET original_columns = ? WHERE table_name = ?',
                [JSON.stringify(originalColumns), tableName]
              );
            }
          } else {
            console.error(`添加"连接类型"列失败:`, error);
          }
        }
      }
      
      // 生成 Unique ID（如果是电气接口数据表，根据连接类型生成）
      if (originalColumns.includes('Unique ID')) {
        let uniqueId = '';
        
        // 检查是否是电气接口数据表
        if (tableTypeInfo && tableTypeInfo.table_type === 'electrical_interface' && finalRowData['连接类型']) {
          const connectionType = finalRowData['连接类型'];
          const cleanConnectionTypeCol = cleanColumnName('连接类型');
          const cleanUniqueIdCol = cleanColumnName('Unique ID');
          
          // 根据连接类型确定前缀
          let prefix = '';
          if (connectionType === '1to1信号') {
            prefix = 'DATA_';
          } else if (connectionType === '网络') {
            prefix = 'NET_';
          } else if (connectionType === 'ERN') {
            prefix = 'ERN_';
          }
          
          if (prefix) {
            // 查询表中相同连接类型的数据数量
            try {
              const existingRows = await db.query(
                `SELECT "${cleanUniqueIdCol}" FROM "${tableName}" 
                 WHERE "${cleanConnectionTypeCol}" = ? 
                 AND "${cleanUniqueIdCol}" IS NOT NULL 
                 AND "${cleanUniqueIdCol}" != '' 
                 AND "${cleanUniqueIdCol}" LIKE ?`,
                [connectionType, `${prefix}%`]
              );
              
              // 提取序号并找出最大值
              let maxNumber = 0;
              for (const row of existingRows) {
                const uniqueIdValue = row[cleanUniqueIdCol];
                if (uniqueIdValue && typeof uniqueIdValue === 'string') {
                  // 提取下划线后的数字部分
                  const match = uniqueIdValue.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`));
                  if (match && match[1]) {
                    const num = parseInt(match[1], 10);
                    if (!isNaN(num) && num > maxNumber) {
                      maxNumber = num;
                    }
                  }
                }
              }
              
              // 生成新的序号（从1开始，所以是maxNumber + 1）
              const nextNumber = maxNumber + 1;
              uniqueId = `${prefix}${nextNumber.toString().padStart(5, '0')}`;
            } catch (error) {
              console.error('查询相同连接类型数据失败，使用默认序号:', error);
              // 如果查询失败，默认从1开始
              uniqueId = `${prefix}00001`;
            }
          } else {
            // 如果连接类型不匹配，使用时间戳方式（向后兼容）
            const timestamp = Date.now();
            const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
            uniqueId = `${timestamp}_${random}`;
          }
        } else {
          // 非电气接口数据表，使用时间戳方式（向后兼容）
          const timestamp = Date.now();
          const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          uniqueId = `${timestamp}_${random}`;
        }
        
        // 设置 Unique ID（电气接口数据表不允许用户提供，直接使用生成的）
        finalRowData['Unique ID'] = uniqueId;
      }
      
      // 构建INSERT语句
      const columnNames = originalColumns.map(col => `"${cleanColumnName(col)}"`).join(', ');
      const placeholders = originalColumns.map(() => '?').join(', ');
      const values = originalColumns.map(colName => {
        const value = finalRowData[colName];
        // 使用stringifyJsonValue处理JSON字段
        return stringifyJsonValue(value, colName);
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

  // 搜索ATA章节设备表
  router.get('/search-devices', authenticate, async (req: any, res) => {
    try {
      const { projectId, query, username } = req.query;
      const userRole = req.user?.role;
      const currentUsername = req.user?.username;
      
      if (!projectId || !query || typeof query !== 'string' || query.trim() === '') {
        return res.json({ devices: [] });
      }
      
      const projectIdNum = parseInt(projectId as string);
      const searchQuery = query.trim();
      
      // 获取项目的ATA章节设备表
      const ataTable = await db.get(
        `SELECT table_name FROM project_tables 
         WHERE project_id = ? AND table_type = 'ata_device'`,
        [projectIdNum]
      );
      
      if (!ataTable) {
        return res.json({ devices: [] });
      }
      
      const tableName = ataTable.table_name;
      
      // 获取表的列定义
      const tableInfo = await db.get(
        'SELECT original_columns FROM custom_tables WHERE table_name = ?',
        [tableName]
      );
      
      if (!tableInfo || !tableInfo.original_columns) {
        return res.json({ devices: [] });
      }
      
      let originalColumns: string[] = [];
      try {
        originalColumns = JSON.parse(tableInfo.original_columns);
      } catch (e) {
        return res.json({ devices: [] });
      }
      
      // 查找设备中文、设备LIN号、设备编号和设备LIN号（DOORS）列
      const deviceChineseCol = originalColumns.find(col => 
        col.includes('设备中文') || col === '设备中文' || col.includes('设备名称') || col === '设备中文名'
      );
      const deviceLINCol = originalColumns.find(col => 
        col === '设备LIN号' || (col.includes('设备LIN号') && !col.includes('DOORS'))
      );
      const deviceLINDOORSCol = originalColumns.find(col => 
        col.includes('设备LIN号') && col.includes('DOORS')
      );
      const deviceNumberCol = originalColumns.find(col => 
        col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS'))
      );
      const deviceManagerCol = originalColumns.find(col => 
        col.includes('设备负责人') || col === '设备负责人'
      );
      
      if (!deviceChineseCol && !deviceLINCol && !deviceLINDOORSCol && !deviceNumberCol) {
        return res.json({ devices: [] });
      }
      
      // 构建搜索查询
      const cleanDeviceChineseCol = deviceChineseCol ? deviceChineseCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : null;
      const cleanDeviceLINCol = deviceLINCol ? deviceLINCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : null;
      const cleanDeviceLINDOORSCol = deviceLINDOORSCol ? deviceLINDOORSCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : null;
      const cleanDeviceNumberCol = deviceNumberCol ? deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : null;
      const cleanDeviceManagerCol = deviceManagerCol ? deviceManagerCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : null;
      
      let whereConditions: string[] = [];
      if (cleanDeviceChineseCol) {
        whereConditions.push(`"${cleanDeviceChineseCol}" LIKE ?`);
      }
      if (cleanDeviceLINCol) {
        whereConditions.push(`"${cleanDeviceLINCol}" LIKE ?`);
      }
      if (cleanDeviceLINDOORSCol) {
        whereConditions.push(`"${cleanDeviceLINDOORSCol}" LIKE ?`);
      }
      if (cleanDeviceNumberCol) {
        whereConditions.push(`"${cleanDeviceNumberCol}" LIKE ?`);
      }
      
      const searchPattern = `%${searchQuery}%`;
      const params: any[] = new Array(whereConditions.length).fill(searchPattern);
      
      // 如果是普通用户且提供了username参数，或者普通用户没有提供username但需要过滤，则只返回该用户负责的设备
      let filterByUser = false;
      let filterUsername = '';
      if (userRole === 'user') {
        if (username && typeof username === 'string') {
          filterByUser = true;
          filterUsername = username.trim();
        } else if (currentUsername) {
          // 如果没有提供username参数，但当前用户是普通用户，使用当前用户名
          filterByUser = true;
          filterUsername = currentUsername;
        }
      }
      
      // 如果管理员提供了username参数，也进行过滤（用于测试等场景）
      if (userRole === 'admin' && username && typeof username === 'string') {
        filterByUser = true;
        filterUsername = username.trim();
      }
      
      // 构建WHERE条件：先进行模糊搜索，然后进行用户过滤
      let whereClause = `(${whereConditions.join(' OR ')})`;
      
      // 如果需要进行用户过滤，添加设备负责人条件
      if (filterByUser && cleanDeviceManagerCol && filterUsername) {
        whereClause += ` AND "${cleanDeviceManagerCol}" = ?`;
        params.push(filterUsername);
        console.log(`[search-devices] 应用用户过滤: username=${filterUsername}, cleanDeviceManagerCol=${cleanDeviceManagerCol}`);
      } else {
        console.log(`[search-devices] 未应用用户过滤: filterByUser=${filterByUser}, cleanDeviceManagerCol=${cleanDeviceManagerCol}, filterUsername=${filterUsername}`);
      }
      
      let querySQL = `
        SELECT * FROM "${tableName}"
        WHERE ${whereClause}
        LIMIT 20
      `;
      
      console.log(`[search-devices] SQL查询: ${querySQL}`);
      console.log(`[search-devices] 参数:`, params);
      
      const results = await db.query(querySQL, params);
      
      // 格式化结果
      let devices = results.map((row: any) => {
        const device: any = {};
        if (deviceNumberCol) {
          const cleanCol = deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          device.设备编号 = row[deviceNumberCol] || row[cleanCol] || '';
        }
        if (deviceLINCol) {
          const cleanCol = deviceLINCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          device.设备LIN号 = row[deviceLINCol] || row[cleanCol] || '';
        }
        if (deviceLINDOORSCol) {
          const cleanCol = deviceLINDOORSCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          device.设备LIN号DOORS = row[deviceLINDOORSCol] || row[cleanCol] || '';
        }
        if (deviceChineseCol) {
          const cleanCol = deviceChineseCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          device.设备中文 = row[deviceChineseCol] || row[cleanCol] || '';
          device.设备中文名 = row[deviceChineseCol] || row[cleanCol] || ''; // 也提供设备中文名字段
        }
        if (deviceManagerCol) {
          const cleanCol = deviceManagerCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          device.设备负责人 = row[deviceManagerCol] || row[cleanCol] || null;
        }
        return device;
      });
      
      // 如果需要进行用户过滤，在结果中再次过滤（作为双重保险）
      if (filterByUser && filterUsername) {
        devices = devices.filter((device: any) => {
          const manager = device.设备负责人 || '';
          return String(manager).trim() === filterUsername;
        });
        console.log(`[search-devices] 结果过滤后数量: ${devices.length}`);
      }
      
      res.json({ devices });
    } catch (error) {
      console.error('搜索设备失败:', error);
      res.status(500).json({ error: '搜索设备失败' });
    }
  });

  // 删除数据行（仅管理员）
  router.delete('/table/:tableName/row/:rowId', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { tableName, rowId } = req.params;
      
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
      
      // 删除数据行（直接使用id列，因为所有表都有这个自动生成的列）
      await db.run(
        `DELETE FROM "${tableName}" WHERE "id" = ?`,
        [rowId]
      );
      
      // 更新custom_tables中的记录数
      const countResult = await db.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
      const count = countResult[0]?.count || 0;
      await db.run(
        'UPDATE custom_tables SET record_count = ? WHERE table_name = ?',
        [count, tableName]
      );
      
      res.json({ 
        success: true,
        message: '数据删除成功',
        recordCount: count
      });
    } catch (error: any) {
      console.error('删除数据失败:', error);
      res.status(500).json({ error: error.message || '删除数据失败' });
    }
  });

  // 获取设备端元器件列表
  router.get('/device-components', authenticate, async (req, res) => {
    try {
      const { projectId, deviceNumber } = req.query;
      
      if (!projectId || !deviceNumber || typeof deviceNumber !== 'string' || deviceNumber.trim() === '') {
        return res.json({ components: [] });
      }
      
      const projectIdNum = parseInt(projectId as string);
      const deviceNumberValue = deviceNumber.trim();
      
      // 获取项目的设备端元器件表
      const componentTable = await db.get(
        `SELECT table_name FROM project_tables 
         WHERE project_id = ? AND table_type = 'device_component'`,
        [projectIdNum]
      );
      
      if (!componentTable) {
        return res.json({ components: [] });
      }
      
      const tableName = componentTable.table_name;
      
      // 获取表的列定义
      const tableInfo = await db.get(
        'SELECT original_columns FROM custom_tables WHERE table_name = ?',
        [tableName]
      );
      
      if (!tableInfo || !tableInfo.original_columns) {
        return res.json({ components: [] });
      }
      
      let originalColumns: string[] = [];
      try {
        originalColumns = JSON.parse(tableInfo.original_columns);
      } catch (e) {
        return res.json({ components: [] });
      }
      
      // 查找设备编号列和设备端元器件编号列
      const deviceNumberCol = originalColumns.find(col => 
        col.includes('设备编号') || col === '设备编号'
      );
      const componentNumberCol = originalColumns.find(col => 
        col.includes('设备端元器件编号') || col === '设备端元器件编号' ||
        col.includes('端元器件编号') || col.includes('连接器号')
      );
      
      if (!deviceNumberCol || !componentNumberCol) {
        return res.json({ components: [] });
      }
      
      // 构建查询
      const cleanDeviceNumberCol = deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
      const cleanComponentNumberCol = componentNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
      
      const querySQL = `
        SELECT DISTINCT "${cleanComponentNumberCol}" as component_number
        FROM "${tableName}"
        WHERE "${cleanDeviceNumberCol}" = ?
        AND "${cleanComponentNumberCol}" IS NOT NULL
        AND "${cleanComponentNumberCol}" != ''
        ORDER BY "${cleanComponentNumberCol}"
      `;
      
      const results = await db.query(querySQL, [deviceNumberValue]);
      
      // 提取端元器件编号列表
      const components = results
        .map((row: any) => row.component_number)
        .filter((comp: any) => comp && comp.trim() !== '');
      
      res.json({ components });
    } catch (error) {
      console.error('获取端元器件列表失败:', error);
      res.status(500).json({ error: '获取端元器件列表失败' });
    }
  });

  return router;
}


