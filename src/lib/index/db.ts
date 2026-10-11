import { appPath, ensureDir, APP_DIR } from "../core/paths";

/* 使用 Node 内置 SQLite（node:sqlite，Node ≥ 22.13），无需编译原生模块，Windows 开箱即用。
   通过 process.getBuiltinModule 加载，避免被打包器解析。 */
type SqliteModule = typeof import("node:sqlite");
export type DB = import("node:sqlite").DatabaseSync;

const SCHEMA_VERSION = "3";

const g = globalThis as unknown as { __lifeosDb?: DB };

export function getDb(): DB {
  if (g.__lifeosDb) return g.__lifeosDb;
  ensureDir(APP_DIR);
  const sqlite = process.getBuiltinModule("node:sqlite") as SqliteModule;
  const db = new sqlite.DatabaseSync(appPath("index.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  g.__lifeosDb = db;
  return db;
}

function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  const row = db.prepare(`SELECT value FROM meta WHERE key='schema'`).get() as { value?: string } | undefined;
  if (row?.value === SCHEMA_VERSION) return;
  // 索引是派生数据：版本变化直接重建
  db.exec(`
    DROP TABLE IF EXISTS chunks_fts;
    DROP TABLE IF EXISTS embeddings;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS metrics;
    DROP TABLE IF EXISTS facts;
    DROP TABLE IF EXISTS notes;

    CREATE TABLE notes (
      path TEXT PRIMARY KEY,
      type TEXT, title TEXT, date TEXT, domain TEXT, status TEXT,
      tags TEXT, fm TEXT, body TEXT,
      hash TEXT, mtime REAL, private INTEGER DEFAULT 0
    );
    CREATE INDEX notes_type ON notes(type);
    CREATE INDEX notes_date ON notes(date);

    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
      ord INTEGER, heading TEXT, text TEXT, hash TEXT
    );
    CREATE INDEX chunks_path ON chunks(path);

    -- trigram 分词对中文友好；不足 3 个字的词用 LIKE 兜底
    CREATE VIRTUAL TABLE chunks_fts USING fts5(text, heading, content='chunks', content_rowid='id', tokenize='trigram');
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text, heading) VALUES (new.id, new.text, new.heading);
    END;
    CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, heading) VALUES ('delete', old.id, old.text, old.heading);
    END;

    -- 向量：Float32 BLOB；个人数据量下暴力余弦足够快，之后可换 sqlite-vec
    CREATE TABLE embeddings (
      chunk_hash TEXT NOT NULL, model TEXT NOT NULL, dim INTEGER, vec BLOB,
      PRIMARY KEY (chunk_hash, model)
    );

    CREATE TABLE metrics (
      date TEXT NOT NULL, key TEXT NOT NULL, value REAL, path TEXT,
      PRIMARY KEY (date, key)
    );

    CREATE TABLE facts (
      id TEXT PRIMARY KEY, domain TEXT, text TEXT, status TEXT,
      confidence REAL, importance INTEGER, valid_from TEXT, valid_to TEXT,
      source TEXT, supersedes TEXT, path TEXT
    );
  `);
  db.prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES ('schema', ?)`).run(SCHEMA_VERSION);
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
