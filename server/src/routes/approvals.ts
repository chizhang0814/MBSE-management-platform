import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { checkAndAdvancePhase, getEntityDescription } from '../shared/approval-helper.js';

export function approvalRoutes(db: Database) {
  const router = express.Router();

  // ── GET /api/approvals/by-entity ──────────────────────────────────────────
  // 返回某实体当前pending的approval_request及所有items（含当前用户的pending item）
  router.get('/by-entity', authenticate, async (req: AuthRequest, res) => {
    try {
      const entityType = req.query.entity_type as string;
      const entityId = parseInt(req.query.entity_id as string);
      if (!entityType || isNaN(entityId)) {
        return res.status(400).json({ error: '缺少 entity_type 或 entity_id' });
      }

      const request = await db.get(
        `SELECT ar.*, u.display_name as requester_display_name, p.name as project_name
         FROM approval_requests ar
         LEFT JOIN users u ON ar.requester_id = u.id
         LEFT JOIN projects p ON ar.project_id = p.id
         WHERE ar.entity_type = ? AND ar.entity_id = ? AND ar.status = 'pending'
         ORDER BY ar.created_at DESC LIMIT 1`,
        [entityType, entityId]
      );

      if (!request) return res.json({ request: null, items: [], my_pending_item: null });

      const items = await db.query(
        `SELECT * FROM approval_items WHERE approval_request_id = ? ORDER BY item_type DESC, created_at ASC`,
        [request.id]
      );

      const myPendingItem = items.find(
        (i: any) => i.recipient_username === req.user!.username && i.status === 'pending'
      ) || null;

      res.json({ request, items, my_pending_item: myPendingItem });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取审批信息失败' });
    }
  });

  // ── GET /api/approvals/history ─────────────────────────────────────────
  // 返回某实体所有审批请求（含已完成/已拒绝）及其items
  router.get('/history', authenticate, async (req: AuthRequest, res) => {
    try {
      const entityType = req.query.entity_type as string;
      const entityId = parseInt(req.query.entity_id as string);
      if (!entityType || isNaN(entityId)) {
        return res.status(400).json({ error: '缺少 entity_type 或 entity_id' });
      }

      const requests = await db.query(
        `SELECT ar.*, u.display_name as requester_display_name
         FROM approval_requests ar
         LEFT JOIN users u ON ar.requester_id = u.id
         WHERE ar.entity_type = ? AND ar.entity_id = ?
         ORDER BY ar.created_at DESC`,
        [entityType, entityId]
      );

      const result = await Promise.all(requests.map(async (r: any) => {
        const items = await db.query(
          `SELECT ai.*, u.display_name as recipient_display_name
           FROM approval_items ai
           LEFT JOIN users u ON ai.recipient_username = u.username
           WHERE ai.approval_request_id = ?
           ORDER BY ai.item_type DESC, ai.created_at ASC`,
          [r.id]
        );
        return { ...r, items };
      }));

      res.json({ requests: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取审批历史失败' });
    }
  });

  // ── POST /api/approvals/:id/complete ─────────────────────────────────────
  // 完善请求：设备负责人填写缺失字段
  router.post('/:id/complete', authenticate, async (req: AuthRequest, res) => {
    try {
      const requestId = parseInt(req.params.id);
      const { updated_fields } = req.body;
      if (!updated_fields || typeof updated_fields !== 'object') {
        return res.status(400).json({ error: '缺少 updated_fields' });
      }

      const approvalReq = await db.get('SELECT * FROM approval_requests WHERE id = ?', [requestId]);
      if (!approvalReq) return res.status(404).json({ error: '审批请求不存在' });
      if (approvalReq.status !== 'pending') return res.status(400).json({ error: '该审批请求已结束' });
      if (approvalReq.current_phase !== 'completion') {
        return res.status(400).json({ error: '当前不在完善阶段' });
      }

      const myItem = await db.get(
        `SELECT * FROM approval_items WHERE approval_request_id = ? AND recipient_username = ? AND item_type = 'completion' AND status = 'pending'`,
        [requestId, req.user!.username]
      );
      if (!myItem) return res.status(403).json({ error: '您没有待完善的请求' });

      // 将updated_fields写入对应实体
      const entityTable = approvalReq.entity_type === 'device' ? 'devices'
        : approvalReq.entity_type === 'signal' ? 'signals'
        : approvalReq.entity_type === 'connector' ? 'connectors' : null;

      if (entityTable && approvalReq.entity_id && Object.keys(updated_fields).length > 0) {
        const setClauses = Object.keys(updated_fields).map((k: string) => `"${k}" = ?`).join(', ');
        await db.run(
          `UPDATE ${entityTable} SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [...Object.values(updated_fields), approvalReq.entity_id]
        );
      }

      // 标记item为done
      await db.run(
        `UPDATE approval_items SET status = 'done', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [myItem.id]
      );

      // 写change_log
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')`,
        [approvalReq.entity_type + 's', approvalReq.entity_id, approvalReq.entity_id,
         approvalReq.entity_type + 's', req.user!.id, JSON.stringify(updated_fields),
         `${req.user!.username} 完善字段`]
      );

      await checkAndAdvancePhase(db, requestId);

      res.json({ success: true, message: '完善提交成功' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '完善提交失败' });
    }
  });

  // ── POST /api/approvals/:id/approve ──────────────────────────────────────
  // 审批通过（可选：携带edited_payload表示编辑并通过）
  router.post('/:id/approve', authenticate, async (req: AuthRequest, res) => {
    try {
      const requestId = parseInt(req.params.id);
      const { edited_payload } = req.body;

      const approvalReq = await db.get('SELECT * FROM approval_requests WHERE id = ?', [requestId]);
      if (!approvalReq) return res.status(404).json({ error: '审批请求不存在' });
      if (approvalReq.status !== 'pending') return res.status(400).json({ error: '该审批请求已结束' });
      if (approvalReq.current_phase !== 'approval') {
        return res.status(400).json({ error: '当前不在审批阶段，请等待完善阶段完成' });
      }

      const myItem = await db.get(
        `SELECT * FROM approval_items WHERE approval_request_id = ? AND recipient_username = ? AND item_type = 'approval' AND status = 'pending'`,
        [requestId, req.user!.username]
      );
      if (!myItem) return res.status(403).json({ error: '您没有待审批的请求' });

      // 若携带编辑内容，先更新实体
      if (edited_payload && typeof edited_payload === 'object' && Object.keys(edited_payload).length > 0) {
        const entityTable = approvalReq.entity_type === 'device' ? 'devices'
          : approvalReq.entity_type === 'signal' ? 'signals'
          : approvalReq.entity_type === 'connector' ? 'connectors'
          : approvalReq.entity_type === 'pin' ? 'pins' : null;

        if (entityTable && approvalReq.entity_id) {
          const setClauses = Object.keys(edited_payload).map((k: string) => `"${k}" = ?`).join(', ');
          await db.run(
            `UPDATE ${entityTable} SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [...Object.values(edited_payload), approvalReq.entity_id]
          );
        }
      }

      await db.run(
        `UPDATE approval_items SET status = 'done', responded_at = CURRENT_TIMESTAMP, edited_payload = ? WHERE id = ?`,
        [edited_payload ? JSON.stringify(edited_payload) : null, myItem.id]
      );

      // 记录本次审批通过的change_log
      const actionLabels: Record<string, string> = {
        create_device: '新建设备', edit_device: '修改设备', delete_device: '删除设备',
        create_connector: '新建连接器', edit_connector: '修改连接器', delete_connector: '删除连接器',
        create_pin: '新建针孔', edit_pin: '修改针孔', delete_pin: '删除针孔',
        create_signal: '新建信号', edit_signal: '修改信号', delete_signal: '删除信号',
        request_device_management: '申请设备管理',
      };
      const label = actionLabels[approvalReq.action_type] || approvalReq.action_type;
      const hasEdits = edited_payload && typeof edited_payload === 'object' && Object.keys(edited_payload).length > 0;
      const reasonText = hasEdits
        ? `${req.user!.username} 编辑并审批通过「${label}」`
        : `${req.user!.username} 审批通过「${label}」`;
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')`,
        [approvalReq.entity_type + 's', approvalReq.entity_id, approvalReq.entity_id,
         approvalReq.entity_type + 's', req.user!.id,
         hasEdits ? JSON.stringify(edited_payload) : null, reasonText]
      );

      await checkAndAdvancePhase(db, requestId);

      res.json({ success: true, message: '审批通过' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '审批失败' });
    }
  });

  // ── POST /api/approvals/:id/reject ───────────────────────────────────────
  // 拒绝审批（必须填写理由）
  router.post('/:id/reject', authenticate, async (req: AuthRequest, res) => {
    try {
      const requestId = parseInt(req.params.id);
      const { reason } = req.body;
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: '拒绝理由不能为空' });
      }

      const approvalReq = await db.get('SELECT * FROM approval_requests WHERE id = ?', [requestId]);
      if (!approvalReq) return res.status(404).json({ error: '审批请求不存在' });
      if (approvalReq.status !== 'pending') return res.status(400).json({ error: '该审批请求已结束' });
      if (approvalReq.current_phase !== 'approval') {
        return res.status(400).json({ error: '当前不在审批阶段' });
      }

      const myItem = await db.get(
        `SELECT * FROM approval_items WHERE approval_request_id = ? AND recipient_username = ? AND item_type = 'approval' AND status = 'pending'`,
        [requestId, req.user!.username]
      );
      if (!myItem) return res.status(403).json({ error: '您没有待审批的请求' });

      // 查询尚未审批的人（用于change_log记录）
      const pendingOthers = await db.query(
        `SELECT recipient_username FROM approval_items WHERE approval_request_id = ? AND status = 'pending' AND id != ?`,
        [requestId, myItem.id]
      );
      const pendingNames = pendingOthers.map((i: any) => i.recipient_username);

      await db.run(
        `UPDATE approval_items SET status = 'done', rejection_reason = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [reason.trim(), myItem.id]
      );
      await db.run(
        `UPDATE approval_items SET status = 'cancelled' WHERE approval_request_id = ? AND status = 'pending'`,
        [requestId]
      );
      await db.run(
        `UPDATE approval_requests SET status = 'rejected', rejected_by_username = ?, rejected_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [req.user!.username, requestId]
      );

      // 将实体状态回退
      const entityTable = approvalReq.entity_type === 'device' ? 'devices'
        : approvalReq.entity_type === 'connector' ? 'connectors'
        : approvalReq.entity_type === 'pin' ? 'pins'
        : approvalReq.entity_type === 'signal' ? 'signals' : null;

      if (entityTable && approvalReq.entity_id) {
        if (approvalReq.action_type === 'request_device_management') {
          // 管理权申请被拒绝：恢复申请前的原始状态
          const originalStatus = (() => { try { return JSON.parse(approvalReq.old_payload)?.status || 'normal'; } catch { return 'normal'; } })();
          await db.run(`UPDATE devices SET status = ? WHERE id = ?`, [originalStatus, approvalReq.entity_id]);
        } else if (approvalReq.action_type.startsWith('delete_')) {
          // 删除操作被拒绝：恢复为正常状态
          const restoreStatus = approvalReq.entity_type === 'signal' ? 'Active' : 'normal';
          await db.run(`UPDATE ${entityTable} SET status = ? WHERE id = ?`, [restoreStatus, approvalReq.entity_id]);
        } else {
          // 编辑操作被拒绝：恢复到提交前的原始状态
          const originalStatus = (() => { try { return JSON.parse(approvalReq.old_payload)?.status || 'Draft'; } catch { return 'Draft'; } })();
          await db.run(`UPDATE ${entityTable} SET status = ? WHERE id = ?`, [originalStatus, approvalReq.entity_id]);
        }
      }

      // 写change_log
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, 'rejected')`,
        [approvalReq.entity_type + 's', approvalReq.entity_id, approvalReq.entity_id,
         approvalReq.entity_type + 's', req.user!.id,
         `审批被拒绝 by ${req.user!.username}。理由：${reason.trim()}。未审批人：${pendingNames.join('、') || '无'}`]
      );

      // 向请求人发通知
      const actionLabels: Record<string, string> = {
        create_device: '新建设备', edit_device: '修改设备', delete_device: '删除设备',
        create_connector: '新建连接器', edit_connector: '修改连接器', delete_connector: '删除连接器',
        create_pin: '新建针孔', edit_pin: '修改针孔', delete_pin: '删除针孔',
        create_signal: '新建信号', edit_signal: '修改信号', delete_signal: '删除信号',
        request_device_management: '申请设备管理',
      };
      const label = actionLabels[approvalReq.action_type] || approvalReq.action_type;
      const entityDesc = await getEntityDescription(db, approvalReq.entity_type, approvalReq.entity_id);
      await db.run(
        `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'approval_rejected', ?, ?)`,
        [approvalReq.requester_username, `审批被拒绝：${label} — ${entityDesc}`,
         `您提交的${entityDesc}的「${label}」请求被 ${req.user!.username} 拒绝。理由：${reason.trim()}`]
      );

      res.json({ success: true, message: '已拒绝该审批请求' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '拒绝审批失败' });
    }
  });

  // ── POST /api/approvals/batch-approve — 批量审批通过 ───────
  router.post('/batch-approve', authenticate, async (req: AuthRequest, res) => {
    try {
      const { request_ids } = req.body;
      if (!Array.isArray(request_ids) || request_ids.length === 0) {
        return res.status(400).json({ error: '请选择至少一条待审批任务' });
      }

      const username = req.user!.username;
      const results: Array<{ id: number; success: boolean; error?: string }> = [];

      for (const requestId of request_ids) {
        try {
          const approvalReq = await db.get('SELECT * FROM approval_requests WHERE id = ?', [requestId]);
          if (!approvalReq || approvalReq.status !== 'pending' || approvalReq.current_phase !== 'approval') {
            results.push({ id: requestId, success: false, error: '不在审批阶段或已结束' });
            continue;
          }

          const myItem = await db.get(
            `SELECT * FROM approval_items WHERE approval_request_id = ? AND recipient_username = ? AND item_type = 'approval' AND status = 'pending'`,
            [requestId, username]
          );
          if (!myItem) {
            results.push({ id: requestId, success: false, error: '无待审批项' });
            continue;
          }

          await db.run(
            `UPDATE approval_items SET status = 'done', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [myItem.id]
          );

          // 记录 change_log
          const entityTable = approvalReq.entity_type === 'device' ? 'devices'
            : approvalReq.entity_type === 'signal' ? 'signals'
            : approvalReq.entity_type === 'connector' ? 'connectors'
            : approvalReq.entity_type === 'pin' ? 'pins' : null;
          if (entityTable) {
            await db.run(
              `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, reason, status)
               VALUES (?, ?, ?, ?, ?, ?, 'approved')`,
              [entityTable, approvalReq.entity_id, approvalReq.entity_id, entityTable, req.user!.id, `批量审批通过（${approvalReq.action_type}）`]
            );
          }

          await checkAndAdvancePhase(db, requestId);
          results.push({ id: requestId, success: true });
        } catch (err: any) {
          results.push({ id: requestId, success: false, error: err.message });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      res.json({
        success: true,
        message: `批量审批完成：${succeeded} 条通过${failed > 0 ? `，${failed} 条跳过` : ''}`,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '批量审批失败' });
    }
  });

  return router;
}
