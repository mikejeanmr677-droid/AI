# MiniMax 余额抓取器工作原理

## 整体流程

### 1. 初始化与登录
```javascript
// 启动浏览器，加载本地保存的登录状态
const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
  headless: true, // 生产环境使用无头模式
  viewport: { width: 1920, height: 1080 },
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
```

**免密登录原理**：
- `USER_DATA_DIR` 是本地保存的浏览器用户数据目录
- 第一次登录后，浏览器的cookies、登录状态会被保存在这个目录
- 下次启动时，会直接加载这个目录，不需要重新输入账号密码
- 如果没有保存过登录状态，会提示用户手动完成登录


### 2. 导航到账户钱包页面
```javascript
// 导航到MiniMax官网
await page.goto('https://platform.minimax.cn/', { waitUntil: 'networkidle', timeout: 30000 });

// 如果未登录，提示用户登录
if (currentUrl.includes('login')) {
  // 自动填充账号密码（如果有保存的话）
  await page.type('input[type="text"]', config.username);
  await page.type('input[type="password"]', config.password);
  await page.click('button[type="submit"]');
}

// 导航到账户钱包页面
await page.goto('https://platform.minimax.cn/console/account-wallet', { waitUntil: 'networkidle', timeout: 30000 });
```


### 3. 查找可用额度旁边的余额
这是最核心的步骤，我们使用了多种方式来准确查找余额：

#### 方式一：XPath查找（最准确）
```javascript
// 使用XPath查找所有包含"可用额度"的元素
const xpathResult = document.evaluate(
  '//*[contains(text(), "可用额度")]',
  document,
  null,
  XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
  null
);

// 遍历找到的元素，获取下一个兄弟元素（通常是显示余额的地方）
for (let i = 0; i < xpathResult.snapshotLength; i++) {
  const el = xpathResult.snapshotItem(i);
  const nextSibling = el.nextElementSibling;
  
  if (nextSibling) {
    const text = nextSibling.textContent.trim();
    // 查找¥符号后面的数字
    const match = text.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (match) return match[1];
  }
}
```

**原理**：
- 先找到页面上显示"可用额度"的文字
- 然后获取它的下一个兄弟元素，这个元素通常就是显示具体余额的地方
- 比如：`可用额度 ¥15.00`，我们会找到`¥15.00`，然后提取出`15.00`


#### 方式二：遍历所有元素
如果方式一失败，我们会遍历页面上的所有元素：
```javascript
const allElements = document.querySelectorAll('*');
for (const el of allElements) {
  const text = el.textContent.trim();
  if (text.includes('可用额度')) {
    // 查找父元素中的金额
    let parent = el.parentElement;
    while (parent) {
      const parentText = parent.textContent.trim();
      if (parentText.includes('¥') || parentText.includes('￥')) {
        const match = parentText.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
        if (match) return match[1];
      }
      parent = parent.parentElement;
    }
  }
}
```


### 4. 优先匹配¥符号后面的数字，过滤不合理的数字
```javascript
// 全局查找所有¥符号后面的数字
const yenMatches = allText.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/g);

if (yenMatches) {
  // 提取每个匹配项的数字部分
  const amounts = yenMatches.map(match => {
    const numMatch = match.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    return numMatch ? parseFloat(numMatch[1]) : 0;
  }).filter(num => num > 0 && num < 10000); // 过滤掉明显不合理的数字
  
  if (amounts.length > 0) {
    // 按从大到小排序，选择最可能的余额
    amounts.sort((a, b) => b - a);
    return amounts[0].toString();
  }
}
```

**过滤规则**：
- 只保留0到10000之间的数字
- 排除年份（比如2026）、订单号等不合理的数字
- 优先选择最大的有效数字，因为余额通常是比较大的数值


### 5. 异常处理与调试
如果所有方式都失败，会保存当前页面的截图：
```javascript
// 保存调试截图
const debugScreenshot = path.join(__dirname, '../debug_minimax.png');
await page.screenshot({ path: debugScreenshot, fullPage: true });

throw new Error('在 MiniMax 页面未找到明确的可用余额，请检查登录状态或页面结构！');
```


## 完整代码示例
```javascript
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_DATA_DIR = path.join(__dirname, '../playwright-user-data');
const CONFIG_PATH = path.join(__dirname, '../config.json');

export async function scrapeMiniMaxBalance() {
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  await page.route('**/*.{png,jpg,jpeg,webp,svg,gif}', route => route.abort());

  try {
    await page.goto('https://platform.minimax.cn/', { waitUntil: 'networkidle', timeout: 30000 });

    const currentUrl = page.url();
    if (currentUrl.includes('login')) {
      console.log('检测到未登录，尝试自动登录...');
      await page.waitForSelector('input[type="text"]', { timeout: 5000 });
      await page.waitForSelector('input[type="password"]', { timeout: 5000 });
      
      await page.type('input[type="text"]', config.username);
      await page.type('input[type="password"]', config.password);
      
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 });
    }

    await page.goto('https://platform.minimax.cn/console/account-wallet', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);

    const balanceText = await page.evaluate(() => {
      // 1. XPath查找
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
          const match = text.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
          if (match) return match[1];
        }
      }
      
      // 2. 全局查找
      const allText = document.body.innerText || document.body.textContent;
      const yenMatches = allText.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/g);
      
      if (yenMatches) {
        const amounts = yenMatches.map(match => {
          const numMatch = match.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
          return numMatch ? parseFloat(numMatch[1]) : 0;
        }).filter(num => num > 0 && num < 10000);
        
        if (amounts.length > 0) {
          amounts.sort((a, b) => b - a);
          return amounts[0].toString();
        }
      }
      
      return null;
    });
    
    if (balanceText) {
      return parseFloat(balanceText);
    }
    
    throw new Error('未找到可用余额');
  } finally {
    await browser.close();
  }
}
```