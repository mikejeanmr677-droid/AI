const initSqlJs = require('sql.js');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

async function main() {
  const SQL = await initSqlJs();
  const dbFile = join(__dirname, 'src', 'data', 'llm-manager.db');
  const db = new SQL.Database(readFileSync(dbFile));
  
  // 修复智谱AI：provider改为zhipu，补上余额查询URL
  db.run(`UPDATE platforms SET provider='zhipu', balance_api_url='https://open.bigmodel.cn/api/paas/v4/billing/usage', balance_json_path='remaining_quota' WHERE id=10 AND name='智谱AI'`);
  
  // 验证修改
  const result = db.exec('SELECT id, name, provider, balance_api_url, balance_json_path FROM platforms WHERE id=10');
  if (result.length) {
    console.log('修复后的智谱AI记录:');
    console.log(result[0].values.map(r => r).join(' | '));
  }
  
  // 持久化
  const data = db.export();
  writeFileSync(dbFile, Buffer.from(data));
  console.log('数据库已保存');
}
main().catch(e => console.error(e.message));
