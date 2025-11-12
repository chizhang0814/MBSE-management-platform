#!/bin/bash

echo "========================================"
echo "清理数据表和上传文件"
echo "========================================"
echo ""
echo "警告：此操作将删除所有数据表和上传文件！"
echo "系统表（users等）和用户数据将保留。"
echo ""
read -p "确定要继续吗？(y/N): " confirm

if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "操作已取消"
    exit 1
fi

echo ""
echo "正在清理..."
cd server
npm run cleanup
cd ..
echo ""
echo "清理完成！"

