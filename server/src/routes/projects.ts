import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import fs from 'fs';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';
import { generateSysml, TableData } from '../services/sysml-generator.js';
import { SysmlApiClient } from '../services/sysml-api-client.js';
import { syncToSysmlApi } from '../services/sysml-sync.js';
import { loadTableDataFromRelational } from '../services/sysml-data-extractor.js';
import {
  DEVICES_EXCEL_TO_DB,
  CONNECTORS_EXCEL_TO_DB,
  PINS_EXCEL_TO_DB,
  SIGNALS_EXCEL_TO_DB,
} from '../shared/column-schema.js';

export function projectRoutes(db: Database) {
  const router = express.Router();

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
  });
  const upload = multer({ storage });

  // ── 辅助：将 Excel 表头映射到 DB 列名 ──────────────────────

  function resolveColumn(header: string, mapping: Record<string, string>): string | null {
    // 先规范化：去除列名内部的换行符和多余空格（Excel 单元格常见）
    const trimmed = header.replace(/[\r\n\t]+/g, '').trim();
    if (mapping[trimmed]) return mapping[trimmed];
    // 模糊：遍历 mapping keys，找包含关系
    for (const [key, val] of Object.entries(mapping)) {
      if (trimmed.includes(key) || key.includes(trimmed)) return val;
    }
    return null;
  }

  /** 规范化 xlsx 读出的行对象，将列名中的换行/制表符清除并 trim */
  function normalizeRowKeys(row: any): any {
    const out: any = {};
    for (const [k, v] of Object.entries(row)) {
      const normKey = String(k).replace(/[\r\n\t]+/g, '').trim();
      if (!(normKey in out)) out[normKey] = v; // 保留首次出现的 key
    }
    return out;
  }

  // ── 所有项目名称（供权限申请下拉使用，所有登录用户可访问）──
  router.get('/names', authenticate, async (_req, res) => {
    try {
      const projects = await db.query('SELECT id, name FROM projects ORDER BY name');
      res.json({ projects });
    } catch (error) {
      res.status(500).json({ error: '获取项目列表失败' });
    }
  });

  // ── 获取项目列表 ──────────────────────────────────────────

  router.get('/', authenticate, async (req: any, res) => {
    try {
      const userRole = req.user?.role;
      const username = req.user?.username;

      let projects;

      if (userRole === 'admin') {
        projects = await db.query(`
          SELECT p.*, u.username as created_by_name,
                 (SELECT COUNT(DISTINCT d.id) FROM devices d WHERE d.project_id = p.id) as device_count
          FROM projects p
          JOIN users u ON p.created_by = u.id
          ORDER BY p.created_at DESC
        `);
      } else {
        // 普通用户：通过 devices.设备负责人 OR 用户 permissions 字段中的项目名称 过滤
        const userRow = await db.get('SELECT permissions FROM users WHERE username = ?', [username]);
        const permissions: Array<{ project_name: string }> = userRow?.permissions
          ? JSON.parse(userRow.permissions)
          : [];
        const permProjectNames = permissions.map((p: any) => p.project_name);

        // 构建 IN 占位符
        const placeholders = permProjectNames.length > 0
          ? permProjectNames.map(() => '?').join(', ')
          : null;

        const sql = placeholders
          ? `SELECT DISTINCT p.*, u.username as created_by_name,
                   (SELECT COUNT(DISTINCT d2.id) FROM devices d2 WHERE d2.project_id = p.id) as device_count
             FROM projects p
             JOIN users u ON p.created_by = u.id
             WHERE p.id IN (
               SELECT DISTINCT d.project_id FROM devices d WHERE d.设备负责人 = ?
             ) OR p.name IN (${placeholders})
             ORDER BY p.created_at DESC`
          : `SELECT DISTINCT p.*, u.username as created_by_name,
                   (SELECT COUNT(DISTINCT d2.id) FROM devices d2 WHERE d2.project_id = p.id) as device_count
             FROM projects p
             JOIN users u ON p.created_by = u.id
             WHERE p.id IN (
               SELECT DISTINCT d.project_id FROM devices d WHERE d.设备负责人 = ?
             )
             ORDER BY p.created_at DESC`;

        projects = await db.query(sql, [username, ...permProjectNames]);
      }

      // 统一返回 table_count 字段供旧前端兼容
      projects = projects.map((p: any) => ({ ...p, table_count: 3 }));

      res.json({ projects });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取项目列表失败' });
    }
  });

  // SysML v2 API 健康检查（放在 /:id 之前）
  router.get('/sysml-api/health', authenticate, async (req, res) => {
    try {
      const client = new SysmlApiClient();
      const available = await client.healthCheck();
      res.json({ available });
    } catch {
      res.json({ available: false });
    }
  });

  // ── 获取单个项目 ──────────────────────────────────────────

  router.get('/:id', authenticate, async (req, res) => {
    try {
      const project = await db.get(
        `SELECT p.*, u.username as created_by_name
         FROM projects p JOIN users u ON p.created_by = u.id
         WHERE p.id = ?`,
        [req.params.id]
      );
      if (!project) return res.status(404).json({ error: '项目不存在' });

      // 提供兼容性 tables 字段（空数组即可，新 UI 不用）
      project.tables = [];
      res.json({ project });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取项目详情失败' });
    }
  });

  // ── 创建项目（仅管理员）──────────────────────────────────

  router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { name, description } = req.body;
      const userId = req.user!.id;

      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: '项目名称不能为空' });
      }

      const existing = await db.get('SELECT id FROM projects WHERE name = ?', [name.trim()]);
      if (existing) return res.status(400).json({ error: '项目名称已存在' });

      const result = await db.run(
        'INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)',
        [name.trim(), description || null, userId]
      );

      res.json({
        success: true,
        message: '项目创建成功',
        project: { id: result.lastID, name: name.trim(), description }
      });
    } catch (error: any) {
      console.error('创建项目失败:', error);
      res.status(500).json({ error: error.message || '创建项目失败' });
    }
  });

  // ── 更新项目（仅管理员）──────────────────────────────────

  router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const { name, description } = req.body;
      const projectId = parseInt(req.params.id);

      const existing = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!existing) return res.status(404).json({ error: '项目不存在' });

      if (name && name.trim() !== existing.name) {
        const dup = await db.get('SELECT id FROM projects WHERE name = ? AND id != ?', [name.trim(), projectId]);
        if (dup) return res.status(400).json({ error: '项目名称已存在' });
      }

      const updates: string[] = [];
      const params: any[] = [];
      if (name) { updates.push('name = ?'); params.push(name.trim()); }
      if (description !== undefined) { updates.push('description = ?'); params.push(description || null); }
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(projectId);

      await db.run(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, params);
      res.json({ success: true, message: '项目更新成功' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '更新项目失败' });
    }
  });

  // ── 删除项目（仅管理员）──────────────────────────────────

  router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const existing = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!existing) return res.status(404).json({ error: '项目不存在' });

      // CASCADE 会自动删除 devices→connectors→pins→signals→signal_endpoints
      await db.run('DELETE FROM projects WHERE id = ?', [projectId]);
      res.json({ success: true, message: '项目删除成功' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '删除项目失败' });
    }
  });

  // ── 导入数据（整本3-Sheet xlsx）──────────────────────────

  router.post(
    '/:id/import-data',
    authenticate,
    requireRole('admin'),
    upload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        const projectId = parseInt(req.params.id);
        if (!req.file) return res.status(400).json({ error: '未选择文件' });

        const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
        if (!project) return res.status(404).json({ error: '项目不存在' });

        const workbook = xlsx.readFile(req.file.path);

        if (workbook.SheetNames.length < 1) {
          return res.status(400).json({ error: 'Excel 文件无 Sheet' });
        }

        const results: Record<string, any> = {};


        // ─── Sheet 0: ATA设备表 → devices ────────────────────

        const sheet0 = workbook.Sheets[workbook.SheetNames[0]];
        const rows0: any[] = xlsx.utils.sheet_to_json(sheet0, { defval: '' }).map(normalizeRowKeys);
        let s0Success = 0, s0Skipped = 0, s0Error = 0;
        const s0Errors: string[] = [];

        for (let i = 0; i < rows0.length; i++) {
          const row = rows0[i];
          const rowNum = i + 2;
          try {
            const insertFields: Record<string, any> = {};
            for (const [excelCol, val] of Object.entries(row)) {
              const dbCol = resolveColumn(excelCol, DEVICES_EXCEL_TO_DB);
              if (dbCol) insertFields[dbCol] = val !== undefined && val !== null ? String(val) : '';
            }

            if (!insertFields['设备编号'] || String(insertFields['设备编号']).trim() === '') {
              s0Error++;
              s0Errors.push(`第${rowNum}行: 设备编号为空，跳过`);
              continue;
            }

            const deviceNum = String(insertFields['设备编号']).trim();
            insertFields['设备编号'] = deviceNum;

            // 跳过已存在的设备（方案B：不覆盖）
            const cols = Object.keys(insertFields).map(k => `"${k}"`).join(', ');
            const placeholders = Object.keys(insertFields).map(() => '?').join(', ');
            const r0 = await db.run(
              `INSERT INTO devices (project_id, ${cols})
               VALUES (?, ${placeholders})
               ON CONFLICT(project_id, 设备编号) DO NOTHING`,
              [projectId, ...Object.values(insertFields)]
            );
            if (r0.changes === 0) { s0Skipped++; } else { s0Success++; }
          } catch (err: any) {
            s0Error++;
            s0Errors.push(`第${rowNum}行: ${err.message}`);
          }
        }
        results['sheet0'] = { name: workbook.SheetNames[0], success: s0Success, skipped: s0Skipped, errors: s0Errors };

        // ─── Sheet 1: 设备端元器件表 → connectors + pins ─────

        let s1Success = 0, s1Skipped = 0, s1Error = 0;
        const s1Errors: string[] = [];

        if (workbook.SheetNames.length >= 2) {
          const sheet1 = workbook.Sheets[workbook.SheetNames[1]];
          const rows1: any[] = xlsx.utils.sheet_to_json(sheet1, { defval: '' }).map(normalizeRowKeys);

          for (let i = 0; i < rows1.length; i++) {
            const row = rows1[i];
            const rowNum = i + 2;
            try {
              // 从行中提取所有字段
              const allFields: Record<string, any> = {};
              for (const [excelCol, val] of Object.entries(row)) {
                allFields[excelCol.trim()] = val !== undefined && val !== null ? String(val) : '';
              }

              // 找设备编号（用于查 device_id）
              const deviceNumRaw =
                allFields['设备编号'] ||
                Object.entries(allFields).find(([k]) => k.includes('设备编号'))?.[1] || '';
              const deviceNum = String(deviceNumRaw).trim();
              if (!deviceNum) {
                s1Error++;
                s1Errors.push(`第${rowNum}行: 设备编号为空，跳过`);
                continue;
              }

              const device = await db.get(
                'SELECT id FROM devices WHERE project_id = ? AND 设备编号 = ?',
                [projectId, deviceNum]
              );
              if (!device) {
                s1Error++;
                s1Errors.push(`第${rowNum}行: 找不到设备 ${deviceNum}`);
                continue;
              }

              // 找连接器号（"设备端元器件编号"也可作为连接器号来源）
              const connectorNumRaw =
                allFields['连接器号'] ||
                allFields['端元器件号（连接器号）'] ||
                allFields['端元器件号'] ||
                allFields['设备端元器件编号'] ||
                Object.entries(allFields).find(([k]) => k.includes('连接器号') || k.includes('端元器件号'))?.[1] || '';
              // 剥离 "设备编号-" 前缀（设备端元器件编号格式为 {设备编号}-{连接器号}）
              let connectorNum = String(connectorNumRaw).trim();
              const connPrefix = deviceNum + '-';
              if (connectorNum.startsWith(connPrefix)) {
                connectorNum = connectorNum.slice(connPrefix.length);
              }
              if (!connectorNum) {
                s1Error++;
                s1Errors.push(`第${rowNum}行: 连接器号为空，跳过`);
                continue;
              }

              // 构建 connectors 插入字段
              const connFields: Record<string, any> = { '连接器号': connectorNum };
              for (const [excelCol, val] of Object.entries(allFields)) {
                const dbCol = resolveColumn(excelCol, CONNECTORS_EXCEL_TO_DB);
                if (dbCol && dbCol !== '设备编号') {
                  connFields[dbCol] = val !== undefined && val !== null ? String(val) : '';
                }
              }

              // 跳过已存在的连接器（方案B：不覆盖）
              const connCols = Object.keys(connFields).map(k => `"${k}"`).join(', ');
              const connPlaceholders = Object.keys(connFields).map(() => '?').join(', ');
              const connResult = await db.run(
                `INSERT INTO connectors (device_id, ${connCols})
                 VALUES (?, ${connPlaceholders})
                 ON CONFLICT(device_id, 连接器号) DO NOTHING`,
                [device.id, ...Object.values(connFields)]
              );
              const connIsNew = connResult.changes > 0;

              // 获取 connector_id
              const connector = await db.get(
                'SELECT id FROM connectors WHERE device_id = ? AND 连接器号 = ?',
                [device.id, connectorNum]
              );
              if (!connector) {
                s1Error++;
                s1Errors.push(`第${rowNum}行: 连接器插入失败`);
                continue;
              }

              // 如果有针孔号，尝试插入 pin（跳过已存在）
              let pinIsNew = false;
              const pinNumRaw =
                allFields['针孔号'] ||
                Object.entries(allFields).find(([k]) => k.includes('针孔号'))?.[1] || '';
              const pinNum = String(pinNumRaw).trim();
              if (pinNum) {
                const pinFields: Record<string, any> = { '针孔号': pinNum };
                for (const [excelCol, val] of Object.entries(allFields)) {
                  const dbCol = resolveColumn(excelCol, PINS_EXCEL_TO_DB);
                  if (dbCol && dbCol !== '针孔号') {
                    pinFields[dbCol] = val !== undefined && val !== null ? String(val) : '';
                  }
                }
                const pinCols = Object.keys(pinFields).map(k => `"${k}"`).join(', ');
                const pinPlaceholders = Object.keys(pinFields).map(() => '?').join(', ');
                const pinResult = await db.run(
                  `INSERT INTO pins (connector_id, ${pinCols})
                   VALUES (?, ${pinPlaceholders})
                   ON CONFLICT(connector_id, 针孔号) DO NOTHING`,
                  [connector.id, ...Object.values(pinFields)]
                );
                pinIsNew = pinResult.changes > 0;
              }

              if (connIsNew || pinIsNew) { s1Success++; } else { s1Skipped++; }
            } catch (err: any) {
              s1Error++;
              s1Errors.push(`第${rowNum}行: ${err.message}`);
            }
          }
        }
        results['sheet1'] = { name: workbook.SheetNames[1] || 'Sheet2', success: s1Success, skipped: s1Skipped, errors: s1Errors };

        // ─── 自动检测 Sheet 2+ 角色：针孔表 or 信号表 ────────

        let pinsSheetIdx = -1;
        let signalsSheetIdx = -1;

        if (workbook.SheetNames.length >= 3) {
          const peekSheet = workbook.Sheets[workbook.SheetNames[2]];
          const peekRows: any[] = xlsx.utils.sheet_to_json(peekSheet, { defval: '' }).map(normalizeRowKeys);
          const peekHeaders: string[] = peekRows.length > 0
            ? Object.keys(peekRows[0]).map(h => h.trim())
            : [];
          const looksLikePins =
            peekHeaders.some(h => h === '针孔号') &&
            !peekHeaders.some(h => h === 'Unique ID' || h.includes('信号名称') || h.includes('信号定义'));

          if (looksLikePins) {
            pinsSheetIdx = 2;
            if (workbook.SheetNames.length >= 4) signalsSheetIdx = 3;
          } else {
            signalsSheetIdx = 2; // 传统3-sheet格式
          }
        }

        // ─── 针孔表（若检测到）→ pins ────────────────────────

        let sPinsSuccess = 0, sPinsSkipped = 0, sPinsError = 0;
        const sPinsErrors: string[] = [];

        if (pinsSheetIdx !== -1) {
          const sheetP = workbook.Sheets[workbook.SheetNames[pinsSheetIdx]];
          const rowsP: any[] = xlsx.utils.sheet_to_json(sheetP, { defval: '' }).map(normalizeRowKeys);

          for (let i = 0; i < rowsP.length; i++) {
            const row = rowsP[i];
            const rowNum = i + 2;
            try {
              const allFields: Record<string, any> = {};
              for (const [excelCol, val] of Object.entries(row)) {
                allFields[excelCol.trim()] = val !== undefined && val !== null ? String(val) : '';
              }

              // 找设备编号
              const deviceNumRaw =
                allFields['设备编号'] ||
                Object.entries(allFields).find(([k]) => k.includes('设备编号'))?.[1] || '';
              const deviceNum = String(deviceNumRaw).trim();
              if (!deviceNum) {
                sPinsError++;
                sPinsErrors.push(`第${rowNum}行: 设备编号为空，跳过`);
                continue;
              }

              const device = await db.get(
                'SELECT id FROM devices WHERE project_id = ? AND 设备编号 = ?',
                [projectId, deviceNum]
              );
              if (!device) {
                sPinsError++;
                sPinsErrors.push(`第${rowNum}行: 找不到设备 ${deviceNum}`);
                continue;
              }

              // 找连接器号（支持 设备端元器件编号 作为来源）
              const connectorNumRaw =
                allFields['连接器号'] ||
                allFields['端元器件号（连接器号）'] ||
                allFields['端元器件号'] ||
                allFields['设备端元器件编号'] ||
                Object.entries(allFields).find(([k]) => k.includes('连接器号') || k.includes('端元器件号'))?.[1] || '';
              // 剥离 "设备编号-" 前缀（设备端元器件编号格式为 {设备编号}-{连接器号}）
              let connectorNum = String(connectorNumRaw).trim();
              const connPrefixP = deviceNum + '-';
              if (connectorNum.startsWith(connPrefixP)) {
                connectorNum = connectorNum.slice(connPrefixP.length);
              }
              if (!connectorNum) {
                sPinsError++;
                sPinsErrors.push(`第${rowNum}行: 连接器号为空，跳过`);
                continue;
              }

              const connector = await db.get(
                'SELECT id FROM connectors WHERE device_id = ? AND 连接器号 = ?',
                [device.id, connectorNum]
              );
              if (!connector) {
                sPinsError++;
                sPinsErrors.push(`第${rowNum}行: 找不到连接器 ${deviceNum}.${connectorNum}`);
                continue;
              }

              // 找针孔号
              const pinNumRaw =
                allFields['针孔号'] ||
                Object.entries(allFields).find(([k]) => k.includes('针孔号'))?.[1] || '';
              const pinNum = String(pinNumRaw).trim();
              if (!pinNum) {
                sPinsError++;
                sPinsErrors.push(`第${rowNum}行: 针孔号为空，跳过`);
                continue;
              }

              // 构建 pin 字段
              const pinFields: Record<string, any> = { '针孔号': pinNum };
              for (const [excelCol, val] of Object.entries(allFields)) {
                const dbCol = resolveColumn(excelCol, PINS_EXCEL_TO_DB);
                if (dbCol && dbCol !== '针孔号') {
                  pinFields[dbCol] = val !== undefined && val !== null ? String(val) : '';
                }
              }

              const pinCols = Object.keys(pinFields).map(k => `"${k}"`).join(', ');
              const pinPlaceholders = Object.keys(pinFields).map(() => '?').join(', ');
              const pinResult = await db.run(
                `INSERT INTO pins (connector_id, ${pinCols})
                 VALUES (?, ${pinPlaceholders})
                 ON CONFLICT(connector_id, 针孔号) DO NOTHING`,
                [connector.id, ...Object.values(pinFields)]
              );
              if (pinResult.changes === 0) { sPinsSkipped++; } else { sPinsSuccess++; }
            } catch (err: any) {
              sPinsError++;
              sPinsErrors.push(`第${rowNum}行: ${err.message}`);
            }
          }
          results[`sheet${pinsSheetIdx}`] = {
            name: workbook.SheetNames[pinsSheetIdx],
            success: sPinsSuccess,
            skipped: sPinsSkipped,
            errors: sPinsErrors,
          };
        }

        // ─── 信号表 → signals + signal_endpoints ─────────────

        let s2Success = 0, s2Skipped = 0, s2Error = 0;
        const s2Errors: string[] = [];

        if (signalsSheetIdx !== -1) {
          const sheet2 = workbook.Sheets[workbook.SheetNames[signalsSheetIdx]];
          const rows2: any[] = xlsx.utils.sheet_to_json(sheet2, { defval: '' }).map(normalizeRowKeys);

          // （从）/（到）端点列名集合 —— 这些列作为端点数据单独处理，不写入 sigFields
          const ENDPOINT_ONLY_COLS = new Set([
            '设备（从）', '连接器（从）', '针孔号（从）', '端接尺寸（从）', '屏蔽类型（从）', '信号名称（从）', '信号定义（从）',
            '设备（到）', '连接器（到）', '针孔号（到）', '端接尺寸（到）', '屏蔽类型（到）',
            '信号名称（到）', '信号定义（到）',
          ]);

          for (let i = 0; i < rows2.length; i++) {
            const row = rows2[i];
            const rowNum = i + 2;
            try {
              const sigFields: Record<string, any> = {};
              let devicesRaw: any = null;

              for (const [excelCol, val] of Object.entries(row)) {
                const trimCol = excelCol.trim();
                // 跳过端点专用列（由后续逻辑处理）
                if (ENDPOINT_ONLY_COLS.has(trimCol)) continue;
                // 特殊处理：设备 JSON 列
                if (trimCol === '设备' || trimCol === '设备(JSON)') {
                  devicesRaw = val;
                  continue;
                }
                const dbCol = resolveColumn(trimCol, SIGNALS_EXCEL_TO_DB);
                if (dbCol) {
                  sigFields[dbCol] = val !== undefined && val !== null ? String(val) : '';
                }
              }

              // 跳过已存在的信号（按 unique_id 查重）
              if (sigFields['unique_id'] && sigFields['unique_id'] !== '') {
                const dup = await db.get(
                  'SELECT id FROM signals WHERE project_id = ? AND unique_id = ?',
                  [projectId, sigFields['unique_id']]
                );
                if (dup) { s2Skipped++; continue; }
              }

              // 自动生成 unique_id
              if ((!sigFields['unique_id'] || sigFields['unique_id'] === '') && sigFields['连接类型']) {
                const connType = sigFields['连接类型'];
                let prefix = '';
                if (connType === '1to1信号' || connType === '1to1') prefix = 'DATA_';
                else if (connType === '网络') prefix = 'NET_';
                else if (connType === 'ERN' || connType === '接地') prefix = 'ERN_';
                if (prefix) {
                  const existingIds = await db.query(
                    `SELECT unique_id FROM signals WHERE project_id = ? AND unique_id LIKE ?`,
                    [projectId, `${prefix}%`]
                  );
                  let maxNum = 0;
                  for (const r of existingIds) {
                    const match = r.unique_id?.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`));
                    if (match) { const n = parseInt(match[1], 10); if (n > maxNum) maxNum = n; }
                  }
                  sigFields['unique_id'] = `${prefix}${String(maxNum + 1).padStart(5, '0')}`;
                }
              }

              // ── 解析端点（在 INSERT signal 之前，便于整行校验）──────────────
              // 优先级1：（从）/（到）列格式
              // 优先级2：设备 JSON 列
              // 优先级3：扁平 _N 后缀列
              let endpointList: any[] = [];

              const fromDev = String(row['设备（从）'] || '').trim();
              const fromConn = String(row['连接器（从）'] || '').trim();
              const fromPin = String(row['针孔号（从）'] || '').trim();
              const toDev = String(row['设备（到）'] || '').trim();
              const toConn = String(row['连接器（到）'] || '').trim();
              const toPin = String(row['针孔号（到）'] || '').trim();

              if (fromDev || fromPin || toDev || toPin) {
                // （从）/（到）格式
                if (fromDev || fromConn || fromPin) {
                  endpointList.push({
                    '设备编号': fromDev,
                    '连接器号': fromConn,
                    '针孔号': fromPin,
                    '屏蔽类型': String(row['屏蔽类型（从）'] || '').trim(),
                    '端接尺寸': String(row['端接尺寸（从）'] || '').trim(),
                    '信号名称': String(row['信号名称（从）'] || '').trim(),
                    '信号定义': String(row['信号定义（从）'] || '').trim(),
                  });
                }
                if (toDev || toConn || toPin) {
                  endpointList.push({
                    '设备编号': toDev,
                    '连接器号': toConn,
                    '针孔号': toPin,
                    '屏蔽类型': String(row['屏蔽类型（到）'] || '').trim(),
                    '端接尺寸': String(row['端接尺寸（到）'] || '').trim(),
                    '信号名称': String(row['信号名称（到）'] || '').trim(),
                    '信号定义': String(row['信号定义（到）'] || '').trim(),
                  });
                }
              } else if (devicesRaw) {
                try {
                  const parsed = typeof devicesRaw === 'string' ? JSON.parse(devicesRaw) : devicesRaw;
                  const list = Array.isArray(parsed) ? parsed : [parsed];
                  for (const item of list) {
                    endpointList.push({
                      '设备编号': String(item['设备编号'] || '').trim(),
                      '连接器号': String(item['连接器号'] || item['端元器件号'] || '').trim(),
                      '针孔号': String(item['针孔号'] || '').trim(),
                      '屏蔽类型': String(item['屏蔽类型'] || '').trim(),
                      '端接尺寸': String(item['端接尺寸'] || '').trim(),
                    });
                  }
                } catch { /* 跳过无效JSON */ }
              } else {
                // 扁平列 设备编号_1, 连接器号_1, 针孔号_1 等
                for (let n = 1; n <= 10; n++) {
                  const devNum = row[`设备编号_${n}`] || row[`设备编号${n}`] || '';
                  const connNum = row[`连接器号_${n}`] || row[`端元器件号_${n}`] || row[`连接器号${n}`] || '';
                  const pinNum = row[`针孔号_${n}`] || row[`针孔号${n}`] || '';
                  if (!devNum && !connNum && !pinNum) break;
                  endpointList.push({
                    '设备编号': String(devNum).trim(),
                    '连接器号': String(connNum).trim(),
                    '针孔号': String(pinNum).trim(),
                    '屏蔽类型': String(row[`屏蔽类型_${n}`] || row[`屏蔽类型${n}`] || '').trim(),
                    '端接尺寸': String(row[`端接尺寸_${n}`] || row[`端接尺寸${n}`] || '').trim(),
                  });
                }
              }

              // ── 预校验 + 解析端点（INSERT signal 之前）────────────────────
              // 同时检查：① 连接器前缀与设备编号一致；② 设备在库中存在；③ 连接器在设备中存在
              // 任一端点不通过 → 跳过整行（不插入 signal）
              let rowValidationFailed = false;
              type ResolvedEp = { ep: any; connNum: string; device: any; connectorRow: any; rawConnNum: string; pinNum: string; epIndex: number };
              const resolvedEndpoints: ResolvedEp[] = [];

              for (let idx = 0; idx < endpointList.length; idx++) {
                const ep = endpointList[idx];
                const devIdentifier = String(ep['设备编号'] || '').trim();
                const rawConnNum = String(ep['连接器号'] || ep['端元器件号（连接器号）'] || ep['端元器件号'] || '').trim();
                const pinNum = String(ep['针孔号'] || '').trim();
                const epLabel = idx === 0 ? '（从）' : '（到）';

                // 三项均空：跳过此端点（不报错）
                if (!devIdentifier && !rawConnNum && !pinNum) continue;

                // ① 前缀校验
                let connNum: string;
                if (!rawConnNum) {
                  s2Error++;
                  s2Errors.push(`第${rowNum}行: 端点${epLabel}连接器号为空，跳过整行`);
                  rowValidationFailed = true;
                  break;
                } else if (rawConnNum.startsWith(devIdentifier + '-')) {
                  connNum = rawConnNum.slice(devIdentifier.length + 1);
                } else if (!rawConnNum.includes('-')) {
                  connNum = rawConnNum;
                } else {
                  const lastDash = rawConnNum.lastIndexOf('-');
                  const actualPrefix = rawConnNum.slice(0, lastDash);
                  s2Error++;
                  s2Errors.push(
                    `第${rowNum}行: 连接器${epLabel}"${rawConnNum}"的设备前缀"${actualPrefix}"与设备${epLabel}"${devIdentifier}"不一致，请检查数据，跳过整行`
                  );
                  rowValidationFailed = true;
                  break;
                }

                // ② 设备存在性校验
                const device = await db.get(
                  `SELECT id FROM devices WHERE project_id = ? AND (设备编号 = ? OR 设备中文名称 = ? OR 设备英文缩写 = ?)`,
                  [projectId, devIdentifier, devIdentifier, devIdentifier]
                );
                if (!device) {
                  s2Error++;
                  s2Errors.push(`第${rowNum}行: 找不到设备${epLabel}"${devIdentifier}"，请检查数据，跳过整行`);
                  rowValidationFailed = true;
                  break;
                }

                // ③ 连接器存在性校验
                const connectorRow = await db.get(
                  `SELECT id FROM connectors WHERE device_id = ? AND 连接器号 = ?`,
                  [device.id, connNum]
                );
                if (!connectorRow) {
                  s2Error++;
                  s2Errors.push(`第${rowNum}行: 设备${epLabel}"${devIdentifier}"中找不到连接器${epLabel}"${connNum}"，请检查数据，跳过整行`);
                  rowValidationFailed = true;
                  break;
                }

                resolvedEndpoints.push({ ep, connNum, device, connectorRow, rawConnNum, pinNum, epIndex: idx });
              }
              if (rowValidationFailed) continue;

              // 插入 signal
              const sigCols = Object.keys(sigFields).map(k => `"${k}"`).join(', ');
              const sigPlaceholders = Object.keys(sigFields).map(() => '?').join(', ');
              const sigResult = await db.run(
                `INSERT INTO signals (project_id${sigCols ? ', ' + sigCols : ''})
                 VALUES (?${sigPlaceholders ? ', ' + sigPlaceholders : ''})`,
                [projectId, ...Object.values(sigFields)]
              );
              const signalId = sigResult.lastID;

              // ── 处理端点：查找或创建 pin，再写 signal_endpoints ──
              // 连接器已在预校验阶段确认存在，直接使用 resolvedEndpoints 中的结果
              for (const { ep, connectorRow, pinNum, epIndex } of resolvedEndpoints) {

                // 查找针孔，不存在则自动创建（补充端接尺寸）
                let pinRow = await db.get(
                  `SELECT id FROM pins WHERE connector_id = ? AND 针孔号 = ?`,
                  [connectorRow.id, pinNum]
                );
                if (!pinRow) {
                  const termSize = ep['端接尺寸'] || null;
                  const shieldType = ep['屏蔽类型'] || null;
                  const pinRes = await db.run(
                    `INSERT INTO pins (connector_id, 针孔号, 端接尺寸, 屏蔽类型) VALUES (?, ?, ?, ?) ON CONFLICT(connector_id, 针孔号) DO NOTHING`,
                    [connectorRow.id, pinNum, termSize, shieldType]
                  );
                  if (pinRes.changes > 0) {
                    pinRow = { id: pinRes.lastID };
                  } else {
                    pinRow = await db.get(
                      `SELECT id FROM pins WHERE connector_id = ? AND 针孔号 = ?`,
                      [connectorRow.id, pinNum]
                    );
                  }
                }
                if (!pinRow) continue;

                await db.run(
                  `INSERT INTO signal_endpoints (signal_id, pin_id, endpoint_index, 端接尺寸, 信号名称, 信号定义)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [signalId, pinRow.id, epIndex, ep['端接尺寸'] || null, ep['信号名称'] || null, ep['信号定义'] || null]
                );
              }

              s2Success++;
            } catch (err: any) {
              s2Error++;
              s2Errors.push(`第${rowNum}行: ${err.message}`);
            }
          }
          results[`sheet${signalsSheetIdx}`] = {
            name: workbook.SheetNames[signalsSheetIdx],
            success: s2Success,
            skipped: s2Skipped,
            errors: s2Errors,
          };
        }

        // 合并所有 Sheet 的错误详情
        const allErrors: string[] = [
          ...s0Errors,
          ...s1Errors,
          ...sPinsErrors,
          ...s2Errors,
        ];
        const errorDetailsJson = JSON.stringify(allErrors);

        // 记录上传文件
        const fileSize = fs.statSync(req.file.path).size;
        await db.run(
          `INSERT INTO uploaded_files (filename, original_filename, table_name, uploaded_by, total_rows, success_count, error_count, file_size, status, error_details)
           VALUES (?, ?, 'relational_import', ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.file.filename,
            req.file.originalname,
            req.user!.id,
            s0Success + s1Success + sPinsSuccess + s2Success + s0Error + s1Error + sPinsError + s2Error,
            s0Success + s1Success + sPinsSuccess + s2Success,
            s0Error + s1Error + sPinsError + s2Error,
            fileSize,
            'completed',
            errorDetailsJson
          ]
        );

        res.json({
          success: true,
          message: '导入完成',
          results
        });
      } catch (error: any) {
        console.error('导入项目数据失败:', error);
        res.status(500).json({ error: error.message || '导入项目数据失败' });
      }
    }
  );

  // ── 下载项目数据（从5表重建3-Sheet xlsx）─────────────────

  router.get('/:id/download', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!project) return res.status(404).json({ error: '项目不存在' });

      const tablesData = await loadTableDataFromRelational(db, projectId);

      const workbook = xlsx.utils.book_new();
      const sheetNames = ['ATA章节设备表', '设备端元器件表', '电气接口数据表'];

      for (let i = 0; i < tablesData.length; i++) {
        const td = tablesData[i];
        const rows: any[][] = [td.originalColumns];
        for (const row of td.rows) {
          const dataRow = td.originalColumns.map(col => {
            const v = row[col] ?? row[col.replace(/[^\w\u4e00-\u9fa5]/g, '_')] ?? '';
            if (typeof v === 'object' && v !== null) {
              try { return JSON.stringify(v, null, 2); } catch { return String(v); }
            }
            return v;
          });
          rows.push(dataRow);
        }
        const ws = xlsx.utils.aoa_to_sheet(rows);
        xlsx.utils.book_append_sheet(workbook, ws, sheetNames[i]);
      }

      // ── 全机设备清单 Sheet ──────────────────────────────────
      const adlCols = [
        'Object Identifier', '系统名称', 'Object Text', '设备编号（DOORS）', '设备LIN号（DOORS）',
        '设备布置区域', '飞机构型', '是否有供应商数模', '是否已布置在样机',
        '电设备编号', '是否有EICD', '是否确认设备选型', '是否已确认MICD', '模型成熟度',
      ];
      const adlDbCols = [
        'object_identifier', '系统名称', 'object_text', '设备编号_DOORS', 'LIN号_DOORS',
        '设备布置区域', '飞机构型', '是否有供应商数模', '是否已布置在样机',
        '电设备编号', '是否有EICD', '是否确认设备选型', '是否已确认MICD', '模型成熟度',
      ];
      const adlRows = await db.query(
        'SELECT * FROM aircraft_device_list WHERE project_id = ? ORDER BY id',
        [projectId]
      );
      const adlSheetData: any[][] = [adlCols];
      for (const row of adlRows) {
        adlSheetData.push(adlDbCols.map(col => row[col] ?? ''));
      }
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(adlSheetData), '全机设备清单');

      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      const filename = `${project.name}_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('下载项目数据失败:', error);
      res.status(500).json({ error: error.message || '下载项目数据失败' });
    }
  });

  // ── 导出 SysML v2 文本 ────────────────────────────────────

  router.get('/:id/export-sysml', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!project) return res.status(404).json({ error: '项目不存在' });

      const tablesData = await loadTableDataFromRelational(db, projectId);
      const sysmlText = generateSysml(project.name, tablesData);

      const filename = `${project.name}_${new Date().toISOString().split('T')[0]}.sysml`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(sysmlText);
    } catch (error: any) {
      console.error('导出SysML失败:', error);
      res.status(500).json({ error: error.message || '导出SysML失败' });
    }
  });

  // ── 同步到 SysML v2 API ───────────────────────────────────

  router.post('/:id/sync-sysml', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!project) return res.status(404).json({ error: '项目不存在' });

      const tablesData = await loadTableDataFromRelational(db, projectId);
      const result = await syncToSysmlApi(db, projectId, project.name, tablesData);
      res.json(result);
    } catch (error: any) {
      console.error('SysML同步失败:', error);
      const statusCode = error.message?.includes('不可用') ? 502
        : error.message?.includes('正在进行中') ? 409
        : 500;
      res.status(statusCode).json({ error: error.message || 'SysML同步失败' });
    }
  });

  // ── 获取 SysML 同步状态 ───────────────────────────────────

  router.get('/:id/sync-sysml/status', authenticate, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const status = await db.get('SELECT * FROM sysml_sync_status WHERE project_id = ?', [projectId]);
      res.json({ syncStatus: status || null });
    } catch (error: any) {
      res.status(500).json({ error: '获取同步状态失败' });
    }
  });

  // ── 全机设备清单 ───────────────────────────────────────────

  // 查看清单（仅管理员）
  router.get('/:id/aircraft-devices', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const projectId = Number(req.params.id);
      const search = ((req.query.search as string) || '').trim();
      let sql = 'SELECT * FROM aircraft_device_list WHERE project_id = ?';
      const params: any[] = [projectId];
      if (search) {
        sql += ' AND (设备编号_DOORS LIKE ? OR 系统名称 LIKE ? OR LIN号_DOORS LIKE ? OR object_identifier LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
      sql += ' ORDER BY id';
      const rows = await db.query(sql, params);
      res.json({ rows, total: rows.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 导入清单（仅管理员，Excel 单 Sheet）
  router.post('/:id/aircraft-devices/import', authenticate, requireRole('admin'), upload.single('file'), async (req: AuthRequest, res) => {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    try {
      const projectId = Number(req.params.id);
      const workbook = xlsx.readFile(req.file.path);
      const TARGET_SHEET = '5-全机设备清单';
      const exactMatch = workbook.SheetNames.find(n => n.trim() === TARGET_SHEET);
      const fuzzyMatch = workbook.SheetNames.find(n => n.includes('全机设备清单'));
      const sheetName = exactMatch ?? fuzzyMatch;
      if (!sheetName) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          error: `文件中未找到名为"${TARGET_SHEET}"的 Sheet，当前可用 Sheet：${workbook.SheetNames.join('、')}`
        });
      }
      const sheet = workbook.Sheets[sheetName];
      const jsonData: any[] = xlsx.utils.sheet_to_json(sheet);

      // 列名映射：Excel列名 → DB列名（支持全角/半角括号及无括号变体）
      const COL_MAP: Record<string, string> = {
        'Object Identifier': 'object_identifier',
        '系统名称': '系统名称',
        'Object Text': 'object_text',
        '设备编号': '设备编号_DOORS',
        '设备编号（DOORS）': '设备编号_DOORS',
        '设备编号(DOORS)': '设备编号_DOORS',
        'LIN号': 'LIN号_DOORS',
        'LIN号（DOORS）': 'LIN号_DOORS',
        'LIN号(DOORS)': 'LIN号_DOORS',
        '设备布置区域': '设备布置区域',
        '飞机构型': '飞机构型',
        '是否有供应商数模': '是否有供应商数模',
        '是否已布置在样机': '是否已布置在样机',
        '电设备编号': '电设备编号',
        '是否有EICD': '是否有EICD',
        '是否确认设备选型': '是否确认设备选型',
        '是否已确认MICD': '是否已确认MICD',
        '模型成熟度': '模型成熟度',
      };
      const ALL_DB_COLS = [
        'object_identifier','系统名称','object_text','设备编号_DOORS','LIN号_DOORS',
        '设备布置区域','飞机构型','是否有供应商数模','是否已布置在样机',
        '电设备编号','是否有EICD','是否确认设备选型','是否已确认MICD','模型成熟度',
      ];

      // 校验 Excel 列名：不允许出现 COL_MAP 之外的列
      if (jsonData.length > 0) {
        const knownKeys = new Set(Object.keys(COL_MAP));
        const unknownCols = Object.keys(jsonData[0] as Record<string, unknown>)
          .map(k => k.trim())
          .filter(k => !knownKeys.has(k));
        if (unknownCols.length > 0) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({
            error: `Sheet"${sheetName}"包含未知列，请检查后重新上传。未知列：${unknownCols.join('、')}`
          });
        }
      }

      // 预加载已有记录的14列指纹（拼接后放入 Set，O(1) 查重）
      const existingRows = await db.query(
        `SELECT ${ALL_DB_COLS.map(c => `"${c}"`).join(', ')} FROM aircraft_device_list WHERE project_id = ?`,
        [projectId]
      );
      const existingFingerprints = new Set<string>(
        existingRows.map((r: any) => ALL_DB_COLS.map(c => r[c] ?? '-').join('\0'))
      );

      let inserted = 0, skipped = 0;

      for (let i = 0; i < jsonData.length; i++) {
        const raw = jsonData[i] as Record<string, unknown>;
        const mapped: Record<string, string> = {};
        // 先将所有 DB 列初始化为 '-'
        for (const dbCol of ALL_DB_COLS) mapped[dbCol] = '-';
        // 再用 Excel 数据覆盖能匹配的列
        for (const [excelKey, dbKey] of Object.entries(COL_MAP)) {
          const found = Object.keys(raw).find(k =>
            k.trim() === excelKey || k.trim().includes(excelKey) || excelKey.includes(k.trim())
          );
          if (found !== undefined && raw[found] != null && String(raw[found]).trim() !== '') {
            mapped[dbKey] = String(raw[found]).trim();
          }
        }

        const fingerprint = ALL_DB_COLS.map(c => mapped[c] ?? '-').join('\0');
        if (existingFingerprints.has(fingerprint)) {
          skipped++;
          continue;
        }

        await db.run(
          `INSERT INTO aircraft_device_list
            (project_id, object_identifier, 系统名称, object_text, 设备编号_DOORS, LIN号_DOORS,
             设备布置区域, 飞机构型, 是否有供应商数模, 是否已布置在样机,
             电设备编号, 是否有EICD, 是否确认设备选型, 是否已确认MICD, 模型成熟度)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [projectId,
           mapped['object_identifier'], mapped['系统名称'], mapped['object_text'],
           mapped['设备编号_DOORS'],    mapped['LIN号_DOORS'],
           mapped['设备布置区域'],      mapped['飞机构型'],
           mapped['是否有供应商数模'],  mapped['是否已布置在样机'],
           mapped['电设备编号'],        mapped['是否有EICD'],
           mapped['是否确认设备选型'],  mapped['是否已确认MICD'], mapped['模型成熟度']]
        );
        existingFingerprints.add(fingerprint);
        inserted++;
      }

      fs.unlink(req.file.path, () => {});
      res.json({ inserted, skipped });
    } catch (err: any) {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
