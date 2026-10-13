// 智谱账密登录测试：POST /auth/login
// ponytail: 一次性探测脚本，定位后可删。
const body = {
  username: process.env.ZHIPU_USER || '',
  password: process.env.ZHIPU_PASS || '',
  loginType: 'username',
  grantType: 'customer',
  userType: 'PERSONAL',
  captchaTicket: '',
  captchaRandstr: '',
  noLoading: true,
  appId: '',
};
const r = await fetch('https://open.bigmodel.cn/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  body: JSON.stringify(body),
});
console.log('status:', r.status);
console.log('body:', (await r.text()).slice(0, 400));
