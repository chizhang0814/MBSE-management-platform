管理信号分组内的绞线组（twist_group）。

## 概念
- 绞线组是信号分组（signal_group）内的子分组
- 双绞线组：恰好2条信号，推荐导线线型都含"双绞"
- 三绞线组：恰好3条信号，推荐导线线型都含"三绞"
- 一个信号分组内可有多个绞线组（T1, T2, T3...），也可没有

## 约束
- twist_group 只能在 signal_group 不为空时有值
- 解散信号分组时自动清空 twist_group
- 双绞组必须恰好2条，三绞组必须恰好3条
- 组内信号的推荐导线线型必须一致

## 自动赋值
- 信号分组恰好2条信号且都是双绞 → 自动 T1
- 信号分组恰好3条信号且都是三绞 → 自动 T1
- 其他情况需手动设置

## API
- PUT /api/signals/twist-group：设置绞线组
  - body: { signal_ids: number[], twist_group: string | null, project_id: number }

## 数据库
- signals.twist_group TEXT DEFAULT NULL

## 前端
- 信号列表"等级"列后面的"绞线"列
- 已分配：彩色标签（T1=紫, T2=琥珀, T3=青）
- 未分配但含"绞"：显示"+"按钮，点击自动配对
