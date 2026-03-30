import express from 'express';
import { Database } from '../database.js';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';

export function dataRoutes(db: Database) {
  const router = express.Router();

  // ── 统计端点（查5张固定表）────────────────────────────────

  // GET /api/data/stats?projectId=N   （可选 projectId，不传则返回全局统计）
  router.get('/stats', authenticate, async (req: any, res) => {
    try {
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;
      const userRole = req.user?.role;
      const username = req.user?.username;

      if (projectId) {
        // 单项目统计
        let deviceCount, connectorCount, pinCount, signalCount;

        if (userRole === 'admin') {
          deviceCount = (await db.get('SELECT COUNT(*) as c FROM devices WHERE project_id = ?', [projectId]))?.c || 0;
          connectorCount = (await db.get(
            'SELECT COUNT(*) as c FROM connectors c JOIN devices d ON c.device_id = d.id WHERE d.project_id = ?',
            [projectId]
          ))?.c || 0;
          pinCount = (await db.get(
            'SELECT COUNT(*) as c FROM pins p JOIN connectors co ON p.connector_id = co.id JOIN devices d ON co.device_id = d.id WHERE d.project_id = ?',
            [projectId]
          ))?.c || 0;
          signalCount = (await db.get('SELECT COUNT(*) as c FROM signals WHERE project_id = ?', [projectId]))?.c || 0;
        } else {
          deviceCount = (await db.get(
            'SELECT COUNT(*) as c FROM devices WHERE project_id = ? AND 设备负责人 = ?',
            [projectId, username]
          ))?.c || 0;
          connectorCount = (await db.get(
            'SELECT COUNT(*) as c FROM connectors c JOIN devices d ON c.device_id = d.id WHERE d.project_id = ? AND d.设备负责人 = ?',
            [projectId, username]
          ))?.c || 0;
          pinCount = (await db.get(
            'SELECT COUNT(*) as c FROM pins p JOIN connectors co ON p.connector_id = co.id JOIN devices d ON co.device_id = d.id WHERE d.project_id = ? AND d.设备负责人 = ?',
            [projectId, username]
          ))?.c || 0;
          signalCount = (await db.get(
            `SELECT COUNT(DISTINCT s.id) as c FROM signals s
             WHERE s.project_id = ?
               AND EXISTS (
                 SELECT 1 FROM signal_endpoints se
                 JOIN devices d ON se.device_id = d.id
                 WHERE se.signal_id = s.id AND d.设备负责人 = ?
               )`,
            [projectId, username]
          ))?.c || 0;
        }

        res.json({ deviceCount, connectorCount, pinCount, signalCount });
      } else {
        // 全局：按项目汇总（兼容旧 /api/data/tables/stats 调用）
        let projects;
        if (userRole === 'admin') {
          projects = await db.query(
            'SELECT p.id as project_id, p.name as project_name FROM projects p ORDER BY p.name'
          );
        } else {
          projects = await db.query(
            `SELECT DISTINCT p.id as project_id, p.name as project_name
             FROM projects p JOIN devices d ON d.project_id = p.id
             WHERE d.设备负责人 = ?
             ORDER BY p.name`,
            [username]
          );
        }

        const tableStats = await Promise.all(projects.map(async (p: any) => {
          let devCount, sigCount;
          if (userRole === 'admin') {
            devCount = (await db.get('SELECT COUNT(*) as c FROM devices WHERE project_id = ?', [p.project_id]))?.c || 0;
            sigCount = (await db.get('SELECT COUNT(*) as c FROM signals WHERE project_id = ?', [p.project_id]))?.c || 0;
          } else {
            devCount = (await db.get(
              'SELECT COUNT(*) as c FROM devices WHERE project_id = ? AND 设备负责人 = ?',
              [p.project_id, username]
            ))?.c || 0;
            sigCount = (await db.get(
              `SELECT COUNT(DISTINCT s.id) as c FROM signals s
               WHERE s.project_id = ?
                 AND EXISTS (
                   SELECT 1 FROM signal_endpoints se
                   JOIN devices d ON se.device_id = d.id
                   WHERE se.signal_id = s.id AND d.设备负责人 = ?
                 )`,
              [p.project_id, username]
            ))?.c || 0;
          }
          return {
            projectId: p.project_id,
            projectName: p.project_name,
            displayName: 'EICD数据',
            tableName: `project_${p.project_id}`,
            tableType: 'relational',
            rowCount: devCount + sigCount,
            deviceCount: devCount,
            signalCount: sigCount,
          };
        }));

        res.json({ tableStats });
      }
    } catch (error: any) {
      console.error('获取统计失败:', error);
      res.status(500).json({ error: error.message || '获取统计失败' });
    }
  });

  // 兼容旧路径 /api/data/tables/stats（重定向到 /api/data/stats）
  router.get('/tables/stats', authenticate, async (req: any, res) => {
    try {
      const userRole = req.user?.role;
      const username = req.user?.username;

      let projects;
      if (userRole === 'admin') {
        projects = await db.query('SELECT p.id as project_id, p.name as project_name FROM projects p ORDER BY p.name');
      } else {
        projects = await db.query(
          `SELECT DISTINCT p.id as project_id, p.name as project_name
           FROM projects p JOIN devices d ON d.project_id = p.id
           WHERE d.设备负责人 = ? ORDER BY p.name`,
          [username]
        );
      }

      const tableStats = await Promise.all(projects.map(async (p: any) => {
        let devCount = 0, sigCount = 0;
        if (userRole === 'admin') {
          devCount = (await db.get('SELECT COUNT(*) as c FROM devices WHERE project_id = ?', [p.project_id]))?.c || 0;
          sigCount = (await db.get('SELECT COUNT(*) as c FROM signals WHERE project_id = ?', [p.project_id]))?.c || 0;
        } else {
          devCount = (await db.get(
            'SELECT COUNT(*) as c FROM devices WHERE project_id = ? AND 设备负责人 = ?',
            [p.project_id, username]
          ))?.c || 0;
        }
        return {
          projectId: p.project_id,
          projectName: p.project_name,
          displayName: 'EICD数据',
          tableName: `project_${p.project_id}`,
          tableType: 'relational',
          rowCount: devCount + sigCount,
          deviceCount: userRole === 'user' ? devCount : undefined,
        };
      }));

      res.json({ tableStats });
    } catch (error: any) {
      res.status(500).json({ error: error.message || '获取统计失败' });
    }
  });

  // ── 工作进展（设计总师决策视图） ────────────────────────────────
  // GET /api/data/activity?projectId=N&days=7|14|30
  // GET /api/data/activity?projectId=N&hours=24|48|72
  router.get('/activity', authenticate, async (req: any, res) => {
    try {
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;
      const allTime = req.query.all === 'true';
      const hoursParam = !allTime && req.query.hours ? parseInt(req.query.hours as string) : null;
      const daysParam = (!allTime && !hoursParam) ? (parseInt(req.query.days as string) || 7) : null;
      const granularity = hoursParam ? 'hour' : 'day';
      // 统一转换为小时数用于数据库查询（全生命周期时为 null）
      const periodHours = hoursParam ?? (daysParam != null ? daysParam * 24 : null);

      // 构建项目过滤子查询
      const projectFilter = projectId ? `AND (
        (cl.entity_table = 'devices'    AND cl.entity_id IN (SELECT id FROM devices WHERE project_id = ${projectId}))
        OR (cl.entity_table = 'connectors' AND cl.entity_id IN (SELECT co.id FROM connectors co JOIN devices d ON co.device_id = d.id WHERE d.project_id = ${projectId}))
        OR (cl.entity_table = 'pins'       AND cl.entity_id IN (SELECT p.id FROM pins p JOIN connectors co ON p.connector_id = co.id JOIN devices d ON co.device_id = d.id WHERE d.project_id = ${projectId}))
        OR (cl.entity_table = 'signals'    AND cl.entity_id IN (SELECT id FROM signals WHERE project_id = ${projectId}))
      )` : '';

      // 1. 距上次变更天数（始终用天计算，用于稳定性评级）
      const lastChangeRow = await db.get(
        `SELECT cl.created_at FROM change_logs cl
         WHERE 1=1 ${projectFilter}
         ORDER BY cl.created_at DESC LIMIT 1`
      );
      const lastChangeAt: string | null = lastChangeRow?.created_at || null;
      const daysSinceLastChange = lastChangeAt
        ? Math.floor((Date.now() - new Date(lastChangeAt).getTime()) / 86400000)
        : null;

      // 2. 本周期所有变更记录（按桶分组：小时或天）
      const bucketExpr = granularity === 'hour'
        ? "strftime('%Y-%m-%d %H', cl.created_at)"
        : "date(cl.created_at)";

      const timeFilter = periodHours != null
        ? `AND cl.created_at >= datetime('now', '-${periodHours} hours')`
        : '';

      const periodRows = await db.query(
        `SELECT cl.entity_table, cl.entity_id, cl.old_values, cl.new_values,
                ${bucketExpr} as bucket
         FROM change_logs cl
         WHERE 1=1 ${timeFilter}
         ${projectFilter}`
      );

      const SKIP = new Set(['id','project_id','device_id','connector_id','created_at','updated_at','status','version']);

      // 按三类分组统计（连接器+针孔合并为一类）
      type CategoryStat = {
        ids: Set<number>;
        fieldFreq: Record<string, number>;
        bucketMap: Record<string, number>;
      };
      const cats: Record<'devices'|'connectors_pins'|'signals', CategoryStat> = {
        devices:         { ids: new Set(), fieldFreq: {}, bucketMap: {} },
        connectors_pins: { ids: new Set(), fieldFreq: {}, bucketMap: {} },
        signals:         { ids: new Set(), fieldFreq: {}, bucketMap: {} },
      };

      for (const r of periodRows) {
        const key = r.entity_table === 'connectors' || r.entity_table === 'pins'
          ? 'connectors_pins'
          : r.entity_table as 'devices' | 'signals';
        const cat = cats[key];
        if (!cat) continue;
        cat.ids.add(r.entity_id);
        cat.bucketMap[r.bucket] = (cat.bucketMap[r.bucket] || 0) + 1;
        try {
          const oldObj = r.old_values ? JSON.parse(r.old_values) : null;
          const newObj = r.new_values ? JSON.parse(r.new_values) : null;
          if (newObj) {
            for (const k of Object.keys(newObj)) {
              if (SKIP.has(k)) continue;
              if (!oldObj || oldObj[k] !== newObj[k]) cat.fieldFreq[k] = (cat.fieldFreq[k] || 0) + 1;
            }
          }
        } catch { /* skip */ }
      }

      const topFields = (freq: Record<string, number>, n = 3) =>
        Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

      // 补全时间桶数组并构建 trendDays
      let trendDays: { date: string; label: string; device: number; connector: number; signal: number }[];

      if (granularity === 'hour') {
        // 生成过去 N 小时的每个整点（UTC 对齐到 SQLite strftime）
        const allHours: string[] = [];
        const now = new Date();
        for (let i = periodHours! - 1; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 3600000);
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} ${String(d.getUTCHours()).padStart(2,'0')}`;
          allHours.push(key);
        }
        trendDays = allHours.map(key => ({
          date: key,
          label: key.slice(11) + ':00',
          device:    cats.devices.bucketMap[key] || 0,
          connector: cats.connectors_pins.bucketMap[key] || 0,
          signal:    cats.signals.bucketMap[key] || 0,
        }));
      } else {
        // 日粒度：确定起始日期
        let startDate: Date;
        if (allTime) {
          // 从数据中最早的变更日期开始
          const allBuckets = Object.keys({
            ...cats.devices.bucketMap,
            ...cats.connectors_pins.bucketMap,
            ...cats.signals.bucketMap,
          }).sort();
          startDate = allBuckets.length > 0
            ? new Date(allBuckets[0])
            : new Date();
        } else {
          startDate = new Date();
          startDate.setDate(startDate.getDate() - (daysParam! - 1));
        }
        const allDates: string[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cur = new Date(startDate);
        cur.setHours(0, 0, 0, 0);
        while (cur <= today) {
          allDates.push(cur.toISOString().slice(0, 10));
          cur.setDate(cur.getDate() + 1);
        }
        trendDays = allDates.map(date => ({
          date,
          label: date.slice(5),
          device:    cats.devices.bucketMap[date] || 0,
          connector: cats.connectors_pins.bucketMap[date] || 0,
          signal:    cats.signals.bucketMap[date] || 0,
        }));
      }

      // 3. 稳定性评级（始终用天计算）
      const totalPeriodChanges = periodRows.length;
      const effectiveDays = periodHours != null ? periodHours / 24 : Math.max(trendDays.length, 1);
      const avgPerDay = totalPeriodChanges / effectiveDays;
      let stabilityLevel: 'FROZEN' | 'STABLE' | 'ACTIVE' | 'INTENSIVE';
      let stabilityLabel: string;
      if (daysSinceLastChange === null || daysSinceLastChange >= 30) {
        stabilityLevel = 'FROZEN'; stabilityLabel = '数据冻结';
      } else if (daysSinceLastChange >= 7 && avgPerDay < 5) {
        stabilityLevel = 'STABLE'; stabilityLabel = '趋于稳定';
      } else if (avgPerDay >= 20) {
        stabilityLevel = 'INTENSIVE'; stabilityLabel = '密集变更';
      } else {
        stabilityLevel = 'ACTIVE'; stabilityLabel = '持续迭代';
      }

      // 4. 决策建议
      const df = topFields(cats.devices.fieldFreq, 2).join('、');
      const cf = topFields(cats.connectors_pins.fieldFreq, 2).join('、');
      const sf = topFields(cats.signals.fieldFreq, 2).join('、');
      const buildAdvice = () => {
        if (stabilityLevel === 'FROZEN') return '数据长期无变更，EICD已进入冻结状态，可启动正式评审流程。';
        if (stabilityLevel === 'STABLE') {
          const focus = [df && `设备侧集中于${df}`, cf && `连接器侧集中于${cf}`, sf && `信号侧集中于${sf}`].filter(Boolean).join('，');
          return `变更趋于收敛${focus ? '，' + focus : ''}，建议重点审查剩余开放项，准备进入基线锁定。`;
        }
        if (stabilityLevel === 'INTENSIVE') {
          return `当前处于密集变更期（日均 ${avgPerDay.toFixed(1)} 条），建议增派审核人员，密切跟踪变更影响范围。`;
        }
        const hot = [df && `设备：${df}`, cf && `连接器/针孔：${cf}`, sf && `信号：${sf}`].filter(Boolean).join('；');
        return `工作正常推进，当前活跃字段为【${hot || '暂无'}】，可按计划推进资源配置。`;
      };

      const buildDailyList = (bucketMap: Record<string, number>) =>
        trendDays.map(t => ({ date: t.date, count: bucketMap[t.date] || 0 }));

      // 合并三类字段频次，取变更最多的 Top 5
      const allFieldFreq: Record<string, number> = {};
      for (const cat of Object.values(cats)) {
        for (const [field, count] of Object.entries(cat.fieldFreq)) {
          allFieldFreq[field] = (allFieldFreq[field] || 0) + (count as number);
        }
      }
      const activeFields = Object.entries(allFieldFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([field, count]) => ({ field, count }));

      res.json({
        granularity,
        daysSinceLastChange,
        lastChangeAt,
        stabilityLevel,
        stabilityLabel,
        trendDays,
        totalChanges: totalPeriodChanges,
        avgPerDay: Math.round(avgPerDay * 10) / 10,
        advice: buildAdvice(),
        activeFields,
        categories: {
          devices:         { count: cats.devices.ids.size,         topFields: topFields(cats.devices.fieldFreq),         daily: buildDailyList(cats.devices.bucketMap) },
          connectors_pins: { count: cats.connectors_pins.ids.size, topFields: topFields(cats.connectors_pins.fieldFreq), daily: buildDailyList(cats.connectors_pins.bucketMap) },
          signals:         { count: cats.signals.ids.size,         topFields: topFields(cats.signals.fieldFreq),         daily: buildDailyList(cats.signals.bucketMap) },
        },
      });
    } catch (error: any) {
      console.error('获取动态失败:', error);
      res.status(500).json({ error: error.message || '获取动态失败' });
    }
  });

  // ── 单日变更明细 ─────────────────────────────────────────────
  // GET /api/data/activity/detail?projectId=N&date=YYYY-MM-DD
  router.get('/activity/detail', authenticate, async (req: any, res) => {
    try {
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;
      const date = req.query.date as string; // YYYY-MM-DD
      if (!date) return res.status(400).json({ error: '缺少 date 参数' });

      const projectFilter = projectId ? `AND (
        (cl.entity_table = 'devices'    AND cl.entity_id IN (SELECT id FROM devices WHERE project_id = ${projectId}))
        OR (cl.entity_table = 'connectors' AND cl.entity_id IN (SELECT co.id FROM connectors co JOIN devices d ON co.device_id = d.id WHERE d.project_id = ${projectId}))
        OR (cl.entity_table = 'pins'       AND cl.entity_id IN (SELECT p.id FROM pins p JOIN connectors co ON p.connector_id = co.id JOIN devices d ON co.device_id = d.id WHERE d.project_id = ${projectId}))
        OR (cl.entity_table = 'signals'    AND cl.entity_id IN (SELECT id FROM signals WHERE project_id = ${projectId}))
      )` : '';

      // date 可以是 "YYYY-MM-DD"（按天）或 "YYYY-MM-DD HH"（按小时）
      const isHourly = date.length > 10;
      const timeFilter = isHourly
        ? `strftime('%Y-%m-%d %H', cl.created_at) = ?`
        : `date(cl.created_at) = ?`;

      const rows = await db.query(
        `SELECT cl.id, cl.entity_table, cl.entity_id, cl.reason, cl.old_values, cl.new_values,
                cl.created_at, COALESCE(u.display_name, u.name, u.username) as changed_by_name
         FROM change_logs cl
         LEFT JOIN users u ON cl.changed_by = u.id
         WHERE ${timeFilter} ${projectFilter}
         ORDER BY cl.created_at ASC`,
        [date]
      );

      const SKIP = new Set(['id','project_id','device_id','connector_id','created_at','updated_at','status','version','import_status','import_conflicts']);
      const ENTITY_LABEL: Record<string, string> = { devices: '设备', connectors: '连接器', pins: '针孔', signals: '信号' };

      const records = rows.map((r: any) => {
        let diff: { field: string; oldVal: string | null; newVal: string | null }[] = [];
        try {
          const oldObj = r.old_values ? JSON.parse(r.old_values) : null;
          const newObj = r.new_values ? JSON.parse(r.new_values) : null;
          const allKeys = new Set([
            ...Object.keys(oldObj || {}),
            ...Object.keys(newObj || {}),
          ]);
          for (const k of allKeys) {
            if (SKIP.has(k)) continue;
            const ov = oldObj?.[k] ?? null;
            const nv = newObj?.[k] ?? null;
            if (String(ov ?? '') !== String(nv ?? '')) {
              diff.push({
                field: k,
                oldVal: ov !== null && ov !== undefined ? String(ov) : null,
                newVal: nv !== null && nv !== undefined ? String(nv) : null,
              });
            }
          }
        } catch { /* skip */ }

        return {
          id: r.id,
          entityType: ENTITY_LABEL[r.entity_table] || r.entity_table,
          entityId: r.entity_id,
          reason: r.reason,
          changedBy: r.changed_by_name || '未知',
          createdAt: r.created_at,
          diff,
        };
      });

      res.json({ date, records });
    } catch (error: any) {
      console.error('获取明细失败:', error);
      res.status(500).json({ error: error.message || '获取明细失败' });
    }
  });

  // ── 待办事项汇总 ──────────────────────────────────────────────
  // GET /api/data/todo?projectId=N
  router.get('/todo', authenticate, async (req: any, res) => {
    try {
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;
      if (!projectId) return res.status(400).json({ error: '缺少 projectId' });

      const [
        devCompletion, connCompletion, sigCompletion,
        devApproval,   connApproval,   sigApproval,
        draftDevices,  draftSignals,
        overdueRow,
      ] = await Promise.all([
        // 待完善
        db.get(`SELECT COUNT(DISTINCT entity_id) as c FROM approval_requests
                WHERE project_id=? AND status='pending' AND current_phase='completion' AND entity_type='device'`, [projectId]),
        db.get(`SELECT COUNT(DISTINCT entity_id) as c FROM approval_requests
                WHERE project_id=? AND status='pending' AND current_phase='completion' AND entity_type='connector'`, [projectId]),
        db.get(`SELECT COUNT(DISTINCT entity_id) as c FROM approval_requests
                WHERE project_id=? AND status='pending' AND current_phase='completion' AND entity_type='signal'`, [projectId]),
        // 待审批
        db.get(`SELECT COUNT(DISTINCT entity_id) as c FROM approval_requests
                WHERE project_id=? AND status='pending' AND current_phase='approval' AND entity_type='device'`, [projectId]),
        db.get(`SELECT COUNT(DISTINCT entity_id) as c FROM approval_requests
                WHERE project_id=? AND status='pending' AND current_phase='approval' AND entity_type='connector'`, [projectId]),
        db.get(`SELECT COUNT(DISTINCT entity_id) as c FROM approval_requests
                WHERE project_id=? AND status='pending' AND current_phase='approval' AND entity_type='signal'`, [projectId]),
        // 草稿（已创建但未提交审批）
        db.get(`SELECT COUNT(*) as c FROM devices WHERE project_id=? AND status='Draft'`, [projectId]),
        db.get(`SELECT COUNT(*) as c FROM signals WHERE project_id=? AND status='Draft'`, [projectId]),
        // 超期告警：pending 超过 7 天未处理
        db.get(`SELECT COUNT(*) as c FROM approval_requests
                WHERE project_id=? AND status='pending'
                AND created_at < datetime('now','-7 days')`, [projectId]),
      ]);

      res.json({
        completion: {
          device:    devCompletion?.c  || 0,
          connector: connCompletion?.c || 0,
          signal:    sigCompletion?.c  || 0,
        },
        approval: {
          device:    devApproval?.c  || 0,
          connector: connApproval?.c || 0,
          signal:    sigApproval?.c  || 0,
        },
        draft: {
          device: draftDevices?.c || 0,
          signal: draftSignals?.c || 0,
        },
        alerts: {
          overdue: overdueRow?.c || 0,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/data/todo/detail?projectId=N&type=completion|approval|draft
  router.get('/todo/detail', authenticate, async (req: any, res) => {
    try {
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;
      const type = req.query.type as string;
      if (!projectId || !type) return res.status(400).json({ error: '缺少参数' });

      const ENTITY_LABEL: Record<string, string> = { device: '设备', connector: '连接器', signal: '信号' };
      const ACTION_LABEL: Record<string, string> = { create: '新增', update: '修改', delete: '删除' };
      const now = Date.now();

      if (type === 'completion' || type === 'approval') {
        const phase = type === 'completion' ? 'completion' : 'approval';
        const rows = await db.query(
          `SELECT ar.id, ar.entity_type, ar.entity_id, ar.action_type, ar.created_at,
                  ar.requester_username,
                  GROUP_CONCAT(DISTINCT ai.recipient_username) as recipients,
                  COALESCE(d."设备名称", s.unique_id, c."设备端元器件编号") as entity_name,
                  d."设备负责人" as device_owner
           FROM approval_requests ar
           JOIN approval_items ai ON ai.approval_request_id = ar.id
                AND ai.item_type = ? AND ai.status = 'pending'
           LEFT JOIN devices d    ON ar.entity_type = 'device'    AND ar.entity_id = d.id
           LEFT JOIN signals s    ON ar.entity_type = 'signal'    AND ar.entity_id = s.id
           LEFT JOIN connectors c ON ar.entity_type = 'connector' AND ar.entity_id = c.id
           WHERE ar.project_id = ? AND ar.status = 'pending' AND ar.current_phase = ?
           GROUP BY ar.id
           ORDER BY ar.created_at ASC`,
          [phase, projectId, phase]
        );
        const items = rows.map((r: any) => ({
          id: r.id,
          entityType: ENTITY_LABEL[r.entity_type] || r.entity_type,
          entityName: r.entity_name || `#${r.entity_id}`,
          actionType: ACTION_LABEL[r.action_type] || r.action_type,
          daysAgo: Math.floor((now - new Date(r.created_at).getTime()) / 86400000),
          requester: r.requester_username,
          responsible: r.recipients ? r.recipients.split(',') : [],
        }));
        return res.json({ type, items });
      }

      if (type === 'draft') {
        const devices = await db.query(
          `SELECT id, '设备' as et, "设备名称" as name, "设备负责人" as owner, created_at
           FROM devices WHERE project_id = ? AND status = 'Draft'`, [projectId]
        );
        const signals = await db.query(
          `SELECT id, '信号' as et, unique_id as name, '' as owner, created_at
           FROM signals WHERE project_id = ? AND status = 'Draft'`, [projectId]
        );
        const items = [...devices, ...signals]
          .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
          .map((r: any) => ({
            id: r.id,
            entityType: r.et,
            entityName: r.name || `#${r.id}`,
            actionType: '草稿',
            daysAgo: Math.floor((now - new Date(r.created_at).getTime()) / 86400000),
            requester: r.owner || '—',
            responsible: r.owner ? [r.owner] : [],
          }));
        return res.json({ type, items });
      }

      res.status(400).json({ error: '无效 type' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/data/todo/notify  — 向待办责任人批量推送站内通知
  router.post('/todo/notify', authenticate, async (req: any, res) => {
    try {
      const { projectId, type, items } = req.body as {
        projectId: number;
        type: string;
        items: { id: number; entityType: string; entityName: string; responsible: string[] }[];
      };
      if (!projectId || !type || !Array.isArray(items)) {
        return res.status(400).json({ error: '缺少参数' });
      }

      const sender = req.user?.username || '管理员';
      const typeLabel: Record<string, string> = { completion: '待完善', approval: '待审批', draft: '草稿待提交' };
      const label = typeLabel[type] || type;

      let notified = 0;
      for (const item of items) {
        for (const username of item.responsible) {
          if (!username) continue;
          await db.run(
            `INSERT INTO notifications (recipient_username, type, title, message)
             VALUES (?, 'todo_reminder', ?, ?)`,
            [
              username,
              `待办提醒：${item.entityType}${item.entityName} [${label}]`,
              `${sender} 提醒您处理「${item.entityType}」${item.entityName} 的${label}任务，请尽快登录系统完成操作。`,
            ]
          );
          notified++;
        }
      }

      res.json({ success: true, notified });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── 编辑锁 ────────────────────────────────────────────────

  const purgeExpiredLocks = () =>
    db.run("DELETE FROM edit_locks WHERE expires_at <= datetime('now')");

  // 获取表的当前锁状态
  router.get('/locks', authenticate, async (req, res) => {
    try {
      const { table_name } = req.query as { table_name: string };
      if (!table_name) return res.status(400).json({ error: '缺少 table_name' });
      await purgeExpiredLocks();
      const rows = await db.query(
        'SELECT row_id, locked_by, locked_by_name, locked_at, expires_at FROM edit_locks WHERE table_name = ?',
        [table_name]
      );
      const locks: Record<number, { lockedBy: string; lockedAt: string; expiresAt: string }> = {};
      for (const r of rows) {
        locks[r.row_id] = { lockedBy: r.locked_by_name, lockedAt: r.locked_at, expiresAt: r.expires_at };
      }
      res.json({ locks });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 获取锁
  router.post('/lock', authenticate, async (req: AuthRequest, res) => {
    try {
      const { table_name, row_id } = req.body;
      if (!table_name || row_id == null) return res.status(400).json({ error: '缺少参数' });
      const userId = req.user!.id;
      const username = req.user!.username;

      await purgeExpiredLocks();

      const existing = await db.get(
        'SELECT * FROM edit_locks WHERE table_name = ? AND row_id = ?',
        [table_name, row_id]
      );

      if (existing && existing.locked_by !== userId) {
        return res.status(409).json({
          error: `该记录正在被 ${existing.locked_by_name} 编辑，请稍后再试`,
          lockedBy: existing.locked_by_name,
          expiresAt: existing.expires_at,
        });
      }

      await db.run(
        `INSERT OR REPLACE INTO edit_locks (table_name, row_id, locked_by, locked_by_name, locked_at, expires_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+5 minutes'))`,
        [table_name, row_id, userId, username]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 心跳续期
  router.put('/lock', authenticate, async (req: AuthRequest, res) => {
    try {
      const { table_name, row_id } = req.body;
      if (!table_name || row_id == null) return res.status(400).json({ error: '缺少参数' });
      await db.run(
        `UPDATE edit_locks SET expires_at = datetime('now', '+5 minutes')
         WHERE table_name = ? AND row_id = ? AND locked_by = ?`,
        [table_name, row_id, req.user!.id]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 释放锁
  router.delete('/lock', authenticate, async (req: AuthRequest, res) => {
    try {
      const { table_name, row_id } = req.body;
      if (!table_name || row_id == null) return res.status(400).json({ error: '缺少参数' });
      await db.run(
        'DELETE FROM edit_locks WHERE table_name = ? AND row_id = ? AND locked_by = ?',
        [table_name, row_id, req.user!.id]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
