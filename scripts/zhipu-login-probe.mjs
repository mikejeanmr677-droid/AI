// 从智谱前端主包+路由chunk里挖登录API（真实请求路径，可能带域名）
// ponytail: 一次性探测脚本，定位后可删。
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';

mkdirSync('scripts/.tmp', { recursive: true });
const base = 'https://static.bigmodel.cn/wd-paas-front/js/';
const mains = ['app.0fe2caa0.js', 'chunk-vue.318cda1e.js', 'chunk-libs.ea9abb99.js', 'chunk-elementUI.61fe3483.js'];
for (const s of mains) {
  try {
    const js = await (await fetch(base + s)).text();
    writeFileSync('scripts/.tmp/' + s, js);
    console.log('got', s, js.length);
  } catch (e) { console.log('skip', s, e.message); }
}

// 挖登录语义的 URL 字符串（不限 /api 前缀）
const found = new Set();
for (const f of readdirSync('scripts/.tmp')) {
  const js = readFileSync('scripts/.tmp/' + f, 'utf-8');
  for (const m of js.matchAll(/["'`](\/?[a-zA-Z0-9_/.-]{3,80}(?:login|Login|sso|SSO|token|Token|captcha|Captcha)[a-zA-Z0-9_/.-]{0,40})["'`]/g)) {
    found.add(m[1]);
  }
}
console.log([...found].filter(x => !x.includes('node_modules')).slice(0, 80).join('\n'));
