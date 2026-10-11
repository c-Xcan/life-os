"use client";
import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, CompassIcon, LayoutGridIcon, MessageCircleHeartIcon, MilestoneIcon, PlusIcon, Trash2Icon, UserRoundIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionDoc } from "@/components/section-doc";
import { DomainIcon, DOMAIN_COLORS, DOMAIN_ICONS, domainColor } from "@/components/domain-icon";
import { api, useApi, reloadDomains, type DomainInfo } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/components/page";

type Stat = { exists: boolean; filled: number; total: number; updated: string | null };
type Overview = { docs: Record<string, Stat>; domains: (DomainInfo & Stat)[] };

const TABS: { id: string; label: string; path: string; icon: LucideIcon; tip: string }[] = [
  { id: "now", label: "当前处境", path: "now.md", icon: CompassIcon, tip: "此刻的重心、状态和困扰。搭档每次对话都会先看这里，建议每 1–2 周更新。" },
  { id: "identity", label: "我是谁", path: "profile/identity.md", icon: UserRoundIcon, tip: "相对稳定的个人信息、性格和价值观。" },
  { id: "background", label: "经历", path: "profile/background.md", icon: MilestoneIcon, tip: "教育、工作和技能背景。" },
  { id: "domains", label: "领域档案", path: "", icon: LayoutGridIcon, tip: "按人生领域分别记录长期情况，可以新增自己的领域。" },
  { id: "preferences", label: "搭档偏好", path: "memory/preferences.md", icon: MessageCircleHeartIcon, tip: "你希望搭档怎样和你沟通、怎样帮你做事。" },
];

export default function ProfilePage() {
  return <React.Suspense fallback={<div className="p-6"><Skeleton className="h-96" /></div>}><Inner /></React.Suspense>;
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = TABS.some((t) => t.id === sp.get("tab")) ? sp.get("tab")! : "now";
  const { data, reload } = useApi<Overview>("/api/profile");
  const domains = data?.domains ?? [];
  const domainParam = sp.get("domain");
  const domain = domains.find((d) => d.key === domainParam) ?? domains[0];
  const [creating, setCreating] = React.useState(false);

  const go = (t: string, d?: string) => router.replace(`/profile?tab=${t}${d ? `&domain=${d}` : ""}`, { scroll: false });

  // 整体完成度：4 份基础档案 + 所有领域
  const stats = data ? [...Object.values(data.docs), ...domains] : [];
  const filled = stats.reduce((a, s) => a + s.filled, 0);
  const total = stats.reduce((a, s) => a + s.total, 0);
  const pct = total ? Math.round((filled / total) * 100) : 0;

  const tabStat = (id: string) => {
    if (!data) return null;
    if (id === "domains") {
      const done = domains.filter((d) => d.total && d.filled === d.total).length;
      const started = domains.filter((d) => d.filled > 0).length;
      return { text: `${domains.length} 个领域 · ${started} 个已动笔`, ratio: domains.length ? started / domains.length : 0, done: done === domains.length && domains.length > 0 };
    }
    const s = data.docs[TABS.find((t) => t.id === id)!.path];
    if (!s) return null;
    return { text: s.total ? `${s.filled}/${s.total} 已填写` : "未开始", ratio: s.total ? s.filled / s.total : 0, done: s.total > 0 && s.filled === s.total };
  };

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <Page>
      <PageHeader
        title="档案"
        description="搭档了解你的底稿 —— 写得越具体，建议越贴合你。"
        actions={data && (
          <div className="bg-card flex items-center gap-3 rounded-xl border px-4 py-2.5 shadow-xs">
            <Ring value={pct} />
            <div className="leading-tight">
              <div className="text-sm font-medium tabular-nums">{pct}%</div>
              <div className="text-muted-foreground text-xs">整体完成度 · {filled}/{total} 小节</div>
            </div>
          </div>
        )}
      />

      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        {/* 左侧导航 */}
        <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:sticky md:top-16 md:mx-0 md:flex-col md:self-start md:overflow-visible md:px-0 md:pb-0">
          {TABS.map((t) => {
            const s = tabStat(t.id);
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                className={cn(
                  "group flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors md:py-2.5",
                  active ? "bg-card ring-border shadow-xs ring-1" : "hover:bg-muted/60",
                )}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md transition-colors [&_svg]:size-4", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground")}>
                  <t.icon />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm", active ? "font-medium" : "text-foreground/80")}>{t.label}</span>
                  <span className="text-muted-foreground hidden truncate text-xs md:block">{s ? s.text : "…"}</span>
                </span>
                {s && <span className={cn("ml-auto hidden size-1.5 shrink-0 rounded-full md:block", s.done ? "bg-emerald-500" : s.ratio > 0 ? "bg-amber-400" : "bg-muted-foreground/25")} />}
              </button>
            );
          })}
        </nav>

        {/* 右侧内容 */}
        <div className="min-w-0 space-y-4">
          {tab === "domains" ? (
            <>
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold tracking-tight">领域档案</h3>
                  <p className="text-muted-foreground mt-0.5 text-sm">{current.tip}</p>
                </div>
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => setCreating(true)}><PlusIcon />新增领域</Button>
              </div>
              {!data ? (
                <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[74px] w-52 shrink-0" />)}</div>
              ) : (
                <DragScroller activeKey={domain?.key}>
                  {domains.map((d) => (
                    <DomainCard key={d.key} d={d} active={d.key === domain?.key} onClick={() => go("domains", d.key)} />
                  ))}
                </DragScroller>
              )}
              {domain && (
                <SectionDoc
                  key={domain.key}
                  path={domain.path}
                  title={domain.label}
                  description={domain.description || undefined}
                  leading={<DomainIcon icon={domain.icon} color={domain.color} size="md" />}
                  accentClass={domainColor(domain.color).bar}
                  onSaved={() => { void reload(); void reloadDomains(); }}
                  actions={!domain.builtin && <DeleteDomain d={domain} onDeleted={() => { void reload(); void reloadDomains(); go("domains"); }} />}
                />
              )}
            </>
          ) : (
            <SectionDoc
              key={current.id}
              path={current.path}
              title={current.label}
              description={current.tip}
              leading={<span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4"><current.icon /></span>}
              onSaved={() => void reload()}
            />
          )}
        </div>
      </div>

      <NewDomainDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (key) => { await Promise.all([reload(), reloadDomains()]); go("domains", key); }}
      />
    </Page>
  );
}

function Ring({ value }: { value: number }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" className="stroke-muted" />
      <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" strokeLinecap="round" className="stroke-primary transition-all" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
    </svg>
  );
}

function DomainCard({ d, active, onClick }: { d: DomainInfo & Stat; active: boolean; onClick: () => void }) {
  const col = domainColor(d.color);
  return (
    <button
      data-key={d.key}
      onClick={onClick}
      draggable={false}
      className={cn(
        "bg-card flex w-52 shrink-0 items-start gap-2.5 rounded-xl border p-3.5 text-left transition-all select-none",
        active ? cn("shadow-sm ring-2", col.ring) : "hover:border-foreground/20 hover:shadow-xs",
      )}
    >
      <DomainIcon icon={d.icon} color={d.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{d.label}</span>
          {!d.builtin && <span className="text-muted-foreground bg-muted rounded px-1 py-px text-[10px]">自定义</span>}
        </div>
        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">{d.description || "　"}</p>
      </div>
    </button>
  );
}

/** 横向滚动容器：支持鼠标拖拽滚动、滚轮横向滚动，两侧按可滚动方向渐隐 */
function DragScroller({ children, activeKey }: { children: React.ReactNode; activeKey?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef({ down: false, moved: false, x: 0, left: 0 });
  const [edges, setEdges] = React.useState({ l: false, r: false });

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // 竖向滚轮转为横向滚动（只在确实可以横向滚动时拦截）
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
      if (atStart || atEnd) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", onWheel); };
  }, [update, children]);

  // 选中的卡片自动滚到可见区域
  React.useEffect(() => {
    const el = ref.current;
    const card = activeKey ? el?.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeKey)}"]`) : null;
    if (!el || !card) return;
    const l = card.offsetLeft - el.offsetLeft, r = l + card.offsetWidth;
    if (l < el.scrollLeft + 24) el.scrollTo({ left: l - 32, behavior: "smooth" });
    else if (r > el.scrollLeft + el.clientWidth - 24) el.scrollTo({ left: r - el.clientWidth + 32, behavior: "smooth" });
  }, [activeKey]);

  const fade = 48;
  const mask = `linear-gradient(to right, ${edges.l ? "transparent" : "#000"} 0, #000 ${edges.l ? fade : 0}px, #000 calc(100% - ${edges.r ? fade : 0}px), ${edges.r ? "transparent" : "#000"} 100%)`;

  const page = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: "smooth" });
  };
  const arrow = "bg-background/90 text-foreground hover:bg-accent absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-all [&_svg]:size-4";

  return (
    <div className="relative">
    <button type="button" aria-label="向左滚动" onClick={() => page(-1)} tabIndex={edges.l ? 0 : -1}
      className={cn(arrow, "-left-3", edges.l ? "opacity-100" : "pointer-events-none opacity-0")}><ChevronLeftIcon /></button>
    <button type="button" aria-label="向右滚动" onClick={() => page(1)} tabIndex={edges.r ? 0 : -1}
      className={cn(arrow, "-right-3", edges.r ? "opacity-100" : "pointer-events-none opacity-0")}><ChevronRightIcon /></button>
    <div
      ref={ref}
      onScroll={update}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        drag.current = { down: true, moved: false, x: e.clientX, left: ref.current!.scrollLeft };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d.down) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) > 4) { d.moved = true; ref.current!.setPointerCapture(e.pointerId); }
        if (d.moved) ref.current!.scrollLeft = d.left - dx;
      }}
      onPointerUp={(e) => {
        drag.current.down = false;
        if (ref.current!.hasPointerCapture(e.pointerId)) ref.current!.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => { drag.current.down = false; }}
      onClickCapture={(e) => { if (drag.current.moved) { e.preventDefault(); e.stopPropagation(); drag.current.moved = false; } }}
      onDragStart={(e) => e.preventDefault()}
      className={cn(
        "-mx-1 flex cursor-grab gap-3 overflow-x-auto px-1 py-1.5 [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden",
      )}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {children}
    </div>
    </div>
  );
}

function DeleteDomain({ d, onDeleted }: { d: DomainInfo; onDeleted: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setOpen(true)}><Trash2Icon />删除</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除「{d.label}」领域？</DialogTitle>
            <DialogDescription>会删除 {d.path} 这份档案。已经记下的事实记忆不会被删除；30 天内可以在「设置 → 数据与系统 → 最近删除」里恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await api(`/api/domains?key=${encodeURIComponent(d.key)}`, { method: "DELETE" }); toast.success("已删除"); setOpen(false); onDeleted(); } finally { setBusy(false); }
            }}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const PRESETS = [
  { label: "兴趣爱好", icon: "palette", color: "fuchsia", description: "长期投入的爱好与创作" },
  { label: "运动", icon: "dumbbell", color: "orange", description: "训练计划、比赛与身体能力" },
  { label: "副业", icon: "code", color: "teal", description: "副业项目、收入与时间投入" },
  { label: "育儿", icon: "baby", color: "rose", description: "孩子的成长、教育与陪伴" },
  { label: "旅行", icon: "plane", color: "sky", description: "去过的地方、想去的地方" },
];

function NewDomainDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (key: string) => void | Promise<void> }) {
  const empty = { label: "", description: "", icon: "sparkles", color: "teal", key: "" };
  const [f, setF] = React.useState(empty);
  const [busy, setBusy] = React.useState(false);
  const [advanced, setAdvanced] = React.useState(false);
  React.useEffect(() => { if (open) { setF(empty); setAdvanced(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.label.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ key: string }>("/api/domains", { method: "POST", json: f });
      toast.success(`已新增「${f.label.trim()}」`);
      onOpenChange(false);
      await onCreated(r.key);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>新增领域</DialogTitle>
            <DialogDescription>为生活里一个需要长期关注的方面建一份档案。搭档会在对话、记忆和导出中一并使用它。</DialogDescription>
          </DialogHeader>

          {/* 预览 */}
          <div className="bg-muted/40 flex items-center gap-3 rounded-xl border p-3">
            <DomainIcon icon={f.icon} color={f.color} size="lg" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{f.label.trim() || "领域名称"}</div>
              <div className="text-muted-foreground truncate text-xs">{f.description.trim() || "一句话说明这个领域记录什么"}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="text-muted-foreground mr-1 self-center text-xs">快速填入</span>
            {PRESETS.map((p) => (
              <button type="button" key={p.label} onClick={() => setF({ ...f, ...p })} className="hover:bg-muted rounded-full border px-2.5 py-0.5 text-xs transition-colors">{p.label}</button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="d-label">名称</Label>
              <Input id="d-label" value={f.label} maxLength={20} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="例如：兴趣爱好" autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d-desc">简介 <span className="text-muted-foreground font-normal">（可选）</span></Label>
              <Input id="d-desc" value={f.description} maxLength={40} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="一句话说明记录什么" />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>图标</Label>
            <div className="grid grid-cols-11 gap-1">
              {Object.entries(DOMAIN_ICONS).map(([k, Icon]) => (
                <button type="button" key={k} onClick={() => setF({ ...f, icon: k })} aria-label={k}
                  className={cn("flex aspect-square items-center justify-center rounded-md transition-colors [&_svg]:size-4", f.icon === k ? domainColor(f.color).chip + " ring-1 ring-current/30" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                  <Icon />
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>颜色</Label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(DOMAIN_COLORS).map(([k, c]) => (
                <button type="button" key={k} onClick={() => setF({ ...f, color: k })} aria-label={k}
                  className={cn("ring-offset-background size-6 rounded-full transition-shadow", c.dot, f.color === k ? "ring-foreground/60 ring-2 ring-offset-2" : "hover:ring-foreground/20 hover:ring-2 hover:ring-offset-1")} />
              ))}
            </div>
          </div>

          {advanced ? (
            <div className="grid gap-1.5">
              <Label htmlFor="d-key">标识 <span className="text-muted-foreground font-normal">（文件名，小写字母 / 数字 / 短横线）</span></Label>
              <Input id="d-key" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })} placeholder="留空自动生成，例如 hobby" className="font-mono" />
            </div>
          ) : (
            <button type="button" onClick={() => setAdvanced(true)} className="text-muted-foreground hover:text-foreground w-fit text-xs underline-offset-4 hover:underline">自定义文件标识</button>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={busy || !f.label.trim()}><PlusIcon />{busy ? "创建中" : "创建领域"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
