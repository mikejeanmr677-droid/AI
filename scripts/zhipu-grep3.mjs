// 找 FinanceCenter chunk 的真实 URL（webpack chunk id→hash 映射在 app.js 里）
// ponytail: 临时验证脚本；问题定位后可删。
const html = await fetch('https://open.bigmodel.cn/finance-center/finance/overview').then(r => r.text());
const jsFiles = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
const appUrl = jsFiles.find(f => f.includes('app.'));
const code = await fetch(appUrl.startsWith('http') ? appUrl : 'https://open.bigmodel.cn' + appUrl).then(r => r.text());

// webpack 常见映射: {chunkId:"hash"} —— 找 "FinanceCenter":"xxxxx" 这种
const m = code.match(/"FinanceCenter":"([a-f0-9]{8,})"/) || code.match(/FinanceCenter[^{]*\{[^}]*"([a-f0-9]{8,})"/);
console.log('FinanceCenter hash:', m && m[1]);

// 也找 chunk 公共路径
const pub = code.match(/"(\.\/|\/)[a-zA-Z0-9_\-/]*\.js"/g);
console.log('sample paths:', pub && pub.slice(0, 5));

// 直接尝试所有 hash 出现在 FinanceCenter 附近
const idx = code.indexOf('"FinanceCenter"');
console.log('context:', code.slice(Math.max(0, idx - 100), idx + 200));
