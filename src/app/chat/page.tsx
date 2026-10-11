"use client";
import * as React from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUpIcon, CheckIcon, ChevronDownIcon, FileSearchIcon, LoaderCircleIcon, LockIcon, MessageSquarePlusIcon,
  SquareIcon, Trash2Icon, WrenchIcon, XIcon, LightbulbIcon, PanelLeftCloseIcon, PanelLeftOpenIcon,
  SearchIcon, SparklesIcon, SunIcon, ListChecksIcon, MoonIcon, PenLineIcon, HistoryIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Skeleton } from "@/components/ui/misc";
import { Markdown } from "@/components/markdown";
import { MetricChart } from "@/components/metric-chart";
import { InboxContext } from "@/components/app-shell";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

/* ---------------- 类型 ---------------- */
type ToolPart = { type: "tool"; id: string; name: string; args: unknown; result?: unknown; ok?: boolean; status: "running" | "done" | "pending" | "rejected" };
type Part = { type: "reasoning"; text: string } | { type: "text"; text: string } | ToolPart;
type Retrieved = { path: string; title: string; date: string | null }[];
type Item =
  | { kind: "user"; text: string; retrieved?: Retrieved; skills?: string[] }
  | { kind: "assistant"; parts: Part[] }
  | { kind: "approval"; calls: { id: string; name: string; args: unknown; preview: string }[]; resolved?: boolean }
  | { kind: "error"; text: string };

type StoredMsg = { role: string; content?: string | null; reasoning_content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string; ui?: { display?: string; retrieved?: Retrieved; skills?: string[] } };
type Session = { id: string; title: string; messages: StoredMsg[]; pending?: { calls: { id: string; function: { name: string; arguments: string }; preview: string }[] } | null };

const TOOL_LABEL: Record<string, string> = {
  get_today: "查看日期", search_memory: "查找相关记录", read_note: "查阅资料", list_notes: "浏览资料", query_metrics: "查看数据趋势",
  list_plans: "查看计划", get_news: "查看资讯", get_facts: "查看记忆", load_skill: "加载技能", append_journal: "写日记", update_now: "更新当前处境",
  update_domain: "更新领域档案", upsert_plan: "更新计划", propose_memory: "记下新记忆",
};

function parse(s: string) { try { return JSON.parse(s); } catch { return s; } }

/** 把存储的消息还原成界面条目 */
function toItems(s: Session): Item[] {
  const items: Item[] = [];
  const toolIndex = new Map<string, ToolPart>();
  for (const m of s.messages) {
    if (m.role === "user") items.push({ kind: "user", text: m.ui?.display ?? m.content ?? "", retrieved: m.ui?.retrieved, skills: m.ui?.skills });
    else if (m.role === "assistant") {
      let last = items.at(-1);
      if (!last || last.kind !== "assistant") { last = { kind: "assistant", parts: [] }; items.push(last); }
      if (m.reasoning_content) last.parts.push({ type: "reasoning", text: m.reasoning_content });
      if (m.content) last.parts.push({ type: "text", text: m.content });
      for (const c of m.tool_calls ?? []) {
        const p: ToolPart = { type: "tool", id: c.id, name: c.function.name, args: parse(c.function.arguments), status: "pending" };
        toolIndex.set(c.id, p);
        last.parts.push(p);
      }
    } else if (m.role === "tool" && m.tool_call_id) {
      const p = toolIndex.get(m.tool_call_id);
      if (p) { p.result = parse(m.content ?? ""); p.ok = !(p.result as { error?: unknown; rejected?: unknown })?.error && !(p.result as { rejected?: unknown })?.rejected; p.status = (p.result as { rejected?: unknown })?.rejected ? "rejected" : "done"; }
    }
  }
  if (s.pending?.calls.length) items.push({ kind: "approval", calls: s.pending.calls.map((c) => ({ id: c.id, name: c.function.name, args: parse(c.function.arguments), preview: c.preview })) });
  return items;
}

export default function ChatPage() {
  return <React.Suspense fallback={<div className="p-6"><Skeleton className="h-96" /></div>}><Chat /></React.Suspense>;
}

function Chat() {
  const sp = useSearchParams();
  const router = useRouter();
  const { refreshInbox } = React.useContext(InboxContext);
  const [sessions, setSessions] = React.useState<{ id: string; title: string; updated: string; count: number }[]>([]);
  const [sessionId, setSessionId] = React.useState<string | null>(sp.get("s"));
  const [items, setItems] = React.useState<Item[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [thinking, setThinking] = React.useState(true);
  const [privateMode, setPrivateMode] = React.useState(false);
  const [showList, setShowList] = React.useState(true);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const autoQ = React.useRef(sp.get("q"));

  const loadSessions = React.useCallback(() => api<{ sessions: typeof sessions }>("/api/sessions").then((r) => setSessions(r.sessions)).catch(() => {}), []);
  React.useEffect(() => { void loadSessions(); }, [loadSessions]);

  React.useEffect(() => {
    if (!sessionId) { setItems([]); return; }
    if (busy) return;
    api<Session>(`/api/sessions/${sessionId}`).then((s) => setItems(toItems(s))).catch(() => setSessionId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  React.useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [items]);

  /* ---------- 流式请求 ---------- */
  const stream = React.useCallback(async (payload: { message?: string; approvals?: Record<string, boolean> }) => {
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const update = (fn: (draft: Item[]) => void) => setItems((prev) => { const next = structuredClone(prev); fn(next); return next; });
    const lastAssistant = (d: Item[]) => {
      let last = d.at(-1);
      if (!last || last.kind !== "assistant") { last = { kind: "assistant", parts: [] }; d.push(last); }
      return last as Extract<Item, { kind: "assistant" }>;
    };
    let sid = sessionId;
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ sessionId, thinking, privateMode, ...payload }),
      });
      if (!res.body) throw new Error("没有响应");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          switch (e.type) {
            case "session":
              if (e.id !== sid) { sid = e.id; setSessionId(e.id); router.replace(`/chat?s=${e.id}`); }
              break;
            case "user":
              update((d) => { const u = [...d].reverse().find((x) => x.kind === "user") as Extract<Item, { kind: "user" }> | undefined; if (u) { u.retrieved = e.retrieved; u.skills = e.skills; } });
              break;
            case "assistant_start":
              update((d) => { lastAssistant(d); });
              break;
            case "reasoning":
              update((d) => { const a = lastAssistant(d); const p = a.parts.at(-1); if (p?.type === "reasoning") p.text += e.delta; else a.parts.push({ type: "reasoning", text: e.delta }); });
              break;
            case "text":
              update((d) => { const a = lastAssistant(d); const p = a.parts.at(-1); if (p?.type === "text") p.text += e.delta; else a.parts.push({ type: "text", text: e.delta }); });
              break;
            case "tool_call":
              update((d) => { lastAssistant(d).parts.push({ type: "tool", id: e.id, name: e.name, args: e.args, status: "running" }); });
              break;
            case "tool_result":
              update((d) => {
                for (const it of d) if (it.kind === "assistant") for (const p of it.parts) if (p.type === "tool" && p.id === e.id) {
                  p.result = e.result; p.ok = e.ok; p.status = e.result?.rejected ? "rejected" : "done";
                }
              });
              break;
            case "approval_required":
              update((d) => { d.push({ kind: "approval", calls: e.calls }); });
              break;
            case "error":
              update((d) => { d.push({ kind: "error", text: e.message }); });
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast.error(String(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
      void loadSessions();
      setTimeout(refreshInbox, 4000);
    }
  }, [sessionId, thinking, privateMode, router, loadSessions, refreshInbox]);

  const send = (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setInput("");
    setItems((d) => [...d.map((x) => (x.kind === "approval" ? { ...x, resolved: true } : x)), { kind: "user", text: t }]);
    void stream({ message: t });
  };

  // 从概览页 / 命令面板带问题过来
  React.useEffect(() => {
    if (autoQ.current && !sessionId) { const q = autoQ.current; autoQ.current = null; router.replace("/chat"); send(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approve = (decisions: Record<string, boolean>) => {
    setItems((d) => d.map((x) => (x.kind === "approval" && !x.resolved ? { ...x, resolved: true } : x)));
    void stream({ approvals: decisions });
  };

  const newChat = () => { setSessionId(null); setItems([]); router.replace("/chat"); };
  const del = async (id: string) => { await api(`/api/sessions/${id}`, { method: "DELETE" }); if (id === sessionId) newChat(); void loadSessions(); };

  const current = sessions.find((x) => x.id === sessionId);
  const [filter, setFilter] = React.useState("");
  const groups = React.useMemo(() => {
    const now = Date.now();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const g: { label: string; items: typeof sessions }[] = [
      { label: "今天", items: [] }, { label: "昨天", items: [] }, { label: "最近 7 天", items: [] }, { label: "更早", items: [] },
    ];
    for (const x of sessions) {
      if (filter.trim() && !x.title.toLowerCase().includes(filter.trim().toLowerCase())) continue;
      const t = new Date(x.updated).getTime();
      const idx = t >= today.getTime() ? 0 : t >= today.getTime() - 864e5 ? 1 : now - t < 7 * 864e5 ? 2 : 3;
      g[idx].items.push(x);
    }
    return g.filter((x) => x.items.length);
  }, [sessions, filter]);

  const [listOpen, setListOpen] = React.useState(false);
  const openSession = (id: string) => { setSessionId(id); router.replace(`/chat?s=${id}`); setListOpen(false); };
  const sessionList = (
    <>
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <span className="text-sm font-semibold">对话</span>
            <span className="text-muted-foreground text-xs tabular-nums">{sessions.length}</span>
            <Button size="icon-sm" variant="ghost" className="ml-auto max-md:mr-8" onClick={() => { newChat(); setListOpen(false); }} title="新对话"><MessageSquarePlusIcon /></Button>
          </div>
          <div className="px-3 pb-2">
            <div className="bg-background focus-within:ring-ring/40 flex items-center gap-2 rounded-lg border px-2.5 focus-within:ring-2">
              <SearchIcon className="text-muted-foreground size-3.5 shrink-0" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索对话" className="h-8 min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
            {groups.length === 0 && <p className="text-muted-foreground px-2 py-8 text-center text-xs">{filter ? "没有匹配的对话" : "还没有对话"}</p>}
            {groups.map((g) => (
              <div key={g.label} className="mb-2">
                <div className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-medium">{g.label}</div>
                {g.items.map((x) => {
                  const on = x.id === sessionId;
                  return (
                    <div key={x.id} className={cn("group relative flex items-center rounded-lg transition-colors", on ? "bg-background shadow-xs ring-1 ring-border" : "hover:bg-muted/70")}>
                      <button className="min-w-0 flex-1 px-2.5 py-2 text-left max-md:py-2.5" onClick={() => openSession(x.id)}>
                        <div className={cn("truncate text-[13px]", on ? "font-medium" : "text-foreground/85")}>{x.title}</div>
                        <div className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">{new Date(x.updated).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {x.count} 条</div>
                      </button>
                      <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive mr-1 size-7 md:opacity-0 md:group-hover:opacity-100" onClick={() => del(x.id)} title="删除"><Trash2Icon className="size-3.5" /></Button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
            </>
  );

  return (
    <div className="h-app flex min-h-0">
      {/* 移动端：会话列表抽屉 */}
      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="left" className="bg-background w-[86%] max-w-sm gap-0 pt-[env(safe-area-inset-top)] md:hidden">
          <SheetTitle className="sr-only">历史对话</SheetTitle>
          <SheetDescription className="sr-only">选择一个对话继续</SheetDescription>
          <div className="flex min-h-0 flex-1 flex-col pt-1">{sessionList}</div>
        </SheetContent>
      </Sheet>

      {/* ---------- 会话列表 ---------- */}
      <aside inert={!showList} className={cn("bg-muted/25 hidden shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-linear md:flex", showList ? "w-64 border-r" : "w-0 opacity-0")}>
        <div className="flex w-64 shrink-0 flex-col">{sessionList}</div>
      </aside>

      {/* ---------- 对话区 ---------- */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 px-3 max-md:border-b max-md:px-2">
          <Button variant="ghost" size="icon-sm" className="hidden md:inline-flex" onClick={() => setShowList((v) => !v)} title={showList ? "收起会话列表" : "展开会话列表"}>
            {showList ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1.5 md:hidden" onClick={() => setListOpen(true)}>
            <HistoryIcon />历史<span className="text-xs tabular-nums opacity-70">{sessions.length}</span>
          </Button>
          <span className="truncate text-sm font-medium max-md:flex-1 max-md:text-center max-md:text-[13px] max-md:text-muted-foreground">{items.length ? current?.title ?? "新对话" : ""}</span>
          {items.length > 0 && <Button variant="ghost" size="sm" className="text-muted-foreground ml-auto max-md:hidden" onClick={newChat}><MessageSquarePlusIcon />新对话</Button>}
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground ml-auto md:hidden" onClick={newChat} disabled={!items.length} title="新对话"><MessageSquarePlusIcon /></Button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className={cn("mx-auto flex w-full max-w-3xl flex-col px-4 pb-6", items.length === 0 ? "min-h-full justify-center" : "space-y-6 pt-4 md:space-y-7 md:pt-2")}>
            {items.length === 0 && <Empty onPick={send} />}
            {items.map((it, i) => <ItemView key={i} item={it} busy={busy} onApprove={approve} last={i === items.length - 1} />)}
            {busy && items.at(-1)?.kind !== "assistant" && (
              <div className="flex gap-3"><Avatar /><div className="text-muted-foreground flex items-center gap-2 pt-1 text-sm">正在翻阅你的资料<Dots /></div></div>
            )}
          </div>
        </div>

        {/* ---------- 输入框 ---------- */}
        <div className="px-3 pb-3 md:px-4 md:pb-4">
          <div className="mx-auto max-w-3xl">
            <div className="bg-card focus-within:ring-ring/25 rounded-2xl border shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-4">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                placeholder="和搭档聊聊…"
                className="max-h-40 min-h-12 resize-none border-0 bg-transparent px-4 pt-3 text-base shadow-none focus-visible:ring-0 md:max-h-48 md:min-h-14 md:pt-3.5 md:text-[15px] dark:bg-transparent"
              />
              <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
                <TogglePill on={thinking} onClick={() => setThinking((v) => !v)} icon={LightbulbIcon} label="深度思考" title="让搭档先想一想再回答" />
                <TogglePill on={privateMode} onClick={() => setPrivateMode((v) => !v)} icon={LockIcon} label="隐私模式" title="使用本机模型，可读取隐私内容（需在设置中启用隐私模型）" />
                <span className="text-muted-foreground/70 ml-auto hidden text-[11px] sm:inline">Enter 发送 · Shift+Enter 换行</span>
                {busy ? (
                  <Button size="icon" variant="secondary" className="ml-auto size-9 rounded-full sm:ml-0 sm:size-8" onClick={() => abortRef.current?.abort()} title="停止"><SquareIcon className="size-3 fill-current" /></Button>
                ) : (
                  <Button size="icon" className="ml-auto size-9 rounded-full sm:ml-0 sm:size-8" onClick={() => send()} disabled={!input.trim()} title="发送"><ArrowUpIcon /></Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TogglePill({ on, onClick, icon: Icon, label, title }: { on: boolean; onClick: () => void; icon: typeof LockIcon; label: string; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={on}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors [&_svg]:size-3.5",
        on ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      <Icon />{label}
    </button>
  );
}

function Avatar() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center">
      <Image src="/logo.png" alt="AI 助手" width={24} height={24} className="size-6" />
    </span>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-0.5">
      {[0, 150, 300].map((d) => <span key={d} className="bg-muted-foreground/60 size-1 animate-bounce rounded-full" style={{ animationDelay: `${d}ms` }} />)}
    </span>
  );
}

const IDEAS: { icon: typeof LockIcon; title: string; desc: string; q: string; cls: string }[] = [
  { icon: SunIcon, title: "看看我的状态", desc: "结合最近的日记和指标", q: "根据我最近的日记，我现在状态怎么样？", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  { icon: ListChecksIcon, title: "规划这一周", desc: "排出最重要的三件事", q: "帮我规划一下这周最重要的三件事", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  { icon: MoonIcon, title: "找找规律", desc: "睡眠、精力和心情的关系", q: "我最近睡眠和精力有什么规律？", cls: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  { icon: PenLineIcon, title: "帮我记一笔", desc: "用一句话记录今天", q: "今天学习了 2 小时，心情 4 分，帮我记一下", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
];

function Empty({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex w-full flex-col items-center gap-6 py-6 text-center md:gap-8 md:py-10">
      <div className="flex flex-col items-center">
        <Image src="/logo.png" alt="" width={48} height={48} className="mb-3 size-12 md:hidden" />
        <h2 className="text-2xl font-semibold tracking-tight">今天想聊点什么？</h2>
        <p className="text-muted-foreground mt-1.5 max-w-xs text-sm md:max-w-none">搭档读过你的档案、日记、计划和记忆，会结合你的处境回答</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2.5">
        {IDEAS.map((x) => (
          <button key={x.q} onClick={() => onPick(x.q)}
            className="group bg-card hover:border-foreground/20 flex flex-col items-start gap-2.5 rounded-2xl border p-3.5 text-left shadow-xs transition-all hover:-translate-y-px hover:shadow-sm active:scale-[0.98] sm:flex-row sm:gap-3 sm:rounded-xl">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", x.cls)}><x.icon /></span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{x.title}</span>
              <span className="text-muted-foreground block text-xs">{x.desc}</span>
            </span>
            <ArrowUpIcon className="text-muted-foreground ml-auto size-4 rotate-45 opacity-0 transition-opacity group-hover:opacity-100 max-sm:hidden" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ItemView({ item, busy, onApprove, last }: { item: Item; busy: boolean; onApprove: (d: Record<string, boolean>) => void; last: boolean }) {
  if (item.kind === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="bg-muted max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap md:max-w-[80%]">{item.text}</div>
        {(item.retrieved?.length || item.skills?.length) ? (
          <div className="flex max-w-[80%] flex-wrap justify-end gap-1">
            {item.skills?.map((x) => <span key={x} className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-700 dark:text-violet-400"><SparklesIcon className="size-3" />{x}</span>)}
            {item.retrieved?.slice(0, 4).map((r) => <span key={r.path} title={r.path} className="text-muted-foreground inline-flex max-w-48 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"><FileSearchIcon className="size-3 shrink-0" /><span className="truncate">{r.title}</span></span>)}
          </div>
        ) : null}
      </div>
    );
  }
  if (item.kind === "error") return <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-4 py-3 text-sm">{item.text}</div>;
  if (item.kind === "approval") return <ApprovalCard item={item} disabled={busy || !!item.resolved} onApprove={onApprove} />;
  return (
    <div className="flex gap-2.5 md:gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 space-y-3 pt-0.5">
        {item.parts.map((p, i) => {
          if (p.type === "reasoning") return <Reasoning key={i} text={p.text} live={busy && last && i === item.parts.length - 1} />;
          if (p.type === "text") return <Markdown key={i} className="text-[15px] leading-7">{p.text}</Markdown>;
          return <ToolView key={p.id} part={p} />;
        })}
        {busy && last && item.parts.length === 0 && <Dots />}
      </div>
    </div>
  );
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Collapsible open={open || live} onOpenChange={setOpen}>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground bg-muted/50 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors">
        {live ? <LoaderCircleIcon className="size-3 animate-spin" /> : <LightbulbIcon className="size-3" />}
        {live ? "思考中…" : "思考过程"}
        <ChevronDownIcon className={cn("size-3 transition-transform", (open || live) && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="text-muted-foreground mt-2 border-l-2 pl-3 text-xs leading-6 whitespace-pre-wrap">{text}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolView({ part }: { part: ToolPart }) {
  const [open, setOpen] = React.useState(false);
  const label = TOOL_LABEL[part.name] ?? part.name;
  const args = part.args as Record<string, unknown>;
  const summary = part.name === "search_memory" ? `"${args?.query}"` : part.name === "read_note" ? String(args?.path ?? "") : part.name === "query_metrics" ? (args?.keys as string[] | undefined)?.join("、") : "";
  const res = part.result as Record<string, unknown> | undefined;
  const failed = part.status === "rejected" || part.ok === false;
  return (
    <div className="space-y-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className={cn("group inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1 text-left text-xs transition-colors",
          part.status === "pending" ? "border-amber-500/30 bg-amber-500/5" : "bg-card hover:bg-muted/60")}>
          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full [&_svg]:size-2.5",
            part.status === "running" ? "text-muted-foreground" : part.status === "pending" ? "bg-amber-500 text-white" : failed ? "bg-rose-500 text-white" : "bg-emerald-500 text-white")}>
            {part.status === "running" ? <LoaderCircleIcon className="size-3.5! animate-spin" /> : part.status === "pending" ? <WrenchIcon /> : failed ? <XIcon /> : <CheckIcon />}
          </span>
          <span className="font-medium">{label}</span>
          {summary && <span className="text-muted-foreground truncate">{summary}</span>}
          {part.status === "pending" && <span className="text-amber-600">等待确认</span>}
          {part.status === "rejected" && <span className="text-muted-foreground">已拒绝</span>}
          <ChevronDownIcon className={cn("text-muted-foreground size-3 shrink-0 transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1.5 grid gap-2 rounded-xl border p-2 text-xs">
            <pre className="bg-muted/60 overflow-x-auto rounded-lg p-2 font-mono text-[11px]">{JSON.stringify(part.args, null, 2)}</pre>
            {part.result !== undefined && <pre className="bg-muted/60 max-h-64 overflow-auto rounded-lg p-2 font-mono text-[11px]">{JSON.stringify(part.result, null, 2)}</pre>}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {part.name === "query_metrics" && res && Array.isArray(res.points) && (
        <div className="bg-card rounded-xl border p-3">
          <MetricChart points={res.points as Record<string, unknown>[]} keys={res.keys as string[]} className="aspect-auto h-44 w-full" />
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ item, disabled, onApprove }: { item: Extract<Item, { kind: "approval" }>; disabled: boolean; onApprove: (d: Record<string, boolean>) => void }) {
  const [sel, setSel] = React.useState<Record<string, boolean>>(() => Object.fromEntries(item.calls.map((c) => [c.id, true])));
  return (
    <div className={cn("overflow-hidden rounded-xl border md:ml-10 bg-linear-to-br from-amber-500/[0.06] to-transparent to-60% border-amber-500/20", disabled && "opacity-60")}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-sm font-medium">
        <span className="flex size-6 items-center justify-center rounded-md bg-amber-500/15 text-amber-600"><WrenchIcon className="size-3.5" /></span>
        搭档想更新你的记录，确认后才会生效
      </div>
      <div className="space-y-2 px-4 pb-3">
        {item.calls.map((c) => {
          const args = c.args as Record<string, unknown>;
          const content = (args?.content ?? args?.body ?? args?.log) as string | undefined;
          return (
            <label key={c.id} className={cn("bg-background flex cursor-pointer gap-3 rounded-lg border p-3 transition-opacity", !sel[c.id] && "opacity-60")}>
              <input type="checkbox" className="accent-foreground mt-1" checked={sel[c.id]} disabled={disabled} onChange={(e) => setSel({ ...sel, [c.id]: e.target.checked })} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-medium">{c.preview}</div>
                {content && <div className="text-muted-foreground line-clamp-6 text-xs leading-5 whitespace-pre-wrap">{content}</div>}
                {!content && <pre className="text-muted-foreground overflow-x-auto text-[11px]">{JSON.stringify(c.args, null, 2)}</pre>}
              </div>
            </label>
          );
        })}
      </div>
      {!disabled && (
        <div className="flex justify-end gap-2 border-t bg-background/50 px-4 py-2.5">
          <Button size="sm" variant="ghost" onClick={() => onApprove(Object.fromEntries(item.calls.map((c) => [c.id, false])))}>全部拒绝</Button>
          <Button size="sm" onClick={() => onApprove(sel)}><CheckIcon />确认执行</Button>
        </div>
      )}
      {item.resolved && <div className="text-muted-foreground border-t px-4 py-2 text-xs">已处理</div>}
    </div>
  );
}
