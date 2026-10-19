const fs = require('fs');
const path = 'src/services/balance.js';
let s = fs.readFileSync(path, 'utf8');

// 用正则匹配整个zhipu块（从注释到scrape之前）
const re = /  \/\/ 智谱AI：余额查询接口[\s\S]*?return \{ balance, raw: data, unit: '元' \};\r?\n  \},\r?\n/;

if (!re.test(s)) {
  console.error('ERROR: zhipu block not matched');
  process.exit(1);
}

const newBlock = [
  "  // 智谱AI：余额查询接口（只需 API Key）",
  "  zhipu: async (platform) => {",
  "    if (!platform.api_key) throw new Error('智谱AI需要配置API Key');",
  "    // 调用智谱AI账户余额查询API，只需 API Key 鉴权",
  "    const url = platform.balance_api_url || 'https://open.bigmodel.cn/api/paas/v4/billing/usage';",
  "    const res = await fetch(url, {",
  "      headers: {",
  "        'Authorization': `Bearer ${platform.api_key}`,",
  "        'Content-Type': 'application/json',",
  "      },",
  "    });",
  "    if (!res.ok) throw new Error(`智谱AI余额查询失败: HTTP ${res.status}`);",
  "    const data = await res.json();",
  "    // 兼容多种返回字段：remaining_quota / balance / data.balance",
  "    const balance = getByPath(data, platform.balance_json_path || 'remaining_quota')",
  "      ?? getByPath(data, 'balance')",
  "      ?? getByPath(data, 'data.balance');",
  "    if (balance == null) throw new Error('未在返回中找到余额字段');",
  "    return { balance, raw: data, unit: '元' };",
  "  },",
  ""
].join('\r\n');

s = s.replace(re, newBlock);
fs.writeFileSync(path, s, 'utf8');
console.log('OK: zhipu block replaced');
