import path from "node:path";
import fs from "node:fs";

/** 项目根目录（Next 运行时 cwd 即项目根） */
export const ROOT = process.cwd();

/** 数据本体：Markdown vault */
// turbopackIgnore：这些目录是运行时数据，不能被打包追踪进安装包
export const VAULT_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.VAULT_DIR || path.join(/*turbopackIgnore: true*/ ROOT, "vault"));

/** 运行状态：索引、密钥、会话、审核箱、轨迹 */
export const APP_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.APP_DIR || path.join(/*turbopackIgnore: true*/ ROOT, ".app"));

export const appPath = (...p: string[]) => path.join(/*turbopackIgnore: true*/ APP_DIR, ...p);

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

/** vault 内相对路径统一使用正斜杠（Windows 兼容） */
export function toRel(abs: string) {
  return path.relative(VAULT_DIR, abs).split(path.sep).join("/");
}

/** 把相对路径解析为绝对路径，并防止越出 vault */
export function resolveInVault(rel: string) {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(VAULT_DIR, clean);
  const relCheck = path.relative(VAULT_DIR, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error(`路径越界：${rel}`);
  }
  return abs;
}
