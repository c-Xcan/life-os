"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BatteryMediumIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon, LoaderCircleIcon, MoonIcon, PenLineIcon, PlusIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Page, PageHeader } from "@/components/page";
import { JournalDialog } from "@/components/journal/editor";
import { MOOD, digest, getPhotos, weekday } from "@/components/journal/lib";
import { attachmentUrl } from "@/lib/image";
import { api, todayStr } from "@/lib/client";
import { cn } from "@/lib/utils";

type Entry = { date: string; fm: Record<string, unknown>; body: string };
const PAGE = 20;

export default function JournalPage() {
  return <React.Suspense fallback={<Page><Skeleton className="h-96 w-full" /></Page>}><JournalHome /></React.Suspense>;
}

function JournalHome() {
  const sp = useSearchParams();
  const router = useRouter();
  const today = todayStr();
  // ?date=YYYY-MM-DD 打开对应日记；?write=1 打开今天
  const open = sp.get("date") ?? (sp.get("write") ? today : null);
  const setOpen = (d: string | null) => router.replace(d ? `/journal?date=${d}` : "/journal", { scroll: false });

  const [entries, setEntries] = React.useState<Entry[] | null>(null);
  const [more, setMore] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [month, setMonth] = React.useState(today.slice(0, 7));
  const [days, setDays] = React.useState<Record<string, number | null>>({});

  const loadRecent = React.useCallback(async () => {
    const r = await api<{ items: Entry[]; more: boolean }>(`/api/journal?recent=${PAGE}`);
    setEntries(r.items);
    setMore(r.more);
  }, []);
  const loadMore = async () => {
    if (!entries?.length) return;
    setLoadingMore(true);
    try {
      const r = await api<{ items: Entry[]; more: boolean }>(`/api/journal?recent=${PAGE}&before=${entries.at(-1)!.date}`);
      setEntries((e) => [...(e ?? []), ...r.items]);
      setMore(r.more);
    } finally { setLoadingMore(false); }
  };
  const loadMonth = React.useCallback(async (m: string) => {
    const r = await api<{ days: { date: string; mood: number | null }[] }>(`/api/journal?month=${m}`);
    setDays((prev) => ({ ...prev, ...Object.fromEntries(r.days.map((d) => [d.date, d.mood])) }));
  }, []);

  React.useEffect(() => { void loadRecent(); }, [loadRecent]);
  React.useEffect(() => { void loadMonth(month); }, [month, loadMonth]);
  // 弹窗里的周视图可能跨月：打开时补加载那几个月
  React.useEffect(() => {
    if (!open) return;
    for (const m of new Set([open.slice(0, 7), prevMonth(open.slice(0, 7))])) void loadMonth(m);
  }, [open, loadMonth]);

  // 弹窗月历翻页时按需加载（同一个月只请求一次）
  const loaded = React.useRef(new Set<string>());
  const loadMonthOnce = React.useCallback((m: string) => { if (!loaded.current.has(m)) { loaded.current.add(m); void loadMonth(m); } }, [loadMonth]);
  const onSaved = React.useCallback((d: string) => { void loadRecent(); void loadMonth(d.slice(0, 7)); }, [loadRecent, loadMonth]);
  const hasToday = today in days || entries?.some((e) => e.date === today);

  // 按月分组
  const groups = React.useMemo(() => {
    const g: { ym: string; items: Entry[] }[] = [];
    for (const e of entries ?? []) {
      const ym = e.date.slice(0, 7);
      if (g.at(-1)?.ym !== ym) g.push({ ym, items: [] });
      g.at(-1)!.items.push(e);
    }
    return g;
  }, [entries]);

  return (
    <Page>
      <PageHeader title="日记" description="用自己的话记录每一天，搭档会读、会统计，也会帮你复盘。"
        actions={<Button onClick={() => setOpen(today)} className="max-sm:hidden"><PenLineIcon />{hasToday ? "继续写今天" : "写今天的日记"}</Button>} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ============ 近期日记 ============ */}
        <div className="min-w-0 space-y-6">
          {entries && !hasToday && (
            <button type="button" onClick={() => setOpen(today)}
              className="group hover:border-foreground/30 hover:bg-muted/30 flex w-full items-center gap-4 rounded-2xl border border-dashed px-4 py-3.5 text-left transition-colors sm:px-5">
              <DateCol date={today} today={today} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">今天还没写</div>
                <div className="text-muted-foreground mt-0.5 text-sm">花两分钟，记下今天的状态和一件小事</div>
              </div>
              <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full transition-transform group-hover:scale-105"><PlusIcon className="size-4" /></span>
            </button>
          )}

          {!entries ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}</div>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground py-16 text-center text-sm">还没有日记，写下第一篇吧。</p>
          ) : (
            groups.map((g) => (
              <section key={g.ym}>
                <div className="mb-2.5 flex items-baseline gap-2 px-1">
                  <h3 className="text-base font-semibold">{Number(g.ym.slice(5))} 月</h3>
                  <span className="text-muted-foreground text-xs tabular-nums">{g.ym.slice(0, 4)} · {g.items.length} 篇</span>
                </div>
                <div className="bg-card divide-y overflow-hidden rounded-2xl border shadow-xs">
                  {g.items.map((e) => <EntryRow key={e.date} e={e} today={today} onOpen={() => setOpen(e.date)} />)}
                </div>
              </section>
            ))
          )}

          {more && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>{loadingMore && <LoaderCircleIcon className="animate-spin" />}加载更早的日记</Button>
            </div>
          )}
        </div>

        {/* ============ 侧栏：月历 ============ */}
        <aside className="max-lg:hidden lg:sticky lg:top-16 lg:self-start">
          <MonthCalendar month={month} setMonth={setMonth} days={days} onSelect={setOpen} />
        </aside>
      </div>

      <JournalDialog date={open} days={days} onDate={setOpen} onClose={() => setOpen(null)} onSaved={onSaved} onMonth={loadMonthOnce} />
    </Page>
  );
}

function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/** 左侧日期列：大号日 + 周几（今天 / 昨天会替换周几） */
function DateCol({ date, today }: { date: string; today: string }) {
  const rel = date === today ? "今天" : date === shiftDay(today, -1) ? "昨天" : null;
  return (
    <div className="flex w-10 shrink-0 flex-col items-center pt-0.5 sm:w-11">
      <span className="text-2xl leading-7 font-semibold tracking-tight tabular-nums">{Number(date.slice(8))}</span>
      <span className={cn("mt-0.5 text-[11px] leading-4", rel ? "text-foreground font-medium" : "text-muted-foreground")}>{rel ?? weekday(date, true)}</span>
    </div>
  );
}

function EntryRow({ e, today, onOpen }: { e: Entry; today: string; onOpen: () => void }) {
  const secs = digest(e.body);
  const photos = getPhotos(e.body);
  const mood = typeof e.fm.mood === "number" ? MOOD[Math.round(e.fm.mood)] : null;
  const energy = typeof e.fm.energy === "number" ? e.fm.energy : null;
  const sleep = typeof e.fm.sleep === "number" ? e.fm.sleep : null;
  const [main, second] = secs;
  return (
    <button type="button" onClick={onOpen}
      className="group hover:bg-muted/40 active:bg-muted/60 flex w-full gap-3 px-4 py-4 text-left transition-colors sm:gap-4 sm:px-5">
      <DateCol date={e.date} today={today} />
      <div className="min-w-0 flex-1">
        {/* 状态：心情 · 精力 · 睡眠 */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {mood && <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-px font-medium [&_svg]:size-3", mood.soft)}><mood.icon />{mood.label}</span>}
          {energy !== null && <span className="inline-flex items-center gap-1"><BatteryMediumIcon className="size-3.5" />精力 {energy}/5</span>}
          {sleep !== null && <span className="inline-flex items-center gap-1"><MoonIcon className="size-3.5" />睡眠 {sleep}h</span>}
          {photos.length > 0 && <span className="inline-flex items-center gap-1 sm:hidden"><ImageIcon className="size-3.5" />{photos.length}</span>}
          {!mood && energy === null && sleep === null && <span>未记录状态</span>}
        </div>
        {/* 正文摘要：第一节是主体，第二节作为引用 */}
        {main ? (
          <p className="text-foreground/90 mt-1.5 line-clamp-2 text-[15px] leading-6">{main.text}</p>
        ) : <p className="text-muted-foreground mt-1.5 text-sm">只记录了状态</p>}
        {second && (
          <p className="text-muted-foreground border-border mt-2 line-clamp-1 border-l-2 pl-2.5 text-[13px] leading-5">{second.text}</p>
        )}
        {photos.length > 0 && (
          <div className="mt-3 flex gap-1.5 max-sm:hidden">
            {photos.slice(0, 6).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.src} src={attachmentUrl(p.src)} alt={p.alt} loading="lazy" draggable={false} className="bg-muted size-12 rounded-md object-cover" />
            ))}
            {photos.length > 6 && <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-md text-xs">+{photos.length - 6}</span>}
          </div>
        )}
      </div>
      <ChevronRightIcon className="text-muted-foreground/40 group-hover:text-muted-foreground mt-1 size-4 shrink-0 self-center transition-colors max-sm:hidden" />
    </button>
  );
}

function shiftDay(d: string, n: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/* ---------------- 月历：点日期打开那天的日记 ---------------- */
function MonthCalendar({ month, setMonth, days, onSelect }: { month: string; setMonth: (m: string) => void; days: Record<string, number | null>; onSelect: (d: string) => void }) {
  const [y, m] = month.split("-").map(Number);
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const today = todayStr();
  const move = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  const count = Object.keys(days).filter((d) => d.startsWith(month)).length;
  return (
    <div className="bg-card rounded-2xl border p-4 shadow-xs">
      <div className="mb-3 flex items-center gap-2">
        <div className="text-sm font-semibold">{y} 年 {m} 月</div>
        <span className="text-muted-foreground text-xs">记录 {count} 天</span>
        <div className="ml-auto flex items-center">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground size-7" onClick={() => move(-1)} title="上个月"><ChevronLeftIcon /></Button>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground size-7" onClick={() => move(1)} disabled={month >= today.slice(0, 7)} title="下个月"><ChevronRightIcon /></Button>
        </div>
      </div>
      <div className="text-muted-foreground mb-1 grid grid-cols-7 text-center text-[10px]">{"一二三四五六日".split("").map((d) => <div key={d} className="py-1">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((c, i) => {
          if (!c) return <div key={`e${i}`} />;
          const has = c in days, mv = days[c], future = c > today, isToday = c === today;
          return (
            <button key={c} disabled={future} onClick={() => onSelect(c)} title={has ? (mv ? `心情 ${MOOD[Math.round(mv)]!.label}` : "有日记") : "写这天的日记"}
              className="group flex flex-col items-center gap-0.5 py-0.5 disabled:cursor-default">
              <span className={cn("flex size-8 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                future ? "text-muted-foreground/35"
                  : isToday ? "bg-foreground text-background font-semibold"
                  : has ? "font-medium group-hover:bg-muted" : "text-muted-foreground group-hover:bg-muted")}>
                {Number(c.slice(8))}
              </span>
              <span className={cn("size-1 rounded-full", has ? (mv ? MOOD[Math.round(mv)]!.bg : "bg-foreground/30") : "bg-transparent")} />
            </button>
          );
        })}
      </div>
      <div className="text-muted-foreground mt-3 flex items-center gap-1.5 border-t pt-3 text-[10px]">
        <span className="mr-auto">圆点 = 当天心情</span>
        {[1, 2, 3, 4, 5].map((n) => <span key={n} title={MOOD[n]!.label} className={cn("size-1.5 rounded-full", MOOD[n]!.bg)} />)}
      </div>
    </div>
  );
}
