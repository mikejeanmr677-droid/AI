// 一次性登录脚本（storageState 方案，参照 E:\ai-wallet-monitor-portable\login.js）
// 弹出浏览器窗口，逐个平台等你登录；登录成功后自动把登录态(cookie+localStorage)
// 导出到 src/wallet-states/storage_<key>.json，之后定时巡检无头加载该文件即可。
// 用法：
//   node scripts/wallet-login.mjs            # 登录数据库里全部浏览器抓取型平台（空库则用预设）
//   node scripts/wallet-login.mjs bailian    # 只登录指定平台（tencent/mimo/kimi/bailian/minimax/volc）
//   node scripts/wallet-login.mjs --list     # 只列出需要登录的平台，不打开浏览器
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import db, { initSchema } from '../src/db/index.js';
import { parseScrapeRule, STORAGE_DIR, STORAGE_KEY_BY_NAME, BROWSER_ARGS, SAFE_KEYWORD_BY_KEY } from '../src/services/scraper_wallets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 平台定义（key → 名称/钱包页/提取规则）——仅作为数据库为空时的兜底预设
const PRESET_PLATFORMS = [
  { key: 'tencent',  name: '腾讯云TokenHub', url: 'https://console.cloud.tencent.com/expense',              rule: '{"keyword":"可用余额","max":10000000}' },
  { key: 'mimo',     name: '小米MiMo',       url: 'https://platform.xiaomimimo.com/console/balance',        rule: '{"keyword":"现金余额","max":10000000}' },
  { key: 'kimi',     name: '月之暗面Kimi',   url: 'https://platform.kimi.com/console/account',              rule: '{"keyword":"可用余额","max":10000000}' },
  { key: 'bailian',  name: '阿里云百炼',     url: 'https://billing-cost.console.aliyun.com',                rule: '{"keyword":"可用额度","max":10000000}' },
  { key: 'minimax',  name: 'MiniMax',        url: 'https://platform.minimax.cn/console/recharge-records',   rule: '{"keyword":"可用额度","max":10000000}' },
  { key: 'volc',     name: '火山引擎',       url: 'https://console.volcengine.com/finance/account-overview', rule: '{"keyword":"可用余额","max":10000000}' },
];

// 从数据库动态读取所有"浏览器抓取型"平台（新添加的 scrape 平台也会被覆盖到）
function targetsFromDb() {
  const rows = db.prepare(
    "SELECT name, provider, balance_api_url, balance_json_path FROM platforms WHERE balance_type='scrape' AND active = 1"
  ).all();
  return rows
    .filter((r) => r.balance_api_url)
    .map((r) => ({
      key: STORAGE_KEY_BY_NAME[r.name] || r.provider || r.name,
      name: r.name,
      url: r.balance_api_url,
      rule: r.balance_json_path || '',
    }));
}

const isLoginUrl = (u) => /login|passport|signin|cas\/|auth\/login/i.test(u || '');

// 等待页面满足：URL 不在登录页 + 页面文本包含余额关键字（连续两次确认）
// 如果用户手动关闭了登录窗口，立即放弃当前平台（不再傻等超时）
async function waitLoggedIn(page, keyword, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();
  let stable = 0;
  let closed = false;
  page.on('close', () => { closed = true; });
  while (Date.now() - start < timeoutMs) {
    if (closed) return false; // 窗口被用户关闭 → 放弃该平台
    try {
      const url = page.url();
      const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
      const ok = !isLoginUrl(url) && (!keyword || text.includes(keyword));
      // 诊断日志：每 10 秒打印一次当前 URL 和关键字命中情况，便于排查登录卡住
      const elapsed = Date.now() - start;
      if (elapsed % 10000 < 2000) {
        const sample = text.slice(0, 80).replace(/\s+/g, ' ');
        console.log(`  [等待登录 ${Math.floor(elapsed / 1000)}s] url=${url} 命中关键字=${ok} 文本=${sample}`);
      }
      if (ok) {
        stable += 1;
        if (stable >= 2) return true;
      } else {
        stable = 0;
      }
    } catch (e) { /* 页面跳转中或窗口已关闭 */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

(async () => {
  await initSchema(); // 确保数据库已加载（sql.js 惰性初始化）

  const args = process.argv.slice(2);
  const onlyKey = args.find((a) => !a.startsWith('--')) || null;

  // 需要登录的目标：数据库里的浏览器抓取型平台优先；空库时用预设兜底
  const dbTargets = targetsFromDb();
  const allTargets = dbTargets.length ? dbTargets : PRESET_PLATFORMS;
  const targets = onlyKey ? allTargets.filter((p) => p.key === onlyKey) : allTargets;
  if (onlyKey && targets.length === 0) {
    console.log(`未找到平台: ${onlyKey}。可用: ${allTargets.map((p) => p.key).join(', ')}`);
    process.exit(1);
  }

  if (args.includes('--list')) {
    console.log(`需要登录的浏览器抓取型平台（${targets.length} 个）${dbTargets.length ? '（来自数据库配置）' : '（预设兜底）'}：`);
    for (const p of targets) console.log(`  ${p.name}  (key=${p.key})\n    url=${p.url}`);
    process.exit(0);
  }

  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  console.log(`=== AI 钱包一次性登录${onlyKey ? `（仅 ${onlyKey}）` : ''} ===`);
  console.log(`本次登录 ${targets.length} 个平台${dbTargets.length ? '（读取数据库配置，新添加的平台也会包含）' : '（数据库无抓取平台，使用预设）'}。\n`);

  // 与抓取端使用同一组启动参数（禁用设备绑定会话），保证登录态可跨实例持久保存
  const browser = await chromium.launch({ headless: false, channel: 'chrome', args: BROWSER_ARGS });
  let closedAll = false; // 用户把所有窗口都关了 → 终止整个流程
  browser.on('disconnected', () => { closedAll = true; });
  try {
    for (const p of targets) {
      if (closedAll) {
        console.log('检测到浏览器窗口已全部关闭，结束登录流程。');
        break;
      }
      const storageFile = path.join(STORAGE_DIR, `storage_${p.key}.json`);
      const rule = parseScrapeRule(p.rule);
      // 登录检测用内置宽松关键字兜底：数据库规则可能被页面误写成带符号坏值（如"可用余额￥ "），
      // 内置宽松词（如"可用余额"）只要页面出现即判定已登录，避免干等超时
      const loginKeyword = SAFE_KEYWORD_BY_KEY[p.key] || rule.keyword;
      console.log(`[${p.name}] 打开 ${p.url}`);
      console.log('  请在浏览器窗口里登录（关闭窗口 = 放弃当前平台）。');
      let context, page;
      try {
        context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        page = await context.newPage();
        await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      } catch (e) {
        console.log(`  ✗ 浏览器已不可用（窗口被关闭），结束登录流程。`);
        break;
      }
      const ok = await waitLoggedIn(page, loginKeyword);
      if (ok) {
        await context.storageState({ path: storageFile });
        console.log(`  ✓ ${p.name} 登录成功，登录态已保存到 ${storageFile}`);
      } else {
        console.log(`  ✗ ${p.name} 未完成登录（窗口关闭或超时），跳过。`);
      }
      try { await page.close(); } catch {}
      try { await context.close(); } catch {}
    }
  } finally {
    try { await browser.close(); } catch {}
  }
  console.log('\n登录流程结束。现在可运行 node scripts/wallet-check.mjs 验证，或启动服务定时巡检。');
})();
