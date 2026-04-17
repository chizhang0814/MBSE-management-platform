import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export function rhiRoutes(db: Database) {
  const router = express.Router();

  // ── GET /api/rhi/status/all — 批量查询所有信号组的RHI状态 ──
  router.get('/status/all', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.query.project_id as string);
      if (!projectId) return res.status(400).json({ error: '缺少 project_id' });

      const rows: any[] = await db.query(`
        SELECT n.signal_group,
          SUM(CASE WHEN n.type = 'interconnect' THEN 1 ELSE 0 END) as ic_count,
          (SELECT COUNT(*) FROM wire_end_node_links l
           WHERE l.from_node_id IN (SELECT id FROM wire_end_nodes WHERE signal_group = n.signal_group AND project_id = ?)
              OR l.to_node_id IN (SELECT id FROM wire_end_nodes WHERE signal_group = n.signal_group AND project_id = ?)
          ) as link_count
        FROM wire_end_nodes n
        WHERE n.project_id = ?
        GROUP BY n.signal_group
      `, [projectId, projectId, projectId]);

      const status: Record<string, { ic_count: number; link_count: number }> = {};
      for (const r of rows) {
        status[r.signal_group] = { ic_count: r.ic_count, link_count: r.link_count };
      }
      res.json({ status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── GET /api/rhi/:signal_group — 加载RHI数据（自动初始化设备节点） ──
  router.get('/:signal_group', authenticate, async (req: AuthRequest, res) => {
    try {
      const { signal_group } = req.params;
      const projectId = parseInt(req.query.project_id as string);
      if (!projectId) return res.status(400).json({ error: '缺少 project_id' });

      let nodes = await db.query(`
        SELECT n.id, n.type, n.device_id, n.connector_id, n.interconnect_id, n.sort_order,
               d."设备编号" as dev_num, d."设备中文名称" as dev_name,
               c."设备端元器件编号" as conn_name,
               ic.label as interconnect_label
        FROM wire_end_nodes n
        LEFT JOIN devices d ON d.id = n.device_id
        LEFT JOIN connectors c ON c.id = n.connector_id
        LEFT JOIN interconnects ic ON ic.id = n.interconnect_id
        WHERE n.signal_group = ? AND n.project_id = ?
        ORDER BY n.sort_order
      `, [signal_group, projectId]);

      // 自动初始化设备节点
      if (nodes.length === 0) {
        const signals = await db.query(
          'SELECT id, "协议标识" as proto, twist_group FROM signals WHERE signal_group = ? AND project_id = ? AND status NOT IN (\'deleted\')',
          [signal_group, projectId]
        );
        if (signals.length === 0) return res.json({ nodes: [], links: [] });

        const deviceMap = new Map<string, any[]>();
        for (const sig of signals) {
          const eps = await db.query(`
            SELECT ep.id as ep_id, ep.device_id, ep.pin_id,
                   d."设备编号" as dev_num, c.id as conn_id
            FROM signal_endpoints ep
            JOIN devices d ON d.id = ep.device_id
            JOIN pins p ON p.id = ep.pin_id
            JOIN connectors c ON c.id = p.connector_id
            WHERE ep.signal_id = ?
          `, [sig.id]);
          for (const ep of eps) {
            const key = ep.device_id + ':' + ep.conn_id;
            if (!deviceMap.has(key)) deviceMap.set(key, []);
            deviceMap.get(key)!.push({ proto: sig.proto || '未知', twist_group: sig.twist_group || '', endpoint_id: ep.ep_id, pin_id: ep.pin_id, device_id: ep.device_id, conn_id: ep.conn_id });
          }
        }

        const protoOrder = new Map<string, number>();
        signals.forEach((s: any) => { if (!protoOrder.has(s.proto)) protoOrder.set(s.proto, protoOrder.size); });

        let sortOrder = 0;
        for (const [, slots] of deviceMap) {
          sortOrder++;
          const first = slots[0];
          const r = await db.run(
            'INSERT INTO wire_end_nodes (signal_group, project_id, type, device_id, connector_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
            [signal_group, projectId, 'device', first.device_id, first.conn_id, sortOrder]
          );
          const nodeId = r.lastID;
          const sorted = slots.sort((a: any, b: any) => (protoOrder.get(a.proto) || 0) - (protoOrder.get(b.proto) || 0));
          for (let si = 0; si < sorted.length; si++) {
            const s = sorted[si];
            await db.run(
              'INSERT INTO wire_end_node_slots (node_id, protocol, twist_group, endpoint_id, pin_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
              [nodeId, s.proto, s.twist_group, s.endpoint_id, s.pin_id, si]
            );
          }
        }

        nodes = await db.query(`
          SELECT n.id, n.type, n.device_id, n.connector_id, n.interconnect_id, n.sort_order,
                 d."设备编号" as dev_num, d."设备中文名称" as dev_name,
                 c."设备端元器件编号" as conn_name,
                 ic.label as interconnect_label
          FROM wire_end_nodes n
          LEFT JOIN devices d ON d.id = n.device_id
          LEFT JOIN connectors c ON c.id = n.connector_id
          LEFT JOIN interconnects ic ON ic.id = n.interconnect_id
          WHERE n.signal_group = ? AND n.project_id = ?
          ORDER BY n.sort_order
        `, [signal_group, projectId]);
      }

      // Slots（方向从edge推导）
      for (const node of nodes) {
        const rawSlots: any[] = await db.query(`
          SELECT s.id, s.protocol, s.twist_group, s.endpoint_id, s.pin_id,
                 s.interconnect_pin_id,
                 p."针孔号" as pin_num, ep."信号名称" as sig_name,
                 ip.pin_num as ic_pin_num
          FROM wire_end_node_slots s
          LEFT JOIN pins p ON p.id = s.pin_id
          LEFT JOIN signal_endpoints ep ON ep.id = s.endpoint_id
          LEFT JOIN interconnect_pins ip ON ip.id = s.interconnect_pin_id
          WHERE s.node_id = ?
          ORDER BY s.sort_order
        `, [node.id]);

        for (const slot of rawSlots) {
          if (!slot.endpoint_id) { slot.direction = ''; continue; }
          const asFrom = await db.get('SELECT direction FROM signal_edges WHERE from_endpoint_id = ? LIMIT 1', [slot.endpoint_id]);
          const asTo = await db.get('SELECT direction FROM signal_edges WHERE to_endpoint_id = ? LIMIT 1', [slot.endpoint_id]);
          if (asFrom && asTo) slot.direction = 'BI-DIR';
          else if (asFrom) slot.direction = asFrom.direction === 'bidirectional' ? 'BI-DIR' : 'OUT';
          else if (asTo) slot.direction = asTo.direction === 'bidirectional' ? 'BI-DIR' : 'IN';
          else slot.direction = '';
        }
        (node as any).slots = rawSlots;
      }

      // 连线
      const links = await db.query(`
        SELECT id, from_node_id, to_node_id FROM wire_end_node_links
        WHERE from_node_id IN (SELECT id FROM wire_end_nodes WHERE signal_group = ? AND project_id = ?)
        OR to_node_id IN (SELECT id FROM wire_end_nodes WHERE signal_group = ? AND project_id = ?)
      `, [signal_group, projectId, signal_group, projectId]);

      res.json({ nodes, links });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── POST /api/rhi/:signal_group/save ──
  router.post('/:signal_group/save', authenticate, async (req: AuthRequest, res) => {
    try {
      const { signal_group } = req.params;
      const { project_id, links, interconnect_nodes, pin_assignments } = req.body;
      if (!project_id) return res.status(400).json({ error: '缺少 project_id' });

      const idMap = new Map<number, number>();

      // 保存新互联点节点
      if (interconnect_nodes && Array.isArray(interconnect_nodes)) {
        for (const icn of interconnect_nodes) {
          if (!icn._isNew || !icn.interconnectId) continue;

          // 查信号组的protocols
          const sampleNode = await db.get(
            'SELECT id FROM wire_end_nodes WHERE signal_group = ? AND project_id = ? AND type = ? LIMIT 1',
            [signal_group, project_id, 'device']
          );
          if (!sampleNode) continue;
          const sampleSlots: any[] = await db.query(
            'SELECT protocol, twist_group, sort_order FROM wire_end_node_slots WHERE node_id = ? ORDER BY sort_order',
            [sampleNode.id]
          );

          const r = await db.run(
            `INSERT INTO wire_end_nodes (signal_group, project_id, type, interconnect_id, sort_order)
             VALUES (?, ?, 'interconnect', ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM wire_end_nodes WHERE signal_group = ? AND project_id = ?))`,
            [signal_group, project_id, icn.interconnectId, signal_group, project_id]
          );
          const newNodeId = r.lastID;

          for (const ss of sampleSlots) {
            await db.run(
              'INSERT INTO wire_end_node_slots (node_id, protocol, twist_group, sort_order) VALUES (?, ?, ?, ?)',
              [newNodeId, ss.protocol, ss.twist_group, ss.sort_order]
            );
          }
          idMap.set(icn._tempId, newNodeId);
        }
      }

      // 保存针孔分配
      if (pin_assignments && Array.isArray(pin_assignments)) {
        for (const pa of pin_assignments) {
          let realNodeId = pa.nodeId;
          if (pa.nodeTempId && idMap.has(pa.nodeTempId)) realNodeId = idMap.get(pa.nodeTempId);

          const slot = await db.get(
            'SELECT id FROM wire_end_node_slots WHERE node_id = ? AND protocol = ?',
            [realNodeId, pa.protocol]
          );
          if (!slot) continue;

          await db.run(
            'UPDATE wire_end_node_slots SET interconnect_pin_id = ? WHERE id = ?',
            [pa.interconnectPinId, slot.id]
          );
        }
      }

      // 保存连线
      if (links && Array.isArray(links)) {
        const nodeIds = (await db.query(
          'SELECT id FROM wire_end_nodes WHERE signal_group = ? AND project_id = ?',
          [signal_group, project_id]
        )).map((r: any) => r.id);
        const nodeIdSet = new Set(nodeIds);

        // 新建的节点也加入
        for (const [, newId] of idMap) nodeIdSet.add(newId);

        if (nodeIds.length > 0) {
          const allIds = [...nodeIdSet];
          const ph = allIds.map(() => '?').join(',');
          await db.run(`DELETE FROM wire_end_node_links WHERE from_node_id IN (${ph}) OR to_node_id IN (${ph})`, [...allIds, ...allIds]);
        }

        for (const link of links) {
          const fromId = idMap.get(link.from) || link.from;
          const toId = idMap.get(link.to) || link.to;
          if (!nodeIdSet.has(fromId) || !nodeIdSet.has(toId)) continue;
          await db.run('INSERT OR IGNORE INTO wire_end_node_links (from_node_id, to_node_id) VALUES (?, ?)', [fromId, toId]);
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── DELETE /api/rhi/:signal_group/node/:id — 删除互联点节点 ──
  router.delete('/:signal_group/node/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const nodeId = parseInt(req.params.id);
      const node = await db.get('SELECT * FROM wire_end_nodes WHERE id = ? AND type = ?', [nodeId, 'interconnect']);
      if (!node) return res.status(404).json({ error: '互联点节点不存在' });
      await db.run('DELETE FROM wire_end_nodes WHERE id = ?', [nodeId]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
