import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_DATA_DIR = path.join(__dirname, '../playwright-user-data');
const CONFIG_PATH = path.join(__dirname, '../config.json');

// 读取配置文件
function getConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return config.minimax || {};
    }
  } catch (e) {
    console.error('[MiniMax Scraper] 读取配置文件失败:', e.message);
  }
  return {};
}

export async function scrapeMiniMaxBalance() {
  // 确保用户数据目录存在
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  const config = getConfig();
  
  // 启动浏览器，加载用户数据（保存登录状态）
  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true, // 生产环境使用无头模式
    viewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // 关闭图片加载加快速度
  await page.route('**/*.{png,jpg,jpeg,webp,svg,gif}', route => route.abort());

  try {
    console.log('[MiniMax Scraper] 正在打开MiniMax官网...');
    await page.goto('https://platform.minimax.cn/', { waitUntil: 'networkidle', timeout: 30000 });

    // 检查是否已经登录
    const currentUrl = page.url();
    if (currentUrl.includes('login')) {
      console.log('[MiniMax Scraper] 检测到未登录，尝试自动登录...');
      
      // 如果有保存的账号密码，自动填充
      if (config.username && config.password) {
        try {
          // 等待登录页面加载完成
          await page.waitForSelector('input[type="text"]', { timeout: 5000 });
          await page.waitForSelector('input[type="password"]', { timeout: 5000 });
          
          // 填充账号密码
          await page.type('input[type="text"]', config.username);
          await page.type('input[type="password"]', config.password);
          
          // 点击登录按钮
          await page.click('button[type="submit"]');
          await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 });
          
          console.log('[MiniMax Scraper] 自动登录成功！');
        } catch (loginError) {
          console.error('[MiniMax Scraper] 自动登录失败:', loginError.message);
          console.log('[MiniMax Scraper] 请手动完成登录操作...');
          
          // 显示登录提示
          await page.evaluate(() => {
            alert('请完成MiniMax登录操作，登录完成后会自动继续。');
          });
          await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 300000 });
        }
      } else {
        console.log('[MiniMax Scraper] 未找到保存的账号密码，请手动完成登录操作...');
        
        // 提示用户登录
        await page.evaluate(() => {
          alert('请完成MiniMax登录操作，登录完成后会自动继续。');
        });
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 300000 });
      }
    }

    // 直接导航到账户钱包页面
    await page.goto('https://platform.minimax.cn/console/account-wallet', { waitUntil: 'networkidle', timeout: 30000 });

    console.log('[MiniMax Scraper] 等待页面稳定...');
    await page.waitForTimeout(5000); // 等5秒，让页面完全加载

    console.log('[MiniMax Scraper] 正在读取余额...');
    
    // 方法1: 直接查找账户钱包页面的余额元素（最准确）
    const balanceText = await page.evaluate(() => {
      // 1. 优先查找页面顶部的可用额度区域
      const topBarElements = document.querySelectorAll('.header-amount, .balance, .amount, [class*="balance"]');
      for (const el of topBarElements) {
        const text = el.textContent.trim();
        // 匹配 "¥15.00" 或 "15.00 CNY" 格式
        const match1 = text.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
        const match2 = text.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*CNY/);
        
        if (match1) {
          console.log('[scraper] 找到顶部余额:', match1[1]);
          return match1[1];
        }
        if (match2) {
          console.log('[scraper] 找到顶部余额:', match2[1]);
          return match2[1];
        }
      }
      
      // 2. 查找所有包含"可用额度"的元素
      const creditElements = document.querySelectorAll('*');
      for (const el of creditElements) {
        const text = el.textContent.trim();
        if (text.includes('可用额度')) {
          // 查找父元素中的金额
          let parent = el.parentElement;
          while (parent) {
            const parentText = parent.textContent.trim();
            // 匹配 "¥15.00" 或 "15.00 CNY" 格式
            const match1 = parentText.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
            const match2 = parentText.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*CNY/);
            
            if (match1) {
              console.log('[scraper] 找到可用额度旁边的余额:', match1[1]);
              return match1[1];
            }
            if (match2) {
              console.log('[scraper] 找到可用额度旁边的余额:', match2[1]);
              return match2[1];
            }
            parent = parent.parentElement;
          }
        }
      }
      
      // 3. 全局匹配，但排除版权年份
      const allText = document.body.innerText || document.body.textContent;
      const lines = allText.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        // 排除版权行
        if (trimmedLine.includes('©') || trimmedLine.includes('版权') || trimmedLine.includes('2026 MiniMax')) {
          continue;
        }
        
        // 匹配 "¥15.00" 或 "15.00 CNY" 格式
        const match1 = trimmedLine.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
        const match2 = trimmedLine.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*CNY/);
        
        if (match1 && parseFloat(match1[1]) < 10000) {
          console.log('[scraper] 找到全局匹配的余额:', match1[1]);
          return match1[1];
        }
        if (match2 && parseFloat(match2[1]) < 10000) {
          console.log('[scraper] 找到全局匹配的余额:', match2[1]);
          return match2[1];
        }
      }
      
      // 4. 最后尝试查找所有CNY前面的数字，但排除2026
      const cnyMatches = allText.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*CNY/g);
      if (cnyMatches) {
        for (const match of cnyMatches) {
          const numMatch = match.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*CNY/);
          if (numMatch && parseFloat(numMatch[1]) < 10000 && parseFloat(numMatch[1]) !== 2026) {
            console.log('[scraper] 找到CNY匹配的余额:', numMatch[1]);
            return numMatch[1];
          }
        }
      }
      
      return null;
    });
    
    if (balanceText) {
      const balance = parseFloat(balanceText);
      console.log(`[MiniMax Scraper] 成功读取余额：${balance} 元`);
      return balance;
    }
    
    // 如果所有方法都失败，截图保存当前页面
    const debugScreenshot = path.join(__dirname, '../debug_minimax_final.png');
    await page.screenshot({ path: debugScreenshot, fullPage: true });
    console.log('[MiniMax Scraper] 已保存调试截图到', debugScreenshot);
    
    throw new Error('在 MiniMax 页面未找到明确的可用余额，请检查登录状态或页面结构！');
  } catch (error) {
    console.error('[MiniMax Scraper] 抓取失败:', error.message);
    // 保存错误截图
    try {
      const errorScreenshot = path.join(__dirname, '../debug_minimax_final_error.png');
      await page.screenshot({ path: errorScreenshot, fullPage: true });
      console.log('[MiniMax Scraper] 已保存错误截图到', errorScreenshot);
    } catch (e) {}
    throw error;
  } finally {
    await browser.close();
  }
}

// 保存账号密码配置
export async function saveMiniMaxConfig(username, password) {
  try {
    const config = getConfig();
    config.username = username;
    config.password = password;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ minimax: config }, null, 2), 'utf8');
    console.log('[MiniMax Scraper] 账号密码已保存，下次会自动登录！');
    return true;
  } catch (e) {
    console.error('[MiniMax Scraper] 保存账号密码失败:', e.message);
    return false;
  }
}

export { scrapeMiniMaxBalance as default };