// 抓取验证脚本：从数据库读取所有 scrape 平台配置，无头浏览器逐个抓取余额并打印
// 用法：node scripts/wallet-check.mjs
import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeWalletsBatch, parseScrapeRule, storageFileFor } from '../src/services/scraper_wallets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbFile = join(__dirname, '..', 'src', 'data', 'llm-manager.db');

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(dbFile));

const res = db.exec("SELECT name, balance_api_url, balance_json_path FROM platforms WHERE balance_type='scrape' AND active=1");
if (!res.length) {
  console.log('数据库中没有 scrape 类型的平台，请先运行 node scripts/setup-wallet-platforms.mjs');
  process.exit(1);
}

const tasks = res[0].values.map((r) => ({
  url: r[1],
  rule: parseScrapeRule(r[2]),
  debugLabel: r[0],
  storageFile: storageFileFor(r[0]),
}));

console.log('开始无头抓取 ' + tasks.length + ' 个平台（约需 1-2 分钟）...\n');
const results = await scrapeWalletsBatch(tasks);
let okCount = 0;
for (const r of results) {
  if (r.ok) {
    okCount++;
    console.log('OK   ' + r.label + ' : ' + r.balance);
  } else {
    console.log('FAIL ' + r.label + ' : ' + r.error);
  }
}
console.log('\n成功 ' + okCount + '/' + results.length);
