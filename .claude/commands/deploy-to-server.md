将本地代码和数据库部署到8核服务器（36.212.172.150）。

参数：$ARGUMENTS（可选：maintenance 表示启动维护页面，restore 表示恢复服务）

流程：
1. push本地分支到远程
2. 在8核服务器上：
   a. WAL checkpoint
   b. 备份数据库（cp eicd.db eicd.db.bak.{timestamp}）
   c. 停止后端服务
   d. 如果需要维护页面：配置nginx返回503维护页
   e. 拉取最新代码（git fetch + git reset --hard origin/with_DOORS_data）
   f. 同步本地数据库到服务器（通过pscp，先拷到/tmp避免中文路径问题）
   g. 重建并启动后端（docker compose up -d --build backend）
   h. 重建并启动前端（docker compose up -d --build frontend）
   i. 如果之前启动了维护页面：恢复nginx原始配置

服务器连接方式：
- 使用 plink/pscp（PuTTY工具）
- 密码认证（参考 scripts/pull-db.sh 中的配置）
- 容器名：mbse-backend-1, mbse-frontend-1
