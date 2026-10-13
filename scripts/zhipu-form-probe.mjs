// 登录提交体挖掘：账号密码登录的字段结构
// ponytail: 一次性探测脚本，定位后可删。
import { readFileSync } from 'node:fs';
const js = readFileSync('scripts/.tmp/app.0fe2caa0.js', 'utf-8');
const idxs = [];
let i = -1;
while ((i = js.indexOf('password', i + 1)) >= 0 && idxs.length < 200) idxs.push(i);
for (const k of idxs) {
  const s = js.slice(k - 200, k + 200).replace(/\n/g, ' ');
  if (/login|Login|submit|Submit|handle|formData|encrypt/.test(s)) {
    console.log('---', s, '\n');
  }
}
