import * as z from "zod/v4";
import type { ToolDef } from "../llm/client";
import { search, queryMetrics, listNotes, listFacts } from "../index/search";
import { readNote, P, listSections } from "../vault/fs";
import { appendJournal, updateSection, upsertPlan, listPlans } from "../vault/services";
import { JOURNAL_METRICS, PLAN_STATUS } from "../vault/schema";
import { domainKeys, domainLabels } from "../vault/domains";

const DomainKey = z.string().describe("领域标识，可选值见系统提示里的 <domains>，例如 learning / health");
function assertDomain(d: string) {
  const keys = domainKeys();
  if (!keys.includes(d)) throw new Error(`未知领域「${d}」，可选：${keys.join(" / ")}`);
  return d;
}

const STATUS_LABEL: Record<string, string> = {
  todo: "待开始", doing: "进行中", done: "已完成", dropped: "已放弃",
};
import { saveProposal, FactOpSchema } from "../memory/inbox";
import { dateStr, addDays, nowLocal, truncateTokens } from "../core/util";
import { listSkills, readSkill } from "./skills";
import { buildFeed } from "../news/feed";

export interface ToolCtx {
  /** 当前对话模型是否在云端（云端时隐藏 private 内容，除非设置允许） */
  allowPrivate: boolean;
  sessionId: string;
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** 写操作：会改动 vault，默认需要用户确认 */
  write: boolean;
  /** 给确认卡片显示的一句话说明 */
  preview?: (args: z.infer<S>) => string;
  run: (args: z.infer<S>, ctx: ToolCtx) => Promise<unknown> | unknown;
}

function tool<S extends z.ZodType>(t: Tool<S>): Tool<S> { return t; }

const metricKeys = Object.keys(JOURNAL_METRICS) as [string, ...string[]];
const MetricsInput = z.object(Object.fromEntries(metricKeys.map((k) => [k, z.number().optional()])) as Record<string, z.ZodOptional<z.ZodNumber>>);

export const TOOLS: Tool[] = [
  /* ---------------- 读 ---------------- */
  tool({
    name: "get_today",
    description: "获取当前日期、星期和时间（Asia/Shanghai），以及今天是否已经写过日记。",
    schema: z.object({}),
    write: false,
    run: () => {
      const t = nowLocal();
      return { ...t, weekday_cn: "日一二三四五六"[t.weekday], has_journal: !!readNote(P.journal(t.date)) };
    },
  }),
  tool({
    name: "search_memory",
    description: "在用户的整个个人资料库（日记、档案、计划、复盘、事实记忆、历史对话）中做语义 + 关键词混合检索。回答任何依赖用户背景的问题前都应先检索。",
    schema: z.object({
      query: z.string().describe("检索内容，用自然语言或关键词"),
      types: z.array(z.enum(["journal", "plan", "review", "facts", "domain", "profile", "now", "session", "preferences", "skill", "note"])).optional().describe("限定文件类型"),
      since: z.string().optional().describe("只看此日期之后，YYYY-MM-DD"),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    write: false,
    run: async (a, ctx) => {
      const hits = await search(a.query, { types: a.types, since: a.since, limit: a.limit ?? 8, includePrivate: ctx.allowPrivate });
      return hits.map((h) => ({ path: h.path, title: h.title, type: h.type, date: h.date, section: h.heading, snippet: h.snippet, score: +h.score.toFixed(3) }));
    },
  }),
  tool({
    name: "read_note",
    description: "读取 vault 中某个文件的完整内容（包括 frontmatter）。路径来自 search_memory 或 list_notes 的结果。",
    schema: z.object({ path: z.string().describe("vault 相对路径，例如 domains/health.md") }),
    write: false,
    run: (a, ctx) => {
      const n = readNote(a.path);
      if (!n) return { error: `文件不存在：${a.path}` };
      if (n.fm.private === true && !ctx.allowPrivate) return { error: "该文件标记为隐私，当前模型不可读取" };
      return { path: n.path, frontmatter: n.fm, sections: listSections(n.body), content: truncateTokens(n.body, 6000) };
    },
  }),
  tool({
    name: "list_notes",
    description: "按条件列出文件（例如某段时间的日记、某领域的计划、所有复盘）。",
    schema: z.object({
      type: z.enum(["journal", "plan", "review", "facts", "domain", "profile", "session", "skill", "note"]).optional(),
      domain: z.string().optional(),
      since: z.string().optional().describe("YYYY-MM-DD"),
      until: z.string().optional().describe("YYYY-MM-DD"),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    write: false,
    run: (a, ctx) => listNotes({ ...a, includePrivate: ctx.allowPrivate }).map((n) => ({ path: n.path, type: n.type, title: n.title, date: n.date, status: n.status })),
  }),
  tool({
    name: "query_metrics",
    description: `查询日记中的量化指标并给出统计。可用指标：${metricKeys.map((k) => `${k}(${JOURNAL_METRICS[k as keyof typeof JOURNAL_METRICS].label})`).join("、")}。结果会在界面上画成图表。`,
    schema: z.object({
      keys: z.array(z.enum(metricKeys)).min(1),
      days: z.number().int().min(1).max(730).optional().describe("最近多少天，默认 30"),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    write: false,
    run: (a) => {
      const to = a.to ?? dateStr();
      const from = a.from ?? addDays(to, -((a.days ?? 30) - 1));
      return queryMetrics(a.keys, from, to);
    },
  }),
  tool({
    name: "get_news",
    description: "获取最近的资讯（来自用户订阅的 RSS 信源）。recommend=true 时按用户的兴趣排序，适合回答“最近有什么值得关注的新闻”。",
    schema: z.object({
      recommend: z.boolean().optional().describe("是否按个人兴趣推荐，默认 true"),
      category: z.enum(["ai", "dev", "tech", "finance", "other"]).optional(),
      days: z.number().int().min(1).max(30).optional().describe("最近多少天，默认 3"),
      limit: z.number().int().min(1).max(30).optional(),
    }),
    write: false,
    run: (a) => buildFeed({ view: a.recommend === false ? "latest" : "recommend", category: a.category, days: a.days ?? 3, limit: a.limit ?? 12 })
      .items.map((x) => ({ title: x.title, source: x.source_name, url: x.url, time: x.published_at, summary: x.summary?.slice(0, 160), matched: x.matched })),
  }),
  tool({
    name: "list_plans",
    description: "列出计划（目标）及其状态、进度、截止日期。",
    schema: z.object({ status: z.enum(PLAN_STATUS).optional() }),
    write: false,
    run: (a) => listPlans(a.status),
  }),
  tool({
    name: "get_facts",
    description: "获取系统整理的关于用户的事实记忆（默认只返回当前有效的）。",
    schema: z.object({ domain: DomainKey.optional(), include_history: z.boolean().optional() }),
    write: false,
    run: (a, ctx) => listFacts({ domain: a.domain, status: a.include_history ? undefined : "active" })
      .filter((f) => ctx.allowPrivate || f.domain !== "finance")
      .map((f) => ({ id: f.id, domain: f.domain, text: f.text, status: f.status, since: f.valid_from, until: f.valid_to })),
  }),
  tool({
    name: "load_skill",
    description: "加载某个技能的完整做事方法（技能列表见系统提示）。在处理对应场景前调用。",
    schema: z.object({ name: z.string() }),
    write: false,
    run: (a) => readSkill(a.name) ?? { error: `没有技能 ${a.name}`, available: listSkills().map((s) => s.name) },
  }),

  /* ---------------- 写（默认需确认） ---------------- */
  tool({
    name: "append_journal",
    description: "把内容追加到某天的日记（默认今天），可同时记录指标。不会覆盖已有内容。",
    schema: z.object({
      content: z.string().describe("要追加的正文，保留用户自己的说法"),
      date: z.string().optional().describe("YYYY-MM-DD，默认今天"),
      section: z.enum(["今天做了什么", "感受与想法", "明天最重要的事"]).optional().describe("追加到哪个小节；不填则追加到末尾并带时间戳"),
      metrics: MetricsInput.optional().describe("心情 mood/精力 energy 为 1-5；sleep 为小时；*_min 为分钟"),
    }),
    write: true,
    preview: (a) => `写到 ${a.date ?? dateStr()} 的日记${a.metrics && Object.keys(a.metrics).length ? `，并记下 ${Object.entries(a.metrics).map(([k, v]) => `${JOURNAL_METRICS[k as keyof typeof JOURNAL_METRICS]?.label ?? k}=${v}`).join("、")}` : ""}`,
    run: (a) => ({ ok: true, path: appendJournal(a.date ?? dateStr(), a.content, (a.metrics ?? {}) as Record<string, number>, a.section, { actor: "agent" }) }),
  }),
  tool({
    name: "update_now",
    description: "更新当前处境快照的某个小节。小节：当前重心 / 最近状态 / 正在困扰 / 近期关键日期 / 希望 AI 关注。",
    schema: z.object({
      section: z.string(),
      content: z.string().describe("Markdown 内容，建议用要点列表"),
      mode: z.enum(["replace", "append"]).default("append"),
    }),
    write: true,
    preview: (a) => `${a.mode === "replace" ? "改写" : "补充"}当前处境 · ${a.section}`,
    run: (a) => ({ ok: true, path: updateSection(P.now, a.section, a.content, a.mode, { actor: "agent" }) }),
  }),
  tool({
    name: "update_domain",
    description: "更新某个领域档案的某个小节。小节：现状 / 目标 / 挑战 / 资源与方法 / 记录。",
    schema: z.object({
      domain: DomainKey,
      section: z.string(),
      content: z.string(),
      mode: z.enum(["replace", "append"]).default("append"),
    }),
    write: true,
    preview: (a) => `${a.mode === "replace" ? "改写" : "补充"}${domainLabels()[a.domain] ?? a.domain}档案 · ${a.section}`,
    run: (a) => ({ ok: true, path: updateSection(P.domain(assertDomain(a.domain)), a.section, a.content, a.mode, { actor: "agent" }) }),
  }),
  tool({
    name: "upsert_plan",
    description: "新建或更新一个计划。更新时传 slug（来自 list_plans）。log 会追加到'进展记录'。",
    schema: z.object({
      slug: z.string().optional(),
      title: z.string().optional(),
      domain: DomainKey.optional(),
      status: z.enum(PLAN_STATUS).optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      horizon: z.enum(["year", "quarter", "month", "week"]).optional(),
      due: z.string().optional().describe("YYYY-MM-DD"),
      progress: z.number().min(0).max(100).optional(),
      body: z.string().optional().describe("完整正文（会替换原正文），一般只在新建时提供"),
      log: z.string().optional().describe("一条进展记录"),
    }),
    write: true,
    preview: (a) => a.slug ? `更新计划「${a.title ?? a.slug}」${a.status ? ` → ${STATUS_LABEL[a.status] ?? a.status}` : ""}${a.progress !== undefined ? `（${a.progress}%）` : ""}` : `新建计划「${a.title}」`,
    run: (a) => ({ ok: true, ...upsertPlan(a, { actor: "agent" }) }),
  }),
  tool({
    name: "propose_memory",
    description: "当对话中出现值得长期记住的、关于用户的事实（处境变化、目标、偏好、健康状况等）时，提交记忆候选。候选会进入审核箱，用户确认后才写入，所以无需再次确认。",
    schema: z.object({
      facts: z.array(z.object({
        op: z.enum(["add", "update", "invalidate"]).default("add"),
        fact_id: z.string().optional().describe("update / invalidate 时必填，来自 get_facts"),
        domain: DomainKey,
        text: z.string().describe("一句完整、独立、带主语的陈述"),
        importance: z.number().int().min(1).max(5).optional(),
        reason: z.string().optional(),
      })).min(1),
    }),
    write: false,
    run: (a, ctx) => {
      const p = saveProposal({ kind: "facts", title: "对话中提出的记忆", source: `session ${ctx.sessionId}`, ops: a.facts.map((f) => FactOpSchema.parse({ ...f, confidence: 0.9 })) });
      return { ok: true, inbox_id: p.id, note: "已提交到审核箱，等待用户确认" };
    },
  }),
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function toolDefs(): ToolDef[] {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
    delete schema.$schema;
    return { type: "function", function: { name: t.name, description: t.description, parameters: schema } };
  });
}
