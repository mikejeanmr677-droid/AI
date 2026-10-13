// 监控调度器：周期刷新余额 → 阈值判断 → 生成单据 → 通知 → 到账跟踪
import db from '../db/index.js';
import { refreshPlatformBalance } from './balance.js';
import { maybeCreateRechargeOrder, notifyOrder, tryCreditOrder } from './recharge.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let config = {};
try {
  config = JSON.parse(readFileSync(join(__dirname, '..', '..', 'config.json'), 'utf-8'));
} catch {}

const intervalMs = config.monitor?.intervalMs ?? 600000;

// 单次巡检
export async function runMonitorCycle() {
  const platforms = db.prepare('SELECT * FROM platforms WHERE active = 1').all();
  const results = { refreshed: [], orders: [], credited: [], errors: [] };

  for (const p of platforms) {
    // 1. 刷新余额
    const r = await refreshPlatformBalance(p.id);
    if (!r.ok) {
      results.errors.push({ platformId: p.id, error: r.error });
      continue;
    }
    results.refreshed.push({ platformId: p.id, balance: r.balance });

    // 2. 阈值判断，生成充值单
    const order = maybeCreateRechargeOrder(p.id);
    if (order) {
      results.orders.push(order);
      // 3. 通知
      await notifyOrder(order.orderId);
    }
  }

  // 4. 到账跟踪：已打款的单子尝试确认到账
  const paidOrders = db.prepare("SELECT id FROM recharge_orders WHERE status = 'paid'").all();
  for (const o of paidOrders) {
    const cr = await tryCreditOrder(o.id);
    if (cr.ok) results.credited.push(o.id);
  }

  return results;
}

export function startMonitor() {
  const run = async () => {
    try {
      const r = await runMonitorCycle();
      const ts = new Date().toLocaleTimeString();
      console.log(`[monitor ${ts}] 刷新 ${r.refreshed.length} 平台, 生成 ${r.orders.length} 充值单, 到账 ${r.credited.length}, 错误 ${r.errors.length}`);
    } catch (err) {
      console.error('[monitor] 巡检异常:', err.message);
    }
  };
  run(); // 启动即跑一次
  const timer = setInterval(run, intervalMs);
  return timer;
}
