import { handler } from "@/lib/api";
import { search } from "@/lib/index/search";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return { hits: [] };
  return { hits: await search(q, { limit: 12, includePrivate: true }) };
});
