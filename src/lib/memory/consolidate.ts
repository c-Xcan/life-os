import fs from "node:fs";
import { chatText } from "../llm/client";
import { listNotes, queryMetrics, listFacts } from "../index/search";
import { readNote, writeNote, P, stringifyNote, exists } from "../vault/fs";
import { listPlans } from "../vault/services";
import { JOURNAL_METRICS } from "../vault/schema";
import { dateStr, addDays, isoWeek, truncateTokens, nowLocal } from "../core/util";
import { appPath, ensureDir, APP_DIR } from "../core/paths";
import { getSettings } from "../core/settings";
import { extractMemory, proposeFileUpdate } from "./pipeline";
import { indexFile } from "../index/indexer";
import { trace } from "../agent/trace";
import { refreshNewsIfStale } from "../news/index";

function journalsBetween(from: string, to: string) {
  return listNotes({ type: "journal", since: from, until: to, limit: 400, includePrivate: true })
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .map((n) => ({ date: n.date!, note: readNote(n.path)! }))
    .filter((x) => x.note);
}

function metricsTable(from: string, to: string) {
  const keys = Object.keys(JOURNAL_METRICS);
  const m = queryMetrics(keys, from, to);
  const lines = Object.entries(m.stats).map(([k, s]) => `- ${JOURNAL_METRICS[k as keyof typeof JOURNAL_METRICS].label}：平均 ${s.avg}${JOURNAL_METRICS[k as keyof typeof JOURNAL_METRICS].unit}（${s.n} 天有记录，最低 ${s.min}，最高 ${s.max}）`);
  return lines.length ? lines.join("\n") : "（这段时间没有指标数据）";
}

/* ================= 周复盘草稿 ================= */
export async function generateWeeklyReview(date = dateStr(), force = false) {
  const w = isoWeek(date);
  const rel = P.weekly(w.label);
  if (exists(rel) && !force) return { path: rel, skipped: true };
  const journals = journalsBetween(w.start, w.end);
  const prevW = isoWeek(addDays(w.start, -1));
  const material = journals.map((j) => `### ${j.date}\n${JSON.stringify(pickMetrics(j.note.fm))}\n${j.note.body.trim()}`).join("\n\n");
  const plans = listPlans().filter((p) => p.status === "doing" || p.status === "todo").map((p) => `- [${p.status}] ${p.title}（进度 ${p.progress}%${p.due ? `，截止 ${p.due}` : ""}）`).join("\n");

  const body = await chatText({
    label: "review.weekly",
    system: `你在为用户撰写周复盘草稿。要求：
- 用中文，客观具体，引用具体日期的记录作为依据，不说空话。
- 严格使用以下二级标题：## 数据概览 / ## 这周做成了什么 / ## 没做好的 / 卡住的 / ## 状态与情绪 / ## 计划进展 / ## 下周重点。
- "下周重点"不超过 3 条，每条可执行。
- 材料不足时如实说明，不要编造。
- 只输出 Markdown 正文，从"## 数据概览"开始。`,
    user: `周：${w.label}（${w.start} ~ ${w.end}）

## 本周指标
${metricsTable(w.start, w.end)}

## 上周指标（对比用）
${metricsTable(prevW.start, prevW.end)}

## 进行中的计划
${plans || "（无）"}

## 本周日记
${truncateTokens(material || "（本周没有日记）", 14000)}`,
  });

  const fm = { type: "review", period: "week", label: w.label, start: w.start, end: w.end, status: "draft", title: `周复盘 ${w.label}` };
  writeNote(rel, fm, `# 周复盘 ${w.label}\n\n${body.trim()}\n`, { reason: `review ${w.label} (draft)`, actor: "system" });
  indexFile(rel);
  trace({ kind: "job.weekly", label: w.label, journals: journals.length });
  return { path: rel, skipped: false };
}

function pickMetrics(fm: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(JOURNAL_METRICS).filter((k) => fm[k] !== undefined).map((k) => [k, fm[k]]));
}

/* ================= now.md 刷新建议（进审核箱） ================= */
export async function proposeNowRefresh() {
  const today = dateStr();
  const now = readNote(P.now);
  if (!now) return null;
  const journals = journalsBetween(addDays(today, -14), today);
  if (!journals.length) return null;
  const facts = listFacts({ status: "active" }).slice(0, 40).map((f) => `- (${f.domain}) ${f.text}`).join("\n");
  const material = journals.map((j) => `### ${j.date}\n${j.note.body.trim()}`).join("\n\n");

  const body = await chatText({
    label: "now.refresh",
    system: `你在帮用户维护 now.md（"此刻的我"快照）。根据最近两周的日记，更新 now.md 的正文。
要求：
- 保留原有的二级标题结构（## 当前重心 / ## 最近状态 / ## 正在困扰 / ## 近期关键日期 / ## 希望 AI 关注）。
- 保留用户亲自写的、仍然成立的内容；过时的内容删除或改写；新情况补充进去。
- 每节简洁，用要点列表，第一人称"我"。
- 只输出完整的 Markdown 正文（从"# 当前处境"开始），不要输出 frontmatter。`,
    user: `今天：${today}

## 当前 now.md
${now.body}

## 已知事实
${facts || "（无）"}

## 最近两周指标
${metricsTable(addDays(today, -14), today)}

## 最近两周日记
${truncateTokens(material, 12000)}`,
  });
  const after = stringifyNote({ ...now.fm, updated: today }, body.trim() + "\n");
  return proposeFileUpdate(P.now, after, `建议更新当前处境（${today}）`, "consolidate/now");
}

/* ================= 从最近的日记抽取记忆 ================= */
export async function extractFromRecentJournals() {
  const state = readState();
  const since = state.lastJournalExtract ?? addDays(dateStr(), -7);
  const changed = listNotes({ type: "journal", since: addDays(since, -1), limit: 30, includePrivate: true });
  if (!changed.length) return null;
  const material = changed.map((n) => { const note = readNote(n.path); return note ? `### ${n.date}\n${note.body.trim()}` : ""; }).join("\n\n");
  const p = await extractMemory(material, `journal ${changed.at(-1)?.date} ~ ${changed[0]?.date}`, "从最近的日记中发现的记忆");
  writeState({ ...readState(), lastJournalExtract: dateStr() });
  return p;
}

/* ================= 调度 ================= */
interface SchedState { lastDaily?: string; lastWeekly?: string; lastJournalExtract?: string; lastError?: string }
const STATE_FILE = () => appPath("scheduler.json");
function readState(): SchedState { try { return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8")); } catch { return {}; } }
function writeState(s: SchedState) { ensureDir(APP_DIR); fs.writeFileSync(STATE_FILE(), JSON.stringify(s, null, 2)); }
export const schedulerState = readState;

export async function runDailyJobs() {
  const results: Record<string, unknown> = {};
  try { results.memory = (await extractFromRecentJournals())?.id ?? null; } catch (e) { results.memoryError = String(e); }
  try { results.now = (await proposeNowRefresh())?.id ?? null; } catch (e) { results.nowError = String(e); }
  return results;
}

/** 每 10 分钟检查一次是否到点 */
export async function schedulerTick() {
  const s = getSettings();
  if (!s.scheduler.enabled) return;
  const t = nowLocal(s.user.timezone);
  const st = readState();
  // 资讯：每小时最多抓一次
  void refreshNewsIfStale(60).catch(() => {});
  try {
    if (t.hour >= s.scheduler.dailyHour && st.lastDaily !== t.date) {
      writeState({ ...readState(), lastDaily: t.date });
      const r = await runDailyJobs();
      trace({ kind: "job.daily", ...r });
    }
    const wk = isoWeek(t.date).label;
    if (t.weekday === s.scheduler.weeklyReviewDay && t.hour >= s.scheduler.dailyHour && st.lastWeekly !== wk) {
      writeState({ ...readState(), lastWeekly: wk });
      await generateWeeklyReview(t.date);
    }
  } catch (e) {
    writeState({ ...readState(), lastError: `${new Date().toISOString()} ${String(e)}` });
  }
}
