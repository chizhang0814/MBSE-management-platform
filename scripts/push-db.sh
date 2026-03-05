#!/bin/bash
# push-db.sh — 将本地数据库推送到服务器（覆盖服务器数据）
# ⚠️  危险操作：会停止服务并覆盖生产数据，执行前请确认

set -e

SERVER="root@8.140.11.97"
PEM="/d/Downloads/mbse.pem"
REMOTE_DB="/opt/mbse/data/sqlite/eicd.db"
REMOTE_DIR="/opt/mbse/data/sqlite"
LOCAL_DB="$(dirname "$0")/../data/sqlite/eicd.db"
LOCAL_WAL="$(dirname "$0")/../data/sqlite/eicd.db-wal"

SSH="ssh -F /dev/null -i $PEM -o StrictHostKeyChecking=no"
SCP="scp -F /dev/null -i $PEM"

# ── 确认提示 ────────────────────────────────────────────────
echo "⚠️  警告：此操作将用本地数据库覆盖服务器生产数据！"
echo "    本地数据库: $LOCAL_DB"
echo "    服务器目标: $SERVER:$REMOTE_DB"
echo ""
read -p "确认继续？输入 YES 执行，其他任意键退出: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "已取消。"
  exit 0
fi

# ── 1. 备份服务器当前数据库 ──────────────────────────────────
echo ""
echo "=== [1/6] 备份服务器当前数据库 ==="
BACKUP_NAME="eicd.db.bak.$(date +%Y-%m-%dT%H-%M-%S)"
$SSH $SERVER "cp $REMOTE_DB $REMOTE_DIR/$BACKUP_NAME"
echo "已备份为 $REMOTE_DIR/$BACKUP_NAME"

# ── 2. 停止服务器服务 ────────────────────────────────────────
echo ""
echo "=== [2/6] 停止服务器服务 ==="
$SSH $SERVER "cd /opt/mbse && docker compose -f docker-compose.prod.yml down"
echo "服务已停止"

# ── 3. 本地 WAL checkpoint ───────────────────────────────────
echo ""
echo "=== [3/6] 合并本地 WAL ==="
if [ -f "$LOCAL_WAL" ] && [ -s "$LOCAL_WAL" ]; then
  node -e "
    const db = new (require('$(dirname "$0")/../server/node_modules/sqlite3').Database)('$LOCAL_DB');
    db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
      if (err) { console.error('Checkpoint 失败:', err); process.exit(1); }
      console.log('Checkpoint 完成');
      db.close();
    });
  "
else
  echo "WAL 为空，跳过 checkpoint"
fi

# ── 4. 上传数据库 ────────────────────────────────────────────
echo ""
echo "=== [4/6] 上传数据库到服务器 ==="
$SCP "$LOCAL_DB" "$SERVER:$REMOTE_DB"
echo "上传完成"

# ── 5. 清理服务器残留 WAL/SHM ────────────────────────────────
echo ""
echo "=== [5/6] 清理服务器残留 WAL/SHM ==="
$SSH $SERVER "rm -f $REMOTE_DIR/eicd.db-wal $REMOTE_DIR/eicd.db-shm"
echo "清理完成"

# ── 6. 重启服务器服务 ────────────────────────────────────────
echo ""
echo "=== [6/6] 重启服务器服务 ==="
$SSH $SERVER "cd /opt/mbse && docker compose -f docker-compose.prod.yml up -d"
echo "服务已启动"

echo ""
echo "✓ 同步完成：本地 → 服务器"
echo "  如需回滚，服务器备份位于: $REMOTE_DIR/$BACKUP_NAME"
