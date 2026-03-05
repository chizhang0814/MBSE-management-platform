# MBSE综合管理平台 - Claude Code 指引

## 项目概述

EICD（电气接口控制文件）综合管理平台，用于管理航空电气系统的设备、连接器、针孔和信号数据，包含两阶段审批流程和角色权限控制。

## 技术栈

- **前端**：React + TypeScript + Vite + Tailwind CSS
- **后端**：Express + TypeScript（tsx 运行，tsc 编译）
- **数据库**：SQLite（better-sqlite3，生产环境；sqlite3，查询脚本）
- **部署**：Docker Compose（`docker-compose.prod.yml`）
- **认证**：JWT（存在 localStorage，header: `Authorization: Bearer <token>`）

## 目录结构

```
client/src/
  pages/          # 页面：ProjectDataView.tsx（核心）、UserManagement.tsx
  components/     # Layout.tsx（导航+通知）、HistoryModal.tsx、ProfileModal.tsx
  context/        # AuthContext.tsx（用户状态）

server/src/
  routes/         # API 路由（每个模块一个文件）
  shared/
    approval-helper.ts   # 审批核心逻辑（submitChangeRequest、checkAndAdvancePhase）
    column-schema.ts     # 字段校验规则
  database.ts     # 数据库初始化、表结构、迁移
  index.ts        # Express 入口，路由注册
```

## 本地开发

```bash
# 后端（端口 3000）
cd server && npm run dev

# 前端（端口 5173）
cd client && npm run dev
```

本地数据库：`server/eicd.db`（被 .gitignore 排除，需从服务器拉取）

```bash
bash scripts/pull-db.sh   # 服务器 → 本地
bash scripts/push-db.sh   # 本地 → 服务器（⚠️ 覆盖生产数据，需确认）
```

## 服务器

- **IP**：`8.140.11.97`，用户 `root`，密钥 `D:\Downloads\mbse.pem`
- **项目路径**：`/opt/mbse`
- **数据库**：`/opt/mbse/data/sqlite/eicd.db`（Docker volume 挂载）
- **SSH**：`ssh -F /dev/null -i /d/Downloads/mbse.pem -o StrictHostKeyChecking=no root@8.140.11.97`

```bash
# 重建并重启所有容器
ssh ... "cd /opt/mbse && docker compose -f docker-compose.prod.yml up -d --build"

# 仅重启后端
ssh ... "cd /opt/mbse && docker compose -f docker-compose.prod.yml up -d --build backend"
```

## 角色体系

| 角色 | 关键权限 |
|------|---------|
| `总体人员` | 审批变更请求、审批权限申请 |
| `EWIS管理员` | 信号 CRUD |
| `设备管理员` | 设备/连接器/针孔/信号 CRUD（仅自己负责的设备） |
| `一级包长` / `二级包长` / `只读` | 只读 |

用户权限存储在 `users.permissions` 字段（JSON 数组），格式：
```json
[{ "project_name": "0号机", "project_role": "设备管理员" }]
```

## 审批流程

```
提交变更 → Pending
  → 第一阶段 completion：设备负责人补全字段
  → 第二阶段 approval：总体人员审批
  → 通过：Active/normal | 拒绝：退回 Draft
```

- 核心函数：`server/src/shared/approval-helper.ts`
  - `submitChangeRequest(db, spec)` — 创建审批请求和审批项
  - `checkAndAdvancePhase(db, requestId)` — 检查是否可推进到下一阶段
- 一人拒绝 = 整个请求拒绝
- 数据状态：`Draft` → `Pending` → `normal`（设备）/ `Active`（信号）

## 数据库关键表

| 表 | 说明 |
|----|------|
| `users` | 用户，`permissions` 字段为 JSON |
| `employees` | 员工 EID ↔ 姓名映射 |
| `projects` | 项目 |
| `devices` / `connectors` / `pins` | 设备层级 |
| `signals` | 信号（含端点 JSON） |
| `approval_requests` | 审批请求 |
| `approval_items` | 审批项（completion/approval 两种） |
| `notifications` | 通知，`reference_id` 关联 `permission_requests.id` |
| `permission_requests` | 权限申请 |
| `change_logs` | 变更历史 |

## 前端关键模式

- `pending_item_type`：后端 JOIN `approval_items` 返回的虚拟字段，表示当前用户对该实体的待处理类型
- `has_pending_sub`：虚拟字段（设备列表接口动态附加），**不是数据库列**，PUT 时必须从 body 中删除
- `approvalInfoMap`：`Record<string, ApprovalInfo>`，展开 Pending 行时 lazy load
- 筛选模式：`all | my | pending | my_approval | my_completion`

## 常见坑

1. **`has_pending_sub` 不是 DB 列**：PUT 设备时必须 `delete fields.has_pending_sub`，否则报 `SQLITE_ERROR: no such column`
2. **路由注册顺序**：`/api/users/permission-requests` 必须在 `/:id` 路由之前注册
3. **WAL 同步**：上传数据库前必须先 `PRAGMA wal_checkpoint(TRUNCATE)`，并删除目标机器上的 `.db-wal` / `.db-shm`
4. **DeviceRow 中文括号键**：`设备部件所属系统（4位ATA）` 含中文括号，访问时用 `as any`
5. **项目名改名联动**：`PUT /api/projects/:id` 会同步更新 `users.permissions` 中的 `project_name`，但前端 UserManagement 的项目下拉需打开弹窗时重新拉取

## API 路由一览

| 路径 | 文件 |
|------|------|
| `/api/auth/*` | `auth.ts`（登录、注册、权限申请） |
| `/api/users/*` | `users.ts`（用户管理、permission-requests） |
| `/api/projects/*` | `projects.ts`（项目 CRUD、导出） |
| `/api/devices/*` | `devices.ts`（设备/连接器/针孔 CRUD） |
| `/api/signals/*` | `signals.ts`（信号 CRUD） |
| `/api/approvals/*` | `approvals.ts`（by-entity、complete、approve、reject） |
| `/api/notifications/*` | `notifications.ts` |
| `/api/employees/*` | `employees.ts`（EID 映射） |
| `/api/data/*` | `data.ts`（Excel 导入、动态表） |
| `/api/upload/*` | `upload.ts` |
