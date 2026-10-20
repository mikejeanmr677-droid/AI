// 一次性初始化：把 6 个平台（腾讯云TokenHub、小米MiMo、Kimi、阿里云百炼、MiniMax、火山引擎）
// 配置为浏览器抓取（balance_type=scrape），钱包页面地址与提取规则写入数据库
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbFile = join(__dirname, '..', 'src', 'data', 'llm-manager.db');

const WALLETS = [
  { name: '腾讯云TokenHub', provider: 'tencent',    url: 'https://console.cloud.tencent.com/expense',                  rule: '{"keyword":"可用余额","max":10000000}' },
  { name: '小米MiMo',        provider: 'mimo',      url: 'https://platform.xiaomimimo.com/console/balance',           rule: '{"keyword":"现金余额","max":10000000}' },
  { name: '月之暗面Kimi',    provider: 'moonshot',  url: 'https://platform.kimi.com/console/account',                 rule: '{"keyword":"可用余额\n￥ ","max":10000000}' },
  { name: '阿里云百炼',      provider: 'dashscope', url: 'https://billing-cost.console.aliyun.com',                   rule: '{"keyword":"可用额度","max":10000000}' },
  { name: 'MiniMax',         provider: 'minimax',   url: 'https://platform.minimax.cn/console/recharge-records',    rule: '{"keyword":"可用额度","max":10000000}' },
  { name: '火山引擎',        provider: 'volcengine', url: 'https://console.volcengine.com/finance/account-overview',  rule: '{"keyword":"可用余额","max":10000000}' },
];

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(dbFile));

const existingRes = db.exec('SELECT name FROM platforms');
const existingNames = existingRes.length ? existingRes[0].values.map((r) => r[0]) : [];

for (const w of WALLETS) {
  if (existingNames.includes(w.name)) {
    db.run(
      `UPDATE platforms SET provider=?, balance_type='scrape', balance_api_url=?, balance_json_path=?, currency='CNY', active=1 WHERE name=?`,
      [w.provider, w.url, w.rule, w.name]
    );
    console.log('更新为 scrape:', w.name);
  } else {
    db.run(
      `INSERT INTO platforms (name, provider, balance_type, balance_api_url, balance_json_path, currency, threshold, recharge_amount, active)
       VALUES (?, ?, 'scrape', ?, ?, 'CNY', 200, 500, 1)`,
      [w.name, w.provider, w.url, w.rule]
    );
    console.log('新增平台:', w.name);
  }
}

const data = db.export();
writeFileSync(dbFile, Buffer.from(data));
console.log('数据库已更新:', dbFile);
