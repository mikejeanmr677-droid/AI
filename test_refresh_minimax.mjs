// 测试 MiniMax 刷新
import { refreshPlatformBalance } from './src/services/balance.js';

async function main() {
  try {
    console.log('测试刷新 MiniMax 余额 (id=9)...');
    const result = await refreshPlatformBalance(9);
    console.log('刷新结果:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('刷新失败:', err);
  }
}

main();
