import fs from "node:fs";
import { getDb, tx } from "./db";
import { listMarkdown, readNote } from "../vault/fs";
import { resolveInVault, VAULT_DIR, toRel } from "../core/paths";
import { sha1 } from "../core/util";
import { JOURNAL_METRICS, FactSchema } from "../vault/schema";
import { embedPending } from "./embed";

/** 不进索引的目录 */
const SKIP = [/^_templates\//, /^exports\//, /^attachments\//];
export const shouldIndex = (rel: string) => rel.endsWith(".md") && !SKIP.some((r) => r.test(rel));

export interface Chunk { ord: number; heading: string; text: string }

/** 按标题切块，超长段落再按字数切 */
export function chunkMarkdown(body: string, title = "", max = 700): Chunk[] {
  const lines = body.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const sections: { heading: string; text: string[] }[] = [{ heading: title, text: [] }];
  for (const l of lines) {
    const m = /^(#{1,3})\s+(.*)$/.exec(l);
    if (m) sections.push({ heading: m[2].trim(), text: [] });
    else sections[sections.length - 1].text.push(l);
  }
  const out: Chunk[] = [];
  for (const s of sections) {
    const text = s.text.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) continue;
    const paras = text.split(/\n\n+/);
    let buf = "";
    const flush = () => { if (buf.trim()) out.push({ ord: out.length, heading: s.heading, text: buf.trim() }); buf = ""; };
    for (const p of paras) {
      if ((buf + "\n\n" + p).length > max && buf) flush();
      if (p.length > max) {
        for (let i = 0; i < p.length; i += max) { buf = p.slice(i, i + max); flush(); }
      } else buf = buf ? `${buf}\n\n${p}` : p;
    }
    flush();
  }
  return out;
}

const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));

export function indexFile(rel: string): "indexed" | "removed" | "skipped" | "unchanged" {
  const db = getDb();
  if (!shouldIndex(rel)) return "skipped";
  const abs = resolveInVault(rel);
  if (!fs.existsSync(abs)) {
    tx(db, () => {
      db.prepare("DELETE FROM chunks WHERE path=?").run(rel);
      db.prepare("DELETE FROM metrics WHERE path=?").run(rel);
      db.prepare("DELETE FROM facts WHERE path=?").run(rel);
      db.prepare("DELETE FROM notes WHERE path=?").run(rel);
    });
    return "removed";
  }
  const note = readNote(rel)!;
  const hash = sha1(note.raw);
  const prev = db.prepare("SELECT hash FROM notes WHERE path=?").get(rel) as { hash?: string } | undefined;
  if (prev?.hash === hash) return "unchanged";

  const fm = note.fm;
  const type = str(fm.type) ?? inferType(rel);
  const title = str(fm.title) ?? (/^#\s+(.+)$/m.exec(note.body)?.[1] ?? rel.split("/").pop()!.replace(/\.md$/, ""));
  const date = str(fm.date) ?? str(fm.start) ?? str(fm.updated) ?? str(fm.created);
  const domain = str(fm.domain);
  const status = str(fm.status);
  const isPrivate = fm.private === true ? 1 : 0;

  tx(db, () => {
    db.prepare("DELETE FROM chunks WHERE path=?").run(rel);
    db.prepare("DELETE FROM metrics WHERE path=?").run(rel);
    db.prepare("DELETE FROM facts WHERE path=?").run(rel);
    db.prepare(`INSERT INTO notes(path,type,title,date,domain,status,tags,fm,body,hash,mtime,private)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(path) DO UPDATE SET type=excluded.type,title=excluded.title,date=excluded.date,domain=excluded.domain,
      status=excluded.status,tags=excluded.tags,fm=excluded.fm,body=excluded.body,hash=excluded.hash,mtime=excluded.mtime,private=excluded.private`)
      .run(rel, type, title, date, domain, status, JSON.stringify(fm.tags ?? []), JSON.stringify(fm), note.body, hash, note.mtime, isPrivate);

    const ins = db.prepare("INSERT INTO chunks(path,ord,heading,text,hash) VALUES (?,?,?,?,?)");
    const factsText = type === "facts" ? factsToText(fm) : "";
    for (const c of chunkMarkdown(type === "facts" ? factsText : note.body, title)) {
      const text = `${title}${c.heading && c.heading !== title ? " › " + c.heading : ""}\n${c.text}`;
      ins.run(rel, c.ord, c.heading, text, sha1(text));
    }

    if (type === "journal" && date) {
      const im = db.prepare("INSERT OR REPLACE INTO metrics(date,key,value,path) VALUES (?,?,?,?)");
      for (const k of Object.keys(JOURNAL_METRICS)) {
        const v = fm[k];
        if (v !== undefined && v !== null && v !== "" && !Number.isNaN(Number(v))) im.run(date, k, Number(v), rel);
      }
    }

    if (type === "facts" && Array.isArray(fm.facts)) {
      const ifa = db.prepare(`INSERT OR REPLACE INTO facts(id,domain,text,status,confidence,importance,valid_from,valid_to,source,supersedes,path)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      for (const raw of fm.facts) {
        const f = FactSchema.safeParse(raw);
        if (!f.success) continue;
        const x = f.data;
        ifa.run(x.id, domain ?? "life", x.text, x.status, x.confidence, x.importance, x.valid_from, x.valid_to ?? null, x.source ?? null, x.supersedes ?? null, rel);
      }
    }
  });
  return "indexed";
}

function factsToText(fm: Record<string, unknown>) {
  const facts = Array.isArray(fm.facts) ? fm.facts : [];
  return facts
    .filter((f: { status?: string }) => (f?.status ?? "active") === "active")
    .map((f: { text?: string; valid_from?: string }) => `- ${f.text}（自 ${f.valid_from ?? "?"}）`)
    .join("\n");
}

function inferType(rel: string) {
  if (rel.startsWith("journal/")) return "journal";
  if (rel.startsWith("plans/")) return "plan";
  if (rel.startsWith("reviews/")) return "review";
  if (rel.startsWith("sessions/")) return "session";
  if (rel.startsWith("domains/")) return "domain";
  if (rel.startsWith("profile/")) return "profile";
  if (rel.startsWith("skills/")) return "skill";
  if (rel.startsWith("memory/facts/")) return "facts";
  return "note";
}

/** 全量扫描：只重建变化的文件，并清理已删除的文件 */
export function reindexAll() {
  const db = getDb();
  const files = listMarkdown().filter(shouldIndex);
  const seen = new Set(files);
  const stats = { indexed: 0, unchanged: 0, removed: 0 };
  for (const f of files) {
    const r = indexFile(f);
    if (r === "indexed") stats.indexed++;
    else if (r === "unchanged") stats.unchanged++;
  }
  const known = db.prepare("SELECT path FROM notes").all() as { path: string }[];
  for (const { path } of known) if (!seen.has(path)) { indexFile(path); stats.removed++; }
  return stats;
}

export function indexStatus() {
  const db = getDb();
  const q = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    vault: VAULT_DIR,
    notes: q("SELECT COUNT(*) n FROM notes"),
    chunks: q("SELECT COUNT(*) n FROM chunks"),
    embeddings: q("SELECT COUNT(*) n FROM embeddings"),
    journals: q("SELECT COUNT(*) n FROM notes WHERE type='journal'"),
    facts: q("SELECT COUNT(*) n FROM facts WHERE status='active'"),
  };
}

/* ---------- 文件监听（单例） ---------- */
const g = globalThis as unknown as { __lifeosWatcher?: { close: () => Promise<void> }; __lifeosIndexReady?: Promise<void> };

export function ensureIndexReady(): Promise<void> {
  if (!g.__lifeosIndexReady) {
    g.__lifeosIndexReady = (async () => {
      reindexAll();
      void embedPending().catch(() => {});
      await startWatcher();
    })();
  }
  return g.__lifeosIndexReady;
}

async function startWatcher() {
  if (g.__lifeosWatcher) return;
  try {
    const chokidar = await import("chokidar");
    let timer: NodeJS.Timeout | null = null;
    const dirty = new Set<string>();
    const w = chokidar.watch(VAULT_DIR, {
      ignoreInitial: true,
      ignored: (p: string) => /[\\/](\.git|node_modules|\.obsidian|\.trash)([\\/]|$)/.test(p),
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });
    const on = (abs: string) => {
      const rel = toRel(abs);
      if (!shouldIndex(rel)) return;
      dirty.add(rel);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const r of dirty) { try { indexFile(r); } catch { /* 忽略单个文件错误 */ } }
        dirty.clear();
        void embedPending().catch(() => {});
      }, 400);
    };
    w.on("add", on).on("change", on).on("unlink", on);
    g.__lifeosWatcher = w;
  } catch (e) {
    console.warn("[life-os] 文件监听启动失败，将仅在应用内写入时更新索引：", e);
  }
}

/** 暂停文件监听（导入备份时先停，避免边写边索引） */
export async function stopWatcher() {
  const w = g.__lifeosWatcher;
  g.__lifeosWatcher = undefined;
  if (w) await w.close().catch(() => {});
}

/** 重新扫描整个 vault 并重启文件监听（导入备份后调用） */
export async function restartIndex() {
  await stopWatcher();
  g.__lifeosIndexReady = undefined;
  await ensureIndexReady();
  return indexStatus();
}
