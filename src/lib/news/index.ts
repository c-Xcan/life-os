import { readNewsConfig, type NewsSource } from "./config";
import { fetchFeed } from "./rss";
import { saveItems, setSourceState, sourceStates, pruneOld } from "./store";

const g = globalThis as unknown as { __lifeosNewsRefresh?: Promise<NewsRefreshResult> };

export interface NewsRefreshResult { ok: number; failed: number; created: number; at: string }

/** 抓取全部启用的信源（并发 4，单个信源失败不影响其他） */
export function refreshNews(only?: string[]): Promise<NewsRefreshResult> {
  if (g.__lifeosNewsRefresh) return g.__lifeosNewsRefresh;
  const run = (async () => {
    const sources = readNewsConfig().sources.filter((s) => s.enabled && (!only || only.includes(s.id)));
    let ok = 0, failed = 0, created = 0;
    const queue = [...sources];
    const worker = async () => {
      for (let s: NewsSource | undefined; (s = queue.shift()); ) {
        try {
          const items = await fetchFeed(s.url);
          created += saveItems(s.id, items.slice(0, 50));
          setSourceState(s.id, true);
          ok++;
        } catch (e) {
          setSourceState(s.id, false, e instanceof Error ? e.message : String(e));
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    pruneOld();
    return { ok, failed, created, at: new Date().toISOString() };
  })().finally(() => { g.__lifeosNewsRefresh = undefined; });
  g.__lifeosNewsRefresh = run;
  return run;
}

/** 距离上次成功抓取超过 minutes 分钟才抓（给调度器用） */
export async function refreshNewsIfStale(minutes = 60) {
  const states = Object.values(sourceStates());
  const last = Math.max(0, ...states.map((s) => (s.last_fetch ? Date.parse(s.last_fetch) : 0)));
  if (Date.now() - last < minutes * 60_000) return null;
  return refreshNews();
}

export function lastRefreshAt() {
  const states = Object.values(sourceStates());
  const last = Math.max(0, ...states.map((s) => (s.last_fetch ? Date.parse(s.last_fetch) : 0)));
  return last ? new Date(last).toISOString() : null;
}
