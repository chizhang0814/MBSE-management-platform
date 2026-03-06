#!/bin/bash
# deploy-code.sh — 将代码变更部署到服务器
# 用法:
#   bash scripts/deploy-code.sh           # 重建所有容器
#   bash scripts/deploy-code.sh backend   # 仅重建后端
#   bash scripts/deploy-code.sh frontend  # 仅重建前端
#
# 前提：已将代码 git push 到远程仓库

set -e

SERVER="root@8.140.11.97"
PEM="/d/Downloads/mbse.pem"
REMOTE_DIR="/opt/mbse"
SERVICE="${1:-all}"

SSH="ssh -F /dev/null -i $PEM -o StrictHostKeyChecking=no"

# 校验参数
if [[ "$SERVICE" != "all" && "$SERVICE" != "backend" && "$SERVICE" != "frontend" ]]; then
  echo "用法: bash scripts/deploy-code.sh [all|backend|frontend]"
  exit 1
fi

echo "=== [1/2] 在服务器上拉取最新代码 ==="
$SSH $SERVER "cd $REMOTE_DIR && git pull"

echo ""
echo "=== [2/2] 重建并重启容器（$SERVICE）==="
if [ "$SERVICE" = "all" ]; then
  $SSH $SERVER "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d --build"
else
  $SSH $SERVER "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d --build $SERVICE"
fi

echo ""
echo "✓ 部署完成"
