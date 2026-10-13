// 独立测试腾讯云 TC3 签名 + DescribeAccountBalance
// ponytail: 临时验证脚本；问题定位后可删。
import { createHash, createHmac } from 'node:crypto';

const secretId = process.env.TENCENT_SECRET_ID || '';
const secretKey = process.env.TENCENT_SECRET_KEY || '';
if (!secretId || !secretKey) { console.error('请先设置环境变量 TENCENT_SECRET_ID / TENCENT_SECRET_KEY'); process.exit(1); }
const host = 'billing.tencentcloudapi.com';
const service = 'billing';
const action = 'DescribeAccountBalance';
const payload = '{}';

const now = new Date();
const timestamp = Math.floor(now.getTime() / 1000);
const pad = (n) => String(n).padStart(2, '0');
const date = now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1) + '-' + pad(now.getUTCDate());

const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + host + '\nx-tc-action:' + action.toLowerCase() + '\n';
const signedHeaders = 'content-type;host;x-tc-action';
const hashedPayload = createHash('sha256').update(payload).digest('hex');
const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
const credentialScope = date + '/' + service + '/tc3_request';
const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
const kDate = createHmac('sha256', 'TC3' + secretKey).update(date).digest();
const kService = createHmac('sha256', kDate).update(service).digest();
const kSigning = createHmac('sha256', kService).update('tc3_request').digest();
const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
const auth = 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

console.log('date:', date, 'timestamp:', timestamp);
try {
  const res = await fetch('https://' + host + '/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Version': '2018-07-09',
      'X-TC-Timestamp': String(timestamp),
      'Authorization': auth,
    },
    body: payload,
  });
  const text = await res.text();
  console.log('status:', res.status);
  console.log('body:', text.slice(0, 500));
} catch (e) {
  console.log('ERR:', e.message, '| cause:', e.cause?.code || e.cause?.message);
}
