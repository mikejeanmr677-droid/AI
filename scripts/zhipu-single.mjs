// 在服务进程内复现 zhipu 查询器调用，定位 fetch failed
// ponytail: 临时验证脚本；问题定位后可删。
const TOKEN = process.env.ZHIPU_JWT || '';
if (!TOKEN) { console.error('请先设置环境变量 ZHIPU_JWT（智谱控制台 JWT）'); process.exit(1); }
try {
  const res = await fetch('https://open.bigmodel.cn/api/biz/account/query-customer-account-report', {
    headers: { Authorization: 'Bearer ' + TOKEN },
  });
  console.log('status:', res.status);
  console.log('body:', (await res.text()).slice(0, 300));
} catch (e) {
  console.log('ERR:', e.message, '| cause:', e.cause?.code || e.cause?.message);
}
