import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { SysmlApiClient } from '../services/sysml-api-client.js';

export function sysmlBrowserRoutes() {
  const router = express.Router();
  const client = new SysmlApiClient();

  // 获取所有 SysML v2 项目
  router.get('/projects', authenticate, async (_req, res) => {
    try {
      const projects = await client.listProjects();
      res.json({ projects });
    } catch (err: any) {
      res.status(503).json({ error: 'SysML API 不可用', detail: err.message });
    }
  });

  // 获取项目的分支列表
  router.get('/projects/:projectId/branches', authenticate, async (req, res) => {
    try {
      const { projectId } = req.params;
      const branches = await client.listBranches(projectId);
      res.json({ branches });
    } catch (err: any) {
      res.status(503).json({ error: '获取分支失败', detail: err.message });
    }
  });

  // 获取 commit 下的所有元素
  router.get('/projects/:projectId/commits/:commitId/elements', authenticate, async (req, res) => {
    try {
      const { projectId, commitId } = req.params;
      const elements = await client.getElements(projectId, commitId);
      res.json({ elements });
    } catch (err: any) {
      res.status(503).json({ error: '获取元素失败', detail: err.message });
    }
  });

  return router;
}
