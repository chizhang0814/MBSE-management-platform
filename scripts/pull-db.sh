#!/bin/bash
# pull-db.sh — 从8核服务器拉取数据库到本地（密码登录，PuTTY plink/pscp）
# 不停止服务器服务，安全只读操作

set -e

SERVER="root@36.212.172.150"
HOSTKEY="SHA256:bE9orbsDdqcyT0vGxaEMQ+LquEa665DdQqFW7D9oXo0"
PASSWORD="Niubiaw198#@"
REMOTE_DB="/opt/mbse/data/sqlite/eicd.db"
LOCAL_DB="$(dirname "$0")/../data/sqlite/eicd.db"
LOCAL_WAL="$(dirname "$0")/../data/sqlite/eicd.db-wal"
LOCAL_SHM="$(dirname "$0")/../data/sqlite/eicd.db-shm"

PLINK="plink -ssh -pw $PASSWORD -hostkey $HOSTKEY"
PSCP="pscp -pw $PASSWORD -hostkey $HOSTKEY"

echo "=== [1/3] 在服务器上执行 WAL checkpoint ==="
$PLINK $SERVER "docker exec mbse-backend-1 node -e \"
  const db = new (require('/app/node_modules/sqlite3').Database)('/app/data/eicd.db');
  db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
    if (err) { console.error('Checkpoint 失败:', err); process.exit(1); }
    console.log('Checkpoint 完成');
    db.close();
  });
\""

echo "=== [2/3] 下载数据库到本地 ==="
$PSCP "$SERVER:$REMOTE_DB" "$LOCAL_DB"
echo "已保存至 $LOCAL_DB"

echo "=== [3/3] 清理本地旧 WAL/SHM ==="
rm -f "$LOCAL_WAL" "$LOCAL_SHM"
echo "WAL/SHM 已清理"

echo ""
echo "✓ 同步完成：8核服务器 → 本地"
