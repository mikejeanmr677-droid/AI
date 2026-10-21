// 余额查询模块：支持不同平台的余额获取方式
// balance_type: 'api'（官方接口）/ 'scrape'（抓取）/ 'manual'（手动录入）

import db from '../db/index.js';
import { createHash, createHmac } from 'node:crypto';
import { scrapeMiniMaxBalance } from './scraper_minimax.mjs';
import { scrapeWalletBalance, parseScrapeRule, storageFileFor, enrichRuleWithBuiltin } from './scraper_wallets.mjs';

// 火山引擎 OpenAPI 签名（HMAC-SHA256，类似 AWS SigV4）
function sha256hex(s) { return createHash('sha256').update(s).digest('hex'); }
function hmac(key, data) { return createHmac('sha256', key).update(data).digest(); }
function volcSign({ method, host, path, query, payload, ak, sk, date }) {
  // 规范 URI：多数接口为 '/'
  const canonicalUri = path || '/';
  // 规范化 query：按 key 字典序排序
  const sortedKeys = Object.keys(query).sort();
  const canonicalQuery = sortedKeys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  // 头部（参与签名的只有 host 和 x-date）
  const headers = {
    'host': host,
    'x-date': date,
  };
  const canonicalHeaders = Object.keys(headers).sort()
    .map((k) => `${k}:${headers[k].trim()}\n`).join('');
  const signedHeaders = Object.keys(headers).sort().join(';');
  const payloadHash = sha256hex(payload || '');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const dateStr = date.slice(0, 8); // YYYYMMDD
  const region = 'cn-beijing';
  const service = 'billing';
  const credentialScope = `${dateStr}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', date, credentialScope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac(sk, dateStr);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return {
    canonicalQuery,
    authHeader: `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// 腾讯云 TC3 签名（HMAC-SHA256）
function tencentSign({ host, service, action, payload, secretId, secretKey, timestamp, date }) {
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const hashedPayload = sha256hex(payload);
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const kDate = createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const kService = createHmac('sha256', kDate).update(service).digest();
  const kSigning = createHmac('sha256', kService).update('tc3_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// 阿里云 RPC 签名（HMAC-SHA1，BssOpenAPI QueryAccountBalance）
function aliyunSign(params, sk) {
  const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const qs = Object.keys(params).sort().map((k) => `${pct(k)}=${pct(params[k])}`).join('&');
  const strToSign = 'GET&' + pct('/') + '&' + pct(qs);
  return { canonicalQuery: qs, signature: createHmac('sha1', sk + '&').update(strToSign).digest('base64') };
}

// 通过 JSON path 从返回体里取值，如 "total_available"、"result.balance"、"balance_infos[0].total_balance"
function getByPath(obj, path) {
  if (!path) return null;
  // 支持点号分隔和数组下标，如 a.b[0].c
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  return tokens.reduce((acc, key) => {
    if (acc == null) return null;
    return acc[key];
  }, obj);
}

// 内置平台余额查询器
const providers = {
  // OpenAI: GET https://api.openai.com/dashboard/billing/credit_grants
  openai: async (platform) => {
    const url = platform.balance_api_url || 'https://api.openai.com/dashboard/billing/credit_grants';
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${platform.api_key}` },
    });
    if (!res.ok) throw new Error(`OpenAI 余额查询失败: HTTP ${res.status}`);
    const data = await res.json();
    // total_available = total_granted - total_used
    const total = getByPath(data, platform.balance_json_path || 'total_granted');
    const used = getByPath(data, 'total_used');
    return { balance: total - used, raw: data };
  },

  // OpenAI：admin key + /v1/organization/costs 算本月消耗，余额 = 预付额(platform.balance_json_path 存预付总额，默认 100) - 本月消耗
  // 需要出境代理时，设置环境变量 HTTPS_PROXY 即可（Node 原生 fetch 在 Node24 走 EnvHttpProxyAgent 需显式开启；这里用 undici-free 方案：仅在 HTTPS_PROXY 存在时提示）
  openai: async (platform) => {
    const key = platform.api_key;
    if (!key) throw new Error('OpenAI 需要配置 Admin Key');
    const prepayRaw = parseFloat(platform.balance_json_path);
    const prepay = Number.isFinite(prepayRaw) ? prepayRaw : 0; // 预付总额，可在 balance_json_path 字段填数字；未填按 0
    // OpenAI 需出境代理：启动服务时设置 NODE_USE_ENV_PROXY=1 + HTTPS_PROXY 环境变量即可（Node 24 原生支持）
    const now = new Date();
    const start = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
    let url = `https://api.openai.com/v1/organization/costs?start_time=${start}&limit=180`;
    let used = 0;
    let pages = 0;
    while (url && pages < 10) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      const text = await res.text();
      if (!res.ok) throw new Error(`OpenAI costs 查询失败: HTTP ${res.status} ${text.slice(0, 150)}`);
      const data = JSON.parse(text);
      for (const bucket of data.data) for (const r of bucket.results) used += r.amount.amount ?? 0;
      url = data.has_more && data.next_page ? `https://api.openai.com/v1/organization/costs?start_time=${start}&limit=180&next_page=${encodeURIComponent(data.next_page)}` : null;
      pages++;
    }
    const balance = Math.max(0, prepay - used);
    return { balance: parseFloat(balance.toFixed(2)), raw: { prepay, used } };
  },

  // 通用：GET + JSON path
  generic: async (platform) => {
    if (!platform.balance_api_url) {
      throw new Error('该平台未配置余额查询地址');
    }
    const headers = {};
    if (platform.api_key) headers.Authorization = `Bearer ${platform.api_key}`;
    const res = await fetch(platform.balance_api_url, { headers });
    if (!res.ok) throw new Error(`余额查询失败: HTTP ${res.status}`);
    const data = await res.json();
    const balance = getByPath(data, platform.balance_json_path);
    if (balance == null) throw new Error('未在返回中找到余额字段，请检查 balance_json_path');
    return { balance, raw: data };
  },

  // 月之暗面（Kimi / Moonshot）：GET /v1/users/me/balance
  moonshot: async (platform) => {
    if (!platform.api_key) throw new Error('月之暗面需要配置 API Key');
    const url = platform.balance_api_url || 'https://api.moonshot.cn/v1/users/me/balance';
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${platform.api_key}` },
    });
    if (!res.ok) throw new Error(`月之暗面余额查询失败: HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 0 && data.code !== undefined) {
      throw new Error(`月之暗面余额查询失败: ${data?.error?.message || data?.scode || JSON.stringify(data).slice(0, 200)}`);
    }
    const balance = getByPath(data, 'data.available_balance');
    if (balance == null) throw new Error('未在返回中找到余额字段');
    return { balance, raw: data };
  },

  // 火山引擎：费用中心 QueryBalanceAcct，HMAC-SHA256 签名
  volcengine: async (platform) => {
    const ak = platform.api_key;
    const sk = platform.api_key_secret;
    if (!ak || !sk) throw new Error('火山引擎需要同时配置 AK（Access Key ID）和 SK（Secret Access Key）');
    const host = 'billing.volcengineapi.com';
    const method = 'GET';
    const query = { Action: 'QueryBalanceAcct', Version: '2022-01-01' };
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const xDate = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    const { canonicalQuery, authHeader } = volcSign({
      method, host, path: '/', query, payload: '', ak, sk, date: xDate,
    });
    const url = `https://${host}/?${canonicalQuery}`;
    const res = await fetch(url, {
      headers: {
        'Host': host,
        'X-Date': xDate,
        'Authorization': authHeader,
      },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) {
      const msg = data?.ResponseMetadata?.Error?.Message || data?.error || `HTTP ${res.status}`;
      throw new Error(`火山引擎余额查询失败: ${msg}`);
    }
    // 返回结构：Result.AvailableBalance 为可用余额
    const result = data?.Result || data?.result || {};
    const balance = result.AvailableBalance ?? result.AvailableBalance;
    if (balance == null) throw new Error(`火山引擎未返回可用余额: ${text.slice(0, 200)}`);
    return { balance: parseFloat(balance), raw: data };
  },

  // 阿里云（百炼/DashScope）：BssOpenAPI QueryAccountBalance，HMAC-SHA1 签名
  // api_key 存 AccessKey ID，api_key_secret 存 AccessKey Secret
  dashscope: async (platform) => {
    const ak = platform.api_key;
    const sk = platform.api_key_secret;
    if (!ak || !sk) throw new Error('阿里云需要同时配置 AccessKey ID 和 AccessKey Secret');
    const params = {
      Action: 'QueryAccountBalance',
      AccessKeyId: ak,
      Format: 'JSON',
      RegionId: 'cn-hangzhou',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: crypto.randomUUID(),
      SignatureVersion: '1.0',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2017-12-14',
    };
    const { canonicalQuery, signature } = aliyunSign(params, sk);
    const url = `https://business.aliyuncs.com/?${canonicalQuery}&Signature=${encodeURIComponent(signature)}`;
    const res = await fetch(url);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok || data?.Code !== '200') {
      throw new Error(`阿里云余额查询失败: ${data?.Message || `HTTP ${res.status}`}`);
    }
    const balance = data?.Data?.AvailableAmount;
    if (balance == null) throw new Error(`阿里云未返回可用余额: ${text.slice(0, 200)}`);
    return { balance: parseFloat(balance), raw: data };
  },

  // 腾讯云（混元）：费用中心 DescribeAccountBalance，TC3 签名
  // api_key 存 SecretId，api_key_secret 存 SecretKey；余额单位为分，转成元
  tencent: async (platform) => {
    const secretId = platform.api_key;
    const secretKey = platform.api_key_secret;
    if (!secretId || !secretKey) throw new Error('腾讯云需要同时配置 SecretId 和 SecretKey');
    const host = 'billing.tencentcloudapi.com';
    const service = 'billing';
    const action = 'DescribeAccountBalance';
    const payload = '{}';
    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}`;
    const auth = tencentSign({ host, service, action, payload, secretId, secretKey, timestamp, date });
    const res = await fetch(`https://${host}/`, {
      method: 'POST',
      headers: {
        'Host': host,
        'Content-Type': 'application/json; charset=utf-8',
        'X-TC-Action': action,
        'X-TC-Version': '2018-07-09',
        'X-TC-Timestamp': String(timestamp),
        'Authorization': auth,
      },
      body: payload,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (data?.Response?.Error) {
      throw new Error(`腾讯云余额查询失败: ${data.Response.Error.Code} ${data.Response.Error.Message}`);
    }
    const cents = data?.Response?.Balance ?? data?.Response?.RealBalance;
    if (cents == null) throw new Error(`腾讯云未返回余额: ${text.slice(0, 200)}`);
    return { balance: cents / 100, raw: data };
  },

  // 智谱（BigModel）：控制台内部接口（非官方公开 API，随时可能失效）
  // api_key 存模型 API Key；api_key_secret 存控制台登录 Token（JWT，过期后需重新从浏览器复制）
  // 余额接口：GET /api/biz/account/query-customer-account-report，取 data.balance
  zhipu: async (platform) => {
    const token = platform.api_key_secret;
    if (!token) throw new Error('智谱需要配置控制台 Token（登录后从浏览器 DevTools 的 Authorization 头复制）');
    const url = platform.balance_api_url || 'https://open.bigmodel.cn/api/biz/account/query-customer-account-report';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (res.status === 401 || data?.code === 1001 || data?.code === 401) {
      throw new Error('智谱控制台 Token 已失效，请重新登录 open.bigmodel.cn 并更新 Token（编辑该平台的 Secret Key 字段，或运行 node scripts/zhipu-token-refresh.mjs --token "新token"）');
    }
    if (!res.ok || data?.code !== 200) {
      throw new Error(`智谱余额查询失败: ${data?.msg || data?.code || `HTTP ${res.status}`}（若为过期/无效提示，请更新控制台 Token）`);
    }
    const balance = data?.data?.balance ?? data?.data?.availableBalance;
    if (balance == null) throw new Error(`智谱未返回余额: ${text.slice(0, 200)}`);
    return { balance: parseFloat(balance), raw: data };
  },

  // MiniMax：余额查询接口
  minimax: async (platform) => {
    if (!platform.api_key) throw new Error('MiniMax需要配置API Key');
    // 区分Token Plan Key和普通开放平台API Key
    if (platform.api_key.startsWith('sk-cp-')) {
      // Token Plan Key：使用官方API接口查询
      const url = platform.balance_api_url || 'https://www.minimaxi.com/v1/token_plan/remains';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${platform.api_key}` },
      });
      if (!res.ok) throw new Error(`MiniMax余额查询失败: HTTP ${res.status}`);
      const data = await res.json();
      const balance = getByPath(data, platform.balance_json_path || 'current_interval_usage_count');
      if (balance == null) throw new Error('未在返回中找到余额字段');
      return { balance, raw: data, unit: '次请求（5小时滚动）' };
    } else {
      // 普通开放平台API Key：使用浏览器自动抓取余额
      console.log('[MiniMax] 正在使用浏览器自动抓取余额...');
      const balance = await scrapeMiniMaxBalance();
      return { balance, raw: {}, unit: '元' };
    }
  },

  // 小米多模态（MiMo）：余额查询接口
  mimo: async (platform) => {
    if (!platform.api_key) throw new Error('MiMo需要配置API Key');
    const url = platform.balance_api_url || 'https://mimo.mi.com/api/v1/balance';
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${platform.api_key}` },
    });
    if (!res.ok) throw new Error(`MiMo余额查询失败: HTTP ${res.status}`);
    const data = await res.json();
    const balance = getByPath(data, platform.balance_json_path || 'data.balance');
    if (balance == null) throw new Error('未在返回中找到余额字段');
    return { balance, raw: data };
  },

  // 智谱AI：余额查询接口（只需 API Key）
  zhipu: async (platform) => {
    if (!platform.api_key) throw new Error('智谱AI需要配置API Key');
    // 调用智谱AI账户余额查询API，只需 API Key 鉴权
    const url = platform.balance_api_url || 'https://open.bigmodel.cn/api/usage';
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${platform.api_key}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`智谱AI余额查询失败: HTTP ${res.status}`);
    const data = await res.json();
    // 调试：打印原始返回
    console.log('智谱API返回:', JSON.stringify(data, null, 2));
    // 兼容多种返回字段：remaining / remaining_quota / balance / data.balance / data / 其他结构
    const balance = getByPath(data, platform.balance_json_path || 'remaining')
      ?? getByPath(data, 'remaining_quota')
      ?? getByPath(data, 'balance')
      ?? getByPath(data, 'data.balance')
      ?? getByPath(data, 'data')
      ?? (typeof data === 'object' && data ? Object.values(data)[0] : null);
    if (balance == null) throw new Error('未在返回中找到余额字段');
    return { balance, raw: data, unit: '元' };
  },

  // 小米MiMo：余额查询接口，支持api-key header和Authorization Bearer两种方式
  mimo: async (platform) => {
    if (!platform.api_key) throw new Error('小米MiMo需要配置API Key');
    // 尝试几个可能的余额查询URL
    const urls = [
      platform.balance_api_url || 'https://api.xiaomimimo.com/v1/balance',
      'https://api.xiaomimimo.com/v1/quota',
      'https://api.xiaomimimo.com/v1/user/balance',
      'https://mimo.mi.com/api/v1/balance',
    ];
    // 先试api-key header，再试Authorization Bearer
    const headersOptions = [
      { 'api-key': platform.api_key, 'Content-Type': 'application/json' },
      { 'Authorization': `Bearer ${platform.api_key}`, 'Content-Type': 'application/json' },
    ];
    // 遍历所有组合
    for (const url of urls) {
      for (const headers of headersOptions) {
        try {
          const res = await fetch(url, { headers });
          if (!res.ok) continue; // 这个组合不行，继续试下一个
          const data = await res.json();
          console.log('小米MiMo API返回:', JSON.stringify(data, null, 2));
          // 先尝试用户指定的路径，再尝试常见路径
          const balance = getByPath(data, platform.balance_json_path || 'data.balance')
            ?? getByPath(data, 'balance')
            ?? getByPath(data, 'remaining')
            ?? getByPath(data, 'quota')
            ?? getByPath(data, 'data.remaining')
            ?? getByPath(data, 'data.quota');
          if (balance != null) {
            return { balance, raw: data, unit: '元' };
          }
        } catch (e) {
          // 继续试下一个组合
        }
      }
    }
    throw new Error('小米MiMo余额查询失败，所有URL和认证方式都尝试过了');
  },

  scrape: async (platform) => {
    // 浏览器抓取：打开钱包页面（balance_api_url），按 balance_json_path 规则提取余额
    // 配置示例：balance_api_url=https://platform.minimax.cn/console/account-wallet
    //          balance_json_path={"keyword":"可用额度","max":10000000}
    if (!platform.balance_api_url) {
      throw new Error('scrape 模式需要配置钱包页面地址（balance_api_url）');
    }
    // 先套用内置精确正则（未显式配置 regex 时自动补全，抓取更稳定）
    const rule = enrichRuleWithBuiltin(parseScrapeRule(platform.balance_json_path), platform.name, platform.provider);
    const balance = await scrapeWalletBalance({
      url: platform.balance_api_url,
      rule,
      debugLabel: platform.name,
      storageFile: storageFileFor(platform.name, platform.provider),
    });
    return { balance, raw: {}, unit: platform.currency || '元', scraped: true };
  },

  manual: async (platform) => {
    // 手动模式：取最近一次手动录入的余额
    const row = db.prepare(
      'SELECT balance, currency FROM balance_history WHERE platform_id = ? ORDER BY id DESC LIMIT 1'
    ).get(platform.id);
    return { balance: row ? row.balance : null, raw: null, manual: true };
  },
};

export async function fetchBalance(platform) {
  // balance_type=scrape/manual 时以查询方式为准（浏览器抓取/手动录入），
  // 其余情况优先按 provider 匹配专用查询器，再兑底到 generic
  const type = platform.balance_type || 'api';
  const provider = platform.provider;
  const fetcher =
    (type === 'scrape' || type === 'manual')
      ? providers[type]
      : (provider && providers[provider]) ||
        providers[type] ||
        providers.generic;
  const result = await fetcher(platform);
  return result;
}

export async function refreshPlatformBalance(platformId) {
  console.log(`[refresh] 开始刷新平台 id=${platformId}...`);
  const platform = db.prepare('SELECT * FROM platforms WHERE id = ?').get(platformId);
  if (!platform) throw new Error('平台不存在');
  console.log(`[refresh] 平台信息: name=${platform.name}, provider=${platform.provider}, balance_type=${platform.balance_type}`);
  if (!platform.active) return null;

  try {
    const { balance, raw } = await fetchBalance(platform);
    console.log(`[refresh] 获取余额成功: balance=${balance}`);
    if (balance != null) {
      db.prepare(
        'INSERT INTO balance_history (platform_id, balance, currency) VALUES (?, ?, ?)'
      ).run(platformId, balance, platform.currency);
      console.log(`[refresh] 余额已保存到历史记录`);
    }
    // 刷新成功，清空上次错误标记
    db.prepare('UPDATE platforms SET latest_error = NULL WHERE id = ?').run(platformId);
    return { ok: true, balance, platformId };
  } catch (err) {
    console.error(`[refresh] 刷新失败:`, err);
    // 记录错误，前端标"抓取失败"，连续失败会触发登录态过期提醒
    db.prepare('UPDATE platforms SET latest_error = ? WHERE id = ?').run(String(err.message).slice(0, 300), platformId);
    return { ok: false, error: err.message, platformId };
  }
}
