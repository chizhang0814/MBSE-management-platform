import express from 'express';
import bcrypt from 'bcryptjs';
import { Database } from '../database.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export function usersRoutes(db: Database) {
  const router = express.Router();

  // 根据项目名称和角色获取用户列表（用于设备负责人搜索）
  // 注意：这个路由必须在 /:id 路由之前，否则会被 /:id 路由拦截
  router.get('/by-project-role', authenticate, async (req, res) => {
    try {
      const { projectName, projectRole, query } = req.query;
      
      if (!projectName || !projectRole) {
        return res.status(400).json({ error: '缺少必要参数：projectName 和 projectRole' });
      }
      
      // 获取所有用户
      const users = await db.query('SELECT id, username, role, permissions FROM users');
      
      // 筛选出拥有指定项目指定角色的用户
      const filteredUsers = users.filter((user: any) => {
        // 管理员拥有所有权限
        if (user.role === 'admin') {
          return true;
        }
        
        // 解析权限
        let permissions: any[] = [];
        try {
          permissions = user.permissions ? JSON.parse(user.permissions) : [];
        } catch (e) {
          return false;
        }
        
        // 检查是否有匹配的权限
        return permissions.some((perm: any) => 
          perm.project_name === projectName && perm.project_role === projectRole
        );
      });
      
      // 如果有查询关键词，进行模糊搜索
      let result = filteredUsers.map((user: any) => ({
        id: user.id,
        username: user.username
      }));
      
      if (query && typeof query === 'string' && query.trim() !== '') {
        const searchQuery = query.trim().toLowerCase();
        result = result.filter((user: any) => 
          user.username.toLowerCase().includes(searchQuery)
        );
      }
      
      res.json({ users: result });
    } catch (error) {
      console.error('获取用户列表失败:', error);
      res.status(500).json({ error: '获取用户列表失败' });
    }
  });

  // 获取当前用户的权限列表（用于前端导航栏判断）
  router.get('/me/permissions', authenticate, async (req: any, res) => {
    try {
      const userRow = await db.get('SELECT permissions FROM users WHERE id = ?', [req.user!.id]);
      const permissions = userRow?.permissions ? JSON.parse(userRow.permissions) : [];
      res.json({ permissions });
    } catch (error) {
      res.status(500).json({ error: '获取权限失败' });
    }
  });

  // 获取所有用户
  router.get('/', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const users = await db.query('SELECT id, username, role, permissions, created_at FROM users ORDER BY id DESC');
      // 解析 permissions JSON
      const parsedUsers = users.map((user: any) => ({
        ...user,
        permissions: user.permissions ? JSON.parse(user.permissions) : []
      }));
      res.json({ users: parsedUsers });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取用户列表失败' });
    }
  });

  // 获取待审批的权限申请（admin 看全部，总体人员看自己项目的）
  // 注意：必须在 /:id 路由之前，否则会被 /:id 拦截
  router.get('/permission-requests', authenticate, async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'admin';
      if (isAdmin) {
        const requests = await db.query(`
          SELECT pr.id, pr.user_id, u.username, u.display_name, pr.project_name, pr.project_role,
                 pr.status, pr.created_at, pr.reviewed_at
          FROM permission_requests pr
          JOIN users u ON pr.user_id = u.id
          ORDER BY pr.created_at DESC
        `);
        return res.json({ requests });
      }

      // 普通用户：只返回自己是总体人员的项目的 pending 申请
      const userRow = await db.get('SELECT permissions FROM users WHERE id = ?', [req.user.id]);
      const perms: Array<{ project_name: string; project_role: string }> = userRow?.permissions ? JSON.parse(userRow.permissions) : [];
      const zontiProjects = perms.filter(p => p.project_role === '总体人员').map(p => p.project_name);
      if (zontiProjects.length === 0) return res.json({ requests: [] });

      const ph = zontiProjects.map(() => '?').join(',');
      const requests = await db.query(`
        SELECT pr.id, pr.user_id, u.username, u.display_name, pr.project_name, pr.project_role,
               pr.status, pr.created_at, pr.reviewed_at
        FROM permission_requests pr
        JOIN users u ON pr.user_id = u.id
        WHERE pr.project_name IN (${ph}) AND pr.status = 'pending'
        ORDER BY pr.created_at DESC
      `, zontiProjects);
      res.json({ requests });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取申请列表失败' });
    }
  });

  // 审批权限申请（admin 或该项目的总体人员）
  router.put('/permission-requests/:id', authenticate, async (req: any, res) => {
    try {
      const { action } = req.body; // 'approve' | 'reject'
      const requestId = req.params.id;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: '无效的操作' });
      }

      const request = await db.get(
        'SELECT * FROM permission_requests WHERE id = ? AND status = ?',
        [requestId, 'pending']
      );
      if (!request) {
        return res.status(404).json({ error: '申请不存在或已处理' });
      }

      // 权限检查：admin 或该项目的总体人员
      const isAdmin = req.user.role === 'admin';
      if (!isAdmin) {
        const userRow = await db.get('SELECT permissions FROM users WHERE id = ?', [req.user.id]);
        const perms: Array<{ project_name: string; project_role: string }> = userRow?.permissions ? JSON.parse(userRow.permissions) : [];
        const isZonti = perms.some(p => p.project_name === request.project_name && p.project_role === '总体人员');
        if (!isZonti) return res.status(403).json({ error: '无权审批此申请' });
      }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      await db.run(
        'UPDATE permission_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?',
        [newStatus, req.user.id, requestId]
      );

      // 若批准，将权限写入用户的 permissions 字段
      if (action === 'approve') {
        const user = await db.get('SELECT permissions FROM users WHERE id = ?', [request.user_id]);
        const perms = user.permissions ? JSON.parse(user.permissions) : [];
        const exists = perms.some(
          (p: any) => p.project_name === request.project_name && p.project_role === request.project_role
        );
        if (!exists) {
          perms.push({ project_name: request.project_name, project_role: request.project_role });
          await db.run('UPDATE users SET permissions = ? WHERE id = ?', [JSON.stringify(perms), request.user_id]);
        }
      }

      // 将所有总体人员收到的该申请通知标记为已处理（按钮消失）
      await db.run(
        `UPDATE notifications SET type = 'permission_processed' WHERE type = 'permission_request' AND reference_id = ?`,
        [requestId]
      );

      // 通知申请人
      const applicant = await db.get('SELECT username FROM users WHERE id = ?', [request.user_id]);
      if (applicant) {
        const statusText = action === 'approve' ? '已通过' : '已被拒绝';
        await db.run(
          `INSERT INTO notifications (recipient_username, type, title, message)
           VALUES (?, ?, ?, ?)`,
          [applicant.username,
           action === 'approve' ? 'permission_approved' : 'permission_rejected',
           `权限申请${statusText}`,
           `您申请 ${request.project_name} 的「${request.project_role}」角色${statusText}`]
        );
      }

      res.json({ message: action === 'approve' ? '已批准' : '已驳回' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '审批失败' });
    }
  });

  // 获取单个用户
  router.get('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const user = await db.get('SELECT id, username, role, permissions, created_at FROM users WHERE id = ?', [req.params.id]);
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      res.json({ 
        user: {
          ...user,
          permissions: user.permissions ? JSON.parse(user.permissions) : []
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '获取用户失败' });
    }
  });

  // 创建用户
  router.post('/', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { username, password, role, permissions } = req.body;

      if (!username || !password || !role) {
        return res.status(400).json({ error: '缺少必要参数' });
      }

      if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ error: '无效的角色' });
      }

      // 检查用户名是否已存在
      const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
      if (existing) {
        return res.status(400).json({ error: '用户名已存在' });
      }

      // 加密密码
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // 处理权限：如果是普通用户且有permissions，将其序列化为JSON
      const permissionsJson = permissions ? JSON.stringify(permissions) : '[]';

      await db.run('INSERT INTO users (username, password, role, permissions) VALUES (?, ?, ?, ?)', [
        username,
        hashedPassword,
        role,
        permissionsJson,
      ]);

      res.json({ message: '用户创建成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '创建用户失败' });
    }
  });

  // 更新用户
  router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { username, password, role, permissions } = req.body;
      const userId = req.params.id;

      // 检查用户是否存在，并获取当前角色
      const existing = await db.get('SELECT id, role FROM users WHERE id = ?', [userId]);
      if (!existing) {
        return res.status(404).json({ error: '用户不存在' });
      }

      // 禁止将普通用户转为管理员
      if (role && role === 'admin' && existing.role !== 'admin') {
        return res.status(403).json({ error: '不允许将普通用户提升为管理员' });
      }

      // 如果提供了新用户名，检查是否冲突
      if (username) {
        const conflict = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
        if (conflict) {
          return res.status(400).json({ error: '用户名已被使用' });
        }
      }

      // 更新用户信息
      if (username || role || permissions !== undefined) {
        const updates: string[] = [];
        const params: any[] = [];

        if (username) {
          updates.push('username = ?');
          params.push(username);
        }

        if (role) {
          if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({ error: '无效的角色' });
          }
          updates.push('role = ?');
          params.push(role);
        }
        
        if (permissions !== undefined) {
          updates.push('permissions = ?');
          params.push(JSON.stringify(permissions));
        }

        params.push(userId);
        await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      // 更新密码（如果提供）
      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
      }

      res.json({ message: '用户更新成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '更新用户失败' });
    }
  });

  // 删除用户
  router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const userId = req.params.id;

      // 获取当前用户ID
      const currentUser = (req as any).user;
      if (parseInt(userId) === currentUser.id) {
        return res.status(400).json({ error: '不能删除自己' });
      }

      // 检查用户是否存在
      const existing = await db.get('SELECT id, username FROM users WHERE id = ?', [userId]);
      if (!existing) {
        return res.status(404).json({ error: '用户不存在' });
      }

      // 清理所有引用该用户的外键关联记录
      await db.run('DELETE FROM edit_locks WHERE locked_by = ?', [userId]);
      await db.run('DELETE FROM tasks WHERE assigned_by = ? OR assigned_to = ?', [userId, userId]);
      await db.run('DELETE FROM change_logs WHERE changed_by = ?', [userId]);
      await db.run('DELETE FROM uploaded_files WHERE uploaded_by = ?', [userId]);
      await db.run('DELETE FROM approval_requests WHERE requester_id = ?', [userId]);
      await db.run('UPDATE approval_requests SET reviewed_by_username = NULL WHERE reviewed_by_username = ?', [existing.username]);
      await db.run('UPDATE permission_requests SET reviewed_by = NULL WHERE reviewed_by = ?', [userId]);
      // 将该用户创建的项目转给 admin (id=1)
      await db.run('UPDATE projects SET created_by = 1 WHERE created_by = ?', [userId]);

      await db.run('DELETE FROM users WHERE id = ?', [userId]);

      res.json({ message: '用户删除成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '删除用户失败' });
    }
  });

  // 重置用户密码
  router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
    try {
      const { password } = req.body;
      const userId = req.params.id;

      if (!password) {
        return res.status(400).json({ error: '请提供新密码' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

      res.json({ message: '密码重置成功' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '重置密码失败' });
    }
  });

  return router;
}
