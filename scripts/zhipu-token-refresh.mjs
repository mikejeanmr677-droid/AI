// 智谱 Token 自动续期脚本（最终版）
// 用法：
//   1. 更新 token：node scripts/zhipu-token-refresh.mjs --token "eyJ..."  （验证并写入平台+刷新余额）
//   2. 自检：node scripts/zhipu-token-refresh.mjs（或 --token-file config\zhipu-token.txt）
//   注意：账密直连登录被智谱验证码墙挡住（loginType=password 返回「请完成安全验证」，需数美滑块），
//   无法全自动换 token；token 过期时需人工从浏览器复制一次。
//   3. 定时任务示例（每天 9 点用 token 方式自检）：
//      schtasks /create /tn "zhipu-token" /tr "node D:\XKZOOM\xkzoom-apiManager\scripts\zhipu-token-refresh.mjs --token-file D:\XKZOOM\xkzoom-apiManager\config\zhipu-token.txt" /sc daily /st 09:00
// ponytail: 已知天花板——账密直连登录被智谱服务端禁用（cusLoginGranter null，疑似必须数美验证码/设备指纹），
//           因此无法全自动无头换 token；token 触发 401 后需人工从浏览器复制一次新 token。
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfgDir = join(__dirname, '..', 'config');
mkdirSync(cfgDir, { recursive: true });
const tokenFile = join(cfgDir, 'zhipu-token.txt');

// 解析参数
const args = process.argv.slice(2);
const getArg = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

const BALANCE_URL = 'https://open.bigmodel.cn/api/biz/account/query-customer-account-report';

async function checkToken(token) {
  const r = await fetch(BALANCE_URL, {
    headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'Mozilla/5.0' },
  });
  const body = await r.json().catch(() => ({}));
  // 1001/401 = token 失效；code 200 = 有效
  if (body.code === 200 && body.data) {
    return { ok: true, balance: body.data.balance ?? body.data.availableBalance };
  }
  return { ok: false, code: body.code, msg: body.msg };
}

async function writePlatform(token) {
  // 平台 id=4（智谱AI）—— 写入 api_key_secret 并刷新余额
  const put = await fetch('http://localhost:3000/api/platforms/4', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key_secret: token }),
  });
  if (!put.ok) throw new Error('更新平台失败: ' + put.status);
  const rf = await fetch('http://localhost:3000/api/platforms/4/refresh', { method: 'POST' });
  const res = await rf.json();
  writeFileSync(tokenFile, token);
  return res;
}

const mode = args[0];
if (mode === '--token' || getArg('--token')) {
  const token = mode === '--token' ? args[1] : getArg('--token');
  const c = await checkToken(token);
  if (!c.ok) {
    console.error('Token 无效:', c);
    process.exit(1);
  }
  console.log('Token 有效，余额:', c.balance);
  const res = await writePlatform(token);
  console.log('已写入平台并刷新:', JSON.stringify(res));
} else if (getArg('--token-file')) {
  const f = getArg('--token-file');
  if (!existsSync(f)) { console.error('token 文件不存在:', f); process.exit(1); }
  const token = readFileSync(f, 'utf-8').trim();
  const c = await checkToken(token);
  if (!c.ok) {
    console.error('Token 已失效（code=' + c.code + '）。请重新登录智谱控制台，从 DevTools 复制新 token 后运行:');
    console.error('  node scripts/zhipu-token-refresh.mjs --token "新token"');
    process.exit(2);
  }
  console.log('Token 仍有效，余额:', c.balance);
} else {
  console.log('用法:');
  console.log('  自检:  node scripts/zhipu-token-refresh.mjs --token-file config\\zhipu-token.txt');
  console.log('  更新:  node scripts/zhipu-token-refresh.mjs --token "eyJ..."');
  // 默认执行自检
  if (existsSync(tokenFile)) {
    const token = readFileSync(tokenFile, 'utf-8').trim();
    const c = await checkToken(token);
    console.log(c.ok ? '当前 token 有效，余额: ' + c.balance : 'token 已失效: ' + JSON.stringify(c));
  }
}
