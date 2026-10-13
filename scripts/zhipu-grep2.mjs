// 用页面运行时拿到的 chunk 列表深挖财务接口
// ponytail: 临时验证脚本；问题定位后可删。
// 策略：app.js 里有 webpack chunk 映射；直接扫 app.js 里所有 chunk 文件名模式。
const html = await fetch('https://open.bigmodel.cn/finance-center/finance/overview').then(r => r.text());
const jsFiles = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
const appUrl = jsFiles.find(f => f.includes('app.'));
const code = await fetch(appUrl.startsWith('http') ? appUrl : 'https://open.bigmodel.cn' + appUrl).then(r => r.text());

// 找 finance 相关 chunk 名
const finChunks = [...new Set([...code.matchAll(/"([a-zA-Z0-9_\-]*(?:financ|pay|bill|asset|account|overview)[a-zA-Z0-9_\-]*)"/gi)].map(m => m[1]))];
console.log('finance chunk names:', JSON.stringify(finChunks.slice(0, 30)));

// 找 chunk URL 模板
const tmpl = code.match(/["'`]([^"'`]*\.js)["'`]/g);
const staticBase = (code.match(/["'](\/[a-zA-Z0-9_\-/]*static[^"']*?|\/\/[a-z0-9.\-/]*cdn[^"']*?)["']/i) || [])[1];
console.log('possible static base:', staticBase);

// 试几个常见的 chunk URL 拼法
const names = finChunks.filter(n => /financ|overview|pay|bill/i.test(n)).slice(0, 12);
for (const n of names) {
  for (const pat of [
    `https://open.bigmodel.cn/_next/static/chunks/${n}.js`,
    `https://open.bigmodel.cn/static/js/${n}.js`,
    `https://open.bigmodel.cn/js/${n}.js`,
    `https://open.bigmodel.cn/${n}.js`,
  ]) {
    try {
      const r = await fetch(pat);
      if (r.ok) {
        const t = await r.text();
        const hits = [...new Set([...t.matchAll(/["'`](\/[a-zA-Z0-9_\-/]*(?:[Bb]alance|[Ff]inance|[Ww]allet|[Rr]echarge|pct|asset|[Bb]ill)[a-zA-Z0-9_\-/]*)["'`]/g)].map(m => m[1]))];
        if (hits.length) { console.log('==>', pat, JSON.stringify(hits.slice(0, 25))); }
        break;
      }
    } catch { /* skip */ }
  }
}
console.log('done');
