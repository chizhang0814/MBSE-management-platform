运维操作中心：数据同步、服务部署、维护模式的一站式操作。

用户输入 $ARGUMENTS，根据参数识别操作意图，拟定方案，确认后执行。

## 参数识别规则

根据用户输入的自然语言或关键词匹配操作类型：

| 关键词/意图 | 操作类型 | 说明 |
|------------|---------|------|
| `pull` / 拉取 / 同步到本地 / 从服务器同步 | **pull** | 服务器DB → 本地，重启本地 |
| `push` / 推送 / 同步到服务器 / 推数据库 | **push-db** | 本地DB → 服务器，重启服务器 |
| `deploy` / 部署 / 上线 / 发布 | **deploy** | 代码部署到服务器（保留服务器数据） |
| `deploy-all` / 全量部署 / 部署代码和数据 | **deploy-all** | 代码+数据库同时部署到服务器 |
| `maintenance on` / 维护 / 停服 / 升级维护 | **maint-on** | 停服务，启维护页面 |
| `maintenance off` / 恢复 / 恢复服务 | **maint-off** | 停维护页面，启服务 |
| `backup` / 备份 | **backup** | 仅在服务器备份数据库 |
| `restart-local` / 重启本地 | **restart-local** | 停+启本地前后端 |
| `restart-server` / 重启服务器 | **restart-server** | 重建服务器容器 |
| `status` / 状态 | **status** | 查看本地+服务器运行状态 |

如果参数不明确，列出可用操作让用户选择。支持组合操作，如"停服务器，同步到本地，重启本地"。

## 各操作的标准流程

### pull（服务器 → 本地）
1. 停本地前后端（kill 3000/5173端口进程）
2. 删本地DB文件（eicd.db / -wal / -shm）
3. 判断服务器后端容器是否运行：
   - 运行中：先 WAL checkpoint（docker exec ... PRAGMA wal_checkpoint(TRUNCATE)），再 pscp 下载
   - 已停（维护模式）：直接 pscp 下载，跳过 checkpoint
4. 清理本地 WAL/SHM
5. 后台启动本地前后端（server npm run dev / client npm run dev）
6. 验证 3000 + 5173 端口监听

### push-db（本地DB → 服务器）
1. 在服务器备份当前DB（cp → backups/）
2. 服务器停后端容器（docker compose ... stop backend）
3. pscp 上传本地DB到服务器 /opt/mbse/data/sqlite/eicd.db
4. 删服务器 -wal/-shm 文件
5. 重启后端容器（docker compose ... up -d backend）
6. 验证后端API可用

### deploy（仅代码部署，保留服务器数据）
1. 本地 git push origin with_DOORS_data
2. 服务器备份DB
3. 服务器 git fetch origin && git reset --hard origin/with_DOORS_data
4. docker compose -f docker-compose.prod.yml up -d --build
5. 验证前后端HTTP状态

### deploy-all（代码+数据库全量部署）
1. 本地 git push origin with_DOORS_data
2. 服务器启维护页面（maint-on）
3. 服务器备份DB
4. 服务器 git fetch + reset
5. pscp 上传本地DB
6. 删服务器 -wal/-shm
7. 停维护页面
8. docker compose up -d --build
9. 验证

### maint-on（启维护页面）
1. docker compose -f docker-compose.prod.yml down
2. docker run -d --name mbse-maintenance -p 8090:80 -v /opt/mbse/maintenance.html:/usr/share/nginx/html/index.html:ro --restart unless-stopped nginx:alpine
3. 验证 HTTP 200

### maint-off（停维护页面，启服务）
1. docker rm -f mbse-maintenance
2. docker compose -f docker-compose.prod.yml up -d --build
3. 验证前后端状态

### backup（服务器备份）
1. cp /opt/mbse/data/sqlite/eicd.db /opt/mbse/data/sqlite/backups/eicd_manual_$(date +%Y%m%d_%H%M%S).db
2. ls -lh backups/ 显示结果

### restart-local
1. kill 3000/5173 端口进程
2. 后台启动 server + client
3. 验证端口

### restart-server
1. cd /opt/mbse && docker compose -f docker-compose.prod.yml up -d --build
2. 验证容器状态 + HTTP

### status
1. 本地：netstat 检查 3000/5173
2. 服务器：docker ps | grep mbse + curl 前端/后端
3. 服务器DB大小 + 最近备份

## 连接信息

- **服务器**: 36.212.172.150, root
- **SSH方式**: SSH_ASKPASS=/tmp/askpass_mbse.sh DISPLAY=:0 ssh -F /dev/null -o StrictHostKeyChecking=no -o PreferredAuthentications=keyboard-interactive,password -o PubkeyAuthentication=no root@36.212.172.150
- **askpass脚本内容**: echo 'Niubiaw198#@'（执行前检查 /tmp/askpass_mbse.sh 是否存在，不存在则创建）
- **pscp**: pscp -pw "Niubiaw198#@" -hostkey "SHA256:bE9orbsDdqcyT0vGxaEMQ+LquEa665DdQqFW7D9oXo0"
- **服务器项目路径**: /opt/mbse
- **服务器DB**: /opt/mbse/data/sqlite/eicd.db
- **Docker Compose**: docker-compose.prod.yml
- **Git分支**: with_DOORS_data
- **本地DB**: data/sqlite/eicd.db
- **本地端口**: 3000（后端）、5173（前端）

## 执行原则

1. **先拟方案再执行**：识别操作类型后，用简洁的步骤列表告诉用户"将要执行以下操作"，等用户确认
2. **每步有输出**：执行每步后打印关键结果（不要静默）
3. **备份优先**：涉及服务器数据变更时，必须先备份
4. **维护页面**：全量部署(deploy-all)自动启用维护页面，仅代码部署(deploy)不需要
5. **验证收尾**：操作结束后验证关键服务状态
6. **不要并发pscp**：文件传输串行执行

## 错误处理

能自己解决的不打扰用户，不能解决的立即停下来报告。

### 自动处理（不中断）
| 失败场景 | 处理方式 |
|---------|---------|
| WAL checkpoint失败 | 跳过继续（容器已停时预期失败） |
| kill本地端口进程失败 | 跳过（可能本来就没运行） |
| pscp传输中断 | 自动重试1次 |
| 验证HTTP非预期状态码 | 等3秒重试1次 |

### 停下报告（需要用户判断）
| 失败场景 | 报告内容 |
|---------|---------|
| SSH连不上服务器 | 报告超时/拒绝，建议检查网络或服务器状态 |
| git push/pull冲突或失败 | 报告错误信息，等待指示 |
| docker compose build失败 | 报告构建日志最后20行，等待指示 |
| 服务器备份失败（如磁盘满） | 立即停止后续操作，报告错误，不可跳过 |
| pscp重试仍失败 | 报告传输错误，等待指示 |
| npm run dev启动失败 | 检查端口占用和最近日志，报告诊断结果 |
| 验证重试仍失败 | 报告服务状态，等待指示 |

### 硬性红线（绝对不跳过）
- **备份失败 → 不继续数据覆盖操作**
- **SSH不通 → 不盲目重试超过2次**
- **构建失败 → 不启动有问题的容器**
