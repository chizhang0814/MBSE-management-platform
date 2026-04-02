import { Database } from '../database.js';

// ── 角色检查 ──────────────────────────────────────────────────────────────────

async function getUserPermissions(db: Database, username: string): Promise<any[]> {
  const user = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
  if (!user) return [];
  try { return JSON.parse(user.permissions || '[]'); } catch { return []; }
}

export async function isZontiRenyuan(db: Database, username: string, projectId: number): Promise<boolean> {
  const project = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!project) return false;
  const perms = await getUserPermissions(db, username);
  return perms.some((p: any) => p.project_name === project.name && p.project_role === '总体组');
}

/** 是否有审批权的总体组（can_approve === true） */
export async function isZontiApprover(db: Database, username: string, projectId: number): Promise<boolean> {
  const project = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!project) return false;
  const perms = await getUserPermissions(db, username);
  return perms.some((p: any) => p.project_name === project.name && p.project_role === '总体组' && p.can_approve === true);
}

export async function isEwisAdmin(db: Database, username: string, projectId: number): Promise<boolean> {
  const project = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!project) return false;
  const perms = await getUserPermissions(db, username);
  return perms.some((p: any) => p.project_name === project.name && p.project_role === 'EWIS管理员');
}

export async function isDeviceManager(db: Database, username: string, projectId: number): Promise<boolean> {
  const project = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!project) return false;
  const perms = await getUserPermissions(db, username);
  return perms.some((p: any) => p.project_name === project.name && p.project_role === '系统组');
}

/** 返回项目内某角色的所有用户名列表。
 *  总体组角色额外要求 can_approve === true，只有有审批权的才纳入审批流。
 */
export async function getProjectRoleMembers(db: Database, projectId: number, role: string): Promise<string[]> {
  const project = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!project) return [];
  const users = await db.query('SELECT username, permissions FROM users WHERE permissions IS NOT NULL AND permissions != ?', ['[]']);
  const result: string[] = [];
  for (const u of users) {
    try {
      const perms = JSON.parse(u.permissions || '[]');
      if (perms.some((p: any) => {
        if (p.project_name !== project.name || p.project_role !== role) return false;
        if (role === '总体组') return p.can_approve === true;
        return true;
      })) {
        result.push(u.username);
      }
    } catch {}
  }
  return result;
}

// ── 设备校验（审批通过后重跑，同步更新 validation_errors）────────────────────

export const SPECIAL_ERN_LIN = '8800G0000';

/** 检查 pin 是否属于待删除审批中的设备或连接器 */
export async function isPinFrozen(db: Database, pinId: number): Promise<string | null> {
  // 1. 检查连接器是否 Pending 删除
  const connDel = await db.get(
    `SELECT ar.id FROM approval_requests ar
     JOIN connectors c ON ar.entity_id = c.id
     JOIN pins p ON p.connector_id = c.id
     WHERE p.id = ? AND ar.entity_type = 'connector' AND ar.action_type = 'delete_connector' AND ar.status = 'pending'`,
    [pinId]
  );
  if (connDel) return '所属连接器待删除审批中，不可操作';

  // 2. 检查设备是否 Pending 删除
  const devDel = await db.get(
    `SELECT ar.id FROM approval_requests ar
     JOIN devices d ON ar.entity_id = d.id
     JOIN connectors c ON c.device_id = d.id
     JOIN pins p ON p.connector_id = c.id
     WHERE p.id = ? AND ar.entity_type = 'device' AND ar.action_type = 'delete_device' AND ar.status = 'pending'`,
    [pinId]
  );
  if (devDel) return '所属设备待删除审批中，不可操作';

  // 3. 检查 pin 本身是否正在修改/删除审批中
  const pinReq = await db.get(
    `SELECT ar.action_type FROM approval_requests ar
     WHERE ar.entity_type = 'pin' AND ar.entity_id = ? AND ar.status = 'pending'
     AND ar.action_type IN ('edit_pin', 'delete_pin')`,
    [pinId]
  );
  if (pinReq) return `该针孔正在${pinReq.action_type === 'edit_pin' ? '修改' : '删除'}审批中，不可操作`;

  // 4. 检查 pin 是否属于正在审批中的信号的端点
  const sigReq = await db.get(
    `SELECT ar.action_type, s.unique_id FROM approval_requests ar
     JOIN signals s ON ar.entity_id = s.id
     JOIN signal_endpoints se ON se.signal_id = s.id
     WHERE se.pin_id = ? AND ar.entity_type = 'signal' AND ar.status = 'pending'
     AND ar.action_type IN ('create_signal', 'edit_signal', 'delete_signal')
     LIMIT 1`,
    [pinId]
  );
  if (sigReq) return `关联信号 ${sigReq.unique_id || ''} 正在审批中，不可操作`;

  return null;
}

/**
 * 级联删除针孔：删除关联的信号端点/信号，记录日志。
 *
 * 这是删除单个 pin 的唯一推荐入口。pin_id 外键为 ON DELETE RESTRICT，
 * 直接 DELETE FROM pins 会在有 signal_endpoints 引用时报错。
 * 本函数先按逻辑清理关联端点（≤2端点删整条信号，>2端点仅移除该端点），
 * 再安全删除 pin。
 *
 * 例外：批量清空项目/设备场景（admin-only）会先批量删 signal_endpoints
 * 再删 devices CASCADE，不经过本函数，属于预期行为。
 */
export async function cascadeDeletePinShared(db: Database, pinId: number, userId: number, parentLog: string[]): Promise<void> {
  const pin = await db.get('SELECT * FROM pins WHERE id = ?', [pinId]);
  if (!pin) return;

  const eps = await db.query(
    `SELECT se.*, s.unique_id, s.id as signal_id,
            (SELECT COUNT(*) FROM signal_endpoints WHERE signal_id = se.signal_id) as ep_count
     FROM signal_endpoints se JOIN signals s ON se.signal_id = s.id
     WHERE se.pin_id = ?`,
    [pinId]
  );

  const processedSignals = new Set<number>();
  for (const ep of eps) {
    if (processedSignals.has(ep.signal_id)) continue;
    processedSignals.add(ep.signal_id);

    if (ep.ep_count <= 2) {
      const signal = await db.get('SELECT * FROM signals WHERE id = ?', [ep.signal_id]);
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
         VALUES ('signals', ?, ?, 'signals', ?, ?, ?, 'approved')`,
        [ep.signal_id, ep.signal_id, userId, JSON.stringify(signal), `删除信号（因针孔 ${pin['针孔号']} 被删除）`]
      );
      await db.run('DELETE FROM signal_endpoints WHERE signal_id = ?', [ep.signal_id]);
      await db.run('DELETE FROM signals WHERE id = ?', [ep.signal_id]);
      parentLog.push(`信号 ${ep.unique_id || ep.signal_id} 被整体删除`);
    } else {
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
         VALUES ('signals', ?, ?, 'signals', ?, ?, ?, 'approved')`,
        [ep.signal_id, ep.signal_id, userId, JSON.stringify(ep), `删除端点（因针孔 ${pin['针孔号']} 被删除）`]
      );
      await db.run('DELETE FROM signal_endpoints WHERE signal_id = ? AND pin_id = ?', [ep.signal_id, pinId]);
      parentLog.push(`信号 ${ep.unique_id || ep.signal_id} 移除了针孔 ${pin['针孔号']} 的端点`);
    }
  }

  await db.run(
    `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
     VALUES ('pins', ?, ?, 'pins', ?, ?, '删除针孔', 'approved')`,
    [pinId, pinId, userId, JSON.stringify(pin)]
  );
  await db.run('DELETE FROM pins WHERE id = ?', [pinId]);
}

async function revalidateDevice(db: Database, deviceId: number, projectId: number): Promise<void> {
  const device = await db.get('SELECT * FROM devices WHERE id = ?', [deviceId]);
  if (!device) return;

  // 固有ERN设备不做校验
  if (String(device['设备LIN号（DOORS）'] || '').trim() === SPECIAL_ERN_LIN) return;

  const veErrors: string[] = [];

  const adlMatch = await db.get(
    `SELECT 设备布置区域 FROM aircraft_device_list WHERE project_id = ? AND 电设备编号 = ? AND 设备编号_DOORS = ? AND LIN号_DOORS = ? AND object_text = ?`,
    [projectId,
     (device['设备编号'] || '').trim(),
     (device['设备编号（DOORS）'] || '').trim(),
     (device['设备LIN号（DOORS）'] || '').trim(),
     (device['设备中文名称'] || '').trim()]
  );
  if (!adlMatch) {
    veErrors.push('设备编号（DOORS）', '设备LIN号（DOORS）', '设备编号', '设备中文名称', '设备安装位置');
  } else {
    if ((adlMatch['设备布置区域'] || '').trim() !== (device['设备安装位置'] || '').trim()) {
      veErrors.push('设备安装位置');
    }
  }

  if (!['A', 'B', 'C', 'D', 'E', '其他'].includes((device['设备DAL'] || '').trim())) {
    veErrors.push('设备DAL');
  }

  const ataVal = (device['设备部件所属系统（4位ATA）'] || '').trim();
  if (!/^\d{2}-\d{2}$/.test(ataVal) && ataVal !== '其他') {
    veErrors.push('设备部件所属系统（4位ATA）');
  }

  const isMetalShell = (device['设备壳体是否金属'] || '').trim();
  if (!['是', '否'].includes(isMetalShell)) veErrors.push('设备壳体是否金属');

  const shellTreated = (device['金属壳体表面是否经过特殊处理而不易导电'] || '').trim();
  if (isMetalShell === '是' && !['是', '否'].includes(shellTreated)) {
    veErrors.push('金属壳体表面是否经过特殊处理而不易导电');
  } else if (isMetalShell === '否' && shellTreated !== 'N/A') {
    veErrors.push('金属壳体表面是否经过特殊处理而不易导电');
  }

  if (!['线搭接', '面搭接', '无'].includes((device['设备壳体接地方式'] || '').trim())) {
    veErrors.push('设备壳体接地方式');
  }

  if (!['是', '否'].includes((device['壳体接地是否故障电流路径'] || '').trim())) {
    veErrors.push('壳体接地是否故障电流路径');
  }

  await db.run(`UPDATE devices SET validation_errors = ? WHERE id = ?`, [JSON.stringify(veErrors), deviceId]);
}

/**
 * 当设备 LIN 号变更时，自动重命名该设备下所有连接器的前缀。
 * 返回被重命名的连接器列表 [{ id, old, new }]。
 */
export async function renameConnectorsForLINChange(
  db: Database, deviceId: number, oldLIN: string, newLIN: string
): Promise<Array<{ id: number; old: string; new: string }>> {
  if (!oldLIN || !newLIN || oldLIN === newLIN) return [];
  const connectors: any[] = await db.query(
    `SELECT id, "设备端元器件编号" FROM connectors WHERE device_id = ?`, [deviceId]
  );
  const renamed: Array<{ id: number; old: string; new: string }> = [];
  for (const c of connectors) {
    const compId = c['设备端元器件编号'] || '';
    if (compId.startsWith(oldLIN + '-')) {
      const newCompId = newLIN + compId.slice(oldLIN.length);
      await db.run(
        `UPDATE connectors SET "设备端元器件编号" = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newCompId, c.id]
      );
      renamed.push({ id: c.id, old: compId, new: newCompId });
    }
  }
  return renamed;
}

/** 获取实体描述文本，用于通知消息 */
export async function getEntityDescription(db: Database, entityType: string, entityId: number): Promise<string> {
  if (entityType === 'device') {
    const d = await db.get('SELECT "设备编号", "设备中文名称" FROM devices WHERE id = ?', [entityId]);
    return d ? `设备「${d['设备编号']}${d['设备中文名称'] ? '（' + d['设备中文名称'] + '）' : ''}」` : `设备#${entityId}`;
  }
  if (entityType === 'connector') {
    const c = await db.get('SELECT c."设备端元器件编号", d."设备编号" FROM connectors c JOIN devices d ON c.device_id = d.id WHERE c.id = ?', [entityId]);
    return c ? `连接器「${c['设备端元器件编号']}」（设备 ${c['设备编号']}）` : `连接器#${entityId}`;
  }
  if (entityType === 'pin') {
    const p = await db.get('SELECT p."针孔号", c."设备端元器件编号", d."设备编号" FROM pins p JOIN connectors c ON p.connector_id = c.id JOIN devices d ON c.device_id = d.id WHERE p.id = ?', [entityId]);
    return p ? `针孔「${p['设备端元器件编号']}-${p['针孔号']}」（设备 ${p['设备编号']}）` : `针孔#${entityId}`;
  }
  if (entityType === 'signal') {
    const s = await db.get('SELECT unique_id FROM signals WHERE id = ?', [entityId]);
    return s ? `信号「${s.unique_id || '#' + entityId}」` : `信号#${entityId}`;
  }
  return `${entityType}#${entityId}`;
}

// ── 审批请求 ──────────────────────────────────────────────────────────────────

export interface ApprovalItemSpec {
  recipient_username: string;
  item_type: 'approval' | 'completion';
}

export interface SubmitChangeRequestParams {
  projectId: number;
  requesterId: number;
  requesterUsername: string;
  actionType: string;
  entityType: string;
  entityId: number;
  deviceId?: number;
  oldPayload: any;
  newPayload: any;
  items: ApprovalItemSpec[];
}

/**
 * 去重：同一人同时有 completion 和 approval → 保留 completion
 */
function deduplicateItems(items: ApprovalItemSpec[]): ApprovalItemSpec[] {
  const map = new Map<string, 'approval' | 'completion'>();
  for (const item of items) {
    const existing = map.get(item.recipient_username);
    if (!existing || item.item_type === 'completion') {
      map.set(item.recipient_username, item.item_type);
    }
  }
  return Array.from(map.entries()).map(([u, t]) => ({ recipient_username: u, item_type: t }));
}

/**
 * 提交变更审批请求：创建 approval_request + approval_items + 发送通知
 * 返回 approval_request.id
 */
export async function submitChangeRequest(db: Database, params: SubmitChangeRequestParams): Promise<number> {
  const { projectId, requesterId, requesterUsername, actionType, entityType, entityId, deviceId, oldPayload, newPayload, items } = params;

  const dedupedItems = deduplicateItems(items);
  const hasCompletion = dedupedItems.some(i => i.item_type === 'completion');
  const currentPhase = hasCompletion ? 'completion' : 'approval';

  const result = await db.run(
    `INSERT INTO approval_requests (project_id, requester_id, requester_username, action_type, entity_type, entity_id, device_id, old_payload, payload, status, current_phase)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [projectId, requesterId, requesterUsername, actionType, entityType, entityId, deviceId ?? null,
     JSON.stringify(oldPayload), JSON.stringify(newPayload), currentPhase]
  );
  const approvalRequestId = result.lastID;

  for (const item of dedupedItems) {
    await db.run(
      `INSERT INTO approval_items (approval_request_id, recipient_username, item_type) VALUES (?, ?, ?)`,
      [approvalRequestId, item.recipient_username, item.item_type]
    );
  }

  // 发通知：仅向当前激活阶段的接收人发通知
  const notifyItems = dedupedItems.filter(i => i.item_type === (hasCompletion ? 'completion' : 'approval'));
  const actionLabels: Record<string, string> = {
    create_device: '新建设备', edit_device: '修改设备', delete_device: '删除设备',
    create_connector: '新建连接器', edit_connector: '修改连接器', delete_connector: '删除连接器',
    create_pin: '新建针孔', edit_pin: '修改针孔', delete_pin: '删除针孔',
    create_signal: '新建信号', edit_signal: '修改信号', delete_signal: '删除信号',
    request_device_management: '申请设备管理',
  };
  const label = actionLabels[actionType] || actionType;

  // 查询项目名称和实体描述
  const project = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  const projectName = project?.name || `项目#${projectId}`;
  const entityDesc = await getEntityDescription(db, entityType, entityId);

  for (const item of notifyItems) {
    const type = item.item_type === 'completion' ? 'completion_request' : 'approval_request';
    const title = item.item_type === 'completion'
      ? `待审批：[${projectName}] ${label}`
      : `待审批：[${projectName}] ${label}`;
    const message = item.item_type === 'completion'
      ? `用户 ${requesterUsername} 在项目「${projectName}」中提交了${entityDesc}的「${label}」请求，需要您审批。`
      : `用户 ${requesterUsername} 在项目「${projectName}」中提交了${entityDesc}的「${label}」请求，请进行审批。`;
    await db.run(
      `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, ?, ?, ?)`,
      [item.recipient_username, type, title, message]
    );
  }

  return approvalRequestId;
}

/**
 * 检查并推进审批阶段：
 * - completion阶段全部done → 转为approval阶段，向审批人发通知
 * - approval阶段全部done → 将实体状态改为Active，approval_request改为approved
 */
export async function checkAndAdvancePhase(db: Database, approvalRequestId: number): Promise<void> {
  const req = await db.get('SELECT * FROM approval_requests WHERE id = ?', [approvalRequestId]);
  if (!req || req.status !== 'pending') return;

  if (req.current_phase === 'completion') {
    const pendingCompletion = await db.get(
      `SELECT COUNT(*) as cnt FROM approval_items WHERE approval_request_id = ? AND item_type = 'completion' AND status = 'pending'`,
      [approvalRequestId]
    );
    if (pendingCompletion?.cnt > 0) return; // 还有未完成的completion item

    // 所有completion完成 → 转入approval阶段
    await db.run(`UPDATE approval_requests SET current_phase = 'approval' WHERE id = ?`, [approvalRequestId]);

    // 向approval item接收人发通知
    const approvalItems = await db.query(
      `SELECT recipient_username FROM approval_items WHERE approval_request_id = ? AND item_type = 'approval'`,
      [approvalRequestId]
    );
    const actionLabels: Record<string, string> = {
      create_device: '新建设备', edit_device: '修改设备', delete_device: '删除设备',
      create_connector: '新建连接器', edit_connector: '修改连接器', delete_connector: '删除连接器',
      create_pin: '新建针孔', edit_pin: '修改针孔', delete_pin: '删除针孔',
      create_signal: '新建信号', edit_signal: '修改信号', delete_signal: '删除信号',
      request_device_management: '申请设备管理',
    };
    const label = actionLabels[req.action_type] || req.action_type;
    const proj = await db.get('SELECT name FROM projects WHERE id = ?', [req.project_id]);
    const projName = proj?.name || `项目#${req.project_id}`;
    const entDesc = await getEntityDescription(db, req.entity_type, req.entity_id);
    for (const item of approvalItems) {
      await db.run(
        `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'approval_request', ?, ?)`,
        [item.recipient_username, `待审批：[${projName}] ${label}`, `项目「${projName}」中${entDesc}的「${label}」请求已完成阶段一审批，请进行审批。`]
      );
    }
    // 继续检查approval阶段
  }

  // 检查approval阶段：一人通过即生效
  const doneApproval = await db.get(
    `SELECT COUNT(*) as cnt FROM approval_items WHERE approval_request_id = ? AND item_type = 'approval' AND status = 'done' AND rejection_reason IS NULL`,
    [approvalRequestId]
  );
  if ((doneApproval?.cnt ?? 0) === 0) return; // 还没有人通过

  // 取消其他未处理的审批项
  await db.run(
    `UPDATE approval_items SET status = 'cancelled' WHERE approval_request_id = ? AND item_type = 'approval' AND status = 'pending'`,
    [approvalRequestId]
  );

  // 一人通过 → 将实体改为Active
  await db.run(`UPDATE approval_requests SET status = 'approved' WHERE id = ?`, [approvalRequestId]);

  if (req.action_type === 'request_device_management') {
    // 管理权申请：更新负责人，状态恢复到申请前的原始状态
    const originalStatus = (() => { try { return JSON.parse(req.old_payload)?.status || 'normal'; } catch { return 'normal'; } })();
    await db.run(`UPDATE devices SET "设备负责人" = ?, status = ? WHERE id = ?`, [req.requester_username, originalStatus, req.entity_id]);
  } else {
    const entityTable = req.entity_type === 'device' ? 'devices'
      : req.entity_type === 'connector' ? 'connectors'
      : req.entity_type === 'pin' ? 'pins'
      : req.entity_type === 'signal' ? 'signals'
      : null;

    if (entityTable && req.entity_id) {
      if (req.action_type === 'delete_pin') {
        const log: string[] = [];
        await cascadeDeletePinShared(db, req.entity_id, req.requester_id, log);
      } else if (req.action_type === 'delete_connector') {
        // 连接器级联删除：先删所有针孔（含信号端点处理），再删连接器
        const pins = await db.query('SELECT id FROM pins WHERE connector_id = ?', [req.entity_id]);
        const connLog: string[] = [];
        for (const p of pins) { await cascadeDeletePinShared(db, p.id, req.requester_id, connLog); }
        await db.run('DELETE FROM connectors WHERE id = ?', [req.entity_id]);
      } else if (req.action_type === 'delete_device') {
        // 设备级联删除：先删所有连接器（含针孔和信号端点），再删设备
        const connectors = await db.query('SELECT id FROM connectors WHERE device_id = ?', [req.entity_id]);
        for (const c of connectors) {
          const pins = await db.query('SELECT id FROM pins WHERE connector_id = ?', [c.id]);
          const cLog: string[] = [];
          for (const p of pins) { await cascadeDeletePinShared(db, p.id, req.requester_id, cLog); }
          await db.run('DELETE FROM connectors WHERE id = ?', [c.id]);
        }
        await db.run('DELETE FROM devices WHERE id = ?', [req.entity_id]);
      } else if (req.action_type.startsWith('delete_')) {
        await db.run(`DELETE FROM ${entityTable} WHERE id = ?`, [req.entity_id]);
      } else if (req.action_type === 'edit_pin') {
        // 针孔编辑：将 payload 新值应用到针孔
        const newFields = (() => { try { return JSON.parse(req.payload); } catch { return {}; } })();
        if (Object.keys(newFields).length > 0) {
          const setClauses = Object.keys(newFields).map(k => `"${k}" = ?`).join(', ');
          await db.run(
            `UPDATE pins SET ${setClauses}, status = 'normal', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [...Object.values(newFields), req.entity_id]
          );
        } else {
          await db.run(`UPDATE pins SET status = 'normal' WHERE id = ?`, [req.entity_id]);
        }
      } else if (req.action_type === 'edit_signal') {
        // 信号编辑：将 payload 新值应用到信号
        const newFields = (() => { try { return JSON.parse(req.payload); } catch { return {}; } })();
        if (Object.keys(newFields).length > 0) {
          const setClauses = Object.keys(newFields).map(k => `"${k}" = ?`).join(', ');
          await db.run(
            `UPDATE signals SET ${setClauses}, status = 'Active', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [...Object.values(newFields), req.entity_id]
          );
        } else {
          await db.run(`UPDATE signals SET status = 'Active' WHERE id = ?`, [req.entity_id]);
        }
      } else if (req.action_type === 'edit_device' || req.action_type === 'edit_connector') {
        // 编辑操作：将 payload 中的新值应用到实体
        const newFields = (() => { try { return JSON.parse(req.payload); } catch { return {}; } })();
        const oldFields = (() => { try { return JSON.parse(req.old_payload); } catch { return {}; } })();

        // 提取连接器重命名信息（非DB列，审批通过时执行）
        const connRenames = newFields._connector_renames;
        delete newFields._connector_renames;

        if (Object.keys(newFields).length > 0) {
          const setClauses = Object.keys(newFields).map(k => `"${k}" = ?`).join(', ');
          await db.run(
            `UPDATE ${entityTable} SET ${setClauses}, status = 'normal', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [...Object.values(newFields), req.entity_id]
          );
        } else {
          await db.run(`UPDATE ${entityTable} SET status = 'normal' WHERE id = ?`, [req.entity_id]);
        }
        // 设备审批通过后重新校验 + LIN号变更连接器重命名
        if (req.entity_type === 'device') {
          // LIN 号变更 → 执行连接器前缀重命名
          const oldLIN = String(oldFields['设备LIN号（DOORS）'] || '').trim();
          const newLIN = String(newFields['设备LIN号（DOORS）'] ?? '').trim();
          if (oldLIN && newLIN && oldLIN !== newLIN) {
            const renames = await renameConnectorsForLINChange(db, req.entity_id, oldLIN, newLIN);
            if (renames.length > 0) {
              await db.run(
                `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
                 VALUES ('devices', ?, ?, 'devices', ?, ?, ?, 'approved')`,
                [req.entity_id, req.entity_id, req.requester_id,
                 JSON.stringify({ connector_renames: renames }),
                 `审批通过：设备LIN号变更(${oldLIN}→${newLIN})，自动重命名 ${renames.length} 个连接器前缀`]
              );
            }
          }
          await revalidateDevice(db, req.entity_id, req.project_id);
          // 设备负责人变更通知
          // newFields 是用户提交的修改字段，oldFields 是提交前的完整设备对象
          const newOwner = newFields['设备负责人'] || null;
          // 从数据库重新读取当前设备负责人（因为审批通过时已经 apply 了新值，所以需要用 oldFields）
          const oldOwner = oldFields['设备负责人'] || null;
          if (newOwner && oldOwner !== newOwner) {
            const deviceRow = await db.get('SELECT "设备编号", "设备中文名称" FROM devices WHERE id = ?', [req.entity_id]);
            const devLabel = deviceRow?.['设备编号'] || `设备#${req.entity_id}`;
            const devName = deviceRow?.['设备中文名称'] ? `（${deviceRow['设备中文名称']}）` : '';
            const proj = await db.get('SELECT name FROM projects WHERE id = ?', [req.project_id]);
            const projName = proj?.name || '';
            if (oldOwner) {
              await db.run(
                `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'device_owner_changed', ?, ?)`,
                [oldOwner, `[${projName}] 设备负责人变更`,
                 `设备「${devLabel}」${devName}不再由您负责，已被 ${req.requester_username} 变更为 ${newOwner} 负责。`]
              );
            }
            if (newOwner !== req.requester_username) {
              await db.run(
                `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'device_owner_changed', ?, ?)`,
                [newOwner, `[${projName}] 设备负责人变更`,
                 `设备「${devLabel}」${devName}已被 ${req.requester_username} 变更为由您负责${oldOwner ? `（原负责人：${oldOwner}）` : ''}。`]
              );
            }
          }
        }
      } else {
        // 创建操作：将实体状态改为Active/normal
        const activeStatus = req.entity_type === 'signal' ? 'Active' : 'normal';
        await db.run(`UPDATE ${entityTable} SET status = ? WHERE id = ?`, [activeStatus, req.entity_id]);
        if (req.entity_type === 'device') {
          await revalidateDevice(db, req.entity_id, req.project_id);
        }
      }
    }
  }

  // 写change_log
  await db.run(
    `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, '审批通过', 'approved')`,
    [req.entity_type + 's', req.entity_id, req.entity_id, req.entity_type + 's',
     req.requester_id, req.old_payload, req.payload]
  );

  // 向请求人发审批通过通知
  const actionLabels2: Record<string, string> = {
    create_device: '新建设备', edit_device: '修改设备', delete_device: '删除设备',
    create_connector: '新建连接器', edit_connector: '修改连接器', delete_connector: '删除连接器',
    create_pin: '新建针孔', edit_pin: '修改针孔', delete_pin: '删除针孔',
    create_signal: '新建信号', edit_signal: '修改信号', delete_signal: '删除信号',
    request_device_management: '申请设备管理',
  };
  const label2 = actionLabels2[req.action_type] || req.action_type;
  const entDesc2 = await getEntityDescription(db, req.entity_type, req.entity_id);

  // 删除操作：从 payload 中读取级联影响信息
  let cascadeInfo = '';
  if (req.action_type.startsWith('delete_')) {
    try {
      const payload = JSON.parse(req.payload || '{}');
      const impact = payload._deleteImpact;
      if (impact) {
        const parts: string[] = [];
        if (impact.connectors?.length > 0) parts.push(`${impact.connectors.length} 个连接器`);
        if (impact.pins?.length > 0) parts.push(`${impact.pins.length} 个针孔`);
        if (impact.signalsDeleted?.length > 0) parts.push(`整体删除 ${impact.signalsDeleted.length} 条信号（${impact.signalsDeleted.slice(0, 3).map((s: any) => s.unique_id || '#' + s.id).join('、')}${impact.signalsDeleted.length > 3 ? '...' : ''}）`);
        if (impact.signalsModified?.length > 0) parts.push(`${impact.signalsModified.length} 条信号移除端点`);
        if (parts.length > 0) cascadeInfo = `\n级联影响：${parts.join('，')}`;
      }
    } catch {}
  }

  await db.run(
    `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'approval_approved', ?, ?)`,
    [req.requester_username, `审批通过：${label2} — ${entDesc2}`, `您提交的${entDesc2}的「${label2}」请求已审批通过，记录已生效。${cascadeInfo}`]
  );
}
