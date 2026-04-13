执行标准的本地环境重置流程：

1. 停掉本地前后端（查找占用3000和5173端口的进程并kill）
2. 清空本地数据库（删除 data/sqlite/eicd.db 及 -wal/-shm 文件）
3. 从8核服务器（36.212.172.150）同步数据库到本地（使用 scripts/pull-db.sh）
4. 启动本地前后端（server npm run dev + client npm run dev）
5. 验证两个端口都在监听

注意：
- 不要碰8核服务器上的服务
- 不要并发启动多个pscp进程
- pull-db.sh 会自动处理 WAL checkpoint 和文件清理
- 如果后端容器已停（维护模式），直接用pscp下载，跳过checkpoint
