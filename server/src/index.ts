import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Database } from './database.js';
import { authRoutes } from './routes/auth.js';
import { dataRoutes } from './routes/data.js';
import { taskRoutes } from './routes/tasks.js';
import { uploadRoutes } from './routes/upload.js';
import { usersRoutes } from './routes/users.js';
import { projectRoutes } from './routes/projects.js';
import { deviceRoutes } from './routes/devices.js';
import { signalRoutes } from './routes/signals.js';
import { sysmlBrowserRoutes } from './routes/sysml-browser.js';
import { notificationRoutes } from './routes/notifications.js';
import { approvalRoutes } from './routes/approvals.js';
import { sectionConnectorRoutes } from './routes/section-connectors.js';
import { changeLogRoutes } from './routes/change-logs.js';
import { employeeRoutes } from './routes/employees.js';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 初始化数据库
const db = new Database();
await db.init();

// 确保uploads目录存在
import fs from 'fs';
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 路由
app.use('/api/auth', authRoutes(db));
app.use('/api/data', dataRoutes(db));
app.use('/api/tasks', taskRoutes(db));
app.use('/api/upload', uploadRoutes(db));
app.use('/api/users', usersRoutes(db));
app.use('/api/projects', projectRoutes(db));
app.use('/api/devices', deviceRoutes(db));
app.use('/api/signals', signalRoutes(db));
app.use('/api/sysml', sysmlBrowserRoutes());
app.use('/api/notifications', notificationRoutes(db));
app.use('/api/approvals', approvalRoutes(db));
app.use('/api/section-connectors', sectionConnectorRoutes(db));
app.use('/api/change-logs', changeLogRoutes(db));
app.use('/api/employees', employeeRoutes(db));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


