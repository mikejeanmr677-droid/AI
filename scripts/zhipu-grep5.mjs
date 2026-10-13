// 抓财务页面运行时实际发出的 XHR 请求 —— 用浏览器网络面板不可行，改从 chunkjs 直接搜
// 换思路：FinanceCenter 是路由级 chunk，URL 形如 chunks/FinanceCenter.<hash>.js，hash 映射在 app.js 的 e(t) 拼接函数里
// ponytail: 临时验证脚本；问题定位后可删。
const html = await fetch('https://open.bigmodel.cn/finance-center/finance/overview').then(r => r.text());
const jsFiles = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
const appUrl = jsFiles.find(f => f.includes('app.'));
const appAbs = appUrl.startsWith('http') ? appUrl : 'https://open.bigmodel.cn' + appUrl;
const code = await fetch(appAbs).then(r => r.text());

// 找 webpack runtime 的 chunk 拼接函数，形如 e.p+"js/"+({...}[t]||t)+"."+{hash map}[t]+".chunk.js"
// 直接把整段 runtime 打出来
const rt = code.match(/[a-zA-Z]+\.(?:p|pp)\s*=\s*"[^"]+"/g);
console.log('publicPath:', rt && rt.slice(0, 5));

// hash map: {FinanceCenter:"abc123",...} —— 搜包含 Overview 或 Finance 且值是 hex 的对象
const maps = code.match(/\{[^{}]*"(?:FinanceCenter|Finance|OverView)"[^{}]*\}/g);
console.log('maps:', maps && maps.slice(0, 2));
