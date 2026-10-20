import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_DATA_DIR = path.join(__dirname, '../playwright-user-data');

async function testScraper() {
  // 确保用户数据目录存在
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  // 启动浏览器，加载用户数据（保存登录状态）
  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false, // 使用有头模式，方便查看
    viewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // 关闭图片加载加快速度
  await page.route('**/*.{png,jpg,jpeg,webp,svg,gif}', route => route.abort());

  try {
    console.log('正在打开MiniMax官网...');
    await page.goto('https://platform.minimax.cn/', { waitUntil: 'networkidle', timeout: 60000 });

    // 检查是否已经登录
    const currentUrl = page.url();
    console.log('当前URL:', currentUrl);
    
    if (currentUrl.includes('login')) {
      console.log('检测到未登录，请在浏览器中完成登录操作...');
      console.log('请完成登录后按回车键继续...');
      // 等待用户按下回车键
      await new Promise(resolve => process.stdin.once('data', resolve));
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 300000 });
    }

    // 导航到账户钱包页面
    await page.goto('https://platform.minimax.cn/console/account-wallet', { waitUntil: 'networkidle', timeout: 30000 });

    console.log('等待页面稳定...');
    await page.waitForTimeout(5000);

    // 保存当前页面截图
    const debugScreenshot = path.join(__dirname, '../debug_minimax_current.png');
    await page.screenshot({ path: debugScreenshot, fullPage: true });
    console.log('已保存当前页面截图到:', debugScreenshot);

    // 提取页面内容
    const pageContent = await page.content();
    console.log('页面标题:', await page.title());
    console.log('页面URL:', page.url());
    
    // 查找所有包含¥的元素
    const yenElements = await page.$$eval('*', (elements) => {
      return elements
        .map(el => ({
          text: el.textContent.trim(),
          tag: el.tagName,
          class: el.className
        }))
        .filter(item => item.text.includes('¥') || item.text.includes('￥'))
        .slice(0, 10); // 只取前10个结果
    });
    
    console.log('找到的包含¥的元素:', yenElements);

    // 查找所有包含"可用额度"的元素
    const creditElements = await page.$$eval('*', (elements) => {
      return elements
        .map(el => ({
          text: el.textContent.trim(),
          tag: el.tagName,
          class: el.className
        }))
        .filter(item => item.text.includes('可用额度'))
        .slice(0, 10);
    });
    
    console.log('找到的包含"可用额度"的元素:', creditElements);

    // 提取所有数字
    const allText = await page.evaluate(() => document.body.innerText);
    const numberMatches = allText.match(/[0-9]+(?:\.[0-9]{1,2})?/g);
    console.log('找到的所有数字:', numberMatches ? numberMatches.slice(0, 20) : '无');

  } catch (error) {
    console.error('测试失败:', error.message);
  } finally {
    // 不要关闭浏览器，让用户可以继续操作
    // await browser.close();
  }
}

testScraper();