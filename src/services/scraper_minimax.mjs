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

// 保存配置文件
function saveConfig(config) {
  try {
    const fullConfig = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
    fullConfig.minimax = config;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(fullConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('[MiniMax Scraper] 保存配置文件失败:', e.message);
  }
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

    // 导航到账户钱包页面
    await page.goto('https://platform.minimax.cn/console/account-wallet', { waitUntil: 'networkidle', timeout: 30000 });

    console.log('[MiniMax Scraper] 等待页面稳定...');
    await page.waitForTimeout(5000); // 等5秒，让页面完全加载

    console.log('[MiniMax Scraper] 正在读取余额...');
    
    // 尝试多种方式获取余额
    let balance = null;
    
    // 方法1: 专门针对MiniMax的账户钱包页面
    const balanceText = await page.evaluate(() => {
      // 1. 使用XPath查找包含"可用额度"的元素
      const xpathResult = document.evaluate(
        '//*[contains(text(), "可用额度")]',
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      
      for (let i = 0; i < xpathResult.snapshotLength; i++) {
        const el = xpathResult.snapshotItem(i);
        const nextSibling = el.nextElementSibling;
        if (nextSibling) {
          const text = nextSibling.textContent.trim();
          if (text.includes('¥') || text.includes('￥')) {
            console.log('[scraper] 找到可用额度旁边的金额:', text);
            const match = text.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
            if (match) return match[1];
          }
          if (text.match(/[0-9]+(?:\.[0-9]{1,2})?/)) {
            console.log('[scraper] 找到可用额度旁边的数字:', text);
            return text;
          }
        }
      }
      
      // 2. 查找所有包含"可用额度"的元素
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const text = el.textContent.trim();
        if (text.includes('可用额度')) {
          // 查找父元素中的金额
          let parent = el.parentElement;
          while (parent) {
            const parentText = parent.textContent.trim();
            if (parentText.includes('¥') || parentText.includes('￥')) {
              console.log('[scraper] 找到包含可用额度和¥的父元素:', parentText);
              const match = parentText.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
              if (match) return match[1];
            }
            parent = parent.parentElement;
          }
          
          // 查找兄弟元素中的金额
          let sibling = el.nextElementSibling;
          while (sibling) {
            const siblingText = sibling.textContent.trim();
            if (siblingText.includes('¥') || siblingText.includes('￥')) {
              console.log('[scraper] 找到可用额度旁边的兄弟元素:', siblingText);
              const match = siblingText.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
              if (match) return match[1];
            }
            if (siblingText.match(/[0-9]+(?:\.[0-9]{1,2})?/)) {
              console.log('[scraper] 找到可用额度旁边的兄弟数字:', siblingText);
              return siblingText;
            }
            sibling = sibling.nextElementSibling;
          }
        }
      }
      
      // 3. 查找特定的余额选择器
      const possibleSelectors = [
        '.available-amount',
        '.account-balance',
        '.balance',
        '.amount',
        '.money',
        '[class*="balance"]',
        '[class*="amount"]'
      ];
      
      for (const selector of possibleSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const textContent = el.textContent.trim();
            if (textContent.includes('¥') || textContent.includes('￥')) {
              console.log('[scraper] 通过选择器找到包含¥的元素:', textContent);
              const match = textContent.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
              if (match) return match[1];
            }
            if (textContent.match(/^[0-9]+(?:\.[0-9]{1,2})?$/)) {
              console.log('[scraper] 通过选择器找到纯数字元素:', textContent);
              return textContent;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // 4. 全局查找，但优先排除明显不是余额的内容
      const allText = document.body.innerText || document.body.textContent;
      const lines = allText.split('\n');
      
      // 优先查找包含"可用额度"的行
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.includes('可用额度')) {
          console.log('[scraper] 找到包含可用额度的行:', trimmedLine);
          // 提取行中的数字
          const match = trimmedLine.match(/([0-9]+(?:\.[0-9]{1,2})?)/);
          if (match) return match[1];
        }
      }
      
      // 5. 最后尝试查找所有¥符号后面的数字
      const yenMatches = allText.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/g);
      if (yenMatches) {
        console.log('[scraper] 找到所有¥符号后面的数字:', yenMatches);
        // 提取每个匹配项的数字部分
        const amounts = yenMatches.map(match => {
          const numMatch = match.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
          return numMatch ? parseFloat(numMatch[1]) : 0;
        }).filter(num => num > 0 && num < 10000); // 过滤掉明显不合理的余额（比如年份2026）
        
        if (amounts.length > 0) {
          // 按从大到小排序
          amounts.sort((a, b) => b - a);
          console.log('[scraper] 过滤后的有效余额:', amounts);
          return amounts[0].toString();
        }
      }
      
      return null;
    });
    
    if (balanceText) {
      balance = parseFloat(balanceText);
      console.log(`[MiniMax Scraper] 成功读取余额：${balance} 元`);
      return balance;
    }
    
    // 如果所有方法都失败，截图保存当前页面
    const debugScreenshot = path.join(__dirname, '../debug_minimax.png');
    await page.screenshot({ path: debugScreenshot, fullPage: true });
    console.log('[MiniMax Scraper] 已保存调试截图到', debugScreenshot);
    
    throw new Error('在 MiniMax 页面未找到明确的可用余额，请检查登录状态或页面结构！');
  } catch (error) {
    console.error('[MiniMax Scraper] 抓取失败:', error.message);
    // 保存错误截图
    try {
      const errorScreenshot = path.join(__dirname, '../debug_minimax_error.png');
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
    saveConfig(config);
    console.log('[MiniMax Scraper] 账号密码已保存，下次会自动登录！');
    return true;
  } catch (e) {
    console.error('[MiniMax Scraper] 保存账号密码失败:', e.message);
    return false;
  }
}

export { scrapeMiniMaxBalance as default };