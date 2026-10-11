import { handler, body } from "@/lib/api";
import { readNewsConfig, writeNewsConfig, NEWS_CATEGORIES, type NewsCategory } from "@/lib/news/config";
import { buildFeed } from "@/lib/news/feed";
import { refreshNews, lastRefreshAt } from "@/lib/news/index";
import { sourceStates } from "@/lib/news/store";
import { autoInterests } from "@/lib/news/interests";
import { fetchFeed } from "@/lib/news/rss";
import { canTranslate, translatePending, isTranslating } from "@/lib/news/translate";
import { isChinese } from "@/lib/news/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET ?view=recommend|latest&category=ai&q=… */
export const GET = handler(async (req: Request) => {
  const u = new URL(req.url).searchParams;
  const view = u.get("view") === "latest" ? "latest" : "recommend";
  const pageSize = Math.min(50, Number(u.get("pageSize")) || 20);
  const page = Math.max(1, Number(u.get("page")) || 1);
  const feed = buildFeed({ view, category: u.get("category") ?? undefined, q: u.get("q") ?? undefined, days: Number(u.get("days")) || 7, limit: pageSize, offset: (page - 1) * pageSize });
  const cfg = readNewsConfig();
  // 只翻译当前这一页还没翻译的外文条目（看到才翻译，翻过的不再翻）
  const pending = cfg.translate && canTranslate() ? feed.items.filter((x) => !x.title_zh && !isChinese(x.title)).map((x) => x.id) : [];
  if (pending.length) void translatePending({ ids: pending, onlyIds: true, max: pending.length }).catch(() => {});
  return {
    ...feed,
    page, pageSize,
    pendingTranslation: pending.length,
    translating: pending.length > 0 || isTranslating(),
    categories: NEWS_CATEGORIES,
    sources: cfg.sources.map((s) => ({ ...s, state: sourceStates()[s.id] ?? null })),
    keywords: cfg.keywords,
    muted: cfg.muted,
    autoInterests: autoInterests().map((i) => ({ key: i.key, label: i.label, source: i.source })),
    lastRefresh: lastRefreshAt(),
    translate: cfg.translate,
    canTranslate: canTranslate(),
  };
});

type Action =
  | { action: "refresh"; sourceId?: string }
  | { action: "addSource"; name: string; url: string; category: NewsCategory }
  | { action: "removeSource"; id: string }
  | { action: "toggleSource"; id: string; enabled: boolean }
  | { action: "setKeywords"; keywords: string[] }
  | { action: "toggleMute"; key: string }
  | { action: "setTranslate"; enabled: boolean }
  | { action: "translate" };

export const POST = handler(async (req: Request) => {
  const b = await body<Action>(req);
  const cfg = readNewsConfig();
  switch (b.action) {
    case "refresh":
      return await refreshNews(b.sourceId ? [b.sourceId] : undefined);
    case "addSource": {
      const url = b.url?.trim();
      if (!url || !/^https?:\/\//.test(url)) throw new Error("请填写 RSS / Atom 地址（http 开头）");
      if (cfg.sources.some((s) => s.url === url)) throw new Error("这个信源已经添加过了");
      const items = await fetchFeed(url); // 先试抓一次，确认能用
      const id = `u-${Date.now().toString(36)}`;
      const name = b.name?.trim() || new URL(url).hostname;
      cfg.sources.push({ id, name, url, category: NEWS_CATEGORIES.some((c) => c.key === b.category) ? b.category : "other", enabled: true });
      writeNewsConfig(cfg);
      await refreshNews([id]);
      return { ok: true, id, found: items.length };
    }
    case "removeSource":
      cfg.sources = cfg.sources.filter((s) => s.id !== b.id);
      writeNewsConfig(cfg);
      return { ok: true };
    case "toggleSource":
      cfg.sources = cfg.sources.map((s) => (s.id === b.id ? { ...s, enabled: b.enabled } : s));
      writeNewsConfig(cfg);
      return { ok: true };
    case "setKeywords":
      cfg.keywords = [...new Set((b.keywords ?? []).map((k) => k.trim()).filter(Boolean))].slice(0, 30);
      writeNewsConfig(cfg);
      return { ok: true };
    case "toggleMute":
      cfg.muted = cfg.muted.includes(b.key) ? cfg.muted.filter((k) => k !== b.key) : [...cfg.muted, b.key];
      writeNewsConfig(cfg);
      return { ok: true };
    case "setTranslate":
      cfg.translate = !!b.enabled;
      writeNewsConfig(cfg);
      return { ok: true };
    case "translate":
      return { ok: true, translated: await translatePending({ max: 60 }) };
    default:
      throw new Error("未知操作");
  }
});
