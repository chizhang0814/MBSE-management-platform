将 CE-25A 线束WB数据（Excel）与数据库EICD信号数据进行双向比对。

## 背景

- **WB数据**：`CE-25A线束WB汇总_260121-优化-0410.xlsx` Sheet1，每行=一根物理导线（从连接器针孔→到连接器针孔）
- **DB数据**：`data/sqlite/eicd.db` CE-25A X号机（project_id=45）的信号、端点、edge
- WB用 `-P`（Plug），DB用 `-J`（Jack），需要三级映射：精确→J换P→通配模糊

## 比对脚本位置

所有脚本在 `tmpTASK/` 目录下（已加入.gitignore）：

### 比对一：DB信号→Excel连通分量
- **脚本**：`tmpTASK/check_component_containment.py`
- **输出**：`tmpTASK/component_containment_report_v3.csv`
- **逻辑**：Excel构建无向图→求连通分量→每条DB信号的端点集合是否被某个分量包含
- **result**: `pass` | `pass_incomplete` | `partial_match` | `all_unmapped` | `no_endpoints`

### 比对二：Excel连通分量→DB信号
- **脚本**：`tmpTASK/check_excel_vs_db.py`
- **输出**：`tmpTASK/excel_vs_db_report_v3.csv`
- **逻辑**：对每个Excel连通分量，查有多少DB信号引用其端点，信号是子集还是交集
- **result**: `pass` | `partial` | `multi_all_subset` | `multi_all_partial` | `multi_mixed` | `no_signal`
- 重要前提：DB中信号之间不共享端点（pin_id唯一属于一条信号）

### 辅助文件
- `tmpTASK/excel_vs_db_venn.html` — 六种result的韦恩图可视化
- `tmpTASK/比对说明文档.html` — 完整说明文档（背景、映射规则、列含义、韦恩图读法）
- `tmpTASK/check_edge_connectivity.py` — 早期版本：逐edge检查在Excel中的连通路径（BFS寻路）

## 端点映射三级策略

1. **精确匹配**：DB连接器名直接在Excel中找（如 `2501U2401-J1`）
2. **J→P替换**：`-J` 后缀替换为 `-P`（如 `2501U2401-J1` → `2501U2401-P1`）
3. **通配模糊**：前缀+尾号不变，中间字母任意（如 `2501U2401-*1`）；TB连接器按ATA前缀+TB编号模糊匹配

## 使用方式

```bash
# 重新运行比对（数据库更新后）
cd "D:\Downloads\MBSE综合管理平台"
python3 tmpTASK/check_component_containment.py   # DB→Excel
python3 tmpTASK/check_excel_vs_db.py              # Excel→DB
```

注意：如果输出CSV被Excel占用会报 PermissionError，需关闭Excel或改脚本中的 OUTPUT_PATH。

## 最近一次比对结果（2026-04-15，DB信号3725条）

### 比对一（3725条信号）
| result | 数量 |
|--------|------|
| pass | 2189 |
| pass_incomplete | 820 |
| partial_match | 320 |
| all_unmapped | 375 |
| no_endpoints | 21 |

### 比对二（4213个连通分量）
| result | 数量 |
|--------|------|
| pass | 2940 |
| partial | 424 |
| multi_all_subset | 5 |
| multi_all_partial | 91 |
| multi_mixed | 15 |
| no_signal | 738 |

## 导入模拟脚本

- **脚本**：`tmpTASK/simulate_import_sheet1.py`
- **功能**：模拟导入Excel信号Sheet的完整过程（dry-run），逐行跟踪：新建/并网/失败、新建针孔、重复edge、字段覆盖、次信号删除
- **使用前**：修改脚本顶部的 `EXCEL_PATH`、`SHEET_NAME`、`OUTPUT_PATH`
- **注意**：完整复现了服务端 `isPinFrozen` 四层冻结检查（连接器删除审批、设备删除审批、针孔编辑/删除审批、关联信号审批中）
