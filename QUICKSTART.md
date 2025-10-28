# EICD检查验证平台 - 快速开始指南

## 项目概述

这是一个完整的全栈Web应用，用于EICD表格内容的编辑、检查和审核管理。

## 系统要求

- Node.js 16+ 
- npm 或 yarn
- 现代浏览器（Chrome、Firefox、Edge等）

## 快速启动（3步）

### 1. 安装依赖

**Windows用户：**
```bash
install.bat
```

**Linux/Mac用户：**
```bash
chmod +x install.sh
./install.sh
```

**或者手动安装：**
```bash
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 2. 启动服务器

在项目根目录运行：
```bash
npm run dev
```

这将同时启动：
- 前端服务器：http://localhost:5173
- 后端API：http://localhost:3000

### 3. 访问应用

在浏览器中打开：http://localhost:5173

使用默认账号登录：
- **管理员**：admin / admin123
- **审查员**：reviewer1 / reviewer123

## 详细工作流程

### 管理员操作流程

1. **登录** - 使用管理员账号登录
2. **管理用户**（可选）- 在"用户管理"页面创建、编辑或删除用户
3. **导入数据**（可选）- 在"数据管理"页面上传Excel文件批量导入数据
4. **查看数据** - 在"数据表格"页面浏览EICD数据
5. **指派任务** - 点击"指派审查"按钮，选择审查员并添加备注
6. **查看任务** - 在"任务管理"页面查看所有任务状态
7. **确认修改** - 当审查员提交修改后，查看详情并确认或拒绝

### 审查员操作流程

1. **登录** - 使用审查员账号登录
2. **查看任务** - 在"任务管理"页面查看被指派的任务
3. **开始审查** - 点击任务详情，查看数据信息
4. **提交结果**：
   - **无需修改**：填写审查原因直接提交
   - **需要修改**：填写修改后的数据并提交原因
5. **等待确认** - 等待管理员确认修改

## 功能模块

### 1. 仪表盘
- 显示总数据量、待处理任务、已完成任务统计
- 提供快速操作指南

### 2. 用户管理（仅管理员）
- 查看所有用户列表
- 创建新用户（管理员或审查员）
- 编辑用户信息和角色
- 重置用户密码
- 删除用户

### 3. 数据管理（仅管理员）
- 上传Excel文件批量导入数据
- 下载Excel模板
- 查看导入结果和错误信息

### 4. 数据表格
- 查看所有EICD数据
- 管理员可以指派审查任务
- 查看变更记录

### 5. 任务管理
- 查看所有任务
- 审查员提交审查结果
- 管理员确认或拒绝修改

## 数据库

系统使用SQLite数据库，首次启动时会自动创建：
- `eicd.db` - 位于server目录

包含以下表：
- `users` - 用户表
- `eicd_data` - EICD数据表
- `tasks` - 任务表
- `change_logs` - 变更记录表

## API端点

### 认证
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息

### 数据
- `GET /api/data` - 获取所有EICD数据
- `GET /api/data/:id` - 获取单条数据
- `PUT /api/data/:id` - 更新数据（管理员）
- `GET /api/data/:id/changes` - 获取变更记录

### 任务
- `POST /api/tasks` - 创建任务（管理员）
- `GET /api/tasks` - 获取所有任务
- `GET /api/tasks/:id` - 获取任务详情
- `POST /api/tasks/:id/submit` - 提交审查结果（审查员）
- `POST /api/tasks/:id/confirm` - 确认修改（管理员）
- `POST /api/tasks/:id/reject` - 拒绝修改（管理员）

### 用户管理
- `GET /api/users` - 获取所有用户（管理员）
- `GET /api/users/:id` - 获取单个用户（管理员）
- `POST /api/users` - 创建用户（管理员）
- `PUT /api/users/:id` - 更新用户（管理员）
- `DELETE /api/users/:id` - 删除用户（管理员）
- `POST /api/users/:id/reset-password` - 重置用户密码（管理员）

### 数据上传
- `POST /api/upload/import` - 上传Excel文件导入数据（管理员）
- `GET /api/upload/template` - 下载Excel模板

## 开发模式

### 前端开发
```bash
cd client
npm run dev
```

### 后端开发
```bash
cd server
npm run dev
```

## 常见问题

### Q: 端口被占用怎么办？
A: 修改 `server/.env` 中的 `PORT` 和 `client/vite.config.ts` 中的端口号

### Q: 数据库数据丢失？
A: 删除 `server/eicd.db` 文件，重启服务器会自动重新初始化

### Q: 忘记密码？
A: 数据存储在本地SQLite数据库，可删除数据库文件重新初始化

## 下一步

- 修改业务逻辑以适配实际需求
- 添加更多用户角色
- 扩展数据字段
- 添加数据导出功能
- 集成其他数据源

## 技术支持

如有问题，请查看 `README.md` 或提交Issue。


