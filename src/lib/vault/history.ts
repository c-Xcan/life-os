/*
 * 内置历史版本与回收站（替代 git，不依赖任何外部程序）
 *
 *   .app/history/<文件路径>/<时间戳>.md   修改前的旧版本（30 分钟内的连续修改只存一份）
 *   .app/history/log.jsonl                每次修改的记录（谁、什么时候、改了什么）
 *   .app/trash/<id>/<文件名>              删除的文件，30 天后自动清理
 *   .app/trash/index.json                 回收站清单（原路径、删除时间、照片元数据）
 */
import fs from "node:fs";
import path from "node:path";
import { appPath, ensureDir, resolveInVault, toRel } from "../core/paths";
import { getSettings } from "../core/settings";

const MERGE_MS = 30 * 60 * 1000;   // 30 分钟内的连续修改合并为一个版本
const KEEP_MIN = 3;                // 每个文件至少保留最近 3 个版本（不论多久）
const TRASH_DAYS = 30;

const HIST = () => appPath("history");
const LOG = () => appPath("history", "log.jsonl");
const TRASH = () => appPath("trash");
const TRASH_INDEX = () => appPath("trash", "index.json");

export type Actor = "user" | "agent" | "system";
export type LogEntry = { t: number; path: string; actor: Actor; reason: string; kind: "create" | "edit" | "delete" | "restore" };
export type Version = { id: string; at: string; size: number };
export type TrashItem = { id: string; path: string; name: string; deletedAt: string; size: number; actor: Actor; reason: string; meta?: unknown };

const enabled = () => { try { return getSettings().history.enabled; } catch { return true; } };
const versionDir = (rel: string) => path.join(/*turbopackIgnore: true*/ HIST(), ...rel.split("/"));

/* ---------------- 历史版本 ---------------- */

/** 写入前调用：把旧内容存为一个版本（30 分钟内已存过就跳过，除非 force） */
export function snapshotBeforeWrite(rel: string, nextRaw: string, force = false) {
  if (!enabled() || !rel.endsWith(".md")) return;
  const abs = resolveInVault(rel);
  if (!fs.existsSync(abs)) return;
  const prev = fs.readFileSync(abs, "utf8");
  if (prev === nextRaw) return;
  const dir = versionDir(rel);
  if (!force) {
    const latest = listVersionIds(rel)[0];
    if (latest && Date.now() - Number(latest) < MERGE_MS) return;
  }
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${Date.now()}.md`), prev, "utf8");
}

function listVersionIds(rel: string) {
  const dir = versionDir(rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /^\d+\.md$/.test(n)).map((n) => n.slice(0, -3)).sort((a, b) => Number(b) - Number(a));
}

export function listVersions(rel: string): Version[] {
  return listVersionIds(rel).map((id) => ({ id, at: new Date(Number(id)).toISOString(), size: fs.statSync(path.join(versionDir(rel), `${id}.md`)).size }));
}

export function readVersion(rel: string, id: string) {
  if (!/^\d+$/.test(id)) throw new Error("版本号不合法");
  resolveInVault(rel); // 校验路径不越界
  const f = path.join(versionDir(rel), `${id}.md`);
  if (!fs.existsSync(f)) throw new Error("这个版本已经不存在了");
  return fs.readFileSync(f, "utf8");
}

/** 记录一次修改（设置页「最近的修改」用） */
export function logChange(e: Omit<LogEntry, "t">) {
  if (!enabled() || e.path.startsWith("sessions/")) return;
  ensureDir(HIST());
  fs.appendFileSync(LOG(), JSON.stringify({ t: Date.now(), ...e }) + "\n", "utf8");
}

export function recentChanges(limit = 40): LogEntry[] {
  if (!fs.existsSync(LOG())) return [];
  const lines = fs.readFileSync(LOG(), "utf8").trim().split("\n").filter(Boolean);
  const out: LogEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) { try { out.push(JSON.parse(lines[i])); } catch { /* 跳过坏行 */ } }
  return out;
}

/* ---------------- 回收站 ---------------- */

function readTrash(): TrashItem[] { try { return JSON.parse(fs.readFileSync(TRASH_INDEX(), "utf8")); } catch { return []; } }
function writeTrash(items: TrashItem[]) { ensureDir(TRASH()); fs.writeFileSync(TRASH_INDEX(), JSON.stringify(items, null, 2), "utf8"); }

/** 跨盘符时 rename 会失败：退回复制 + 删除 */
function move(from: string, to: string) {
  ensureDir(path.dirname(to));
  try { fs.renameSync(from, to); } catch { fs.copyFileSync(from, to); fs.unlinkSync(from); }
}

/** 把 vault 里的文件移进回收站（代替直接删除） */
export function moveToTrash(rel: string, o: { actor?: Actor; reason?: string; meta?: unknown } = {}) {
  const abs = resolveInVault(rel);
  if (!fs.existsSync(abs)) return null;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const name = path.basename(abs);
  const size = fs.statSync(abs).size;
  move(abs, path.join(TRASH(), id, name));
  const item: TrashItem = { id, path: toRel(abs), name, deletedAt: new Date().toISOString(), size, actor: o.actor ?? "user", reason: o.reason ?? `delete ${rel}`, meta: o.meta };
  writeTrash([item, ...readTrash()]);
  logChange({ path: item.path, actor: item.actor, reason: item.reason, kind: "delete" });
  return item;
}

export function listTrash(): TrashItem[] {
  return readTrash().filter((x) => fs.existsSync(path.join(TRASH(), x.id, x.name)));
}

/** 从回收站恢复：原位置被占用时自动改名；返回恢复后的路径和元数据 */
export function restoreFromTrash(id: string) {
  const items = readTrash();
  const item = items.find((x) => x.id === id);
  if (!item) throw new Error("回收站里没有这一项");
  const src = path.join(TRASH(), item.id, item.name);
  if (!fs.existsSync(src)) throw new Error("文件已经被清理了");
  let rel = item.path;
  const ext = path.extname(rel), base = rel.slice(0, rel.length - ext.length);
  for (let i = 1; fs.existsSync(resolveInVault(rel)); i++) rel = `${base} (恢复${i > 1 ? i : ""})${ext}`;
  move(src, resolveInVault(rel));
  fs.rmSync(path.join(TRASH(), item.id), { recursive: true, force: true });
  writeTrash(items.filter((x) => x.id !== id));
  logChange({ path: rel, actor: "user", reason: `restore ${rel}`, kind: "restore" });
  return { path: rel, meta: item.meta };
}

export function purgeTrash(id?: string) {
  const items = readTrash();
  const gone = id ? items.filter((x) => x.id === id) : items;
  for (const x of gone) fs.rmSync(path.join(TRASH(), x.id), { recursive: true, force: true });
  writeTrash(id ? items.filter((x) => x.id !== id) : []);
  return gone.length;
}

/* ---------------- 清理与统计 ---------------- */

function walkFiles(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out); else out.push(p);
  }
  return out;
}

/** 启动时 / 每天调用：删除过期版本（保留每个文件最近 3 个）、过期回收站、过长的修改记录 */
export function pruneHistory() {
  let keepDays = 90;
  try { keepDays = getSettings().history.keepDays; } catch { /* 默认 */ }
  const cutoff = Date.now() - keepDays * 864e5;
  // 版本：按目录分组（每个目录 = 一个文件的所有版本）
  const byDir = new Map<string, string[]>();
  for (const f of walkFiles(HIST())) {
    if (!/[\\/]\d+\.md$/.test(f)) continue;
    const d = path.dirname(f);
    byDir.set(d, [...(byDir.get(d) ?? []), f]);
  }
  for (const files of byDir.values()) {
    files.sort((a, b) => Number(path.basename(b, ".md")) - Number(path.basename(a, ".md")));
    files.slice(KEEP_MIN).forEach((f) => { if (Number(path.basename(f, ".md")) < cutoff) fs.rmSync(f, { force: true }); });
  }
  // 回收站
  const tCut = Date.now() - TRASH_DAYS * 864e5;
  const items = readTrash();
  const keep = items.filter((x) => new Date(x.deletedAt).getTime() >= tCut);
  for (const x of items) if (!keep.includes(x)) fs.rmSync(path.join(TRASH(), x.id), { recursive: true, force: true });
  if (keep.length !== items.length) writeTrash(keep);
  // 修改记录：只留保留期内的
  if (fs.existsSync(LOG())) {
    const lines = fs.readFileSync(LOG(), "utf8").split("\n").filter((l) => { try { return JSON.parse(l).t >= cutoff; } catch { return false; } });
    fs.writeFileSync(LOG(), lines.length ? lines.join("\n") + "\n" : "", "utf8");
  }
}

export function historyStats() {
  const files = walkFiles(HIST()).filter((f) => /[\\/]\d+\.md$/.test(f));
  const trash = listTrash();
  const size = (fs_: string[]) => fs_.reduce((n, f) => n + fs.statSync(f).size, 0);
  return {
    versions: files.length,
    versionBytes: size(files),
    trashItems: trash.length,
    trashBytes: trash.reduce((n, x) => n + x.size, 0),
    keepDays: (() => { try { return getSettings().history.keepDays; } catch { return 90; } })(),
    trashDays: TRASH_DAYS,
    enabled: enabled(),
  };
}
