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

    // 简单判断一下有没有登录：看有没有出现登录按钮
    const isLoggedIn = await page.evaluate(() => {
      return !document.querySelector('button[type="submit"]') || document.body.textContent.includes('余额');
    });

    if (!isLoggedIn) {
      console.log('检测到未登录，请先在浏览器中完成手机验证码登录...');
      console.log('登录完成后，请回到终端按回车键继续...');
      await new Promise(resolve => process.stdin.once('data', resolve));
      console.log('继续...');
      await page.waitForLoadState('networkidle');
    }

    // 现在尝试读取余额
    console.log('正在读取余额...');

    // 先尝试几种常见的余额选择器
    const balanceText = await page.evaluate(() => {
      // 尝试匹配"余额"、"可用余额"、"剩余"等关键词附近的数字
      const textContent = document.body.textContent;
      const balanceMatch = textContent.match(/(?:余额|可用|剩余)[\s：:]*([0-9]+(?:\.[0-9]+)?)/);
      if (balanceMatch) return balanceMatch[1];

      // 尝试找带"元"的数字
      const yuanMatch = textContent.match(/([0-9]+(?:\.[0-9]+)?)[\s]*元/);
      if (yuanMatch) return yuanMatch[1];

      // 尝试找常见的DOM结构（你可以根据实际页面调整）
      const possibleSelectors = [
        '.balance', '.amount', '.remaining', '.total',
        '[class*="balance"]', '[class*="amount"]', '[class*="remaining"]',
      ];
      for (const selector of possibleSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const numMatch = el.textContent.match(/[0-9]+(?:\.[0-9]+)?/);
          if (numMatch) return numMatch[0];
        }
      }

      return null;
    });

    if (balanceText) {
      const balance = parseFloat(balanceText);
      console.log(`✅ 成功读取到余额：${balance} 元`);
      return balance;
    } else {
      console.log('❌ 未找到余额，请检查页面结构...');
      console.log('页面已打开，你可以在浏览器里告诉我余额在哪里，我来调整选择器');
      return null;
    }
  } finally {
    // 不要关闭浏览器，让你看看页面
    console.log('浏览器已打开，按Ctrl+C关闭...');
    await new Promise(() => {});
  }
}

scrapeMiniMaxBalance().catch(console.error);
