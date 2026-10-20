// 一次性登录脚本（storageState 方案，参照 E:\ai-wallet-monitor-portable\login.js）
// 弹出浏览器窗口，逐个平台等你登录；登录成功后自动把登录态(cookie+localStorage)
// 导出到 src/wallet-states/storage_<key>.json，之后定时巡检无头加载该文件即可。
// 用法：
//   node scripts/wallet-login.mjs            # 登录全部 6 个平台
//   node scripts/wallet-login.mjs bailian    # 只登录指定平台（tencent/mimo/kimi/bailian/minimax/volc）
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScrapeRule, STORAGE_DIR } from '../src/services/scraper_wallets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 平台定义（key → 名称/钱包页/提取规则，与 setup-wallet-platforms.mjs 保持一致）
const PLATFORMS = [
  { key: 'tencent',  name: '腾讯云TokenHub', url: 'https://console.cloud.tencent.com/expense',              rule: '{"keyword":"可用余额","max":10000000}' },
  { key: 'mimo',     name: '小米MiMo',       url: 'https://platform.xiaomimimo.com/console/balance',        rule: '{"keyword":"现金余额","max":10000000}' },
  { key: 'kimi',     name: '月之暗面Kimi',   url: 'https://platform.kimi.com/console/account',              rule: '{"keyword":"可用余额\n￥ ","max":10000000}' },
  { key: 'bailian',  name: '阿里云百炼',     url: 'https://billing-cost.console.aliyun.com',                rule: '{"keyword":"可用额度","max":10000000}' },
  { key: 'minimax',  name: 'MiniMax',        url: 'https://platform.minimax.cn/console/recharge-records',   rule: '{"keyword":"可用额度","max":10000000}' },
  { key: 'volc',     name: '火山引擎',       url: 'https://console.volcengine.com/finance/account-overview', rule: '{"keyword":"可用余额","max":10000000}' },
];

const isLoginUrl = (u) => /login|passport|signin|cas\/|auth\/login/i.test(u || '');

// 等待页面满足：URL 不在登录页 + 页面文本包含余额关键字（连续两次确认）
async function waitLoggedIn(page, keyword, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();
  let stable = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const url = page.url();
      const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
      const ok = !isLoginUrl(url) && (!keyword || text.includes(keyword));
      if (ok) {
        stable += 1;
        if (stable >= 2) return true;
      } else {
        stable = 0;
      }
    } catch (e) { /* 页面跳转中 */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

(async () => {
  const onlyKey = process.argv[2];
  const targets = onlyKey ? PLATFORMS.filter((p) => p.key === onlyKey) : PLATFORMS;
  if (onlyKey && targets.length === 0) {
    console.log(`未找到平台: ${onlyKey}。可用: ${PLATFORMS.map((p) => p.key).join(', ')}`);
    process.exit(1);
  }
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  console.log(`=== AI 钱包一次性登录${onlyKey ? `（仅 ${onlyKey}）` : ''} ===`);
  console.log('将弹出浏览器窗口，请在窗口里登录，每个平台最多等 10 分钟。\n');

  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    for (const p of targets) {
      const storageFile = path.join(STORAGE_DIR, `storage_${p.key}.json`);
      const rule = parseScrapeRule(p.rule);
      console.log(`[${p.name}] 打开 ${p.url}`);
      console.log('  请在浏览器窗口里登录，登录成功后脚本会自动检测并继续。');
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      const ok = await waitLoggedIn(page, rule.keyword);
      if (ok) {
        await context.storageState({ path: storageFile });
        console.log(`  ✓ ${p.name} 登录成功，登录态已保存到 ${storageFile}`);
      } else {
        console.log(`  ✗ ${p.name} 未检测到登录成功（超时），跳过。`);
      }
      try { await page.close(); } catch {}
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log('\n登录流程结束。现在可运行 node scripts/wallet-check.mjs 验证，或启动服务定时巡检。');
})();
