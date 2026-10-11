import { handler, body } from "@/lib/api";
import { getJournal, saveJournal, type JournalMetrics } from "@/lib/vault/services";
import { listNotes } from "@/lib/index/search";
import { readNote } from "@/lib/vault/fs";
import { dateStr } from "@/lib/core/util";

export const dynamic = "force-dynamic";

/** GET ?date=YYYY-MM-DD → 当天日记；GET ?month=YYYY-MM → 当月有日记的日期；GET ?recent=N → 最近的日记 */
export const GET = handler((req: Request) => {
  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  // GET ?recent=N&before=YYYY-MM-DD → 最近 N 篇日记（含正文），before 用于「加载更多」
  const recent = url.searchParams.get("recent");
  if (recent) {
    const limit = Math.min(50, Math.max(1, Number(recent) || 20));
    const before = url.searchParams.get("before");
    const notes = listNotes({ type: "journal", limit: limit + 1, includePrivate: true, ...(before ? { until: shiftDay(before, -1) } : {}) });
    const items = notes.slice(0, limit).flatMap((n) => {
      if (!n.date) return [];
      const j = getJournal(n.date);
      return j ? [{ date: n.date, fm: j.fm, body: j.body }] : [];
    });
    return { items, more: notes.length > limit };
  }
  if (month) {
    const days = listNotes({ type: "journal", since: `${month}-01`, until: `${month}-31`, limit: 40, includePrivate: true })
      .map((n) => ({ date: n.date, mood: n.fm.mood ?? null }));
    return { month, days };
  }
  const date = url.searchParams.get("date") || dateStr();
  const n = getJournal(date);
  let body = n?.body;
  if (!n) {
    const tpl = readNote("_templates/journal.md");
    body = tpl ? tpl.body.replace(/\{\{date\}\}/g, date) : `# ${date}\n\n## 今天做了什么\n\n## 感受与想法\n\n## 明天最重要的事\n`;
  }
  return { date, exists: !!n, fm: n?.fm ?? {}, body };
});

export const PUT = handler(async (req: Request) => {
  const b = await body<{ date: string; body: string; metrics: JournalMetrics; tags?: string[] }>(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new Error("日期格式应为 YYYY-MM-DD");
  const path = saveJournal(b.date, b.body ?? "", b.metrics ?? {}, b.tags ? { tags: b.tags } : {});
  return { ok: true, path };
});

function shiftDay(d: string, n: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
