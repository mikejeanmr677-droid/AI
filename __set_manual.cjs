const initSqlJs = require('sql.js');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

async function main() {
  const SQL = await initSqlJs();
  const dbFile = join(__dirname, 'src', 'data', 'llm-manager.db');
  const db = new SQL.Database(readFileSync(dbFile));
  
  // 把智谱AI改成手动模式
  db.run(`UPDATE platforms SET balance_type='manual' WHERE id=10 AND name='智谱AI'`);
  
  // 验证修改
  const result = db.exec('SELECT id, name, provider, balance_type FROM platforms WHERE id=10');
  if (result.length) {
    console.log('修改后的智谱AI记录:');
    console.log(result[0].values.map(r => r).join(' | '));
  }
  
  // 持久化
  const data = db.export();
  writeFileSync(dbFile, Buffer.from(data));
  console.log('数据库已保存');
}
main().catch(e => console.error(e.message));
