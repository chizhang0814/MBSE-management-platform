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
  return perms.some((p: any) => p.project_name === project.name && p.project_role === '总体人员');
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
  return perms.some((p: any) => p.project_name === project.name && p.project_role === '设备管理员');
}

/** 返回项目内某角色的所有用户名列表 */
export async function getProjectRoleMembers(db: Database, projectId: number, role: string): Promise<string[]> {
  const project = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!project) return [];
  const users = await db.query('SELECT username, permissions FROM users WHERE permissions IS NOT NULL AND permissions != ?', ['[]']);
  const result: string[] = [];
  for (const u of users) {
    try {
      const perms = JSON.parse(u.permissions || '[]');
      if (perms.some((p: any) => p.project_name === project.name && p.project_role === role)) {
        result.push(u.username);
      }
    } catch {}
  }
  return result;
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

  for (const item of notifyItems) {
    const type = item.item_type === 'completion' ? 'completion_request' : 'approval_request';
    const title = item.item_type === 'completion'
      ? `待完善：${label}`
      : `待审批：${label}`;
    const message = item.item_type === 'completion'
      ? `用户 ${requesterUsername} 提交了「${label}」请求，需要您补全相关字段。`
      : `用户 ${requesterUsername} 提交了「${label}」请求，请进行审批。`;
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
    for (const item of approvalItems) {
      await db.run(
        `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'approval_request', ?, ?)`,
        [item.recipient_username, `待审批：${label}`, `完善阶段已完成，请对「${label}」进行审批。`]
      );
    }
    // 继续检查approval阶段
  }

  // 检查approval阶段
  const pendingApproval = await db.get(
    `SELECT COUNT(*) as cnt FROM approval_items WHERE approval_request_id = ? AND item_type = 'approval' AND status = 'pending'`,
    [approvalRequestId]
  );
  if ((pendingApproval?.cnt ?? 1) > 0) return;

  // 所有approval通过 → 将实体改为Active
  await db.run(`UPDATE approval_requests SET status = 'approved' WHERE id = ?`, [approvalRequestId]);

  const entityTable = req.entity_type === 'device' ? 'devices'
    : req.entity_type === 'connector' ? 'connectors'
    : req.entity_type === 'pin' ? 'pins'
    : req.entity_type === 'signal' ? 'signals'
    : null;

  if (entityTable && req.entity_id) {
    if (req.action_type.startsWith('delete_')) {
      // 删除操作：执行实际删除
      await db.run(`DELETE FROM ${entityTable} WHERE id = ?`, [req.entity_id]);
    } else {
      // 创建/编辑操作：将实体状态改为Active
      const activeStatus = req.entity_type === 'signal' ? 'Active' : 'normal';
      await db.run(`UPDATE ${entityTable} SET status = ? WHERE id = ?`, [activeStatus, req.entity_id]);
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
  await db.run(
    `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'approval_approved', ?, ?)`,
    [req.requester_username, `审批通过：${label2}`, `您提交的「${label2}」请求已获所有审批人通过，记录已生效。`]
  );
}
