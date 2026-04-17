RHI可视化编辑器 — 信号分组的线束路由接口（Routing Harness Interface）编辑功能。

## 概述

RHI编辑器用于在信号分组内管理线端节点（WireEndNode）和互联点（Interconnect），以及它们之间的连接关系。每个信号分组可以打开一个RHI视图，可视化编辑线束路由拓扑。

## 核心概念

### 线端节点（wire_end_nodes）
两种类型：
- `device`：设备端，引用已有设备/连接器，slots引用信号端点
- `interconnect`：互联点，引用 interconnects 表，slots可关联互联点针孔

### 互联点（interconnects）
- **项目级**实体，不属于信号组，可被多个信号组共享
- 有名称/标签、类型（ic_type）、区域（ic_zone）和若干针孔（interconnect_pins）
- 通过项目管理页面的"互联点管理"弹窗创建/导入/编辑
- 在RHI编辑器中作为 type='interconnect' 的线端节点使用
- 同一针孔被一个信号组占用后，其他信号组不可再选该针孔

### 方向推导
slot方向从 signal_edges 推导（不是endpoint的input/output）：
- endpoint作为edge的 from_endpoint_id → OUT
- endpoint作为edge的 to_endpoint_id → IN
- 两边都有或 edge.direction='bidirectional' → BI-DIR

## 数据库表（5张）

```
interconnects              互联点定义（项目级）— 含 ic_type, ic_zone
interconnect_pins          互联点针孔（按数值升序排列）
wire_end_nodes             线端节点（device / interconnect）
wire_end_node_slots        节点槽位（protocol 存储协议标识）
wire_end_node_links        节点间连接
```

### 表关系
```
interconnects (项目级, 含 ic_type / ic_zone)
  └── interconnect_pins (针孔列表, 含 used_by_group 查询)

wire_end_nodes (信号组级)
  ├── type='device' → device_id, connector_id
  ├── type='interconnect' → interconnect_id
  └── wire_end_node_slots
        ├── device: endpoint_id, pin_id, protocol (从信号的协议标识写入)
        └── interconnect: interconnect_pin_id (引用互联点针孔)

wire_end_node_links (from_node_id → to_node_id, 仅允许 device↔interconnect)
```

### 数据库迁移
- 5张表的 CREATE TABLE IF NOT EXISTS 在 database.ts 启动时执行
- 旧表 wire_end_nodes 如有 separation_planes 外键引用，自动重建三张表（保留数据）
- interconnects 旧表通过 ALTER TABLE 自动添加 ic_type / ic_zone 列

### 废弃字段（留在DB不删，代码不再使用）
- wire_end_nodes: dead_end_label, plane_id, pos_x, pos_y
- wire_end_node_slots: dead_end_pin_num, dead_end_term_size

## 后端API

### 互联点管理 — `server/src/routes/interconnects.ts`

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/interconnects?project_id=` | 获取项目所有互联点及针孔（含 used_by_group） |
| POST | `/api/interconnects` | 创建互联点 `{project_id, label, ic_type?, ic_zone?}` |
| PUT | `/api/interconnects/:id` | 编辑互联点 `{label?, ic_type?, ic_zone?}` |
| POST | `/api/interconnects/:id/pins` | 添加针孔 `{pin_num}` |
| DELETE | `/api/interconnects/:id` | 删除互联点 |
| DELETE | `/api/interconnects/pins/:pinId` | 删除针孔 |
| POST | `/api/interconnects/import` | Excel导入（列1名称，列2针孔号，列3类型，列4区域） |

GET 返回每个针孔的 `used_by_group` 字段，值为占用该针孔的信号组名或 null。
针孔排序：`CAST(pin_num AS INTEGER), pin_num`（数值优先）。

### RHI编辑器 — `server/src/routes/rhi.ts`

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/rhi/status/all?project_id=` | 批量查询所有信号组的RHI状态（ic_count, link_count） |
| GET | `/api/rhi/:signal_group?project_id=` | 加载RHI数据（自动初始化设备节点） |
| POST | `/api/rhi/:signal_group/save` | 保存连线+互联点节点+针孔分配 |
| DELETE | `/api/rhi/:signal_group/node/:id` | 删除互联点节点 |

注意：`/status/all` 路由必须在 `/:signal_group` 之前注册，否则 "status" 会被当作 signal_group 参数。

### GET自动初始化
首次加载某信号组时，如果 wire_end_nodes 为空，自动从信号端点数据创建设备端节点和slots。
协议标识为空的信号 fallback 为 `'未知'`。互联点不自动创建。

### Save请求体
```json
{
  "project_id": 45,
  "links": [{"from": nodeId, "to": nodeId}],
  "interconnect_nodes": [{"_isNew": true, "_tempId": 1000, "interconnectId": 5}],
  "pin_assignments": [{"nodeId": 1000, "nodeTempId": 1000, "protocol": "CAN_High", "interconnectPinId": 12}]
}
```

## 前端

### 互联点管理弹窗（ProjectDataView.tsx）
位置：项目操作区域 → "互联点管理"按钮
功能：
- Excel导入（列1名称，列2针孔号，列3类型，列4区域，同名自动合并）
- 手动创建互联点（名称 + 类型 + 区域）
- 行内编辑互联点（名称/类型/区域）
- 为互联点添加/删除针孔（针孔按数值升序显示）
- 删除互联点
- 类型显示紫色标签，区域显示琥珀色标签

### RHI按钮（信号列表中）
- 每个信号分组左侧显示竖向 "RHI" 胶囊按钮
- **灰色**：该分组未添加互联点或连线（待构建）
- **橙色**：该分组已保存互联点或连线（已构建）
- 状态通过 `GET /api/rhi/status/all` 批量查询
- 关闭RHI编辑器后自动刷新状态

### RHI编辑器（`client/src/components/RhiEditor.tsx`）

#### 布局
- 全屏弹窗（95vw × 90vh）
- 左侧：互联点面板（w-52），支持按类型/区域分组显示（默认按类型）
- 右侧：SVG画布（3000×2000），可滚动

#### 交互方式（无模式切换）
| 操作 | 效果 |
|------|------|
| 拖拽设备框体/连接器区域 | 移动设备节点 |
| 拖拽互联点框体（非针孔区域） | 移动互联点 |
| 从任意节点的**针孔**拖到另一节点 | 创建节点间连线 |
| 设备→设备拖拽 | **禁止**，必须有互联点参与 |
| 右键互联点 | 删除互联点（恢复左侧面板可用） |
| 点击连线 | 删除连线 |
| 左侧面板拖拽互联点到画布 | 弹出针孔分配对话框后创建节点 |

#### 互联点拖入画布流程
1. 左侧面板按住互联点拖入画布区域
2. 松开后弹出"分配针孔"对话框
3. 对话框列出信号组所有协议标识，每个配一个针孔下拉菜单
4. 下拉菜单：可用针孔在前，已被其他信号组占用的禁用并显示 `(已被 XXX 占用)`
5. 确认后创建互联点节点
6. 已在画布中的互联点在左侧面板变灰且不可再次拖入
7. 右键移除后恢复可拖拽状态

#### 设备节点可视化
```
┌──────────────┐┌──┐┌──────────┐
│ U-2504       ││  ││ 12       │
│ 设备中文名称  ││J1││ CAN_High │
│              ││  ││ 15       │
│              ││  ││ CAN_Low  │
└──────────────┘└──┘└──────────┘
   设备框(teal)  连接器  针孔列表(每个28px高)
   140×h        竖条22   两行: 针孔号(9px粗) + 协议标识(7px)
```

#### 互联点节点可视化
```
┌────────────────────────── [RHI] ┐
│          SM-001                  │
│       Splice · Zone-A            │
│  ─────────────────────────────   │
│  ●┌─ 1  CAN_High ─────────┐●    │
│  ●┌─ 2  CAN_Low  ─────────┐●    │
│  ●┌─ 3  CAN_Gnd  ─────────┐●    │
└──────────────────────────────────┘
 橙色实线框 | RHI徽章(右上) | 标签+类型·区域(居中)
 针孔在框内 | 左右两侧附着点(●) | 连线附着在针孔矩形边缘
```

#### 连线渲染
- 连线渲染在节点图层**之上**（SVG中后绘制），可穿入互联点框内
- 起点：设备针孔矩形右端
- 终点：互联点针孔矩形左端或右端（自动判断：设备在互联点左侧→左端，右侧→右端）
- 每条连线按协议标识匹配，针孔到针孔
- **绞线**：同 twist_group 的协议画正弦波交叉
  - 从各自针孔出发(5%) → 汇合绞线(90%) → 分开进入各自针孔(5%)
  - 配色统一：双绞=红`#ef4444`+蓝`#3b82f6`，三绞=红+蓝+绿`#22c55e`
  - 振幅4px，每30px一周期
- **单线**：普通贝塞尔曲线，使用协议标识对应颜色（COLOR_POOL轮换）
- 拖拽连线时显示蓝色虚线预览

#### 初始布局
- 互联点：画布中心竖向排列（间距160px）
- 设备：环绕互联点排列在外圈
- 无互联点时设备按圆形排列

#### 保存
- 新互联点节点（id≥1000）作为 interconnect_nodes 提交
- 针孔分配通过 pin_assignments 提交（protocol + interconnectPinId）
- 连线通过 links 提交

### 导出CSV
文件名：`RHI_{信号组名}_connections.csv`
每行 = 一个protocol的针孔到针孔连接，含方向、绞线信息

## Excel导入格式

| 互联点名称 | 针孔号 | 类型 | 区域 |
|-----------|--------|------|------|
| SM-001 | 1 | Splice | Zone-A |
| SM-001 | 2 | Splice | Zone-A |
| SM-002 | A1 | Ground | Zone-B |

同名互联点自动合并，针孔去重。类型和区域列可选，已有互联点仅在导入值非空时更新。

## 已知问题 & TODO

- [x] database.ts迁移：5张表的CREATE TABLE已加入启动迁移
- [x] RHI编辑器集成到React前端（RhiEditor.tsx组件）
- [x] 互联点在RHI编辑器中选择针孔的弹窗（拖入时弹出）
- [x] 保存时互联点节点的针孔分配通过 interconnect_pin_id 持久化
- [x] 导出CSV时互联点的针孔号从 interconnect_pins 获取
- [ ] 互联点节点在画布中的针孔编辑（修改已分配的针孔）
- [ ] 部署到生产环境后验证数据库迁移

## 相关文件

```
client/src/components/RhiEditor.tsx   RHI编辑器React组件
client/src/pages/ProjectDataView.tsx  互联点管理弹窗 + RHI按钮 + RHI弹窗入口
server/src/routes/rhi.ts             RHI编辑器API（status/all在/:signal_group之前）
server/src/routes/interconnects.ts   互联点CRUD + Excel导入API
server/src/database.ts               5张表建表迁移 + 旧表FK修复迁移
server/src/index.ts                  路由注册（rhiRoutes + interconnectRoutes）
```
