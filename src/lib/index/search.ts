import { getDb } from "./db";
import { embedTexts } from "../llm/client";
import { embeddingModelKey, blobToVec, dot, normalize } from "./embed";
import { dateStr } from "../core/util";

export interface SearchHit {
  path: string;
  title: string;
  type: string;
  date: string | null;
  heading: string;
  snippet: string;
  score: number;
  private: boolean;
  signals: { keyword: number; vector: number; recency: number };
}

export interface SearchOpts {
  limit?: number;
  types?: string[];
  includePrivate?: boolean;
  /** 只看某日期之后 */
  since?: string;
  /** 是否尝试向量检索（嵌入服务不可用时自动降级） */
  vector?: boolean;
}

const TYPE_BOOST: Record<string, number> = { session: -0.05, skill: -0.05, now: 0.15, facts: 0.12, profile: 0.08, preferences: 0.06, plan: 0.05, review: 0.04 };

function terms(q: string) {
  return [...new Set(q.toLowerCase().split(/[\s,，。.、;；:：!?！？"'“”‘’()（）]+/).map((t) => t.trim()).filter(Boolean))].slice(0, 12);
}

/**
 * 混合检索：关键词（FTS5 trigram + 短词 LIKE）+ 向量（余弦）+ 时间衰减 + 类型加权。
 * 以文本块为单位打分，再按文件聚合取最高分。
 */
export async function search(query: string, opts: SearchOpts = {}): Promise<SearchHit[]> {
  const db = getDb();
  const limit = opts.limit ?? 8;
  const ts = terms(query);
  const kw = new Map<number, number>();

  // 1) FTS：≥3 字的词
  const long = ts.filter((t) => [...t].length >= 3);
  if (long.length) {
    const match = long.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
    try {
      const rows = db.prepare(`SELECT rowid id, bm25(chunks_fts) s FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY s LIMIT 200`).all(match) as { id: number; s: number }[];
      for (const r of rows) kw.set(r.id, Math.max(kw.get(r.id) ?? 0, -r.s));
    } catch { /* 查询语法异常时忽略 */ }
  }
  // 2) 短词 LIKE（中文两字词很常见，比如"睡眠""考研"）
  const short = ts.filter((t) => [...t].length < 3);
  for (const t of short) {
    const rows = db.prepare(`SELECT id FROM chunks WHERE text LIKE ? LIMIT 300`).all(`%${t}%`) as { id: number }[];
    for (const r of rows) kw.set(r.id, (kw.get(r.id) ?? 0) + 1);
  }
  const maxKw = Math.max(1e-9, ...kw.values());

  // 3) 向量
  const vec = new Map<number, number>();
  const model = embeddingModelKey();
  if (opts.vector !== false && model) {
    try {
      const { vectors } = await embedTexts([query]);
      const q = normalize(Float32Array.from(vectors[0]));
      const rows = db.prepare(`SELECT c.id, e.vec FROM chunks c JOIN embeddings e ON e.chunk_hash=c.hash AND e.model=?`).all(model) as { id: number; vec: Uint8Array }[];
      for (const r of rows) {
        const s = dot(q, blobToVec(r.vec));
        if (s > 0.3) vec.set(r.id, s);
      }
    } catch { /* 嵌入服务不可用：只用关键词 */ }
  }

  const ids = new Set([...kw.keys(), ...[...vec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id)]);
  if (!ids.size) return [];

  const idList = [...ids];
  const rows: { id: number; path: string; heading: string; text: string; type: string; title: string; date: string | null; private: number }[] = [];
  for (let i = 0; i < idList.length; i += 500) {
    const part = idList.slice(i, i + 500);
    rows.push(...(db.prepare(`SELECT c.id, c.path, c.heading, c.text, n.type, n.title, n.date, n.private
      FROM chunks c JOIN notes n ON n.path=c.path WHERE c.id IN (${part.map(() => "?").join(",")})`).all(...part) as typeof rows));
  }

  const today = dateStr();
  const hasVec = vec.size > 0;
  const byPath = new Map<string, SearchHit>();
  for (const r of rows) {
    if (!opts.includePrivate && r.private) continue;
    if (opts.types?.length && !opts.types.includes(r.type)) continue;
    if (opts.since && r.date && r.date < opts.since) continue;
    const k = (kw.get(r.id) ?? 0) / maxKw;
    const v = vec.get(r.id) ?? 0;
    const ageDays = r.date ? Math.max(0, (Date.parse(today) - Date.parse(r.date)) / 864e5) : 365;
    const recency = Math.exp(-ageDays / 90);
    const score = (hasVec ? 0.45 * k + 0.45 * v : 0.9 * k) + 0.1 * recency + (TYPE_BOOST[r.type] ?? 0);
    const prev = byPath.get(r.path);
    if (!prev || score > prev.score) {
      byPath.set(r.path, {
        path: r.path, title: r.title, type: r.type, date: r.date, heading: r.heading,
        snippet: r.text.slice(0, 400), score, private: !!r.private,
        signals: { keyword: +k.toFixed(3), vector: +v.toFixed(3), recency: +recency.toFixed(3) },
      });
    }
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---------- 结构化查询：指标 ---------- */
export function queryMetrics(keys: string[], from: string, to: string) {
  const db = getDb();
  const rows = db.prepare(`SELECT date, key, value FROM metrics WHERE date BETWEEN ? AND ? AND key IN (${keys.map(() => "?").join(",")}) ORDER BY date`)
    .all(from, to, ...keys) as { date: string; key: string; value: number }[];
  const series: Record<string, Record<string, number>> = {};
  for (const r of rows) (series[r.date] ??= {})[r.key] = r.value;
  const points = Object.entries(series).map(([date, v]) => ({ date, ...v }));
  const stats: Record<string, { avg: number; min: number; max: number; n: number }> = {};
  for (const k of keys) {
    const vals = rows.filter((r) => r.key === k).map((r) => r.value);
    if (vals.length) stats[k] = { avg: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2), min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
  }
  return { from, to, keys, points, stats };
}

export function listNotes(opts: { type?: string; domain?: string; status?: string; since?: string; until?: string; limit?: number; includePrivate?: boolean } = {}) {
  const db = getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.type) { where.push("type=?"); args.push(opts.type); }
  if (opts.domain) { where.push("domain=?"); args.push(opts.domain); }
  if (opts.status) { where.push("status=?"); args.push(opts.status); }
  if (opts.since) { where.push("date>=?"); args.push(opts.since); }
  if (opts.until) { where.push("date<=?"); args.push(opts.until); }
  if (!opts.includePrivate) where.push("private=0");
  const sql = `SELECT path, type, title, date, domain, status, fm FROM notes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date DESC, path LIMIT ?`;
  args.push(opts.limit ?? 50);
  return (db.prepare(sql).all(...args) as { path: string; type: string; title: string; date: string | null; domain: string | null; status: string | null; fm: string }[])
    .map((r) => ({ ...r, fm: JSON.parse(r.fm || "{}") as Record<string, unknown> }));
}

export function listFacts(opts: { domain?: string; status?: string } = {}) {
  const db = getDb();
  const where: string[] = [];
  const args: string[] = [];
  if (opts.domain) { where.push("domain=?"); args.push(opts.domain); }
  if (opts.status) { where.push("status=?"); args.push(opts.status); }
  return db.prepare(`SELECT * FROM facts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY importance DESC, valid_from DESC`).all(...args) as {
    id: string; domain: string; text: string; status: string; confidence: number; importance: number; valid_from: string; valid_to: string | null; source: string | null; supersedes: string | null; path: string;
  }[];
}
