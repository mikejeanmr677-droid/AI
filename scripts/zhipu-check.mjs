// 独立测试智谱内部接口（带 Authorization token）
// ponytail: 临时验证脚本；问题定位后可删。
const TOKEN = process.env.ZHIPU_JWT || '';
if (!TOKEN) { console.error('请先设置环境变量 ZHIPU_JWT（智谱控制台 JWT）'); process.exit(1); }

const candidates = [
  '/api/biz/asset/overview',
  '/api/biz/fund/account',
  '/api/biz/fund/overview',
  '/api/biz/account/overview',
  '/api/biz/user/account',
  '/api/biz/cust/account',
  '/api/biz/pct/account/balance',
  '/api/biz/finance/account/balance',
  '/api/biz/trade/account/balance',
  '/api/biz/user/asset',
];

for (const p of candidates) {
  try {
    const res = await fetch('https://open.bigmodel.cn' + p, {
      headers: { 'Authorization': 'Bearer ' + TOKEN },
    });
    const text = await res.text();
    console.log('==>', p, res.status, text.slice(0, 300));
  } catch (e) {
    console.log('==>', p, 'ERR', e.message);
  }
}
