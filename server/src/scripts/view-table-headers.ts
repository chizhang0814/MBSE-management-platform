/**
 * 查看数据表的表头信息
 * 使用方法: cd server && npx tsx src/scripts/view-table-headers.ts <表名>
 */

import { Database } from '../database.js';

async function viewTableHeaders(tableName: string) {
  const db = new Database();
  await db.init();

  try {
    // 检查表是否存在
    const tableExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      [tableName]
    );

    if (!tableExists) {
      console.error(`❌ 表 "${tableName}" 不存在`);
      await db.close();
      process.exit(1);
    }

    // 从custom_tables获取原始列名
    const tableInfo = await db.get(
      'SELECT original_columns, display_name, record_count FROM custom_tables WHERE table_name = ?',
      [tableName]
    );

    console.log('========================================');
    console.log(`表名: ${tableName}`);
    console.log('========================================\n');

    if (tableInfo && tableInfo.original_columns) {
      try {
        const originalColumns = JSON.parse(tableInfo.original_columns);
        console.log(`显示名称: ${tableInfo.display_name || tableName}`);
        console.log(`记录数: ${tableInfo.record_count || 0}`);
        console.log(`总列数: ${originalColumns.length}`);
        console.log('\n表头（原始列名，Excel第一行）:');
        console.log('─'.repeat(50));
        originalColumns.forEach((col: string, index: number) => {
          console.log(`${String(index + 1).padStart(3, ' ')}. ${col}`);
        });
        console.log('─'.repeat(50));
      } catch (e) {
        console.error('⚠️  无法解析原始列名:', e);
      }
    } else {
      console.log('⚠️  未找到原始列名信息（可能是旧数据）');
    }

    // 获取数据库实际列名
    const dbColumns = await db.query(`PRAGMA table_info("${tableName}")`);
    console.log('\n数据库实际列名（清理后的）:');
    console.log('─'.repeat(50));
    dbColumns.forEach((col: any, index: number) => {
      // 跳过系统字段
      if (['id', 'status', 'created_at', 'updated_at'].includes(col.name)) {
        console.log(`${String(index + 1).padStart(3, ' ')}. ${col.name} (系统字段)`);
      } else {
        console.log(`${String(index + 1).padStart(3, ' ')}. ${col.name}`);
      }
    });
    console.log('─'.repeat(50));
    
    console.log('\n========================================');

  } catch (error: any) {
    console.error('❌ 查询失败:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// 从命令行参数获取表名
const args = process.argv.slice(2);
const tableName = args[0] || 'test2';

viewTableHeaders(tableName);

