"use client";
import * as React from "react";
import { toast } from "sonner";
import { CalendarRangeIcon, CircleCheckIcon, LoaderCircleIcon, NotebookPenIcon, RotateCcwIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SectionDoc } from "@/components/section-doc";
import { api, useApi } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/components/page";

type Day = { date: string; journal: boolean; mood: number | null };
type Review = {
  path: string; period: "week" | "month"; label: string; start: string; end: string;
  status: "draft" | "final"; title: string; updated: string | null; focus: string[];
  stats: Record<string, number>; journals: number; days: Day[];
};
type Res = { items: Review[]; current: { label: string; start: string; end: string; today: string } };

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const MOOD_BG = ["", "bg-rose-400", "bg-orange-400", "bg-amber-300", "bg-lime-400", "bg-emerald-500"];

const md = (d: string) => (d ? `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : "");
const short = (d: string) => (d ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : "");
const weekNo = (label: string) => Number(/W(\d+)/.exec(label)?.[1] ?? 0);
const periodName = (r: Pick<Review, "period" | "label">) => r.period === "week" ? `第 ${weekNo(r.label)} 周` : `${Number(r.label.slice(5, 7))} 月`;

function dayBg(d: Day) {
  if (!d.journal && d.mood == null) return "bg-muted";
  if (d.mood == null) return "bg-foreground/25";
  return MOOD_BG[Math.max(1, Math.min(5, Math.round(d.mood)))];
}

export default function ReviewsPage() {
  const { data, reload } = useApi<Res>("/api/reviews");
  const [sel, setSel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const items = React.useMemo(() => data?.items ?? [], [data]);
  const current = items.find((r) => r.path === sel) ?? items[0];
  const thisWeek = data ? items.find((r) => r.label === data.current.label) : undefined;

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api<{ path: string }>("/api/jobs", { method: "POST", json: { job: "weekly" } });
      toast.success("本周复盘草稿已生成");
      await reload();
      setSel(r.path);
    } finally { setBusy(false); }
  };

  // 按「年 月」分组，时间线展示
  const groups = React.useMemo(() => {
    const g: { key: string; items: Review[] }[] = [];
    for (const r of items) {
      const d = r.end || r.start;
      const key = d ? `${d.slice(0, 4)} 年 ${Number(d.slice(5, 7))} 月` : "其他";
      const last = g[g.length - 1];
      if (last?.key === key) last.items.push(r); else g.push({ key, items: [r] });
    }
    return g;
  }, [items]);

  const genButton = (
    <Button onClick={generate} disabled={busy}>
      {busy ? <LoaderCircleIcon className="animate-spin" /> : thisWeek ? <RotateCcwIcon /> : <SparklesIcon />}
      {busy ? "正在生成…" : thisWeek ? "重新生成本周" : "生成本周复盘"}
    </Button>
  );

  return (
    <Page>
      <PageHeader
        title="复盘"
        description="每周日晚上自动根据日记生成草稿，你修改确认后定稿。"
        actions={<>
          {data && (
            <span className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:inline-flex">
              <CalendarRangeIcon className="size-3.5" />本周 {short(data.current.start)} – {short(data.current.end)}
            </span>
          )}
          {genButton}
        </>}
      />

      {!data ? (
        <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          <Skeleton className="h-[480px]" />
        </div>
      ) : items.length === 0 ? (
        <Empty className="bg-card min-h-[420px] border-solid shadow-xs">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-12 rounded-xl [&_svg:not([class*='size-'])]:size-6"><NotebookPenIcon /></EmptyMedia>
            <EmptyTitle className="text-base">还没有复盘</EmptyTitle>
            <EmptyDescription>复盘会读取这一周的日记、指标和计划进展，帮你看清做成了什么、卡在哪里、下周该聚焦什么。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{genButton}</EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
          {/* 时间线 */}
          <div className="md:sticky md:top-16 md:max-h-[calc(100vh-5rem)] md:self-start md:overflow-y-auto md:pr-1">
            {groups.map((g) => (
              <div key={g.key} className="mb-4 last:mb-0">
                <div className="text-muted-foreground mb-2 px-1 text-xs font-medium">{g.key}</div>
                <div className="relative space-y-1.5 pl-5 before:absolute before:top-3 before:bottom-3 before:left-[7px] before:w-px before:bg-border">
                  {g.items.map((r) => {
                    const active = r.path === current?.path;
                    return (
                      <button
                        key={r.path}
                        onClick={() => setSel(r.path)}
                        className={cn("relative w-full rounded-xl px-3 py-2.5 text-left transition-all", active ? "bg-card ring-border shadow-xs ring-1" : "hover:bg-muted/60")}
                      >
                        <span className={cn("ring-background absolute top-[15px] -left-[17px] size-2.5 rounded-full ring-4",
                          r.status === "final" ? "bg-emerald-500" : "bg-amber-400", active && "scale-125")} />
                        <div className="flex items-center gap-2">
                          <span className={cn("text-sm", active ? "font-semibold" : "font-medium")}>{periodName(r)}</span>
                          {r.label === data.current.label && <span className="bg-primary text-primary-foreground rounded px-1 text-[10px] leading-4">本周</span>}
                          <span className="text-muted-foreground ml-auto text-xs tabular-nums">{short(r.start)} – {short(r.end)}</span>
                        </div>
                        {r.days.length > 0 && r.days.length <= 7 && (
                          <div className="mt-2 flex gap-1">
                            {r.days.map((d) => <span key={d.date} title={`${d.date}${d.mood != null ? ` 心情 ${d.mood}` : d.journal ? " 有日记" : ""}`} className={cn("h-1.5 flex-1 rounded-full", dayBg(d))} />)}
                          </div>
                        )}
                        {r.focus[0] && <p className="text-muted-foreground mt-1.5 line-clamp-1 text-xs">→ {r.focus[0]}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 详情 */}
          {current && (
            <SectionDoc
              key={current.path}
              path={current.path}
              title={`${periodName(current)}复盘`}
              description={`${md(current.start)} – ${md(current.end)}${current.start ? ` · ${current.start.slice(0, 4)}` : ""}`}
              meta={<StatusPill status={current.status} />}
              actions={<StatusToggle r={current} onDone={reload} />}
              onSaved={() => void reload()}
              banner={<Overview r={current} />}
            />
          )}
        </div>
      )}
    </Page>
  );
}

function StatusPill({ status }: { status: Review["status"] }) {
  return status === "final"
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-emerald-700 dark:text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" />已定稿</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-400"><span className="size-1.5 rounded-full bg-amber-500" />草稿</span>;
}

function StatusToggle({ r, onDone }: { r: Review; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const next = r.status === "final" ? "draft" : "final";
  return (
    <Button variant={next === "final" ? "secondary" : "ghost"} size="sm" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await api("/api/reviews", { method: "PATCH", json: { path: r.path, status: next } }); toast.success(next === "final" ? "已定稿" : "已改回草稿"); onDone(); } finally { setBusy(false); }
    }}>
      {next === "final" ? <><CircleCheckIcon />定稿</> : <><RotateCcwIcon />改回草稿</>}
    </Button>
  );
}

function Overview({ r }: { r: Review }) {
  const total = r.days.length || 7;
  const tiles = [
    { label: "日记", value: `${r.journals}`, unit: `/${total} 天` },
    { label: "心情", value: r.stats.mood, unit: "/5" },
    { label: "精力", value: r.stats.energy, unit: "/5" },
    { label: "睡眠", value: r.stats.sleep, unit: "h" },
    { label: "运动", value: r.stats.exercise_min, unit: "min/天" },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0">
            <div className="text-muted-foreground text-xs">{t.label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">
              {t.value === undefined || t.value === null || t.value === "" ? <span className="text-muted-foreground/60">—</span> : typeof t.value === "number" ? +t.value.toFixed(1) : t.value}
              {t.value !== undefined && <span className="text-muted-foreground ml-0.5 text-xs font-normal">{t.unit}</span>}
            </div>
          </div>
        ))}
      </div>
      {r.period === "week" && r.days.length === 7 && (
        <div className="flex gap-1.5">
          {r.days.map((d, i) => (
            <div key={d.date} className="flex flex-col items-center gap-1" title={`${d.date}${d.mood != null ? ` · 心情 ${d.mood}` : d.journal ? " · 有日记" : " · 未记录"}`}>
              <span className={cn("flex size-7 items-center justify-center rounded-md text-[11px] font-medium tabular-nums", dayBg(d), d.mood != null ? "text-black/70" : d.journal ? "text-background" : "text-muted-foreground")}>
                {Number(d.date.slice(8, 10))}
              </span>
              <span className="text-muted-foreground text-[10px]">{WEEKDAYS[i]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
