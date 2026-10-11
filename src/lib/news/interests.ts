import { readNote, listMarkdown, P } from "../vault/fs";
import { listPlans } from "../vault/services";
import { listFacts } from "../index/search";
import type { NewsItem } from "./store";

/**
 * 根据个人资料推荐资讯：不调用模型，只做关键词匹配。
 * 兴趣 = 命中资料的「主题词典」+ 资料里出现的技术名词 + 手动添加的词。
 */
const TOPICS: { key: string; label: string; aliases: string[] }[] = [
  { key: "llm", label: "大模型", aliases: ["llm", "大模型", "gpt", "claude", "gemini", "deepseek", "qwen", "openai", "anthropic", "模型"] },
  { key: "agent", label: "Agent", aliases: ["agent", "agents", "智能体", "mcp", "tool use", "langgraph", "langchain"] },
  { key: "rag", label: "RAG / 检索", aliases: ["rag", "retrieval", "embedding", "vector", "向量", "检索"] },
  { key: "frontend", label: "前端", aliases: ["frontend", "前端", "react", "next.js", "nextjs", "vue", "css", "javascript", "typescript", "browser", "web"] },
  { key: "fullstack", label: "全栈 / 后端", aliases: ["node.js", "nodejs", "python", "fastapi", "postgres", "api", "backend", "后端", "全栈"] },
  { key: "sysdesign", label: "系统设计", aliases: ["system design", "distributed", "database", "scalability", "架构", "分布式", "数据库", "系统设计"] },
  { key: "opensource", label: "开源", aliases: ["open source", "open-source", "github", "开源"] },
  { key: "career", label: "职场成长", aliases: ["career", "promotion", "hiring", "layoff", "晋升", "职场", "招聘", "裁员", "面试"] },
  { key: "health", label: "健康运动", aliases: ["health", "sleep", "fitness", "exercise", "健康", "睡眠", "运动", "健身"] },
  { key: "finance", label: "理财投资", aliases: ["investing", "index fund", "etf", "savings", "理财", "基金", "存款", "投资"] },
  { key: "indie", label: "独立开发", aliases: ["indie hacker", "side project", "chrome extension", "saas", "副业", "独立开发", "插件"] },
];

const STOP = new Set(["the", "and", "for", "with", "you", "are", "this", "that", "from", "have", "not", "but", "all", "can", "will", "one", "md", "ai", "id", "ok", "pm", "am", "vs", "etc", "todo", "doing", "done", "type", "title", "status", "domain", "high", "medium", "low", "week", "month", "quarter", "year"]);

export interface Interest { key: string; label: string; aliases: string[]; weight: number; source: "topic" | "term" | "manual" }

function profileText() {
  const parts: string[] = [];
  for (const p of [P.now, "profile/identity.md", "profile/background.md", ...listMarkdown("domains")]) parts.push(readNote(p)?.body ?? "");
  for (const pl of listPlans()) if (pl.status === "doing" || pl.status === "todo") parts.push(pl.title, pl.title);
  try { for (const f of listFacts({ status: "active" })) parts.push(f.text); } catch { /* 索引未就绪 */ }
  return parts.join("\n").replace(/<!--[\s\S]*?-->/g, "");
}

const count = (text: string, alias: string) => {
  const re = /^[\x00-\x7f]+$/.test(alias) ? new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "gi") : new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  return (text.match(re) ?? []).length;
};

let cache: { at: number; list: Interest[] } | null = null;

/** 自动兴趣（缓存 10 分钟） */
export function autoInterests(): Interest[] {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.list;
  const text = profileText();
  const lower = text.toLowerCase();
  const list: Interest[] = [];
  for (const t of TOPICS) {
    const hits = t.aliases.reduce((a, al) => a + count(lower, al.toLowerCase()), 0);
    if (hits > 0) list.push({ key: t.key, label: t.label, aliases: t.aliases, weight: Math.min(3, 1 + Math.log2(hits)), source: "topic" });
  }
  // 资料里出现的英文技术名词（含大写或数字的词，如 React、DDIA、P6 之外的常见缩写）
  const terms = new Map<string, number>();
  for (const m of text.matchAll(/\b[A-Za-z][A-Za-z0-9.+#-]{1,24}\b/g)) {
    const w = m[0].replace(/[.-]+$/, "");
    if (!/[A-Z]/.test(w.slice(1)) && !/^[A-Z]/.test(w)) continue; // 只要专有名词风格的词
    const k = w.toLowerCase();
    if (k.length < 3 || STOP.has(k) || /^p\d$/.test(k)) continue;
    if (TOPICS.some((t) => t.aliases.includes(k))) continue;
    terms.set(k, (terms.get(k) ?? 0) + 1);
  }
  const top = [...terms.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [k, n] of top) list.push({ key: `term:${k}`, label: k, aliases: [k], weight: Math.min(2, 0.8 + Math.log2(n) / 2), source: "term" });
  cache = { at: Date.now(), list };
  return list;
}

export function interests(manual: string[], muted: string[]): Interest[] {
  const m = new Set(muted);
  const auto = autoInterests().filter((i) => !m.has(i.key));
  const man = manual.filter(Boolean).map((w) => ({ key: `kw:${w.toLowerCase()}`, label: w, aliases: [w.toLowerCase()], weight: 3, source: "manual" as const }));
  return [...man, ...auto];
}

/** 给一条资讯打分：标题命中权重高，摘要命中权重低，再按时间衰减 */
export function scoreItem(it: Pick<NewsItem, "title" | "summary" | "published_at">, list: Interest[]) {
  const title = it.title.toLowerCase();
  const summary = (it.summary ?? "").toLowerCase();
  let score = 0;
  const matched: string[] = [];
  for (const i of list) {
    let s = 0;
    for (const a of i.aliases) {
      if (count(title, a) > 0) { s = Math.max(s, 3); break; }
      if (count(summary, a) > 0) s = Math.max(s, 1);
    }
    if (s) { score += s * i.weight; matched.push(i.label); }
  }
  if (!score) return { score: 0, matched };
  const ageH = it.published_at ? Math.max(0, (Date.now() - Date.parse(it.published_at)) / 36e5) : 48;
  return { score: +(score * Math.exp(-ageH / 72)).toFixed(3), matched: matched.slice(0, 3) };
}
