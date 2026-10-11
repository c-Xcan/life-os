"use client";
import * as React from "react";
import { toast } from "sonner";
import {
  ChevronDownIcon, ExternalLinkIcon, LanguagesIcon, LoaderCircleIcon, Settings2Icon, NewspaperIcon, PlusIcon, RefreshCwIcon, RssIcon, SearchIcon, SparklesIcon, Trash2Icon, XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Page, PageHeader } from "@/components/page";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

type Item = { id: string; source_id: string; source_name: string; category: string; title: string; url: string; summary: string | null; title_zh: string | null; summary_zh: string | null; published_at: string | null; score: number; matched: string[] };
type Source = { id: string; name: string; url: string; category: string; enabled: boolean; builtin?: boolean; state: { last_ok: string | null; last_error: string | null; item_count: number; last_fetch: string | null } | null };
type Res = {
  items: Item[]; categories: { key: string; label: string }[]; sources: Source[];
  keywords: string[]; muted: string[]; autoInterests: { key: string; label: string; source: string }[]; lastRefresh: string | null;
  translate: boolean; canTranslate: boolean; pendingTranslation: number; translating: boolean;
  total: number; page: number; pageSize: number;
};

const CAT_CLS: Record<string, string> = {
  ai: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  dev: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  tech: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  finance: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  other: "bg-muted text-muted-foreground",
};

function ago(iso: string | null) {
  if (!iso) return "";
  const m = (Date.now() - Date.parse(iso)) / 60000;
  if (m < 1) return "刚刚";
  if (m < 60) return `${Math.floor(m)} 分钟前`;
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`;
  if (m < 1440 * 7) return `${Math.floor(m / 1440)} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

function dayLabel(iso: string | null) {
  if (!iso) return "更早";
  const d = new Date(iso), t = new Date();
  const k = (x: Date) => x.toLocaleDateString("zh-CN");
  if (k(d) === k(t)) return "今天";
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (k(d) === k(y)) return "昨天";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${"日一二三四五六"[d.getDay()]}`;
}

export default function NewsPage() {
  const [view, setView] = React.useState<"recommend" | "latest">("recommend");
  const [cat, setCat] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [data, setData] = React.useState<Res | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const autoTried = React.useRef(false);
  const [page, setPage] = React.useState(1);
  const url = `/api/news?view=${view}&category=${cat}&q=${encodeURIComponent(query)}&page=${page}&pageSize=20`;
  // 切换视图 / 分类 / 搜索时回到第一页
  React.useEffect(() => { setPage(1); }, [view, cat, query]);
  const listTop = React.useRef<HTMLDivElement>(null);
  const goPage = (p: number) => { setPage(p); listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const [showOrig, setShowOrig] = React.useState(false);
  const [settings, setSettings] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { setData(await api<Res>(url)); } finally { setLoading(false); }
  }, [url]);
  React.useEffect(() => { void load(); }, [load]);

  const refresh = React.useCallback(async (silent = false) => {
    setRefreshing(true);
    try {
      const r = await api<{ ok: number; failed: number; created: number }>("/api/news", { method: "POST", json: { action: "refresh" } });
      if (!silent) toast.success(`已更新：新增 ${r.created} 条${r.failed ? `，${r.failed} 个信源失败` : ""}`);
      await load();
    } finally { setRefreshing(false); }
  }, [load]);

  // 还有外文在翻译时，每 6 秒静默刷新一次列表，直到译完
  const polls = React.useRef(0);
  React.useEffect(() => { polls.current = 0; }, [url, refreshing]);
  React.useEffect(() => {
    if (!data?.pendingTranslation || polls.current >= 15) return; // 最多轮询约 90 秒，避免模型不可用时一直请求
    polls.current++;
    const t = setTimeout(async () => { try { setData(await api<Res>(url)); } catch { /* 忽略 */ } }, 6000);
    return () => clearTimeout(t);
  }, [data, url]);

  // 第一次打开或超过 1 小时没更新时，自动抓一次
  React.useEffect(() => {
    if (!data || autoTried.current) return;
    autoTried.current = true;
    if (!data.lastRefresh || Date.now() - Date.parse(data.lastRefresh) > 60 * 60_000) void refresh(true);
  }, [data, refresh]);

  const groups = React.useMemo(() => {
    const out: { label: string; items: Item[] }[] = [];
    for (const it of data?.items ?? []) {
      const l = view === "recommend" ? "" : dayLabel(it.published_at);
      const last = out.at(-1);
      if (last && last.label === l) last.items.push(it); else out.push({ label: l, items: [it] });
    }
    return out;
  }, [data, view]);

  const catLabel = (k: string) => data?.categories.find((c) => c.key === k)?.label ?? k;

  return (
    <Page>
      <PageHeader
        title="资讯"
        description="从你订阅的信源实时汇总，并结合你的档案、计划和记忆推荐。"
        actions={<>
          {data?.pendingTranslation ? (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs"><LoaderCircleIcon className="size-3 animate-spin" />正在翻译 {data.pendingTranslation} 条</span>
          ) : data?.lastRefresh && <span className="text-muted-foreground text-xs">更新于 {ago(data.lastRefresh)}</span>}
          <Button variant="outline" size="sm" onClick={() => refresh()} disabled={refreshing}>
            {refreshing ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}{refreshing ? "抓取中…" : "刷新"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettings(true)}><Settings2Icon />信源设置</Button>
        </>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div ref={listTop} className="min-w-0 scroll-mt-16 space-y-4">
          {/* 工具栏 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-muted flex rounded-lg p-0.5">
              {([["recommend", "为你推荐", SparklesIcon], ["latest", "最新", NewspaperIcon]] as const).map(([v, l, Icon]) => (
                <button key={v} onClick={() => setView(v)}
                  className={cn("flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all [&_svg]:size-3.5", view === v ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                  <Icon />{l}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {[{ key: "all", label: "全部" }, ...(data?.categories ?? [])].map((c) => (
                <button key={c.key} onClick={() => setCat(c.key)}
                  className={cn("rounded-full px-2.5 py-1 text-xs transition-colors", cat === c.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                  {c.label}
                </button>
              ))}
            </div>
            {data?.items.some((x) => x.title_zh && x.title_zh !== x.title) && (
              <button onClick={() => setShowOrig((v) => !v)} title="切换中文译文 / 原文"
                className="text-muted-foreground hover:text-foreground hover:bg-muted ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs">
                <LanguagesIcon className="size-3.5" />{showOrig ? "原文" : "中文"}
              </button>
            )}
            <form className={cn("max-sm:w-full", !data?.items.some((x) => x.title_zh && x.title_zh !== x.title) && "ml-auto")} onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
              <div className="bg-card focus-within:ring-ring/40 flex items-center gap-1.5 rounded-lg border px-2.5 focus-within:ring-2">
                <SearchIcon className="text-muted-foreground size-3.5" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题和摘要" className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none sm:h-8 sm:w-40 sm:flex-none sm:text-sm" />
                {query && <button type="button" onClick={() => { setQ(""); setQuery(""); }} className="text-muted-foreground hover:text-foreground"><XIcon className="size-3.5" /></button>}
              </div>
            </form>
          </div>

          {view === "recommend" && cat === "all" && !query && page === 1 && <BriefCard />}

          {/* 列表 */}
          {loading && !data ? (
            <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : !data?.items.length ? (
            <Empty className="bg-card min-h-80 border-solid shadow-xs">
              <EmptyHeader>
                <EmptyMedia variant="icon">{refreshing ? <LoaderCircleIcon className="animate-spin" /> : <NewspaperIcon />}</EmptyMedia>
                <EmptyTitle>{refreshing ? "正在抓取资讯…" : view === "recommend" && !query ? "还没有和你相关的资讯" : "没有找到资讯"}</EmptyTitle>
                <EmptyDescription>
                  {refreshing ? "第一次抓取需要几十秒。" : view === "recommend" ? "可以在右侧添加兴趣关键词，或切到「最新」看看全部。" : "试试刷新，或者换个分类。"}
                </EmptyDescription>
              </EmptyHeader>
              {!refreshing && <EmptyContent><Button variant="outline" size="sm" onClick={() => refresh()}><RefreshCwIcon />立即刷新</Button></EmptyContent>}
            </Empty>
          ) : (
            <div className={cn("space-y-5 transition-opacity", loading && "opacity-60")}>
              {groups.map((g, gi) => (
                <section key={gi}>
                  {g.label && <h3 className="text-muted-foreground mb-2 px-1 text-xs font-medium">{g.label}</h3>}
                  <div className="bg-card divide-y overflow-hidden rounded-xl border shadow-xs">
                    {g.items.map((it) => (
                      <a key={it.id} href={it.url} target="_blank" rel="noreferrer" className="group hover:bg-muted/40 block px-4 py-3.5 transition-colors">
                        <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className={cn("rounded px-1.5 py-px text-[11px]", CAT_CLS[it.category] ?? CAT_CLS.other)}>{catLabel(it.category)}</span>
                          <span className="text-foreground/70 font-medium">{it.source_name}</span>
                          <span>{ago(it.published_at)}</span>
                          {it.matched.length > 0 && (
                            <span className="ml-auto inline-flex items-center gap-1 text-violet-600 dark:text-violet-400"><SparklesIcon className="size-3" />{it.matched.join(" · ")}</span>
                          )}
                        </div>
                        <div className="flex items-start gap-2">
                          <h4 className="flex-1 text-[15px] leading-snug font-medium group-hover:underline group-hover:underline-offset-4" title={!showOrig && it.title_zh ? it.title : undefined}>{(!showOrig && it.title_zh) || it.title}</h4>
                          <ExternalLinkIcon className="text-muted-foreground mt-1 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                        {((!showOrig && it.summary_zh) || it.summary) && <p className="text-muted-foreground mt-1 line-clamp-2 text-[13px] leading-5">{(!showOrig && it.summary_zh) || it.summary}</p>}
                      </a>
                    ))}
                  </div>
                </section>
              ))}
              <Pager page={data.page} pages={Math.max(1, Math.ceil(data.total / data.pageSize))} total={data.total} onGo={goPage} />
            </div>
          )}
        </div>

        {/* 侧栏 */}
        <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          {data && <InterestsCard data={data} onChange={load} />}
        </aside>
      </div>

      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="gap-0 p-0 sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>信源设置</DialogTitle>
          </DialogHeader>
          {data && <SourcesPanel data={data} onChange={load} />}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

type Brief = { headline: string; points: { text: string; ids: string[] }[]; at: string; refs: Record<string, { title: string; url: string; source: string }> };

/** 「为你推荐」顶部的 AI 速览：先显示缓存，再按需重新生成 */
function BriefCard() {
  const [brief, setBrief] = React.useState<Brief | null>(null);
  const [available, setAvailable] = React.useState(true);
  const [busy, setBusy] = React.useState(true);
  // 展开 / 收起，记在浏览器里
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => { try { if (localStorage.getItem("news-brief-open") === "0") setOpen(false); } catch { /* 忽略 */ } }, []);
  const toggle = () => setOpen((v) => { try { localStorage.setItem("news-brief-open", v ? "0" : "1"); } catch { /* 忽略 */ } return !v; });
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await api<{ brief: Brief | null; available: boolean }>("/api/news/brief?cached=1");
        if (!alive) return;
        setAvailable(c.available);
        if (c.brief) setBrief(c.brief);
        if (!c.available) return;
        const r = await api<{ brief: Brief | null }>("/api/news/brief");
        if (alive && r.brief) setBrief(r.brief);
      } catch { /* 忽略 */ } finally { if (alive) setBusy(false); }
    })();
    return () => { alive = false; };
  }, []);
  const regen = async () => {
    setBusy(true);
    try { const r = await api<{ brief: Brief | null }>("/api/news/brief", { method: "POST", json: {} }); if (r.brief) setBrief(r.brief); } finally { setBusy(false); }
  };
  if (!available) return null;
  return (
    <section className="relative overflow-hidden rounded-xl border border-violet-500/15 bg-linear-to-br from-violet-500/[0.06] via-sky-500/[0.03] to-transparent p-4 shadow-xs">
      <div className="flex items-center gap-2">
        <button onClick={toggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <SparklesIcon className="size-4 shrink-0 text-violet-500" />
          <span className="shrink-0 text-sm font-semibold">今日速览</span>
          {!open && brief ? <span className="text-muted-foreground truncate text-sm">{brief.headline}</span>
            : brief && <span className="text-muted-foreground text-xs">{ago(brief.at)}生成</span>}
        </button>
        {open && (
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground size-7" onClick={regen} disabled={busy} title="重新生成">
            {busy ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground size-7" onClick={toggle} title={open ? "收起" : "展开"}>
          <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      {!open ? null : !brief ? (
        busy ? (
          <div className="mt-3 space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /></div>
        ) : <p className="text-muted-foreground mt-2 text-sm">推荐的资讯还不够多，刷新一下再来看看。</p>
      ) : (
        <>
          <p className="mt-2 text-[15px] leading-snug font-medium">{brief.headline}</p>
          <ul className="mt-2.5 space-y-2">
            {brief.points.map((pt, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-6">
                <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-violet-400" />
                <span className="min-w-0">
                  {pt.text}
                  {pt.ids.map((id) => brief.refs[id] && (
                    <a key={id} href={brief.refs[id].url} target="_blank" rel="noreferrer" title={brief.refs[id].title}
                      className="text-muted-foreground hover:text-foreground ml-1.5 inline-flex max-w-48 items-center gap-0.5 rounded border px-1.5 align-middle text-[11px] leading-5 transition-colors">
                      <span className="truncate">{brief.refs[id].source}</span><ExternalLinkIcon className="size-2.5 shrink-0" />
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Pager({ page, pages, total, onGo }: { page: number; pages: number; total: number; onGo: (p: number) => void }) {
  if (pages <= 1) return <p className="text-muted-foreground py-2 text-center text-xs">共 {total} 条</p>;
  // 页码：首尾 + 当前页前后各 1 页，中间用省略号
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm tabular-nums transition-colors";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <span className="text-muted-foreground text-xs">共 {total} 条 · 第 {page}/{pages} 页</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onGo(page - 1)}>上一页</Button>
        {nums.map((n, i) => (
          <React.Fragment key={n}>
            {i > 0 && n - nums[i - 1] > 1 && <span className="text-muted-foreground px-1 text-sm">…</span>}
            <button onClick={() => onGo(n)} className={cn(btn, n === page ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{n}</button>
          </React.Fragment>
        ))}
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onGo(page + 1)}>下一页</Button>
      </div>
    </div>
  );
}

function InterestsCard({ data, onChange }: { data: Res; onChange: () => void }) {
  const [kw, setKw] = React.useState("");
  const post = async (json: unknown) => { await api("/api/news", { method: "POST", json }); onChange(); };
  const add = () => { const w = kw.trim(); if (!w) return; setKw(""); void post({ action: "setKeywords", keywords: [...data.keywords, w] }); };
  return (
    <div className="bg-card rounded-xl border p-4 shadow-xs">
      <div className="text-sm font-semibold">我的兴趣</div>
      <p className="text-muted-foreground mt-0.5 text-xs">从档案、计划和记忆里自动识别；点一下可以暂时忽略。</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {data.keywords.map((k) => (
          <span key={k} className="bg-foreground text-background inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs">
            {k}
            <button onClick={() => post({ action: "setKeywords", keywords: data.keywords.filter((x) => x !== k) })} className="rounded-full p-0.5 opacity-70 hover:opacity-100"><XIcon className="size-3" /></button>
          </span>
        ))}
        {data.autoInterests.map((i) => {
          const off = data.muted.includes(i.key);
          return (
            <button key={i.key} onClick={() => post({ action: "toggleMute", key: i.key })} title={off ? "点击恢复" : "点击忽略"}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors", off ? "text-muted-foreground/60 border-dashed line-through" : "hover:bg-muted")}>
              {i.label}
            </button>
          );
        })}
        {!data.keywords.length && !data.autoInterests.length && <span className="text-muted-foreground text-xs">还没有识别到兴趣，先手动添加几个吧。</span>}
      </div>
      <form className="mt-3 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="添加关键词，如 Next.js" className="h-8 text-sm" />
        <Button type="submit" size="sm" variant="outline" disabled={!kw.trim()}><PlusIcon /></Button>
      </form>
    </div>
  );
}

function SourcesPanel({ data, onChange }: { data: Res; onChange: () => void }) {
  const [adding, setAdding] = React.useState(false);
  const [f, setF] = React.useState({ name: "", url: "", category: "tech" });
  const [busy, setBusy] = React.useState(false);
  const post = async (json: unknown) => { await api("/api/news", { method: "POST", json }); onChange(); };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ found: number }>("/api/news", { method: "POST", json: { action: "addSource", ...f } });
      toast.success(`已添加，抓到 ${r.found} 条`);
      setF({ name: "", url: "", category: "tech" }); setAdding(false); onChange();
    } finally { setBusy(false); }
  };
  const groups = data.categories.map((c) => ({ ...c, items: data.sources.filter((s) => s.category === c.key) })).filter((g) => g.items.length);
  return (
    <div>
      <label className="flex items-center gap-3 border-b px-5 py-3">
        <LanguagesIcon className="text-muted-foreground size-4" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">外文资讯翻译成中文</span>
          {!data.canTranslate && <span className="text-muted-foreground block text-xs">需要先在「设置」里配置模型 API Key</span>}
        </span>
        <Switch checked={data.translate} disabled={!data.canTranslate} onCheckedChange={(v) => post({ action: "setTranslate", enabled: v })} />
      </label>
      <div className="flex items-center gap-2 px-5 pt-3 pb-1">
        <RssIcon className="text-muted-foreground size-4" />
        <span className="text-sm font-medium">信源</span>
        <span className="text-muted-foreground text-xs">已启用 {data.sources.filter((s) => s.enabled).length}/{data.sources.length}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAdding((v) => !v)}><PlusIcon />添加</Button>
      </div>
      {adding && (
        <form onSubmit={add} className="bg-muted/40 mx-5 my-2 space-y-2 rounded-lg p-3">
          <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="RSS / Atom 地址" className="bg-background h-8 text-sm" autoFocus />
          <div className="flex gap-2">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="名称（可选）" className="bg-background h-8 text-sm" />
            <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
              <SelectTrigger className="bg-background h-8 w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{data.categories.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>取消</Button>
            <Button type="submit" size="sm" disabled={busy || !f.url.trim()}>{busy && <LoaderCircleIcon className="animate-spin" />}试抓并添加</Button>
          </div>
        </form>
      )}
      <div className="max-h-[52vh] overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-medium">{g.label}</div>
            {g.items.map((s) => {
              const st = s.state;
              const dot = !s.enabled ? "bg-muted-foreground/30" : !st ? "bg-muted-foreground/40" : st.last_error ? "bg-rose-500" : "bg-emerald-500";
              return (
                <div key={s.id} className="group hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5">
                  <span className={cn("size-1.5 shrink-0 rounded-full", dot)} title={st?.last_error ? `抓取失败：${st.last_error}` : st?.last_ok ? `上次成功 ${ago(st.last_ok)}` : "还没抓过"} />
                  <span className={cn("min-w-0 flex-1 truncate text-[13px]", !s.enabled && "text-muted-foreground")} title={s.url}>{s.name}</span>
                  <span className="text-muted-foreground text-[11px] tabular-nums">{st?.item_count ?? 0}</span>
                  {!s.builtin && (
                    <button onClick={() => post({ action: "removeSource", id: s.id })} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100" title="删除"><Trash2Icon className="size-3.5" /></button>
                  )}
                  <Switch checked={s.enabled} onCheckedChange={(v) => post({ action: "toggleSource", id: s.id, enabled: v })} className="scale-75" />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
