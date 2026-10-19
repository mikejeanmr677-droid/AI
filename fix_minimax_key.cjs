const initSqlJs = require('sql.js');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

async function main() {
  const SQL = await initSqlJs();
  const dbFile = join(__dirname, 'src', 'data', 'llm-manager.db');
  const db = new SQL.Database(readFileSync(dbFile));
  
  // 把 MiniMax 的 api_key 改成普通前缀（去掉 sk-cp-，这样就会走浏览器抓取逻辑）
  db.run(`UPDATE platforms SET api_key = 'sk-temp-minimax' WHERE id = 9`);
  
  // 验证
  const result = db.exec('SELECT id, name, api_key FROM platforms WHERE id = 9');
  if (result.length) {
    console.log('修改后的 MiniMax 配置:');
    console.log('  id: ' + result[0].values[0][0]);
    console.log('  name: ' + result[0].values[0][1]);
    console.log('  api_key: ' + result[0].values[0][2]);
  }
  
  // 保存
  const data = db.export();
  writeFileSync(dbFile, Buffer.from(data));
  console.log('数据库已保存');
}

main().catch(console.error);
