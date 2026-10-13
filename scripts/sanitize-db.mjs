// 一次性脱敏脚本：把本地 llm-manager.db 里的真实密钥清空（交付前跑）
// 用法：node scripts/sanitize-db.mjs [--dry]
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync } from 'node:fs';

const DB = new URL('../src/data/llm-manager.db', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dry = process.argv.includes('--dry');

if (!dry) {
  copyFileSync(DB, DB + '.backup-before-sanitize');
  console.log('已备份到', DB + '.backup-before-sanitize');
}

const db = new DatabaseSync(DB);
const r = db.prepare("UPDATE platforms SET api_key='SANITIZED', api_key_secret='SANITIZED'").run();
console.log('rows updated:', r.changes);
const left = db.prepare("SELECT COUNT(*) c FROM platforms WHERE api_key NOT IN ('SANITIZED','') AND api_key IS NOT NULL").get();
console.log('remaining real keys:', left.c);
db.close();
