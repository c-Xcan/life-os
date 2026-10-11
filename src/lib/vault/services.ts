import { readNote, writeNote, P, setSection, getSection, listSections, exists, type WriteOpts } from "./fs";
import { JOURNAL_METRICS, PlanFM, FactSchema, type Fact } from "./schema";
import { domainKeys, domainLabels, factDomains } from "./domains";
import { dateStr, shortId, slugify } from "../core/util";
import { indexFile } from "../index/indexer";
import { listNotes } from "../index/search";

/* 写完立即更新索引（不等文件监听），保证 Agent 下一步就能查到 */
function afterWrite(rel: string) {
  try { indexFile(rel); } catch { /* ignore */ }
  return rel;
}

/* ================= 日记 ================= */
export type JournalMetrics = Partial<Record<keyof typeof JOURNAL_METRICS, number>>;

export function getJournal(date: string) {
  return readNote(P.journal(date));
}

function journalSkeleton(date: string) {
  return `# ${date}\n\n## 今天做了什么\n\n## 感受与想法\n\n## 明天最重要的事\n`;
}

/** 保存整篇日记（界面编辑器用） */
export function saveJournal(date: string, body: string, metrics: JournalMetrics, extra: Record<string, unknown> = {}, opts: WriteOpts = {}) {
  const prev = getJournal(date);
  const fm: Record<string, unknown> = { ...(prev?.fm ?? {}), ...extra, type: "journal", date };
  for (const k of Object.keys(JOURNAL_METRICS)) {
    const v = (metrics as Record<string, unknown>)[k];
    if (v === null || v === undefined || (v as unknown) === "") delete fm[k];
    else fm[k] = Number(v);
  }
  return afterWrite(writeNote(P.journal(date), fm, body, { reason: `journal ${date}`, ...opts }));
}

/** 追加到日记（Agent 用）：不覆盖已有内容 */
export function appendJournal(date: string, content: string, metrics: JournalMetrics = {}, section?: string, opts: WriteOpts = {}) {
  const prev = getJournal(date);
  let body = prev?.body ?? journalSkeleton(date);
  const time = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  if (section && listSections(body).includes(section)) body = setSection(body, section, content, "append");
  else body = `${body.trimEnd()}\n\n**${time}** ${content.trim()}\n`;
  const merged: JournalMetrics = {};
  for (const k of Object.keys(JOURNAL_METRICS) as (keyof JournalMetrics)[]) {
    const v = metrics[k] ?? (prev?.fm[k] as number | undefined);
    if (v !== undefined && v !== null) merged[k] = Number(v);
  }
  return saveJournal(date, body, merged, {}, { reason: `journal ${date}: append`, ...opts });
}

/* ================= now.md / 领域档案 ================= */
export function updateSection(rel: string, section: string, content: string, mode: "replace" | "append", opts: WriteOpts = {}) {
  const note = readNote(rel);
  if (!note) throw new Error(`文件不存在：${rel}`);
  const body = setSection(note.body, section, content, mode);
  return afterWrite(writeNote(rel, note.fm, body, { reason: `${rel} › ${section}`, ...opts }));
}

export { getSection, listSections };

/* ================= 计划 ================= */
export interface PlanInput {
  slug?: string;
  title?: string;
  domain?: string;
  status?: "todo" | "doing" | "done" | "dropped";
  priority?: "high" | "medium" | "low";
  horizon?: "year" | "quarter" | "month" | "week";
  due?: string;
  progress?: number;
  body?: string;
  log?: string;
}

export function listPlans(status?: string) {
  return listNotes({ type: "plan", status, limit: 500, includePrivate: true }).map((n) => ({
    slug: n.path.replace(/^plans\//, "").replace(/\.md$/, ""),
    path: n.path,
    title: n.title,
    status: (n.fm.status as string) ?? "todo",
    priority: (n.fm.priority as string) ?? "medium",
    domain: (n.fm.domain as string) ?? null,
    horizon: (n.fm.horizon as string) ?? null,
    due: (n.fm.due as string) || null,
    progress: (n.fm.progress as number) ?? 0,
    updated: (n.fm.updated as string) ?? null,
  }));
}

export function upsertPlan(input: PlanInput, opts: WriteOpts = {}) {
  let slug = input.slug;
  if (!slug) {
    if (!input.title) throw new Error("新建计划需要 title");
    slug = slugify(input.title);
    if (exists(P.plan(slug))) slug = `${slug}-${shortId(4)}`;
  }
  const rel = P.plan(slug);
  const prev = readNote(rel);
  const fm: Record<string, unknown> = { ...(prev?.fm ?? { created: dateStr() }), type: "plan" };
  for (const k of ["title", "domain", "status", "priority", "horizon", "due", "progress"] as const) {
    if (input[k] !== undefined) fm[k] = input[k];
  }
  const parsed = PlanFM.safeParse(fm);
  if (!parsed.success) throw new Error(`计划字段不合法：${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  let body = input.body ?? prev?.body ?? `# ${fm.title}\n\n## 为什么要做\n\n## 完成标准\n\n## 步骤\n\n## 进展记录\n`;
  if (input.log) body = setSection(body, "进展记录", `- ${dateStr()} ${input.log}`, "append");
  return { slug, path: afterWrite(writeNote(rel, parsed.data as Record<string, unknown>, body, { reason: `plan ${slug}`, ...opts })) };
}

/* ================= 事实记忆 ================= */
export function readFacts(domain: string): Fact[] {
  const n = readNote(P.facts(domain));
  const arr = Array.isArray(n?.fm.facts) ? n!.fm.facts : [];
  return arr.map((f) => FactSchema.safeParse(f)).filter((r) => r.success).map((r) => r.data!);
}

function renderFactsBody(domain: string, facts: Fact[]) {
  const label = domainLabels()[domain] ?? domain;
  const active = facts.filter((f) => f.status === "active");
  const history = facts.filter((f) => f.status !== "active");
  return [
    `# 事实记忆 · ${label}`,
    "",
    "> 由系统维护：结构化数据在上方 frontmatter 的 `facts` 中，下面是便于阅读的版本。",
    "",
    "## 当前有效",
    "",
    ...(active.length ? active.map((f) => `- ${f.text}（自 ${f.valid_from}，置信度 ${f.confidence}）`) : ["（暂无）"]),
    "",
    "## 历史",
    "",
    ...(history.length ? history.map((f) => `- ~~${f.text}~~（${f.valid_from} → ${f.valid_to ?? "?"}，${f.status === "superseded" ? "已更新" : "已作废"}）`) : ["（暂无）"]),
    "",
  ].join("\n");
}

export function writeFacts(domain: string, facts: Fact[], opts: WriteOpts = {}) {
  const rel = P.facts(domain);
  const prev = readNote(rel);
  const fm = { ...(prev?.fm ?? {}), type: "facts", domain, title: `事实记忆 · ${domain}`, facts };
  if (domain === "finance") (fm as Record<string, unknown>).private = true;
  return afterWrite(writeNote(rel, fm, renderFactsBody(domain, facts), { reason: `memory ${domain}`, ...opts }));
}

export function newFactId() {
  return `f-${dateStr().replace(/-/g, "")}-${shortId(4)}`;
}

export function findFact(id: string): { domain: string; fact: Fact } | null {
  for (const d of new Set([...domainKeys(), ...factDomains()])) {
    const f = readFacts(d).find((x) => x.id === id);
    if (f) return { domain: d, fact: f };
  }
  return null;
}
