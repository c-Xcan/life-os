import * as z from "zod/v4";
import { chatJSON, resolveRole } from "../llm/client";
import { untranslated, saveTranslation } from "./store";

const g = globalThis as unknown as { __lifeosNewsTranslate?: Promise<number> };

/** 有可用的模型（有 Key 或本机模型）才翻译 */
export function canTranslate() {
  try { const m = resolveRole("background"); return Boolean(m.apiKey) || Boolean(m.provider.local); } catch { return false; }
}

const Out = z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string().nullish() })) });

const SYSTEM = `你是资讯翻译。把每条英文资讯的标题和摘要翻译成简体中文。
要求：
- 标题简洁自然，像中文科技媒体的标题；摘要保留关键信息，不超过 100 字。
- 公司名、产品名、模型名、人名、代码库名保留原文（如 OpenAI、Claude、React、Next.js）。
- 不要添加原文没有的信息。
- 输出 JSON：{"items":[{"id":"…","title":"…","summary":"…"}]}，id 原样返回。`;

const BATCH = 15;
const PARALLEL = 3;

async function translateBatch(batch: { id: string; title: string; summary: string | null }[]) {
  const out = await chatJSON({
    label: "news.translate",
    system: SYSTEM,
    user: JSON.stringify(batch.map((r) => ({ id: r.id, title: r.title, summary: (r.summary ?? "").slice(0, 300) }))),
    parse: (v) => Out.parse(v),
  });
  let n = 0;
  for (const it of out.items) {
    if (!batch.some((r) => r.id === it.id) || !it.title.trim()) continue;
    saveTranslation(it.id, it.title.trim(), it.summary?.trim() || null);
    n++;
  }
  return n;
}

/**
 * 翻译外文条目，直到全部译完或达到上限：
 * - onlyIds：只翻译 ids 里的（资讯页当前这一页），其余不动
 * - 否则 ids 优先，再按新到旧
 * - 每批 15 条，3 批并发；同一时间只跑一个任务
 * - 模型报错时停下，下次触发再继续
 */
export function translatePending(opts: { ids?: string[]; max?: number; onlyIds?: boolean } = {}): Promise<number> {
  if (g.__lifeosNewsTranslate) return g.__lifeosNewsTranslate;
  const run = (async () => {
    if (!canTranslate()) return 0;
    const max = opts.max ?? 400;
    let done = 0;
    let ids = opts.ids ?? [];
    while (done < max) {
      const rows = untranslated(Math.min(BATCH * PARALLEL, max - done), ids, opts.onlyIds);
      if (!opts.onlyIds) ids = [];
      if (!rows.length) break;
      const batches = Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, i) => rows.slice(i * BATCH, i * BATCH + BATCH));
      const results = await Promise.allSettled(batches.map(translateBatch));
      const ok = results.reduce((a, r) => a + (r.status === "fulfilled" ? r.value : 0), 0);
      done += ok;
      if (results.some((r) => r.status === "rejected") || ok === 0) break;
    }
    return done;
  })().finally(() => { g.__lifeosNewsTranslate = undefined; });
  g.__lifeosNewsTranslate = run;
  return run;
}

export function isTranslating() {
  return Boolean(g.__lifeosNewsTranslate);
}
