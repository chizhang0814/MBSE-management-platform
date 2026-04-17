运维操作中心：数据同步、服务部署、维护模式的一站式操作。

用户输入 $ARGUMENTS，根据参数识别操作意图。

## 操作类型识别

| 关键词/意图 | 操作类型 |
|------------|---------|
| `pull` / 拉取 / 同步到本地 / 从服务器同步 | **pull** |
| `push` / 推送 / 同步到服务器 / 推数据库 | **push-db** |
| `deploy` / 部署 / 上线 / 发布 | **deploy** |
| `deploy-all` / 全量部署 / 部署代码和数据 | **deploy-all** |
| `maintenance on` / 维护 / 停服 | **maint-on** |
| `maintenance off` / 恢复服务 | **maint-off** |
| `backup` / 备份 | **backup** |
| `restart-local` / 重启本地 | **restart-local** |
| `restart-server` / 重启服务器 | **restart-server** |
| `status` / 状态 | **status** |

如果参数不明确，列出可用操作让用户选择。

## 必须确认的参数

识别操作类型后，先检查以下参数是否已明确。**未明确的必须向用户询问，不可使用默认值**：

| 参数 | 涉及操作 | 问什么 |
|------|---------|--------|
| **目标服务器** | 所有涉及服务器的操作 | "在哪台服务器上执行？（8核/2核/其他IP）" |
| **Git 分支** | deploy, deploy-all | "部署哪个分支？" |
| **是否启维护页面** | deploy, deploy-all | "部署期间是否启用维护页面？（用户会看到服务中断）" |
| **是否备份** | deploy, deploy-all, push-db | "部署前是否备份服务器数据库？" |

如果用户在 $ARGUMENTS 中已经指定了（如"在8核服务器上部署RHI分支"），直接使用，不重复询问。

## 方案输出格式

确认参数后，输出完整方案，格式：
```
目标服务器：36.212.172.150（8核）
操作类型：deploy
分支：RHI
维护页面：是

步骤：
1. 本地 git push origin RHI
2. 服务器停服 + 启维护页面
3. 服务器备份DB
4. 服务器拉取最新代码 git fetch origin && git reset --hard origin/RHI
5. 服务器停维护页面 + docker compose -f docker-compose.prod.yml up -d --build
6. 验证前后端HTTP状态
```

用户确认后才执行。

## 各操作的标准流程

### pull（服务器DB → 本地）
1. 停本地前后端（kill 3000/5173端口进程）
2. 删本地DB文件（eicd.db / -wal / -shm）
3. 服务器 WAL checkpoint（如果服务运行中）
4. scp 下载服务器DB到本地
5. 验证完整性（PRAGMA integrity_check）
6. 启动本地前后端
7. 验证 3000 + 5173 端口监听

### push-db（本地DB → 服务器）
1. **询问**：是否备份服务器当前DB？
2. 服务器停后端容器
3. scp 上传本地DB到服务器
4. 删服务器 -wal/-shm 文件
5. 重启后端容器
6. 验证后端API可用

### deploy（仅代码部署，保留服务器数据）
1. **询问**：哪个分支？哪台服务器？是否启维护页面？是否备份？
2. 本地 git push origin {分支}
3. 服务器停服 + 启维护页面（如确认需要）
4. 服务器备份DB（如确认需要）
5. 服务器 git fetch origin && git reset --hard origin/{分支}
6. 停维护页面 + docker compose -f docker-compose.prod.yml up -d --build
7. 验证前后端HTTP状态

### deploy-all（代码+数据库全量部署）
1. **询问**：哪个分支？哪台服务器？
2. 本地 git push origin {分支}
3. 服务器停服 + 启维护页面
4. 服务器备份DB
5. 服务器 git fetch origin && git reset --hard origin/{分支}
6. scp 上传本地DB到服务器
7. 删服务器 -wal/-shm
8. 停维护页面 + docker compose -f docker-compose.prod.yml up -d --build
9. 验证

### maint-on（启维护页面）
1. **询问**：哪台服务器？
2. docker compose -f docker-compose.prod.yml down
3. docker run -d --name mbse-maintenance -p 8090:80 -v /opt/mbse/maintenance.html:/usr/share/nginx/html/index.html:ro --restart unless-stopped nginx:alpine
4. 验证 HTTP 200

### maint-off（停维护页面，启服务）
1. **询问**：哪台服务器？
2. docker rm -f mbse-maintenance
3. docker compose -f docker-compose.prod.yml up -d --build
4. 验证前后端状态

### backup（服务器备份）
1. **询问**：哪台服务器？
2. cp 到 backups/ 目录
3. ls -lh backups/ 显示结果

### restart-local
1. kill 3000/5173 端口进程
2. 启动 server + client
3. 验证端口

### restart-server
1. **询问**：哪台服务器？
2. cd /opt/mbse && docker compose -f docker-compose.prod.yml up -d --build
3. 验证容器状态 + HTTP

### status
1. **询问**：查本地、服务器、还是都查？哪台服务器？
2. 本地：netstat 检查 3000/5173
3. 服务器：docker ps + curl 前端/后端 + DB大小

## 服务器清单

| 名称 | IP | 用户 | 认证方式 | 项目路径 |
|------|-----|------|---------|---------|
| 8核服务器 | 36.212.172.150 | root | 密码（askpass） | /opt/mbse |
| 2核服务器 | 8.140.11.97 | root | 密钥（mbse.pem） | /opt/mbse |

### 8核服务器连接
```
SSH_ASKPASS=/tmp/askpass_mbse.sh DISPLAY=:0 ssh -F /dev/null -o StrictHostKeyChecking=no -o PreferredAuthentications=keyboard-interactive,password -o PubkeyAuthentication=no root@36.212.172.150
```
askpass 脚本：`echo 'Niubiaw198#@'`（执行前检查 /tmp/askpass_mbse.sh 是否存在，不存在则创建）

scp 同理：
```
SSH_ASKPASS=/tmp/askpass_mbse.sh DISPLAY=:0 scp -F /dev/null -o StrictHostKeyChecking=no -o PreferredAuthentications=keyboard-interactive,password -o PubkeyAuthentication=no root@36.212.172.150:...
```

### 2核服务器连接
```
ssh -F /dev/null -i /d/Downloads/mbse.pem -o StrictHostKeyChecking=no root@8.140.11.97
```
scp 同理：
```
scp -F /dev/null -i /d/Downloads/mbse.pem -o StrictHostKeyChecking=no root@8.140.11.97:...
```

## 通用信息

- **Docker Compose 文件**: docker-compose.prod.yml
- **服务器DB路径**: /opt/mbse/data/sqlite/eicd.db
- **本地DB路径**: data/sqlite/eicd.db
- **本地端口**: 3000（后端）、5173（前端）
- **服务器前端端口**: 8090
- **维护页面容器名**: mbse-maintenance

## 执行原则

1. **先确认参数再拟方案**：缺参数必须问，不猜
2. **先拟方案再执行**：用完整步骤列表展示给用户，等确认
3. **方案必须包含服务器IP和分支名**：不可省略
4. **每步有输出**：执行后打印关键结果
5. **备份优先**：涉及服务器数据变更时，默认建议备份
6. **维护页面**：任何会导致服务中断的操作，默认建议启维护页面
7. **串行传输**：不并发 scp/pscp

## 错误处理

能自己解决的不打扰用户，不能解决的立即停下报告。

### 自动处理
| 失败场景 | 处理方式 |
|---------|---------|
| WAL checkpoint 失败 | 跳过（容器已停时预期失败） |
| kill 本地端口失败 | 跳过（可能没运行） |
| scp 传输中断 | 自动重试1次 |
| 验证HTTP非预期 | 等3秒重试1次 |

### 停下报告
| 失败场景 | 处理 |
|---------|------|
| SSH连不上 | 报告，建议检查网络 |
| git push/pull 冲突 | 报告错误，等指示 |
| docker build 失败 | 报告最后20行日志，等指示 |
| 备份失败 | **立即停止**，不继续 |
| scp 重试仍失败 | 报告，等指示 |
| 验证重试仍失败 | 报告状态，等指示 |

### 硬性红线
- **备份失败 → 不继续数据覆盖**
- **SSH不通 → 不重试超过2次**
- **构建失败 → 不启动有问题的容器**
