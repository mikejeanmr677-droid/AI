// 测试智谱AI 浏览器登录
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DATA_DIR = path.join(__dirname, 'zhipu-user-data');

async function main() {
  console.log('正在启动浏览器，打开智谱AI财务中心...');
  console.log('登录数据会保存在:', USER_DATA_DIR);
  console.log('请在打开的浏览器里手动登录！');
  
  // 确保用户数据目录存在
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }
  
  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false, // 非无头模式，方便你手动登录
    viewport: { width: 1280, height: 720 },
  });
  
  const page = await browser.newPage();
  
  // 打开智谱AI财务中心
  await page.goto('https://open.bigmodel.cn/finance-center/finance/overview', { 
    waitUntil: 'networkidle', 
    timeout: 60000 
  });
  
  console.log('浏览器已打开！');
  console.log('请在浏览器里登录智谱AI，登录成功后手动关闭这个窗口。');
  console.log('或者你截图给我看看余额在页面的哪个位置！');
  console.log('按 Ctrl+C 停止这个脚本。');
  
  // 保持浏览器打开，让用户登录
  await new Promise(resolve => { /* 永远不 resolve，让用户手动操作 */ });
}

main().catch(console.error);
