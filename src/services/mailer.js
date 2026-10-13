// 邮件通知：用 nodemailer 发送充值提醒
import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', '..', 'config.json');
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch {
  config = { email: {} };
}

let transporter = null;
function getTransporter() {
  const c = config.email || {};
  if (!c.host || !c.user) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port || 465,
      secure: c.secure !== false,
      auth: { user: c.user, pass: c.pass },
    });
  }
  return transporter;
}

export async function sendRechargeEmail({ platformName, amount, currency, reason, orderId }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mail] 未配置 SMTP，跳过邮件发送（充值单已生成）');
    return false;
  }
  const c = config.email;
  const to = c.to || c.user;
  const subject = `[充值提醒] ${platformName} 余额不足，需充值 ${amount} ${currency}`;
  const html = `
    <h3>大模型平台充值提醒</h3>
    <p>平台：<b>${platformName}</b></p>
    <p>充值金额：<b>${amount} ${currency}</b></p>
    <p>原因：${reason}</p>
    <p>充值单号：${orderId}</p>
    <p>请尽快通过网银向该平台对公账户汇款，并在系统内标记「已打款」。</p>
  `;
  try {
    await t.sendMail({ from: c.from, to, subject, html });
    console.log(`[mail] 充值单 #${orderId} 已发送到 ${to}`);
    return true;
  } catch (err) {
    console.error(`[mail] 发送失败: ${err.message}`);
    return false;
  }
}
