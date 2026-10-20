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

    // 等待余额元素加载完成
    await page.waitForTimeout(3000);
    
    // 尝试多种选择器查找余额元素
    const balanceSelectors = [
      '.balance-amount',
      '.available-balance',
      '.money-amount',
      '[class*="balance"]',
      '[class*="amount"]',
      'text="可用额度"',
      'text="余额"',
      'text="剩余"',
    ];
    
    let balanceText = null;
    
    // 尝试通过选择器查找
    for (const selector of balanceSelectors) {
      try {
        if (selector.startsWith('text=')) {
          // 使用XPath查找文本
          const text = selector.substring(5);
          const elements = await page.$x(`//*[contains(text(), '${text}')]`);
          for (const el of elements) {
            const parent = await el.parentElement();
            if (parent) {
              const textContent = await parent.textContent();
              const match = textContent.match(/[0-9]+(?:\.[0-9]{1,2})?/);
              if (match) {
                balanceText = match[1];
                break;
              }
            }
          }
        } else {
          const elements = await page.$$(selector);
          for (const el of elements) {
            const textContent = await el.textContent();
            const match = textContent.match(/[0-9]+(?:\.[0-9]{1,2})?/);
            if (match) {
              balanceText = match[1];
              break;
            }
          }
        }
        
        if (balanceText) break;
      } catch (e) {
        continue;
      }
    }
    
    // 如果通过选择器没找到，就用文本匹配
    if (!balanceText) {
      const balanceText = await page.evaluate(() => {
      // 先获取页面上所有文本
      const allText = document.body.innerText || document.body.textContent;
      console.log('[scraper] 页面文本预览:', allText.slice(0, 800));
      
      // 匹配中文或英文的余额文本，兼容不同页面版本
      const matchPatterns = [
        /可用额度.*?¥\s*([0-9]+(?:\.[0-9]{1,2})?)/s,
        /余额.*?¥\s*([0-9]+(?:\.[0-9]{1,2})?)/s,
        /剩余.*?¥\s*([0-9]+(?:\.[0-9]{1,2})?)/s,
        /available.*?balance.*?¥\s*([0-9]+(?:\.[0-9]{1,2})?)/si,
        /balance.*?¥\s*([0-9]+(?:\.[0-9]{1,2})?)/si,
        /([0-9]+(?:\.[0-9]{1,2})?)\s*元/,
        /([0-9]+(?:\.[0-9]{1,2})?)\s*CNY/,
      ];
      
      // 尝试所有匹配模式
      for (const pattern of matchPatterns) {
        const match = allText.match(pattern);
        if (match) {
          console.log('[scraper] 匹配到余额:', match[1]);
          return match[1];
        }
      }
      
      // 尝试查找所有数字，优先找大的金额数字
      const numberMatches = allText.match(/[0-9]+(?:\.[0-9]{1,2})?/g);
      if (numberMatches && numberMatches.length > 0) {
        // 按数值从大到小排序，优先取最大的数字作为余额
        const sortedNumbers = numberMatches.map(num => parseFloat(num)).sort((a, b) => b - a);
        console.log('[scraper] 找到的所有数字:', sortedNumbers);
        // 假设最大的数字就是余额
        return sortedNumbers[0].toString();
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
      throw new Error('在 MiniMax 页面未找到明确的可用余额，请检查登录状态！');
    }
  } finally {
    await browser.close();
  }
}
