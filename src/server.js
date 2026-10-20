// 入口：启动 Fastify、初始化数据库、注册路由、启动定时监控
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { initSchema } from './db/index.js';
import { registerRoutes } from './routes.js';
import { startMonitor } from './services/monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let config = {};
try {
  config = JSON.parse(readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'));
} catch {
  console.warn('[server] config.json 读取失败，使用默认配置');
}

// 初始化数据库（首次启动自动建表）
await initSchema();

const app = Fastify({ logger: false });

// 静态资源：前端单页
await app.register(fastifyStatic, { root: path.join(__dirname, '..', 'public') });
app.get('/', async (_req, reply) => reply.sendFile('index.html'));

// API 路由
await registerRoutes(app);

// 启动定时监控（启动即跑一次巡检）
startMonitor();

// 启动服务
const port = config.port ?? 3000;
const host = config.host ?? '0.0.0.0';
await app.listen({ port, host });
console.log(`大模型 API 管理平台已启动: http://localhost:${port}`);
