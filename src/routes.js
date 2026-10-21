// API 路由
import db from './db/index.js';
import { refreshPlatformBalance } from './services/balance.js';
import {
  maybeCreateRechargeOrder, notifyOrder, markPaid, creditOrder, tryCreditOrder,
  depositFundPool, getFundPool,
} from './services/recharge.js';
import { runMonitorCycle } from './services/monitor.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STORAGE_KEY_BY_NAME, storageFileFor } from './services/scraper_wallets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const LOGIN_LOG = join(PROJECT_ROOT, 'src', 'wallet-states', 'login-run.log');

let loginRunning = false;

// 平台 → 登录态文件 key（与 wallet-login.mjs 的转换一致）
function storageKeyFor(platform) {
  return STORAGE_KEY_BY_NAME[platform.name] || platform.provider || platform.name;
}

export async function registerRoutes(fastify) {
  // ===== 一键登录 =====
  fastify.get('/api/login/status', async () => ({ running: loginRunning }));

  // 拉起登录脚本（弹浏览器窗口；不阻塞等待，用户完成登录后脚本自行退出）
  fastify.post('/api/login/run', async (req) => {
    if (loginRunning) {
      return { running: true, message: '已有登录流程正在运行，请先在弹出的窗口完成登录' };
    }
    const b = req.body || {};
    let platform = null;
    if (b.platform) {
      const row = db.prepare('SELECT * FROM platforms WHERE id = ? OR name = ?').get(b.platform, b.platform);
      platform = row || null;
    }
    const args = ['scripts/wallet-login.mjs'];
    if (platform) args.push(storageKeyFor(platform));
    loginRunning = true;
    try {
      // 脚本输出记录到日志文件，前端可查询登录结果
      fs.mkdirSync(dirname(LOGIN_LOG), { recursive: true });
      fs.writeFileSync(LOGIN_LOG, `[${new Date().toLocaleString()}] 开始登录：${platform ? platform.name : '全部浏览器抓取型平台'}\n`);
      const out = fs.openSync(LOGIN_LOG, 'a');
      const child = spawn(process.execPath, args, { cwd: PROJECT_ROOT, detached: true, stdio: ['ignore', out, out] });
      child.on('exit', () => { loginRunning = false; try { fs.closeSync(out); } catch {} });
      child.on('error', () => { loginRunning = false; try { fs.closeSync(out); } catch {} });
      child.unref();
      return {
        running: true,
        message: platform
          ? `已打开「${platform.name}」的登录窗口，请在弹出的浏览器里完成登录；登录成功会自动保存并关闭`
          : '已打开登录窗口，请按顺序完成各平台登录',
      };
    } catch (err) {
      loginRunning = false;
      return { running: false, message: '启动登录失败：' + err.message };
    }
  });

  // 最近一次登录流程的完整输出（每个平台成功/失败一目了然）
  fastify.get('/api/login/result', async () => {
    try {
      return { log: fs.readFileSync(LOGIN_LOG, 'utf8') || '' };
    } catch {
      return { log: '' };
    }
  });

  // 查询某平台是否已有登录态文件（没有则抓取前必须登录一次）
  fastify.get('/api/platforms/:id/login-state', async (req) => {
    const p = db.prepare('SELECT * FROM platforms WHERE id = ?').get(req.params.id);
    if (!p) return { exists: false, key: null };
    return { exists: Boolean(storageFileFor(p.name, p.provider)), key: storageKeyFor(p) };
  });

  // ===== 平台面板 =====
  fastify.get('/api/platforms', async () => {
    const list = db.prepare('SELECT * FROM platforms ORDER BY id').all();
    // 附带最新余额
    return list.map((p) => {
      const latest = db.prepare(
        'SELECT balance, checked_at FROM balance_history WHERE platform_id = ? ORDER BY id DESC LIMIT 1'
      ).get(p.id);
      return { ...p, api_key: p.api_key ? '••••••••' : '', api_key_secret: p.api_key_secret ? '••••••••' : '', latest_balance: latest?.balance ?? null, latest_checked_at: latest?.checked_at ?? null };
    });
  });

  fastify.get('/api/platforms/:id', async (req) => {
    return db.prepare('SELECT * FROM platforms WHERE id = ?').get(req.params.id);
  });

  fastify.post('/api/platforms', async (req, reply) => {
    const b = req.body || {};
    if (!b.name) return reply.code(400).send({ error: 'name 必填' });
    try {
      const info = db.prepare(`
        INSERT INTO platforms (name, provider, base_url, api_key, api_key_secret, balance_type, balance_api_url,
          balance_json_path, currency, threshold, recharge_amount, target_amount, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        b.name, b.provider || 'generic', b.base_url || null, b.api_key || null, b.api_key_secret || null,
        b.balance_type || 'api', b.balance_api_url || null, b.balance_json_path || null,
        b.currency || 'USD', b.threshold ?? 200, b.recharge_amount ?? 500,
        b.target_amount ?? null, b.active ?? 1
      );
      return { id: info.lastInsertRowid };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.put('/api/platforms/:id', async (req, reply) => {
    const id = req.params.id;
    const b = req.body || {};
    const existing = db.prepare('SELECT * FROM platforms WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ error: '平台不存在' });
    const apiKey = b.api_key === undefined ? existing.api_key : b.api_key;
    const apiKeySecret = b.api_key_secret === undefined ? existing.api_key_secret : b.api_key_secret;
    db.prepare(`
      UPDATE platforms SET name=?, provider=?, base_url=?, api_key=?, api_key_secret=?, balance_type=?,
        balance_api_url=?, balance_json_path=?, currency=?, threshold=?, recharge_amount=?,
        target_amount=?, active=?, updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(
      b.name ?? existing.name, b.provider ?? existing.provider, b.base_url ?? existing.base_url,
      apiKey, apiKeySecret, b.balance_type ?? existing.balance_type, b.balance_api_url ?? existing.balance_api_url,
      b.balance_json_path ?? existing.balance_json_path, b.currency ?? existing.currency,
      b.threshold ?? existing.threshold, b.recharge_amount ?? existing.recharge_amount,
      b.target_amount ?? existing.target_amount, b.active ?? existing.active, id
    );
    return { ok: true };
  });

  fastify.delete('/api/platforms/:id', async (req) => {
    db.prepare('DELETE FROM platforms WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // 手动刷新单个平台余额
  fastify.post('/api/platforms/:id/refresh', async (req, reply) => {
    const r = await refreshPlatformBalance(req.params.id);
    if (!r.ok) return reply.code(500).send(r);
    return r;
  });

  // 手动录入余额
  fastify.post('/api/platforms/:id/balance', async (req, reply) => {
    const { balance } = req.body || {};
    if (balance == null) return reply.code(400).send({ error: 'balance 必填' });
    const p = db.prepare('SELECT * FROM platforms WHERE id = ?').get(req.params.id);
    if (!p) return reply.code(404).send({ error: '平台不存在' });
    db.prepare('INSERT INTO balance_history (platform_id, balance, currency) VALUES (?, ?, ?)')
      .run(p.id, balance, p.currency);
    return { ok: true };
  });

  // 余额历史
  fastify.get('/api/platforms/:id/history', async (req) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    return db.prepare(
      'SELECT balance, currency, checked_at FROM balance_history WHERE platform_id = ? ORDER BY id DESC LIMIT ?'
    ).all(req.params.id, limit);
  });

  // ===== 充值单 =====
  fastify.get('/api/orders', async () => {
    return db.prepare(`
      SELECT o.*, p.name AS platform_name FROM recharge_orders o
      JOIN platforms p ON p.id = o.platform_id ORDER BY o.id DESC
    `).all();
  });

  fastify.post('/api/orders/:id/notify', async (req) => {
    return notifyOrder(req.params.id);
  });

  fastify.post('/api/orders/:id/paid', async (req, reply) => {
    const o = markPaid(req.params.id);
    if (!o) return reply.code(400).send({ error: '订单不存在或状态不允许' });
    return o;
  });

  // 撤销打款：误标记后改回已通知
  fastify.post('/api/orders/:id/unmark-paid', async (req, reply) => {
    const o = db.prepare("SELECT * FROM recharge_orders WHERE id = ? AND status = 'paid'").get(req.params.id);
    if (!o) return reply.code(400).send({ error: '订单不存在或未处于已打款状态' });
    db.prepare("UPDATE recharge_orders SET status = 'notified', paid_at = NULL WHERE id = ?").run(req.params.id);
    return db.prepare('SELECT * FROM recharge_orders WHERE id = ?').get(req.params.id);
  });

  // 充值日记：填写/修改用途备注
  fastify.post('/api/orders/:id/note', async (req, reply) => {
    const { note } = req.body || {};
    const o = db.prepare('SELECT * FROM recharge_orders WHERE id = ?').get(req.params.id);
    if (!o) return reply.code(404).send({ error: '订单不存在' });
    db.prepare('UPDATE recharge_orders SET note = ? WHERE id = ?').run(note || null, req.params.id);
    return db.prepare('SELECT * FROM recharge_orders WHERE id = ?').get(req.params.id);
  });

  fastify.post('/api/orders/:id/credit', async (req, reply) => {
    const r = await tryCreditOrder(req.params.id);
    if (!r.ok) return reply.code(400).send({ error: r.reason || r.error || '尚未检测到到账' });
    return r;
  });

  // 手动直接确认到账
  fastify.post('/api/orders/:id/credit-force', async (req, reply) => {
    const r = creditOrder(req.params.id);
    if (!r.ok) return reply.code(400).send({ error: r.reason || r.error || '无法确认到账' });
    return r;
  });

  // ===== 资金池 =====
  fastify.get('/api/fund', async () => {
    const pool = getFundPool();
    const txs = db.prepare('SELECT * FROM fund_transactions ORDER BY id DESC LIMIT 100').all();
    return { pool, transactions: txs };
  });

  // 月度充值统计：某月各平台到账明细（status=credited 的记录）
  fastify.get('/api/fund/monthly', async (req) => {
    const now = new Date();
    const defMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : defMonth;
    const rows = db.prepare(`
      SELECT o.id, p.name AS platform_name, o.amount, o.currency, o.note, o.credited_at
      FROM recharge_orders o JOIN platforms p ON p.id = o.platform_id
      WHERE o.status = 'credited' AND o.credited_at LIKE ?
      ORDER BY o.credited_at DESC
    `).all(month + '%');
    const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
    return { month, rows, total };
  });

  fastify.post('/api/fund/deposit', async (req, reply) => {
    const { amount, note } = req.body || {};
    if (!amount || amount <= 0) return reply.code(400).send({ error: 'amount 需为正数' });
    return depositFundPool(amount, note);
  });

  // ===== 手动触发巡检 =====
  fastify.post('/api/monitor/run', async () => {
    return runMonitorCycle();
  });
}
