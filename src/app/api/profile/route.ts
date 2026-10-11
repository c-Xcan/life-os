import { handler } from "@/lib/api";
import { readNote, P } from "@/lib/vault/fs";
import { listDomains, sectionCompletion } from "@/lib/vault/domains";

export const dynamic = "force-dynamic";

function stat(rel: string) {
  const n = readNote(rel);
  if (!n) return { exists: false, filled: 0, total: 0, updated: null as string | null };
  const c = sectionCompletion(n.body);
  const updated = typeof n.fm.updated === "string" && n.fm.updated ? n.fm.updated : new Date(n.mtime).toISOString().slice(0, 10);
  return { exists: true, ...c, updated };
}

/** 档案页概况：各文件的填写进度 + 领域列表 */
export const GET = handler(async () => {
  const docs = Object.fromEntries([P.now, "profile/identity.md", "profile/background.md", P.preferences].map((p) => [p, stat(p)]));
  const domains = listDomains().map((d) => ({ ...d, ...stat(d.path) }));
  return { docs, domains };
});
