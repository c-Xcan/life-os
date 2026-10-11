import { handler, body } from "@/lib/api";
import { readNote, writeRaw, deleteNote } from "@/lib/vault/fs";
import { indexFile } from "@/lib/index/indexer";
import { listVersions } from "@/lib/vault/history";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const path = new URL(req.url).searchParams.get("path");
  if (!path) throw new Error("缺少 path");
  const n = readNote(path);
  if (!n) return { path, exists: false, raw: "", fm: {}, body: "" };
  return { path: n.path, exists: true, raw: n.raw, fm: n.fm, body: n.body, versions: listVersions(n.path).length };
});

export const PUT = handler(async (req: Request) => {
  const b = await body<{ path: string; raw: string }>(req);
  if (!b.path?.endsWith(".md")) throw new Error("只能写入 .md 文件");
  const rel = writeRaw(b.path, b.raw ?? "", { reason: `edit ${b.path}` });
  indexFile(rel);
  return { ok: true, path: rel };
});

export const DELETE = handler(async (req: Request) => {
  const path = new URL(req.url).searchParams.get("path");
  if (!path) throw new Error("缺少 path");
  deleteNote(path);
  indexFile(path);
  return { ok: true };
});
