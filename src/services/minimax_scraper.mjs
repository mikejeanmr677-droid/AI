import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_DATA_DIR = path.join(__dirname, 'playwright-user-data');

async function scrapeMiniMaxBalance() {
  // 确保用户数据目录存在
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  // 启动浏览器，加载用户数据（保存登录状态）
  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false, // 第一次用非无头模式，方便你登录
    viewport: { width: 1280, height: 720 },
  });

  const page = await browser.newPage();

  try {
    console.log('正在打开MiniMax钱包页面...');
    await page.goto('https://platform.minimax.cn/console/recharge-records', { waitUntil: 'networkidle' });

    // 现在尝试读取余额
    console.log('正在读取余额...');

    // 根据你提供的截图，我们来找"可用额度"附近的数字
    const balanceText = await page.evaluate(() => {
      // 找包含"可用额度"的区域
      const allText = document.body.textContent;
      
      // 匹配"可用额度"后面的数字，包括可能的¥符号
      const match = allText.match(/可用额度[^0-9]*([0-9]+(?:\.[0-9]+)?)/);
      
      if (match) {
        return match[1];
      }
      
      // 备用方案：直接匹配带¥的数字
      const yuanMatch = allText.match(/¥\s*([0-9]+(?:\.[0-9]+)?)/);
      if (yuanMatch) return yuanMatch[1];
      
      return null;
    });

    if (balanceText) {
      const balance = parseFloat(balanceText);
      console.log(`✅ 成功读取到余额：${balance} 元`);
      return balance;
    } else {
      console.log('❌ 未找到余额，请检查页面结构...');
      return null;
    }
  } finally {
    // 关闭浏览器
    await browser.close();
  }
}

scrapeMiniMaxBalance().catch(console.error);
