# EICD 数据导入 MagicDraw/Cameo 教程

本教程说明如何将 EICD 管理平台中的设备、连接器、针脚、信号数据导入 MagicDraw/Cameo Systems Modeler，生成完整的 SysML 模型和 IBD 图。

## 导入效果

运行后会在 MagicDraw 中生成：

| 数据类型 | SysML 元素 | 说明 |
|---------|-----------|------|
| 设备 | Block + Part Property | 作为 CE25A飞行器 的组成部件 |
| 连接器 | Port（设备Block上） | 类型为连接器类型Block |
| 针脚 | 嵌套 Port（连接器类型Block上）| 带 EICDPin stereotype 属性 |
| 信号 | Connector（CE25A内部连线） | 连接两端设备的针脚Port |
| IBD 图 | 每个设备一张 | 显示设备及其关联设备的连接关系 |

所有数据库字段通过自定义 Stereotype（EICDDevice / EICDConnector / EICDPin / EICDSignal）的 Tagged Value 保留。

---

## 第一部分：本地部署服务器

### 1.1 环境要求

- **Node.js** ≥ 18（推荐 v20+）
- **npm** ≥ 9
- **Git**

检查版本：
```bash
node --version   # 例如 v24.14.1
npm --version    # 例如 11.11.0
```

如未安装 Node.js，前往 https://nodejs.org 下载安装。

### 1.2 克隆项目

```bash
git clone <仓库地址>
cd MBSE-management-platform
```

### 1.3 安装后端依赖

```bash
cd server
npm install
```

### 1.4 准备数据库

服务器使用 SQLite 数据库文件 `eicd.db`。有两种方式获取数据：

**方式 A：从远程服务器拉取（推荐）**

项目自带拉取脚本，会从生产服务器同步数据库：

```bash
# 回到项目根目录
cd ..
bash scripts/pull-db.sh
```

> 注意：此脚本使用 `plink/pscp`（PuTTY 工具），Windows 用户需安装 PuTTY 并将其加入 PATH。Mac/Linux 用户需改用 `ssh/scp` 版本。

拉取后数据库位于 `data/sqlite/eicd.db`，需要复制到 server 目录：

```bash
cp data/sqlite/eicd.db server/eicd.db
```

**方式 B：使用已有数据库文件**

如果你已经有 `eicd.db` 文件，直接放到 `server/` 目录下即可：

```bash
cp /path/to/your/eicd.db server/eicd.db
```

### 1.5 启动服务器

```bash
cd server
npm run dev
```

看到以下输出表示启动成功：

```
Server running on http://localhost:3000
```

### 1.6 验证服务器

打开另一个终端，运行：

```bash
# 检查服务器是否在运行
curl http://localhost:3000/api/health
# 应返回: {"status":"ok"}

# 检查数据是否可用（以项目41为例）
curl -u admin:admin123 "http://localhost:3000/api/oslc/projects/41/export/devices" | head -c 200
# 应返回 JSON 数据，包含 total 和 results 字段
```

如果项目 ID 不是 41，可以先查看有哪些项目：

```bash
# 登录获取 token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 查看所有项目
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/projects
```

记住你要导入的项目 ID，后面需要修改脚本中的配置。

---

## 第二部分：MagicDraw 宏命令执行

### 2.1 前提条件

- **MagicDraw** 或 **Cameo Systems Modeler** 2021x 或更高版本
- 已安装 **SysML Plugin**
- 服务器已启动（第一部分）

### 2.2 打开或创建项目

1. 启动 MagicDraw / Cameo Systems Modeler
2. 创建一个**新的 SysML 项目**：
   - `File` → `New Project`
   - 选择 `SysML Project` 模板
   - 命名（如 "EICD Import"）并保存

> ⚠️ **建议在新项目中运行**，避免影响已有模型数据。

### 2.3 打开宏编辑器

1. 菜单栏 → `Tools` → `Macros` → `Macro Engine`
2. 宏引擎窗口会打开

### 2.4 配置脚本

打开文件 `server/ImportEICDDevices.groovy`（用任意文本编辑器），找到顶部配置区域：

```groovy
// ======================== 配置项 ========================

def API_BASE = "http://localhost:3000/api/oslc/projects/41/export"
def USERNAME = "admin"
def PASSWORD = "admin123"
def CE25A_NAME     = "CE25A飞行器"
```

根据你的实际情况修改：

| 参数 | 说明 | 修改场景 |
|------|------|---------|
| `API_BASE` | 数据接口地址 | 修改项目 ID（将 `41` 改为你的项目 ID）；如果服务器在远程，改 `localhost:3000` 为实际 IP:端口 |
| `USERNAME` | 登录用户名 | 默认 `admin`，通常不用改 |
| `PASSWORD` | 登录密码 | 默认 `admin123`，通常不用改 |
| `CE25A_NAME` | 顶层 Block 名称 | 改为你的飞行器/系统名称 |

**常见配置示例：**

```groovy
// 本地服务器，项目44
def API_BASE = "http://localhost:3000/api/oslc/projects/44/export"

// 远程服务器，项目43
def API_BASE = "http://36.212.172.150:8090/api/oslc/projects/43/export"
```

### 2.5 运行脚本

1. **全选** `ImportEICDDevices.groovy` 中的全部内容（Ctrl+A / Cmd+A）
2. **复制**（Ctrl+C / Cmd+C）
3. 回到 MagicDraw 的 **Macro Engine** 窗口
4. 在编辑区域 **粘贴**（Ctrl+V / Cmd+V）
5. 点击 **Run**（▶ 运行按钮）

### 2.6 执行过程

脚本执行分为两个阶段：

**阶段一：模型元素创建**（约 5-10 秒）
- 从服务器拉取全部数据（设备/连接器/针脚/信号/端点）
- 创建 EICD Profile 和 4 个 Stereotype
- 创建 CE25A飞行器 顶层 Block
- 创建所有设备 Block 和 Part Property
- 创建所有连接器 Port 和针脚 Port
- 创建所有信号 Connector

**阶段二：IBD 图创建**（约 20-40 秒）
- 为每个有连接关系的设备创建一张 IBD 图
- 图中显示本设备、关联设备及其连接线

执行过程中，MagicDraw 底部的 **Message Window** 会显示 `[EICD]` 前缀的进度日志。

### 2.7 查看结果

脚本完成后会弹出汇总对话框，显示创建的元素数量。

在 **Containment Tree**（左侧面板）中查看导入的数据：

```
Model
├── EICD设备                    ← 设备 Package
│   ├── CE25A飞行器              ← 顶层 Block
│   │   ├── U-2504 (Part)       ← 设备 Part Property
│   │   ├── U-2505 (Part)
│   │   ├── 信号Connector...     ← 信号连线
│   │   └── IBD - U-2504 推力手柄  ← IBD 图
│   ├── U-2504 推力手柄 (Block)   ← 设备类型 Block
│   │   ├── J1 (Port)           ← 连接器 Port
│   │   └── J2 (Port)
│   └── ...
├── EICD连接器类型               ← 连接器类型 Package
│   ├── J1 (Block)              ← 连接器类型 Block
│   │   ├── 1 (Port)           ← 针脚 Port
│   │   ├── 2 (Port)
│   │   └── ...
│   └── ...
└── EICD Profile                ← Stereotype 定义
    ├── EICDDevice
    ├── EICDConnector
    ├── EICDPin
    └── EICDSignal
```

双击 IBD 图即可查看设备的内部连接关系。

### 2.8 查看元素属性

选中任意元素，在 **Specification** 窗口（双击元素或右键 → Specification）中：

1. 点击左侧 **Tags** 标签
2. 展开对应的 Stereotype（如 EICDDevice）
3. 可以看到数据库中的所有字段值

---

## 常见问题

### Q: 脚本报错 "unable to resolve class groovy.json.JsonSlurper"
脚本已内置 JSON 解析器（MiniJson），不依赖 groovy-json 模块。请确认你复制的是最新版本的脚本。

### Q: 弹窗显示 "拉取数据失败: Connection refused"
服务器未启动。回到终端确认 `npm run dev` 正在运行，且 `http://localhost:3000/api/health` 返回 `{"status":"ok"}`。

### Q: 脚本运行后 Containment Tree 中看不到数据
1. 确认展开了 `EICD设备` Package
2. 如果 Package 存在但内容为空，检查 Message Window 中的 `[EICD]` 日志，查看是否有错误
3. 如果之前运行失败过，先删除已有的 `EICD设备`、`EICD连接器类型`、`EICD Profile`，再重新运行

### Q: 想导入其他项目的数据
修改脚本顶部 `API_BASE` 中的项目 ID 数字，例如将 `/projects/41/` 改为 `/projects/44/`。

### Q: 重新导入数据
1. 在 Containment Tree 中右键删除 `EICD设备`、`EICD连接器类型`、`EICD Profile`
2. 保存项目
3. 重新运行脚本

### Q: 想连接远程服务器而非本地
修改 `API_BASE` 为远程地址，例如：
```groovy
def API_BASE = "http://36.212.172.150:8090/api/oslc/projects/44/export"
```
确保远程服务器上部署了包含 OSLC export 路由的最新代码。
