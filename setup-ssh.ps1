# Windows PowerShell SSH 配置脚本
# 使用方法: 以管理员身份运行 PowerShell，然后执行: .\setup-ssh.ps1

Write-Host "==========================================" -ForegroundColor Green
Write-Host "SSH 密钥配置脚本" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# 检查 SSH 是否可用
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host "错误: 未找到 SSH 命令" -ForegroundColor Red
    Write-Host "请安装 OpenSSH 客户端:" -ForegroundColor Yellow
    Write-Host "1. 打开 设置 > 应用 > 可选功能" -ForegroundColor Yellow
    Write-Host "2. 添加功能 > 搜索 'OpenSSH 客户端'" -ForegroundColor Yellow
    Write-Host "3. 安装后重新运行此脚本" -ForegroundColor Yellow
    exit 1
}

$sshDir = "$env:USERPROFILE\.ssh"
$privateKey = "$sshDir\id_rsa"
$publicKey = "$sshDir\id_rsa.pub"

# 创建 .ssh 目录（如果不存在）
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
    Write-Host "✓ 创建 .ssh 目录: $sshDir" -ForegroundColor Green
}

# 检查是否已有密钥
if (Test-Path $privateKey) {
    Write-Host "检测到已存在的 SSH 密钥" -ForegroundColor Yellow
    $overwrite = Read-Host "是否覆盖现有密钥? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "使用现有密钥" -ForegroundColor Green
    } else {
        Remove-Item $privateKey -Force -ErrorAction SilentlyContinue
        Remove-Item $publicKey -Force -ErrorAction SilentlyContinue
    }
}

# 生成新密钥（如果需要）
if (-not (Test-Path $privateKey)) {
    Write-Host ""
    Write-Host "生成新的 SSH 密钥..." -ForegroundColor Cyan
    $email = Read-Host "请输入您的邮箱地址（用于标识密钥）"
    
    if ([string]::IsNullOrWhiteSpace($email)) {
        $email = "$env:USERNAME@localhost"
    }
    
    ssh-keygen -t rsa -b 4096 -C $email -f $privateKey -N '""'
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ SSH 密钥生成成功" -ForegroundColor Green
    } else {
        Write-Host "✗ SSH 密钥生成失败" -ForegroundColor Red
        exit 1
    }
}

# 显示公钥
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "您的 SSH 公钥内容:" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Get-Content $publicKey
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# 询问是否要添加到服务器
$addToServer = Read-Host "是否要将公钥添加到服务器? (y/N)"
if ($addToServer -eq "y" -or $addToServer -eq "Y") {
    $serverIP = Read-Host "请输入服务器 IP 地址或域名"
    $serverUser = Read-Host "请输入 SSH 用户名 (默认: root)" 
    
    if ([string]::IsNullOrWhiteSpace($serverUser)) {
        $serverUser = "root"
    }
    
    Write-Host ""
    Write-Host "正在将公钥添加到服务器..." -ForegroundColor Cyan
    Write-Host "提示: 您需要输入服务器密码" -ForegroundColor Yellow
    Write-Host ""
    
    # 读取公钥内容
    $publicKeyContent = Get-Content $publicKey -Raw
    
    # 使用 SSH 命令添加公钥
    $command = @"
mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$publicKeyContent' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo '公钥添加成功！'
"@
    
    ssh "$serverUser@$serverIP" $command
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ 公钥已成功添加到服务器" -ForegroundColor Green
        
        # 测试连接
        Write-Host ""
        $testConnection = Read-Host "是否测试 SSH 连接? (y/N)"
        if ($testConnection -eq "y" -or $testConnection -eq "Y") {
            Write-Host "测试连接中..." -ForegroundColor Cyan
            ssh -o BatchMode=yes "$serverUser@$serverIP" "echo '连接成功！'"
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✓ SSH 连接测试成功！" -ForegroundColor Green
            } else {
                Write-Host "✗ SSH 连接测试失败，请检查配置" -ForegroundColor Red
            }
        }
    } else {
        Write-Host ""
        Write-Host "✗ 公钥添加失败，请手动添加" -ForegroundColor Red
        Write-Host ""
        Write-Host "手动添加步骤:" -ForegroundColor Yellow
        Write-Host "1. SSH 登录服务器: ssh $serverUser@$serverIP" -ForegroundColor Yellow
        Write-Host "2. 执行以下命令:" -ForegroundColor Yellow
        Write-Host "   mkdir -p ~/.ssh" -ForegroundColor Yellow
        Write-Host "   chmod 700 ~/.ssh" -ForegroundColor Yellow
        Write-Host "   nano ~/.ssh/authorized_keys" -ForegroundColor Yellow
        Write-Host "3. 粘贴上面的公钥内容" -ForegroundColor Yellow
        Write-Host "4. 保存并退出 (Ctrl+X, Y, Enter)" -ForegroundColor Yellow
        Write-Host "5. 执行: chmod 600 ~/.ssh/authorized_keys" -ForegroundColor Yellow
    }
}

# 创建 SSH 配置文件示例
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "SSH 配置文件示例" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "在 Cursor 中配置 Remote-SSH 时，可以使用以下配置:" -ForegroundColor Cyan
Write-Host ""
Write-Host "# 添加到 ~/.ssh/config 文件" -ForegroundColor Yellow
Write-Host "Host mbse-server" -ForegroundColor White
Write-Host "    HostName YOUR_SERVER_IP" -ForegroundColor Gray
Write-Host "    User root" -ForegroundColor Gray
Write-Host "    Port 22" -ForegroundColor Gray
Write-Host "    IdentityFile $privateKey" -ForegroundColor Gray
Write-Host "    ServerAliveInterval 60" -ForegroundColor Gray
Write-Host "    ServerAliveCountMax 3" -ForegroundColor Gray
Write-Host ""

Write-Host "==========================================" -ForegroundColor Green
Write-Host "配置完成！" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "下一步:" -ForegroundColor Cyan
Write-Host "1. 在 Cursor 中安装 'Remote - SSH' 扩展" -ForegroundColor White
Write-Host "2. 配置 SSH Host（使用上面的配置示例）" -ForegroundColor White
Write-Host "3. 连接到服务器开始开发" -ForegroundColor White
Write-Host ""
Write-Host "详细说明请查看: SSH_SETUP_GUIDE.md" -ForegroundColor Yellow

