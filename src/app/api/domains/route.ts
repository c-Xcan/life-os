import { handler, body } from "@/lib/api";
import { listDomains, createDomain, deleteDomain } from "@/lib/vault/domains";
import { indexFile } from "@/lib/index/indexer";

export const dynamic = "force-dynamic";

export const GET = handler(async () => ({ domains: listDomains() }));

export const POST = handler(async (req: Request) => {
  const b = await body<{ key?: string; label: string; description?: string; icon?: string; color?: string }>(req);
  const r = createDomain(b);
  try { indexFile(r.path); } catch { /* ignore */ }
  return { ok: true, ...r };
});

export const DELETE = handler(async (req: Request) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) throw new Error("缺少 key");
  const r = deleteDomain(key);
  try { indexFile(`domains/${key}.md`); } catch { /* ignore */ }
  return r;
});
