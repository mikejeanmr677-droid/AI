// 拉所有 ./xxx.js 模块文件，扫余额接口
// ponytail: 临时验证脚本；问题定位后可删。
const html = await fetch('https://open.bigmodel.cn/finance-center/finance/overview').then(r => r.text());
const jsFiles = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
const appUrl = jsFiles.find(f => f.includes('app.'));
const appAbs = appUrl.startsWith('http') ? appUrl : 'https://open.bigmodel.cn' + appUrl;
const base = appAbs.replace(/[^/]*$/, ''); // 目录前缀
const code = await fetch(appAbs).then(r => r.text());
const modules = [...new Set([...code.matchAll(/"(\.\/[a-zA-Z0-9_\-]+\.js)"/g)].map(m => m[1]))];
console.log('modules:', modules.length);

const RE = /["'`](\/[a-zA-Z0-9_\-/]*(?:[Bb]alance|[Ff]inance|[Ww]allet|[Rr]echarge|pct|asset|[Bb]ill|[Aa]ccount)[a-zA-Z0-9_\-/]*)["'`]/g;
const found = new Map();
await Promise.all(modules.map(async (m) => {
  try {
    const t = await fetch(base + m.slice(2)).then(r => r.text());
    const hits = [...new Set([...t.matchAll(RE)].map(x => x[1]))];
    if (hits.length) found.set(m, hits);
  } catch { /* skip */ }
}));
for (const [m, hits] of [...found.entries()].sort()) {
  console.log('==>', m, JSON.stringify(hits.slice(0, 30)));
}
console.log('done');
