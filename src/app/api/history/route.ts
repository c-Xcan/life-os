import { handler, body } from "@/lib/api";
import { readNote, writeRaw } from "@/lib/vault/fs";
import { indexFile } from "@/lib/index/indexer";
import { listVersions, readVersion, recentChanges, listTrash, restoreFromTrash, purgeTrash, historyStats } from "@/lib/vault/history";
import { describeCommit, friendlyPath } from "@/lib/vault/commit-text";
import { restorePhotoMeta } from "@/lib/photos/library";

export const dynamic = "force-dynamic";

const ACTOR = { user: "我", agent: "搭档", system: "系统" } as const;

/**
 * GET ?path=&id=   某个版本的内容
 * GET ?path=       某个文件的版本列表 + 当前内容
 * GET              概况：最近修改、回收站、统计
 */
export const GET = handler(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const path = q.get("path");
  const id = q.get("id");
  if (path && id) return { path, id, raw: readVersion(path, id) };
  if (path) {
    const n = readNote(path);
    return { path, title: friendlyPath(path), current: n ? { raw: n.raw, mtime: n.mtime } : null, versions: listVersions(path) };
  }
  return {
    stats: historyStats(),
    recent: recentChanges(60).map((e) => ({ ...e, actorLabel: ACTOR[e.actor] ?? e.actor, text: describeCommit(e.reason).replace(/^(我|搭档|系统) · /, "") })),
    trash: listTrash().map((x) => ({ ...x, title: friendlyPath(x.path) })),
  };
});

/**
 * { action: "restore", path, id }   把文件恢复到某个版本（会先把当前内容存为一个版本，可再撤回）
 * { action: "restoreTrash", id }    从回收站恢复
 * { action: "purgeTrash", id? }     永久删除回收站里的一项 / 清空回收站
 */
export const POST = handler(async (req: Request) => {
  const b = await body<{ action: string; path?: string; id?: string }>(req);
  switch (b.action) {
    case "restore": {
      if (!b.path || !b.id) throw new Error("缺少参数");
      const raw = readVersion(b.path, b.id);
      const rel = writeRaw(b.path, raw, { reason: `restore ${b.path}`, forceSnapshot: true });
      indexFile(rel);
      return { ok: true, path: rel };
    }
    case "restoreTrash": {
      const r = restoreFromTrash(b.id ?? "");
      restorePhotoMeta(r.path, r.meta);
      if (r.path.endsWith(".md")) indexFile(r.path);
      return { ok: true, path: r.path };
    }
    case "purgeTrash":
      return { ok: true, removed: purgeTrash(b.id) };
    default:
      throw new Error("未知操作");
  }
});
