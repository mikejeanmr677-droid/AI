// 手机推送：Server酱（微信）+ Bark（iPhone），可同时配置，哪个有 key 就发哪个
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let config = {};
try {
  config = JSON.parse(readFileSync(join(__dirname, '..', '..', 'config.json'), 'utf-8'));
} catch {}

const serverchanKey = config.notify?.serverchan || '';
const barkKey = config.notify?.bark || '';

// 发送手机推送（不抛异常，通知失败不影响巡检）
export async function sendPhoneNotify(title, body) {
  const results = {};
  if (serverchanKey) {
    try {
      const r = await fetch(`https://sctapi.ftqq.com/${serverchanKey}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(body)}`,
      });
      results.serverchan = r.ok ? 'ok' : `http ${r.status}`;
    } catch (err) {
      results.serverchan = 'error: ' + err.message;
    }
  }
  if (barkKey) {
    try {
      const r = await fetch(
        `https://api.day.app/${barkKey}/${encodeURIComponent(title)}?body=${encodeURIComponent(body)}&group=${encodeURIComponent('余额预警')}`,
        { method: 'POST' }
      );
      results.bark = r.ok ? 'ok' : `http ${r.status}`;
    } catch (err) {
      results.bark = 'error: ' + err.message;
    }
  }
  return results;
}

// 是否已配置任一手机通道
export function hasPhoneNotify() {
  return Boolean(serverchanKey || barkKey);
}
