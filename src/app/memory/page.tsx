"use client";
import * as React from "react";
import { toast } from "sonner";
import {
  BrainIcon, CheckIcon, FileDiffIcon, HistoryIcon, InboxIcon, LoaderCircleIcon, MessageSquareIcon, NotebookPenIcon,
  QuoteIcon, RefreshCwIcon, PlusIcon, PencilLineIcon, BanIcon, SparklesIcon, Trash2Icon, XIcon, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { DomainChip, DomainGlyph, domainColor } from "@/components/domain-icon";
import { InboxContext } from "@/components/app-shell";
import { api, useApi, useDomains, DOMAIN_LABEL } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/components/page";

type FactOp = { op: "add" | "update" | "invalidate"; fact_id?: string; domain: string; text: string; confidence: number; importance: number; reason: string; decision: string };
type Proposal = { id: string; created: string; kind: "facts" | "file_update"; title: string; source?: string; status: string; ops?: FactOp[]; file?: { path: string; before: string; after: string } };
type Fact = { id: string; domain: string; text: string; status: string; confidence: number; importance: number; valid_from: string; valid_to: string | null; source: string | null };
type Data = { inbox: Proposal[]; done: Proposal[]; facts: Fact[] };

const OP_STYLE = {
  add: { t: "新增", icon: PlusIcon, chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" },
  update: { t: "更新", icon: PencilLineIcon, chip: "bg-sky-500/12 text-sky-700 dark:text-sky-400" },
  invalidate: { t: "作废", icon: BanIcon, chip: "bg-rose-500/12 text-rose-700 dark:text-rose-400" },
};

/** 来源显示成人话：对话 / 日记 / 其他 */
function sourceInfo(src?: string): { icon: LucideIcon; label: string } | null {
  if (!src) return null;
  if (src === "chat" || src.startsWith("sessions/")) {
    const d = /(\d{4})(\d{2})(\d{2})-/.exec(src);
    return { icon: MessageSquareIcon, label: d ? `对话 · ${d[2]}-${d[3]}` : "对话" };
  }
  if (src.startsWith("journal")) {
    const d = src.match(/\d{4}-(\d{2}-\d{2})/g);
    return { icon: NotebookPenIcon, label: d ? `日记 · ${d.map((x) => x.slice(5)).join(" ~ ")}` : "日记" };
  }
  return { icon: SparklesIcon, label: src.split("/").pop() ?? src };
}

function friendlyPath(path: string) {
  if (path === "now.md") return "当前处境";
  if (path === "profile/identity.md") return "我是谁";
  if (path === "profile/background.md") return "经历";
  if (path === "memory/preferences.md") return "搭档偏好";
  const domain = /^domains\/(.+)\.md$/.exec(path);
  if (domain) return `领域档案 · ${DOMAIN_LABEL[domain[1]] ?? domain[1]}`;
  const plan = /^plans\/(.+)\.md$/.exec(path);
  if (plan) return "计划详情";
  return "资料更新";
}

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

type TabId = "inbox" | "facts" | "history";

export default function MemoryPage() {
  useDomains(); // 加载自定义领域名称
  const { data, loading, reload } = useApi<Data>("/api/memory");
  const { refreshInbox } = React.useContext(InboxContext);
  const [job, setJob] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>("inbox");
  const refresh = () => { void reload(); refreshInbox(); };

  const run = async (name: string) => {
    setJob(name);
    try {
      const r = await api<{ message?: string }>("/api/jobs", { method: "POST", json: { job: name } });
      toast.message(r.message ?? "完成");
      refresh();
    } finally { setJob(null); }
  };

  const facts = data?.facts ?? [];
  const active = facts.filter((f) => f.status === "active");
  const past = facts.filter((f) => f.status !== "active");
  const factsById = new Map(facts.map((f) => [f.id, f]));
  const inbox = data?.inbox ?? [];

  const tabs: { id: TabId; label: string; icon: LucideIcon; count: number; hint: string }[] = [
    { id: "inbox", label: "待审核", icon: InboxIcon, count: inbox.length, hint: "等你确认的新发现" },
    { id: "facts", label: "事实库", icon: BrainIcon, count: active.length, hint: `覆盖 ${new Set(active.map((f) => f.domain)).size} 个领域` },
    { id: "history", label: "变化轨迹", icon: HistoryIcon, count: past.length, hint: "被更新或作废的记忆" },
  ];

  return (
    <Page>
      <PageHeader
        title="记忆"
        description="搭档从对话和日记里记下的关于你的事实。每一条写入都要经过你确认。"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => run("extract")} disabled={!!job}>{job === "extract" ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}从最近日记中发现</Button>
          <Button variant="outline" size="sm" onClick={() => run("now")} disabled={!!job}>{job === "now" ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}建议更新当前处境</Button>
        </>}
      />

      {/* 分区切换 */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="bg-muted flex w-full rounded-lg p-1 sm:inline-flex sm:w-auto">
          {tabs.map((t) => {
            const on = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} title={t.hint}
                className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-all sm:flex-none sm:gap-2 sm:px-3 [&_svg]:size-4 max-[400px]:[&>svg]:hidden",
                  on ? "bg-background text-foreground font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                <t.icon />{t.label}
                {data && (
                  <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums",
                    t.id === "inbox" && t.count > 0 ? "bg-rose-500 text-white" : on ? "bg-muted text-foreground" : "bg-background/70")}>{t.count}</span>
                )}
              </button>
            );
          })}
        </div>
        <span className="text-muted-foreground hidden text-sm sm:inline">{tabs.find((t) => t.id === tab)?.hint}</span>
      </div>

      {loading && !data ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : tab === "inbox" ? (
        inbox.length === 0 ? (
          <EmptyBox icon={InboxIcon} title="都处理完了" desc="和搭档聊天、写日记之后，它会自动发现值得长期记住的事，放到这里等你确认。">
            <Button variant="outline" size="sm" onClick={() => run("extract")} disabled={!!job}><SparklesIcon />从最近日记中发现</Button>
          </EmptyBox>
        ) : <div className="space-y-4">{inbox.map((p) => <ProposalCard key={p.id} p={p} factsById={factsById} onDone={refresh} />)}</div>
      ) : tab === "facts" ? (
        <FactsView facts={active} onChange={refresh} />
      ) : (
        <HistoryView facts={past} />
      )}
    </Page>
  );
}

function EmptyBox({ icon: Icon, title, desc, children }: { icon: LucideIcon; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <Empty className="bg-card min-h-72 border-solid shadow-xs">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-xl [&_svg:not([class*='size-'])]:size-6"><Icon /></EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{desc}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}

function Importance({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`重要度 ${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={cn("h-2.5 w-1 rounded-full", i <= n ? "bg-foreground/70" : "bg-foreground/12")} />)}
    </span>
  );
}

function ProposalCard({ p, factsById, onDone }: { p: Proposal; factsById: Map<string, Fact>; onDone: () => void }) {
  const [dec, setDec] = React.useState<Record<number, "approved" | "rejected">>(() => Object.fromEntries((p.ops ?? []).map((_, i) => [i, "approved"])));
  const [texts, setTexts] = React.useState<Record<number, string>>(() => Object.fromEntries((p.ops ?? []).map((o, i) => [i, o.text])));
  const [busy, setBusy] = React.useState(false);
  const approved = Object.values(dec).filter((d) => d === "approved").length;

  const submit = async (fileDecision?: "approved" | "rejected", all?: "rejected") => {
    setBusy(true);
    try {
      const decisions = Object.fromEntries(Object.entries(dec).map(([i, d]) => [i, { decision: all ?? d, text: texts[Number(i)] }]));
      await api("/api/memory", { method: "POST", json: { id: p.id, decisions, fileDecision: fileDecision ? { decision: fileDecision } : undefined } });
      toast.success(fileDecision === "rejected" || all ? "已忽略" : "已更新");
      onDone();
    } finally { setBusy(false); }
  };

  const isFacts = p.kind === "facts";
  const src = sourceInfo(p.source);
  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
      <div className="flex items-center gap-3 border-b px-5 py-3.5">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", isFacts ? "bg-violet-500/12 text-violet-600 dark:text-violet-400" : "bg-sky-500/12 text-sky-600 dark:text-sky-400")}>
          {isFacts ? <SparklesIcon /> : <FileDiffIcon />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={p.title}>{p.title}</div>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span>{timeAgo(p.created)}</span>
            {src && <span className="flex items-center gap-1" title={p.source}><src.icon className="size-3" />{src.label}</span>}
          </div>
        </div>
        {isFacts && <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{p.ops?.length ?? 0} 条发现</span>}
      </div>

      <div className={cn(isFacts ? "divide-y" : "p-4 md:px-5")}>
        {isFacts && p.ops?.map((op, i) => {
          const old = op.fact_id ? factsById.get(op.fact_id) : undefined;
          const on = dec[i] === "approved";
          const st = OP_STYLE[op.op];
          return (
            <div key={i} className={cn("flex gap-3 px-5 py-4 transition-colors", !on && "bg-muted/30")}>
              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full transition-opacity [&_svg]:size-3.5", st.chip, !on && "opacity-40")} title={st.t}><st.icon /></span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{st.t}</span>
                  <DomainChip k={op.domain} />
                  <span title={`重要度 ${op.importance}/5 · 置信度 ${Math.round(op.confidence * 100)}%`}><Importance n={op.importance} /></span>
                  <div className="bg-muted ml-auto flex shrink-0 rounded-md p-0.5 opacity-100">
                    <button onClick={() => setDec({ ...dec, [i]: "approved" })} className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs transition-all [&_svg]:size-3.5", on ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}><CheckIcon />采纳</button>
                    <button onClick={() => setDec({ ...dec, [i]: "rejected" })} className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs transition-all [&_svg]:size-3.5", !on ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}><XIcon />忽略</button>
                  </div>
                </div>
                <div className={cn("space-y-1.5 transition-opacity", !on && "opacity-50")}>
                {old && <div className="text-muted-foreground text-sm line-through decoration-rose-400/70">{old.text}</div>}
                {op.op !== "invalidate" ? (
                  <textarea
                    value={texts[i]}
                    onChange={(e) => setTexts({ ...texts, [i]: e.target.value })}
                    rows={1}
                    disabled={!on}
                    title="可以直接修改措辞"
                    className="hover:bg-muted/50 focus:bg-muted/50 focus:ring-ring/40 -mx-1.5 w-[calc(100%+0.75rem)] resize-none rounded-md bg-transparent px-1.5 py-0.5 text-sm leading-6 outline-none field-sizing-content focus:ring-2"
                  />
                ) : <div className="text-sm leading-6">{op.text}</div>}
                {op.reason && (
                  <div className="text-muted-foreground flex gap-1.5 text-xs leading-5"><QuoteIcon className="mt-0.5 size-3 shrink-0 opacity-60" />{op.reason}</div>
                )}
                </div>
              </div>
            </div>
          );
        })}
        {p.kind === "file_update" && p.file && <Diff before={p.file.before} after={p.file.after} path={p.file.path} />}
      </div>

      <div className="bg-muted/30 flex items-center gap-2 border-t px-5 py-3">
        {isFacts ? (
          <>
            <span className="text-muted-foreground mr-auto text-xs">将采纳 <span className="text-foreground font-medium tabular-nums">{approved}</span> / {p.ops?.length ?? 0} 条</span>
            <Button size="sm" variant="ghost" onClick={() => submit(undefined, "rejected")} disabled={busy}>全部忽略</Button>
            <Button size="sm" onClick={() => submit()} disabled={busy}>{busy ? <LoaderCircleIcon className="animate-spin" /> : <CheckIcon />}确认提交</Button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground mr-auto text-xs">采纳后会直接改写「{friendlyPath(p.file?.path ?? "")}」</span>
            <Button size="sm" variant="ghost" onClick={() => submit("rejected")} disabled={busy}>忽略</Button>
            <Button size="sm" onClick={() => submit("approved")} disabled={busy}><CheckIcon />采纳</Button>
          </>
        )}
      </div>
    </div>
  );
}

/** 行级 diff（LCS），文件很小，直接算 */
function Diff({ before, after, path }: { before: string; after: string; path: string }) {
  const rows = React.useMemo(() => {
    const a = before.split("\n"), b = after.split("\n");
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out: { t: " " | "+" | "-"; s: string }[] = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ t: " ", s: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "-", s: a[i++] });
      else out.push({ t: "+", s: b[j++] });
    }
    while (i < n) out.push({ t: "-", s: a[i++] });
    while (j < m) out.push({ t: "+", s: b[j++] });
    return out;
  }, [before, after]);
  const added = rows.filter((r) => r.t === "+").length, removed = rows.filter((r) => r.t === "-").length;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="bg-muted/60 text-muted-foreground flex items-center gap-3 border-b px-3 py-2 text-xs">
        <span className="text-foreground font-medium">{friendlyPath(path)}</span>
        <span className="ml-auto text-emerald-600 tabular-nums">+{added}</span>
        <span className="text-rose-600 tabular-nums">−{removed}</span>
      </div>
      <pre className="max-h-96 overflow-auto py-1 font-mono text-xs leading-5">
        {rows.map((r, k) => (
          <div key={k} className={cn("flex gap-2 px-3 whitespace-pre-wrap", r.t === "+" && "bg-emerald-500/12", r.t === "-" && "bg-rose-500/10 text-muted-foreground line-through")}>
            <span className={cn("w-3 shrink-0 select-none", r.t === "+" ? "text-emerald-600" : r.t === "-" ? "text-rose-600" : "text-muted-foreground/40")}>{r.t === " " ? "·" : r.t}</span>
            <span className="min-w-0">{r.s || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function FactsView({ facts, onChange }: { facts: Fact[]; onChange: () => void }) {
  const { domains } = useDomains();
  const [domain, setDomain] = React.useState<string>("all");
  const counts = facts.reduce<Record<string, number>>((a, f) => ({ ...a, [f.domain]: (a[f.domain] ?? 0) + 1 }), {});
  const keys = [...domains.map((d) => d.key), ...Object.keys(counts).filter((k) => !domains.some((d) => d.key === k))];
  const shown = facts.filter((f) => domain === "all" || f.domain === domain);
  const groups = (domain === "all" ? keys : [domain]).map((k) => ({ k, items: shown.filter((f) => f.domain === k) })).filter((g) => g.items.length);

  const invalidate = async (f: Fact) => {
    await api("/api/memory", { method: "POST", json: { invalidate: f.id, domain: f.domain } });
    toast.success("已标记为不再成立");
    onChange();
  };

  if (!facts.length) return <EmptyBox icon={BrainIcon} title="还没有记忆" desc="在「待审核」里采纳的事实会出现在这里，搭档每次对话都会参考它们。" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        <FilterChip on={domain === "all"} onClick={() => setDomain("all")}>全部<span className="opacity-60">{facts.length}</span></FilterChip>
        {keys.filter((k) => counts[k]).map((k) => {
          const d = domains.find((x) => x.key === k);
          return (
            <FilterChip key={k} on={domain === k} onClick={() => setDomain(k)}>
              <DomainGlyph icon={d?.icon ?? "sparkles"} className={cn("size-3.5", domain !== k && domainColor(d?.color ?? "slate").text)} />
              {d?.label ?? k}<span className="opacity-60">{counts[k]}</span>
            </FilterChip>
          );
        })}
      </div>

      {groups.map((g) => (
        <div key={g.k} className="bg-card overflow-hidden rounded-xl border shadow-xs">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <DomainChip k={g.k} />
            <span className="text-muted-foreground text-xs">{g.items.length} 条</span>
          </div>
          <div className="divide-y">
            {g.items.map((f) => (
              <div key={f.id} className="group hover:bg-muted/30 flex items-start gap-3 px-4 py-3 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-6">{f.text}</div>
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <Importance n={f.importance} />
                    <span>自 {f.valid_from}</span>
                    <code className="opacity-0 transition-opacity group-hover:opacity-60">{f.id}</code>
                  </div>
                </div>
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" title="不再成立" onClick={() => invalidate(f)}><Trash2Icon /></Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
      on ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted")}>{children}</button>
  );
}

function HistoryView({ facts }: { facts: Fact[] }) {
  if (!facts.length) return <EmptyBox icon={HistoryIcon} title="还没有变化" desc="当一条记忆被更新或不再成立时，旧的版本会留在这里，形成你的变化轨迹。" />;
  const sorted = [...facts].sort((a, b) => (b.valid_to ?? "").localeCompare(a.valid_to ?? ""));
  return (
    <div className="bg-card rounded-xl border p-5 shadow-xs">
      <div className="relative space-y-5 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
        {sorted.map((f) => (
          <div key={f.id} className="relative">
            <span className={cn("ring-card absolute top-1.5 -left-6 size-[11px] rounded-full ring-4", f.status === "superseded" ? "bg-sky-500" : "bg-rose-400")} />
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <span className="text-foreground font-medium tabular-nums">{f.valid_to ?? "—"}</span>
              <span className={cn("rounded px-1.5 py-px text-[11px]", f.status === "superseded" ? "bg-sky-500/12 text-sky-700 dark:text-sky-400" : "bg-rose-500/12 text-rose-700 dark:text-rose-400")}>{f.status === "superseded" ? "已更新" : "已作废"}</span>
              <DomainChip k={f.domain} />
            </div>
            <div className="text-muted-foreground mt-1.5 text-sm line-through decoration-foreground/30">{f.text}</div>
            <div className="text-muted-foreground/70 mt-0.5 text-xs">成立于 {f.valid_from} → {f.valid_to ?? "?"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
