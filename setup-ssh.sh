#!/bin/bash

# Linux/Mac SSH 配置脚本
# 使用方法: chmod +x setup-ssh.sh && ./setup-ssh.sh

echo "=========================================="
echo "SSH 密钥配置脚本"
echo "=========================================="
echo ""

SSH_DIR="$HOME/.ssh"
PRIVATE_KEY="$SSH_DIR/id_rsa"
PUBLIC_KEY="$SSH_DIR/id_rsa.pub"

# 创建 .ssh 目录
if [ ! -d "$SSH_DIR" ]; then
    mkdir -p "$SSH_DIR"
    chmod 700 "$SSH_DIR"
    echo "✓ 创建 .ssh 目录: $SSH_DIR"
fi

# 检查是否已有密钥
if [ -f "$PRIVATE_KEY" ]; then
    echo "检测到已存在的 SSH 密钥"
    read -p "是否覆盖现有密钥? (y/N): " overwrite
    if [ "$overwrite" != "y" ] && [ "$overwrite" != "Y" ]; then
        echo "使用现有密钥"
    else
        rm -f "$PRIVATE_KEY" "$PUBLIC_KEY"
    fi
fi

# 生成新密钥
if [ ! -f "$PRIVATE_KEY" ]; then
    echo ""
    echo "生成新的 SSH 密钥..."
    read -p "请输入您的邮箱地址（用于标识密钥）: " email
    
    if [ -z "$email" ]; then
        email="$USER@localhost"
    fi
    
    ssh-keygen -t rsa -b 4096 -C "$email" -f "$PRIVATE_KEY" -N ""
    
    if [ $? -eq 0 ]; then
        echo "✓ SSH 密钥生成成功"
    else
        echo "✗ SSH 密钥生成失败"
        exit 1
    fi
fi

# 显示公钥
echo ""
echo "=========================================="
echo "您的 SSH 公钥内容:"
echo "=========================================="
echo ""
cat "$PUBLIC_KEY"
echo ""
echo "=========================================="
echo ""

# 询问是否要添加到服务器
read -p "是否要将公钥添加到服务器? (y/N): " add_to_server
if [ "$add_to_server" = "y" ] || [ "$add_to_server" = "Y" ]; then
    read -p "请输入服务器 IP 地址或域名: " server_ip
    read -p "请输入 SSH 用户名 (默认: root): " server_user
    
    if [ -z "$server_user" ]; then
        server_user="root"
    fi
    
    echo ""
    echo "正在将公钥添加到服务器..."
    echo "提示: 您需要输入服务器密码"
    echo ""
    
    ssh-copy-id "$server_user@$server_ip"
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "✓ 公钥已成功添加到服务器"
        
        # 测试连接
        echo ""
        read -p "是否测试 SSH 连接? (y/N): " test_connection
        if [ "$test_connection" = "y" ] || [ "$test_connection" = "Y" ]; then
            echo "测试连接中..."
            ssh -o BatchMode=yes "$server_user@$server_ip" "echo '连接成功！'"
            if [ $? -eq 0 ]; then
                echo "✓ SSH 连接测试成功！"
            else
                echo "✗ SSH 连接测试失败，请检查配置"
            fi
        fi
    else
        echo ""
        echo "✗ 公钥添加失败，请手动添加"
        echo ""
        echo "手动添加步骤:"
        echo "1. SSH 登录服务器: ssh $server_user@$server_ip"
        echo "2. 执行以下命令:"
        echo "   mkdir -p ~/.ssh"
        echo "   chmod 700 ~/.ssh"
        echo "   nano ~/.ssh/authorized_keys"
        echo "3. 粘贴上面的公钥内容"
        echo "4. 保存并退出 (Ctrl+X, Y, Enter)"
        echo "5. 执行: chmod 600 ~/.ssh/authorized_keys"
    fi
fi

# 创建 SSH 配置文件示例
echo ""
echo "=========================================="
echo "SSH 配置文件示例"
echo "=========================================="
echo ""
echo "在 Cursor 中配置 Remote-SSH 时，可以使用以下配置:"
echo ""
echo "# 添加到 ~/.ssh/config 文件"
echo "Host mbse-server"
echo "    HostName YOUR_SERVER_IP"
echo "    User root"
echo "    Port 22"
echo "    IdentityFile $PRIVATE_KEY"
echo "    ServerAliveInterval 60"
echo "    ServerAliveCountMax 3"
echo ""

echo "=========================================="
echo "配置完成！"
echo "=========================================="
echo ""
echo "下一步:"
echo "1. 在 Cursor 中安装 'Remote - SSH' 扩展"
echo "2. 配置 SSH Host（使用上面的配置示例）"
echo "3. 连接到服务器开始开发"
echo ""
echo "详细说明请查看: SSH_SETUP_GUIDE.md"

