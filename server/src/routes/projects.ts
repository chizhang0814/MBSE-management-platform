import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import fs from 'fs';
import { Database } from '../database.js';
import { authenticate, requireRole, requireAdminOrZonti, AuthRequest } from '../middleware/auth.js';
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

  // ── GET /api/projects/:id/members ────────────────────────────
  // 返回被分配了该项目权限的用户名列表及角色（供设备负责人下拉选择）
  router.get('/:id/members', authenticate, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
      if (!project) return res.status(404).json({ error: '项目不存在' });

      const users = await db.query('SELECT username, permissions FROM users WHERE role = ?', ['user']);
      const members: string[] = [];
      const memberRoles: Array<{ username: string; project_role: string }> = [];
      for (const u of users) {
        const perms: Array<{ project_name: string; project_role: string }> = u.permissions ? JSON.parse(u.permissions) : [];
        const match = perms.find(p => p.project_name === project.name);
        if (match) {
          members.push(u.username);
          memberRoles.push({ username: u.username, project_role: match.project_role });
        }
      }
      res.json({ members, memberRoles });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取项目成员失败' });
    }
  });

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

  router.put('/:id', authenticate, requireAdminOrZonti(db), async (req: AuthRequest, res) => {
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

      // 项目改名时，同步更新所有用户 permissions 中的旧项目名
      if (name && name.trim() !== existing.name) {
        const oldName = existing.name;
        const newName = name.trim();
        const allUsers = await db.query('SELECT id, permissions FROM users WHERE permissions IS NOT NULL');
        for (const u of allUsers) {
          let perms: any[];
          try { perms = JSON.parse(u.permissions); } catch { continue; }
          if (!Array.isArray(perms)) continue;
          let changed = false;
          for (const p of perms) {
            if (p.project_name === oldName) { p.project_name = newName; changed = true; }
          }
          if (changed) {
            await db.run('UPDATE users SET permissions = ? WHERE id = ?', [JSON.stringify(perms), u.id]);
          }
        }
        // 同步更新 permission_requests 表中的旧项目名
        await db.run('UPDATE permission_requests SET project_name = ? WHERE project_name = ?', [newName, oldName]);
      }

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
    requireAdminOrZonti(db),
    upload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        const projectId = parseInt(req.params.id);
        if (!req.file) return res.status(400).json({ error: '未选择文件' });

        const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
        if (!project) return res.status(404).json({ error: '项目不存在' });

        const workbook = xlsx.readFile(req.file.path);
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

        const results: Record<string, any> = {};

        // phase: 'all'(默认) | 'devices'(只导设备) | 'connectors'(只导连接器) | 'signals'(只导信号)
        const phase = (req.query.phase as string) || 'all';
        const doDeviceSheet    = phase === 'all' || phase === 'devices';
        const doConnectorSheet = phase === 'all' || phase === 'connectors';
        const doSignals        = phase === 'all' || phase === 'signals';
        // 预声明计数器，保证 phase 条件块外也能引用
        let s0Success = 0, s0Error = 0; const s0Errors: string[] = [], s0Skipped: string[] = [];
        let s1Success = 0, s1Error = 0; const s1Errors: string[] = [], s1Skipped: string[] = [];

        // ─── Sheet 定位（按名称）────────────────────────────────
        const DEVICE_SHEET    = '1-电设备清单';
        const CONNECTOR_SHEET = '2-设备端元器件清单';
        const deviceSheetName    = workbook.SheetNames.find(n => n.trim() === DEVICE_SHEET);
        const connectorSheetName = workbook.SheetNames.find(n => n.trim() === CONNECTOR_SHEET);
        const signalSheetNames   = workbook.SheetNames.filter(n => n.includes('电气接口清单'));

        if (doDeviceSheet && !deviceSheetName) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: `文件缺少 "${DEVICE_SHEET}" Sheet。当前 Sheet：${workbook.SheetNames.join('、')}` });
        }
        if (doConnectorSheet && !connectorSheetName) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: `文件缺少 "${CONNECTOR_SHEET}" Sheet。当前 Sheet：${workbook.SheetNames.join('、')}` });
        }

        // ─── "1-电设备清单" → devices ─────────────────────────
        // 列名映射（Excel normalize 后精确匹配，回退模糊匹配）
        const DEVICE_SHEET_MAP: Record<string, string> = {
          '设备编号': '设备编号',
          '设备中文名称': '设备中文名称',
          '设备英文名称': '设备英文名称',
          '设备英文简称（缩略语）': '设备英文缩写',
          '设备供应商件号': '设备供应商件号',
          '设备供应商名称': '设备供应商名称',
          '设备/部件所属系统（设备ATA，4位）': '设备部件所属系统（4位ATA）',
          '设备安装位置': '设备安装位置',
          '设备DAL': '设备DAL',
          '设备壳体是否金属': '设备壳体是否金属',
          '金属壳体表面是否经过特殊处理而不易导电': '金属壳体表面是否经过特殊处理而不易导电',
          '设备内共地情况（信号地、电源地、机壳地）': '设备内共地情况',
          '设备壳体接地方式': '设备壳体接地方式',
          '壳体接地是否作为故障电流路径': '壳体接地是否故障电流路径',
          '其他接地特殊要求': '其他接地特殊要求',
          '设备端连接器/接线柱数量': '设备端连接器或接线柱数量',
          '是否为选装设备': '是否为选装设备',
          '设备装机架次': '设备装机架次',
          '设备正常工作电压范围（V）': '设备正常工作电压范围（V）',
          '设备编号（DOORS）': '设备编号（DOORS）',
          '设备LIN号（DOORS）': '设备LIN号（DOORS）',
          '设备物理特性': '设备物理特性',
        };

        if (doDeviceSheet) {
        const sheet0 = workbook.Sheets[deviceSheetName!];
        const rows0: any[] = xlsx.utils.sheet_to_json(sheet0, { defval: '' }).map(normalizeRowKeys);

        for (let i = 0; i < rows0.length; i++) {
          if (i === 0) continue; // 第2行为填写说明，跳过
          const row = rows0[i];
          const rowNum = i + 2; // Excel 行号（row 0 = 第2行说明，row 1 = 第3行数据）
          if (String(Object.values(row)[0] ?? '').includes('示例')) {
            s0Skipped.push(`第${rowNum}行（A列含"示例"，跳过）`); continue;
          }
          try {
            const insertFields: Record<string, any> = {};
            for (const [excelCol, val] of Object.entries(row)) {
              const dbCol = resolveColumn(excelCol, DEVICE_SHEET_MAP);
              if (dbCol) insertFields[dbCol] = val !== undefined && val !== null ? String(val) : '';
            }

            if (
              (!insertFields['设备编号'] || String(insertFields['设备编号']).trim() === '') &&
              (!insertFields['设备中文名称'] || String(insertFields['设备中文名称']).trim() === '')
            ) {
              continue; // 设备编号和设备中文名称同时为空，视为空行跳过
            }

            const deviceNum = String(insertFields['设备编号']).trim();
            insertFields['设备编号'] = deviceNum;

            // 先对字段值做标准化处理，确保查重比对使用的是处理后的值
            // 设备部件所属系统（4位ATA）：去除首尾单/双引号（含中文弯引号 U+2018/2019/201C/201D）
            const ataRaw = (insertFields['设备部件所属系统（4位ATA）'] || '').toString().trim();
            insertFields['设备部件所属系统（4位ATA）'] = ataRaw.replace(/^['"\u2018\u2019\u201C\u201D]+|['"\u2018\u2019\u201C\u201D]+$/g, '').trim();

            // Y/N → 是/否
            const optVal = (insertFields['是否为选装设备'] || '').toString().trim().toUpperCase();
            if (optVal === 'Y') insertFields['是否为选装设备'] = '是';
            else if (optVal === 'N') insertFields['是否为选装设备'] = '否';

            // 设备编号非空且非占位符时，检查是否已存在同编号设备
            const isPlaceholder = (v: string) => v === '' || /^-+$/.test(v) || ['n/a', 'na', '无', '/', '暂无', '待定'].includes(v.toLowerCase());
            const SKIP_COMPARE_COLS = new Set(['导入来源', 'created_by']);
            if (!isPlaceholder(deviceNum)) {
              const dup0 = await db.get(
                `SELECT * FROM devices WHERE project_id = ? AND "设备编号" = ?`,
                [projectId, deviceNum]
              );
              if (dup0) {
                const diffCols: string[] = [];
                for (const [col, newVal] of Object.entries(insertFields)) {
                  if (SKIP_COMPARE_COLS.has(col)) continue;
                  const oldVal = String(dup0[col] ?? '').trim();
                  const newValStr = String(newVal ?? '').trim();
                  if (oldVal !== newValStr) {
                    diffCols.push(`${col}: "${oldVal}" → "${newValStr}"`);
                  }
                }
                if (diffCols.length === 0) {
                  s0Skipped.push(`第${rowNum}行: 设备编号"${deviceNum}"已存在且所有列匹配，跳过`);
                } else {
                  const oldSource = dup0['导入来源'] || '未知来源';
                  const newSource = `${originalName} / ${deviceSheetName} / 第${rowNum}行`;
                  const conflictMsg = `${oldSource}（旧）和 ${newSource}（新）均有此设备，以下列不匹配: ${diffCols.join('；')}`;
                  s0Skipped.push(`第${rowNum}行: 设备编号"${deviceNum}"已存在，${conflictMsg}`);
                  // 将已有设备标记为 Draft 并累积记录冲突详情
                  const prevConflicts: string[] = (() => {
                    try { return JSON.parse(dup0.import_conflicts || '[]'); } catch { return []; }
                  })();
                  prevConflicts.push(conflictMsg);
                  await db.run(
                    `UPDATE devices SET status = 'Draft', import_conflicts = ? WHERE id = ?`,
                    [JSON.stringify(prevConflicts), dup0.id]
                  );
                }
                continue;
              }
            }

            // Layer 1.5：设备中文名称查重
            const deviceName = String(insertFields['设备中文名称'] || '').trim();
            if (!isPlaceholder(deviceName)) {
              const dup1 = await db.get(
                `SELECT * FROM devices WHERE project_id = ? AND "设备中文名称" = ?`,
                [projectId, deviceName]
              );
              if (dup1) {
                const diffCols: string[] = [];
                for (const [col, newVal] of Object.entries(insertFields)) {
                  if (SKIP_COMPARE_COLS.has(col)) continue;
                  const oldVal = String(dup1[col] ?? '').trim();
                  const newValStr = String(newVal ?? '').trim();
                  if (oldVal !== newValStr) {
                    diffCols.push(`${col}: "${oldVal}" → "${newValStr}"`);
                  }
                }
                if (diffCols.length === 0) {
                  s0Skipped.push(`第${rowNum}行: 设备中文名称"${deviceName}"已存在且所有列匹配，跳过`);
                } else {
                  const oldSource = dup1['导入来源'] || '未知来源';
                  const newSource = `${originalName} / ${deviceSheetName} / 第${rowNum}行`;
                  const conflictMsg = `${oldSource}（旧）和 ${newSource}（新）均有此设备，以下列不匹配: ${diffCols.join('；')}`;
                  s0Skipped.push(`第${rowNum}行: 设备中文名称"${deviceName}"已存在，${conflictMsg}`);
                  const prevConflicts1: string[] = (() => {
                    try { return JSON.parse(dup1.import_conflicts || '[]'); } catch { return []; }
                  })();
                  prevConflicts1.push(conflictMsg);
                  await db.run(
                    `UPDATE devices SET status = 'Draft', import_conflicts = ? WHERE id = ?`,
                    [JSON.stringify(prevConflicts1), dup1.id]
                  );
                }
                continue;
              }
            }

            // 导入来源 & 创建人
            insertFields['导入来源'] = `${originalName} / ${deviceSheetName} / 第${rowNum}行`;
            insertFields['created_by'] = req.user!.username;

            const cols = Object.keys(insertFields).map(k => `"${k}"`).join(', ');
            const placeholders = Object.keys(insertFields).map(() => '?').join(', ');
            const r0 = await db.run(
              `INSERT INTO devices (project_id, ${cols}) VALUES (?, ${placeholders}) ON CONFLICT(project_id, "设备编号", "设备中文名称") DO NOTHING`,
              [projectId, ...Object.values(insertFields)]
            );

            if (r0.changes === 0) {
              const existing = await db.get(
                `SELECT * FROM devices WHERE project_id = ? AND "设备编号" = ? AND "设备中文名称" = ?`,
                [projectId, insertFields['设备编号'] || '', insertFields['设备中文名称'] || '']
              );
              if (existing) {
                const diffCols: string[] = [];
                for (const [col, newVal] of Object.entries(insertFields)) {
                  if (SKIP_COMPARE_COLS.has(col)) continue;
                  const oldVal = String(existing[col] ?? '').trim();
                  const newValStr = String(newVal ?? '').trim();
                  if (oldVal !== newValStr) {
                    diffCols.push(`${col}: "${oldVal}" → "${newValStr}"`);
                  }
                }
                if (diffCols.length === 0) {
                  s0Skipped.push(`第${rowNum}行: 设备[${insertFields['设备编号'] || ''}/${insertFields['设备中文名称'] || ''}] 已存在且所有列匹配，跳过`);
                } else {
                  const oldSource = existing['导入来源'] || '未知来源';
                  const newSource = insertFields['导入来源'] || `${originalName} / ${deviceSheetName} / 第${rowNum}行`;
                  const conflictMsg = `${oldSource}（旧）和 ${newSource}（新）均有此设备，以下列不匹配: ${diffCols.join('；')}`;
                  s0Skipped.push(`第${rowNum}行: 设备[${insertFields['设备编号'] || ''}/${insertFields['设备中文名称'] || ''}] 已存在，${conflictMsg}`);
                  // 将已有设备标记为 Draft 并累积记录冲突详情
                  const prevConflicts2: string[] = (() => {
                    try { return JSON.parse(existing.import_conflicts || '[]'); } catch { return []; }
                  })();
                  prevConflicts2.push(conflictMsg);
                  await db.run(
                    `UPDATE devices SET status = 'Draft', import_conflicts = ? WHERE id = ?`,
                    [JSON.stringify(prevConflicts2), existing.id]
                  );
                }
              } else {
                s0Skipped.push(`第${rowNum}行: 设备[${insertFields['设备编号'] || ''}/${insertFields['设备中文名称'] || ''}] 已存在，跳过`);
              }
              continue;
            }

            // ── 校验 a-h（仅新插入成功时执行）──────────────────
            const veErrors: string[] = [];

            // a) aircraft_device_list 四列精确匹配
            const adlMatch = await db.get(
              `SELECT 设备布置区域 FROM aircraft_device_list WHERE project_id = ? AND 电设备编号 = ? AND 设备编号_DOORS = ? AND LIN号_DOORS = ? AND object_text = ?`,
              [projectId,
               deviceNum,
               (insertFields['设备编号（DOORS）'] || '').trim(),
               (insertFields['设备LIN号（DOORS）'] || '').trim(),
               (insertFields['设备中文名称'] || '').trim()]
            );
            if (!adlMatch) {
              veErrors.push('设备编号（DOORS）', '设备LIN号（DOORS）', '设备编号', '设备中文名称', '设备安装位置');
            } else {
              // b) 设备安装位置 vs aircraft_device_list.设备布置区域
              if ((adlMatch.设备布置区域 || '').trim() !== (insertFields['设备安装位置'] || '').trim()) {
                veErrors.push('设备安装位置');
              }
            }

            // c) 设备DAL
            if (!['A', 'B', 'C', 'D', 'E', '其他'].includes((insertFields['设备DAL'] || '').trim())) {
              veErrors.push('设备DAL');
            }

            // d) 设备部件所属系统（4位ATA）
            const ataVal = (insertFields['设备部件所属系统（4位ATA）'] || '').trim();
            if (!/^\d{2}-\d{2}$/.test(ataVal) && ataVal !== '其他') {
              veErrors.push('设备部件所属系统（4位ATA）');
            }

            // e) 设备壳体是否金属
            const isMetalShell = (insertFields['设备壳体是否金属'] || '').trim();
            if (!['是', '否'].includes(isMetalShell)) veErrors.push('设备壳体是否金属');

            // f) 金属壳体表面处理
            const shellTreated = (insertFields['金属壳体表面是否经过特殊处理而不易导电'] || '').trim();
            if (isMetalShell === '是' && !['是', '否'].includes(shellTreated)) {
              veErrors.push('金属壳体表面是否经过特殊处理而不易导电');
            } else if (isMetalShell === '否' && shellTreated !== 'N/A') {
              veErrors.push('金属壳体表面是否经过特殊处理而不易导电');
            }

            // g) 设备壳体接地方式
            if (!['线搭接', '面搭接', '无'].includes((insertFields['设备壳体接地方式'] || '').trim())) {
              veErrors.push('设备壳体接地方式');
            }

            // h) 壳体接地是否故障电流路径
            if (!['是', '否'].includes((insertFields['壳体接地是否故障电流路径'] || '').trim())) {
              veErrors.push('壳体接地是否故障电流路径');
            }

            // 写回 status + validation_errors
            await db.run(
              `UPDATE devices SET status = ?, validation_errors = ? WHERE project_id = ? AND 设备编号 = ?`,
              [veErrors.length > 0 ? 'Draft' : 'normal', JSON.stringify(veErrors), projectId, deviceNum]
            );

            if (veErrors.length > 0) {
              s0Errors.push(`第${rowNum}行: 设备[${deviceNum}]校验失败（${veErrors.join('、')}）`);
            }

            s0Success++;
          } catch (err: any) {
            s0Error++;
            s0Errors.push(`第${rowNum}行: ${err.message}`);
          }
        }
        results['1-电设备清单'] = { name: deviceSheetName, success: s0Success, skipped: s0Skipped, errors: s0Errors };
        } // end doDeviceSheet

        // ─── "2-设备端元器件清单" → connectors ──────────────────

        if (doConnectorSheet && connectorSheetName) {
          const sheet1 = workbook.Sheets[connectorSheetName];
          const rows1: any[] = xlsx.utils.sheet_to_json(sheet1, { defval: '' }).map(normalizeRowKeys);

          // 连接器比对时跳过的列
          const CONN_SKIP_COMPARE = new Set(['导入来源']);

          for (let i = 0; i < rows1.length; i++) {
            if (i === 0) continue; // 第2行为填写说明，跳过
            const row = rows1[i];
            const rowNum = i + 2;
            if (String(Object.values(row)[0] ?? '').includes('示例')) {
              s1Skipped.push(`第${rowNum}行（A列含"示例"，跳过）`); continue;
            }
            try {
              // ① 读取 A-D 列内容用于错误记录
              const colA = String(row['设备编号'] || '').trim();
              const colB = String(row['设备端元器件编号'] || '').trim();
              const colC = String(row['设备端元器件名称及类型'] || row['元器件名称及类型'] || '').trim();
              const colD = String(row['设备端元器件件号类型及件号'] || row['元器件件号及类型'] || '').trim();
              const rowContext = `A=${colA}, B=${colB}, C=${colC}, D=${colD}`;

              // 设备编号为空 → 空行跳过
              if (!colA) continue;

              // ② 查找父设备
              const device: any = await db.get(
                `SELECT id FROM devices WHERE project_id = ? AND "设备编号" = ?`,
                [projectId, colA]
              );
              if (!device) {
                s1Error++;
                s1Errors.push(`第${rowNum}行: 未找到匹配设备（编号=${colA}）[${rowContext}]`);
                continue;
              }

              const importSource = `${originalName} / ${connectorSheetName} / 第${rowNum}行`;
              let connStatus = 'normal';
              const connConflicts: string[] = [];

              // ③ 构建插入字段（映射 Excel 列→DB 列）
              const connFields: Record<string, any> = {};
              for (const [excelCol, val] of Object.entries(row)) {
                const dbCol = resolveColumn(excelCol, CONNECTORS_EXCEL_TO_DB);
                if (dbCol && dbCol !== '设备编号') {
                  connFields[dbCol] = val !== undefined && val !== null ? String(val) : '';
                }
              }

              // "是否随设备交付"：Y→是，N→否
              const DELIVER_KEY = '设备端元器件匹配的元器件是否随设备交付';
              if (connFields[DELIVER_KEY] !== undefined) {
                const raw = String(connFields[DELIVER_KEY]).trim();
                if (raw === 'Y' || raw === 'y') {
                  connFields[DELIVER_KEY] = '是';
                } else if (raw === 'N' || raw === 'n') {
                  connFields[DELIVER_KEY] = '否';
                } else if (raw !== '' && raw !== '是' && raw !== '否') {
                  connStatus = 'Draft';
                }
              }

              // ④ 检查 设备端元器件编号 是否存在
              const compId = String(connFields['设备端元器件编号'] || '').trim();
              if (!compId) {
                s1Error++;
                s1Errors.push(`第${rowNum}行: 设备端元器件编号为空，跳过 [${rowContext}]`);
                continue;
              }

              connFields['导入来源'] = importSource;

              // ⑤ 检查数据库中是否已存在同 设备端元器件编号 的旧记录
              const existingConn: any = await db.get(
                `SELECT * FROM connectors WHERE device_id = ? AND "设备端元器件编号" = ?`,
                [device.id, compId]
              );

              if (existingConn) {
                // 旧记录存在 → 逐列比对
                const diffCols: string[] = [];
                for (const [col, newVal] of Object.entries(connFields)) {
                  if (CONN_SKIP_COMPARE.has(col)) continue;
                  const oldVal = String(existingConn[col] ?? '').trim();
                  const newValStr = String(newVal ?? '').trim();
                  if (oldVal !== newValStr) {
                    diffCols.push(`${col}: "${oldVal}" → "${newValStr}"`);
                  }
                }
                if (diffCols.length === 0) {
                  s1Skipped.push(`第${rowNum}行: 连接器[${compId}] 已存在且所有列匹配，跳过`);
                } else {
                  // 有不一致 → 旧记录标 Draft，累积 import_conflicts
                  const oldSource = existingConn['导入来源'] || '未知来源';
                  const conflictMsg = `${oldSource}（旧）和 ${importSource}（新）均有此连接器，以下列不匹配: ${diffCols.join('；')}`;
                  const prevConflicts: string[] = (() => {
                    try { return JSON.parse(existingConn.import_conflicts || '[]'); } catch { return []; }
                  })();
                  prevConflicts.push(conflictMsg);
                  await db.run(
                    `UPDATE connectors SET status = 'Draft', import_conflicts = ? WHERE id = ?`,
                    [JSON.stringify(prevConflicts), existingConn.id]
                  );
                  s1Skipped.push(`第${rowNum}行: 连接器[${compId}] 已存在，${conflictMsg}`);
                }
                continue;
              }

              // ⑥ 新记录：直接插入（device_id + 设备端元器件编号 冲突则跳过）
              const connCols = Object.keys(connFields).map(k => `"${k}"`).join(', ');
              const connPlaceholders = Object.keys(connFields).map(() => '?').join(', ');
              const connResult = await db.run(
                `INSERT INTO connectors (device_id, status, import_conflicts, ${connCols})
                 VALUES (?, ?, ?, ${connPlaceholders})
                 ON CONFLICT(device_id, "设备端元器件编号") DO NOTHING`,
                [device.id, connStatus,
                 connConflicts.length > 0 ? JSON.stringify(connConflicts) : null,
                 ...Object.values(connFields)]
              );
              if (connResult.changes === 0) {
                s1Skipped.push(`第${rowNum}行: 连接器[${compId}] 已存在，跳过`);
              } else {
                s1Success++;
              }
            } catch (err: any) {
              s1Error++;
              s1Errors.push(`第${rowNum}行: ${err.message}`);
            }
          }
        results['2-设备端元器件清单'] = { name: connectorSheetName || '（无）', success: s1Success, skipped: s1Skipped, errors: s1Errors };
        }

        // ─── 含"电气接口清单"的 Sheet(s) → signals + signal_endpoints ──

        let s2Success = 0, s2Error = 0;
        const s2Skipped: string[] = [];
        const s2Errors: string[] = [];

        if (doSignals) { for (const sigSheetName of signalSheetNames) {
          const sheet2 = workbook.Sheets[sigSheetName];

          // 用 header:1 读原始二维数组，避免 xlsx 合并同名列的问题
          const rawRows: any[][] = xlsx.utils.sheet_to_json(sheet2, { header: 1, defval: '' }) as any[][];

          let sheetS2 = 0, sheetE2 = 0;
          const sheetErrors2: string[] = [];
          const sheetSk2: string[] = [];

          if (rawRows.length < 3) {
            results[sigSheetName] = { name: sigSheetName, success: 0, skipped: [], errors: ['Sheet 行数不足（需要至少3行：列名行、填写说明行、数据行）'] };
            continue;
          }

          // 构建列名→列索引映射：首次出现 → colIdx，第二次出现 → colIdx2
          const normH = (h: any) => String(h).replace(/[\r\n\t]+/g, '').trim();
          const colIdx: Record<string, number> = {};
          const colIdx2: Record<string, number> = {};
          for (let ci = 0; ci < rawRows[0].length; ci++) {
            const h = normH(rawRows[0][ci]);
            if (h) {
              if (!(h in colIdx)) colIdx[h] = ci;
              else if (!(h in colIdx2)) colIdx2[h] = ci;
            }
          }
          const getV = (row: any[], headerName: string) =>
            String(row[colIdx[headerName] ?? -1] ?? '').trim();
          const getV2 = (row: any[], headerName: string) =>
            String(row[colIdx2[headerName] ?? -1] ?? '').trim();

          // 数据从第3行（index=2）开始，index=1 是填写说明
          for (let i = 2; i < rawRows.length; i++) {
            const row = rawRows[i];
            const rowNum = i + 1;
            if (String(row[0] ?? '').includes('示例')) {
              sheetSk2.push(`第${rowNum}行（A列含"示例"，跳过）`); continue;
            }
            try {
              // ── 步骤1：构建 signals 字段 ──────────────────────────────
              const sigFields: Record<string, any> = {};
              const setF = (dbCol: string, header: string) => {
                const v = getV(row, header);
                if (v !== '') sigFields[dbCol] = v;
              };
              setF('unique_id',                   '信号编号');
              setF('推荐导线线规',                '推荐导线线规');
              setF('推荐导线线型',                '推荐导线线型');
              setF('独立电源代码',                '独立电源代码');
              setF('敷设代码',                    '敷设代码');
              setF('电磁兼容代码',                '电磁兼容代码');
              setF('余度代码',                    '余度代码');
              setF('功能代码',                    '功能代码');
              setF('接地代码',                    '接地代码');
              setF('极性',                        '极性');
              setF('信号ATA',                     '信号ATA');
              setF('信号架次有效性',              '信号架次有效性');
              setF('额定电压',                    '额定电压（V）');
              setF('设备正常工作电压范围',        '设备正常工作电压范围（V）');
              setF('额定电流',                    '额定电流（A）');
              setF('是否成品线',                  '是否为成品线');
              setF('成品线件号',                  '成品线件号');
              setF('成品线线规',                  '成品线线规');
              setF('成品线类型',                  '成品线类型');
              setF('成品线长度',                  '成品线长度（MM）');
              setF('成品线载流量',                '成品线载流量（A）');
              setF('成品线线路压降',              '成品线线路压降（V）');
              setF('成品线标识',                  '成品线标识');
              setF('成品线与机上线束对接方式',    '成品线与机上线束对接方式');
              setF('成品线安装责任',              '成品线安装责任');
              setF('备注',                        '备注');

              // ── 端点原始值 ─────────────────────────────────────────────
              const fromDevNum  = getV(row,  '设备（从）');
              const fromLinNo   = getV2(row, '设备（从）');
              const fromConn    = getV(row, '连接器（从）');
              const fromPin     = getV(row, '针孔号（从）');
              const fromSize    = getV(row, '端接尺寸（从）');
              const fromShield  = getV(row, '屏蔽类型（从）');
              const fromSigName = getV(row, '信号名称（从）');
              const fromSigDef  = getV(row, '信号定义（从）');
              const toDevNum    = getV(row,  '设备（到）');
              const toLinNo     = getV2(row, '设备（到）');
              const toConn      = getV(row, '连接器（到）');
              const toPin       = getV(row, '针孔号（到）');
              const toSize      = getV(row, '端接尺寸（到）');
              const toShield    = getV(row, '屏蔽类型（到）');
              const toSigName   = getV(row, '信号名称（到）');
              const toSigDef    = getV(row, '信号定义（到）');

              // 全空行跳过
              if (!sigFields['unique_id'] && !fromLinNo && !toLinNo) continue;

              // ── 步骤2：端点校验（先于 unique_id 判断，整行通过后再处理去重）
              let rowFailed = false;
              type ResolvedEp = {
                deviceId: number; devNum: string; linNo: string;
                connectorId: number; compId: string;
                pinNum: string; termSize: string; shield: string;
                sigName: string; sigDef: string; epIndex: number;
                pinId: number | null;
              };
              const resolvedEps: ResolvedEp[] = [];

              const epDefs = [
                { devNum: fromDevNum, linNo: fromLinNo, conn: fromConn, pin: fromPin, size: fromSize, shield: fromShield, sigName: fromSigName, sigDef: fromSigDef, label: '从', epIndex: 0 },
                { devNum: toDevNum,   linNo: toLinNo,   conn: toConn,   pin: toPin,   size: toSize,   shield: toShield,   sigName: toSigName,   sigDef: toSigDef,   label: '到', epIndex: 1 },
              ];

              for (const ep of epDefs) {
                const { devNum, linNo, conn, pin, size, shield, sigName, sigDef, label, epIndex } = ep;
                if (!linNo && !conn && !pin) continue; // 端点完全空

                if (!linNo) {
                  sheetE2++;
                  sheetErrors2.push(`第${rowNum}行: 端点（${label}）设备LIN号为空，跳过整行`);
                  rowFailed = true; break;
                }
                const device = await db.get(
                  `SELECT id, "设备LIN号（DOORS）" as linNo, "设备编号" as devNumDb FROM devices WHERE project_id = ? AND "设备LIN号（DOORS）" = ?`,
                  [projectId, linNo]
                );
                if (!device) {
                  sheetE2++;
                  sheetErrors2.push(`第${rowNum}行: 端点（${label}）设备LIN号"${linNo}"（设备编号"${devNum}"）在devices中不存在，跳过整行`);
                  rowFailed = true; break;
                }
                if (!conn) {
                  sheetE2++;
                  sheetErrors2.push(`第${rowNum}行: 端点（${label}）连接器号（设备端元器件编号）为空，跳过整行`);
                  rowFailed = true; break;
                }
                const connRow = await db.get(
                  `SELECT c.id, d."设备LIN号（DOORS）" as linNo
                   FROM connectors c JOIN devices d ON c.device_id = d.id
                   WHERE c.device_id = ? AND c."设备端元器件编号" = ?`,
                  [device.id, conn]
                );
                if (!connRow) {
                  sheetE2++;
                  sheetErrors2.push(`第${rowNum}行: 端点（${label}）设备LIN号"${linNo}"（设备编号"${device.devNumDb}"）下不存在连接器"${conn}"，跳过整行`);
                  rowFailed = true; break;
                }
                if (connRow.linNo !== linNo) {
                  sheetE2++;
                  sheetErrors2.push(`第${rowNum}行: 端点（${label}）连接器"${conn}"所属设备LIN号"${connRow.linNo}"与指定LIN号"${linNo}"不精确匹配，跳过整行`);
                  rowFailed = true; break;
                }
                resolvedEps.push({ deviceId: device.id, devNum: device.devNumDb, linNo, connectorId: connRow.id, compId: conn, pinNum: pin, termSize: size, shield, sigName, sigDef, epIndex, pinId: null });
              }
              if (rowFailed) continue;

              // ── 步骤3：信号方向解析 ──────────────────────────────────
              const dirRaw = getV(row, '信号方向（从）').toUpperCase().trim();
              let fromInput = 0, fromOutput = 0, toInput = 0, toOutput = 0;
              let fromRemark: string | null = null, toRemark: string | null = null;
              if (dirRaw === 'INPUT' || dirRaw === 'IN') {
                fromInput = 1; toOutput = 1;
              } else if (dirRaw === 'OUTPUT' || dirRaw === 'OUT') {
                fromOutput = 1; toInput = 1;
              } else if (dirRaw === 'BI-DIR' || dirRaw === 'BI_DIR' || dirRaw === 'INPUT/OUTPUT' || dirRaw === 'IN&OUT') {
                fromInput = 1; fromOutput = 1; toInput = 1; toOutput = 1;
              } else if (dirRaw === 'N/A' || dirRaw === '接地' || dirRaw === '无信号（同步）') {
                fromRemark = dirRaw; toRemark = dirRaw;
              }

              // ── 步骤4：查找/创建 pin ──────────────────────────────────
              for (const ep of resolvedEps) {
                if (!ep.pinNum) { ep.pinId = null; continue; }
                let pinRow = await db.get(
                  `SELECT id FROM pins WHERE connector_id = ? AND "针孔号" = ?`,
                  [ep.connectorId, ep.pinNum]
                );
                if (!pinRow) {
                  const pinRes = await db.run(
                    `INSERT INTO pins (connector_id, "针孔号", "端接尺寸", "屏蔽类型")
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(connector_id, "针孔号") DO NOTHING`,
                    [ep.connectorId, ep.pinNum, ep.termSize || null, ep.shield || null]
                  );
                  if (pinRes.changes > 0) {
                    ep.pinId = pinRes.lastID;
                  } else {
                    pinRow = await db.get(`SELECT id FROM pins WHERE connector_id = ? AND "针孔号" = ?`, [ep.connectorId, ep.pinNum]);
                    ep.pinId = pinRow?.id ?? null;
                  }
                } else {
                  ep.pinId = pinRow.id;
                }
              }

              // ── 步骤5/6：根据 unique_id 是否存在分支处理 ─────────────
              const existingSignal = sigFields['unique_id']
                ? await db.get(
                    'SELECT id, import_conflicts FROM signals WHERE project_id = ? AND unique_id = ?',
                    [projectId, sigFields['unique_id']]
                  )
                : null;

              if (existingSignal) {
                // 查已有信号的端点（用于匹配判断）
                const existingEps: Array<{ devNum: string; linNo: string; compId: string; pinNum: string }> = await db.query(
                  `SELECT d."设备编号" as devNum, d."设备LIN号（DOORS）" as linNo,
                          c."设备端元器件编号" as compId, p."针孔号" as pinNum
                   FROM signal_endpoints se
                   JOIN devices d ON se.device_id = d.id
                   LEFT JOIN pins p ON se.pin_id = p.id
                   LEFT JOIN connectors c ON p.connector_id = c.id
                   WHERE se.signal_id = ?`,
                  [existingSignal.id]
                );

                // 找出在旧记录中不存在的端点（四字段完全匹配）
                const newEps = resolvedEps.filter(ep =>
                  !existingEps.some(eep =>
                    eep.devNum === ep.devNum &&
                    eep.linNo  === ep.linNo  &&
                    eep.compId === ep.compId &&
                    eep.pinNum === ep.pinNum
                  )
                );

                if (newEps.length === 0) {
                  // 所有端点均已存在 → 整行失败
                  sheetE2++;
                  sheetErrors2.push(`第${rowNum}行: 信号[${sigFields['unique_id']}]已存在且所有端点均已存在，跳过`);
                  continue;
                }

                // 追加新端点，endpoint_index 接续最大值
                const maxIdxRow = await db.get(
                  'SELECT MAX(endpoint_index) as m FROM signal_endpoints WHERE signal_id = ?',
                  [existingSignal.id]
                );
                let nextIdx: number = (maxIdxRow?.m ?? -1) + 1;

                for (const ep of newEps) {
                  if (!ep.pinId) continue;
                  const epInput  = ep.epIndex === 0 ? fromInput  : toInput;
                  const epOutput = ep.epIndex === 0 ? fromOutput : toOutput;
                  const epRemark = ep.epIndex === 0 ? fromRemark : toRemark;
                  await db.run(
                    `INSERT INTO signal_endpoints
                       (signal_id, device_id, pin_id, endpoint_index, "端接尺寸", "信号名称", "信号定义", "input", "output", "备注")
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [existingSignal.id, ep.deviceId, ep.pinId, nextIdx++,
                     ep.termSize || null, ep.sigName || null, ep.sigDef || null, epInput, epOutput, epRemark]
                  );
                }

                // 在 import_conflicts 记录本次合并
                const mergeNote = `[${originalName}/${sigSheetName}/第${rowNum}行] 合并新增端点: ${newEps.map(ep => `${ep.devNum}/${ep.compId}/${ep.pinNum}`).join(', ')}`;
                const prevConflicts: string[] = (() => {
                  try { return JSON.parse(existingSignal.import_conflicts || '[]'); } catch { return []; }
                })();
                prevConflicts.push(mergeNote);
                await db.run('UPDATE signals SET import_conflicts = ? WHERE id = ?', [JSON.stringify(prevConflicts), existingSignal.id]);

                sheetSk2.push(`第${rowNum}行: 信号[${sigFields['unique_id']}]已存在，已合并新增${newEps.length}个端点`);
                sheetS2++;

              } else {
                // unique_id 不存在 → 新建信号 + 所有端点
                sigFields['created_by'] = req.user!.username;
                sigFields['status'] = 'Active';
                const sigCols2 = Object.keys(sigFields).map(k => `"${k}"`).join(', ');
                const sigPh2   = Object.keys(sigFields).map(() => '?').join(', ');
                const sigResult = await db.run(
                  `INSERT INTO signals (project_id${sigCols2 ? ', ' + sigCols2 : ''})
                   VALUES (?${sigPh2 ? ', ' + sigPh2 : ''})`,
                  [projectId, ...Object.values(sigFields)]
                );
                const signalId = sigResult.lastID;

                for (const ep of resolvedEps) {
                  if (!ep.pinId) continue;
                  const epInput  = ep.epIndex === 0 ? fromInput  : toInput;
                  const epOutput = ep.epIndex === 0 ? fromOutput : toOutput;
                  const epRemark = ep.epIndex === 0 ? fromRemark : toRemark;
                  await db.run(
                    `INSERT INTO signal_endpoints
                       (signal_id, device_id, pin_id, endpoint_index, "端接尺寸", "信号名称", "信号定义", "input", "output", "备注")
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [signalId, ep.deviceId, ep.pinId, ep.epIndex,
                     ep.termSize || null, ep.sigName || null, ep.sigDef || null, epInput, epOutput, epRemark]
                  );
                }

                sheetS2++;
              }

            } catch (err: any) {
              sheetE2++;
              sheetErrors2.push(`第${rowNum}行: ${err.message}`);
            }
          }
          s2Success += sheetS2; s2Skipped.push(...sheetSk2); s2Error += sheetE2;
          s2Errors.push(...sheetErrors2);
          results[sigSheetName] = { name: sigSheetName, success: sheetS2, skipped: sheetSk2, errors: sheetErrors2 };
        } } // end for signalSheetNames + end doSignals

        // 按 Sheet 分组记录详情
        const errorDetailsJson = JSON.stringify({ sheets: results });
        const allErrors: string[] = [...s0Errors, ...s1Errors, ...s2Errors];
        const allSkipped: string[] = [...s0Skipped, ...s1Skipped, ...s2Skipped];

        // 记录上传文件
        const fileSize = fs.statSync(req.file!.path).size;
        await db.run(
          `INSERT INTO uploaded_files (filename, original_filename, table_name, table_type, uploaded_by, total_rows, success_count, skipped_count, error_count, file_size, status, error_details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.file!.filename,
            originalName,
            `project_${projectId}`,
            phase,
            req.user!.id,
            s0Success + s1Success + s2Success + s0Skipped.length + s1Skipped.length + s2Skipped.length + s0Error + s1Error + s2Error,
            s0Success + s1Success + s2Success,
            s0Skipped.length + s1Skipped.length + s2Skipped.length,
            s0Error + s1Error + s2Error,
            fileSize,
            (s0Error + s1Error + s2Error) > 0 ? 'completed_with_errors' : 'completed',
            errorDetailsJson
          ]
        );

        fs.unlink(req.file.path, () => {});
        res.json({
          success: true,
          message: '导入完成',
          results
        });
      } catch (error: any) {
        console.error('导入项目数据失败:', error);
        if (req.file) fs.unlink(req.file.path, () => {});
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

      // ── 全机设备清单 Sheet（DOORS 格式，11列）─────────────
      const adlCols = [
        'Object Identifier', '系统名称', '电设备编号', '设备编号', 'LIN号',
        'Object Text', '设备布置区域', '飞机构型', '是否有EICD', '是否是用电设备', '类型',
      ];
      const adlDbCols = [
        'object_identifier', '系统名称', '电设备编号', '设备编号_DOORS', 'LIN号_DOORS',
        'object_text', '设备布置区域', '飞机构型', '是否有EICD', '是否是用电设备', '类型',
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

  // 查看清单（管理员或总体人员）
  router.get('/:id/aircraft-devices', authenticate, requireAdminOrZonti(db), async (req: AuthRequest, res) => {
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

  // 新增单行
  router.post('/:id/aircraft-devices', authenticate, requireAdminOrZonti(db), async (req: AuthRequest, res) => {
    try {
      const projectId = Number(req.params.id);
      const { id: _id, project_id: _pid, created_at: _ca, ...fields } = req.body;
      const cols = Object.keys(fields).map(k => `"${k}"`).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const result = await db.run(
        `INSERT INTO aircraft_device_list (project_id, ${cols}) VALUES (?, ${placeholders})`,
        [projectId, ...Object.values(fields)]
      );
      res.json({ id: result.lastID });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 编辑单行
  router.put('/:id/aircraft-devices/:rowId', authenticate, requireAdminOrZonti(db), async (req: AuthRequest, res) => {
    try {
      const rowId = Number(req.params.rowId);
      const { id: _id, project_id: _pid, created_at: _ca, ...fields } = req.body;
      const setClauses = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
      await db.run(
        `UPDATE aircraft_device_list SET ${setClauses} WHERE id = ?`,
        [...Object.values(fields), rowId]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 导入清单（管理员或总体人员）
  router.post('/:id/aircraft-devices/import', authenticate, requireAdminOrZonti(db), upload.single('file'), async (req: AuthRequest, res) => {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    try {
      const projectId = Number(req.params.id);
      const workbook = xlsx.readFile(req.file.path);
      // DOORS 导出文件，精确匹配 Sheet 名
      const TARGET_SHEET = '00设备编号管理';
      const sheetName = workbook.SheetNames.find(n => n.trim() === TARGET_SHEET);
      if (!sheetName) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          error: `文件中未找到名为"${TARGET_SHEET}"的 Sheet，当前可用 Sheet：${workbook.SheetNames.join('、')}`
        });
      }
      const sheet = workbook.Sheets[sheetName];
      const jsonData: any[] = xlsx.utils.sheet_to_json(sheet);

      // 列名映射：DOORS Excel列名 → DB列名（精确匹配）
      const COL_MAP: Record<string, string> = {
        'Object Identifier': 'object_identifier',
        '系统名称':          '系统名称',
        '电设备编号':        '电设备编号',
        '设备编号':          '设备编号_DOORS',
        'LIN号':             'LIN号_DOORS',
        'Object Text':       'object_text',
        '设备布置区域':      '设备布置区域',
        '飞机构型':          '飞机构型',
        '是否有EICD':        '是否有EICD',
        '是否是用电设备':    '是否是用电设备',
        '类型':              '类型',
      };
      // 11 个有效 DB 列（用于指纹去重）
      const ALL_DB_COLS = [
        'object_identifier', '系统名称', '电设备编号', '设备编号_DOORS', 'LIN号_DOORS',
        'object_text', '设备布置区域', '飞机构型', '是否有EICD', '是否是用电设备', '类型',
      ];

      // DOORS 文件可能含额外列，仅忽略，不报错

      // 预加载已有记录的指纹（拼接后放入 Set，O(1) 查重）
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
        // 精确匹配列名（trim）
        for (const [excelKey, dbKey] of Object.entries(COL_MAP)) {
          const found = Object.keys(raw).find(k => k.trim() === excelKey);
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
            (project_id, object_identifier, 系统名称, 电设备编号, 设备编号_DOORS, LIN号_DOORS,
             object_text, 设备布置区域, 飞机构型, 是否有EICD, 是否是用电设备, 类型)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [projectId,
           mapped['object_identifier'], mapped['系统名称'],    mapped['电设备编号'],
           mapped['设备编号_DOORS'],    mapped['LIN号_DOORS'], mapped['object_text'],
           mapped['设备布置区域'],      mapped['飞机构型'],    mapped['是否有EICD'],
           mapped['是否是用电设备'],    mapped['类型']]
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

  // ── 构型管理 ──
  router.get('/:id/configurations', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = Number(req.params.id);
      const rows = await db.query(
        `SELECT id, name, description, created_at FROM project_configurations WHERE project_id = ? ORDER BY created_at ASC`,
        [projectId]
      );
      res.json({ configurations: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/configurations', authenticate, requireAdminOrZonti(db), async (req: AuthRequest, res) => {
    try {
      const projectId = Number(req.params.id);
      const { name, description } = req.body;
      if (!name || !String(name).trim()) return res.status(400).json({ error: '构型名称不能为空' });
      const trimmed = String(name).trim();
      const existing = await db.get(
        `SELECT id FROM project_configurations WHERE project_id = ? AND name = ?`,
        [projectId, trimmed]
      );
      if (existing) return res.status(400).json({ error: `构型"${trimmed}"已存在` });
      const result = await db.run(
        `INSERT INTO project_configurations (project_id, name, description) VALUES (?, ?, ?)`,
        [projectId, trimmed, description || null]
      );
      res.json({ id: result.lastID, name: trimmed, description: description || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/:id/configurations/:configId', authenticate, requireAdminOrZonti(db), async (req: AuthRequest, res) => {
    try {
      const projectId = Number(req.params.id);
      const configId = Number(req.params.configId);
      const { name, description } = req.body;
      if (!name || !String(name).trim()) return res.status(400).json({ error: '构型名称不能为空' });
      const trimmed = String(name).trim();
      const existing = await db.get(
        `SELECT id FROM project_configurations WHERE project_id = ? AND name = ? AND id != ?`,
        [projectId, trimmed, configId]
      );
      if (existing) return res.status(400).json({ error: `构型"${trimmed}"已存在` });
      await db.run(
        `UPDATE project_configurations SET name = ?, description = ? WHERE id = ? AND project_id = ?`,
        [trimmed, description || null, configId, projectId]
      );
      res.json({ id: configId, name: trimmed, description: description || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id/configurations/:configId', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
    try {
      const projectId = Number(req.params.id);
      const configId = Number(req.params.configId);
      await db.run(
        `DELETE FROM project_configurations WHERE id = ? AND project_id = ?`,
        [configId, projectId]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
