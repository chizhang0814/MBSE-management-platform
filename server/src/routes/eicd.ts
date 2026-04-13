import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export function eicdRoutes(db: Database) {
  const router = express.Router();

  // GET /api/eicd/signal-group/:groupName?project_id=N
  router.get('/signal-group/:groupName', authenticate, async (req: AuthRequest, res) => {
    try {
      const groupName = req.params.groupName;
      const projectId = Number(req.query.project_id);
      if (!groupName || !Number.isInteger(projectId) || projectId <= 0) {
        return res.status(400).json({ error: '缺少 groupName 或 project_id' });
      }

      // 1. Get all signals in this group
      const signals = await db.query(
        `SELECT id, unique_id, status, signal_group, 连接类型
         FROM signals WHERE signal_group = ? AND project_id = ?`,
        [groupName, projectId]
      );
      if (signals.length === 0) return res.status(404).json({ error: '未找到该协议组的信号' });

      const signalIds = signals.map((s: any) => s.id);
      const ph = signalIds.map(() => '?').join(',');

      // 2. Get all endpoints for these signals with device/connector/pin info
      const endpoints = await db.query(
        `SELECT se.id as endpoint_id, se.signal_id, se.device_id, se.pin_id, se.endpoint_index,
                se.信号名称, se.信号定义,
                d.设备编号, d.设备中文名称, d."设备部件所属系统（4位ATA）" as ata,
                p.针孔号, p.connector_id,
                c.设备端元器件编号
         FROM signal_endpoints se
         JOIN devices d ON se.device_id = d.id
         LEFT JOIN pins p ON se.pin_id = p.id
         LEFT JOIN connectors c ON p.connector_id = c.id
         WHERE se.signal_id IN (${ph})
         ORDER BY se.signal_id, se.endpoint_index`,
        signalIds
      );

      // 3. Get signal edges for direction info
      const edges = await db.query(
        `SELECT signal_id, from_endpoint_id, to_endpoint_id, direction
         FROM signal_edges WHERE signal_id IN (${ph})`,
        signalIds
      );

      // 4. Build device map (unique devices with their connectors and pins)
      const deviceMap = new Map<number, any>();
      for (const ep of endpoints) {
        if (!deviceMap.has(ep.device_id)) {
          deviceMap.set(ep.device_id, {
            id: ep.device_id,
            设备编号: ep.设备编号,
            设备中文名称: ep.设备中文名称,
            ata: ep.ata || null,
            connectors: new Map<number, any>(),
          });
        }
        const dev = deviceMap.get(ep.device_id)!;
        if (ep.connector_id && !dev.connectors.has(ep.connector_id)) {
          dev.connectors.set(ep.connector_id, {
            id: ep.connector_id,
            设备端元器件编号: ep.设备端元器件编号,
            pins: [],
          });
        }
        if (ep.connector_id && ep.pin_id) {
          const conn = dev.connectors.get(ep.connector_id)!;
          if (!conn.pins.some((p: any) => p.id === ep.pin_id)) {
            conn.pins.push({ id: ep.pin_id, 针孔号: ep.针孔号 });
          }
        }
      }
      const devices = Array.from(deviceMap.values()).map((dev: any) => ({
        ...dev,
        connectors: Array.from(dev.connectors.values()),
      }));

      // 5. Build signal details with endpoints
      const signalDetails = signals.map((s: any) => {
        const eps = endpoints.filter((ep: any) => ep.signal_id === s.id).map((ep: any) => ({
          endpointId: ep.endpoint_id,
          deviceId: ep.device_id,
          pinId: ep.pin_id,
          connectorId: ep.connector_id,
          设备编号: ep.设备编号,
          针孔号: ep.针孔号,
          设备端元器件编号: ep.设备端元器件编号,
        }));
        const sigEdges = edges.filter((e: any) => e.signal_id === s.id);
        // Build 信号名称摘要 from endpoint signal names
        const names = endpoints.filter((ep: any) => ep.signal_id === s.id && ep.信号名称).map((ep: any) => ep.信号名称);
        const 信号名称摘要 = [...new Set(names)].join(' / ') || null;
        return { ...s, 信号名称摘要, endpoints: eps, edges: sigEdges };
      });

      res.json({ groupName, signals: signalDetails, devices });
    } catch (error: any) {
      console.error('获取信号组EICD数据失败:', error);
      res.status(500).json({ error: error.message || '获取信号组EICD数据失败' });
    }
  });

  // GET /api/eicd/single-signal/:signalId?project_id=N
  // 返回格式与 signal-group 一致，但仅包含单条信号
  router.get('/single-signal/:signalId', authenticate, async (req: AuthRequest, res) => {
    try {
      const signalId = Number(req.params.signalId);
      const projectId = Number(req.query.project_id);
      if (!Number.isInteger(signalId) || signalId <= 0 || !Number.isInteger(projectId) || projectId <= 0) {
        return res.status(400).json({ error: '缺少 signalId 或 project_id' });
      }

      const signal = await db.get(
        `SELECT id, unique_id, status, signal_group, 连接类型
         FROM signals WHERE id = ? AND project_id = ?`,
        [signalId, projectId]
      );
      if (!signal) return res.status(404).json({ error: '未找到该信号' });

      const signals = [signal];
      const signalIds = [signal.id];
      const ph = '?';

      const endpoints = await db.query(
        `SELECT se.id as endpoint_id, se.signal_id, se.device_id, se.pin_id, se.endpoint_index,
                se.信号名称, se.信号定义,
                d.设备编号, d.设备中文名称, d."设备部件所属系统（4位ATA）" as ata,
                p.针孔号, p.connector_id,
                c.设备端元器件编号
         FROM signal_endpoints se
         JOIN devices d ON se.device_id = d.id
         LEFT JOIN pins p ON se.pin_id = p.id
         LEFT JOIN connectors c ON p.connector_id = c.id
         WHERE se.signal_id IN (${ph})
         ORDER BY se.signal_id, se.endpoint_index`,
        signalIds
      );

      const edges = await db.query(
        `SELECT signal_id, from_endpoint_id, to_endpoint_id, direction
         FROM signal_edges WHERE signal_id IN (${ph})`,
        signalIds
      );

      const deviceMap = new Map<number, any>();
      for (const ep of endpoints) {
        if (!deviceMap.has(ep.device_id)) {
          deviceMap.set(ep.device_id, {
            id: ep.device_id,
            设备编号: ep.设备编号,
            设备中文名称: ep.设备中文名称,
            ata: ep.ata || null,
            connectors: new Map<number, any>(),
          });
        }
        const dev = deviceMap.get(ep.device_id)!;
        if (ep.connector_id && !dev.connectors.has(ep.connector_id)) {
          dev.connectors.set(ep.connector_id, {
            id: ep.connector_id,
            设备端元器件编号: ep.设备端元器件编号,
            pins: [],
          });
        }
        if (ep.connector_id && ep.pin_id) {
          const conn = dev.connectors.get(ep.connector_id)!;
          if (!conn.pins.some((p: any) => p.id === ep.pin_id)) {
            conn.pins.push({ id: ep.pin_id, 针孔号: ep.针孔号 });
          }
        }
      }
      const devices = Array.from(deviceMap.values()).map((dev: any) => ({
        ...dev,
        connectors: Array.from(dev.connectors.values()),
      }));

      const signalDetails = signals.map((s: any) => {
        const eps = endpoints.filter((ep: any) => ep.signal_id === s.id).map((ep: any) => ({
          endpointId: ep.endpoint_id,
          deviceId: ep.device_id,
          pinId: ep.pin_id,
          connectorId: ep.connector_id,
          设备编号: ep.设备编号,
          针孔号: ep.针孔号,
          设备端元器件编号: ep.设备端元器件编号,
        }));
        const sigEdges = edges.filter((e: any) => e.signal_id === s.id);
        const names = endpoints.filter((ep: any) => ep.signal_id === s.id && ep.信号名称).map((ep: any) => ep.信号名称);
        const 信号名称摘要 = [...new Set(names)].join(' / ') || null;
        return { ...s, 信号名称摘要, endpoints: eps, edges: sigEdges };
      });

      res.json({ groupName: signal.unique_id, signals: signalDetails, devices, ungrouped: true });
    } catch (error: any) {
      console.error('获取单条信号EICD数据失败:', error);
      res.status(500).json({ error: error.message || '获取单条信号EICD数据失败' });
    }
  });

  // GET /api/eicd/:deviceId?project_id=N
  router.get('/:deviceId', authenticate, async (req: AuthRequest, res) => {
    try {
      const deviceId = Number(req.params.deviceId);
      const projectId = Number(req.query.project_id);
      if (!Number.isInteger(deviceId) || !Number.isInteger(projectId) || deviceId <= 0 || projectId <= 0) {
        return res.status(400).json({ error: '缺少 deviceId 或 project_id' });
      }

      // 1. Get the main device
      const mainDevice = await db.get(
        `SELECT id, 设备编号, 设备中文名称, "设备部件所属系统（4位ATA）" as ata FROM devices WHERE id = ? AND project_id = ?`,
        [deviceId, projectId]
      );
      if (!mainDevice) return res.status(404).json({ error: '设备不存在' });

      // 2. Get all connectors & pins for the main device
      const connPinRows = await db.query(
        `SELECT c.id as connector_id, c.设备端元器件编号, p.id as pin_id, p.针孔号
         FROM connectors c
         LEFT JOIN pins p ON p.connector_id = c.id
         WHERE c.device_id = ?
         ORDER BY c.设备端元器件编号, p.针孔号`,
        [deviceId]
      );

      // Group into connector→pins structure
      const connMap = new Map<number, any>();
      for (const row of connPinRows) {
        if (!connMap.has(row.connector_id)) {
          connMap.set(row.connector_id, {
            id: row.connector_id,
            设备端元器件编号: row.设备端元器件编号,
            pins: [],
          });
        }
        if (row.pin_id) {
          connMap.get(row.connector_id)!.pins.push({ id: row.pin_id, 针孔号: row.针孔号 });
        }
      }
      const mainConnectors = Array.from(connMap.values());

      // 3. Find all signals connected to this device via signal_endpoints
      const myEndpoints = await db.query(
        `SELECT se.signal_id, se.pin_id, se.id as endpoint_id
         FROM signal_endpoints se
         JOIN signals s ON se.signal_id = s.id
         WHERE se.device_id = ? AND s.project_id = ?`,
        [deviceId, projectId]
      );
      if (myEndpoints.length === 0) {
        return res.json({
          mainDevice: { ...mainDevice, connectors: mainConnectors },
          remoteDevices: [],
          connections: [],
        });
      }

      // 4. For each signal, get the remote endpoints (not on this device)
      const signalIds = [...new Set(myEndpoints.map((e: any) => e.signal_id))];
      const ph = signalIds.map(() => '?').join(',');

      const remoteEndpoints = await db.query(
        `SELECT se.signal_id, se.pin_id, se.device_id, se.id as endpoint_id,
                se.信号名称 as endpoint_signal_name,
                s.status as signal_status, s.unique_id as signal_unique_id,
                s.signal_group, s.连接类型, s.推荐导线线规, s.推荐导线线型,
                p.针孔号, p.connector_id,
                c.设备端元器件编号,
                d.id as remote_device_id, d.设备编号 as remote_设备编号, d.设备中文名称 as remote_设备中文名称,
                d."设备部件所属系统（4位ATA）" as remote_ata
         FROM signal_endpoints se
         JOIN signals s ON se.signal_id = s.id
         JOIN devices d ON se.device_id = d.id
         LEFT JOIN pins p ON se.pin_id = p.id
         LEFT JOIN connectors c ON p.connector_id = c.id
         WHERE se.signal_id IN (${ph}) AND se.device_id != ?
         ORDER BY d.设备编号, c.设备端元器件编号, p.针孔号`,
        [...signalIds, deviceId]
      );

      // 5. Query signal_edges for direction info
      const edges = await db.query(
        `SELECT signal_id, from_endpoint_id, to_endpoint_id, direction
         FROM signal_edges
         WHERE signal_id IN (${ph})`,
        signalIds
      );
      const edgesBySignal: Record<number, any[]> = {};
      for (const edge of edges) {
        if (!edgesBySignal[edge.signal_id]) edgesBySignal[edge.signal_id] = [];
        edgesBySignal[edge.signal_id].push(edge);
      }

      // 6. Build connections array with direction
      const myEpBySignal: Record<number, any[]> = {};
      for (const ep of myEndpoints) {
        if (!myEpBySignal[ep.signal_id]) myEpBySignal[ep.signal_id] = [];
        myEpBySignal[ep.signal_id].push(ep);
      }

      const connections: any[] = [];
      for (const remote of remoteEndpoints) {
        const myEps = myEpBySignal[remote.signal_id] || [];
        for (const myEp of myEps) {
          if (myEp.pin_id && remote.pin_id) {
            // Determine direction from edges
            let direction = 'unknown';
            const signalEdges = edgesBySignal[remote.signal_id] || [];
            for (const edge of signalEdges) {
              const fromIsMain = edge.from_endpoint_id === myEp.endpoint_id;
              const toIsMain = edge.to_endpoint_id === myEp.endpoint_id;
              const fromIsRemote = edge.from_endpoint_id === remote.endpoint_id;
              const toIsRemote = edge.to_endpoint_id === remote.endpoint_id;

              if (edge.direction === 'bidirectional' && ((fromIsMain && toIsRemote) || (fromIsRemote && toIsMain))) {
                direction = 'bidirectional';
                break;
              }
              if (fromIsMain && toIsRemote) {
                direction = 'toRemote';
                break;
              }
              if (fromIsRemote && toIsMain) {
                direction = 'toMain';
                break;
              }
            }

            connections.push({
              signalId: remote.signal_id,
              signalUniqueId: remote.signal_unique_id,
              signalStatus: remote.signal_status,
              signalGroup: remote.signal_group || null,
              连接类型: remote.连接类型 || null,
              推荐导线线规: remote.推荐导线线规 || null,
              推荐导线线型: remote.推荐导线线型 || null,
              signalName: remote.endpoint_signal_name || null,
              mainPinId: myEp.pin_id,
              remotePinId: remote.pin_id,
              remoteDeviceId: remote.remote_device_id,
              direction,
            });
          }
        }
      }

      // 7. Build remote devices structure
      const remoteDeviceMap = new Map<number, any>();
      for (const remote of remoteEndpoints) {
        if (!remote.pin_id) continue;
        if (!remoteDeviceMap.has(remote.remote_device_id)) {
          remoteDeviceMap.set(remote.remote_device_id, {
            id: remote.remote_device_id,
            设备编号: remote.remote_设备编号,
            设备中文名称: remote.remote_设备中文名称,
            ata: remote.remote_ata || null,
            connectors: new Map<number, any>(),
          });
        }
        const dev = remoteDeviceMap.get(remote.remote_device_id)!;
        if (!dev.connectors.has(remote.connector_id)) {
          dev.connectors.set(remote.connector_id, {
            id: remote.connector_id,
            设备端元器件编号: remote.设备端元器件编号,
            pins: [],
          });
        }
        const conn = dev.connectors.get(remote.connector_id)!;
        if (!conn.pins.some((p: any) => p.id === remote.pin_id)) {
          conn.pins.push({ id: remote.pin_id, 针孔号: remote.针孔号 });
        }
      }

      const remoteDevices = Array.from(remoteDeviceMap.values()).map((dev: any) => ({
        ...dev,
        connectors: Array.from(dev.connectors.values()),
      }));

      // 8. Build signal group completeness info
      const groupNames = [...new Set(connections.map((c: any) => c.signalGroup).filter(Boolean))];
      const signalGroups: Record<string, { present: string[]; missing: string[] }> = {};
      if (groupNames.length > 0) {
        const gph = groupNames.map(() => '?').join(',');
        const allGroupSignals = await db.query(
          `SELECT id, unique_id, signal_group FROM signals
           WHERE signal_group IN (${gph}) AND project_id = ?`,
          [...groupNames, projectId]
        );
        const presentSignalIds = new Set(connections.map((c: any) => c.signalId));
        for (const gn of groupNames) {
          const members = allGroupSignals.filter((s: any) => s.signal_group === gn);
          signalGroups[gn] = {
            present: members.filter((s: any) => presentSignalIds.has(s.id)).map((s: any) => s.unique_id),
            missing: members.filter((s: any) => !presentSignalIds.has(s.id)).map((s: any) => s.unique_id),
          };
        }
      }

      res.json({
        mainDevice: { ...mainDevice, connectors: mainConnectors },
        remoteDevices,
        connections,
        signalGroups,
      });
    } catch (error: any) {
      console.error('获取EICD数据失败:', error);
      res.status(500).json({ error: error.message || '获取EICD数据失败' });
    }
  });

  return router;
}
