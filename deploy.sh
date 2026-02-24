#!/bin/bash

# MBSE综合管理平台 - 快速部署脚本
# 使用方法: sudo bash deploy.sh

set -e

echo "=========================================="
echo "MBSE综合管理平台 - 部署脚本"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}请使用sudo运行此脚本${NC}"
    exit 1
fi

# 配置变量
APP_DIR="/var/www/eicd-platform"
NODE_VERSION="20"

echo -e "${GREEN}[1/8] 更新系统包...${NC}"
apt update && apt upgrade -y

echo -e "${GREEN}[2/8] 安装Node.js ${NODE_VERSION}...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
else
    echo "Node.js 已安装: $(node --version)"
fi

echo -e "${GREEN}[3/8] 安装Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    apt install nginx -y
    systemctl enable nginx
else
    echo "Nginx 已安装"
fi

echo -e "${GREEN}[4/8] 安装PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
else
    echo "PM2 已安装"
fi

echo -e "${GREEN}[5/8] 安装其他依赖...${NC}"
apt install -y sqlite3 git curl

echo -e "${GREEN}[6/8] 创建应用目录...${NC}"
mkdir -p $APP_DIR
mkdir -p /var/log/pm2
mkdir -p /var/backups/eicd-platform

# 获取当前脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo -e "${GREEN}[7/8] 复制项目文件...${NC}"
if [ "$SCRIPT_DIR" != "$APP_DIR" ]; then
    cp -r $SCRIPT_DIR/* $APP_DIR/
    chown -R $SUDO_USER:$SUDO_USER $APP_DIR
fi

echo -e "${GREEN}[8/8] 安装项目依赖...${NC}"
cd $APP_DIR

# 安装根目录依赖
if [ -f "package.json" ]; then
    npm install
fi

# 安装服务器依赖
if [ -d "server" ]; then
    cd server
    npm install
    npm run build
    cd ..
fi

# 安装客户端依赖并构建
if [ -d "client" ]; then
    cd client
    npm install
    npm run build
    cd ..
fi

echo -e "${YELLOW}=========================================="
echo "部署脚本执行完成！"
echo "==========================================${NC}"
echo ""
echo "接下来的步骤："
echo "1. 配置环境变量: nano $APP_DIR/server/.env"
echo "2. 配置Nginx: nano /etc/nginx/sites-available/eicd-platform"
echo "3. 启动应用: cd $APP_DIR/server && pm2 start ecosystem.config.js"
echo "4. 设置SSL: sudo certbot --nginx -d your-domain.com"
echo ""
echo "详细说明请查看 DEPLOYMENT_GUIDE.md"

