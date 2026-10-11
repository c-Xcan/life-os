import fs from "node:fs";
import crypto from "node:crypto";
import * as z from "zod/v4";
import { appPath, ensureDir, APP_DIR } from "../core/paths";
import { chatJSON } from "../llm/client";
import { readNote, getSection, P } from "../vault/fs";
import { buildFeed } from "./feed";
import { canTranslate } from "./translate";

/** 「为你推荐」顶部的 AI 速览：基于推荐前 15 条 + 当前处境，缓存 3 小时 */
export interface NewsBrief {
  headline: string;
  points: { text: string; ids: string[] }[];
  at: string;
  key: string;
  refs: Record<string, { title: string; url: string; source: string }>;
}

const FILE = () => appPath("news-brief.json");
const TTL = 3 * 60 * 60_000;
const g = globalThis as unknown as { __lifeosNewsBrief?: Promise<NewsBrief | null> };

const Out = z.object({
  headline: z.string(),
  points: z.array(z.object({ text: z.string(), ids: z.array(z.string()).default([]) })).min(1).max(6),
});

const SYSTEM = `你是用户的个人资讯助理。根据用户的当前处境和为他筛选出的资讯，写一段简短的中文速览。
要求：
- headline：一句话总结今天最值得关注的动向（不超过 30 字）。
- points：3–5 条要点，每条 1–2 句，先说发生了什么，再用半句话点出和用户的关系（例如对他的项目、学习或职业有什么参考价值）；相关性弱的就不要硬凑。
- 每条 points 用 ids 标出依据的资讯 id（1–3 个）。
- 只依据给出的资讯，不编造；公司、产品、模型名保留原文。
- 输出 JSON：{"headline":"…","points":[{"text":"…","ids":["…"]}]}`;

function readCache(): NewsBrief | null {
  try { return JSON.parse(fs.readFileSync(FILE(), "utf8")); } catch { return null; }
}

function topItems() {
  return buildFeed({ view: "recommend", days: 3, limit: 15 }).items;
}

/** 推荐列表的“指纹”：前 15 条有明显变化（新增 5 条以上）才重新生成 */
function changedEnough(prev: NewsBrief, ids: string[]) {
  const old = new Set(Object.keys(prev.refs));
  return ids.filter((id) => !old.has(id)).length >= 5;
}

export function getBriefCached(): NewsBrief | null {
  return readCache();
}

export function generateBrief(force = false): Promise<NewsBrief | null> {
  if (g.__lifeosNewsBrief) return g.__lifeosNewsBrief;
  const run = (async () => {
    const items = topItems();
    if (items.length < 3 || !canTranslate()) return readCache();
    const ids = items.map((x) => x.id);
    const key = crypto.createHash("sha1").update(ids.join(",")).digest("hex").slice(0, 12);
    const prev = readCache();
    if (!force && prev && (Date.now() - Date.parse(prev.at) < TTL || !changedEnough(prev, ids))) return prev;

    const now = readNote(P.now)?.body ?? "";
    const clean = (s: string | null) => (s ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
    const situation = [getSection(now, "当前重心"), getSection(now, "正在困扰")].map(clean).filter(Boolean).join("\n").slice(0, 800);
    const out = await chatJSON({
      label: "news.brief",
      system: SYSTEM,
      user: `## 我的当前处境\n${situation || "（未填写）"}\n\n## 为我筛选的资讯\n${JSON.stringify(items.map((x) => ({
        id: x.id, source: x.source_name, title: x.title_zh || x.title, summary: (x.summary_zh || x.summary || "").slice(0, 160), matched: x.matched,
      })))}`,
      parse: (v) => Out.parse(v),
    });
    const refs = Object.fromEntries(items.map((x) => [x.id, { title: x.title_zh || x.title, url: x.url, source: x.source_name }]));
    const brief: NewsBrief = {
      headline: out.headline.trim(),
      points: out.points.map((p) => ({ text: p.text.trim(), ids: p.ids.filter((id) => refs[id]).slice(0, 3) })),
      at: new Date().toISOString(),
      key,
      refs,
    };
    ensureDir(APP_DIR);
    fs.writeFileSync(FILE(), JSON.stringify(brief, null, 2));
    return brief;
  })().finally(() => { g.__lifeosNewsBrief = undefined; });
  g.__lifeosNewsBrief = run;
  return run;
}
