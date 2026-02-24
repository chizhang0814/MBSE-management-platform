# Windows PowerShell - PEM 文件配置脚本
# 使用方法: .\setup-pem.ps1

param(
    [Parameter(Mandatory=$true)]
    [string]$PemFilePath,
    
    [Parameter(Mandatory=$true)]
    [string]$ServerIP,
    
    [Parameter(Mandatory=$false)]
    [string]$Username = "root"
)

Write-Host "==========================================" -ForegroundColor Green
Write-Host "PEM 文件配置脚本" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# 检查 PEM 文件是否存在
if (-not (Test-Path $PemFilePath)) {
    Write-Host "错误: PEM 文件不存在: $PemFilePath" -ForegroundColor Red
    exit 1
}

Write-Host "PEM 文件: $PemFilePath" -ForegroundColor Cyan
Write-Host "服务器 IP: $ServerIP" -ForegroundColor Cyan
Write-Host "用户名: $Username" -ForegroundColor Cyan
Write-Host ""

# 创建 .ssh 目录
$sshDir = "$env:USERPROFILE\.ssh"
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
    Write-Host "✓ 创建 .ssh 目录: $sshDir" -ForegroundColor Green
}

# 复制 PEM 文件到 .ssh 目录
$targetPem = "$sshDir\id_rsa.pem"
Copy-Item $PemFilePath $targetPem -Force
Write-Host "✓ 复制 PEM 文件到: $targetPem" -ForegroundColor Green

# 设置文件权限
Write-Host ""
Write-Host "设置文件权限..." -ForegroundColor Cyan
icacls $targetPem /inheritance:r 2>$null
icacls $targetPem /grant:r "$env:USERNAME:(R)" 2>$null
Write-Host "✓ 文件权限已设置" -ForegroundColor Green

# 创建或更新 SSH config
$configFile = "$sshDir\config"
$hostName = "mbse-server"

Write-Host ""
Write-Host "配置 SSH config..." -ForegroundColor Cyan

# 检查是否已有配置
$configContent = ""
if (Test-Path $configFile) {
    $configContent = Get-Content $configFile -Raw
}

# 检查是否已有该 Host
if ($configContent -match "Host $hostName") {
    Write-Host "警告: Host '$hostName' 已存在，将更新配置" -ForegroundColor Yellow
    # 这里可以添加更新逻辑，或提示用户手动编辑
} else {
    # 添加新配置
    $newConfig = @"

# MBSE平台服务器配置
Host $hostName
    HostName $ServerIP
    User $Username
    Port 22
    IdentityFile $targetPem
    ServerAliveInterval 60
    ServerAliveCountMax 3

"@
    
    Add-Content -Path $configFile -Value $newConfig
    Write-Host "✓ SSH config 已更新" -ForegroundColor Green
}

# 测试连接
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "测试 SSH 连接..." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

$testConnection = Read-Host "是否现在测试连接? (y/N)"
if ($testConnection -eq "y" -or $testConnection -eq "Y") {
    Write-Host "正在连接..." -ForegroundColor Cyan
    Write-Host "提示: 如果是首次连接，输入 'yes' 确认" -ForegroundColor Yellow
    Write-Host ""
    
    ssh -i $targetPem "$Username@$ServerIP" "echo '连接成功！'; lsb_release -a 2>/dev/null || uname -a"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ SSH 连接测试成功！" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "✗ SSH 连接测试失败" -ForegroundColor Red
        Write-Host "请检查:" -ForegroundColor Yellow
        Write-Host "1. 服务器 IP 是否正确" -ForegroundColor Yellow
        Write-Host "2. 用户名是否正确（尝试: root, ubuntu, ec2-user）" -ForegroundColor Yellow
        Write-Host "3. 安全组是否开放 22 端口" -ForegroundColor Yellow
        Write-Host "4. PEM 文件是否匹配该服务器" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "配置完成！" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "连接方式:" -ForegroundColor Cyan
Write-Host "1. 使用配置文件: ssh $hostName" -ForegroundColor White
Write-Host "2. 直接连接: ssh -i `"$targetPem`" $Username@$ServerIP" -ForegroundColor White
Write-Host ""
Write-Host "在 Cursor 中:" -ForegroundColor Cyan
Write-Host "1. 安装 'Remote - SSH' 扩展" -ForegroundColor White
Write-Host "2. 按 F1 → Remote-SSH: Connect to Host" -ForegroundColor White
Write-Host "3. 选择 '$hostName'" -ForegroundColor White
Write-Host ""

