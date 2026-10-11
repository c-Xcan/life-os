import { handler } from "@/lib/api";
import { queryMetrics } from "@/lib/index/search";
import { dateStr, addDays } from "@/lib/core/util";

export const dynamic = "force-dynamic";

export const GET = handler((req: Request) => {
  const u = new URL(req.url);
  const days = Number(u.searchParams.get("days") || 30);
  const keys = (u.searchParams.get("keys") || "mood,energy,sleep").split(",");
  const to = dateStr();
  return queryMetrics(keys, addDays(to, -(days - 1)), to);
});
