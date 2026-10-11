"use client";
import * as React from "react";
import { Page, PageHeader } from "@/components/page";
import { toast } from "sonner";
import {
  BotIcon, BrainCircuitIcon, CalendarClockIcon, CircleCheckIcon, CircleXIcon, DatabaseIcon, KeyRoundIcon,
  LoaderCircleIcon, PencilIcon, PlusIcon, SaveIcon, ServerIcon, Trash2Icon, ZapIcon,
  CopyIcon, FolderOpenIcon, FolderIcon, HardDriveIcon, RefreshCwIcon, RotateCcwIcon, SparklesIcon, HistoryIcon,
  MonitorIcon, BellIcon, FileTextIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { useDesktop, type DesktopSettings, type UpdateInfo } from "@/components/desktop-bridge";

type Provider = { id: string; name: string; baseURL: string; kind: "deepseek" | "openai"; local: boolean };
type Role = { provider: string; model: string; thinking: boolean; enabled: boolean };
type RoleId = "chat" | "background" | "embedding" | "private" | "vision";
type Settings = {
  user: { name: string; timezone: string };
  providers: Provider[];
  roles: Record<RoleId, Role>;
  agent: { requireApprovalForWrites: boolean; maxSteps: number; contextBudgetTokens: number; autoExtractMemory: boolean };
  privacy: { sendPrivateToCloud: boolean };
  scheduler: { enabled: boolean; dailyHour: number; weeklyReviewDay: number };
  history: { enabled: boolean; keepDays: number };
};
type Res = { settings: Settings; keys: Record<string, boolean>; usage: { calls: number; prompt: number; completion: number; cacheHit: number }; paths: { vault: string; app: string } };

const ROLES: { id: RoleId; title: string; desc: string; thinking?: boolean; toggle?: boolean; placeholder: string }[] = [
  { id: "chat", title: "对话", desc: "主搭档，推理与工具调用", thinking: true, placeholder: "例如 deepseek-chat" },
  { id: "background", title: "后台", desc: "记忆抽取与复盘，宜用便宜模型", thinking: true, placeholder: "例如 deepseek-chat" },
  { id: "embedding", title: "嵌入", desc: "语义检索，不可用时改用关键词", toggle: true, placeholder: "例如 BAAI/bge-m3、text-embedding-v4" },
  { id: "vision", title: "识图", desc: "给日记照片写一句描述，让搭档看懂照片", toggle: true, placeholder: "例如 deepseek-v4-flash-vision-exp" },
  { id: "private", title: "隐私模式", desc: "可读隐私内容，宜用本机模型", toggle: true, thinking: true, placeholder: "例如 qwen3:8b" },
];

const SECTIONS = [
  { id: "models", label: "模型", icon: BotIcon },
  { id: "partner", label: "搭档与记忆", icon: BrainCircuitIcon },
  { id: "schedule", label: "定时整理", icon: CalendarClockIcon },
  { id: "system", label: "数据与系统", icon: DatabaseIcon },
  { id: "desktop", label: "桌面版", icon: MonitorIcon },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsPage() {
  const [res, setRes] = React.useState<Res | null>(null);
  const [s, setS] = React.useState<Settings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [section, setSection] = React.useState<SectionId>("models");
  const [editing, setEditing] = React.useState<number | null>(null);
  const desktop = useDesktop();
  const sections = SECTIONS.filter((x) => x.id !== "desktop" || desktop);
  const load = React.useCallback(async () => { const r = await api<Res>("/api/settings"); setRes(r); setS(r.settings); }, []);
  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => {
    const h = window.location.hash.slice(1);
    if (SECTIONS.some((x) => x.id === h)) setSection(h as SectionId);
  }, []);
  const go = (id: SectionId) => { setSection(id); history.replaceState(null, "", `#${id}`); };

  if (!s || !res) return <Page><Skeleton className="h-96" /></Page>;

  const dirty = JSON.stringify(s) !== JSON.stringify(res.settings);
  const save = async () => {
    setSaving(true);
    try { await api("/api/settings", { method: "PUT", json: s }); toast.success("设置已保存"); await load(); } finally { setSaving(false); }
  };
  const saveKey = async (provider: string, key: string) => {
    const unsaved = !res.settings.providers.some((p) => p.id === provider);
    if (unsaved) await api("/api/settings", { method: "PUT", json: s });
    await api("/api/settings", { method: "POST", json: { action: "setKey", provider, key } });
    toast.success(key ? (unsaved ? "服务商和 API Key 已保存" : "API Key 已保存") : "API Key 已清除");
    const r = await api<Res>("/api/settings");
    setRes(r);
    if (unsaved) setS(r.settings);
  };
  const set = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => setS({ ...s, [k]: { ...(s[k] as object), ...v } as Settings[K] });
  const setRole = (id: RoleId, v: Partial<Role>) => setS({ ...s, roles: { ...s.roles, [id]: { ...s.roles[id], ...v } } });
  const setProvider = (i: number, v: Partial<Provider>) => setS({ ...s, providers: s.providers.map((p, j) => (j === i ? { ...p, ...v } : p)) });
  const addProvider = () => {
    setS({ ...s, providers: [...s.providers, { id: `p${Date.now().toString(36)}`, name: "新服务商", baseURL: "https://", kind: "openai", local: false }] });
    setEditing(s.providers.length);
  };
  const usedBy = (id: string) => ROLES.filter((r) => s.roles[r.id].provider === id).map((r) => r.title);

  return (
    <Page className="pb-24">
      <PageHeader title="设置" description="所有配置都只保存在这台电脑上。" />
      <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
        {/* 分区导航：大屏在左侧，小屏横向滚动 */}
        <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-20 lg:mx-0 lg:h-fit lg:flex-col lg:overflow-visible lg:px-0">
          {sections.map((x) => (
            <button
              key={x.id}
              onClick={() => go(x.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                section === x.id ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <x.icon className="size-4" />{x.label}
            </button>
          ))}
        </nav>

        <div className="grid min-w-0 content-start gap-8">
          {section === "models" && (
            <>
              <Section title="模型角色" desc="不同任务用不同模型。修改后点底部「保存设置」，再测试连接。">
                <div className="@container overflow-hidden rounded-xl border">
                  <div className={cn(ROLE_GRID, "bg-muted/40 text-muted-foreground hidden border-b px-4 py-2 text-xs @3xl:grid")}>
                    <span>角色</span><span>服务商</span><span>模型</span><span className="text-center">思考</span><span className="text-center">启用</span><span className="text-center">测试</span>
                  </div>
                  <div className="divide-y">
                    {ROLES.map((r) => {
                      const role = s.roles[r.id];
                      const off = !!r.toggle && !role.enabled;
                      return (
                        <RoleRow
                          key={r.id}
                          meta={r}
                          role={role}
                          off={off}
                          providers={s.providers}
                          dirty={dirty}
                          onChange={(v) => setRole(r.id, v)}
                        />
                      );
                    })}
                  </div>
                </div>
              </Section>

              <Section
                title="模型服务商"
                desc="任何 OpenAI 兼容接口都可以添加，比如 DeepSeek、Kimi、通义、智谱、硅基流动、OpenRouter、Ollama。"
                action={<Button size="sm" variant="outline" onClick={addProvider}><PlusIcon />添加服务商</Button>}
              >
                <div className="divide-y rounded-xl border">
                  {s.providers.map((p, i) => {
                    const used = usedBy(p.id);
                    return (
                      <div key={p.id} className="flex items-center gap-3 p-4">
                        <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"><ServerIcon className="size-4" /></div>
                        <div className="grid min-w-0 flex-1 gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{p.name}</span>
                            {p.local
                              ? <Badge variant="outline" className="font-normal">本机</Badge>
                              : res.keys[p.id]
                                ? <Badge variant="secondary" className="font-normal"><CircleCheckIcon className="text-emerald-600" />已配置 Key</Badge>
                                : <Badge variant="outline" className="font-normal text-amber-600">未配置 Key</Badge>}
                            {used.length > 0 && <span className="text-muted-foreground text-xs">用于 {used.join("、")}</span>}
                          </div>
                          <code className="text-muted-foreground truncate text-xs" title={p.baseURL}>{p.baseURL}</code>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(i)}><PencilIcon />编辑</Button>
                      </div>
                    );
                  })}
                </div>
              </Section>
            </>
          )}

          {section === "partner" && (
            <>
              <Section title="基本">
                <Group>
                  <Row label="称呼" desc="搭档怎么称呼你"><Input className="h-8 w-40" value={s.user.name} onChange={(e) => set("user", { name: e.target.value })} /></Row>
                </Group>
              </Section>
              <Section title="行为与隐私">
                <Group>
                  <Row label="写操作需要我确认" desc="写日记、改计划、改当前处境前，先弹出卡片让你确认"><Switch checked={s.agent.requireApprovalForWrites} onCheckedChange={(v) => set("agent", { requireApprovalForWrites: v })} /></Row>
                  <Row label="对话后自动发现记忆" desc="每轮对话结束后用后台模型抽取候选，进入审核箱"><Switch checked={s.agent.autoExtractMemory} onCheckedChange={(v) => set("agent", { autoExtractMemory: v })} /></Row>
                  <Row label="允许把隐私内容发给云端模型" desc="关闭时，标记为隐私的资料和财务记忆只有本机模型能看到"><Switch checked={s.privacy.sendPrivateToCloud} onCheckedChange={(v) => set("privacy", { sendPrivateToCloud: v })} /></Row>
                </Group>
              </Section>
              <Section title="高级" desc="一般不需要改。">
                <Group>
                  <Row label="单轮最多工具步数" desc="一次回答里最多调用几次工具"><Input type="number" className="h-8 w-24" value={s.agent.maxSteps} min={1} max={30} onChange={(e) => set("agent", { maxSteps: Number(e.target.value) })} /></Row>
                  <Row label="上下文预算（tokens）" desc="系统提示、档案和检索结果加起来的大致上限"><Input type="number" className="h-8 w-28" value={s.agent.contextBudgetTokens} step={1000} onChange={(e) => set("agent", { contextBudgetTokens: Number(e.target.value) })} /></Row>
                </Group>
              </Section>
            </>
          )}

          {section === "schedule" && (
            <Section title="定时整理" desc="应用运行期间生效：每天从日记中整理记忆、建议更新当前处境；每周生成复盘草稿。">
              <Group>
                <Row label="启用定时整理"><Switch checked={s.scheduler.enabled} onCheckedChange={(v) => set("scheduler", { enabled: v })} /></Row>
                <Row label="每天几点后运行" desc="0–23 点">
                  <Input type="number" className="h-8 w-20" min={0} max={23} value={s.scheduler.dailyHour} disabled={!s.scheduler.enabled} onChange={(e) => set("scheduler", { dailyHour: Number(e.target.value) })} />
                </Row>
                <Row label="周复盘日">
                  <Select value={String(s.scheduler.weeklyReviewDay)} onValueChange={(v) => set("scheduler", { weeklyReviewDay: Number(v) })} disabled={!s.scheduler.enabled}>
                    <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>{"日一二三四五六".split("").map((d, i) => <SelectItem key={i} value={String(i)}>周{d}</SelectItem>)}</SelectContent>
                  </Select>
                </Row>
              </Group>
            </Section>
          )}

          {section === "desktop" && desktop && <DesktopSection />}
          {section === "system" && <SystemSection res={res} providers={s.providers} history={s.history ?? { enabled: true, keepDays: 90 }} setHistory={(v) => set("history", v)} />}
        </div>
      </div>

      {editing !== null && s.providers[editing] && (
        <ProviderDialog
          provider={s.providers[editing]}
          hasKey={!!res.keys[s.providers[editing].id]}
          builtin={["deepseek", "ollama"].includes(s.providers[editing].id)}
          usedBy={usedBy(s.providers[editing].id)}
          onChange={(v) => setProvider(editing, v)}
          onSaveKey={(key) => saveKey(s.providers[editing].id, key)}
          onDelete={() => { setS({ ...s, providers: s.providers.filter((_, j) => j !== editing) }); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}

      {dirty && (
        <div className="bg-background/90 fixed inset-x-0 bottom-(--mobile-nav-h) z-40 border-t p-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-1 md:px-3">
            <span className="text-muted-foreground mr-auto text-sm">有未保存的修改</span>
            <Button variant="outline" onClick={() => setS(res.settings)}>撤销</Button>
            <Button onClick={save} disabled={saving}>{saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}保存设置</Button>
          </div>
        </div>
      )}
    </Page>
  );
}

/* ---------- 布局小组件 ---------- */

function Section({ title, desc, action, children }: { title: string; desc?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h3 className="font-semibold">{title}</h3>
          {desc && <p className="text-muted-foreground text-sm">{desc}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="bg-card divide-y rounded-xl border">{children}</div>;
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="grid gap-0.5"><Label>{label}</Label>{desc && <span className="text-muted-foreground text-xs">{desc}</span>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ---------- 服务商编辑弹窗 ---------- */

function ProviderDialog({ provider: p, hasKey, builtin, usedBy, onChange, onSaveKey, onDelete, onClose }: {
  provider: Provider; hasKey: boolean; builtin: boolean; usedBy: string[];
  onChange: (v: Partial<Provider>) => void; onSaveKey: (key: string) => Promise<void>; onDelete: () => void; onClose: () => void;
}) {
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const saveKey = async (k: string) => { setBusy(true); try { await onSaveKey(k); setKey(""); } finally { setBusy(false); } };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>编辑服务商</DialogTitle>
          <DialogDescription>名称、地址等改动需要在页面底部点「保存设置」才会生效；API Key 单独保存，立即生效。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
            <div className="grid gap-1.5"><Label>名称</Label><Input value={p.name} onChange={(e) => onChange({ name: e.target.value })} /></div>
            <div className="grid gap-1.5">
              <Label>接口类型</Label>
              <Select value={p.kind} onValueChange={(v) => onChange({ kind: v as Provider["kind"] })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="deepseek">DeepSeek</SelectItem><SelectItem value="openai">OpenAI 兼容</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>接口地址</Label>
            <Input className="font-mono text-xs" value={p.baseURL} onChange={(e) => onChange({ baseURL: e.target.value })} placeholder="https://api.example.com/v1" />
            <span className="text-muted-foreground text-xs">填到 /v1 为止，不要带 /chat/completions。</span>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5"><span className="text-sm font-medium">本机模型</span><span className="text-muted-foreground text-xs">运行在这台电脑上（如 Ollama），可以看到隐私内容，不需要 API Key</span></div>
            <Switch checked={p.local} onCheckedChange={(v) => onChange({ local: v })} />
          </label>
          {!p.local && (
            <div className="grid gap-1.5">
              <div className="flex items-center gap-2">
                <Label>API Key</Label>
                {hasKey ? <span className="flex items-center gap-1 text-xs text-emerald-600"><CircleCheckIcon className="size-3" />已配置</span> : <span className="text-xs text-amber-600">未配置</span>}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <KeyRoundIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                  <Input type="password" className="pl-8 font-mono text-xs" placeholder={hasKey ? "粘贴新的 Key 以替换" : "粘贴 API Key"} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
                </div>
                <Button variant="outline" disabled={!key.trim() || busy} onClick={() => saveKey(key.trim())}>{busy && <LoaderCircleIcon className="animate-spin" />}保存 Key</Button>
                {hasKey && <Button variant="ghost" disabled={busy} onClick={() => saveKey("")}>清除</Button>}
              </div>
            </div>
          )}
          <div className="text-muted-foreground font-mono text-[11px]">id: {p.id}</div>
        </div>
        <DialogFooter className="sm:justify-between">
          {builtin
            ? <span className="text-muted-foreground self-center text-xs">内置服务商不能删除</span>
            : usedBy.length
              ? <span className="text-muted-foreground self-center text-xs">正在用于{usedBy.join("、")}，先在模型角色里换掉才能删除</span>
              : <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}><Trash2Icon />删除服务商</Button>}
          <Button onClick={onClose}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 模型角色行 ---------- */

const ROLE_GRID = "@3xl:grid @3xl:grid-cols-[180px_150px_minmax(0,1fr)_48px_48px_48px] @3xl:items-center @3xl:gap-4";

type TestState = { ok: boolean; info: string; ms?: number } | null;

function RoleRow({ meta, role, off, providers, dirty, onChange }: {
  meta: (typeof ROLES)[number]; role: Role; off: boolean; providers: Provider[]; dirty: boolean; onChange: (v: Partial<Role>) => void;
}) {
  const [st, setSt] = React.useState<TestState>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setSt(null), [role.provider, role.model, role.thinking]);
  const test = async () => {
    setBusy(true);
    try { setSt(await api("/api/settings", { method: "POST", json: { action: "test", role: meta.id } })); } catch { setSt(null); } finally { setBusy(false); }
  };
  const dim = off && "opacity-45";
  return (
    <div className="px-4 py-3">
      <div className={cn(ROLE_GRID, "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2")}>
        {/* 角色 */}
        <div className={cn("min-w-0", dim)}>
          <div className="text-sm font-medium">{meta.title}</div>
          <div className="text-muted-foreground text-xs leading-relaxed">{meta.desc}</div>
        </div>
        {/* 小屏：启用开关放在标题右边 */}
        <div className="flex items-center justify-end @3xl:hidden">
          {meta.toggle && <Switch checked={role.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />}
        </div>
        {/* 服务商 */}
        <div className={cn("col-span-2 @3xl:col-span-1", dim)}>
          <Select value={role.provider} onValueChange={(v) => onChange({ provider: v })} disabled={off}>
            <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {/* 模型 */}
        <div className={cn("col-span-2 @3xl:col-span-1", dim)}>
          <Input className="h-8 font-mono text-xs" value={role.model} disabled={off} onChange={(e) => onChange({ model: e.target.value })} placeholder={meta.placeholder} />
        </div>
        {/* 思考 */}
        <div className={cn("flex items-center gap-2 @3xl:justify-center", dim)}>
          {meta.thinking
            ? <><Switch checked={role.thinking} disabled={off} onCheckedChange={(v) => onChange({ thinking: v })} aria-label="思考模式" /><span className="text-muted-foreground text-xs @3xl:hidden">思考模式</span></>
            : <span className="text-muted-foreground/50 hidden text-xs @3xl:inline">—</span>}
        </div>
        {/* 启用 */}
        <div className="hidden justify-center @3xl:flex">
          {meta.toggle
            ? <Switch checked={role.enabled} onCheckedChange={(v) => onChange({ enabled: v })} aria-label="启用" />
            : <span className="text-muted-foreground/50 text-xs" title="必需，始终启用">—</span>}
        </div>
        {/* 测试 */}
        <div className="flex justify-end @3xl:justify-center">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={test}
            disabled={busy || dirty || off}
            title={dirty ? "先保存设置再测试" : off ? "已关闭" : st ? (st.ok ? `连接正常 · ${st.ms}ms` : st.info) : "测试连接"}
            className={cn(st?.ok && "text-emerald-600 hover:text-emerald-600", st && !st.ok && "text-rose-600 hover:text-rose-600")}
          >
            {busy ? <LoaderCircleIcon className="animate-spin" /> : st ? (st.ok ? <CircleCheckIcon /> : <CircleXIcon />) : <ZapIcon />}
          </Button>
        </div>
      </div>
      {st && !st.ok && <p className="mt-2 text-xs break-all text-rose-600">{st.info}</p>}
      {st?.ok && <p className="mt-2 text-xs text-emerald-600 @3xl:hidden">连接正常 · {st.ms}ms</p>}
    </div>
  );
}

/* ---------- 数据与系统 ---------- */

function SystemSection({ res, providers, history: hist, setHistory }: { res: Res; providers: Provider[]; history: Settings["history"]; setHistory: (v: Partial<Settings["history"]>) => void }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [st, setSt] = React.useState<{ index: Record<string, number | string>; embed: { ok: boolean; error?: string; pending?: number; model?: string } } | null>(null);
  const loadSt = React.useCallback(() => api<typeof st>("/api/jobs").then(setSt).catch(() => {}), []);
  React.useEffect(() => { void loadSt(); }, [loadSt]);
  const run = async (job: string, extra: object = {}) => {
    setBusy(job);
    try { const r = await api<{ message?: string }>("/api/jobs", { method: "POST", json: { job: job === "reindex-full" ? "reindex" : job, ...extra } }); toast.success(r.message ?? "完成"); await loadSt(); } finally { setBusy(null); }
  };
  const usage = [
    { label: "今日调用", value: `${res.usage.calls} 次` },
    { label: "输入 tokens", value: res.usage.prompt.toLocaleString() },
    { label: "缓存命中", value: res.usage.cacheHit.toLocaleString() },
    { label: "输出 tokens", value: res.usage.completion.toLocaleString() },
  ];
  const index = st ? [
    { label: "文件", value: String(st.index.notes) },
    { label: "片段", value: String(st.index.chunks) },
    { label: "向量", value: String(st.index.embeddings) },
  ] : null;
  const coverage = st && Number(st.index.chunks) > 0 ? Math.min(100, Math.round((Number(st.index.embeddings) / Number(st.index.chunks)) * 100)) : null;
  // "providerId:model" → "服务商名 · model"
  const embedModel = st?.embed.model ? (() => {
    const [pid, ...rest] = st.embed.model!.split(":");
    const name = providers.find((p) => p.id === pid)?.name;
    return name ? `${name} · ${rest.join(":")}` : st.embed.model!;
  })() : null;
  const copyPath = async (p: string) => { await navigator.clipboard.writeText(p); toast.success("路径已复制"); };
  const openDir = async (target: string) => { const r = await api<{ path: string }>("/api/backup/open", { method: "POST", json: { target } }); toast.success("已在文件管理器中打开", { description: r.path }); };
  return (
    <>
      <Section title="模型用量">
        <div className="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border sm:grid-cols-4">
          {usage.map((u) => (
            <div key={u.label} className="bg-card px-4 py-3">
              <div className="text-muted-foreground text-xs">{u.label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">{u.value}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="检索索引" desc="索引和向量都由 vault 自动生成，可以随时重建，不会影响你的数据。">
        <Group>
          {/* 状态 */}
          <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
            <div className="grid grid-cols-3 gap-3">
              {(index ?? [{ label: "文件", value: "" }, { label: "片段", value: "" }, { label: "向量", value: "" }]).map((x) => (
                <div key={x.label}>
                  <div className="text-muted-foreground text-xs">{x.label}</div>
                  {x.value ? <div className="text-xl font-semibold tabular-nums">{x.value}</div> : <Skeleton className="mt-1 h-7 w-12" />}
                </div>
              ))}
            </div>
            <div className="bg-muted/40 grid gap-2 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                {st ? (
                  st.embed.ok
                    ? <span className="flex items-center gap-1.5 font-medium text-emerald-600"><span className="size-1.5 rounded-full bg-emerald-500" />向量服务正常</span>
                    : <span className="flex items-center gap-1.5 font-medium text-amber-600" title={st.embed.error}><span className="size-1.5 rounded-full bg-amber-500" />向量服务不可用，已改用关键词检索</span>
                ) : <Skeleton className="h-4 w-24" />}
                {coverage !== null && <span className="text-muted-foreground tabular-nums">覆盖 {coverage}%</span>}
              </div>
              {coverage !== null && (
                <div className="bg-border h-1.5 overflow-hidden rounded-full">
                  <div className={cn("h-full rounded-full transition-all", st?.embed.ok ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${coverage}%` }} />
                </div>
              )}
              {embedModel && (
                <div className="text-muted-foreground truncate text-xs" title={embedModel}>
                  {embedModel}{st?.embed.pending ? ` · 待处理 ${st.embed.pending}` : ""}
                </div>
              )}
            </div>
          </div>
          {/* 维护操作 */}
          {[
            { job: "reindex", extra: {}, icon: RefreshCwIcon, title: "增量更新索引", desc: "只处理有变化的文件，几秒完成" },
            { job: "embed", extra: {}, icon: SparklesIcon, title: "补算向量", desc: "给还没有向量的片段计算向量" },
            { job: "reindex-full", extra: { full: true }, icon: RotateCcwIcon, title: "完全重建索引", desc: "清空后重新扫描全部文件，索引异常时使用" },
          ].map((a) => (
            <div key={a.job} className="flex items-center gap-3 px-4 py-3">
              <a.icon className="text-muted-foreground size-4 shrink-0" />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm">{a.title}</span>
                <span className="text-muted-foreground text-xs">{a.desc}</span>
              </div>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(a.job, a.extra)}>
                {busy === a.job && <LoaderCircleIcon className="animate-spin" />}运行
              </Button>
            </div>
          ))}
        </Group>
      </Section>

      <HistorySection hist={hist} setHistory={setHistory} />

      <Section title="存储位置">
        <Group>
          {[
            { target: "vault", icon: FolderIcon, title: "资料文件夹", hint: "你的全部数据，可以用 Obsidian 打开", path: res.paths.vault },
            { target: "app", icon: HardDriveIcon, title: "运行数据", hint: "设置、API Key、索引、聊天原始记录", path: res.paths.app },
          ].map((d) => (
            <div key={d.target} className="flex items-center gap-3 px-4 py-3.5">
              <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"><d.icon className="size-4" /></div>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <div className="flex items-baseline gap-2"><span className="text-sm font-medium">{d.title}</span><span className="text-muted-foreground hidden text-xs sm:inline">{d.hint}</span></div>
                <code className="text-muted-foreground truncate text-xs" title={d.path}>{d.path}</code>
              </div>
              <Button size="icon-sm" variant="ghost" title="复制路径" onClick={() => copyPath(d.path)}><CopyIcon /></Button>
              <Button size="sm" variant="outline" onClick={() => openDir(d.target)}><FolderOpenIcon />打开</Button>
            </div>
          ))}
        </Group>
      </Section>
    </>
  );
}

/* ---------- 桌面版（只在 Electron 里显示） ---------- */
function DesktopSection() {
  const desktop = useDesktop();
  const [d, setD] = React.useState<DesktopSettings | null>(null);
  const [upd, setUpd] = React.useState<UpdateInfo | null>(null);
  const [checking, setChecking] = React.useState(false);
  React.useEffect(() => { void desktop?.getSettings().then(setD); }, [desktop]);
  if (!desktop || !d) return <Skeleton className="h-64" />;
  const isMac = d.platform === "darwin";
  const patch = async (p: Partial<DesktopSettings>) => {
    setD({ ...d, ...p, notify: { ...d.notify, ...(p.notify ?? {}) } });
    const r = await desktop.setSettings(p);
    if (r?.error) { toast.error(r.error); setD(await desktop.getSettings()); }
  };
  const check = async () => {
    setChecking(true);
    try { const r = await desktop.checkUpdate(); setUpd(r); if (r.ok && !r.newer) toast.success(`已是最新版本 ${r.current}`); }
    finally { setChecking(false); }
  };
  return (
    <>
      <Section title="数据" desc="你的日记、档案和设置都在这个文件夹里，可以直接用 Obsidian 打开 vault。">
        <Group>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
            <div className="grid min-w-0 flex-1 gap-0.5">
              <Label>数据文件夹</Label>
              <code className="text-muted-foreground truncate text-xs">{d.dataDir}</code>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={() => desktop.openPath("data")} disabled={d.dev}><FolderOpenIcon />打开</Button>
              <Button size="sm" variant="outline" onClick={async () => { const r = await desktop.changeDataDir(); if (r.error) toast.error(r.error); }} disabled={d.dev}>更改…</Button>
            </div>
          </div>
        </Group>
      </Section>

      <Section title="启动与窗口">
        <Group>
          <Row label="开机自动启动" desc="登录后在后台启动，定时整理和提醒照常运行"><Switch checked={d.openAtLogin} onCheckedChange={(v) => patch({ openAtLogin: v })} /></Row>
          <Row label={isMac ? "关闭窗口后留在菜单栏" : "关闭窗口后留在托盘"} desc="不退出程序，从托盘图标重新打开；关闭此项则点 × 直接退出"><Switch checked={d.closeToTray} onCheckedChange={(v) => patch({ closeToTray: v })} /></Row>
          <Row label="快速写日记" desc="在任何地方按下快捷键，打开今天的日记">
            <ShortcutInput value={d.shortcut} isMac={isMac} onChange={(v) => patch({ shortcut: v })} />
          </Row>
        </Group>
      </Section>

      <Section title="通知" action={<Button size="sm" variant="ghost" onClick={() => desktop.testNotification()}><BellIcon />发送测试通知</Button>}>
        <Group>
          <Row label="新记忆待审核" desc="搭档从日记和对话里发现新事实时提醒"><Switch checked={d.notify.memory} onCheckedChange={(v) => patch({ notify: { ...d.notify, memory: v } })} /></Row>
          <Row label="复盘草稿生成" desc="每周复盘写好后提醒你去看"><Switch checked={d.notify.review} onCheckedChange={(v) => patch({ notify: { ...d.notify, review: v } })} /></Row>
          <Row label="提醒写日记" desc="到点还没写今天的日记时提醒一次">
            <div className="flex items-center gap-2">
              <Input type="time" className="h-8 w-28" value={d.notify.journalTime} disabled={!d.notify.journal}
                onChange={(e) => setD({ ...d, notify: { ...d.notify, journalTime: e.target.value } })}
                onBlur={(e) => patch({ notify: { ...d.notify, journalTime: e.target.value || "21:30" } })} />
              <Switch checked={d.notify.journal} onCheckedChange={(v) => patch({ notify: { ...d.notify, journal: v } })} />
            </div>
          </Row>
        </Group>
      </Section>

      <Section title="关于">
        <Group>
          <Row label="当前版本" desc={d.dev ? "开发模式" : undefined}><span className="text-sm tabular-nums">{d.version}</span></Row>
          <Row label="自动检查更新" desc="每天检查一次 GitHub 上的新版本，有更新时通知你"><Switch checked={d.checkUpdates} onCheckedChange={(v) => patch({ checkUpdates: v })} /></Row>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
            <Button size="sm" variant="outline" onClick={check} disabled={checking}>{checking ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}检查更新</Button>
            <Button size="sm" variant="ghost" onClick={() => desktop.openPath("logs")}><FileTextIcon />打开日志文件夹</Button>
            {upd && !upd.ok && <span className="text-muted-foreground text-xs">检查失败：{upd.error}</span>}
            {upd?.ok && upd.newer && (
              <span className="flex items-center gap-2 text-sm">
                <Badge>新版本 {upd.latest}</Badge>
                <Button size="sm" onClick={() => upd.url && desktop.openExternal(upd.url)}>前往下载</Button>
              </span>
            )}
          </div>
        </Group>
      </Section>
    </>
  );
}

/** 快捷键录制：点一下，按下组合键即可 */
function ShortcutInput({ value, isMac, onChange }: { value: string; isMac: boolean; onChange: (v: string) => void }) {
  const [rec, setRec] = React.useState(false);
  const pretty = (acc: string) => acc ? acc.replace("CommandOrControl", isMac ? "⌘" : "Ctrl").replace("Alt", isMac ? "⌥" : "Alt").replace("Shift", isMac ? "⇧" : "Shift").split("+").join(isMac ? "" : " + ") : "未设置";
  const onKey = (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === "Escape") { setRec(false); return; }
    if (e.key === "Backspace" || e.key === "Delete") { onChange(""); setRec(false); return; }
    if (["Control", "Meta", "Alt", "Shift"].includes(e.key)) return;
    const mods = [(e.ctrlKey || e.metaKey) && "CommandOrControl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
    if (!mods.length) { toast.message("请至少按住 Ctrl / ⌘ 或 Alt 再按一个键"); return; }
    const k = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit(\d)$/.exec(e.code)?.[1] ?? (/^F\d{1,2}$/.test(e.code) ? e.code : null) ?? (e.code === "Space" ? "Space" : null);
    if (!k) return;
    onChange([...mods, k].join("+"));
    setRec(false);
  };
  return (
    <button type="button" onClick={() => setRec(true)} onBlur={() => setRec(false)} onKeyDown={rec ? onKey : undefined}
      className={cn("h-8 min-w-36 rounded-md border px-3 text-sm tabular-nums transition-colors", rec ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-background hover:bg-muted")}>
      {rec ? "按下快捷键…（Esc 取消）" : pretty(value)}
    </button>
  );
}

/* ---------- 历史与回收站（内置快照，不依赖 git） ---------- */
type HistoryRes = {
  stats: { versions: number; versionBytes: number; trashItems: number; trashBytes: number; keepDays: number; trashDays: number; enabled: boolean };
  recent: { t: number; path: string; actor: string; actorLabel: string; text: string; kind: string }[];
  trash: { id: string; path: string; name: string; title: string; deletedAt: string; size: number }[];
};
const fmtBytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
function fmtWhen(t: number | string) {
  const d = new Date(t), now = new Date();
  const ymd = (x: Date) => x.toLocaleDateString("sv-SE");
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (ymd(d) === ymd(now)) return `今天 ${hm}`;
  if (ymd(d) === ymd(new Date(now.getTime() - 864e5))) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")} ${hm}`;
}

function HistorySection({ hist, setHistory }: { hist: Settings["history"]; setHistory: (v: Partial<Settings["history"]>) => void }) {
  const [h, setH] = React.useState<HistoryRes | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const load = React.useCallback(() => api<HistoryRes>("/api/history").then(setH).catch(() => {}), []);
  React.useEffect(() => { void load(); }, [load]);
  const act = async (json: object, ok: string, key: string) => {
    setBusy(key);
    try { await api("/api/history", { method: "POST", json }); toast.success(ok); await load(); } catch { /* 已提示 */ } finally { setBusy(null); }
  };
  // 合并连续的相同修改
  const recent = (() => {
    const out: (HistoryRes["recent"][number] & { count: number })[] = [];
    for (const e of h?.recent ?? []) {
      const prev = out[out.length - 1];
      if (prev && prev.text === e.text && prev.actor === e.actor) { prev.count++; continue; }
      out.push({ ...e, count: 1 });
    }
    return out.slice(0, showAll ? 40 : 8);
  })();
  const isImage = (p: string) => /\.(webp|jpe?g|png|gif|heic|avif)$/i.test(p);

  return (
    <>
      <Section title="历史版本" desc="每次修改前，旧内容都会自动存一份在本机（.app/history），在日记、档案、计划、文件里点「历史」就能对比和恢复。">
        <Group>
          <Row label="自动保存历史版本" desc={h ? `已保存 ${h.stats.versions} 个版本，占用 ${fmtBytes(h.stats.versionBytes)}` : undefined}>
            <Switch checked={hist.enabled} onCheckedChange={(v) => setHistory({ enabled: v })} />
          </Row>
          <Row label="保留时间" desc="更早的版本会自动清理；每个文件最近 3 个版本始终保留">
            <Select value={String(hist.keepDays)} onValueChange={(v) => setHistory({ keepDays: Number(v) })} disabled={!hist.enabled}>
              <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{[30, 90, 180, 365, 3650].map((d) => <SelectItem key={d} value={String(d)}>{d === 3650 ? "一直保留" : d === 365 ? "1 年" : `${d} 天`}</SelectItem>)}</SelectContent>
            </Select>
          </Row>
          {recent.length > 0 && (
            <div className="px-4 py-3">
              <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs"><HistoryIcon className="size-3.5" />最近的修改</div>
              <ol className="relative grid">
                {recent.map((e, i) => (
                  <li key={`${e.t}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
                    <div className="relative flex w-3 shrink-0 justify-center">
                      <span className={cn("relative z-10 mt-1.5 size-2 rounded-full ring-4 ring-card", e.kind === "delete" ? "bg-rose-500" : e.kind === "restore" ? "bg-emerald-500" : e.actor === "user" ? "bg-primary" : "bg-muted-foreground/40")} />
                      {i < recent.length - 1 && <span className="bg-border absolute top-3 -bottom-0 w-px" />}
                    </div>
                    <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm">
                        <span className="text-muted-foreground">{e.actorLabel} · </span>{e.text}
                        {e.count > 1 && <span className="text-muted-foreground ml-1.5 text-xs">×{e.count}</span>}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{fmtWhen(e.t)}</span>
                    </div>
                  </li>
                ))}
              </ol>
              {(h?.recent.length ?? 0) > 8 && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="text-muted-foreground hover:text-foreground mt-2 text-xs underline-offset-2 hover:underline">{showAll ? "收起" : "显示更多"}</button>
              )}
            </div>
          )}
        </Group>
      </Section>

      <Section title="最近删除" desc={`删除的日记、档案、照片会先放在这里，${h?.stats.trashDays ?? 30} 天后自动清理。`}
        action={h && h.trash.length > 0 ? (
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={!!busy}
            onClick={() => { if (window.confirm(`永久删除回收站里的 ${h.trash.length} 项？此操作无法撤销。`)) void act({ action: "purgeTrash" }, "回收站已清空", "all"); }}>
            <Trash2Icon />清空
          </Button>
        ) : undefined}>
        <Group>
          {!h ? <div className="p-4"><Skeleton className="h-10" /></div>
            : h.trash.length === 0 ? <div className="text-muted-foreground px-4 py-6 text-center text-sm">回收站是空的</div>
            : h.trash.map((x) => (
              <div key={x.id} className="flex items-center gap-3 px-4 py-3">
                {isImage(x.path)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <span className="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md"><span className="text-muted-foreground text-[10px]">照片</span></span>
                  : <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md"><FileTextIcon className="size-4" /></span>}
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm">{isImage(x.path) ? x.name : x.title}</span>
                  <span className="text-muted-foreground truncate text-xs">{fmtWhen(x.deletedAt)} 删除 · {fmtBytes(x.size)} · {x.path}</span>
                </div>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act({ action: "restoreTrash", id: x.id }, "已恢复到原来的位置", x.id)}>
                  {busy === x.id ? <LoaderCircleIcon className="animate-spin" /> : <RotateCcwIcon />}恢复
                </Button>
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" title="永久删除" disabled={!!busy}
                  onClick={() => act({ action: "purgeTrash", id: x.id }, "已永久删除", x.id)}><Trash2Icon /></Button>
              </div>
            ))}
        </Group>
      </Section>
    </>
  );
}
