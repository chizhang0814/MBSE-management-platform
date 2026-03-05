#!/bin/bash
# pull-db.sh — 从服务器拉取数据库到本地
# 不停止服务器服务，安全只读操作

set -e

SERVER="root@8.140.11.97"
PEM="/d/Downloads/mbse.pem"
REMOTE_DB="/opt/mbse/data/sqlite/eicd.db"
LOCAL_DB="$(dirname "$0")/../server/eicd.db"
LOCAL_WAL="$(dirname "$0")/../server/eicd.db-wal"
LOCAL_SHM="$(dirname "$0")/../server/eicd.db-shm"

SSH="ssh -F /dev/null -i $PEM -o StrictHostKeyChecking=no"
SCP="scp -F /dev/null -i $PEM"

echo "=== [1/3] 在服务器上执行 WAL checkpoint ==="
$SSH $SERVER "docker exec mbse-backend-1 node -e \"
  const db = new (require('/app/node_modules/sqlite3').Database)('/app/data/eicd.db');
  db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
    if (err) { console.error('Checkpoint 失败:', err); process.exit(1); }
    console.log('Checkpoint 完成');
    db.close();
  });
\""

echo "=== [2/3] 下载数据库到本地 ==="
$SCP "$SERVER:$REMOTE_DB" "$LOCAL_DB"
echo "已保存至 $LOCAL_DB"

echo "=== [3/3] 清理本地旧 WAL/SHM ==="
rm -f "$LOCAL_WAL" "$LOCAL_SHM"
echo "WAL/SHM 已清理"

echo ""
echo "✓ 同步完成：服务器 → 本地"
