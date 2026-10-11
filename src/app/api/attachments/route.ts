import { moveToTrash } from "@/lib/vault/history";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { handler } from "@/lib/api";
import { resolveInVault, ensureDir, toRel } from "@/lib/core/paths";
import { vaultEvents } from "@/lib/vault/events";
import { describeImage } from "@/lib/llm/client";
import { recordUpload, readLibrary, writeLibrary } from "@/lib/photos/library";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };

function checkPath(p: string | null) {
  const rel = (p ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel.startsWith("attachments/") || rel.split("/").includes("..")) throw new Error("路径不合法");
  return rel;
}

/** 读取附件：GET /api/attachments?path=attachments/2026/10/xxx.webp */
export const GET = handler(async (req: Request) => {
  const rel = checkPath(new URL(req.url).searchParams.get("path"));
  const abs = resolveInVault(rel);
  if (!fs.existsSync(abs)) return new Response("Not found", { status: 404 });
  const buf = fs.readFileSync(abs);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

/** 上传图片（前端已压缩成 WebP）：multipart file + date(YYYY-MM-DD) */
export const POST = handler(async (req: Request) => {
  const fd = await req.formData();
  const file = fd.get("file");
  const date = String(fd.get("date") ?? "");
  if (!file || typeof file === "string") throw new Error("没有收到图片");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式不正确");
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("图片太大（压缩后超过 10MB）");
  // 校验 WebP 文件头：RIFF....WEBP
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") throw new Error("只接受 WebP 图片");
  const rel = `attachments/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}-${crypto.randomBytes(3).toString("hex")}.webp`;
  const abs = resolveInVault(rel);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, buf);
  vaultEvents.emit("written", { path: toRel(abs), reason: `attach ${rel}`, actor: "user" });
  // 识图：生成一句描述 + 标签；描述会写进日记 Markdown 的 alt，搭档和检索都能用上。失败不影响上传
  let caption: string | null = null;
  let tags: string[] = [];
  let captionError: string | null = null;
  try {
    const r = await describeImage(buf);
    if (r) { caption = r.caption || null; tags = r.tags; }
  } catch (e) { captionError = e instanceof Error ? e.message : String(e); }

  // 照片库元数据：相册、拍摄时间、位置（来自原图 EXIF，压缩前在浏览器读取）
  const num = (k: string) => { const v = Number(fd.get(k)); return Number.isFinite(v) && fd.get(k) !== null && fd.get(k) !== "" ? v : undefined; };
  const album = String(fd.get("album") ?? "") || undefined;
  const takenAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(fd.get("takenAt") ?? "")) ? String(fd.get("takenAt")) : undefined;
  const lat = num("lat"), lng = num("lng");
  recordUpload(rel, {
    caption: caption ?? undefined,
    tags: tags.length ? tags : undefined,
    albums: album ? [album] : undefined,
    takenAt,
    ...(lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : {}),
  });
  return { path: rel, size: buf.length, caption, tags, captionError };
});

/**
 * 删除附件：DELETE /api/attachments?path=...
 * 默认移进回收站；?temp=1 表示刚上传、还没保存进日记的临时文件，直接删除
 */
export const DELETE = handler(async (req: Request) => {
  const url = new URL(req.url);
  const rel = checkPath(url.searchParams.get("path"));
  const lib = readLibrary();
  if (url.searchParams.get("temp") === "1") {
    const abs = resolveInVault(rel);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } else {
    moveToTrash(rel, { reason: `delete ${rel}`, meta: lib.photos[rel] ? { photo: lib.photos[rel] } : undefined });
  }
  vaultEvents.emit("written", { path: rel, reason: `delete ${rel}`, actor: "user" });
  if (lib.photos[rel]) { delete lib.photos[rel]; writeLibrary(lib, "photos: delete"); }
  return { ok: true };
});
