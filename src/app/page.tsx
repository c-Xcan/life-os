"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnnoyedIcon, ArrowRightIcon, PencilIcon, BrainIcon, FrownIcon, LaughIcon, MehIcon, SmileIcon, CalendarCheckIcon, FlameIcon, ListChecksIcon, MoonIcon, NotebookPenIcon, PenLineIcon, SendIcon, SunIcon, TargetIcon, TrendingDownIcon, TrendingUpIcon, TriangleAlertIcon } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress, Skeleton, Alert, AlertTitle, AlertDescription } from "@/components/ui/misc";
import { Heatmap } from "@/components/heatmap";
import { MetricChart, metricColor } from "@/components/metric-chart";
import { Markdown } from "@/components/markdown";
import { KpiArt } from "@/components/kpi-art";
import { cn } from "@/lib/utils";
import { useApi, useDomains, METRIC_META, DOMAIN_LABEL } from "@/lib/client";

type Stat = { avg: number; min: number; max: number; n: number };
type Dash = {
  today: string; hasJournal: boolean; streak: number; totalJournals: number;
  week: Record<string, Stat>; prevWeek: Record<string, Stat>;
  trend: Record<string, unknown>[]; heat: Record<string, { mood?: number }>;
  plans: { slug: string; title: string; status: string; priority: string; domain: string | null; due: string | null; progress: number }[];
  now: { focus: string; state: string; worry: string; updated: string | null };
  inbox: number;
  reviews: { path: string; title: string; date: string | null }[];
  system: { index: { notes: number; chunks: number; embeddings: number; facts: number }; embed: { ok: boolean; error?: string; pending?: number }; hasChatKey: boolean; chatModel: string };
};

/** 首页输入框下的快捷指令：点击直接带着问题进入对话 */
const QUICK_ASKS: { icon: typeof SunIcon; label: string; prompt: string; fill?: boolean }[] = [
  { icon: SunIcon, label: "今日状态", prompt: "结合我最近几天的日记和指标，说说我今天的状态，以及今天最该做的一件事。" },
  { icon: ListChecksIcon, label: "本周优先级", prompt: "根据我的当前处境和进行中的计划，帮我排一下这周的优先级，最多 3 件事。" },
  { icon: CalendarCheckIcon, label: "帮我复盘", prompt: "帮我复盘一下这周：做成了什么、卡在哪里、下周怎么调整。" },
  { icon: MoonIcon, label: "睡眠分析", prompt: "分析一下我最近 30 天的睡眠和精力、心情之间的关系，给我 2 条可执行的建议。" },
  { icon: TargetIcon, label: "拆解计划", prompt: "帮我把最重要的一个进行中计划拆成本周可以完成的小步骤。" },
  { icon: PenLineIcon, label: "记一笔", prompt: "帮我记到今天的日记里：", fill: true },
];

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "numeric", hour12: false }).format(new Date()));
  return h < 6 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}

export default function Dashboard() {
  const { data, loading } = useApi<Dash>("/api/dashboard");
  const router = useRouter();
  const [ask, setAsk] = React.useState("");
  const askRef = React.useRef<HTMLInputElement>(null);
  useDomains(); // 加载自定义领域名称

  if (loading && !data) return <div className="grid gap-4 p-4 md:p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>;
  if (!data) return null;

  const kpis = ["sleep", "mood", "energy", "study_min", "exercise_min"];
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-4 px-4 pt-2 pb-6 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[28px] leading-tight font-semibold tracking-tight md:text-2xl">{greeting()}</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {data.today}
            <span className="max-sm:hidden"> · 已连续记录 {data.streak} 天 · 共 {data.totalJournals} 篇日记</span>
          </p>
        </div>
        <div className="hidden gap-2 sm:flex">
          {data.inbox > 0 && <Button variant="outline" asChild><Link href="/memory"><BrainIcon />{data.inbox} 条记忆待审核</Link></Button>}
          <Button asChild variant={data.hasJournal ? "outline" : "default"}><Link href="/journal?write=1"><NotebookPenIcon />{data.hasJournal ? "继续写今天" : "写今天的日记"}</Link></Button>
        </div>
      </div>

      {/* 移动端：今日卡片（日记入口 + 连续记录 + 待审核） */}
      <TodayCard data={data} />

      {!data.system.hasChatKey && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>还没有配置模型 API Key</AlertTitle>
          <AlertDescription>到 <Link href="/settings" className="underline">设置</Link> 填写 DeepSeek API Key 后，就可以和搭档对话了。</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <form className="flex gap-2 max-sm:order-2" onSubmit={(e) => { e.preventDefault(); if (ask.trim()) router.push(`/chat?q=${encodeURIComponent(ask)}`); }}>
          <Input ref={askRef} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="问问你的搭档：我最近状态怎么样？这周该优先做什么？" className="h-11 max-sm:rounded-full max-sm:px-4" />
          <Button type="submit" size="lg" className="h-11 max-sm:w-11 max-sm:rounded-full max-sm:px-0" aria-label="发送"><SendIcon /></Button>
        </form>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 max-sm:order-3 sm:mx-0 sm:flex-wrap sm:px-0">
          {QUICK_ASKS.map((q) => (
            <button key={q.label} type="button" onClick={() => {
                if (q.fill) { setAsk(q.prompt); requestAnimationFrame(() => askRef.current?.focus()); }
                else router.push(`/chat?q=${encodeURIComponent(q.prompt)}`);
              }}
              className="bg-card text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors max-sm:h-8 max-sm:px-3.5">
              <q.icon className="size-3.5" />{q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="-mb-1 flex items-baseline justify-between sm:hidden">
        <h3 className="text-[15px] font-semibold">近 7 天</h3>
        <span className="text-muted-foreground text-xs">平均值 · 较上周</span>
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-5">
        {kpis.map((k) => {
          const cur = data.week[k];
          const prev = data.prevWeek[k];
          const delta = cur && prev ? +(cur.avg - prev.avg).toFixed(1) : null;
          const m = METRIC_META[k];
          return (
            <Card key={k} className="group w-[8.75rem] shrink-0 snap-start flex-col items-start gap-1 overflow-hidden rounded-2xl px-3.5 py-3 sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:rounded-xl sm:px-4 sm:py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-sm"><span className="max-sm:hidden">近 7 天 · </span>{m.label}</div>
                <div className="mt-1.5 text-2xl leading-tight font-semibold whitespace-nowrap tabular-nums">{cur ? cur.avg : "—"}<span className="text-muted-foreground ml-1 text-xs font-normal">{cur ? m.unit : ""}</span></div>
                {delta !== null && delta !== 0 && (
                  <div className={`mt-0.5 flex items-center gap-1 text-xs whitespace-nowrap ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {delta > 0 ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}<span className="max-sm:hidden">较上周 </span>{delta > 0 ? "+" : ""}{delta}
                  </div>
                )}
              </div>
              <KpiArt k={k} className="relative order-first -ml-1 size-10 shrink-0 sm:order-none sm:-mr-1 sm:ml-0 sm:size-12 motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-105 lg:size-14" />
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TrendCard trend={data.trend} />

        <NowCard now={data.now} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-3 py-5 lg:col-span-2">
          <CardHeader className="px-5">
            <CardTitle className="flex items-center gap-2"><FlameIcon className="size-4" />记录热力图</CardTitle>
            <CardDescription>过去一年，点击格子打开当天日记</CardDescription>
            <CardAction><HeatStats heat={data.heat} streak={data.streak} /></CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center px-5">
            <Heatmap data={data.heat} today={data.today} maxCell={12} onSelect={(d) => router.push(`/journal?date=${d}`)} />
            <div className="mt-4 border-t pt-3 sm:hidden"><HeatStats heat={data.heat} streak={data.streak} mobile /></div>
          </CardContent>
        </Card>

        <Card className="gap-3 py-5">
          <CardHeader>
            <CardTitle>进行中的计划</CardTitle>
            <CardAction className="-my-1"><Button variant="ghost" size="sm" asChild><Link href="/plans">全部<ArrowRightIcon /></Link></Button></CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.plans.length === 0 && <p className="text-muted-foreground text-sm">还没有计划</p>}
            {data.plans.slice(0, 3).map((p) => (
              <div key={p.slug} className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate font-medium">{p.title}</span>
                  {p.domain && <Badge variant="secondary">{DOMAIN_LABEL[p.domain] ?? p.domain}</Badge>}
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">{p.due ? `截止 ${p.due}` : ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={p.progress} className="h-1.5" />
                  <span className="text-muted-foreground w-8 shrink-0 text-right text-xs tabular-nums">{p.progress ?? 0}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <p className="text-muted-foreground text-center text-xs max-sm:hidden">
        索引：{data.system.index.notes} 个文件 · {data.system.index.chunks} 个片段 · {data.system.index.embeddings} 个向量 · {data.system.index.facts} 条有效记忆
        {!data.system.embed.ok && data.system.embed.error && <> · 向量服务不可用（仅关键词检索）：{data.system.embed.error}</>}
        {" · "}对话模型 {data.system.chatModel}
      </p>
    </div>
  );
}

/** 移动端顶部的「今天」卡片：一眼看到今天是否记录、连续天数，并直接进入日记 */
function TodayCard({ data }: { data: Dash }) {
  return (
    <div className="grid gap-2 sm:hidden">
      <Link href="/journal?write=1"
        className={cn("relative flex items-center gap-3 overflow-hidden rounded-2xl p-4 transition-transform active:scale-[0.99]",
          data.hasJournal ? "bg-card border" : "bg-primary text-primary-foreground")}>
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5", data.hasJournal ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-primary-foreground/15")}>
          <NotebookPenIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{data.hasJournal ? "今天已经记录" : "写今天的日记"}</span>
          <span className={cn("mt-0.5 block text-xs", data.hasJournal ? "text-muted-foreground" : "text-primary-foreground/70")}>
            {data.hasJournal ? "点击继续补充" : "花两分钟，记下今天的状态"}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="flex items-center gap-1 text-lg leading-none font-semibold tabular-nums">
            <FlameIcon className={cn("size-4", data.streak > 0 ? "text-orange-500" : "opacity-50")} />{data.streak}
          </span>
          <span className={cn("mt-1 text-[11px]", data.hasJournal ? "text-muted-foreground" : "text-primary-foreground/70")}>连续 · 共 {data.totalJournals} 篇</span>
        </span>
      </Link>
      {data.inbox > 0 && (
        <Link href="/memory" className="bg-card flex items-center gap-3 rounded-2xl border px-4 py-3 active:bg-muted">
          <span className="flex size-8 items-center justify-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-400"><BrainIcon className="size-4" /></span>
          <span className="flex-1 text-sm"><span className="font-semibold tabular-nums">{data.inbox}</span> 条新记忆等你确认</span>
          <ArrowRightIcon className="text-muted-foreground size-4" />
        </Link>
      )}
    </div>
  );
}

/** 热力图下方的统计：填满卡片底部 */
function HeatStats({ heat, streak, mobile }: { heat: Record<string, { mood?: number }>; streak: number; mobile?: boolean }) {
  const dates = Object.keys(heat).sort();
  let best = 0, run = 0, prev = 0;
  for (const d of dates) {
    const t = new Date(d + "T00:00:00Z").getTime();
    run = prev && t - prev === 864e5 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  const moods = dates.map((d) => heat[d].mood).filter((x): x is number => typeof x === "number");
  const items = [
    { label: "累计", value: dates.length, unit: "天" },
    { label: "连续", value: streak, unit: "天" },
    { label: "最长", value: best, unit: "天" },
  ];
  const avgMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
  const face = avgMood === null ? null : MOOD_FACE[Math.max(1, Math.min(5, Math.round(avgMood)))];
  return (
    <div className={mobile ? "grid grid-cols-4" : "hidden items-start gap-5 sm:flex"}>
      {items.map((i) => (
        <div key={i.label} className={cn("flex flex-col gap-1", mobile ? "items-center" : "items-end")}>
          <span className="text-muted-foreground text-[11px] leading-4">{i.label}</span>
          <span className="flex h-6 items-baseline text-base leading-6 font-semibold tabular-nums">{i.value}<span className="text-muted-foreground ml-0.5 text-[11px] font-normal">{i.unit}</span></span>
        </div>
      ))}
      <div className={cn("flex flex-col gap-1", mobile ? "items-center" : "items-end")} title={face ? `平均心情 ${avgMood!.toFixed(1)} / 5 · ${face.label}` : "暂无心情数据"}>
        <span className="text-muted-foreground text-[11px] leading-4">平均心情</span>
        {face ? (
          <span className="flex h-6 items-center gap-1.5">
            <span className={cn("flex size-5 items-center justify-center rounded-full", face.cls)}><face.icon className="size-3.5" /></span>
            <span className="text-base leading-6 font-semibold tabular-nums">{avgMood!.toFixed(1)}</span>
            <span className="text-muted-foreground -ml-1 text-[11px]">/5</span>
          </span>
        ) : <span className="flex h-6 items-center text-base font-semibold">—</span>}
      </div>
    </div>
  );
}

/* ---------------- 最近 30 天 ---------------- */
const TREND_TABS = {
  state: { label: "状态", keys: ["mood", "energy", "sleep"] },
  time: { label: "投入", keys: ["study_min", "work_min", "exercise_min"] },
} as const;

function TrendCard({ trend }: { trend: Record<string, unknown>[] }) {
  const [tab, setTab] = React.useState<keyof typeof TREND_TABS>("state");
  const cfg = TREND_TABS[tab];
  const avg = (k: string) => {
    const v = trend.map((p) => p[k]).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return (
    <Card className="gap-3 py-5 lg:col-span-2">
      <CardHeader className="px-5">
        <CardTitle>最近 30 天</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
          {cfg.keys.map((k, i) => {
            const a = avg(k), m = METRIC_META[k];
            return (
              <span key={k} className="inline-flex items-center gap-1.5 text-xs">
                <span className="size-2 rounded-full" style={{ background: metricColor(k, i) }} />
                {m.label}
                <span className="text-foreground font-medium tabular-nums">{a === null ? "—" : k.endsWith("_min") ? Math.round(a) : a.toFixed(1)}</span>
                <span className="opacity-70">{a === null ? "" : m.unit === "h" ? "h" : m.unit === "/5" ? "/5" : "min"}</span>
              </span>
            );
          })}
          <span className="text-[11px] opacity-60">均值</span>
        </CardDescription>
        <CardAction>
          <Tabs value={tab} onValueChange={(v) => setTab(v as keyof typeof TREND_TABS)}>
            <TabsList>{Object.entries(TREND_TABS).map(([k, t]) => <TabsTrigger key={k} value={k}>{t.label}</TabsTrigger>)}</TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="px-5">
        <MetricChart key={tab} points={trend} keys={[...cfg.keys]} className="aspect-auto h-44 w-full" />
      </CardContent>
    </Card>
  );
}

/* ---------------- 当前处境：Tabs 切换 ---------------- */
function NowCard({ now }: { now: { focus: string; state: string; worry: string; updated: string | null } }) {
  const tabs = ([["focus", "当前重心", now.focus], ["state", "最近状态", now.state], ["worry", "正在困扰", now.worry]] as const).filter(([, , v]) => v);
  const [tab, setTab] = React.useState<string>(tabs[0]?.[0] ?? "focus");
  const cur = tabs.find(([k]) => k === tab) ?? tabs[0];
  return (
    <Card className="gap-3 py-5">
      <CardContent className="flex flex-1 flex-col gap-3 px-5 text-sm">
        {/* 标题 + Tabs 一行 */}
        <div className="flex items-center gap-2">
          <span className="font-semibold">当前处境</span>
          {tabs.length > 0 && (
            <Tabs value={cur[0]} onValueChange={setTab} className="ml-auto">
              <TabsList className="h-8">{tabs.map(([k, label]) => <TabsTrigger key={k} value={k} className="px-2.5 text-xs">{label}</TabsTrigger>)}</TabsList>
            </Tabs>
          )}
        </div>
        {/* 内容在卡片内滚动，卡片高度跟随左侧图表 */}
        <div className="relative min-h-40 flex-1">
          <div className="absolute inset-0 overflow-y-auto pr-1">
            {tabs.length === 0
              ? <p className="text-muted-foreground">写下你此刻的重心、状态和困扰，搭档每次对话都会先读它。</p>
              : <Markdown className="text-[13px] leading-6 [&>*:first-child]:mt-0">{cur[2]}</Markdown>}
          </div>
        </div>
        {/* 底部：左侧更新时间，右侧编辑 */}
        <div className="flex items-center">
          <span className="text-muted-foreground text-[11px]">{now.updated ? `更新于 ${now.updated}` : "还没有填写"}</span>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground -mr-1.5 ml-auto size-7" asChild title="编辑当前处境">
            <Link href="/profile?tab=now"><PencilIcon className="size-3.5" /></Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const MOOD_FACE = [
  null,
  { icon: FrownIcon, label: "很差", cls: "bg-rose-500/12 text-rose-600 dark:text-rose-400" },
  { icon: AnnoyedIcon, label: "低落", cls: "bg-orange-500/12 text-orange-600 dark:text-orange-400" },
  { icon: MehIcon, label: "一般", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  { icon: SmileIcon, label: "不错", cls: "bg-lime-500/15 text-lime-700 dark:text-lime-400" },
  { icon: LaughIcon, label: "很好", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
] as const;
