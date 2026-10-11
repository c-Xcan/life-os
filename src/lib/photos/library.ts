import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { VAULT_DIR, resolveInVault, toRel } from "../core/paths";
import { listMarkdown, writeRaw } from "../vault/fs";
import { vaultEvents } from "../vault/events";
import { moveToTrash } from "../vault/history";

/*
 * 照片库
 * - 图片文件：vault/attachments/**（日记和相册共用）
 * - 元数据：vault/photos/library.json（相册、描述、标签、拍摄时间、位置）
 * - 日记照片：从日记正文的 ![描述](attachments/...) 自动识别，不需要另存
 */

export interface Album { id: string; name: string; created: string }
export interface PhotoMeta {
  caption?: string;
  tags?: string[];
  albums?: string[];
  takenAt?: string; // 本地时间 YYYY-MM-DDTHH:mm:ss
  lat?: number;     // WGS-84
  lng?: number;
  added?: string;
}
export interface Library { albums: Album[]; photos: Record<string, PhotoMeta> }

export interface Photo {
  path: string;
  caption: string;
  tags: string[];
  albums: string[];
  date: string;          // YYYY-MM-DD，用于分组
  takenAt?: string;
  lat?: number;
  lng?: number;
  journals: string[];    // 引用这张图的日记日期
  size: number;
  mtime: string;
}

const LIB = "photos/library.json";
const IMG_EXT = /\.(webp|png|jpe?g|gif)$/i;
const MD_IMG = /!\[([^\]]*)\]\((attachments\/[^)\s]+)\)/g;

export function readLibrary(): Library {
  try {
    const raw = JSON.parse(fs.readFileSync(resolveInVault(LIB), "utf8"));
    return { albums: Array.isArray(raw.albums) ? raw.albums : [], photos: raw.photos && typeof raw.photos === "object" ? raw.photos : {} };
  } catch {
    return { albums: [], photos: {} };
  }
}

export function writeLibrary(lib: Library, reason: string) {
  writeRaw(LIB, JSON.stringify(lib, null, 2) + "\n", { reason });
}

export function updateLibrary(reason: string, fn: (lib: Library) => void) {
  const lib = readLibrary();
  fn(lib);
  writeLibrary(lib, reason);
  return lib;
}

/** 日记里引用的图片：path → { 日期列表, 描述 } */
function journalRefs() {
  const refs = new Map<string, { dates: string[]; caption: string }>();
  for (const rel of listMarkdown("journal")) {
    const date = /(\d{4}-\d{2}-\d{2})\.md$/.exec(rel)?.[1];
    if (!date) continue;
    const text = fs.readFileSync(resolveInVault(rel), "utf8");
    for (const m of text.matchAll(MD_IMG)) {
      const r = refs.get(m[2]) ?? { dates: [], caption: "" };
      if (!r.dates.includes(date)) r.dates.push(date);
      if (!r.caption && m[1].trim()) r.caption = m[1].trim();
      refs.set(m[2], r);
    }
  }
  return refs;
}

/**
 * 日记照片只能在日记里管理：不能删除、不能调整相册。
 * 传入的路径里只要有日记引用的，就拒绝整个操作。
 */
function assertNotJournal(rels: string[]) {
  const refs = journalRefs();
  const locked = rels.filter((r) => refs.has(r));
  if (locked.length) throw new Error(`有 ${locked.length} 张是日记照片，只能在日记里修改或删除`);
}

function walkImages(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkImages(abs, out);
    else if (IMG_EXT.test(e.name)) out.push(toRel(abs));
  }
  return out;
}

/** 所有照片（按时间倒序）+ 相册 */
export function listPhotos() {
  const lib = readLibrary();
  const refs = journalRefs();
  const photos: Photo[] = [];
  for (const rel of walkImages(path.join(VAULT_DIR, "attachments"))) {
    const st = fs.statSync(resolveInVault(rel));
    const meta = lib.photos[rel] ?? {};
    const ref = refs.get(rel);
    const fileDate = /(\d{4}-\d{2}-\d{2})-/.exec(path.basename(rel))?.[1];
    const date = meta.takenAt?.slice(0, 10) ?? ref?.dates[0] ?? fileDate ?? st.mtime.toISOString().slice(0, 10);
    photos.push({
      path: rel,
      caption: ref?.caption || meta.caption || "",
      tags: meta.tags ?? [],
      // 日记照片只归属「日记」分类，不进相册
      albums: ref ? [] : (meta.albums ?? []).filter((id) => lib.albums.some((a) => a.id === id)),
      date,
      takenAt: meta.takenAt,
      lat: meta.lat,
      lng: meta.lng,
      journals: ref?.dates.sort() ?? [],
      size: st.size,
      mtime: st.mtime.toISOString(),
    });
  }
  photos.sort((a, b) => (b.takenAt ?? b.date).localeCompare(a.takenAt ?? a.date) || b.mtime.localeCompare(a.mtime));
  return { albums: lib.albums, photos };
}

/* ---------- 相册 ---------- */

export function createAlbum(name: string) {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error("相册名称不能为空");
  const album: Album = { id: `a${crypto.randomBytes(4).toString("hex")}`, name: clean, created: new Date().toISOString() };
  updateLibrary(`photos: create album ${clean}`, (lib) => {
    if (lib.albums.some((a) => a.name === clean)) throw new Error("已经有同名相册");
    lib.albums.push(album);
  });
  return album;
}

export function renameAlbum(id: string, name: string) {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error("相册名称不能为空");
  updateLibrary(`photos: rename album ${clean}`, (lib) => {
    const a = lib.albums.find((x) => x.id === id);
    if (!a) throw new Error("相册不存在");
    a.name = clean;
  });
}

/** 删除相册：只删分组，不删照片 */
export function deleteAlbum(id: string) {
  updateLibrary("photos: delete album", (lib) => {
    lib.albums = lib.albums.filter((a) => a.id !== id);
    for (const m of Object.values(lib.photos)) if (m.albums) m.albums = m.albums.filter((x) => x !== id);
  });
}

export function setAlbumMembership(paths: string[], album: string, add: boolean) {
  assertNotJournal(paths.map(checkAttachment));
  updateLibrary(add ? "photos: add to album" : "photos: remove from album", (lib) => {
    if (!lib.albums.some((a) => a.id === album)) throw new Error("相册不存在");
    for (const p of paths) {
      const m = (lib.photos[p] ??= {});
      const set = new Set(m.albums ?? []);
      if (add) set.add(album); else set.delete(album);
      m.albums = [...set];
    }
  });
}

/* ---------- 照片 ---------- */

function checkAttachment(p: string) {
  const rel = p.replace(/\\/g, "/");
  if (!rel.startsWith("attachments/") || rel.split("/").includes("..")) throw new Error("路径不合法");
  return rel;
}

/** 改描述：同时改日记里的 alt，保持一致 */
export function setCaption(p: string, caption: string) {
  const rel = checkAttachment(p);
  const text = caption.replace(/[[\]\n]/g, " ").trim().slice(0, 120);
  updateLibrary("photos: caption", (lib) => { (lib.photos[rel] ??= {}).caption = text; });
  const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const md of listMarkdown("journal")) {
    const abs = resolveInVault(md);
    const raw = fs.readFileSync(abs, "utf8");
    const next = raw.replace(new RegExp(`!\\[[^\\]]*\\]\\(${esc}\\)`, "g"), `![${text}](${rel})`);
    if (next !== raw) writeRaw(md, next, { reason: `photo caption ${path.basename(md)}` });
  }
}

/** 删除照片：文件移进回收站（连同相册、描述等元数据，恢复时一起还原），并从引用它的日记里移除 */
export function deletePhotos(paths: string[]) {
  const rels = paths.map(checkAttachment);
  assertNotJournal(rels);
  const set = new Set(rels);
  for (const md of listMarkdown("journal")) {
    const abs = resolveInVault(md);
    const raw = fs.readFileSync(abs, "utf8");
    const next = raw
      .split("\n")
      .filter((line) => !rels.some((r) => line.includes(`](${r})`)))
      .join("\n")
      .replace(/\n## 照片\n+(?=## |\s*$)/g, "\n") // 照片小节空了就去掉标题
      .replace(/\n{3,}/g, "\n\n");
    if (next !== raw) writeRaw(md, next, { reason: `remove photos from ${path.basename(md)}` });
  }
  const lib = readLibrary();
  for (const r of rels) {
    moveToTrash(r, { reason: `delete ${r}`, meta: lib.photos[r] ? { photo: lib.photos[r] } : undefined });
    vaultEvents.emit("written", { path: r, reason: `delete ${r}`, actor: "user" });
  }
  updateLibrary("photos: delete", (lib) => { for (const r of set) delete lib.photos[r]; });
}

/** 从回收站恢复照片后，把元数据还原回照片库 */
export function restorePhotoMeta(rel: string, meta: unknown) {
  const m = (meta as { photo?: PhotoMeta } | undefined)?.photo;
  if (!m) return;
  updateLibrary(`photos: restore ${path.basename(rel)}`, (lib) => { lib.photos[rel] = { ...m }; });
}

/** 上传后记录元数据 */
export function recordUpload(rel: string, meta: PhotoMeta) {
  updateLibrary(`photos: add ${path.basename(rel)}`, (lib) => {
    lib.photos[rel] = { ...(lib.photos[rel] ?? {}), ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null && v !== "")), added: new Date().toISOString() };
  });
}
