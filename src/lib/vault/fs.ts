import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { VAULT_DIR, resolveInVault, toRel, ensureDir } from "../core/paths";
import { dateStr } from "../core/util";
import { vaultEvents } from "./events";
import { logChange, moveToTrash, snapshotBeforeWrite } from "./history";

export interface Note {
  path: string; // vault 相对路径，正斜杠
  fm: Record<string, unknown>;
  body: string;
  raw: string;
  mtime: number;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const text = raw.replace(/^﻿/, "");
  const m = FM_RE.exec(text);
  if (!m) return { fm: {}, body: text };
  let fm: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fm = parsed;
  } catch {
    fm = { _yaml_error: true };
  }
  // YAML 会把 2026-10-10 解析成字符串（yaml v2 默认 core schema），保持字符串
  return { fm, body: text.slice(m[0].length) };
}

export function stringifyNote(fm: Record<string, unknown>, body: string) {
  const clean = Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length === 0) return body;
  const y = YAML.stringify(clean, { lineWidth: 0 }).trimEnd();
  return `---\n${y}\n---\n\n${body.replace(/^\n+/, "")}`;
}

export function exists(rel: string) {
  return fs.existsSync(resolveInVault(rel));
}

export function readNote(rel: string): Note | null {
  const abs = resolveInVault(rel);
  if (!fs.existsSync(abs)) return null;
  const raw = fs.readFileSync(abs, "utf8");
  const { fm, body } = parseFrontmatter(raw);
  return { path: toRel(abs), fm, body, raw, mtime: fs.statSync(abs).mtimeMs };
}

export interface WriteOpts {
  /** 写入原因，显示在「最近的修改」里 */
  reason?: string;
  actor?: "user" | "agent" | "system";
  /** 不受 30 分钟合并限制，强制把旧内容存为一个版本（恢复历史版本时用） */
  forceSnapshot?: boolean;
}

export function writeRaw(rel: string, raw: string, opts: WriteOpts = {}) {
  const abs = resolveInVault(rel);
  const text = raw.replace(/\r\n/g, "\n");
  const r = toRel(abs);
  const existed = fs.existsSync(abs);
  // 写入前先把旧内容存为历史版本（内置快照，不依赖 git）
  try { snapshotBeforeWrite(r, text, opts.forceSnapshot); } catch (e) { console.error("[life-os] 保存历史版本失败：", e); }
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, text, "utf8");
  const reason = opts.reason ?? `update ${r}`, actor = opts.actor ?? "user";
  try { logChange({ path: r, actor, reason, kind: existed ? "edit" : "create" }); } catch { /* 记录失败不影响写入 */ }
  vaultEvents.emit("written", { path: r, reason, actor });
  return r;
}

export function writeNote(rel: string, fm: Record<string, unknown>, body: string, opts: WriteOpts = {}) {
  const next = { ...fm };
  if (next.type !== "journal") next.updated = dateStr();
  return writeRaw(rel, stringifyNote(next, body), opts);
}

/** 删除文件：移进回收站（30 天内可在 设置 → 数据与系统 里恢复） */
export function deleteNote(rel: string, opts: WriteOpts = {}) {
  const reason = opts.reason ?? `delete ${rel}`, actor = opts.actor ?? "user";
  moveToTrash(rel, { actor, reason });
  vaultEvents.emit("written", { path: rel, reason, actor });
}

const IGNORE_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]); // .git：兼容以前用 git 管理的 vault

/** 列出 vault 下所有 md（相对路径） */
export function listMarkdown(sub = ""): string[] {
  const start = sub ? resolveInVault(sub) : VAULT_DIR;
  const out: string[] = [];
  if (!fs.existsSync(start)) return out;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") && e.isDirectory()) continue;
      if (IGNORE_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".md")) out.push(toRel(abs));
    }
  };
  walk(start);
  return out.sort();
}

export interface TreeNode { name: string; path: string; dir: boolean; children?: TreeNode[] }

export function tree(): TreeNode[] {
  const build = (dir: string): TreeNode[] => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name))
      .filter((e) => e.isDirectory() || e.name.endsWith(".md"))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((e) => {
        const abs = path.join(dir, e.name);
        return e.isDirectory()
          ? { name: e.name, path: toRel(abs), dir: true, children: build(abs) }
          : { name: e.name, path: toRel(abs), dir: false };
      });
  };
  return build(VAULT_DIR);
}

/* ---------- 约定路径 ---------- */
export const P = {
  readme: "README.ai.md",
  now: "now.md",
  preferences: "memory/preferences.md",
  journal: (date: string) => `journal/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`,
  facts: (domain: string) => `memory/facts/${domain}.md`,
  domain: (d: string) => `domains/${d}.md`,
  plan: (slug: string) => `plans/${slug}.md`,
  weekly: (label: string) => `reviews/weekly/${label}.md`,
  monthly: (ym: string) => `reviews/monthly/${ym}.md`,
  session: (date: string, id: string) => `sessions/${date.slice(0, 4)}/${date.slice(5, 7)}/${id}.md`,
};

/* ---------- Markdown 小节操作（按二级标题） ---------- */
export function getSection(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, "").trim() === heading.trim());
  if (idx < 0) return null;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) if (/^#{1,2}\s+/.test(lines[i])) { end = i; break; }
  return lines.slice(idx + 1, end).join("\n").trim();
}

export function setSection(body: string, heading: string, content: string, mode: "replace" | "append" = "replace"): string {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, "").trim() === heading.trim());
  if (idx < 0) {
    return `${body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`;
  }
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) if (/^#{1,2}\s+/.test(lines[i])) { end = i; break; }
  const old = lines.slice(idx + 1, end).join("\n").trim();
  const isPlaceholder = /^(<!--[\s\S]*?-->\s*)*$/.test(old);
  const next = mode === "append" && old && !isPlaceholder ? `${old}\n${content.trim()}` : content.trim();
  return [...lines.slice(0, idx + 1), "", next, "", ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
}

export function listSections(body: string): string[] {
  return body.split("\n").filter((l) => /^##\s+/.test(l)).map((l) => l.replace(/^##\s+/, "").trim());
}
