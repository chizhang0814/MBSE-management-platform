import express from 'express';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export function eicdRoutes(db: Database) {
  const router = express.Router();

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
        `SELECT id, 设备编号, 设备中文名称 FROM devices WHERE id = ? AND project_id = ?`,
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
        `SELECT se.signal_id, se.pin_id, se.device_id,
                s.status as signal_status, s.unique_id as signal_unique_id,
                p.针孔号, p.connector_id,
                c.设备端元器件编号,
                d.id as remote_device_id, d.设备编号 as remote_设备编号, d.设备中文名称 as remote_设备中文名称
         FROM signal_endpoints se
         JOIN signals s ON se.signal_id = s.id
         JOIN devices d ON se.device_id = d.id
         LEFT JOIN pins p ON se.pin_id = p.id
         LEFT JOIN connectors c ON p.connector_id = c.id
         WHERE se.signal_id IN (${ph}) AND se.device_id != ?
         ORDER BY d.设备编号, c.设备端元器件编号, p.针孔号`,
        [...signalIds, deviceId]
      );

      // 5. Build connections array
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
            connections.push({
              signalId: remote.signal_id,
              signalUniqueId: remote.signal_unique_id,
              signalStatus: remote.signal_status,
              mainPinId: myEp.pin_id,
              remotePinId: remote.pin_id,
              remoteDeviceId: remote.remote_device_id,
            });
          }
        }
      }

      // 6. Build remote devices structure
      const remoteDeviceMap = new Map<number, any>();
      for (const remote of remoteEndpoints) {
        if (!remote.pin_id) continue;
        if (!remoteDeviceMap.has(remote.remote_device_id)) {
          remoteDeviceMap.set(remote.remote_device_id, {
            id: remote.remote_device_id,
            设备编号: remote.remote_设备编号,
            设备中文名称: remote.remote_设备中文名称,
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

      res.json({
        mainDevice: { ...mainDevice, connectors: mainConnectors },
        remoteDevices,
        connections,
      });
    } catch (error: any) {
      console.error('获取EICD数据失败:', error);
      res.status(500).json({ error: error.message || '获取EICD数据失败' });
    }
  });

  return router;
}
