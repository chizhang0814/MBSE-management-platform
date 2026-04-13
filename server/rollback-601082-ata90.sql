-- ============================================================================
-- 精准回滚脚本：撤销601082导入(#2329/#2330)对CE-25A X号机ATA90信号的破坏
-- 目标数据库：/opt/mbse/data/sqlite/eicd.db
-- 备份数据库：/opt/mbse/data/sqlite/backups/eicd_20260413_120001.db
-- ============================================================================
--
-- 操作概要（共5步）：
--   第1步：取消601082在ATA90信号上的21条pending审批请求及其46个审批项
--   第2步：恢复21条被601082手动编辑的信号 → 备份状态(Active + 原始字段 + 原始端点)
--   第3步：恢复5条被导入重复拼接unique_id的信号 → 备份的unique_id和标记字段
--   第4步：恢复26条被导入合并删除的信号 → 从备份复制完整记录(信号+端点+边)
--   第5步：清理导入产生的change_logs记录(仅601082, reason='文件导入更新')
--
-- 安全措施：
--   - 整个脚本在一个事务中执行，任何错误自动回滚
--   - 执行前必须先手动创建当前DB的备份
--   - 不影响非ATA90数据、不影响其他用户的操作、不影响其他项目
-- ============================================================================

ATTACH '/opt/mbse/data/sqlite/backups/eicd_20260413_120001.db' AS bak;

BEGIN TRANSACTION;

-- ══════════════════════════════════════════════════════════════════════════
-- 第1步：取消601082在ATA90信号上的21条pending审批请求
-- 涉及：approval_requests 21条, approval_items 46条
-- 原因：这些是601082导入后手动编辑产生的，回滚后不再需要
-- ══════════════════════════════════════════════════════════════════════════

-- 取消审批项（46条 pending → cancelled）
UPDATE approval_items SET status = 'cancelled'
WHERE approval_request_id IN (1474,1475,1485,1489,1491,1504,1505,1506,1509,1511,1512,1516,1517,1518,1519,1520,1521,1523,1524,1526,1527)
AND status = 'pending';

-- 取消审批请求（21条 pending → cancelled）
UPDATE approval_requests SET status = 'cancelled'
WHERE id IN (1474,1475,1485,1489,1491,1504,1505,1506,1509,1511,1512,1516,1517,1518,1519,1520,1521,1523,1524,1526,1527)
AND status = 'pending';


-- ══════════════════════════════════════════════════════════════════════════
-- 第2步：恢复21条被601082手动编辑的信号（当前Pending/Active → 恢复为备份状态）
-- 这些信号在备份中都是Active，字段是导入前的正确值
-- 方法：删除当前端点和边 → 从备份复制字段+端点+边
-- ══════════════════════════════════════════════════════════════════════════

-- 2a. 删除这21条信号的当前端点和边（将从备份重建）
DELETE FROM signal_edges WHERE signal_id IN (73450,70162,73451,73452,73453,70165,70168,70169,72955,72949,72950,72946,72945,72947,72948,72951,72952,72957,72963,72971,72979);
DELETE FROM signal_endpoints WHERE signal_id IN (73450,70162,73451,73452,73453,70165,70168,70169,72955,72949,72950,72946,72945,72947,72948,72951,72952,72957,72963,72971,72979);

-- 2b. 从备份恢复信号字段（覆盖当前值）
-- 注：用备份的所有字段覆盖当前值，但保留created_at不变
UPDATE signals SET
  unique_id = (SELECT unique_id FROM bak.signals WHERE id = signals.id),
  连接类型 = (SELECT 连接类型 FROM bak.signals WHERE id = signals.id),
  信号架次有效性 = (SELECT 信号架次有效性 FROM bak.signals WHERE id = signals.id),
  推荐导线线规 = (SELECT 推荐导线线规 FROM bak.signals WHERE id = signals.id),
  推荐导线线型 = (SELECT 推荐导线线型 FROM bak.signals WHERE id = signals.id),
  独立电源代码 = (SELECT 独立电源代码 FROM bak.signals WHERE id = signals.id),
  敷设代码 = (SELECT 敷设代码 FROM bak.signals WHERE id = signals.id),
  电磁兼容代码 = (SELECT 电磁兼容代码 FROM bak.signals WHERE id = signals.id),
  余度代码 = (SELECT 余度代码 FROM bak.signals WHERE id = signals.id),
  功能代码 = (SELECT 功能代码 FROM bak.signals WHERE id = signals.id),
  接地代码 = (SELECT 接地代码 FROM bak.signals WHERE id = signals.id),
  极性 = (SELECT 极性 FROM bak.signals WHERE id = signals.id),
  额定电压 = (SELECT 额定电压 FROM bak.signals WHERE id = signals.id),
  额定电流 = (SELECT 额定电流 FROM bak.signals WHERE id = signals.id),
  设备正常工作电压范围 = (SELECT 设备正常工作电压范围 FROM bak.signals WHERE id = signals.id),
  是否成品线 = (SELECT 是否成品线 FROM bak.signals WHERE id = signals.id),
  成品线件号 = (SELECT 成品线件号 FROM bak.signals WHERE id = signals.id),
  成品线线规 = (SELECT 成品线线规 FROM bak.signals WHERE id = signals.id),
  成品线类型 = (SELECT 成品线类型 FROM bak.signals WHERE id = signals.id),
  成品线长度 = (SELECT 成品线长度 FROM bak.signals WHERE id = signals.id),
  成品线载流量 = (SELECT 成品线载流量 FROM bak.signals WHERE id = signals.id),
  成品线线路压降 = (SELECT 成品线线路压降 FROM bak.signals WHERE id = signals.id),
  成品线标识 = (SELECT 成品线标识 FROM bak.signals WHERE id = signals.id),
  成品线与机上线束对接方式 = (SELECT "成品线与机上线束对接方式" FROM bak.signals WHERE id = signals.id),
  成品线安装责任 = (SELECT 成品线安装责任 FROM bak.signals WHERE id = signals.id),
  备注 = (SELECT 备注 FROM bak.signals WHERE id = signals.id),
  status = (SELECT status FROM bak.signals WHERE id = signals.id),
  import_status = (SELECT import_status FROM bak.signals WHERE id = signals.id),
  import_conflicts = (SELECT import_conflicts FROM bak.signals WHERE id = signals.id),
  信号ATA = (SELECT 信号ATA FROM bak.signals WHERE id = signals.id),
  线类型 = (SELECT 线类型 FROM bak.signals WHERE id = signals.id),
  协议标识 = (SELECT 协议标识 FROM bak.signals WHERE id = signals.id),
  signal_group = (SELECT signal_group FROM bak.signals WHERE id = signals.id),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (73450,70162,73451,73452,73453,70165,70168,70169,72955,72949,72950,72946,72945,72947,72948,72951,72952,72957,72963,72971,72979);

-- 2c. 从备份复制端点
INSERT INTO signal_endpoints (id, signal_id, device_id, pin_id, endpoint_index, "端接尺寸", "信号名称", "信号定义", input, output, confirmed)
SELECT id, signal_id, device_id, pin_id, endpoint_index, "端接尺寸", "信号名称", "信号定义", input, output, confirmed
FROM bak.signal_endpoints
WHERE signal_id IN (73450,70162,73451,73452,73453,70165,70168,70169,72955,72949,72950,72946,72945,72947,72948,72951,72952,72957,72963,72971,72979);

-- 2d. 从备份复制边
INSERT INTO signal_edges (id, signal_id, from_endpoint_id, to_endpoint_id, direction, source_info)
SELECT id, signal_id, from_endpoint_id, to_endpoint_id, direction, source_info
FROM bak.signal_edges
WHERE signal_id IN (73450,70162,73451,73452,73453,70165,70168,70169,72955,72949,72950,72946,72945,72947,72948,72951,72952,72957,72963,72971,72979);


-- ══════════════════════════════════════════════════════════════════════════
-- 第3步：恢复5条被导入重复拼接unique_id的信号
-- 72940: N901029-1+N901029-1+N901029-1 → N901029-1
-- 72941: N901029-2+N901029-2+N901029-2 → N901029-2
-- 72942: N901030-1+N901030-1+N901030-1 → N901030-1
-- 72943: N901030-2+N901030-2+N901030-2 → N901030-2
-- 72944: N901031+N901031+N901031       → N901031
-- 注：这5条没有pending审批，也不在第2步的21条中，单独处理
-- ══════════════════════════════════════════════════════════════════════════

UPDATE signals SET
  unique_id = (SELECT unique_id FROM bak.signals WHERE id = signals.id),
  import_status = (SELECT import_status FROM bak.signals WHERE id = signals.id),
  import_conflicts = (SELECT import_conflicts FROM bak.signals WHERE id = signals.id),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (72940, 72941, 72942, 72943, 72944);


-- ══════════════════════════════════════════════════════════════════════════
-- 第4步：恢复26条被导入合并删除的信号
-- 已确认：这26个signal ID在当前DB中不存在（无冲突）
-- 已确认：对应的52个endpoint ID在当前DB中不存在（无冲突）
-- ══════════════════════════════════════════════════════════════════════════

-- 4a. 复制信号记录
INSERT INTO signals (id, project_id, unique_id, 连接类型, 信号架次有效性, 推荐导线线规, 推荐导线线型, 独立电源代码, 敷设代码, 电磁兼容代码, 余度代码, 功能代码, 接地代码, 极性, 额定电压, 额定电流, 设备正常工作电压范围, 是否成品线, 成品线件号, 成品线线规, 成品线类型, 成品线长度, 成品线载流量, 成品线线路压降, 成品线标识, "成品线与机上线束对接方式", 成品线安装责任, 备注, status, created_at, updated_at, version, created_by, 信号ATA, import_conflicts, import_status, 线类型, 协议标识, signal_group)
SELECT id, project_id, unique_id, 连接类型, 信号架次有效性, 推荐导线线规, 推荐导线线型, 独立电源代码, 敷设代码, 电磁兼容代码, 余度代码, 功能代码, 接地代码, 极性, 额定电压, 额定电流, 设备正常工作电压范围, 是否成品线, 成品线件号, 成品线线规, 成品线类型, 成品线长度, 成品线载流量, 成品线线路压降, 成品线标识, "成品线与机上线束对接方式", 成品线安装责任, 备注, status, created_at, CURRENT_TIMESTAMP, version, created_by, 信号ATA, import_conflicts, import_status, 线类型, 协议标识, signal_group
FROM bak.signals
WHERE id IN (72954,72956,72958,72959,72960,72961,72962,72964,72965,72966,72967,72968,72969,72970,72972,72973,72974,72975,72976,72977,72978,72980,72981,72982,72983,72984);

-- 4b. 复制端点（52条）
INSERT INTO signal_endpoints (id, signal_id, device_id, pin_id, endpoint_index, "端接尺寸", "信号名称", "信号定义", input, output, confirmed)
SELECT id, signal_id, device_id, pin_id, endpoint_index, "端接尺寸", "信号名称", "信号定义", input, output, confirmed
FROM bak.signal_endpoints
WHERE signal_id IN (72954,72956,72958,72959,72960,72961,72962,72964,72965,72966,72967,72968,72969,72970,72972,72973,72974,72975,72976,72977,72978,72980,72981,72982,72983,72984);

-- 4c. 复制边（26条）
INSERT INTO signal_edges (id, signal_id, from_endpoint_id, to_endpoint_id, direction, source_info)
SELECT id, signal_id, from_endpoint_id, to_endpoint_id, direction, source_info
FROM bak.signal_edges
WHERE signal_id IN (72954,72956,72958,72959,72960,72961,72962,72964,72965,72966,72967,72968,72969,72970,72972,72973,72974,72975,72976,72977,72978,72980,72981,72982,72983,72984);


-- ══════════════════════════════════════════════════════════════════════════
-- 第5步：清理601082导入产生的change_logs
-- 仅删除changed_by=66(601082) AND reason='文件导入更新'的36条记录
-- ══════════════════════════════════════════════════════════════════════════

DELETE FROM change_logs
WHERE changed_by = 66 AND reason = '文件导入更新';


COMMIT;

DETACH bak;
