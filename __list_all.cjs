const initSqlJs = require('sql.js');
const { readFileSync } = require('fs');
const { join } = require('path');

async function main() {
  const SQL = await initSqlJs();
  const dbFile = join(__dirname, 'src', 'data', 'llm-manager.db');
  const db = new SQL.Database(readFileSync(dbFile));
  
  // 查看所有平台
  const result = db.exec('SELECT id, name, provider, balance_type, balance_api_url, balance_json_path FROM platforms ORDER BY id');
  if (result.length) {
    console.log('当前所有平台配置:');
    console.log('id  name                          provider  balance_type  balance_api_url');
    console.log('-'.repeat(120));
    result[0].values.forEach(row => {
      console.log(`${row[0].toString().padEnd(4)} ${row[1].toString().padEnd(30)} ${row[2].toString().padEnd(10)} ${row[3].toString().padEnd(12)} ${row[4]?.toString() || ''}`);
    });
  } else {
    console.log('No platforms found');
  }
}
main().catch(e => console.error(e.message));
