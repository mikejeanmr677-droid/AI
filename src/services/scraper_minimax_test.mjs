import scrapeMiniMaxBalance from './scraper_minimax.mjs';

async function testScraper() {
  try {
    const balance = await scrapeMiniMaxBalance();
    console.log('测试成功，余额:', balance);
  } catch (error) {
    console.error('测试失败:', error.message);
  }
}

testScraper();