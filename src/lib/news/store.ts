import crypto from "node:crypto";
import { getDb } from "../index/db";
import type { FeedItem } from "./rss";

/** 资讯缓存表：和 vault 索引共用一个 SQLite，但不参与索引重建 */
let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS news_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        summary TEXT,
        author TEXT,
        published_at TEXT,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS news_items_time ON news_items(published_at);
      CREATE TABLE IF NOT EXISTS news_sources_state (
        source_id TEXT PRIMARY KEY,
        last_fetch TEXT, last_ok TEXT, last_error TEXT, item_count INTEGER DEFAULT 0
      );
    `);
    // 中文译文（旧表补列）
    for (const col of ["title_zh", "summary_zh"]) { try { d.exec(`ALTER TABLE news_items ADD COLUMN ${col} TEXT`); } catch { /* 已存在 */ } }
    ready = true;
  }
  return d;
}

export interface NewsItem { id: string; source_id: string; title: string; url: string; summary: string | null; author: string | null; published_at: string | null; fetched_at: string; title_zh: string | null; summary_zh: string | null }
export interface SourceState { source_id: string; last_fetch: string | null; last_ok: string | null; last_error: string | null; item_count: number }

const idOf = (url: string) => crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);

export function saveItems(sourceId: string, items: FeedItem[]) {
  const d = db();
  const now = new Date().toISOString();
  const stmt = d.prepare(`INSERT INTO news_items (id, source_id, title, url, summary, author, published_at, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary`);
  let created = 0;
  for (const it of items) {
    const id = idOf(it.url);
    const exists = d.prepare(`SELECT 1 FROM news_items WHERE id=?`).get(id);
    // 没有发布时间的条目用首次抓到的时间
    stmt.run(id, sourceId, it.title, it.url, it.summary || null, it.author, it.publishedAt ?? now, now);
    if (!exists) created++;
  }
  return created;
}

export function setSourceState(sourceId: string, ok: boolean, error?: string) {
  const now = new Date().toISOString();
  const count = (db().prepare(`SELECT COUNT(*) AS n FROM news_items WHERE source_id=?`).get(sourceId) as { n: number }).n;
  db().prepare(`INSERT INTO news_sources_state (source_id, last_fetch, last_ok, last_error, item_count) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET last_fetch=excluded.last_fetch, last_ok=COALESCE(excluded.last_ok, news_sources_state.last_ok), last_error=excluded.last_error, item_count=excluded.item_count`)
    .run(sourceId, now, ok ? now : null, ok ? null : (error ?? "未知错误").slice(0, 300), count);
}

export function sourceStates(): Record<string, SourceState> {
  const rows = db().prepare(`SELECT * FROM news_sources_state`).all() as unknown as SourceState[];
  return Object.fromEntries(rows.map((r) => [r.source_id, r]));
}

export function listItems(opts: { sourceIds?: string[]; sinceDays?: number; limit?: number } = {}): NewsItem[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.sourceIds) {
    if (!opts.sourceIds.length) return [];
    where.push(`source_id IN (${opts.sourceIds.map(() => "?").join(",")})`);
    args.push(...opts.sourceIds);
  }
  if (opts.sinceDays) { where.push(`published_at >= ?`); args.push(new Date(Date.now() - opts.sinceDays * 864e5).toISOString()); }
  args.push(opts.limit ?? 300);
  return db().prepare(`SELECT * FROM news_items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY published_at DESC LIMIT ?`).all(...args) as unknown as NewsItem[];
}

/** 只保留最近 30 天，避免无限增长 */
export function pruneOld() {
  db().prepare(`DELETE FROM news_items WHERE published_at < ?`).run(new Date(Date.now() - 30 * 864e5).toISOString());
}

const CJK = /[\u4e00-\u9fff]/;
export const isChinese = (t: string) => (t.match(/[\u4e00-\u9fff]/g)?.length ?? 0) >= Math.min(4, t.length / 4) && CJK.test(t);

/** 还没翻译的外文条目：优先 ids 里的（页面上正在看的），其余按新到旧 */
export function untranslated(limit: number, ids: string[] = [], onlyIds = false) {
  const pick = (sql: string, ...args: (string | number)[]) => db().prepare(sql).all(...args) as unknown as Pick<NewsItem, "id" | "title" | "summary">[];
  const first = ids.length ? pick(`SELECT id, title, summary FROM news_items WHERE title_zh IS NULL AND id IN (${ids.map(() => "?").join(",")})`, ...ids) : [];
  const rest = onlyIds ? [] : pick(`SELECT id, title, summary FROM news_items WHERE title_zh IS NULL ORDER BY published_at DESC LIMIT ?`, limit * 2);
  const seen = new Set<string>();
  return [...first, ...rest]
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      if (isChinese(r.title)) { db().prepare(`UPDATE news_items SET title_zh=title, summary_zh=summary WHERE id=?`).run(r.id); return false; }
      return true;
    })
    .slice(0, limit);
}

export function saveTranslation(id: string, title: string, summary: string | null) {
  db().prepare(`UPDATE news_items SET title_zh=?, summary_zh=? WHERE id=?`).run(title, summary, id);
}
