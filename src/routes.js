// API 路由
import db from './db/index.js';
import { refreshPlatformBalance } from './services/balance.js';
import {
  maybeCreateRechargeOrder, notifyOrder, markPaid, creditOrder, tryCreditOrder,
  depositFundPool, getFundPool,
} from './services/recharge.js';
import { runMonitorCycle } from './services/monitor.js';

export async function registerRoutes(fastify) {
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

  fastify.post('/api/orders/:id/credit', async (req, reply) => {
    const r = await tryCreditOrder(req.params.id);
    if (!r.ok) return reply.code(400).send(r);
    return r;
  });

  // 手动直接确认到账
  fastify.post('/api/orders/:id/credit-force', async (req, reply) => {
    const r = creditOrder(req.params.id);
    if (!r.ok) return reply.code(400).send(r);
    return r;
  });

  // ===== 资金池 =====
  fastify.get('/api/fund', async () => {
    const pool = getFundPool();
    const txs = db.prepare('SELECT * FROM fund_transactions ORDER BY id DESC LIMIT 100').all();
    return { pool, transactions: txs };
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
