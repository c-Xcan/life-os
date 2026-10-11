import { readNewsConfig, type NewsCategory } from "./config";
import { listItems, type NewsItem } from "./store";
import { interests, scoreItem } from "./interests";

export interface FeedEntry extends NewsItem { source_name: string; category: NewsCategory; score: number; matched: string[] }

/** 资讯列表：view=recommend 按个人兴趣排序；否则按时间 */
export function buildFeed(opts: { view?: "recommend" | "latest"; category?: string; days?: number; limit?: number; offset?: number; q?: string }) {
  const cfg = readNewsConfig();
  const enabled = cfg.sources.filter((s) => s.enabled && (!opts.category || opts.category === "all" || s.category === opts.category));
  const byId = new Map(enabled.map((s) => [s.id, s]));
  const list = interests(cfg.keywords, cfg.muted);
  const q = opts.q?.trim().toLowerCase();
  let items: FeedEntry[] = listItems({ sourceIds: enabled.map((s) => s.id), sinceDays: opts.days ?? 7, limit: 600 })
    .filter((it) => !q || [it.title, it.summary, it.title_zh, it.summary_zh].some((t) => (t ?? "").toLowerCase().includes(q)))
    .map((it) => {
      const s = byId.get(it.source_id)!;
      // 原文和译文一起参与兴趣匹配（中文兴趣词也能命中英文资讯）
      const scored = scoreItem({ title: `${it.title} ${it.title_zh ?? ""}`, summary: `${it.summary ?? ""} ${it.summary_zh ?? ""}`, published_at: it.published_at }, list);
      return { ...it, source_name: s.name, category: s.category, ...scored };
    });
  if (opts.view === "recommend") items = items.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const offset = opts.offset ?? 0;
  return { items: items.slice(offset, offset + (opts.limit ?? 120)), total: items.length, interests: list };
}
