"use client";
import * as React from "react";
import { toast } from "sonner";
import { PlusIcon, CalendarIcon, FlagIcon, CircleCheckIcon, TargetIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/misc";
import { SectionDoc } from "@/components/section-doc";
import { DomainChip, DomainGlyph, domainColor } from "@/components/domain-icon";
import { api, useApi, useDomains, todayStr } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Page } from "@/components/page";

type Plan = { slug: string; path: string; title: string; status: string; priority: string; domain: string | null; horizon: string | null; due: string | null; progress: number };

const COLUMNS = [
  { id: "todo", label: "待开始", dot: "bg-slate-400", hint: "想做但还没开始" },
  { id: "doing", label: "进行中", dot: "bg-blue-500", hint: "正在推进" },
  { id: "done", label: "已完成", dot: "bg-emerald-500", hint: "做成了" },
  { id: "dropped", label: "已放弃", dot: "bg-muted-foreground/40", hint: "决定不做了" },
];
const PRIORITY: Record<string, { label: string; cls: string }> = {
  high: { label: "高", cls: "text-rose-500" },
  medium: { label: "中", cls: "text-amber-500" },
  low: { label: "低", cls: "text-muted-foreground/60" },
};

function daysUntil(due: string) {
  const a = new Date(todayStr() + "T00:00:00Z").getTime(), b = new Date(due + "T00:00:00Z").getTime();
  return Math.round((b - a) / 864e5);
}
function dueText(due: string) {
  const d = daysUntil(due);
  if (d < 0) return { text: `逾期 ${-d} 天`, cls: "text-rose-600 dark:text-rose-400" };
  if (d === 0) return { text: "今天截止", cls: "text-rose-600 dark:text-rose-400" };
  if (d === 1) return { text: "明天截止", cls: "text-amber-600 dark:text-amber-400" };
  if (d <= 7) return { text: `${d} 天后`, cls: "text-amber-600 dark:text-amber-400" };
  return { text: due.slice(5).replace("-", "/"), cls: "" };
}
const HORIZON: Record<string, string> = { year: "年度", quarter: "季度", month: "月度", week: "本周" };

type DragMeta = {
  slug: string;
  width: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
};

export default function PlansPage() {
  useDomains(); // 加载自定义领域名称
  const { data, loading, reload, setData } = useApi<{ plans: Plan[] }>("/api/plans");
  const [creating, setCreating] = React.useState(false);
  const [open, setOpen] = React.useState<Plan | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("all");
  /** 移动端一次只看一列：默认看「进行中」 */
  const [mCol, setMCol] = React.useState("doing");
  const { domains } = useDomains();
  const [draggingSlug, setDraggingSlug] = React.useState<string | null>(null);
  const dragMeta = React.useRef<DragMeta | null>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const suppressClick = React.useRef(false);

  const endDrag = React.useCallback(() => {
    dragMeta.current = null;
    setDraggingSlug(null);
    setDragOver(null);
  }, []);

  const update = async (slug: string, patch: Partial<Plan>) => {
    setData((d) => d ? { plans: d.plans.map((p) => (p.slug === slug ? { ...p, ...patch } : p)) } : d);
    await api("/api/plans", { method: "POST", json: { slug, ...patch } }).catch(() => reload());
  };

  const onDropColumn = (status: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const slug = e.dataTransfer.getData("text/plain") || dragMeta.current?.slug;
    const p = slug ? data?.plans.find((x) => x.slug === slug) : null;
    endDrag();
    if (p && p.status !== status) void update(p.slug, { status, ...(status === "done" ? { progress: 100 } : {}) });
  };

  const draggingPlan = draggingSlug ? data?.plans.find((p) => p.slug === draggingSlug) : null;

  React.useEffect(() => {
    if (!draggingSlug) return;
    const meta = dragMeta.current;
    const el = overlayRef.current;
    if (meta && el) {
      el.style.width = `${meta.width}px`;
      el.style.transform = `translate3d(${meta.startX}px, ${meta.startY}px, 0)`;
    }
    const moveOverlay = (x: number, y: number) => {
      const m = dragMeta.current;
      const overlay = overlayRef.current;
      if (!m || !overlay) return;
      overlay.style.transform = `translate3d(${x - m.offsetX}px, ${y - m.offsetY}px, 0)`;
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.clientX === 0 && e.clientY === 0) return;
      suppressClick.current = true;
      moveOverlay(e.clientX, e.clientY);
    };
    const onDocDrop = (e: DragEvent) => {
      e.preventDefault();
      endDrag();
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDocDrop);
    document.addEventListener("dragend", endDrag);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDocDrop);
      document.removeEventListener("dragend", endDrag);
    };
  }, [draggingSlug, endDrag]);

  return (
    <Page className="flex min-h-0 flex-1 flex-col gap-4 md:gap-5">
      {/* 页头：标题 + 一行概览 | 新建 */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[28px] leading-tight font-semibold tracking-tight md:text-2xl">计划</h2>
          {data ? <Overview plans={data.plans} /> : <p className="text-muted-foreground mt-1 text-sm">把目标拆成计划，一步步推进。</p>}
        </div>
        <Button onClick={() => setCreating(true)} className="shrink-0 max-sm:size-10 max-sm:rounded-full max-sm:p-0" title="新建计划">
          <PlusIcon /><span className="max-sm:sr-only">新建计划</span>
        </Button>
      </div>

      {/* 领域筛选 */}
      {data && data.plans.length > 0 && (
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0 [&>*]:shrink-0">
          <FilterChip on={filter === "all"} onClick={() => setFilter("all")}>全部<span className="opacity-60">{data.plans.length}</span></FilterChip>
          {domains.filter((d) => data.plans.some((p) => p.domain === d.key)).map((d) => (
            <FilterChip key={d.key} on={filter === d.key} onClick={() => setFilter(d.key)}>
              <DomainGlyph icon={d.icon} className={cn("size-3.5", filter !== d.key && domainColor(d.color).text)} />
              {d.label}<span className="opacity-60">{data.plans.filter((p) => p.domain === d.key).length}</span>
            </FilterChip>
          ))}
        </div>
      )}

      {loading && !data ? (
        <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-80" />)}</div>
      ) : (
        <>
        {/* 移动端：分段切换状态列（触屏不支持拖拽，状态在详情里修改） */}
        <div className="bg-muted -mb-2 grid grid-cols-4 rounded-xl p-1 md:hidden">
          {COLUMNS.map((c) => {
            const n = (data?.plans ?? []).filter((p) => p.status === c.id && (filter === "all" || p.domain === filter)).length;
            const on = mCol === c.id;
            return (
              <button key={c.id} type="button" onClick={() => setMCol(c.id)} aria-pressed={on}
                className={cn("flex h-9 items-center justify-center gap-1 rounded-lg text-[13px] whitespace-nowrap transition-all", on ? "bg-background text-foreground font-medium shadow-xs" : "text-muted-foreground")}>
                {c.label}<span className="text-xs tabular-nums opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = (data?.plans ?? []).filter((p) => p.status === col.id && (filter === "all" || p.domain === filter)).sort((a, b) => ["high", "medium", "low"].indexOf(a.priority) - ["high", "medium", "low"].indexOf(b.priority) || (a.due ?? "9").localeCompare(b.due ?? "9"));
            const over = dragOver === col.id;
            return (
              <div key={col.id}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(col.id); }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
                }}
                onDrop={(e) => onDropColumn(col.id, e)}
                className={cn("flex min-h-64 flex-col gap-2 rounded-2xl border border-transparent bg-muted/40 p-2 transition-all max-md:min-h-40 max-md:bg-transparent max-md:p-0", mCol !== col.id && "max-md:hidden",
                  over && "border-primary/25 bg-accent ring-primary/10 ring-4")}>
                <div className="flex h-9 items-center gap-2 px-2 max-md:hidden">
                  <span className={cn("size-2 rounded-full", col.dot)} />
                  <span className="text-[13px] font-semibold">{col.label}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">{items.length}</span>
                  {col.id === "todo" ? (
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-background ml-auto size-7" onClick={() => setCreating(true)} title="新建计划"><PlusIcon /></Button>
                  ) : <span className="text-muted-foreground/60 ml-auto text-[11px]">{col.hint}</span>}
                </div>
                {items.length === 0 && (
                  <div className={cn("text-muted-foreground/60 flex min-h-24 flex-1 items-center justify-center rounded-xl border border-dashed text-xs transition-colors", over ? "border-primary/40 text-foreground bg-background/60" : "border-foreground/10")}>
                    {over ? "放到这里" : "拖到这里"}
                  </div>
                )}
                {items.map((p) => {
                  const isDragging = draggingSlug === p.slug;
                  return (
                    <div
                      key={p.slug}
                      draggable
                      onDragStart={(e) => {
                        const el = e.currentTarget;
                        const rect = el.getBoundingClientRect();
                        e.dataTransfer.setData("text/plain", p.slug);
                        e.dataTransfer.effectAllowed = "move";
                        const canvas = document.createElement("canvas");
                        canvas.width = 1;
                        canvas.height = 1;
                        e.dataTransfer.setDragImage(canvas, 0, 0);
                        suppressClick.current = false;
                        dragMeta.current = {
                          slug: p.slug,
                          width: rect.width,
                          offsetX: e.clientX - rect.left,
                          offsetY: e.clientY - rect.top,
                          startX: rect.left,
                          startY: rect.top,
                        };
                        setDraggingSlug(p.slug);
                      }}
                      onDragEnd={endDrag}
                      onClick={() => {
                        if (suppressClick.current) { suppressClick.current = false; return; }
                        setOpen(p);
                      }}
                      className={cn(
                        "rounded-xl border p-3.5 transition-all select-none",
                        isDragging
                          ? "bg-foreground/5 cursor-grabbing border-dashed border-foreground/15 shadow-none"
                          : "bg-card hover:border-foreground/20 cursor-grab shadow-xs hover:-translate-y-px hover:shadow-sm active:cursor-grabbing",
                      )}
                    >
                      <div className={cn(isDragging && "invisible")}>
                        <PlanCardBody plan={p} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        </>
      )}

      {draggingPlan && dragMeta.current && (
        <div
          ref={overlayRef}
          className="bg-card pointer-events-none fixed top-0 left-0 z-50 rotate-[1.5deg] rounded-xl border p-3.5 shadow-xl will-change-transform"
          style={{
            width: dragMeta.current.width,
            transform: `translate3d(${dragMeta.current.startX}px, ${dragMeta.current.startY}px, 0)`,
          }}
        >
          <PlanCardBody plan={draggingPlan} />
        </div>
      )}

      <NewPlanDialog open={creating} onOpenChange={setCreating} onCreated={reload} />
      <Sheet open={!!open} onOpenChange={(o) => { if (!o) { setOpen(null); void reload(); } }}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
          {open && (
            <>
              <SheetHeader className="gap-2 border-b px-6 pt-6 pb-5">
                <div className="flex flex-wrap items-center gap-2 pr-8">
                  {open.domain && <DomainChip k={open.domain} />}
                  {open.horizon && <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[11px]">{HORIZON[open.horizon]}</span>}
                </div>
                <SheetTitle className="text-xl leading-snug">{open.title}</SheetTitle>
                <SheetDescription>改动会即时保存，搭档对话时也能读到这里的内容。</SheetDescription>
              </SheetHeader>
              <div className="grid gap-6 px-6 py-5">
                <div className="bg-muted/35 grid items-center gap-x-4 gap-y-3.5 rounded-xl border p-4 text-sm sm:grid-cols-[84px_1fr]">
                  <PropLabel icon={TargetIcon}>状态</PropLabel>
                  <div className="flex flex-wrap gap-1">
                    {COLUMNS.map((c) => (
                      <button key={c.id} onClick={() => { const patch = { status: c.id, ...(c.id === "done" ? { progress: 100 } : {}) }; setOpen({ ...open, ...patch }); void update(open.slug, patch); }}
                        className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50", open.status === c.id ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted")}>
                        <span className={cn("size-1.5 rounded-full", open.status === c.id ? "bg-primary-foreground" : c.dot)} />{c.label}
                      </button>
                    ))}
                  </div>
                  <PropLabel icon={FlagIcon}>优先级</PropLabel>
                  <div className="flex gap-1">
                    {Object.entries(PRIORITY).map(([k, v]) => (
                      <button key={k} onClick={() => { setOpen({ ...open, priority: k }); void update(open.slug, { priority: k }); }}
                        className={cn("inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50", open.priority === k ? "border-foreground/30 font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                        <FlagIcon className={cn("size-3", v.cls)} />{v.label}
                      </button>
                    ))}
                  </div>
                  <PropLabel icon={CalendarIcon}>截止日期</PropLabel>
                  <div className="flex items-center gap-3">
                    <Input type="date" className="bg-background h-8 w-44" value={open.due ?? ""} onChange={(e) => { setOpen({ ...open, due: e.target.value }); void update(open.slug, { due: e.target.value }); }} />
                    {open.due && open.status !== "done" && <span className={cn("text-xs", dueText(open.due).cls || "text-muted-foreground")}>{dueText(open.due).text}</span>}
                  </div>
                  <PropLabel icon={TrendingUpIcon}>进度</PropLabel>
                  <div className="flex items-center gap-3">
                    <Slider className="flex-1" value={[open.progress]} max={100} step={5} onValueChange={(v) => setOpen({ ...open, progress: v[0] })} onValueCommit={(v) => update(open.slug, { progress: v[0] })} />
                    <span className="w-10 text-right text-sm font-medium tabular-nums">{open.progress}%</span>
                  </div>
                </div>
                <SectionDoc key={open.path} path={open.path} title="计划内容" bare />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Page>
  );
}

function PropLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return <div className="text-muted-foreground flex items-center gap-1.5 text-xs"><Icon className="size-3.5" />{children}</div>;
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
      on ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted")}>{children}</button>
  );
}

/** 页头下的一行概览：单行、不换行 */
function Overview({ plans }: { plans: Plan[] }) {
  const doing = plans.filter((p) => p.status === "doing").length;
  const todo = plans.filter((p) => p.status === "todo").length;
  const soon = plans.filter((p) => p.due && (p.status === "todo" || p.status === "doing") && daysUntil(p.due) <= 7).length;
  const valid = plans.filter((p) => p.status !== "dropped");
  const rate = valid.length ? Math.round((plans.filter((p) => p.status === "done").length / valid.length) * 100) : 0;
  const Item = ({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) => (
    <span className={cn("inline-flex items-baseline gap-1 whitespace-nowrap", warn && "text-amber-600 dark:text-amber-400")}>
      {label}<b className={cn("font-semibold tabular-nums", !warn && "text-foreground")}>{value}</b>
    </span>
  );
  return (
    <div className="text-muted-foreground no-scrollbar mt-1 flex items-center gap-2.5 overflow-x-auto text-sm">
      <Item label="进行中" value={doing} />
      <span className="opacity-40">·</span>
      <Item label="待开始" value={todo} />
      {soon > 0 && <><span className="opacity-40">·</span><Item label="7 天内到期" value={soon} warn /></>}
      <span className="opacity-40">·</span>
      <Item label="完成率" value={`${rate}%`} />
    </div>
  );
}

function PlanCardBody({ plan: p }: { plan: Plan }) {
  const done = p.status === "done", dropped = p.status === "dropped";
  const due = p.due && !done && !dropped ? dueText(p.due) : null;
  const pr = PRIORITY[p.priority];
  const showProgress = p.status === "doing" || (p.progress > 0 && !done && !dropped);
  return (
    <div className={cn(dropped && "opacity-55")}>
      {/* 标题 + 优先级 */}
      <div className="flex items-start gap-2">
        {done && <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-500" />}
        <div className={cn("line-clamp-2 flex-1 text-sm leading-5 font-medium", (done || dropped) && "text-muted-foreground", dropped && "line-through")}>{p.title}</div>
        {pr && !done && !dropped && p.priority !== "low" && (
          <FlagIcon className={cn("mt-0.5 size-3.5 shrink-0", pr.cls)} fill={p.priority === "high" ? "currentColor" : "none"} aria-label={`优先级：${pr.label}`} />
        )}
      </div>
      {/* 进度 */}
      {showProgress && (
        <div className="mt-3 flex items-center gap-2">
          <span className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
            <span className={cn("absolute inset-y-0 left-0 rounded-full transition-all", p.progress >= 100 ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${p.progress}%` }} />
          </span>
          <span className="text-muted-foreground w-8 text-right text-[11px] font-medium tabular-nums">{p.progress}%</span>
        </div>
      )}
      {/* 领域 · 周期 · 截止 */}
      {(p.domain || p.horizon || due) && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px]">
          {p.domain && <DomainChip k={p.domain} />}
          {p.horizon && <span className="text-muted-foreground bg-muted rounded px-1.5 py-px">{HORIZON[p.horizon]}</span>}
          {due && <span className={cn("text-muted-foreground ml-auto inline-flex items-center gap-1", due.cls)}><CalendarIcon className="size-3" />{due.text}</span>}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-2"><Label className="text-xs">{label}</Label>{children}</div>;
}

function NewPlanDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { domains } = useDomains();
  const [f, setF] = React.useState({ title: "", domain: "learning", priority: "medium", horizon: "month", due: "", why: "", done: "" });
  const submit = async () => {
    if (!f.title.trim()) return toast.error("请填写标题");
    const body = `# ${f.title}\n\n## 为什么要做\n\n${f.why}\n\n## 完成标准\n\n${f.done}\n\n## 步骤\n\n- [ ] \n\n## 进展记录\n`;
    await api("/api/plans", { method: "POST", json: { title: f.title.trim(), domain: f.domain, priority: f.priority, horizon: f.horizon, due: f.due || undefined, status: "todo", progress: 0, body } });
    toast.success("计划已创建");
    setF({ title: "", domain: "learning", priority: "medium", horizon: "month", due: "", why: "", done: "" });
    onOpenChange(false);
    onCreated();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>新建计划</DialogTitle><DialogDescription>写清楚为什么要做、怎样算完成，会更容易坚持下去。</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Field label="标题"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="例如：12 月雅思考到 7 分" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="领域">
              <Select value={f.domain} onValueChange={(v) => setF({ ...f, domain: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{domains.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="优先级">
              <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PRIORITY).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="周期">
              <Select value={f.horizon} onValueChange={(v) => setF({ ...f, horizon: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(HORIZON).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="截止日期"><Input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
          <Field label="为什么要做"><Input value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} /></Field>
          <Field label="完成标准"><Input value={f.done} onChange={(e) => setF({ ...f, done: e.target.value })} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={submit}>创建</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
