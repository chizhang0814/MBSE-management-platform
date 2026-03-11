import { Router, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { Database } from '../database.js';

const SYSTEM_PROMPT = `你是 EICD 综合管理平台的智能助手，专为航空电气系统的设备、连接器、针孔和信号接口数据管理提供支持。

平台功能概述：
- 设备管理：管理航空电气设备（设备编号、安装位置、DAL等级、壳体接地等属性）
- 连接器管理：管理设备端连接器（元器件编号、件号、供应商等）
- 针孔管理：管理连接器针孔（针孔号、端接尺寸、屏蔽类型等）
- 信号管理：管理电气信号及其端点（连接类型、ATA章节、信号端点设备-连接器-针孔关系）
- 审批流程：两阶段审批（完善阶段 → 审批阶段），支持设备/连接器/针孔/信号的增删改审批
- 权限体系：总体人员（审批）、EWIS管理员（信号CRUD）、设备管理员（设备CRUD）、包长/只读

你的职责：
1. 解答平台操作问题
2. 解释航空电气系统相关概念
3. 帮助用户理解数据结构和字段含义
4. 查询并汇总项目数据（使用工具获取实时数据）

回答要简洁专业，使用中文。查询数据时主动调用工具，不要猜测数据。`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_devices',
    description: '搜索项目中的设备列表，可按状态、负责人、关键字过滤',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'number', description: '项目ID' },
        query: { type: 'string', description: '设备编号或名称关键字（可选）' },
        status: { type: 'string', description: '状态过滤：normal/Draft/Pending（可选）' },
        my_devices: { type: 'boolean', description: '是否只查询我负责的设备（可选）' },
        limit: { type: 'number', description: '最多返回条数，默认20' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_project_stats',
    description: '获取项目的设备、连接器、针孔、信号数量统计',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'number', description: '项目ID' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'search_signals',
    description: '搜索项目中的信号列表',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'number', description: '项目ID' },
        query: { type: 'string', description: '信号名称关键字（可选）' },
        connection_type: { type: 'string', description: '连接类型过滤（可选）' },
        status: { type: 'string', description: '状态过滤（可选）' },
        limit: { type: 'number', description: '最多返回条数，默认20' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_my_pending',
    description: '获取当前用户待处理的审批或完善任务',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'number', description: '项目ID（可选，不传则查所有项目）' },
      },
      required: [],
    },
  },
  {
    name: 'lookup_employee',
    description: '通过工号查询员工姓名',
    input_schema: {
      type: 'object' as const,
      properties: {
        eid: { type: 'string', description: '员工工号' },
      },
      required: ['eid'],
    },
  },
  {
    name: 'list_projects',
    description: '列出当前用户有权限的所有项目',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

async function executeTool(
  toolName: string,
  toolInput: any,
  db: Database,
  username: string
): Promise<string> {
  try {
    if (toolName === 'list_projects') {
      const projects = await db.query(
        `SELECT p.id, p.name, p.description,
                COUNT(DISTINCT d.id) as device_count,
                COUNT(DISTINCT s.id) as signal_count
         FROM projects p
         LEFT JOIN devices d ON d.project_id = p.id
         LEFT JOIN signals s ON s.project_id = p.id
         GROUP BY p.id ORDER BY p.name`
      );
      return JSON.stringify(projects);
    }

    if (toolName === 'search_devices') {
      const { project_id, query, status, my_devices, limit = 20 } = toolInput;
      let sql = `SELECT 设备编号, 设备中文名称, 设备安装位置, 设备DAL, 设备负责人, status,
                        (SELECT COUNT(*) FROM connectors c WHERE c.device_id = d.id) as connector_count
                 FROM devices d WHERE project_id = ?`;
      const params: any[] = [project_id];
      if (status) { sql += ' AND status = ?'; params.push(status); }
      if (my_devices) { sql += ' AND "设备负责人" = ?'; params.push(username); }
      if (query) { sql += ' AND (设备编号 LIKE ? OR 设备中文名称 LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }
      sql += ` ORDER BY 设备编号 LIMIT ?`; params.push(limit);
      const rows = await db.query(sql, params);
      const total = await db.get(`SELECT COUNT(*) as cnt FROM devices WHERE project_id = ?${status ? ' AND status = ?' : ''}`, status ? [project_id, status] : [project_id]);
      return JSON.stringify({ total: total?.cnt, results: rows });
    }

    if (toolName === 'get_project_stats') {
      const { project_id } = toolInput;
      const devices = await db.get(`SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='normal' THEN 1 ELSE 0 END) as normal,
        SUM(CASE WHEN status='Draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending
        FROM devices WHERE project_id = ?`, [project_id]);
      const signals = await db.get(`SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status='Draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending
        FROM signals WHERE project_id = ?`, [project_id]);
      const connectors = await db.get(`SELECT COUNT(*) as total FROM connectors c JOIN devices d ON d.id = c.device_id WHERE d.project_id = ?`, [project_id]);
      const pins = await db.get(`SELECT COUNT(*) as total FROM pins p JOIN connectors c ON c.id = p.connector_id JOIN devices d ON d.id = c.device_id WHERE d.project_id = ?`, [project_id]);
      return JSON.stringify({ devices, signals, connectors: connectors?.total, pins: pins?.total });
    }

    if (toolName === 'search_signals') {
      const { project_id, query, connection_type, status, limit = 20 } = toolInput;
      let sql = `SELECT unique_id, 信号名称摘要, 连接类型, 信号ATA, status FROM signals WHERE project_id = ?`;
      const params: any[] = [project_id];
      if (status) { sql += ' AND status = ?'; params.push(status); }
      if (connection_type) { sql += ' AND 连接类型 = ?'; params.push(connection_type); }
      if (query) { sql += ' AND (unique_id LIKE ? OR 信号名称摘要 LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }
      sql += ` ORDER BY unique_id LIMIT ?`; params.push(limit);
      const rows = await db.query(sql, params);
      const total = await db.get(`SELECT COUNT(*) as cnt FROM signals WHERE project_id = ?`, [project_id]);
      return JSON.stringify({ total: total?.cnt, results: rows });
    }

    if (toolName === 'get_my_pending') {
      const { project_id } = toolInput;
      let sql = `SELECT ar.entity_type, ar.entity_id, ar.action_type, ar.created_at, ai.item_type,
                        d.设备编号, s.unique_id
                 FROM approval_items ai
                 JOIN approval_requests ar ON ar.id = ai.approval_request_id
                 LEFT JOIN devices d ON d.id = ar.entity_id AND ar.entity_type = 'device'
                 LEFT JOIN signals s ON s.id = ar.entity_id AND ar.entity_type = 'signal'
                 WHERE ai.recipient_username = ? AND ai.status = 'pending' AND ar.status = 'pending'`;
      const params: any[] = [username];
      if (project_id) { sql += ' AND ar.project_id = ?'; params.push(project_id); }
      sql += ' ORDER BY ar.created_at DESC LIMIT 30';
      const rows = await db.query(sql, params);
      return JSON.stringify({ count: rows.length, items: rows });
    }

    if (toolName === 'lookup_employee') {
      const { eid } = toolInput;
      const emp = await db.get(`SELECT username as eid, name FROM users WHERE username = ?`, [eid]);
      return emp ? JSON.stringify(emp) : `未找到工号 ${eid} 的员工`;
    }

    return '未知工具';
  } catch (e: any) {
    return `查询出错: ${e.message}`;
  }
}

export function chatRoutes(db: Database) {
  const router = Router();

  router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: '缺少消息内容' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: '智能助手未配置，请联系管理员设置 ANTHROPIC_API_KEY' });
    }

    const username = req.user!.username;

    try {
      const client = new Anthropic({ apiKey });
      let msgs: Anthropic.MessageParam[] = messages.map((m: any) => ({ role: m.role, content: m.content }));

      // Agentic loop：最多执行 5 轮工具调用
      for (let i = 0; i < 5; i++) {
        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: msgs,
        });

        if (response.stop_reason === 'end_turn') {
          const text = response.content.find((c: any) => c.type === 'text');
          return res.json({ reply: (text as any)?.text || '' });
        }

        if (response.stop_reason === 'tool_use') {
          // 将助手回复加入消息历史
          msgs.push({ role: 'assistant', content: response.content });

          // 执行所有工具调用
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type === 'tool_use') {
              const result = await executeTool(block.name, block.input as any, db, username);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }
          }
          msgs.push({ role: 'user', content: toolResults });
          continue;
        }

        // 其他 stop_reason，取文本返回
        const text = response.content.find((c: any) => c.type === 'text');
        return res.json({ reply: (text as any)?.text || '' });
      }

      return res.json({ reply: '查询超过最大轮次，请简化问题后重试' });
    } catch (err: any) {
      console.error('Chat API error:', err.message);
      res.status(500).json({ error: '助手暂时无法响应，请稍后再试' });
    }
  });

  return router;
}
