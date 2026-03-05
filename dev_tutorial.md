# 开发环境搭建指南

## 前置条件

- [Node.js](https://nodejs.org/) v20+
- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)（部署时需要）
- `mbse.pem` 文件（向项目负责人获取，用于连接服务器）

---

## 一、克隆代码

```bash
git clone https://github.com/chizhang0814/MBSE-management-platform.git
cd MBSE-management-platform
git checkout with_DOORS_data
```

---

## 二、安装依赖

```bash
cd server && npm install
cd ../client && npm install
```

---

## 三、获取数据库

数据库文件不在代码仓库中，需从服务器拉取。

将 `mbse.pem` 放到 `D:\Downloads\mbse.pem`，然后执行：

```bash
cd ..
bash scripts/pull-db.sh
```

执行成功后会在 `server/eicd.db` 生成数据库文件。

> 如果 `mbse.pem` 放在其他位置，修改 `scripts/pull-db.sh` 第 8 行的 `PEM` 路径即可。

---

## 四、本地启动

打开两个终端分别运行：

```bash
# 终端 1：启动后端（端口 3000）
cd server && npm run dev

# 终端 2：启动前端（端口 5173）
cd client && npm run dev
```

浏览器访问 `http://localhost:5173`，使用 admin 账号登录。

---

## 五、项目结构

```
.
├── client/                 # 前端（React + TypeScript + Vite）
│   ├── src/
│   │   ├── pages/          # 页面组件
│   │   ├── components/     # 公共组件
│   │   └── context/        # 全局状态
│   └── public/             # 静态文件
├── server/                 # 后端（Express + TypeScript + SQLite）
│   ├── src/
│   │   ├── routes/         # API 路由
│   │   ├── shared/         # 共享工具（审批逻辑等）
│   │   └── database.ts     # 数据库初始化与迁移
│   └── eicd.db             # 本地数据库（不提交到 git）
├── scripts/
│   ├── pull-db.sh          # 从服务器拉取数据库到本地
│   └── push-db.sh          # 将本地数据库推送到服务器（危险）
└── docker-compose.prod.yml # 生产部署配置
```

---

## 六、数据库同步

### 服务器 → 本地（日常使用，不影响生产）

```bash
bash scripts/pull-db.sh
```

### 本地 → 服务器（⚠️ 会覆盖生产数据，谨慎使用）

```bash
bash scripts/push-db.sh
```

执行时需输入 `YES` 确认，脚本会自动备份服务器当前数据库。

---

## 七、部署到服务器

### 部署代码变更

```bash
# 1. 提交并推送代码
git add <修改的文件>
git commit -m "说明"
git push

# 2. 上传修改的文件到服务器
scp -F /dev/null -i /d/Downloads/mbse.pem <本地文件路径> root@8.140.11.97:/opt/mbse/<对应路径>

# 3. 重建并重启容器
ssh -F /dev/null -i /d/Downloads/mbse.pem -o StrictHostKeyChecking=no root@8.140.11.97 \
  "cd /opt/mbse && docker compose -f docker-compose.prod.yml up -d --build"
```

### 仅重启后端（后端代码变更）

```bash
ssh -F /dev/null -i /d/Downloads/mbse.pem -o StrictHostKeyChecking=no root@8.140.11.97 \
  "cd /opt/mbse && docker compose -f docker-compose.prod.yml up -d --build backend"
```

### 仅重启前端（前端代码变更）

```bash
ssh -F /dev/null -i /d/Downloads/mbse.pem -o StrictHostKeyChecking=no root@8.140.11.97 \
  "cd /opt/mbse && docker compose -f docker-compose.prod.yml up -d --build frontend"
```

---

## 八、服务器信息

| 项目 | 值 |
|------|-----|
| IP | `8.140.11.97` |
| 用户 | `root` |
| 项目路径 | `/opt/mbse` |
| 数据库路径 | `/opt/mbse/data/sqlite/eicd.db` |
| 前端端口 | `80` |
| 后端端口 | `3000`（容器内部） |

---

## 九、常用命令

```bash
# 查看服务运行状态
ssh -F /dev/null -i /d/Downloads/mbse.pem root@8.140.11.97 \
  "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

# 查看后端日志
ssh -F /dev/null -i /d/Downloads/mbse.pem root@8.140.11.97 \
  "docker logs mbse-backend-1 --tail 50"

# 停止所有服务
ssh -F /dev/null -i /d/Downloads/mbse.pem root@8.140.11.97 \
  "cd /opt/mbse && docker compose -f docker-compose.prod.yml down"
```
