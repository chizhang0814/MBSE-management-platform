import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';

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

      let sql = `SELECT s.* FROM signals s WHERE s.project_id = ?`;
      const params: any[] = [projectId];

      if (myDevices || userRole === 'user') {
        sql = `
          SELECT DISTINCT s.*
          FROM signals s
          WHERE s.project_id = ?
            AND EXISTS (
              SELECT 1 FROM signal_endpoints se
              JOIN pins p ON se.pin_id = p.id
              JOIN connectors c ON p.connector_id = c.id
              JOIN devices d ON c.device_id = d.id
              WHERE se.signal_id = s.id AND d.设备负责人 = ?
            )
        `;
        params.push(username);
      }
      sql += ' ORDER BY s.unique_id, s.id';

      const signals = await db.query(sql, params);

      // 为每条信号附加端点摘要和信号名称摘要
      const result = await Promise.all(signals.map(async (s: any) => {
        const summaries = await buildSignalSummaries(db, s.id);
        return { ...s, ...summaries };
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
                c.连接器号, c.设备端元器件编号,
                d.设备编号, d.设备中文名称, d.设备负责人
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
      const { project_id, endpoints, ...signalFields } = req.body;
      if (!project_id) return res.status(400).json({ error: '缺少 project_id' });

      // 自动生成 unique_id（如果没有提供）
      if (!signalFields.unique_id && signalFields['连接类型']) {
        signalFields.unique_id = await generateUniqueId(db, project_id, signalFields['连接类型']);
      }

      // 构建 INSERT
      const cols = Object.keys(signalFields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(signalFields).map(() => '?').join(', ');
      const sigResult = await db.run(
        `INSERT INTO signals (project_id, ${cols}) VALUES (?, ${placeholders})`,
        [project_id, ...Object.values(signalFields)]
      );
      const signalId = sigResult.lastID;

      // 插入端点
      const endpointErrors: string[] = [];
      if (Array.isArray(endpoints)) {
        for (let i = 0; i < endpoints.length; i++) {
          const ep = endpoints[i];
          // 按 设备编号→连接器号→针孔号 查找 pin_id
          const pin = await db.get(
            `SELECT p.id FROM pins p
             JOIN connectors c ON p.connector_id = c.id
             JOIN devices d ON c.device_id = d.id
             WHERE d.project_id = ? AND d.设备编号 = ? AND c.连接器号 = ? AND p.针孔号 = ?`,
            [project_id, ep.设备编号, ep.连接器号, ep.针孔号]
          );
          if (!pin) {
            endpointErrors.push(`端点${i + 1}: 找不到 ${ep.设备编号}.${ep.连接器号}.${ep.针孔号}`);
            continue;
          }
          await db.run(
            `INSERT INTO signal_endpoints (signal_id, pin_id, endpoint_index, 端接尺寸, 信号名称, 信号定义)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [signalId, pin.id, i, ep.端接尺寸 || null, ep.信号名称 || null, ep.信号定义 || null]
          );
        }
      }

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

      const { endpoints, version, ...fields } = req.body;
      delete fields.id; delete fields.project_id; delete fields.created_at;

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

      // 如果提供了 endpoints，替换所有端点
      if (Array.isArray(endpoints)) {
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
          await db.run(
            `INSERT INTO signal_endpoints (signal_id, pin_id, endpoint_index, 端接尺寸, 信号名称, 信号定义)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [signalId, pin.id, i, ep.端接尺寸 || null, ep.信号名称 || null, ep.信号定义 || null]
          );
        }
        res.json({ success: true, endpointErrors });
      } else {
        res.json({ success: true });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || '更新信号失败' });
    }
  });

  // ── 删除信号 ─────────────────────────────────────────────

  router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const signalId = parseInt(req.params.id);
      await db.run('DELETE FROM signals WHERE id = ?', [signalId]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除信号失败' });
    }
  });

  return router;
}
