#!/bin/bash
# MBSE 平台 - 服务器端安装脚本
# 在服务器上执行: bash server-install.sh

set -e

echo "=========================================="
echo "MBSE 平台 - 安装必需软件"
echo "=========================================="
echo ""

# 1. 更新系统
echo "[1/6] 更新系统..."
apt update && apt upgrade -y

# 2. 安装 Node.js 20.x
echo ""
echo "[2/6] 安装 Node.js 20.x..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo "✓ Node.js 安装成功"
else
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo "当前 Node.js 版本过低 ($(node --version))，升级到 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
        echo "✓ Node.js 升级成功"
    else
        echo "✓ Node.js 已安装: $(node --version)"
    fi
fi

# 3. 安装 Nginx
echo ""
echo "[3/6] 安装 Nginx..."
if ! command -v nginx &> /dev/null; then
    apt install nginx -y
    systemctl enable nginx
    systemctl start nginx
    echo "✓ Nginx 安装成功"
else
    echo "✓ Nginx 已安装: $(nginx -v 2>&1 | head -1)"
fi

# 4. 安装 PM2
echo ""
echo "[4/6] 安装 PM2..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    echo "✓ PM2 安装成功"
else
    echo "✓ PM2 已安装: $(pm2 --version)"
fi

# 5. 安装基础工具
echo ""
echo "[5/6] 安装基础工具..."
apt install -y curl wget git vim sqlite3 build-essential python3

# 6. 验证安装
echo ""
echo "[6/6] 验证安装..."
echo ""
echo "=========================================="
echo "安装完成！软件版本："
echo "=========================================="
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo "Nginx: $(nginx -v 2>&1 | head -1)"
echo "PM2: $(pm2 --version)"
echo "SQLite: $(sqlite3 --version)"
echo "Git: $(git --version)"
echo "=========================================="
echo ""
echo "✓ 所有必需软件已安装完成！"
echo ""
echo "下一步：上传项目文件并配置应用"

