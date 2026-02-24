import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';

export class Database {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite3.Database(process.env.DB_PATH || './eicd.db');
    
    // 启用WAL模式以提升并发性能（适合10-20人团队使用）
    // WAL模式允许多个读取者同时访问数据库，写入性能也更好
    this.db.run('PRAGMA journal_mode = WAL;');
    // 使用NORMAL同步模式，在性能和安全性之间取得平衡
    this.db.run('PRAGMA synchronous = NORMAL;');
    // 增加缓存大小以提升查询性能（10MB缓存）
    this.db.run('PRAGMA cache_size = -10000;');
    // 启用外键约束
    this.db.run('PRAGMA foreign_keys = ON;');
    // 设置忙等待超时（5秒），避免写入冲突时立即失败
    this.db.configure('busyTimeout', 5000);
  }

  async init() {
    return new Promise<void>((resolve, reject) => {
      this.db.serialize(() => {
        // 用户表
        this.db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // 注意：不再创建默认的 eicd_data 表
        // 每个文件上传时会创建独立的表

        // 任务表
        this.db.run(`
          CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_id INTEGER NOT NULL,
            table_name TEXT NOT NULL DEFAULT 'eicd_data',
            assigned_by INTEGER NOT NULL,
            assigned_to INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assigned_by) REFERENCES users(id),
            FOREIGN KEY (assigned_to) REFERENCES users(id)
          )
        `);

        // 变更记录表
        this.db.run(`
          CREATE TABLE IF NOT EXISTS change_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_id INTEGER NOT NULL,
            table_name TEXT NOT NULL DEFAULT 'eicd_data',
            changed_by INTEGER NOT NULL,
            old_values TEXT,
            new_values TEXT,
            reason TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (changed_by) REFERENCES users(id)
          )
        `);

        // 上传文件记录表
        this.db.run(`
          CREATE TABLE IF NOT EXISTS uploaded_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            table_name TEXT,
            uploaded_by INTEGER NOT NULL,
            total_rows INTEGER DEFAULT 0,
            success_count INTEGER,
            error_count INTEGER DEFAULT 0,
            file_size INTEGER,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'completed',
            FOREIGN KEY (uploaded_by) REFERENCES users(id)
          )
        `);
        
        // 创建动态表管理记录
        this.db.run(`
          CREATE TABLE IF NOT EXISTS custom_tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT UNIQUE NOT NULL,
            display_name TEXT,
            original_columns TEXT,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            record_count INTEGER DEFAULT 0,
            FOREIGN KEY (created_by) REFERENCES users(id)
          )
        `);
        
        // 创建表元数据表（记录每个表的connection编号、Unique ID、设备、连接器、针孔号）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS table_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            metadata_type TEXT NOT NULL,
            value TEXT NOT NULL,
            parent_value TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(table_name, metadata_type, value)
          )
        `);
        
        // 创建索引以提高查询性能
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_table_metadata_table_type 
          ON table_metadata(table_name, metadata_type)
        `);
        
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_table_metadata_parent 
          ON table_metadata(table_name, metadata_type, parent_value)
        `);

        // 模板表（用于定义三类表的列模板）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            table_type TEXT NOT NULL,
            columns TEXT NOT NULL,
            description TEXT,
            created_by INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
          )
        `);

        // 项目表
        this.db.run(`
          CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            created_by INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
          )
        `);

        // ① devices（设备 - SysML Block）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            设备编号 TEXT NOT NULL,
            设备中文名称 TEXT, 设备英文名称 TEXT, 设备英文缩写 TEXT,
            设备件号 TEXT, 设备供应商名称 TEXT, 设备所属ATA TEXT,
            设备安装位置 TEXT, 设备DAL TEXT,
            壳体是否金属 TEXT, 金属壳体表面处理 TEXT, 设备内共地情况 TEXT,
            壳体接地需求 TEXT, 壳体接地是否故障电流路径 TEXT, 其他接地特殊要求 TEXT,
            设备端连接器数量 TEXT, 是否选装设备 TEXT, 设备装机架次 TEXT,
            设备负责人 TEXT, 额定电压 TEXT, 额定电流 TEXT, 备注 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, 设备编号),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )
        `);

        // ② connectors（连接器 - SysML Port）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS connectors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER NOT NULL,
            连接器号 TEXT NOT NULL,
            设备端元器件编号 TEXT, 元器件名称及类型 TEXT,
            元器件件号及类型 TEXT, 元器件供应商名称 TEXT,
            匹配线束端元器件件号 TEXT, 匹配线束线型 TEXT,
            是否随设备交付 TEXT, 备注 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(device_id, 连接器号),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
          )
        `);

        // ③ pins（针孔 - SysML Pin/Contact）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS pins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connector_id INTEGER NOT NULL,
            针孔号 TEXT NOT NULL,
            端接尺寸 TEXT, 屏蔽类型 TEXT, 备注 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(connector_id, 针孔号),
            FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
          )
        `);

        // ④ signals（信号 - SysML ItemFlow）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            unique_id TEXT, 连接类型 TEXT, 信号方向 TEXT,
            信号架次有效性 TEXT,
            推荐导线线规 TEXT, 推荐导线线型 TEXT,
            独立电源代码 TEXT, 敷设代码 TEXT, 电磁兼容代码 TEXT,
            余度代码 TEXT, 功能代码 TEXT, 接地代码 TEXT, 极性 TEXT,
            额定电压 TEXT, 额定电流 TEXT, 设备正常工作电压范围 TEXT,
            是否成品线 TEXT, 成品线件号 TEXT, 成品线线规 TEXT, 成品线类型 TEXT,
            成品线长度 TEXT, 成品线载流量 TEXT, 成品线线路压降 TEXT, 成品线标识 TEXT,
            成品线与机上线束对接方式 TEXT, 成品线安装责任 TEXT, 备注 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )
        `);

        // ⑤ signal_endpoints（信号端点 - SysML ConnectorEnd）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS signal_endpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            signal_id INTEGER NOT NULL,
            pin_id INTEGER NOT NULL,
            endpoint_index INTEGER NOT NULL DEFAULT 0,
            端接尺寸 TEXT, 信号名称 TEXT, 信号定义 TEXT,
            FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE,
            FOREIGN KEY (pin_id) REFERENCES pins(id) ON DELETE RESTRICT
          )
        `);

        // 性能索引（5张新表）
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_devices_project ON devices(project_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_connectors_device ON connectors(device_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_pins_connector ON pins(connector_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_signals_project ON signals(project_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_signal_endpoints_signal ON signal_endpoints(signal_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_signal_endpoints_pin ON signal_endpoints(pin_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(设备负责人)`);

        // 项目数据表关联表（保留向后兼容）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS project_tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            table_type TEXT NOT NULL,
            table_name TEXT NOT NULL UNIQUE,
            template_id INTEGER,
            display_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (template_id) REFERENCES templates(id)
          )
        `);

        // SysML v2 同步状态表
        this.db.run(`
          CREATE TABLE IF NOT EXISTS sysml_sync_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL UNIQUE,
            sysml_project_id TEXT NOT NULL,
            last_commit_id TEXT,
            last_sync_at DATETIME,
            status TEXT DEFAULT 'never',
            error_message TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )
        `);

        // SysML v2 元素映射表（EICD行 ↔ SysML元素UUID）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS sysml_element_map (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            eicd_table TEXT NOT NULL,
            eicd_row_id INTEGER NOT NULL,
            sysml_element_id TEXT NOT NULL,
            element_type TEXT NOT NULL,
            element_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            UNIQUE(project_id, eicd_table, eicd_row_id, element_type)
          )
        `);

        // 创建索引
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_templates_table_type
          ON templates(table_type)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_project_tables_project
          ON project_tables(project_id)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_sysml_element_map_project
          ON sysml_element_map(project_id)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_sysml_sync_status_project
          ON sysml_sync_status(project_id)
        `);

        // 执行数据库迁移和初始化
        this.runMigrationsAndInit().then(() => resolve()).catch(reject);
      });
    });
  }

  async runMigrationsAndInit() {
    try {
      // 检查并添加 uploaded_files 表的各列
      const columns = await this.query('PRAGMA table_info(uploaded_files)');
      const colNames = columns.map((c: any) => c.name);

      if (!colNames.includes('table_name')) {
        await this.run('ALTER TABLE uploaded_files ADD COLUMN table_name TEXT');
        console.log('Database migration: added table_name column to uploaded_files table');
      }
      if (!colNames.includes('table_type')) {
        await this.run('ALTER TABLE uploaded_files ADD COLUMN table_type TEXT');
        console.log('Database migration: added table_type column to uploaded_files table');
      }
      if (!colNames.includes('error_details')) {
        await this.run('ALTER TABLE uploaded_files ADD COLUMN error_details TEXT');
        console.log('Database migration: added error_details column to uploaded_files table');
      }
      if (!colNames.includes('unmatched_cols')) {
        await this.run('ALTER TABLE uploaded_files ADD COLUMN unmatched_cols TEXT');
        console.log('Database migration: added unmatched_cols column to uploaded_files table');
      }
    } catch (error: any) {
      console.log('Migration: uploaded_files table check:', error.message);
    }

    try {
      // 创建 edit_locks 表（编辑锁）
      await this.run(`
        CREATE TABLE IF NOT EXISTS edit_locks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name TEXT NOT NULL,
          row_id INTEGER NOT NULL,
          locked_by INTEGER NOT NULL,
          locked_by_name TEXT NOT NULL,
          locked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          UNIQUE(table_name, row_id),
          FOREIGN KEY (locked_by) REFERENCES users(id)
        )
      `);
    } catch (error: any) {
      console.log('Migration: edit_locks table:', error.message);
    }

    try {
      // 检查并添加 tasks 表的 table_name 列
      const columns = await this.query('PRAGMA table_info(tasks)');
      const hasTableName = columns.some((col: any) => col.name === 'table_name');
      
      if (!hasTableName) {
        await this.run('ALTER TABLE tasks ADD COLUMN table_name TEXT NOT NULL DEFAULT \'eicd_data\'');
        console.log('Database migration: added table_name column to tasks table');
      }
    } catch (error: any) {
      console.log('Migration: tasks table check:', error.message);
    }

    try {
      // 检查并添加 change_logs 表的 table_name 列
      const columns = await this.query('PRAGMA table_info(change_logs)');
      const hasTableName = columns.some((col: any) => col.name === 'table_name');
      
      if (!hasTableName) {
        await this.run('ALTER TABLE change_logs ADD COLUMN table_name TEXT NOT NULL DEFAULT \'eicd_data\'');
        console.log('Database migration: added table_name column to change_logs table');
      }
    } catch (error: any) {
      console.log('Migration: change_logs table check:', error.message);
    }

    try {
      // 检查并添加 users 表的 permissions 列（用于普通用户的权限列表）
      const columns = await this.query('PRAGMA table_info(users)');
      const hasPermissions = columns.some((col: any) => col.name === 'permissions');

      if (!hasPermissions) {
        await this.run('ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT \'[]\'');
        console.log('Database migration: added permissions column to users table');
      }
    } catch (error: any) {
      console.log('Migration: users table check:', error.message);
    }

    try {
      // 检查并添加 sysml_sync_status 表的 data_hash 列（用于变更检测，避免重复推送）
      const columns = await this.query('PRAGMA table_info(sysml_sync_status)');
      const hasDataHash = columns.some((col: any) => col.name === 'data_hash');

      if (!hasDataHash) {
        await this.run('ALTER TABLE sysml_sync_status ADD COLUMN data_hash TEXT');
        console.log('Database migration: added data_hash column to sysml_sync_status table');
      }
    } catch (error: any) {
      console.log('Migration: sysml_sync_status table check:', error.message);
    }

    try {
      // 添加 tasks 表的 entity_table / entity_id 列（新关系型表支持）
      const taskCols = await this.query('PRAGMA table_info(tasks)');
      const taskColNames = taskCols.map((c: any) => c.name);
      if (!taskColNames.includes('entity_table')) {
        await this.run('ALTER TABLE tasks ADD COLUMN entity_table TEXT');
        console.log('Database migration: added entity_table column to tasks table');
      }
      if (!taskColNames.includes('entity_id')) {
        await this.run('ALTER TABLE tasks ADD COLUMN entity_id INTEGER');
        console.log('Database migration: added entity_id column to tasks table');
      }
    } catch (error: any) {
      console.log('Migration: tasks entity columns:', error.message);
    }

    try {
      // 添加 change_logs 表的 entity_table / entity_id 列
      const clCols = await this.query('PRAGMA table_info(change_logs)');
      const clColNames = clCols.map((c: any) => c.name);
      if (!clColNames.includes('entity_table')) {
        await this.run('ALTER TABLE change_logs ADD COLUMN entity_table TEXT');
        console.log('Database migration: added entity_table column to change_logs table');
      }
      if (!clColNames.includes('entity_id')) {
        await this.run('ALTER TABLE change_logs ADD COLUMN entity_id INTEGER');
        console.log('Database migration: added entity_id column to change_logs table');
      }
    } catch (error: any) {
      console.log('Migration: change_logs entity columns:', error.message);
    }

    try {
      // 为 pins 表添加 屏蔽类型 列
      const pinCols = await this.query('PRAGMA table_info(pins)');
      if (!pinCols.some((c: any) => c.name === '屏蔽类型')) {
        await this.run('ALTER TABLE pins ADD COLUMN 屏蔽类型 TEXT');
        console.log('Database migration: added 屏蔽类型 column to pins table');
      }
    } catch (e: any) {
      console.log('Migration: pins 屏蔽类型 column:', e.message);
    }

    try {
      // 从 signal_endpoints 删除 屏蔽类型 列（该属性属于 pins，不属于端点关联表）
      const seCols = await this.query('PRAGMA table_info(signal_endpoints)');
      if (seCols.some((c: any) => c.name === '屏蔽类型')) {
        await this.run('ALTER TABLE signal_endpoints DROP COLUMN 屏蔽类型');
        console.log('Database migration: dropped 屏蔽类型 column from signal_endpoints table');
      }
      // 为 signal_endpoints 添加 信号名称、信号定义 列（存储各端点自己的信号名称和定义）
      const seCols2 = await this.query('PRAGMA table_info(signal_endpoints)');
      if (!seCols2.some((c: any) => c.name === '信号名称')) {
        await this.run('ALTER TABLE signal_endpoints ADD COLUMN 信号名称 TEXT');
        console.log('Database migration: added 信号名称 column to signal_endpoints table');
      }
      if (!seCols2.some((c: any) => c.name === '信号定义')) {
        await this.run('ALTER TABLE signal_endpoints ADD COLUMN 信号定义 TEXT');
        console.log('Database migration: added 信号定义 column to signal_endpoints table');
      }
      // 从 signals 表移除 信号定义 列（已迁移至 signal_endpoints）
      const sigCols = await this.query('PRAGMA table_info(signals)');
      if (sigCols.some((c: any) => c.name === '信号定义')) {
        await this.run('ALTER TABLE signals DROP COLUMN 信号定义');
        console.log('Database migration: dropped 信号定义 column from signals table');
      }
    } catch (e: any) {
      console.log('Migration: signal_endpoints 信号名称:', e.message);
    }

    // 为 devices/connectors/pins/signals 添加 version 列（乐观锁）
    for (const table of ['devices', 'connectors', 'pins', 'signals']) {
      try {
        const cols = await this.query(`PRAGMA table_info(${table})`);
        if (!cols.some((c: any) => c.name === 'version')) {
          await this.run(`ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
          console.log(`Database migration: added version column to ${table}`);
        }
      } catch (e: any) {
        console.log(`Migration: ${table} version column:`, e.message);
      }
    }

    // 从 signals 表删除 信号ATA 列
    try {
      const sigCols = await this.query(`PRAGMA table_info(signals)`);
      if (sigCols.some((c: any) => c.name === '信号ATA')) {
        await this.run(`ALTER TABLE signals DROP COLUMN 信号ATA`);
        console.log('Database migration: dropped 信号ATA column from signals');
      }
    } catch (e: any) {
      console.log('Migration: signals 信号ATA:', e.message);
    }

    // 为 uploaded_files 添加 color_data 列（存储导入颜色标注数据）
    try {
      const ufCols = await this.query(`PRAGMA table_info(uploaded_files)`);
      if (!ufCols.some((c: any) => c.name === 'color_data')) {
        await this.run(`ALTER TABLE uploaded_files ADD COLUMN color_data TEXT`);
        console.log('Database migration: added color_data column to uploaded_files');
      }
    } catch (e: any) {
      console.log('Migration: uploaded_files color_data:', e.message);
    }

    // 将 信号方向 从 signal_endpoints 迁移至 signals 表
    try {
      const sigColsDir = await this.query('PRAGMA table_info(signals)');
      if (!sigColsDir.some((c: any) => c.name === '信号方向')) {
        await this.run('ALTER TABLE signals ADD COLUMN 信号方向 TEXT');
        console.log('Database migration: added 信号方向 column to signals table');
      }
      const seColsDir = await this.query('PRAGMA table_info(signal_endpoints)');
      if (seColsDir.some((c: any) => c.name === '信号方向')) {
        await this.run('ALTER TABLE signal_endpoints DROP COLUMN 信号方向');
        console.log('Database migration: dropped 信号方向 column from signal_endpoints table');
      }
    } catch (e: any) {
      console.log('Migration: 信号方向 signal-level:', e.message);
    }

    // 为 users 表添加 display_name 和 department 列
    try {
      const userCols = await this.query('PRAGMA table_info(users)');
      const userColNames = userCols.map((c: any) => c.name);
      if (!userColNames.includes('display_name')) {
        await this.run('ALTER TABLE users ADD COLUMN display_name TEXT');
        console.log('Database migration: added display_name column to users table');
      }
      if (!userColNames.includes('department')) {
        await this.run('ALTER TABLE users ADD COLUMN department TEXT');
        console.log('Database migration: added department column to users table');
      }
    } catch (e: any) {
      console.log('Migration: users display_name/department:', e.message);
    }

    // 创建权限申请表
    try {
      await this.run(`
        CREATE TABLE IF NOT EXISTS permission_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          project_name TEXT NOT NULL,
          project_role TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME,
          reviewed_by INTEGER,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (reviewed_by) REFERENCES users(id)
        )
      `);
    } catch (e: any) {
      console.log('Migration: permission_requests table:', e.message);
    }

    // 为 signals 表添加 created_by 列（信号创建人）
    try {
      const sigCols2 = await this.query('PRAGMA table_info(signals)');
      if (!sigCols2.some((c: any) => c.name === 'created_by')) {
        await this.run('ALTER TABLE signals ADD COLUMN created_by TEXT');
        console.log('Database migration: added created_by column to signals');
      }
    } catch (e: any) {
      console.log('Migration: signals created_by:', e.message);
    }

    // 初始化默认用户（不再创建示例数据）
    await this.initDefaultData();
  }

  async initDefaultData() {
    // 检查是否已有用户
    const users = await this.query('SELECT COUNT(*) as count FROM users');
    if (users[0].count > 0) return;

    // 创建默认用户
    const adminPassword = await bcrypt.hash('admin123', 10);
    const userPassword = await bcrypt.hash('user123', 10);

    await this.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      ['admin', adminPassword, 'admin']
    );
    
    await this.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      ['user1', userPassword, 'user']
    );

    await this.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      ['user2', userPassword, 'user']
    );

    // 不再创建示例数据
    // 数据通过文件上传功能导入到独立的表中
  }

  run(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  query(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  close() {
    return new Promise<void>((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}


