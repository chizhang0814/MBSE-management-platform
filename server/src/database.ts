import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

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
            "设备编号" TEXT NOT NULL,
            "设备中文名称" TEXT, "设备英文名称" TEXT, "设备英文缩写" TEXT,
            "设备供应商件号" TEXT, "设备供应商名称" TEXT, "设备部件所属系统（4位ATA）" TEXT,
            "设备安装位置" TEXT, "设备DAL" TEXT,
            "设备壳体是否金属" TEXT, "金属壳体表面是否经过特殊处理而不易导电" TEXT, "设备内共地情况" TEXT,
            "设备壳体接地方式" TEXT, "壳体接地是否故障电流路径" TEXT, "其他接地特殊要求" TEXT,
            "设备端连接器或接线柱数量" TEXT, "是否为选装设备" TEXT, "是否有特殊布线需求" TEXT, "设备装机架次" TEXT,
            "设备负责人" TEXT, "设备正常工作电压范围（V）" TEXT, "设备物理特性" TEXT, "备注" TEXT,
            "导入来源" TEXT, "created_by" TEXT,
            "设备编号（DOORS）" TEXT,
            "设备LIN号（DOORS）" TEXT NOT NULL,
            "设备装机构型" TEXT,
            "import_conflicts" TEXT,
            status TEXT DEFAULT 'normal',
            "validation_errors" TEXT,
            "version" INTEGER DEFAULT 1,
            "import_status" TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, "设备LIN号（DOORS）"),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )
        `);

        // ② connectors（连接器 - SysML Port）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS connectors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER NOT NULL,
            "设备端元器件编号" TEXT NOT NULL,
            "设备端元器件名称及类型" TEXT,
            "设备端元器件件号类型及件号" TEXT, "设备端元器件供应商名称" TEXT,
            "匹配的线束端元器件件号" TEXT, "匹配的线束线型" TEXT,
            "尾附件件号" TEXT, "触件型号" TEXT,
            "设备端元器件匹配的元器件是否随设备交付" TEXT, 备注 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            import_conflicts TEXT, validation_errors TEXT, "导入来源" TEXT,
            UNIQUE(device_id, "设备端元器件编号"),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
          )
        `);

        // ③ section_connectors（断面连接器）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS section_connectors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            设备名称 TEXT NOT NULL,
            负责人 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, 设备名称),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
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

        // ④ sc_connectors（断面连接器下的连接器）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS sc_connectors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section_connector_id INTEGER NOT NULL,
            连接器号 TEXT NOT NULL,
            设备端元器件编号 TEXT, 设备端元器件名称及类型 TEXT,
            设备端元器件件号类型及件号 TEXT, 设备端元器件供应商名称 TEXT,
            匹配的线束端元器件件号 TEXT, 匹配的线束线型 TEXT,
            设备端元器件匹配的元器件是否随设备交付 TEXT, 备注 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(section_connector_id, 连接器号),
            FOREIGN KEY (section_connector_id) REFERENCES section_connectors(id) ON DELETE CASCADE
          )
        `);

        // ⑤ sc_pins（断面连接器下连接器的针孔）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS sc_pins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sc_connector_id INTEGER NOT NULL,
            针孔号 TEXT NOT NULL,
            端接尺寸 TEXT, 屏蔽类型 TEXT, 备注 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(sc_connector_id, 针孔号),
            FOREIGN KEY (sc_connector_id) REFERENCES sc_connectors(id) ON DELETE CASCADE
          )
        `);

        // ④ signals（信号 - SysML ItemFlow）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            unique_id TEXT, 连接类型 TEXT, 信号ATA TEXT,
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

  /** 备份数据库文件到 server/backups/ 目录，保留最近 20 个备份 */
  async backupDatabase(): Promise<string | null> {
    try {
      const dbPath = path.resolve(process.env.DB_PATH || './eicd.db');
      if (!fs.existsSync(dbPath)) return null;

      const backupDir = path.join(path.dirname(dbPath), 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const now = new Date();
      const ts = now.getFullYear().toString()
        + String(now.getMonth() + 1).padStart(2, '0')
        + String(now.getDate()).padStart(2, '0')
        + '_'
        + String(now.getHours()).padStart(2, '0')
        + String(now.getMinutes()).padStart(2, '0')
        + String(now.getSeconds()).padStart(2, '0');
      const backupName = `eicd_${ts}.db`;
      const backupPath = path.join(backupDir, backupName);

      // 使用 SQLite 的 VACUUM INTO 进行安全备份（确保 WAL 数据已合并）
      try {
        await this.run(`VACUUM INTO ?`, [backupPath]);
      } catch {
        // 如果 VACUUM INTO 不可用（SQLite < 3.27），退回到文件复制
        fs.copyFileSync(dbPath, backupPath);
      }
      console.log(`Database backup created: ${backupPath}`);

      // 清理旧备份，只保留最近 20 个
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('eicd_') && f.endsWith('.db'))
        .sort();
      const MAX_BACKUPS = 20;
      if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(0, backups.length - MAX_BACKUPS);
        for (const f of toDelete) {
          fs.unlinkSync(path.join(backupDir, f));
          console.log(`Deleted old backup: ${f}`);
        }
      }
      return backupPath;
    } catch (e: any) {
      console.error('Database backup failed:', e.message);
      return null;
    }
  }

  async runMigrationsAndInit() {
    // 每次启动 / 迁移前先备份数据库
    await this.backupDatabase();

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
      if (!colNames.includes('skipped_count')) {
        await this.run('ALTER TABLE uploaded_files ADD COLUMN skipped_count INTEGER DEFAULT 0');
        console.log('Database migration: added skipped_count column to uploaded_files table');
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

    // 为 signals 表添加 信号ATA 列
    try {
      const sigCols = await this.query(`PRAGMA table_info(signals)`);
      if (!sigCols.some((c: any) => c.name === '信号ATA')) {
        await this.run(`ALTER TABLE signals ADD COLUMN 信号ATA TEXT`);
        console.log('Database migration: added 信号ATA column to signals');
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

    // 信号方向已下沉至 signal_endpoints 的 input/output 列，从 signals 表移除
    try {
      const sigColsDir = await this.query('PRAGMA table_info(signals)');
      if (sigColsDir.some((c: any) => c.name === '信号方向')) {
        await this.run('ALTER TABLE signals DROP COLUMN 信号方向');
        console.log('Database migration: dropped 信号方向 column from signals table');
      }
      // 同时确保 signal_endpoints 也没有残留的 信号方向 列
      const seColsDir = await this.query('PRAGMA table_info(signal_endpoints)');
      if (seColsDir.some((c: any) => c.name === '信号方向')) {
        await this.run('ALTER TABLE signal_endpoints DROP COLUMN 信号方向');
        console.log('Database migration: dropped 信号方向 column from signal_endpoints table');
      }
    } catch (e: any) {
      console.log('Migration: drop 信号方向:', e.message);
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

    try {
      // 创建 notifications 表（站内通知）
      await this.run(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient_username TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'signal_deleted',
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (e: any) {
      console.log('Migration: notifications table:', e.message);
    }

    // 为 notifications 添加 reference_id 列（关联 permission_requests.id 等）
    try {
      const notifCols = await this.query('PRAGMA table_info(notifications)');
      if (!notifCols.some((c: any) => c.name === 'reference_id')) {
        await this.run('ALTER TABLE notifications ADD COLUMN reference_id INTEGER');
        console.log('Database migration: added reference_id column to notifications');
      }
    } catch (e: any) {
      console.log('Migration: notifications reference_id:', e.message);
    }

    // 为 signal_endpoints 添加 confirmed 列（端点确认状态）
    try {
      const seColsConf = await this.query('PRAGMA table_info(signal_endpoints)');
      if (!seColsConf.some((c: any) => c.name === 'confirmed')) {
        await this.run('ALTER TABLE signal_endpoints ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 1');
        console.log('Database migration: added confirmed column to signal_endpoints');
      }
    } catch (e: any) {
      console.log('Migration: signal_endpoints confirmed:', e.message);
    }

    // 为 signal_endpoints 添加 input / output / 备注 列
    try {
      const seCols2 = await this.query('PRAGMA table_info(signal_endpoints)');
      const seColNames2 = seCols2.map((c: any) => c.name);
      if (!seColNames2.includes('input')) {
        await this.run('ALTER TABLE signal_endpoints ADD COLUMN input INTEGER NOT NULL DEFAULT 0');
        console.log('Database migration: added input column to signal_endpoints');
      }
      if (!seColNames2.includes('output')) {
        await this.run('ALTER TABLE signal_endpoints ADD COLUMN output INTEGER NOT NULL DEFAULT 0');
        console.log('Database migration: added output column to signal_endpoints');
      }
      if (!seColNames2.includes('备注')) {
        await this.run('ALTER TABLE signal_endpoints ADD COLUMN 备注 TEXT');
        console.log('Database migration: added 备注 column to signal_endpoints');
      }
    } catch (e: any) {
      console.log('Migration: signal_endpoints input/output/备注:', e.message);
    }

    // 为 signal_endpoints 添加 device_id 列 + 使 pin_id 可空（支持不完整端点）
    try {
      const seColsDev = await this.query('PRAGMA table_info(signal_endpoints)');
      const hasDeviceId = seColsDev.some((c: any) => c.name === 'device_id');
      const pinColInfo = seColsDev.find((c: any) => c.name === 'pin_id');
      const pinIsNotNull = pinColInfo && pinColInfo.notnull === 1;

      console.log(`Migration check: hasDeviceId=${hasDeviceId}, pinIsNotNull=${pinIsNotNull}, pinColInfo=${JSON.stringify(pinColInfo)}`);
      if (!hasDeviceId || pinIsNotNull) {
        // 需要重建表：添加 device_id，pin_id 改为可空
        await this.run('DROP TABLE IF EXISTS signal_endpoints_new');
        await this.run(`CREATE TABLE signal_endpoints_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          signal_id INTEGER NOT NULL,
          device_id INTEGER,
          pin_id INTEGER,
          endpoint_index INTEGER NOT NULL DEFAULT 0,
          "端接尺寸" TEXT, "信号名称" TEXT, "信号定义" TEXT,
          confirmed INTEGER NOT NULL DEFAULT 1,
          input INTEGER NOT NULL DEFAULT 0,
          output INTEGER NOT NULL DEFAULT 0,
          "备注" TEXT,
          FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE,
          FOREIGN KEY (device_id) REFERENCES devices(id),
          FOREIGN KEY (pin_id) REFERENCES pins(id) ON DELETE RESTRICT
        )`);
        // 迁移数据
        const oldCols = seColsDev.map((c: any) => c.name);
        const commonCols = ['id','signal_id','pin_id','endpoint_index','端接尺寸','信号名称','信号定义']
          .filter(c => oldCols.includes(c));
        if (oldCols.includes('confirmed')) commonCols.push('confirmed');
        if (oldCols.includes('input')) commonCols.push('input');
        if (oldCols.includes('output')) commonCols.push('output');
        if (oldCols.includes('备注')) commonCols.push('备注');
        if (oldCols.includes('device_id')) commonCols.push('device_id');
        const colList = commonCols.map(c => `"${c}"`).join(', ');
        await this.run(`INSERT INTO signal_endpoints_new (${colList}) SELECT ${colList} FROM signal_endpoints`);
        await this.run('DROP TABLE signal_endpoints');
        await this.run('ALTER TABLE signal_endpoints_new RENAME TO signal_endpoints');
        // 回填 device_id（从 pin → connector → device）
        await this.run(`
          UPDATE signal_endpoints SET device_id = (
            SELECT d.id FROM pins p
            JOIN connectors c ON p.connector_id = c.id
            JOIN devices d ON c.device_id = d.id
            WHERE p.id = signal_endpoints.pin_id
          ) WHERE pin_id IS NOT NULL AND device_id IS NULL
        `);
        console.log('Database migration: rebuilt signal_endpoints with nullable pin_id and device_id');
      }
    } catch (e: any) {
      console.log('Migration: signal_endpoints rebuild:', e.message);
    }

    // 为 signals 添加 status 列（Draft / Pending / Active）
    try {
      const sigColsSt = await this.query('PRAGMA table_info(signals)');
      if (!sigColsSt.some((c: any) => c.name === 'status')) {
        await this.run(`ALTER TABLE signals ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'`);
        console.log('Database migration: added status column to signals');
      }
    } catch (e: any) {
      console.log('Migration: signals status:', e.message);
    }

    // 新增 aircraft_device_list 表（全机设备清单，管理员导入 Excel）
    await this.run(`
      CREATE TABLE IF NOT EXISTS aircraft_device_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        object_identifier TEXT,
        系统名称 TEXT,
        object_text TEXT,
        设备编号_DOORS TEXT,
        LIN号_DOORS TEXT,
        设备布置区域 TEXT,
        飞机构型 TEXT,
        是否有供应商数模 TEXT,
        是否已布置在样机 TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);
    await this.run(`
      CREATE INDEX IF NOT EXISTS idx_aircraft_devices_project ON aircraft_device_list(project_id)
    `);

    // 为 aircraft_device_list 补充扩展列
    const adlCols = await this.query('PRAGMA table_info(aircraft_device_list)');
    for (const col of ['电设备编号', '是否有EICD', '是否确认设备选型', '是否已确认MICD', '模型成熟度', '是否是用电设备', '类型']) {
      if (!adlCols.some((c: any) => c.name === col)) {
        await this.run(`ALTER TABLE aircraft_device_list ADD COLUMN "${col}" TEXT DEFAULT '-'`);
        console.log(`Database migration: added column "${col}" to aircraft_device_list`);
      }
    }

    // 新增 project_configurations 表（项目构型管理）
    await this.run(`
      CREATE TABLE IF NOT EXISTS project_configurations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // 为 devices 表添加 DOORS 关联列
    try {
      const devCols = await this.query('PRAGMA table_info(devices)');
      if (!devCols.some((c: any) => c.name === '设备编号（DOORS）')) {
        await this.run(`ALTER TABLE devices ADD COLUMN "设备编号（DOORS）" TEXT`);
        console.log('Database migration: added 设备编号（DOORS） column to devices');
      }
      if (!devCols.some((c: any) => c.name === '设备LIN号（DOORS）')) {
        await this.run(`ALTER TABLE devices ADD COLUMN "设备LIN号（DOORS）" TEXT`);
        console.log('Database migration: added 设备LIN号（DOORS） column to devices');
      }
    } catch (e: any) {
      console.log('Migration: devices DOORS columns:', e.message);
    }

    // devices 列重命名 / 新增 / 删除
    try {
      const devCols2 = await this.query('PRAGMA table_info(devices)');
      const names = devCols2.map((c: any) => c.name);

      const renames: [string, string][] = [
        ['设备件号',         '设备供应商件号'],
        ['壳体是否金属',     '设备壳体是否金属'],
        ['金属壳体表面处理', '金属壳体表面是否经过特殊处理而不易导电'],
        ['壳体接地需求',     '设备壳体接地方式'],
        ['额定电压',         '设备正常工作电压范围（V）'],
        ['设备端连接器数量', '设备端连接器或接线柱数量'],
        ['设备所属ATA',      '设备部件所属系统（4位ATA）'],
        ['是否选装设备',     '是否为选装设备'],
      ];
      for (const [oldName, newName] of renames) {
        if (names.includes(oldName) && !names.includes(newName)) {
          await this.run(`ALTER TABLE devices RENAME COLUMN "${oldName}" TO "${newName}"`);
          console.log(`Database migration: renamed devices.${oldName} → ${newName}`);
        }
      }

      const devCols3 = await this.query('PRAGMA table_info(devices)');
      const names3 = devCols3.map((c: any) => c.name);
      if (!names3.includes('设备物理特性')) {
        await this.run(`ALTER TABLE devices ADD COLUMN "设备物理特性" TEXT`);
        console.log('Database migration: added 设备物理特性 column to devices');
      }
      if (names3.includes('额定电流')) {
        await this.run(`ALTER TABLE devices DROP COLUMN "额定电流"`);
        console.log('Database migration: dropped 额定电流 column from devices');
      }
      if (!names3.includes('导入来源')) {
        await this.run(`ALTER TABLE devices ADD COLUMN "导入来源" TEXT`);
        console.log('Database migration: added 导入来源 column to devices');
      }
      if (!names3.includes('created_by')) {
        await this.run(`ALTER TABLE devices ADD COLUMN "created_by" TEXT`);
        console.log('Database migration: added created_by column to devices');
      }
      if (!names3.includes('validation_errors')) {
        await this.run(`ALTER TABLE devices ADD COLUMN "validation_errors" TEXT`);
        console.log('Database migration: added validation_errors column to devices');
      }
      if (!names3.includes('import_conflicts')) {
        await this.run(`ALTER TABLE devices ADD COLUMN "import_conflicts" TEXT`);
        console.log('Database migration: added import_conflicts column to devices');
      }
    } catch (e: any) {
      console.log('Migration: devices column rename/add/drop:', e.message);
    }

    // 旧迁移（已废弃）：devices 唯一约束变更已由后面的 LIN号 NOT NULL + UNIQUE 迁移统一处理

    // 为 connectors 表添加 导入来源、import_conflicts、validation_errors 列
    try {
      const connColsMig = await this.query('PRAGMA table_info(connectors)');
      const connColNames = connColsMig.map((c: any) => c.name);
      if (!connColNames.includes('导入来源')) {
        await this.run(`ALTER TABLE connectors ADD COLUMN "导入来源" TEXT`);
        console.log('Database migration: added 导入来源 column to connectors');
      }
      if (!connColNames.includes('import_conflicts')) {
        await this.run(`ALTER TABLE connectors ADD COLUMN "import_conflicts" TEXT`);
        console.log('Database migration: added import_conflicts column to connectors');
      }
      if (!connColNames.includes('validation_errors')) {
        await this.run(`ALTER TABLE connectors ADD COLUMN "validation_errors" TEXT`);
        console.log('Database migration: added validation_errors column to connectors');
      }
    } catch (e: any) {
      console.log('Migration: connectors new columns:', e.message);
    }

    // 迁移：connectors 列名变更
    try {
      const connCols = await this.query('PRAGMA table_info(connectors)');
      const connNames = connCols.map((c: any) => c.name);
      const connRenames: [string, string][] = [
        ['元器件名称及类型',   '设备端元器件名称及类型'],
        ['元器件件号及类型',   '设备端元器件件号类型及件号'],
        ['元器件供应商名称',   '设备端元器件供应商名称'],
        ['匹配线束端元器件件号', '匹配的线束端元器件件号'],
        ['匹配线束线型',       '匹配的线束线型'],
        ['是否随设备交付',     '设备端元器件匹配的元器件是否随设备交付'],
      ];
      for (const [oldName, newName] of connRenames) {
        if (connNames.includes(oldName) && !connNames.includes(newName)) {
          await this.run(`ALTER TABLE connectors RENAME COLUMN "${oldName}" TO "${newName}"`);
          console.log(`Database migration: connectors "${oldName}" → "${newName}"`);
        }
      }
    } catch (e: any) {
      console.log('Migration: connectors column rename:', e.message);
    }

    // 迁移：connectors 表重建——删除 连接器号，以 设备端元器件编号 为唯一标识
    try {
      const connColsRebuild = await this.query('PRAGMA table_info(connectors)');
      const hasOldConnCol = connColsRebuild.some((c: any) => c.name === '连接器号');
      if (hasOldConnCol) {
        await this.run('PRAGMA foreign_keys = OFF');
        await this.run(`
          CREATE TABLE connectors_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER NOT NULL,
            "设备端元器件编号" TEXT NOT NULL,
            "设备端元器件名称及类型" TEXT,
            "设备端元器件件号类型及件号" TEXT, "设备端元器件供应商名称" TEXT,
            "匹配的线束端元器件件号" TEXT, "匹配的线束线型" TEXT,
            "尾附件件号" TEXT, "触件型号" TEXT,
            "设备端元器件匹配的元器件是否随设备交付" TEXT, 备注 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            import_conflicts TEXT, validation_errors TEXT, "导入来源" TEXT,
            UNIQUE(device_id, "设备端元器件编号"),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
          )
        `);
        // 仅迁移 设备端元器件编号 不为空的记录（空值属无效数据，直接丢弃）
        const migrateResult = await this.run(`
          INSERT OR IGNORE INTO connectors_new
            (id, device_id, "设备端元器件编号", "设备端元器件名称及类型",
             "设备端元器件件号类型及件号", "设备端元器件供应商名称",
             "匹配的线束端元器件件号", "匹配的线束线型",
             "设备端元器件匹配的元器件是否随设备交付", 备注,
             status, created_at, updated_at, import_conflicts, validation_errors, "导入来源")
          SELECT id, device_id, "设备端元器件编号", "设备端元器件名称及类型",
                 "设备端元器件件号类型及件号", "设备端元器件供应商名称",
                 "匹配的线束端元器件件号", "匹配的线束线型",
                 "设备端元器件匹配的元器件是否随设备交付", 备注,
                 status, created_at, updated_at, import_conflicts, validation_errors, "导入来源"
          FROM connectors
          WHERE "设备端元器件编号" IS NOT NULL AND TRIM("设备端元器件编号") != ''
        `);
        await this.run('DROP TABLE connectors');
        await this.run('ALTER TABLE connectors_new RENAME TO connectors');
        await this.run('PRAGMA foreign_keys = ON');
        console.log(`Database migration: connectors table rebuilt (removed 连接器号, migrated ${migrateResult.changes} rows)`);
      }
    } catch (e: any) {
      console.log('Migration: connectors rebuild:', e.message);
      try { await this.run('PRAGMA foreign_keys = ON'); } catch {}
    }

    // 新增 approval_requests 表（多人审批流程）
    await this.run(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        requester_id INTEGER NOT NULL,
        requester_username TEXT NOT NULL,
        action_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        device_id INTEGER,
        old_payload TEXT,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        current_phase TEXT NOT NULL DEFAULT 'approval',
        rejection_reason TEXT,
        rejected_by_username TEXT,
        rejected_at DATETIME,
        reviewed_by_username TEXT,
        reviewed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (requester_id) REFERENCES users(id)
      )
    `);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_approval_project ON approval_requests(project_id)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_approval_status  ON approval_requests(status)`);

    // 新增 approval_items 表（每个审批请求中各接收人的独立状态）
    await this.run(`
      CREATE TABLE IF NOT EXISTS approval_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        approval_request_id INTEGER NOT NULL,
        recipient_username TEXT NOT NULL,
        item_type TEXT NOT NULL DEFAULT 'approval',
        status TEXT NOT NULL DEFAULT 'pending',
        edited_payload TEXT,
        rejection_reason TEXT,
        responded_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id) ON DELETE CASCADE
      )
    `);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_approval_items_req ON approval_items(approval_request_id)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_approval_items_recipient ON approval_items(recipient_username)`);

    // 清理废弃表
    try {
      await this.run('DROP TABLE IF EXISTS project_tables');
      await this.run('DROP TABLE IF EXISTS table_metadata');
      await this.run('DROP TABLE IF EXISTS custom_tables');
      await this.run('DROP TABLE IF EXISTS templates');
      await this.run('DROP TABLE IF EXISTS employees');
    } catch (e: any) {
      console.log('Migration: drop legacy tables:', e.message);
    }

    // 迁移：section_connectors 简化为只有 设备名称 的顶层实体表（删除所有连接器字段）
    try {
      const scCols = await this.query('PRAGMA table_info(section_connectors)');
      const hasOldSchema = scCols.some((c: any) =>
        c.name === '连接器号' || c.name === '设备端元器件编号'
      );
      if (hasOldSchema) {
        await this.run('DROP TABLE section_connectors');
        await this.run(`
          CREATE TABLE section_connectors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            设备名称 TEXT NOT NULL,
            负责人 TEXT,
            status TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, 设备名称),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )
        `);
        console.log('Database migration: rebuilt section_connectors as simple device-name-only table');
      }
    } catch (e: any) {
      console.log('Migration: section_connectors simplify:', e.message);
    }

    // 为 signals 添加 import_conflicts 列（记录导入合并信息）
    try {
      const sigColsIc = await this.query('PRAGMA table_info(signals)');
      if (!sigColsIc.some((c: any) => c.name === 'import_conflicts')) {
        await this.run(`ALTER TABLE signals ADD COLUMN import_conflicts TEXT`);
        console.log('Database migration: added import_conflicts column to signals');
      }
    } catch (e: any) {
      console.log('Migration: signals import_conflicts:', e.message);
    }

    // ── 迁移：升级 approval_requests 表（添加新列）────────────────────────────
    try {
      const arCols = await this.query('PRAGMA table_info(approval_requests)');
      const arColNames = arCols.map((c: any) => c.name);
      if (!arColNames.includes('current_phase')) {
        await this.run(`ALTER TABLE approval_requests ADD COLUMN old_payload TEXT`);
        await this.run(`ALTER TABLE approval_requests ADD COLUMN current_phase TEXT NOT NULL DEFAULT 'approval'`);
        await this.run(`ALTER TABLE approval_requests ADD COLUMN rejected_by_username TEXT`);
        await this.run(`ALTER TABLE approval_requests ADD COLUMN rejected_at DATETIME`);
        console.log('Database migration: upgraded approval_requests table');
      }
    } catch (e: any) {
      console.log('Migration: approval_requests upgrade:', e.message);
    }

    // ── 一次性迁移已完成，以下代码已移除 ──
    // 旧的"取消pending审批请求"和"重置Pending实体为Draft"的迁移代码
    // 已在2026-03-03完成，不再需要每次重启都执行

    // ── 迁移：将所有用户permissions中的"项目管理员"改为"总体人员" ────────────────
    try {
      const allUsers = await this.query(`SELECT id, permissions FROM users WHERE permissions IS NOT NULL AND permissions != '[]'`);
      for (const u of allUsers) {
        try {
          const perms = JSON.parse(u.permissions || '[]');
          const updated = perms.map((p: any) =>
            p.project_role === '项目管理员' ? { ...p, project_role: '总体人员' } : p
          );
          if (JSON.stringify(updated) !== JSON.stringify(perms)) {
            await this.run('UPDATE users SET permissions = ? WHERE id = ?', [JSON.stringify(updated), u.id]);
          }
        } catch {}
      }
      console.log('Database migration: renamed 项目管理员 to 总体人员 in permissions');
    } catch (e: any) {
      console.log('Migration: rename role:', e.message);
    }

    // 为 connectors 表添加 尾附件件号、触件型号 列
    try {
      const connColsMig2 = await this.query('PRAGMA table_info(connectors)');
      const connColNames2 = connColsMig2.map((c: any) => c.name);
      if (!connColNames2.includes('尾附件件号')) {
        await this.run(`ALTER TABLE connectors ADD COLUMN "尾附件件号" TEXT`);
        console.log('Database migration: added 尾附件件号 column to connectors');
      }
      if (!connColNames2.includes('触件型号')) {
        await this.run(`ALTER TABLE connectors ADD COLUMN "触件型号" TEXT`);
        console.log('Database migration: added 触件型号 column to connectors');
      }
    } catch (e: any) {
      console.log('Migration: connectors 尾附件件号/触件型号 columns:', e.message);
    }

    // 为 devices 表添加 是否有特殊布线需求 列
    try {
      const devColsMig = await this.query('PRAGMA table_info(devices)');
      if (!devColsMig.some((c: any) => c.name === '是否有特殊布线需求')) {
        await this.run(`ALTER TABLE devices ADD COLUMN "是否有特殊布线需求" TEXT`);
        console.log('Database migration: added 是否有特殊布线需求 column to devices');
      }
    } catch (e: any) {
      console.log('Migration: devices 是否有特殊布线需求 column:', e.message);
    }

    // 为 devices 表添加 设备装机构型 列
    try {
      const devColsMig2 = await this.query('PRAGMA table_info(devices)');
      if (!devColsMig2.some((c: any) => c.name === '设备装机构型')) {
        await this.run(`ALTER TABLE devices ADD COLUMN "设备装机构型" TEXT`);
        console.log('Database migration: added 设备装机构型 column to devices');
      }
    } catch (e: any) {
      console.log('Migration: devices 设备装机构型 column:', e.message);
    }

    // ── 迁移：将 employees 表合并到 users（方案B）──────────────────────────────
    try {
      const userCols = await this.query('PRAGMA table_info(users)');
      const userColNames = userCols.map((c: any) => c.name);
      if (!userColNames.includes('name')) {
        await this.run(`ALTER TABLE users ADD COLUMN name TEXT`);
        console.log('Database migration: added name column to users');
      }
      if (!userColNames.includes('remarks')) {
        await this.run(`ALTER TABLE users ADD COLUMN remarks TEXT`);
        console.log('Database migration: added remarks column to users');
      }
      // 从 employees 表复制姓名数据到 users
      const empRows = await this.query('SELECT eid, name, remarks FROM employees');
      for (const emp of empRows) {
        await this.run(
          `UPDATE users SET name = ?, remarks = ? WHERE username = ? AND name IS NULL`,
          [emp.name, emp.remarks, emp.eid]
        );
      }
      if (empRows.length > 0) {
        console.log(`Database migration: merged ${empRows.length} employees into users.name`);
      }
    } catch (e: any) {
      console.log('Migration: merge employees into users:', e.message);
    }

    // 为 devices/connectors/pins/signals 添加 import_status 列
    for (const table of ['devices', 'connectors', 'pins', 'signals']) {
      try {
        const cols = await this.query(`PRAGMA table_info(${table})`);
        if (!cols.some((c: any) => c.name === 'import_status')) {
          await this.run(`ALTER TABLE ${table} ADD COLUMN import_status TEXT`);
          console.log(`Database migration: added import_status column to ${table}`);
        }
      } catch (e: any) {
        console.log(`Migration: ${table} import_status column:`, e.message);
      }
    }

    // 迁移：清理残留的 devices_old / devices_new 表
    try {
      await this.run(`DROP TABLE IF EXISTS devices_old`);
      await this.run(`DROP TABLE IF EXISTS devices_new`);
    } catch (e: any) {
      // ignore
    }

    // 迁移：重建 devices 表以添加 设备LIN号（DOORS） NOT NULL + UNIQUE 约束，移除旧 UNIQUE(project_id, 设备编号, 设备中文名称)
    try {
      const colInfo = await this.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='devices'`);
      const needsRebuild = colInfo && (
        !colInfo.sql.includes('"设备LIN号（DOORS）" TEXT NOT NULL') ||
        colInfo.sql.includes('UNIQUE(project_id, "设备编号", "设备中文名称")')
      );
      if (needsRebuild) {
        console.log('Database migration: rebuilding devices table...');
        await this.run(`PRAGMA foreign_keys = OFF`);
        await this.run(`ALTER TABLE devices RENAME TO devices_old`);
        await this.run(`
          CREATE TABLE devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            "设备编号" TEXT NOT NULL,
            "设备中文名称" TEXT, "设备英文名称" TEXT, "设备英文缩写" TEXT,
            "设备供应商件号" TEXT, "设备供应商名称" TEXT, "设备部件所属系统（4位ATA）" TEXT,
            "设备安装位置" TEXT, "设备DAL" TEXT,
            "设备壳体是否金属" TEXT, "金属壳体表面是否经过特殊处理而不易导电" TEXT, "设备内共地情况" TEXT,
            "设备壳体接地方式" TEXT, "壳体接地是否故障电流路径" TEXT, "其他接地特殊要求" TEXT,
            "设备端连接器或接线柱数量" TEXT, "是否为选装设备" TEXT, "是否有特殊布线需求" TEXT, "设备装机架次" TEXT,
            "设备负责人" TEXT, "设备正常工作电压范围（V）" TEXT, "设备物理特性" TEXT, "备注" TEXT,
            "导入来源" TEXT, "created_by" TEXT,
            "设备编号（DOORS）" TEXT,
            "设备LIN号（DOORS）" TEXT NOT NULL,
            "设备装机构型" TEXT,
            "import_conflicts" TEXT,
            status TEXT DEFAULT 'normal',
            "validation_errors" TEXT,
            "version" INTEGER DEFAULT 1,
            "import_status" TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, "设备LIN号（DOORS）"),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )
        `);
        try {
          await this.run(`INSERT INTO devices SELECT * FROM devices_old`);
        } catch (e: any) {
          console.log('Migration: no data to copy or column mismatch, skipping copy');
        }
        await this.run(`DROP TABLE devices_old`);
        await this.run(`PRAGMA foreign_keys = ON`);
        console.log('Database migration: devices table rebuilt with LIN号 NOT NULL + UNIQUE (old UNIQUE removed)');
      }
    } catch (e: any) {
      console.log('Migration: rebuild devices table:', e.message);
    }

    // 迁移：修复 connectors / signal_endpoints 外键指向 devices_old 的问题
    try {
      const connSql = await this.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='connectors'`);
      if (connSql && connSql.sql.includes('devices_old')) {
        console.log('Database migration: rebuilding connectors to fix FK → devices_old...');
        await this.run(`PRAGMA foreign_keys = OFF`);
        const createSql = connSql.sql.replace(/devices_old/g, 'devices').replace(/CREATE TABLE "?connectors"?/, 'CREATE TABLE connectors_fixed');
        await this.run(`ALTER TABLE connectors RENAME TO connectors_broken`);
        await this.run(createSql);
        try { await this.run(`INSERT INTO connectors_fixed SELECT * FROM connectors_broken`); } catch (e: any) { console.log('  connectors copy:', e.message); }
        await this.run(`DROP TABLE connectors_broken`);
        await this.run(`ALTER TABLE connectors_fixed RENAME TO connectors`);
        await this.run(`PRAGMA foreign_keys = ON`);
        console.log('  connectors FK fixed.');
      }
    } catch (e: any) { console.log('Migration: fix connectors FK:', e.message); }

    try {
      const pinsSql = await this.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='pins'`);
      if (pinsSql && pinsSql.sql.includes('connectors_broken')) {
        console.log('Database migration: rebuilding pins to fix FK → connectors_broken...');
        await this.run(`PRAGMA foreign_keys = OFF`);
        const createSql = pinsSql.sql.replace(/connectors_broken/g, 'connectors').replace(/CREATE TABLE "?pins"?/, 'CREATE TABLE pins_fixed');
        await this.run(`ALTER TABLE pins RENAME TO pins_old`);
        await this.run(createSql);
        try { await this.run(`INSERT INTO pins_fixed SELECT * FROM pins_old`); } catch (e: any) { console.log('  pins copy:', e.message); }
        await this.run(`DROP TABLE pins_old`);
        await this.run(`ALTER TABLE pins_fixed RENAME TO pins`);
        await this.run(`PRAGMA foreign_keys = ON`);
        console.log('  pins FK fixed.');
      }
    } catch (e: any) { console.log('Migration: fix pins FK:', e.message); }

    try {
      const seSql = await this.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='signal_endpoints'`);
      if (seSql && (seSql.sql.includes('devices_old') || seSql.sql.includes('pins_old'))) {
        console.log('Database migration: rebuilding signal_endpoints to fix FK...');
        await this.run(`PRAGMA foreign_keys = OFF`);
        const createSql = seSql.sql.replace(/devices_old/g, 'devices').replace(/pins_old/g, 'pins').replace(/CREATE TABLE "?signal_endpoints"?/, 'CREATE TABLE signal_endpoints_fixed');
        await this.run(`ALTER TABLE signal_endpoints RENAME TO signal_endpoints_old`);
        await this.run(createSql);
        try { await this.run(`INSERT INTO signal_endpoints_fixed SELECT * FROM signal_endpoints_old`); } catch (e: any) { console.log('  signal_endpoints copy:', e.message); }
        await this.run(`DROP TABLE signal_endpoints_old`);
        await this.run(`ALTER TABLE signal_endpoints_fixed RENAME TO signal_endpoints`);
        await this.run(`PRAGMA foreign_keys = ON`);
        console.log('  signal_endpoints FK fixed.');
      }
    } catch (e: any) { console.log('Migration: fix signal_endpoints FK:', e.message); }

    try {
      const sigColsWt = await this.query('PRAGMA table_info(signals)');
      if (!sigColsWt.some((c: any) => c.name === '线类型')) {
        await this.run(`ALTER TABLE signals ADD COLUMN 线类型 TEXT`);
        console.log('Database migration: added 线类型 column to signals');
      }
    } catch (e: any) { console.log('Migration: signals 线类型:', e.message); }

    try {
      const devColsDj = await this.query('PRAGMA table_info(devices)');
      if (!devColsDj.some((c: any) => c.name === '设备等级')) {
        await this.run(`ALTER TABLE devices ADD COLUMN 设备等级 TEXT`);
        console.log('Database migration: added 设备等级 column to devices');
      }
    } catch (e: any) { console.log('Migration: devices 设备等级:', e.message); }

    try {
      const sigColsXy = await this.query('PRAGMA table_info(signals)');
      if (!sigColsXy.some((c: any) => c.name === '协议标识')) {
        await this.run(`ALTER TABLE signals ADD COLUMN 协议标识 TEXT`);
        console.log('Database migration: added 协议标识 column to signals');
      }
    } catch (e: any) { console.log('Migration: signals 协议标识:', e.message); }

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


