// 监控调度器：周期刷新余额 → 阈值判断 → 生成单据 → 通知 → 到账跟踪
import db from '../db/index.js';
import { refreshPlatformBalance } from './balance.js';
import { maybeCreateRechargeOrder, notifyOrder, tryCreditOrder } from './recharge.js';
import { sendPhoneNotify } from './push.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let config = {};
try {
  config = JSON.parse(readFileSync(join(__dirname, '..', '..', 'config.json'), 'utf-8'));
} catch {}

const intervalMs = config.monitor?.intervalMs ?? 600000;

// 读取/写入 settings 键值
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

// 登录态过期提醒：连续 N 次巡检失败才推，且同一平台至少间隔 6 小时
async function maybeNotifyFailures(platforms, errors) {
  const failedIds = new Set(errors.map((e) => e.platformId));
  for (const p of platforms) {
    const countKey = `fail_count_${p.id}`;
    const pushKey = `fail_push_${p.id}`;
    if (failedIds.has(p.id)) {
      const count = (parseInt(getSetting(countKey) || '0', 10) || 0) + 1;
      setSetting(countKey, count);
      if (count >= 3) {
        const lastPush = parseInt(getSetting(pushKey) || '0', 10) || 0;
        if (Date.now() - lastPush >= 6 * 3600 * 1000) {
          setSetting(pushKey, Date.now());
          const err = errors.find((e) => e.platformId === p.id);
          await sendPhoneNotify(
            `⚠️ ${p.name} 余额抓取失败`,
            `已连续 ${count} 次巡检失败，可能登录态过期或平台风控。\n错误：${err?.error || ''}\n请尽快重新登录：node scripts/wallet-login.mjs`
          );
          console.log(`[monitor] 已推送登录态过期提醒: ${p.name}`);
        }
      }
    } else {
      setSetting(countKey, 0);
    }
  }
}

// 单次巡检（平台按批并行刷新，最多 3 个同时抓，整体提速）
export async function runMonitorCycle() {
  const platforms = db.prepare('SELECT * FROM platforms WHERE active = 1').all();
  const results = { refreshed: [], orders: [], credited: [], errors: [] };

  const BATCH = 3;
  for (let i = 0; i < platforms.length; i += BATCH) {
    const slice = platforms.slice(i, i + BATCH);
    await Promise.all(slice.map(async (p) => {
      // 1. 刷新余额
      const r = await refreshPlatformBalance(p.id);
      if (!r.ok) {
        results.errors.push({ platformId: p.id, error: r.error });
        return;
      }
      results.refreshed.push({ platformId: p.id, balance: r.balance });

      // 2. 阈值判断，生成充值单
      const order = maybeCreateRechargeOrder(p.id);
      if (order) {
        results.orders.push(order);
        // 3. 通知
        await notifyOrder(order.orderId);
      }
    }));
  }

  // 4. 到账跟踪：已打款的单子尝试确认到账
  const paidOrders = db.prepare("SELECT id FROM recharge_orders WHERE status = 'paid'").all();
  for (const o of paidOrders) {
    const cr = await tryCreditOrder(o.id);
    if (cr.ok) results.credited.push(o.id);
  }

  // 5. 登录态过期自动提醒（连续失败 → 手机推送）
  await maybeNotifyFailures(platforms, results.errors);

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
