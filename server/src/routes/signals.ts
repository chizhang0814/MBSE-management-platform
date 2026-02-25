import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

/** 检查用户是否为指定项目的设备管理员 */
async function isProjectDeviceManager(db: Database, username: string, projectId: number): Promise<boolean> {
  const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
  const perms: Array<{ project_name: string; project_role: string }> = userRow?.permissions
    ? JSON.parse(userRow.permissions)
    : [];
  const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
  if (!projectRow) return false;
  return perms.some(p => p.project_name === projectRow.name && p.project_role === '设备管理员');
}

export function signalRoutes(db: Database) {
  const router = express.Router();

  // ── 辅助：根据连接类型生成 unique_id ──────────────────────

  async function generateUniqueId(db: Database, projectId: number, connectionType: string): Promise<string> {
    let prefix = '';
    if (connectionType === '1to1信号' || connectionType === '1to1') prefix = 'DATA_';
    else if (connectionType === '网络') prefix = 'NET_';
    else if (connectionType === 'ERN' || connectionType === '接地') prefix = 'ERN_';
    else return `SIG_${Date.now()}`;

    const rows = await db.query(
      `SELECT unique_id FROM signals WHERE project_id = ? AND unique_id LIKE ? AND unique_id IS NOT NULL`,
      [projectId, `${prefix}%`]
    );
    let maxNum = 0;
    for (const r of rows) {
      const match = r.unique_id?.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`));
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    return `${prefix}${String(maxNum + 1).padStart(5, '0')}`;
  }

  // ── 构建端点摘要 ──────────────────────────────────────────

  // 查一次端点，同时构建端点地址摘要和信号名称摘要
  async function buildSignalSummaries(db: Database, signalId: number): Promise<{ endpoint_summary: string; 信号名称摘要: string }> {
    const endpoints = await db.query(
      `SELECT se.endpoint_index, se.信号名称,
              p.针孔号, c.连接器号, c.设备端元器件编号, d.设备编号
       FROM signal_endpoints se
       JOIN pins p ON se.pin_id = p.id
       JOIN connectors c ON p.connector_id = c.id
       JOIN devices d ON c.device_id = d.id
       WHERE se.signal_id = ?
       ORDER BY se.endpoint_index`,
      [signalId]
    );
    if (endpoints.length === 0) return { endpoint_summary: '', 信号名称摘要: '' };

    // 端点地址摘要：{ep0} → {ep1}
    const addrParts: string[] = [];
    for (const e of endpoints) {
      const compId = e.设备端元器件编号 || `${e.设备编号}-${e.连接器号}`;
      addrParts.push(`${compId}-${e.针孔号}`);
    }

    // 信号名称摘要：{信号名称（从）} → {信号名称（到）}
    const ep0 = endpoints[0];
    const ep1 = endpoints[1];
    const nameParts: string[] = [];
    if (ep0?.信号名称) nameParts.push(ep0.信号名称);
    if (ep1?.信号名称) nameParts.push(ep1.信号名称);

    return {
      endpoint_summary: addrParts.join(' → '),
      信号名称摘要: nameParts.join(' → '),
    };
  }

  // ── 获取信号列表 ──────────────────────────────────────────

  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.query.projectId as string);
      if (isNaN(projectId)) return res.status(400).json({ error: '缺少 projectId' });

      const myDevices = req.query.myDevices === 'true';
      const username = req.user!.username;
      const userRole = req.user!.role;

      let hasProjectPermission = false;
      if (userRole === 'user') {
        const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
        const perms: Array<{ project_name: string }> = userRow?.permissions ? JSON.parse(userRow.permissions) : [];
        const projectRow = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
        hasProjectPermission = perms.some((p: any) => p.project_name === projectRow?.name);
      }

      // 非管理员只能看到自己的草稿，其他人的草稿不可见
      const draftClause = userRole === 'admin' ? '' : `AND (s.status != 'Draft' OR s.created_by = ?)`;

      let sql: string;
      const params: any[] = [projectId];

      if (myDevices || (userRole === 'user' && !hasProjectPermission)) {
        sql = `
          SELECT DISTINCT s.*
          FROM signals s
          WHERE s.project_id = ?
            ${draftClause}
            AND EXISTS (
              SELECT 1 FROM signal_endpoints se
              JOIN pins p ON se.pin_id = p.id
              JOIN connectors c ON p.connector_id = c.id
              JOIN devices d ON c.device_id = d.id
              WHERE se.signal_id = s.id AND d.设备负责人 = ?
            )
        `;
        if (userRole !== 'admin') params.push(username);
        params.push(username);
      } else {
        sql = `SELECT s.* FROM signals s WHERE s.project_id = ? ${draftClause}`;
        if (userRole !== 'admin') params.push(username);
      }
      sql += ' ORDER BY s.unique_id, s.id';

      const signals = await db.query(sql, params);

      // 为每条信号附加端点摘要、信号名称摘要、can_edit
      const result = await Promise.all(signals.map(async (s: any) => {
        const summaries = await buildSignalSummaries(db, s.id);
        let can_edit = true;
        if (userRole !== 'admin') {
          const ownEp = await db.get(
            `SELECT se.id FROM signal_endpoints se
             JOIN pins p ON se.pin_id = p.id
             JOIN connectors c ON p.connector_id = c.id
             JOIN devices d ON c.device_id = d.id
             WHERE se.signal_id = ? AND d.设备负责人 = ?
             LIMIT 1`,
            [s.id, username]
          );
          can_edit = !!ownEp;
        }
        const unconfirmedRow = await db.get(
          'SELECT COUNT(*) as cnt FROM signal_endpoints WHERE signal_id = ? AND confirmed = 0',
          [s.id]
        );
        const has_unconfirmed = (unconfirmedRow?.cnt ?? 0) > 0 ? 1 : 0;
        return { ...s, ...summaries, can_edit, has_unconfirmed };
      }));

      res.json({ signals: result });
    } catch (error: any) {
      console.error('获取信号列表失败:', error);
      res.status(500).json({ error: error.message || '获取信号列表失败' });
    }
  });

  // ── 获取单个信号（含完整端点信息）────────────────────────

  router.get('/:id', authenticate, async (req, res) => {
    try {
      const signal = await db.get('SELECT * FROM signals WHERE id = ?', [req.params.id]);
      if (!signal) return res.status(404).json({ error: '信号不存在' });

      const endpoints = await db.query(
        `SELECT se.*,
                p.针孔号, p.端接尺寸 as pin_端接尺寸,
                c.id as connector_id, c.连接器号, c.设备端元器件编号,
                d.id as device_id, d.设备编号, d.设备中文名称, d.设备负责人
         FROM signal_endpoints se
         JOIN pins p ON se.pin_id = p.id
         JOIN connectors c ON p.connector_id = c.id
         JOIN devices d ON c.device_id = d.id
         WHERE se.signal_id = ?
         ORDER BY se.endpoint_index`,
        [signal.id]
      );

      res.json({ signal: { ...signal, endpoints } });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取信号失败' });
    }
  });

  // ── 创建信号（含端点，事务）──────────────────────────────

  router.post('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const { project_id, endpoints, draft: isDraft, ...signalFields } = req.body;
      if (!project_id) return res.status(400).json({ error: '缺少 project_id' });

      if (req.user!.role !== 'admin' && !(await isProjectDeviceManager(db, req.user!.username, project_id))) {
        return res.status(403).json({ error: '无权限，需要设备管理员角色才能创建信号' });
      }

      signalFields.created_by = req.user!.username;

      // 非管理员：至少一个端点属于当前用户负责的设备
      if (req.user!.role !== 'admin' && Array.isArray(endpoints) && endpoints.length > 0) {
        const username = req.user!.username;
        const hasOwnEndpoint = await Promise.any(
          endpoints.map(async (ep: any) => {
            const row = await db.get(
              `SELECT d.id FROM devices d WHERE d.project_id = ? AND d.设备编号 = ? AND d.设备负责人 = ?`,
              [project_id, ep.设备编号, username]
            );
            if (!row) throw new Error('not owner');
            return true;
          })
        ).catch(() => false);
        if (!hasOwnEndpoint) {
          return res.status(403).json({ error: '创建信号失败：至少需要有一个端点属于您负责的设备' });
        }
      }

      // ── 预解析所有端点的 pin_id ──────────────────────────
      type ResolvedEp = { ep: any; pinId: number };
      const resolved: ResolvedEp[] = [];
      const endpointErrors: string[] = [];

      if (Array.isArray(endpoints)) {
        for (let i = 0; i < endpoints.length; i++) {
          const ep = endpoints[i];
          const pin = await db.get(
            `SELECT p.id FROM pins p
             JOIN connectors c ON p.connector_id = c.id
             JOIN devices d ON c.device_id = d.id
             WHERE d.project_id = ? AND d.设备编号 = ? AND c.连接器号 = ? AND p.针孔号 = ?`,
            [project_id, ep.设备编号, ep.连接器号, ep.针孔号]
          );
          if (!pin) {
            endpointErrors.push(`端点${i + 1}: 找不到 ${ep.设备编号}.${ep.连接器号}.${ep.针孔号}`);
          } else {
            resolved.push({ ep, pinId: pin.id });
          }
        }
      }

      const newPinIds = resolved.map(r => r.pinId);

      // ── 端点重叠检测 ────────────────────────────────────
      if (newPinIds.length > 0) {
        const ph = newPinIds.map(() => '?').join(',');
        // 找出项目内与新端点有交集的已有信号，按重叠数降序
        const overlapping: Array<{ signal_id: number; overlap_count: number }> = await db.query(
          `SELECT se.signal_id, COUNT(*) as overlap_count
           FROM signal_endpoints se
           JOIN signals s ON se.signal_id = s.id
           WHERE s.project_id = ? AND se.pin_id IN (${ph})
           GROUP BY se.signal_id
           ORDER BY overlap_count DESC`,
          [project_id, ...newPinIds]
        );

        if (overlapping.length > 0) {
          const top = overlapping[0];

          // 情况1：某个已有信号包含了所有新端点 → 拒绝
          if (top.overlap_count >= newPinIds.length) {
            const existing = await db.get('SELECT unique_id FROM signals WHERE id = ?', [top.signal_id]);
            return res.status(409).json({
              error: `所有端点均已存在于信号 "${existing?.unique_id || top.signal_id}" 中，不允许重复创建`,
            });
          }

          // 情况2：部分端点与某个已有信号重叠 → 检查连接类型后合并
          const targetSignalRow = await db.get('SELECT unique_id, "连接类型" FROM signals WHERE id = ?', [top.signal_id]);
          if (targetSignalRow?.['连接类型'] !== signalFields['连接类型']) {
            return res.status(409).json({
              error: `端点与信号 "${targetSignalRow?.unique_id || top.signal_id}" 重叠，但连接类型不同（现有：${targetSignalRow?.['连接类型'] || '未设置'}，新建：${signalFields['连接类型'] || '未设置'}），无法合并`,
            });
          }

          const existingPins: Array<{ pin_id: number }> = await db.query(
            'SELECT pin_id FROM signal_endpoints WHERE signal_id = ?',
            [top.signal_id]
          );
          const existingPinSet = new Set(existingPins.map(p => p.pin_id));
          const maxIdxRow = await db.get(
            'SELECT MAX(endpoint_index) as m FROM signal_endpoints WHERE signal_id = ?',
            [top.signal_id]
          );
          let nextIdx: number = (maxIdxRow?.m ?? -1) + 1;

          for (const { ep, pinId } of resolved) {
            if (!existingPinSet.has(pinId)) {
              const ownerRow = await db.get(
                `SELECT d.设备负责人 FROM devices d
                 JOIN connectors c ON c.device_id = d.id
                 JOIN pins p ON p.connector_id = c.id
                 WHERE p.id = ?`,
                [pinId]
              );
              const confirmed = (!ownerRow?.设备负责人 || ownerRow.设备负责人 === req.user!.username) ? 1 : 0;
              await db.run(
                `INSERT INTO signal_endpoints (signal_id, pin_id, endpoint_index, confirmed, 信号名称, 信号定义)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [top.signal_id, pinId, nextIdx++, confirmed, ep.信号名称 || null, ep.信号定义 || null]
              );
            }
          }

          // 向新合并端点中其他设备负责人发送确认通知
          const mergeOtherOwners: Array<{ 设备负责人: string; 设备编号: string }> = await db.query(
            `SELECT DISTINCT d.设备负责人, d.设备编号
             FROM signal_endpoints se
             JOIN pins p ON se.pin_id = p.id
             JOIN connectors c ON p.connector_id = c.id
             JOIN devices d ON c.device_id = d.id
             WHERE se.signal_id = ? AND se.confirmed = 0 AND d.设备负责人 != ?`,
            [top.signal_id, req.user!.username]
          );
          if (mergeOtherOwners.length > 0) {
            const ownerDevices: Record<string, string[]> = {};
            for (const row of mergeOtherOwners) {
              if (!ownerDevices[row.设备负责人]) ownerDevices[row.设备负责人] = [];
              ownerDevices[row.设备负责人].push(row.设备编号);
            }
            for (const [owner, devs] of Object.entries(ownerDevices)) {
              await db.run(
                `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'signal_confirm_request', ?, ?)`,
                [
                  owner,
                  `信号端点确认请求：${targetSignalRow?.unique_id}`,
                  `用户 ${req.user!.username} 向信号 "${targetSignalRow?.unique_id}" 添加了新端点，包含您负责的设备（${devs.join('、')}）的端点信息，请进入信号视图确认或完善相关信息。`,
                ]
              );
            }
          }

          return res.json({
            success: true,
            merged: true,
            mergedIntoId: top.signal_id,
            mergedIntoUniqueId: targetSignalRow?.unique_id,
          });
        }
      }

      // ── 无重叠，正常新建 ────────────────────────────────
      // unique_id 必填 + 项目内唯一性校验
      if (!signalFields.unique_id) {
        return res.status(400).json({ error: 'Unique ID 不能为空' });
      }
      const dupSignal = await db.get(
        'SELECT id FROM signals WHERE project_id = ? AND unique_id = ?',
        [project_id, signalFields.unique_id]
      );
      if (dupSignal) {
        return res.status(409).json({ error: `Unique ID "${signalFields.unique_id}" 在本项目中已存在` });
      }

      const cols = Object.keys(signalFields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(signalFields).map(() => '?').join(', ');
      const sigResult = await db.run(
        `INSERT INTO signals (project_id, ${cols}) VALUES (?, ${placeholders})`,
        [project_id, ...Object.values(signalFields)]
      );
      const signalId = sigResult.lastID;

      let anyUnconfirmed = false;
      for (let i = 0; i < resolved.length; i++) {
        const { ep, pinId } = resolved[i];
        const ownerRow = await db.get(
          `SELECT d.设备负责人 FROM devices d
           JOIN connectors c ON c.device_id = d.id
           JOIN pins p ON p.connector_id = c.id
           WHERE p.id = ?`,
          [pinId]
        );
        const confirmed = (!ownerRow?.设备负责人 || ownerRow.设备负责人 === req.user!.username) ? 1 : 0;
        if (confirmed === 0) anyUnconfirmed = true;
        await db.run(
          `INSERT INTO signal_endpoints (signal_id, pin_id, endpoint_index, confirmed, 信号名称, 信号定义)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [signalId, pinId, i, confirmed, ep.信号名称 || null, ep.信号定义 || null]
        );
      }

      // 设置信号状态
      const signalStatus = isDraft ? 'Draft' : (anyUnconfirmed ? 'Pending' : 'Active');
      await db.run('UPDATE signals SET status = ? WHERE id = ?', [signalStatus, signalId]);

      // 非草稿且有待确认端点时，向其他设备负责人发送确认请求通知
      if (!isDraft && anyUnconfirmed) {
        const otherOwners: Array<{ 设备负责人: string; 设备编号: string }> = await db.query(
          `SELECT DISTINCT d.设备负责人, d.设备编号
           FROM signal_endpoints se
           JOIN pins p ON se.pin_id = p.id
           JOIN connectors c ON p.connector_id = c.id
           JOIN devices d ON c.device_id = d.id
           WHERE se.signal_id = ? AND se.confirmed = 0`,
          [signalId]
        );
        if (otherOwners.length > 0) {
          const ownerDevices: Record<string, string[]> = {};
          for (const row of otherOwners) {
            if (!ownerDevices[row.设备负责人]) ownerDevices[row.设备负责人] = [];
            ownerDevices[row.设备负责人].push(row.设备编号);
          }
          for (const [owner, devs] of Object.entries(ownerDevices)) {
            await db.run(
              `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'signal_confirm_request', ?, ?)`,
              [
                owner,
                `信号端点确认请求：${signalFields.unique_id}`,
                `用户 ${req.user!.username} 创建了信号 "${signalFields.unique_id}"，包含您负责的设备（${devs.join('、')}）的端点信息，请进入信号视图确认或完善相关信息。`,
              ]
            );
          }
        }
      }

      // 写修改日志
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, new_values, reason, status)
         VALUES ('signals', ?, ?, 'signals', ?, ?, '新建信号', 'approved')`,
        [
          signalId, signalId, req.user!.id,
          JSON.stringify({
            ...signalFields,
            endpoints: resolved.map(({ ep }) => ({
              设备编号: ep.设备编号, 连接器号: ep.连接器号, 针孔号: ep.针孔号, 信号名称: ep.信号名称 || null,
            })),
          }),
        ]
      );

      res.json({ success: true, id: signalId, unique_id: signalFields.unique_id, endpointErrors });
    } catch (error: any) {
      console.error('创建信号失败:', error);
      res.status(500).json({ error: error.message || '创建信号失败' });
    }
  });

  // ── 更新信号（可含 endpoints 数组替换端点）───────────────

  router.put('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const signalId = parseInt(req.params.id);
      const signal = await db.get('SELECT * FROM signals WHERE id = ?', [signalId]);
      if (!signal) return res.status(404).json({ error: '信号不存在' });

      if (req.user!.role !== 'admin' && !(await isProjectDeviceManager(db, req.user!.username, signal.project_id))) {
        return res.status(403).json({ error: '无权限，需要设备管理员角色才能修改信号' });
      }

      // 非管理员：当前端点中至少有一个属于本人负责的设备
      if (req.user!.role !== 'admin') {
        const ownEndpoint = await db.get(
          `SELECT se.id FROM signal_endpoints se
           JOIN pins p ON se.pin_id = p.id
           JOIN connectors c ON p.connector_id = c.id
           JOIN devices d ON c.device_id = d.id
           WHERE se.signal_id = ? AND d.设备负责人 = ?
           LIMIT 1`,
          [signalId, req.user!.username]
        );
        if (!ownEndpoint) {
          return res.status(403).json({ error: '无权限：该信号的端点中没有您负责的设备' });
        }
      }

      const { endpoints, version, submit: shouldSubmit, ...fields } = req.body;
      delete fields.id; delete fields.project_id; delete fields.created_at; delete fields.status;

      const wasDraft = signal.status === 'Draft';
      const wasActive = signal.status === 'Active';

      if (Object.keys(fields).length > 0) {
        const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
        const result = await db.run(
          `UPDATE signals SET ${setClauses}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`,
          [...Object.values(fields), signalId, version ?? 1]
        );
        if (result.changes === 0) {
          return res.status(409).json({ error: '记录已被他人修改，请刷新后重试' });
        }
      }

      // 辅助：向未确认端点的其他设备负责人发通知
      const sendConfirmNotifications = async (sigId: number, uniqueId: string, isRe: boolean) => {
        const unconfOwners: Array<{ 设备负责人: string; 设备编号: string }> = await db.query(
          `SELECT DISTINCT d.设备负责人, d.设备编号
           FROM signal_endpoints se JOIN pins p ON se.pin_id = p.id
           JOIN connectors c ON p.connector_id = c.id JOIN devices d ON c.device_id = d.id
           WHERE se.signal_id = ? AND se.confirmed = 0 AND d.设备负责人 != ?`,
          [sigId, req.user!.username]
        );
        const ownerDevices: Record<string, string[]> = {};
        for (const row of unconfOwners) {
          if (!ownerDevices[row.设备负责人]) ownerDevices[row.设备负责人] = [];
          ownerDevices[row.设备负责人].push(row.设备编号);
        }
        for (const [owner, devs] of Object.entries(ownerDevices)) {
          const msg = isRe
            ? `用户 ${req.user!.username} 修改了信号 "${uniqueId}"，其中包含您负责的设备（${devs.join('、')}）的端点信息，请进入信号视图重新确认。`
            : `用户 ${req.user!.username} 创建了信号 "${uniqueId}"，包含您负责的设备（${devs.join('、')}）的端点信息，请进入信号视图确认或完善相关信息。`;
          await db.run(
            `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'signal_confirm_request', ?, ?)`,
            [owner, `信号端点确认请求：${uniqueId}`, msg]
          );
        }
      };

      // 如果提供了 endpoints，替换所有端点
      if (Array.isArray(endpoints)) {
        // 保存现有端点的确认状态（按 pin_id 索引）
        const prevEps: Array<{ pin_id: number; confirmed: number }> = await db.query(
          'SELECT pin_id, confirmed FROM signal_endpoints WHERE signal_id = ?',
          [signalId]
        );
        const prevConfirmedMap: Record<number, number> = {};
        for (const row of prevEps) prevConfirmedMap[row.pin_id] = row.confirmed;

        await db.run('DELETE FROM signal_endpoints WHERE signal_id = ?', [signalId]);
        const endpointErrors: string[] = [];
        for (let i = 0; i < endpoints.length; i++) {
          const ep = endpoints[i];
          const pin = await db.get(
            `SELECT p.id FROM pins p
             JOIN connectors c ON p.connector_id = c.id
             JOIN devices d ON c.device_id = d.id
             WHERE d.project_id = ? AND d.设备编号 = ? AND c.连接器号 = ? AND p.针孔号 = ?`,
            [signal.project_id, ep.设备编号, ep.连接器号, ep.针孔号]
          );
          if (!pin) {
            endpointErrors.push(`端点${i + 1}: 找不到 ${ep.设备编号}.${ep.连接器号}.${ep.针孔号}`);
            continue;
          }
          const ownerRow = await db.get(
            `SELECT d.设备负责人 FROM devices d
             JOIN connectors c ON c.device_id = d.id
             JOIN pins p ON p.connector_id = c.id
             WHERE p.id = ?`,
            [pin.id]
          );
          let confirmed = 0;
          if (!ownerRow?.设备负责人 || ownerRow.设备负责人 === req.user!.username) {
            confirmed = 1; // 当前用户负责的端点，保存即视为确认
          } else if (signal.status === 'Pending' && prevConfirmedMap[pin.id] === 1) {
            confirmed = 1; // Pending 状态下保留其他用户已确认的状态
          }
          // Active 状态 → 重置为 0（需重新确认）；Draft → 保持 0
          await db.run(
            `INSERT INTO signal_endpoints (signal_id, pin_id, endpoint_index, confirmed, 端接尺寸, 信号名称, 信号定义)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [signalId, pin.id, i, confirmed, ep.端接尺寸 || null, ep.信号名称 || null, ep.信号定义 || null]
          );
        }

        // 确定新状态
        const unconfAfter = await db.get(
          'SELECT COUNT(*) as cnt FROM signal_endpoints WHERE signal_id = ? AND confirmed = 0', [signalId]
        );
        const allConfirmedNow = (unconfAfter?.cnt ?? 1) === 0;
        let newStatus: string;
        if (wasDraft && !shouldSubmit) {
          newStatus = 'Draft';
        } else if (allConfirmedNow) {
          newStatus = 'Active';
        } else {
          newStatus = 'Pending';
        }
        await db.run('UPDATE signals SET status = ? WHERE id = ?', [newStatus, signalId]);

        // 通知创建者：信号已全部确认（Pending → Active）
        if (newStatus === 'Active' && signal.status === 'Pending' && signal.created_by && req.user!.username !== signal.created_by) {
          await db.run(
            `INSERT INTO notifications (recipient_username, type, title, message) VALUES (?, 'signal_all_confirmed', ?, ?)`,
            [signal.created_by, `信号端点已全部确认：${signal.unique_id}`, `信号 "${signal.unique_id}" 的所有端点均已被确认。`]
          );
        }
        // 通知其他设备负责人：Active 被修改（重新确认）或 Draft 被提交
        if (newStatus === 'Pending') {
          await sendConfirmNotifications(signalId, signal.unique_id, wasActive);
        }

        // 写修改日志
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('signals', ?, ?, 'signals', ?, ?, ?, '修改信号', 'approved')`,
          [
            signalId, signalId, req.user!.id,
            JSON.stringify(signal),
            JSON.stringify({
              ...fields,
              endpoints: endpoints.map((ep: any) => ({
                设备编号: ep.设备编号, 连接器号: ep.连接器号, 针孔号: ep.针孔号, 信号名称: ep.信号名称 || null,
              })),
            }),
          ]
        );

        res.json({ success: true, endpointErrors });
      } else {
        // 仅字段变更路径
        if (wasActive) {
          // Active 信号字段被修改：重置其他用户端点确认状态，回到 Pending
          await db.run(
            `UPDATE signal_endpoints SET confirmed = 0
             WHERE signal_id = ? AND pin_id IN (
               SELECT p.id FROM pins p
               JOIN connectors c ON p.connector_id = c.id
               JOIN devices d ON c.device_id = d.id
               WHERE d.设备负责人 != ?
             )`,
            [signalId, req.user!.username]
          );
          await db.run('UPDATE signals SET status = ? WHERE id = ?', ['Pending', signalId]);
          await sendConfirmNotifications(signalId, signal.unique_id, true);
        } else if (wasDraft && shouldSubmit) {
          // 草稿提交（无端点变更）：根据现有确认状态决定 Pending/Active
          const unconfDraft = await db.get(
            'SELECT COUNT(*) as cnt FROM signal_endpoints WHERE signal_id = ? AND confirmed = 0', [signalId]
          );
          const allDone = (unconfDraft?.cnt ?? 1) === 0;
          const submitStatus = allDone ? 'Active' : 'Pending';
          await db.run('UPDATE signals SET status = ? WHERE id = ?', [submitStatus, signalId]);
          if (!allDone) await sendConfirmNotifications(signalId, signal.unique_id, false);
        }

        // 写修改日志
        await db.run(
          `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, new_values, reason, status)
           VALUES ('signals', ?, ?, 'signals', ?, ?, ?, '修改信号', 'approved')`,
          [signalId, signalId, req.user!.id, JSON.stringify(signal), JSON.stringify(fields)]
        );

        res.json({ success: true });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || '更新信号失败' });
    }
  });

  // ── 删除信号 ─────────────────────────────────────────────

  router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const signalId = parseInt(req.params.id);
      const signal = await db.get('SELECT * FROM signals WHERE id = ?', [signalId]);
      if (!signal) return res.status(404).json({ error: '信号不存在' });

      // 仅创建者或管理员可删除
      if (req.user!.role !== 'admin' && signal.created_by !== req.user!.username) {
        return res.status(403).json({ error: '只能删除自己创建的信号' });
      }

      // 抓端点快照（用于日志和通知，删除前执行）
      const epSnapshot: Array<{ 设备编号: string; 连接器号: string; 针孔号: string; 信号名称: string | null; 设备负责人: string }> = await db.query(
        `SELECT d.设备编号, c.连接器号, p.针孔号, se.信号名称, d.设备负责人
         FROM signal_endpoints se
         JOIN pins p ON se.pin_id = p.id
         JOIN connectors c ON p.connector_id = c.id
         JOIN devices d ON c.device_id = d.id
         WHERE se.signal_id = ?
         ORDER BY se.endpoint_index`,
        [signalId]
      );

      // 写修改日志（删除前快照）
      await db.run(
        `INSERT INTO change_logs (entity_table, entity_id, data_id, table_name, changed_by, old_values, reason, status)
         VALUES ('signals', ?, ?, 'signals', ?, ?, '删除信号', 'approved')`,
        [
          signalId, signalId, req.user!.id,
          JSON.stringify({
            ...signal,
            endpoints: epSnapshot.map(ep => ({
              设备编号: ep.设备编号, 连接器号: ep.连接器号, 针孔号: ep.针孔号, 信号名称: ep.信号名称 || null,
            })),
          }),
        ]
      );

      // 查找端点中其他设备负责人（排除删除者本人），用于发送通知
      const affectedOwners = epSnapshot
        .filter(ep => ep.设备负责人 && ep.设备负责人 !== req.user!.username)
        .reduce<Record<string, string[]>>((acc, ep) => {
          if (!acc[ep.设备负责人]) acc[ep.设备负责人] = [];
          if (!acc[ep.设备负责人].includes(ep.设备编号)) acc[ep.设备负责人].push(ep.设备编号);
          return acc;
        }, {});

      await db.run('DELETE FROM signals WHERE id = ?', [signalId]);

      // 向受影响的设备负责人发送站内通知
      const deleter = req.user!.username;
      const uniqueId = signal.unique_id || String(signalId);
      for (const [username, devices] of Object.entries(affectedOwners)) {
        await db.run(
          `INSERT INTO notifications (recipient_username, type, title, message)
           VALUES (?, 'signal_deleted', ?, ?)`,
          [
            username,
            `信号已删除：${uniqueId}`,
            `用户 ${deleter} 删除了信号 "${uniqueId}"，该信号包含您负责的设备（${devices.join('、')}）的端点。`,
          ]
        );
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除信号失败' });
    }
  });

  return router;
}
