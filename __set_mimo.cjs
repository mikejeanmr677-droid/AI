const initSqlJs = require('sql.js');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

async function main() {
  const SQL = await initSqlJs();
  const dbFile = join(__dirname, 'src', 'data', 'llm-manager.db');
  const db = new SQL.Database(readFileSync(dbFile));
  
  // 把小米平台的provider改成mimo
  db.run(`UPDATE platforms SET provider='mimo' WHERE id=12 AND name LIKE '%小米%'`);
  
  // 验证修改
  const result = db.exec('SELECT id, name, provider FROM platforms WHERE id=12');
  if (result.length) {
    console.log('修改后的小米平台记录:');
    console.log(result[0].values.map(r => r).join(' | '));
  }
  
  // 持久化
  const data = db.export();
  writeFileSync(dbFile, Buffer.from(data));
  console.log('数据库已保存');
}
main().catch(e => console.error(e.message));
