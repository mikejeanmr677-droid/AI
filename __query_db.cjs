const initSqlJs = require('sql.js');
const { readFileSync } = require('fs');
const { join } = require('path');

async function main() {
  const SQL = await initSqlJs();
  const dbFile = join(__dirname, 'src', 'data', 'llm-manager.db');
  const db = new SQL.Database(readFileSync(dbFile));
  
  // 查看所有平台
  const result = db.exec('SELECT id, name, provider, balance_type, balance_api_url, balance_json_path, (api_key IS NOT NULL) as has_key, (api_key_secret IS NOT NULL) as has_secret FROM platforms ORDER BY id');
  if (result.length) {
    console.log('ID | name | provider | type | balance_url | json_path | has_key | has_secret');
    console.log('-'.repeat(100));
    result[0].values.forEach(row => {
      console.log(row.join(' | '));
    });
  } else {
    console.log('No platforms found');
  }
}
main().catch(e => console.error(e.message));
