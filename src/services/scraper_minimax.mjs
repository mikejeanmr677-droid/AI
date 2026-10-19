import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_DATA_DIR = path.join(__dirname, '../playwright-user-data');

export async function scrapeMiniMaxBalance() {
  // 确保用户数据目录存在
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  // 启动浏览器，加载用户数据（保存登录状态）
  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true, // 生产环境用无头模式
    viewport: { width: 1280, height: 720 },
  });

  const page = await browser.newPage();

  try {
    console.log('[MiniMax Scraper] 正在打开钱包页面...');
    await page.goto('https://platform.minimax.cn/console/recharge-records', { waitUntil: 'networkidle', timeout: 30000 });

    console.log('[MiniMax Scraper] 等待页面稳定...');
    await page.waitForTimeout(2000); // 等2秒，让页面完全加载

    console.log('[MiniMax Scraper] 正在读取余额...');

    // 根据截图，找"可用额度"附近的数字，严格匹配！
    const balanceText = await page.evaluate(() => {
      // 先获取页面上所有文本
      const allText = document.body.innerText || document.body.textContent;
      console.log('[scraper] 页面文本预览:', allText.slice(0, 800));
      
      // 只找明确包含"可用额度"和"¥"的数字！
      const match = allText.match(/可用额度.*?¥\s*([0-9]+(?:\.[0-9]{1,2})?)/s);
      
      if (match) {
        console.log('[scraper] 匹配到余额:', match[1]);
        return match[1];
      }
      
      // 备用：找"可用额度"后面紧接着的数字
      const simpleMatch = allText.match(/可用额度[^0-9]*([0-9]+(?:\.[0-9]{1,2})?)/);
      
      if (simpleMatch) {
        console.log('[scraper] 简单匹配到余额:', simpleMatch[1]);
        return simpleMatch[1];
      }
      
      // 如果还是找不到，报错而不是随便找一个！
      console.error('[scraper] 未找到明确的余额！');
      console.error('[scraper] 完整文本:', allText);
      throw new Error('在 MiniMax 页面未找到明确的可用余额，请检查登录状态！');
    });

    if (balanceText) {
      const balance = parseFloat(balanceText);
      console.log(`[MiniMax Scraper] 成功读取余额：${balance} 元`);
      return balance;
    } else {
      throw new Error('未在页面中找到余额');
    }
  } finally {
    await browser.close();
  }
}
