import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export function feedbackRoutes() {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('仅支持图片文件'));
    },
  });

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== 'false',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  router.post('/', authenticate, upload.single('screenshot'), async (req: AuthRequest, res) => {
    try {
      const { description, page_url } = req.body;
      if (!description || !description.trim()) {
        return res.status(400).json({ error: '请填写问题描述' });
      }

      const user = req.user! as any;
      const attachments: any[] = [];
      if (req.file) {
        attachments.push({
          filename: `screenshot-${Date.now()}.${req.file.mimetype.split('/')[1] || 'png'}`,
          content: req.file.buffer,
          contentType: req.file.mimetype,
        });
      }

      const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      const displayName = user.employee_name || user.display_name || '';

      // 异步发送邮件，立即返回给用户
      const mailOptions = {
        from: `"EICD平台" <${process.env.SMTP_USER}>`,
        to: process.env.FEEDBACK_TO,
        subject: `[EICD平台反馈] ${user.username}${displayName ? `(${displayName})` : ''} - ${now}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px;">
            <h3 style="color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px;">Bug 反馈</h3>
            <table style="border-collapse: collapse; width: 100%; margin-bottom: 16px;">
              <tr><td style="padding: 6px 12px; color: #666; width: 80px;">反馈人</td><td style="padding: 6px 12px;">${user.username}${displayName ? ` (${displayName})` : ''}</td></tr>
              <tr><td style="padding: 6px 12px; color: #666;">时间</td><td style="padding: 6px 12px;">${now}</td></tr>
              ${page_url ? `<tr><td style="padding: 6px 12px; color: #666;">页面</td><td style="padding: 6px 12px;">${page_url}</td></tr>` : ''}
            </table>
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; white-space: pre-wrap;">${description.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
            ${req.file ? '<p style="color: #666; margin-top: 12px;">截图见附件</p>' : ''}
          </div>
        `,
        attachments,
      };

      transporter.sendMail(mailOptions).catch(err => {
        console.error('发送反馈邮件失败:', err);
      });

      res.json({ message: '反馈已提交，感谢您的反馈！' });
    } catch (error: any) {
      console.error('发送反馈邮件失败:', error);
      res.status(500).json({ error: '反馈提交失败，请稍后重试' });
    }
  });

  return router;
}
