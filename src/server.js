import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { initSchema } from './db/index.js';
import { registerRoutes } from './routes.js';
import { startMonitor } from './services/monitor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf-8'));

const fastify = Fastify({ logger: false });

// 静态前端
fastify.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
});

// 初始化数据库（异步）
await initSchema();

// 注册 API
await registerRoutes(fastify);

// 启动监控
startMonitor();

const port = config.port || 3000;
const host = config.host || '0.0.0.0';

fastify.listen({ port, host }, (err) => {
  if (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
  console.log(`大模型 API 管理平台已启动: http://localhost:${port}`);
});
