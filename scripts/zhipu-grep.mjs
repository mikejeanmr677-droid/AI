// 从智谱财务页 JS 里找内部接口路径
// ponytail: 临时验证脚本；问题定位后可删。
import { execSync } from 'node:child_process';

// 先从页面 HTML 拿到 JS 文件列表
const html = await fetch('https://open.bigmodel.cn/finance-center/finance/overview').then(r => r.text());
const jsFiles = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
console.log('js files:', jsFiles.length);

for (const f of jsFiles.slice(0, 80)) {
  const url = f.startsWith('http') ? f : 'https://open.bigmodel.cn' + f;
  try {
    const code = await fetch(url).then(r => r.text());
    // 找 url/接口定义特征
    const hits = [...code.matchAll(/["'`](\/[a-zA-Z0-9_\-/]*(?:[Bb]alance|[Bb]ill|[Pp]ay|[Ff]inance|[Ww]allet|[Rr]echarge|pct|asset)[a-zA-Z0-9_\-/]*)["'`]/g)].map(m => m[1]);
    const uniq = [...new Set(hits)];
    if (uniq.length) console.log('==>', url.split('/').pop(), JSON.stringify(uniq.slice(0, 20)));
  } catch (e) { /* skip */ }
}
console.log('done');
