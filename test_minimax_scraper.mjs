// 测试 MiniMax 抓取脚本
import { scrapeMiniMaxBalance } from './src/services/scraper_minimax.mjs';

async function main() {
  try {
    console.log('开始测试 MiniMax 余额抓取...');
    const balance = await scrapeMiniMaxBalance();
    console.log('抓取结果:', balance);
  } catch (err) {
    console.error('抓取失败:', err);
  }
}

main();
