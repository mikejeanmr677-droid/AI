// OpenAI costs 汇总探测（admin key）
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const key = process.env.OAI_KEY;
const proxy = { host: '127.0.0.1', port: 15556 };

function fetchViaProxy(urlStr, headers = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlStr);
    const req = http.request({ host: proxy.host, port: proxy.port, method: 'CONNECT', path: `${target.hostname}:443` });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT failed: ${res.statusCode}`));
      const r = https.request({
        host: target.hostname, path: target.pathname + target.search, method: 'GET',
        headers: { ...headers, Host: target.hostname }, socket, agent: false, timeout,
      }, (resp) => {
        let body = '';
        resp.on('data', (d) => (body += d));
        resp.on('end', () => resolve({ status: resp.statusCode, body }));
      });
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
      r.on('error', reject);
      r.end();
    });
    req.on('error', reject);
    req.end();
  });
}

// 本月起始（UTC）
const now = new Date();
const start = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);

let url = `https://api.openai.com/v1/organization/costs?start_time=${start}&limit=180`;
let total = 0;
let pages = 0;
while (url && pages < 10) {
  const { status, body } = await fetchViaProxy(url, { Authorization: `Bearer ${key}` });
  if (status !== 200) { console.log('ERR', status, body.slice(0, 300)); break; }
  const data = JSON.parse(body);
  for (const bucket of data.data) {
    for (const r of bucket.results) total += r.amount.amount ?? 0;
  }
  url = data.has_more && data.next_page ? `https://api.openai.com/v1/organization/costs?start_time=${start}&limit=180&next_page=${encodeURIComponent(data.next_page)}` : null;
  pages++;
}
console.log(`本月消耗合计: ${total.toFixed(4)} USD (pages=${pages})`);
