#!/usr/bin/env node
/**
 * 从生产服务器同步数据库到本地
 *
 * 用法: node sync-prod-db.mjs [--dry-run]
 *
 * 流程:
 *   1. scp 下载服务器 DB → 本地临时文件
 *   2. 对比本地 DB 与服务器 DB 的表结构差异
 *   3. 在服务器 DB 副本上执行 ALTER TABLE 补齐本地新增的列/表
 *   4. 备份当前本地 DB，用对齐后的服务器 DB 替换
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import sqlite3Pkg from 'sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 配置 ───────────────────────────────────────────────
const SERVER_IP   = '8.140.11.97';
const PEM_PATH    = String.raw`D:\Downloads\mbse.pem`;
const REMOTE_DB   = '/opt/mbse-platform/data/sqlite/eicd.db';
const LOCAL_DB    = path.join(__dirname, 'eicd.db');
const TEMP_DB     = path.join(__dirname, 'eicd_prod_tmp.db');
const DRY_RUN     = process.argv.includes('--dry-run');
// ────────────────────────────────────────────────────────

const sqlite3 = sqlite3Pkg.verbose();

/** Promise wrapper for sqlite3 */
function openDb(filePath, mode = sqlite3Pkg.OPEN_READWRITE) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, mode, err => err ? reject(err) : resolve(db));
  });
}
function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}
function dbClose(db) {
  return new Promise((resolve, reject) => {
    db.close(err => err ? reject(err) : resolve());
  });
}

/** 获取数据库所有表的 schema 信息 */
async function getSchema(db) {
  const tables = await dbAll(db,
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );
  const schema = {};
  for (const t of tables) {
    const columns = await dbAll(db, `PRAGMA table_info("${t.name}")`);
    schema[t.name] = { sql: t.sql, columns };
  }
  return schema;
}

async function main() {
  // ── Step 1: 在服务器上创建一致性备份，再下载 ─────────
  console.log('\n[1/4] 从服务器下载数据库...');
  try {
    // 用 sqlite3 .backup 创建一致性副本（避免 WAL 模式下 scp 拿到不完整的数据）
    const sshPrefix = `ssh -F /dev/null -i "${PEM_PATH}" -o StrictHostKeyChecking=no root@${SERVER_IP}`;
    execSync(
      `${sshPrefix} "sqlite3 ${REMOTE_DB} '.backup /tmp/eicd_export.db'"`,
      { stdio: 'inherit' }
    );
    execSync(
      `scp -F /dev/null -i "${PEM_PATH}" -o StrictHostKeyChecking=no root@${SERVER_IP}:/tmp/eicd_export.db "${TEMP_DB}"`,
      { stdio: 'inherit' }
    );
    execSync(`${sshPrefix} "rm -f /tmp/eicd_export.db"`, { stdio: 'pipe' });
    console.log('  下载完成:', TEMP_DB);
  } catch (e) {
    console.error('  下载失败:', e.message);
    process.exit(1);
  }

  // ── Step 2: 对比 schema ───────────────────────────────
  console.log('\n[2/4] 对比表结构差异...');

  if (!fs.existsSync(LOCAL_DB)) {
    console.log('  本地数据库不存在，直接使用服务器版本。');
    fs.renameSync(TEMP_DB, LOCAL_DB);
    console.log('  完成!');
    return;
  }

  const localDb = await openDb(LOCAL_DB, sqlite3Pkg.OPEN_READONLY);
  const prodDb  = await openDb(TEMP_DB,  sqlite3Pkg.OPEN_READWRITE);

  const localSchema = await getSchema(localDb);
  const prodSchema  = await getSchema(prodDb);

  const migrations = [];

  // 本地有但服务器没有的表 → 在服务器副本上创建
  for (const [table, info] of Object.entries(localSchema)) {
    if (!prodSchema[table]) {
      migrations.push({
        type: 'CREATE TABLE',
        table,
        sql: info.sql,
      });
    }
  }

  // 本地有但服务器没有的列 → ALTER TABLE ADD COLUMN
  for (const [table, info] of Object.entries(localSchema)) {
    if (prodSchema[table]) {
      const prodCols = new Set(prodSchema[table].columns.map(c => c.name));
      for (const col of info.columns) {
        if (!prodCols.has(col.name)) {
          const colType = col.type || 'TEXT';
          const dflt = col.dflt_value != null ? ` DEFAULT ${col.dflt_value}` : '';
          migrations.push({
            type: 'ADD COLUMN',
            table,
            column: col.name,
            sql: `ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${colType}${dflt}`,
          });
        }
      }
    }
  }

  // 服务器有但本地没有的表/列 → 仅警告，不删除
  const warnings = [];
  for (const [table, info] of Object.entries(prodSchema)) {
    if (!localSchema[table]) {
      warnings.push(`表 "${table}" 仅存在于服务器，本地没有 (将保留)`);
    } else {
      const localCols = new Set(localSchema[table].columns.map(c => c.name));
      for (const col of info.columns) {
        if (!localCols.has(col.name)) {
          warnings.push(`列 "${table}"."${col.name}" 仅存在于服务器，本地没有 (将保留)`);
        }
      }
    }
  }

  // ── 差异报告 ──────────────────────────────────────────
  if (migrations.length === 0 && warnings.length === 0) {
    console.log('  表结构完全一致，无需迁移。');
  } else {
    if (migrations.length > 0) {
      console.log(`\n  需要迁移 ${migrations.length} 项:`);
      for (const m of migrations) {
        console.log(`    [${m.type}] ${m.table}${m.column ? '.' + m.column : ''}`);
        console.log(`      SQL: ${m.sql}`);
      }
    }
    if (warnings.length > 0) {
      console.log(`\n  警告 (${warnings.length} 项):`);
      for (const w of warnings) {
        console.log(`    ${w}`);
      }
    }
  }

  // ── Step 3: 执行迁移 ─────────────────────────────────
  if (migrations.length > 0) {
    if (DRY_RUN) {
      console.log('\n[3/4] --dry-run 模式，跳过迁移执行。');
    } else {
      console.log('\n[3/4] 在服务器 DB 副本上执行迁移...');
      for (const m of migrations) {
        try {
          await dbRun(prodDb, m.sql);
          console.log(`  OK  ${m.type} ${m.table}${m.column ? '.' + m.column : ''}`);
        } catch (e) {
          console.error(`  FAIL ${m.type} ${m.table}: ${e.message}`);
        }
      }
    }
  } else {
    console.log('\n[3/4] 无需迁移。');
  }

  await dbClose(localDb);
  await dbClose(prodDb);

  // ── Step 4: 替换本地 DB ───────────────────────────────
  if (DRY_RUN) {
    console.log('\n[4/4] --dry-run 模式，不替换本地数据库。');
    fs.unlinkSync(TEMP_DB);
    console.log('  已清理临时文件。');
  } else {
    console.log('\n[4/4] 替换本地数据库...');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = LOCAL_DB + `.bak.${ts}`;
    fs.copyFileSync(LOCAL_DB, backupPath);
    console.log(`  已备份当前本地 DB → ${path.basename(backupPath)}`);

    // 删除旧的 WAL/SHM 文件，防止 SQLite 重放旧日志覆盖新数据
    for (const ext of ['-wal', '-shm']) {
      const f = LOCAL_DB + ext;
      if (fs.existsSync(f)) { fs.unlinkSync(f); console.log(`  已删除旧 ${ext} 文件`); }
    }

    fs.copyFileSync(TEMP_DB, LOCAL_DB);
    fs.unlinkSync(TEMP_DB);
    console.log('  已用服务器数据替换本地数据库。');
  }

  console.log('\n完成!\n');
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
