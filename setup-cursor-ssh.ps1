# Cursor Remote-SSH 配置脚本
# 使用方法: .\setup-cursor-ssh.ps1

param(
    [Parameter(Mandatory=$true)]
    [string]$ServerIP = "8.140.11.97",
    
    [Parameter(Mandatory=$true)]
    [string]$ServerPassword = "Zc@820814",
    
    [Parameter(Mandatory=$false)]
    [string]$Username = "root"
)

Write-Host "==========================================" -ForegroundColor Green
Write-Host "Cursor Remote-SSH 配置脚本" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# 1. 创建 .ssh 目录
$sshDir = "$env:USERPROFILE\.ssh"
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
    Write-Host "✓ 创建 .ssh 目录: $sshDir" -ForegroundColor Green
}

# 2. 检查是否已有SSH密钥
$privateKey = "$sshDir\id_rsa"
$publicKey = "$sshDir\id_rsa.pub"

if (-not (Test-Path $privateKey)) {
    Write-Host "生成 SSH 密钥对..." -ForegroundColor Cyan
    ssh-keygen -t rsa -b 4096 -f $privateKey -N '""' -q
    Write-Host "✓ SSH 密钥对已生成" -ForegroundColor Green
} else {
    Write-Host "✓ SSH 密钥对已存在" -ForegroundColor Green
}

# 3. 读取公钥
$publicKeyContent = Get-Content $publicKey -Raw
Write-Host ""
Write-Host "公钥内容:" -ForegroundColor Cyan
Write-Host $publicKeyContent -ForegroundColor Yellow
Write-Host ""

# 4. 上传公钥到服务器
Write-Host "上传公钥到服务器..." -ForegroundColor Cyan
Write-Host "提示: 需要输入服务器密码: $ServerPassword" -ForegroundColor Yellow
Write-Host ""

# 使用 sshpass 或直接 ssh-copy-id（如果可用）
# Windows 上需要手动操作，所以提供命令
Write-Host "请手动执行以下命令上传公钥:" -ForegroundColor Yellow
Write-Host ""
Write-Host "方式1: 使用 ssh-copy-id (如果已安装 Git Bash)" -ForegroundColor Cyan
Write-Host "ssh-copy-id -i `"$publicKey`" $Username@$ServerIP" -ForegroundColor White
Write-Host ""
Write-Host "方式2: 手动上传 (在 PowerShell 中执行)" -ForegroundColor Cyan
Write-Host "`$publicKey = Get-Content `"$publicKey`" -Raw" -ForegroundColor White
Write-Host "ssh $Username@$ServerIP `"mkdir -p ~/.ssh && echo `$publicKey >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && chmod 700 ~/.ssh`"" -ForegroundColor White
Write-Host ""

# 5. 创建 SSH config
$configFile = "$sshDir\config"
$hostName = "mbse-server"

Write-Host "配置 SSH config..." -ForegroundColor Cyan

$configContent = @"
# MBSE平台服务器配置
Host $hostName
    HostName $ServerIP
    User $Username
    Port 22
    IdentityFile $privateKey
    ServerAliveInterval 60
    ServerAliveCountMax 3
    StrictHostKeyChecking no
    UserKnownHostsFile $sshDir\known_hosts

"@

# 检查是否已有配置
if (Test-Path $configFile) {
    $existingConfig = Get-Content $configFile -Raw
    if ($existingConfig -notmatch "Host $hostName") {
        Add-Content -Path $configFile -Value $configContent
        Write-Host "✓ SSH config 已更新" -ForegroundColor Green
    } else {
        Write-Host "✓ SSH config 中已存在 $hostName 配置" -ForegroundColor Green
    }
} else {
    Set-Content -Path $configFile -Value $configContent
    Write-Host "✓ SSH config 已创建" -ForegroundColor Green
}

# 6. 设置私钥权限
Write-Host ""
Write-Host "设置私钥文件权限..." -ForegroundColor Cyan
icacls $privateKey /inheritance:r 2>$null
icacls $privateKey /grant:r "$env:USERNAME:(R)" 2>$null
Write-Host "✓ 私钥权限已设置" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "配置完成！" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "下一步操作:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 上传公钥到服务器 (选择以下方式之一):" -ForegroundColor Yellow
Write-Host ""
Write-Host "   方式A - 使用 PowerShell (推荐):" -ForegroundColor White
Write-Host "   `$publicKey = Get-Content `"$publicKey`" -Raw" -ForegroundColor Gray
Write-Host "   ssh $Username@$ServerIP `"mkdir -p ~/.ssh && echo '$publicKey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && chmod 700 ~/.ssh`"" -ForegroundColor Gray
Write-Host ""
Write-Host "   方式B - 手动复制公钥内容到服务器:" -ForegroundColor White
Write-Host "   在服务器上执行:" -ForegroundColor Gray
Write-Host "   mkdir -p ~/.ssh" -ForegroundColor Gray
Write-Host "   nano ~/.ssh/authorized_keys" -ForegroundColor Gray
Write-Host "   (粘贴上面的公钥内容，保存退出)" -ForegroundColor Gray
Write-Host "   chmod 600 ~/.ssh/authorized_keys" -ForegroundColor Gray
Write-Host "   chmod 700 ~/.ssh" -ForegroundColor Gray
Write-Host ""
Write-Host "2. 在 Cursor 中连接:" -ForegroundColor Yellow
Write-Host "   - 按 F1" -ForegroundColor White
Write-Host "   - 输入: Remote-SSH: Connect to Host" -ForegroundColor White
Write-Host "   - 选择: $hostName" -ForegroundColor White
Write-Host ""
Write-Host "3. 连接成功后，打开文件夹: /var/www/eicd-platform" -ForegroundColor Yellow
Write-Host ""

