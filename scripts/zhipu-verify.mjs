// 通过平台 API 完整验证智谱查询器（走服务进程）
// ponytail: 临时验证脚本；问题定位后可删。
const r = await fetch('http://localhost:3000/api/platforms/4/refresh', { method: 'POST' });
console.log('refresh:', await r.text());
const list = await fetch('http://localhost:3000/api/platforms').then(x => x.json());
const p = list.find(x => x.id === 4);
console.log('智谱:', JSON.stringify({ balance: p.latest_balance, checked: p.latest_checked_at, provider: p.provider, type: p.balance_type }));
