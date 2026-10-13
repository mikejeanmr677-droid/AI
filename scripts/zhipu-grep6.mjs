// 最终手段：直接在运行中的浏览器页面监听 fetch/XHR —— 通过 navigate 到一个注入脚本不可行
// 改为：把 app.js 整体落盘，本地全文搜 "balance"（大小写不敏感）上下文
// ponytail: 临时验证脚本；问题定位后可删。
import { writeFileSync } from 'node:fs';
const html = await fetch('https://open.bigmodel.cn/finance-center/finance/overview').then(r => r.text());
const jsFiles = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
const appUrl = jsFiles.find(f => f.includes('app.'));
const appAbs = appUrl.startsWith('http') ? appUrl : 'https://open.bigmodel.cn' + appUrl;
const code = await fetch(appAbs).then(r => r.text());
writeFileSync('scripts/zhipu-app.js', code);
console.log('saved', code.length, 'bytes from', appAbs);

// 搜所有 URL 构建特征：url: "..." 或 axios.get("...")
const urls = [...new Set([...code.matchAll(/["'`](\/(?:biz|api|pay|maas)[a-zA-Z0-9_\-/]*)["'`]/g)].map(m => m[1]))];
console.log(JSON.stringify(urls, null, 0));
