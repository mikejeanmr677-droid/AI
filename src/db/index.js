// 数据库模块：用 sql.js（WASM，纯 JS 无原生编译），数据持久化到 data/llm-manager.db
// 提供一个兼容 better-sqlite3 用法的薄封装层
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const dbFile = join(dataDir, 'llm-manager.db');
mkdirSync(dataDir, { recursive: true });

let db = null;

// 持久化到文件（sql.js 导出为二进制）
function persist() {
  if (!db) return;
  const data = db.export();
  writeFileSync(dbFile, Buffer.from(data));
}

// 把参数规范化为数组，处理 null/undefined
function normParams(params) {
  return (params || []).map((p) => (p === undefined ? null : p));
}

export async function initSchema() {
  if (db) return;
  const SQL = await initSqlJs();
  if (existsSync(dbFile)) {
    db = new SQL.Database(readFileSync(dbFile));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      base_url TEXT,
      api_key TEXT,
      api_key_secret TEXT,
      balance_type TEXT DEFAULT 'api',
      balance_api_url TEXT,
      balance_json_path TEXT,
      currency TEXT DEFAULT 'USD',
      threshold REAL DEFAULT 200,
      recharge_amount REAL DEFAULT 500,
      target_amount REAL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS balance_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      balance REAL,
      currency TEXT,
      checked_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS recharge_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      currency TEXT,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      notified_at TEXT,
      paid_at TEXT,
      credited_at TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS fund_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      balance REAL NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS fund_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      ref_id INTEGER,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // 迁移：为旧库补齐 api_key_secret 列（火山引擎 AK/SK 需要）
  try {
    const cols = db.exec("PRAGMA table_info(platforms)");
    const names = cols.length ? cols[0].values.map((r) => r[1]) : [];
    if (!names.includes('api_key_secret')) {
      db.run('ALTER TABLE platforms ADD COLUMN api_key_secret TEXT');
    }
  } catch {}

  // 初始化资金池记录
  const res = db.exec('SELECT id FROM fund_pool LIMIT 1');
  const hasRow = res.length && res[0].values.length;
  if (!hasRow) {
    db.run('INSERT INTO fund_pool (balance) VALUES (0)');
  }
  persist();
}

// 执行 SQL 并返回 { changes, lastInsertRowid }
function run(sql, params) {
  const p = normParams(params);
  db.run(sql, p);
  const idRes = db.exec('SELECT last_insert_rowid() AS id');
  const lastId = idRes.length ? idRes[0].values[0][0] : null;
  const changes = db.getRowsModified();
  persist();
  return { changes, lastInsertRowid: lastId };
}

// 查询全部行
function all(sql, params) {
  const stmt = db.prepare(sql);
  const p = normParams(params);
  if (p.length) stmt.bind(p);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// 查询单行
function get(sql, params) {
  const stmt = db.prepare(sql);
  const p = normParams(params);
  if (p.length) stmt.bind(p);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

// 事务：sql.js 用 db.exec 执行 BEGIN/COMMIT/ROLLBACK
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      persist();
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch {}
      throw err;
    }
  };
}

// 导出兼容 better-sqlite3 的接口
const dbApi = {
  prepare: (sql) => ({
    all: (...params) => all(sql, params),
    get: (...params) => get(sql, params),
    run: (...params) => run(sql, params),
  }),
  transaction,
  exec: (sql) => db.exec(sql),
  run: (sql, params = []) => run(sql, params),
  _raw: () => db,
};

export default dbApi;
