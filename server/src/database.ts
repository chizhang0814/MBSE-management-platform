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

        // 项目数据表关联表
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
      // 检查并添加 uploaded_files 表的 table_name 列
      const columns = await this.query('PRAGMA table_info(uploaded_files)');
      const hasTableName = columns.some((col: any) => col.name === 'table_name');
      
      if (!hasTableName) {
        await this.run('ALTER TABLE uploaded_files ADD COLUMN table_name TEXT');
        console.log('Database migration: added table_name column to uploaded_files table');
      }
    } catch (error: any) {
      console.log('Migration: uploaded_files table check:', error.message);
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


