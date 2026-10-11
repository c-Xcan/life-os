import { handler } from "@/lib/api";
import { queryMetrics, listNotes } from "@/lib/index/search";
import { listPlans } from "@/lib/vault/services";
import { readNote, P, getSection } from "@/lib/vault/fs";
import { pendingCount } from "@/lib/memory/inbox";
import { dateStr, addDays } from "@/lib/core/util";
import { indexStatus } from "@/lib/index/indexer";
import { embedStatus } from "@/lib/index/embed";
import { getSettings, keyStatus } from "@/lib/core/settings";

export const dynamic = "force-dynamic";

const KEYS = ["mood", "energy", "sleep", "study_min", "work_min", "exercise_min"];

export const GET = handler(() => {
  const today = dateStr();
  const week = queryMetrics(KEYS, addDays(today, -6), today);
  const prevWeek = queryMetrics(KEYS, addDays(today, -13), addDays(today, -7));
  const trend = queryMetrics(KEYS, addDays(today, -29), today);

  const journals = listNotes({ type: "journal", since: addDays(today, -370), limit: 1000, includePrivate: true });
  const heat: Record<string, { mood?: number }> = {};
  for (const j of journals) if (j.date) heat[j.date] = { mood: typeof j.fm.mood === "number" ? j.fm.mood : undefined };

  let streak = 0;
  let d = heat[today] ? today : addDays(today, -1);
  while (heat[d]) { streak++; d = addDays(d, -1); }

  const now = readNote(P.now);
  const clean = (s: string | null) => (s ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  const s = getSettings();

  return {
    today,
    hasJournal: !!heat[today],
    streak,
    totalJournals: journals.length,
    week: week.stats,
    prevWeek: prevWeek.stats,
    trend: trend.points,
    heat,
    plans: listPlans().filter((p) => p.status === "doing" || (p.status === "todo" && p.priority === "high")).slice(0, 8),
    now: {
      focus: clean(getSection(now?.body ?? "", "当前重心")),
      state: clean(getSection(now?.body ?? "", "最近状态")),
      worry: clean(getSection(now?.body ?? "", "正在困扰")),
      updated: (now?.fm.updated as string) || null,
    },
    inbox: pendingCount(),
    reviews: listNotes({ type: "review", limit: 3, includePrivate: true }).map((r) => ({ path: r.path, title: r.title, date: r.date })),
    system: {
      index: indexStatus(),
      embed: embedStatus(),
      hasChatKey: keyStatus(s)[s.roles.chat.provider] || s.providers.find((p) => p.id === s.roles.chat.provider)?.local,
      chatModel: `${s.roles.chat.provider}/${s.roles.chat.model}`,
    },
  };
});
