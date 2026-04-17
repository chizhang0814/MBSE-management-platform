import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import fs from 'fs';
import { Database } from '../database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const upload = multer({ dest: 'uploads/' });

export function interconnectRoutes(db: Database) {
  const router = express.Router();

  // GET /api/interconnects?project_id= — 获取项目所有互联点及针孔
  router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.query.project_id as string);
      if (!projectId) return res.status(400).json({ error: '缺少 project_id' });

      const interconnects = await db.query(
        'SELECT * FROM interconnects WHERE project_id = ? ORDER BY label',
        [projectId]
      );

      for (const ic of interconnects) {
        const pins = await db.query(
          "SELECT * FROM interconnect_pins WHERE interconnect_id = ? ORDER BY CAST(pin_num AS INTEGER), pin_num",
          [ic.id]
        );
        // 查每个针孔被哪个信号组占用
        for (const pin of pins) {
          const usage = await db.get(`
            SELECT n.signal_group FROM wire_end_node_slots s
            JOIN wire_end_nodes n ON n.id = s.node_id
            WHERE s.interconnect_pin_id = ? AND n.project_id = ?
          `, [(pin as any).id, projectId]);
          (pin as any).used_by_group = usage?.signal_group || null;
        }
        (ic as any).pins = pins;
      }

      res.json({ interconnects });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/interconnects — 创建互联点
  router.post('/', authenticate, async (req: AuthRequest, res) => {
    try {
      const { project_id, label, ic_type, ic_zone } = req.body;
      if (!project_id || !label) return res.status(400).json({ error: '缺少 project_id 或 label' });

      const existing = await db.get(
        'SELECT id FROM interconnects WHERE project_id = ? AND label = ?',
        [project_id, label]
      );
      if (existing) return res.status(400).json({ error: `互联点 "${label}" 已存在` });

      const r = await db.run(
        'INSERT INTO interconnects (project_id, label, ic_type, ic_zone) VALUES (?, ?, ?, ?)',
        [project_id, label, ic_type || '', ic_zone || '']
      );
      res.json({ success: true, id: r.lastID, label });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/interconnects/:id — 编辑互联点
  router.put('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const icId = parseInt(req.params.id);
      const { label, ic_type, ic_zone } = req.body;
      const sets: string[] = [];
      const params: any[] = [];
      if (label !== undefined) { sets.push('label = ?'); params.push(label); }
      if (ic_type !== undefined) { sets.push('ic_type = ?'); params.push(ic_type); }
      if (ic_zone !== undefined) { sets.push('ic_zone = ?'); params.push(ic_zone); }
      if (sets.length === 0) return res.status(400).json({ error: '无更新字段' });
      sets.push('updated_at = CURRENT_TIMESTAMP');
      params.push(icId);
      await db.run(`UPDATE interconnects SET ${sets.join(', ')} WHERE id = ?`, params);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/interconnects/:id/pins — 添加针孔
  router.post('/:id/pins', authenticate, async (req: AuthRequest, res) => {
    try {
      const icId = parseInt(req.params.id);
      const { pin_num } = req.body;
      if (!pin_num) return res.status(400).json({ error: '缺少 pin_num' });

      const maxOrder = await db.get(
        'SELECT MAX(sort_order) as m FROM interconnect_pins WHERE interconnect_id = ?', [icId]
      );
      const r = await db.run(
        'INSERT OR IGNORE INTO interconnect_pins (interconnect_id, pin_num, sort_order) VALUES (?, ?, ?)',
        [icId, pin_num, (maxOrder?.m || 0) + 1]
      );
      res.json({ success: true, id: r.lastID });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/interconnects/:id — 删除互联点
  router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
      const icId = parseInt(req.params.id);
      await db.run('DELETE FROM interconnects WHERE id = ?', [icId]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/interconnects/pins/:pinId — 删除针孔
  router.delete('/pins/:pinId', authenticate, async (req: AuthRequest, res) => {
    try {
      const pinId = parseInt(req.params.pinId);
      await db.run('DELETE FROM interconnect_pins WHERE id = ?', [pinId]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/interconnects/import — Excel导入
  router.post('/import', authenticate, upload.single('file'), async (req: AuthRequest, res) => {
    try {
      const projectId = parseInt(req.body.project_id);
      if (!projectId || !req.file) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: '缺少 project_id 或文件' });
      }

      const workbook = xlsx.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      let created = 0, pinsAdded = 0, skipped = 0;

      // 跳过表头（如果第一行看起来是表头）
      const startRow = (String(rows[0]?.[0] || '').includes('互联点') || String(rows[0]?.[0] || '').includes('名称')) ? 1 : 0;

      for (let i = startRow; i < rows.length; i++) {
        const label = String(rows[i][0] || '').trim();
        const pinNum = String(rows[i][1] || '').trim();
        const icType = String(rows[i][2] || '').trim();
        const icZone = String(rows[i][3] || '').trim();
        if (!label) continue;

        // 查找或创建互联点
        let ic = await db.get(
          'SELECT id FROM interconnects WHERE project_id = ? AND label = ?',
          [projectId, label]
        );
        if (!ic) {
          const r = await db.run(
            'INSERT INTO interconnects (project_id, label, ic_type, ic_zone) VALUES (?, ?, ?, ?)',
            [projectId, label, icType, icZone]
          );
          ic = { id: r.lastID };
          created++;
        } else if (icType || icZone) {
          // 更新已有互联点的类型和区域（如果导入中有值）
          await db.run('UPDATE interconnects SET ic_type = COALESCE(NULLIF(?, \'\'), ic_type), ic_zone = COALESCE(NULLIF(?, \'\'), ic_zone) WHERE id = ?', [icType, icZone, ic.id]);
        }

        // 添加针孔
        if (pinNum) {
          const maxOrder = await db.get(
            'SELECT MAX(sort_order) as m FROM interconnect_pins WHERE interconnect_id = ?', [ic.id]
          );
          const r = await db.run(
            'INSERT OR IGNORE INTO interconnect_pins (interconnect_id, pin_num, sort_order) VALUES (?, ?, ?)',
            [ic.id, pinNum, (maxOrder?.m || 0) + 1]
          );
          if (r.changes > 0) pinsAdded++;
          else skipped++;
        }
      }

      fs.unlink(req.file.path, () => {});
      res.json({ success: true, created, pinsAdded, skipped });
    } catch (error: any) {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
