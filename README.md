# EICD检查验证平台

一个用于编辑、检查和审核EICD表格内容的全栈Web应用。

## 功能特性

### 核心功能
- 🔐 **用户认证系统** - 支持管理员和审查员两种角色
- 📊 **EICD表格管理** - 查看和管理EICD数据表格
- 📤 **数据导入** - 支持Excel批量导入数据（管理员专用）
- 👥 **用户管理** - 管理员可创建、编辑、删除用户（管理员专用）
- 👤 **任务指派** - 管理员指派审查任务给审查员
- ✅ **审查流程** - 完整的审查工作流程
- 📝 **变更追踪** - 详细的变更记录和历史
- 🎨 **现代化UI** - 响应式设计，美观易用

### 工作流程
1. 管理员浏览EICD表格
2. 发现需要审查的数据行，指派给审查员
3. 审查员接收任务并审查
4. 审查员提交审查结果（无需修改或建议修改）
5. 管理员确认或拒绝修改
6. 系统自动更新数据并记录变更历史

## 技术栈

- **前端**: React + TypeScript + Vite + Tailwind CSS
- **后端**: Node.js + Express + TypeScript
- **数据库**: SQLite
- **认证**: JWT

## 快速开始

### 1. 安装依赖

```bash
npm run install-all
```

### 2. 启动开发服务器

```bash
npm run dev
```

这将同时启动前端（http://localhost:5173）和后端（http://localhost:3000）

## 安装说明

### Windows用户
运行 `install.bat` 脚本来自动安装所有依赖

### Linux/Mac用户
```bash
chmod +x install.sh
./install.sh
```

### 手动安装
```bash
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

## 环境配置

后端需要在 `server/` 目录下创建 `.env` 文件（如果不存在）：
```
PORT=3000
JWT_SECRET=eicd_secret_key_2024
DB_PATH=./eicd.db
```

## 默认用户

### 管理员
- 用户名: admin
- 密码: admin123

### 审查员
- 用户名: reviewer1
- 密码: reviewer123
- 用户名: reviewer2
- 密码: reviewer123

## 使用流程

1. **登录系统** - 使用管理员或审查员账号登录

2. **管理员操作**:
   - **用户管理**: 在"用户管理"页面创建、编辑、删除用户，重置密码
   - **导入数据**: 在"数据管理"页面上传Excel文件批量导入数据
   - **查看数据**: 在"数据表格"页面查看所有EICD数据
   - **指派任务**: 发现问题时指派审查任务给审查员
   - **确认修改**: 确认或拒绝审查员提交的修改

3. **审查员操作**:
   - 在"任务管理"页面接收被指派的任务
   - 审查数据并决定是否需要修改
   - 如需修改，提交修改内容

4. **确认流程**:
   - 管理员确认修改
   - 系统自动更新表格并记录变更

## 项目结构

```
.
├── server/          # 后端服务器
│   ├── src/        # 源代码
│   │   ├── routes/  # API路由
│   │   ├── middleware/  # 中间件
│   │   └── database.ts  # 数据库
│   └── uploads/    # 上传文件存储
├── client/          # 前端应用
│   ├── src/        # React源代码
│   │   ├── pages/   # 页面组件
│   │   ├── components/  # UI组件
│   │   └── context/  # 状态管理
│   └── public/     # 静态资源
└── README.md       # 项目说明
```

## 相关文档

- [QUICKSTART.md](QUICKSTART.md) - 快速开始指南
- [IMPORT_GUIDE.md](IMPORT_GUIDE.md) - Excel数据导入详细说明
