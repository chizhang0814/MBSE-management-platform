import { Database } from '../database.js';
import fs from 'fs';
import path from 'path';

/**
 * 清理脚本 - 删除所有数据表和上传文件
 * 使用方法: cd server && npx tsx src/scripts/cleanup.ts
 */

const SYSTEM_TABLES = ['users', 'tasks', 'change_logs', 'uploaded_files', 'custom_tables', 'table_metadata'];

async function cleanup() {
  console.log('开始清理数据...\n');
  
  const db = new Database();
  await db.init();

  try {
    // 1. 获取所有数据表
    const allTables = await db.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `);

    const dataTables = allTables
      .map((t: any) => t.name)
      .filter((name: string) => !SYSTEM_TABLES.includes(name));

    console.log(`发现 ${dataTables.length} 个数据表:`);
    dataTables.forEach((name: string) => console.log(`  - ${name}`));
    console.log('');

    // 2. 删除所有数据表
    if (dataTables.length > 0) {
      console.log('正在删除数据表...');
      for (const tableName of dataTables) {
        try {
          await db.run(`DROP TABLE IF EXISTS "${tableName}"`);
          console.log(`  ✓ 已删除表: ${tableName}`);
        } catch (error: any) {
          console.error(`  ✗ 删除表 ${tableName} 失败:`, error.message);
        }
      }
    } else {
      console.log('没有需要删除的数据表');
    }
    console.log('');

    // 3. 清空系统表中的相关记录
    console.log('正在清空系统表记录...');
    
    // 清空custom_tables
    const customTablesDeleted = await db.run('DELETE FROM custom_tables');
    console.log(`  ✓ 已清空 custom_tables (${customTablesDeleted.changes} 条记录)`);
    
    // 清空uploaded_files
    const uploadedFilesDeleted = await db.run('DELETE FROM uploaded_files');
    console.log(`  ✓ 已清空 uploaded_files (${uploadedFilesDeleted.changes} 条记录)`);
    
    // 清空tasks
    const tasksDeleted = await db.run('DELETE FROM tasks');
    console.log(`  ✓ 已清空 tasks (${tasksDeleted.changes} 条记录)`);
    
    // 清空change_logs
    const changeLogsDeleted = await db.run('DELETE FROM change_logs');
    console.log(`  ✓ 已清空 change_logs (${changeLogsDeleted.changes} 条记录)`);
    console.log('');

    // 4. 删除上传文件
    console.log('正在删除上传文件...');
    const uploadsDir = path.join(process.cwd(), 'uploads');
    
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      let deletedCount = 0;
      
      for (const filename of files) {
        // 跳过deleted文件夹
        if (filename === 'deleted') {
          // 确保deleted文件夹存在
          const deletedDir = path.join(uploadsDir, 'deleted');
          if (!fs.existsSync(deletedDir)) {
            fs.mkdirSync(deletedDir, { recursive: true });
          }
          continue;
        }
        
        const filePath = path.join(uploadsDir, filename);
        try {
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
            console.log(`  ✓ 已删除文件: ${filename}`);
            deletedCount++;
          }
        } catch (error: any) {
          console.error(`  ✗ 删除文件 ${filename} 失败:`, error.message);
        }
      }
      
      if (deletedCount === 0) {
        console.log('  没有需要删除的文件');
      } else {
        console.log(`  共删除 ${deletedCount} 个文件`);
      }
    } else {
      console.log('  uploads目录不存在');
    }
    console.log('');

    console.log('✅ 清理完成！');
    console.log('\n注意:');
    console.log('  - 系统表 (users, tasks, change_logs等) 的结构已保留');
    console.log('  - 用户数据已保留');
    console.log('  - deleted文件夹中的文件未删除');
    
  } catch (error: any) {
    console.error('❌ 清理过程出错:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// 运行清理
cleanup();

