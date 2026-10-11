import { handler, body } from "@/lib/api";
import { readNote, writeNote, listMarkdown } from "@/lib/vault/fs";
import { queryMetrics, listNotes } from "@/lib/index/search";
import { indexFile } from "@/lib/index/indexer";
import { dateStr, addDays, isoWeek } from "@/lib/core/util";

export const dynamic = "force-dynamic";

const KEYS = ["mood", "energy", "sleep", "study_min", "exercise_min"];

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${ym}-01`, end };
}

function summarize(start: string, end: string) {
  const m = queryMetrics(KEYS, start, end);
  const journalDates = new Set(listNotes({ type: "journal", since: start, until: end, limit: 400, includePrivate: true }).map((n) => n.date));
  const byDate = Object.fromEntries(m.points.map((p) => [p.date, p as Record<string, number | string>]));
  const days: { date: string; journal: boolean; mood: number | null }[] = [];
  for (let d = start; d <= end && days.length < 31; d = addDays(d, 1)) {
    const mood = byDate[d]?.mood;
    days.push({ date: d, journal: journalDates.has(d), mood: typeof mood === "number" ? mood : null });
  }
  const stats = Object.fromEntries(Object.entries(m.stats).map(([k, s]) => [k, s.avg]));
  return { stats, journals: journalDates.size, days };
}

/** 复盘列表：每篇带周期、状态、摘要、该周期的指标汇总 */
export const GET = handler(async () => {
  const items = listMarkdown("reviews").map((rel) => {
    const n = readNote(rel);
    if (!n) return null;
    const period = n.fm.period === "month" || rel.includes("/monthly/") ? "month" : "week";
    const label = String(n.fm.label ?? rel.split("/").pop()!.replace(/\.md$/, ""));
    let start = typeof n.fm.start === "string" ? n.fm.start : "";
    let end = typeof n.fm.end === "string" ? n.fm.end : "";
    if (!start || !end) {
      if (period === "month" && /^\d{4}-\d{2}$/.test(label)) ({ start, end } = monthRange(label));
    }
    // 摘要：「下周重点」或第一段非空内容
    const body = n.body.replace(/<!--[\s\S]*?-->/g, "");
    const focus = /##\s*下周重点\s*\n([\s\S]*?)(?=\n##\s|$)/.exec(body)?.[1]
      ?.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s*(?:\[.\]\s*)?/, "").trim()).filter(Boolean).slice(0, 3) ?? [];
    return {
      path: rel, period, label, start, end,
      status: n.fm.status === "final" ? "final" : "draft",
      title: String(n.fm.title ?? label),
      updated: typeof n.fm.updated === "string" ? n.fm.updated : null,
      focus,
      ...(start && end ? summarize(start, end) : { stats: {}, journals: 0, days: [] }),
    };
  }).filter(Boolean) as { start: string; label: string }[];
  items.sort((a, b) => (b.start || b.label).localeCompare(a.start || a.label));
  const w = isoWeek(dateStr());
  return { items, current: { label: w.label, start: w.start, end: w.end, today: dateStr() } };
});

/** 修改状态：{ path, status: 'draft' | 'final' } */
export const PATCH = handler(async (req: Request) => {
  const b = await body<{ path: string; status: "draft" | "final" }>(req);
  if (!b.path?.startsWith("reviews/")) throw new Error("只能修改复盘");
  const n = readNote(b.path);
  if (!n) throw new Error("复盘不存在");
  const rel = writeNote(b.path, { ...n.fm, status: b.status === "final" ? "final" : "draft" }, n.body, { reason: `review ${b.status}` });
  indexFile(rel);
  return { ok: true };
});
