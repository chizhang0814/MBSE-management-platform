import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';

export class Database {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite3.Database(process.env.DB_PATH || './eicd.db');
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

        // 启用外键约束
        this.db.run(`PRAGMA foreign_keys = ON`);
        
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


