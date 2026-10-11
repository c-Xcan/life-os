import fs from "node:fs";
import path from "node:path";
import { VAULT_DIR, APP_DIR, appPath, ensureDir } from "../core/paths";
import { dateStr } from "../core/util";
import { bootstrapVault } from "../vault/bootstrap";
import { historyStats } from "../vault/history";
import { restartIndex, stopWatcher } from "../index/indexer";
import { createZip, type ZipEntry } from "./zip";

/*
 * 完整备份 zip 结构：
 *   life-os-backup.json   清单
 *   vault/...             全部 Markdown 数据
 *   app/history/...       历史版本（可选）
 *   app/settings.json     设置（不含 API Key）
 *   app/sessions/...      原始聊天记录
 *   app/inbox/...         待审核记忆
 * 不包含：secrets.json（API Key）、index.db（可重建）、traces、backup
 */
export const MANIFEST = "life-os-backup.json";
const APP_ITEMS = ["settings.json", "sessions", "inbox"];
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.obsidian\/workspace[^/]*)$/i;

interface FileRef { rel: string; abs: string; mtime: Date }

function walk(dir: string, prefix = "", skip?: (rel: string) => boolean): FileRef[] {
  if (!fs.existsSync(dir)) return [];
  const out: FileRef[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (skip?.(rel)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, rel, skip));
    else if (e.isFile() && !JUNK.test(rel)) out.push({ rel, abs, mtime: fs.statSync(abs).mtime });
  }
  return out;
}

export interface BackupOpts { includeHistory?: boolean; includeApp?: boolean }

/** vault 里以前 git 留下的 .git 目录不再备份 */
const isGit = (rel: string) => rel === ".git" || rel.startsWith(".git/");

export function buildBackup(o: BackupOpts = {}) {
  const includeHistory = o.includeHistory !== false;
  const includeApp = o.includeApp !== false;
  const entries: ZipEntry[] = [];
  const vaultFiles = walk(VAULT_DIR, "", isGit);
  for (const f of vaultFiles) entries.push({ path: `vault/${f.rel}`, data: fs.readFileSync(f.abs), mtime: f.mtime });
  let appCount = 0;
  if (includeApp) {
    for (const item of [...APP_ITEMS, ...(includeHistory ? ["history"] : [])]) {
      const abs = appPath(item);
      if (!fs.existsSync(abs)) continue;
      const files = fs.statSync(abs).isDirectory() ? walk(abs, item) : [{ rel: item, abs, mtime: fs.statSync(abs).mtime }];
      for (const f of files) entries.push({ path: `app/${f.rel}`, data: fs.readFileSync(f.abs), mtime: f.mtime });
      appCount += files.length;
    }
  }
  const manifest = {
    app: "life-os",
    format: 1,
    createdAt: new Date().toISOString(),
    vaultFiles: vaultFiles.length,
    appFiles: appCount,
    includesHistory: includeHistory,
    includesApp: includeApp,
  };
  entries.unshift({ path: MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });
  return { zip: createZip(entries), filename: `life-os-backup-${dateStr()}.zip`, manifest };
}

/* ---------------- 概况 ---------------- */

const SAFETY_RE = /^before-import-[\w-]+\.zip$/;

/** 当前数据概况 + 导入前自动生成的安全备份列表 */
export async function backupInfo() {
  const all = walk(VAULT_DIR, "", isGit);
  let bytes = 0;
  let notes = 0;
  let journals = 0;
  for (const f of all) {
    bytes += fs.statSync(f.abs).size;
    if (!f.rel.endsWith(".md")) continue;
    notes++;
    if (f.rel.startsWith("journal/")) journals++;
  }
  const dir = appPath("backup");
  const safety = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((n) => SAFETY_RE.test(n)).map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, size: st.size, mtime: st.mtime.toISOString() };
      }).sort((a, b) => b.mtime.localeCompare(a.mtime))
    : [];
  return { vaultPath: VAULT_DIR, notes, journals, bytes, versions: historyStats().versions, safety };
}

/** 读取一个安全备份文件（只允许 before-import-*.zip，防止越权读文件） */
export function readSafetyBackup(name: string) {
  if (!SAFETY_RE.test(name)) throw new Error("文件名不合法");
  const abs = appPath("backup", name);
  if (!fs.existsSync(abs)) throw new Error("备份不存在");
  return fs.readFileSync(abs);
}

/* ---------------- 导入 ---------------- */

export interface IncomingFile { path: string; data: Buffer }

function cleanPath(p: string) {
  const s = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!s || /^[a-zA-Z]:/.test(s) || s.split("/").some((seg) => seg === ".." || seg === "")) return null;
  return s;
}

/** 识别上传内容：可以是本系统导出的 zip、直接压缩的 vault 文件夹，或用文件夹选择器选中的 vault */
export function classify(files: IncomingFile[]) {
  const list = files.map((f) => ({ ...f, path: cleanPath(f.path) })).filter((f): f is IncomingFile => !!f.path);
  const readmes = list
    .map((f) => f.path)
    .filter((p) => (p === "README.ai.md" || p.endsWith("/README.ai.md")) && !p.includes("/.git/"))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  if (!readmes.length) throw new Error("没有找到 README.ai.md，这看起来不是 Life OS 的 vault 或备份");
  const vaultPrefix = readmes[0].slice(0, -"README.ai.md".length);

  const manifestPath = list.map((f) => f.path).find((p) => p === MANIFEST || p.endsWith(`/${MANIFEST}`));
  const appPrefix = manifestPath ? `${manifestPath.slice(0, -MANIFEST.length)}app/` : null;

  const vault: IncomingFile[] = [];
  const app: IncomingFile[] = [];
  for (const f of list) {
    if (JUNK.test(f.path)) continue;
    if (f.path.startsWith(vaultPrefix)) vault.push({ path: f.path.slice(vaultPrefix.length), data: f.data });
    else if (appPrefix && f.path.startsWith(appPrefix)) {
      const rel = f.path.slice(appPrefix.length);
      if ([...APP_ITEMS, "history"].some((it) => rel === it || rel.startsWith(`${it}/`))) app.push({ path: rel, data: f.data });
    }
  }
  // 旧备份里可能带着 vault/.git：不再导入
  const vaultFiles = vault.filter((f) => !isGit(f.path));
  return { vault: vaultFiles, app, hasHistory: app.some((f) => f.path.startsWith("history/")) };
}

/** 删除文件或目录；Windows 下只读文件（比如旧的 .git）需要先去掉只读属性 */
function rmForce(p: string) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    const chmodAll = (q: string) => {
      try { fs.chmodSync(q, 0o666); } catch { /* 忽略 */ }
      if (fs.statSync(q).isDirectory()) for (const n of fs.readdirSync(q)) chmodAll(path.join(q, n));
    };
    chmodAll(p);
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

export interface RestoreOpts { restoreSettings?: boolean }

export async function restoreBackup(files: IncomingFile[], o: RestoreOpts = {}) {
  const { vault, app, hasHistory } = classify(files);

  await stopWatcher();
  try {
    // 1. 先把当前数据完整备份一份，导入出问题可以随时找回
    ensureDir(appPath("backup"));
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
    const safety = appPath("backup", `before-import-${stamp}.zip`);
    fs.writeFileSync(safety, buildBackup({ includeHistory: true, includeApp: true }).zip);

    // 2. 清空当前 vault（以前 git 留下的 .git 原样保留，不去动它）
    ensureDir(VAULT_DIR);
    for (const name of fs.readdirSync(VAULT_DIR)) {
      if (name === ".git") continue;
      rmForce(path.join(VAULT_DIR, name));
    }

    // 3. 写入新 vault
    for (const f of vault) {
      const abs = path.join(VAULT_DIR, ...f.path.split("/"));
      ensureDir(path.dirname(abs));
      fs.writeFileSync(abs, f.data);
    }

    // 4. 运行状态：聊天记录、待审核记忆按文件合并；设置按选择覆盖（API Key 不受影响）
    let appWritten = 0;
    for (const f of app) {
      if (f.path === "settings.json" && !o.restoreSettings) continue;
      const abs = path.join(APP_DIR, ...f.path.split("/"));
      ensureDir(path.dirname(abs));
      fs.writeFileSync(abs, f.data);
      appWritten++;
    }

    // 5. 补齐模板
    await bootstrapVault();

    return {
      vaultFiles: vault.length,
      withHistory: hasHistory,
      appFiles: appWritten,
      settingsRestored: !!o.restoreSettings && app.some((f) => f.path === "settings.json"),
      safetyBackup: path.relative(APP_DIR, safety).split(path.sep).join("/"),
    };
  } finally {
    // 6. 重建索引并恢复文件监听（向量按内容哈希缓存，没变的段落不会重算）
    await restartIndex().catch((e) => console.error("[life-os] 导入后重建索引失败：", e));
  }
}
