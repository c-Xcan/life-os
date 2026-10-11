"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  BookTextIcon, BotIcon, BrainIcon, CalendarCheckIcon, ChevronRightIcon, CopyIcon, FileTextIcon, FolderIcon,
  HardDriveIcon, LayoutGridIcon, LayoutTemplateIcon, MessagesSquareIcon, NotebookPenIcon, PackageIcon,
  PaperclipIcon, SearchIcon, TargetIcon, UserRoundIcon, XIcon, type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/misc";
import { MdEditor } from "@/components/md-editor";
import { useApi, DOMAIN_LABEL, useDomains } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/components/page";

type Node = { name: string; path: string; dir: boolean; children?: Node[] };

/** 顶层目录的中文名、图标和颜色 */
const FOLDERS: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  profile: { label: "档案", icon: UserRoundIcon, cls: "text-blue-500" },
  domains: { label: "领域档案", icon: LayoutGridIcon, cls: "text-violet-500" },
  memory: { label: "记忆", icon: BrainIcon, cls: "text-fuchsia-500" },
  journal: { label: "日记", icon: NotebookPenIcon, cls: "text-emerald-500" },
  plans: { label: "计划", icon: TargetIcon, cls: "text-orange-500" },
  reviews: { label: "复盘", icon: CalendarCheckIcon, cls: "text-sky-500" },
  sessions: { label: "对话记录", icon: MessagesSquareIcon, cls: "text-teal-500" },
  skills: { label: "技能", icon: BotIcon, cls: "text-amber-500" },
  _templates: { label: "模板", icon: LayoutTemplateIcon, cls: "text-slate-500" },
  exports: { label: "导出", icon: PackageIcon, cls: "text-slate-500" },
  attachments: { label: "附件", icon: PaperclipIcon, cls: "text-slate-500" },
};
const ORDER = ["profile", "domains", "memory", "journal", "plans", "reviews", "sessions", "skills", "_templates", "exports", "attachments"];

const FILE_LABEL: Record<string, string> = {
  "README.ai.md": "给 AI 的说明", "now.md": "当前处境", "profile/identity.md": "我是谁", "profile/background.md": "经历",
  "memory/preferences.md": "搭档偏好", "reviews/weekly": "周复盘", "reviews/monthly": "月复盘", "memory/facts": "事实记忆",
};

function niceName(n: Node) {
  if (FILE_LABEL[n.path]) return FILE_LABEL[n.path];
  const m = /^(domains|memory\/facts)\/([^/]+)\.md$/.exec(n.path);
  if (m) return DOMAIN_LABEL[m[2]] ?? m[2];
  return n.name.replace(/\.md$/, "");
}

const countFiles = (n: Node): number => (n.dir ? (n.children ?? []).reduce((a, c) => a + countFiles(c), 0) : 1);

function flatten(nodes: Node[], out: Node[] = []) {
  for (const n of nodes) { if (n.dir) flatten(n.children ?? [], out); else out.push(n); }
  return out;
}

export default function FilesPage() {
  return <React.Suspense fallback={<div className="p-6"><Skeleton className="h-96" /></div>}><Inner /></React.Suspense>;
}

function Inner() {
  useDomains();
  const sp = useSearchParams();
  const router = useRouter();
  const sel = sp.get("path") || "README.ai.md";
  const { data } = useApi<{ root: string; tree: Node[] }>("/api/vault/tree");
  const [q, setQ] = React.useState("");
  const select = (p: string) => router.replace(`/files?path=${encodeURIComponent(p)}`, { scroll: false });

  const tree = React.useMemo(() => {
    if (!data) return [];
    const files = data.tree.filter((n) => !n.dir);
    const dirs = data.tree.filter((n) => n.dir).sort((a, b) => (ORDER.indexOf(a.name) + 1 || 99) - (ORDER.indexOf(b.name) + 1 || 99));
    return [...files, ...dirs];
  }, [data]);
  const all = React.useMemo(() => flatten(tree), [tree]);
  const results = q.trim() ? all.filter((f) => (f.path + niceName(f)).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 50) : null;

  // 面包屑
  const parts = sel.split("/");
  const crumbs = parts.slice(0, -1).map((p, i) => {
    const full = parts.slice(0, i + 1).join("/");
    return i === 0 ? FOLDERS[p]?.label ?? p : FILE_LABEL[full] ?? p;
  });
  const fileNode = all.find((f) => f.path === sel) ?? { name: parts[parts.length - 1], path: sel, dir: false };
  const top = FOLDERS[parts[0]];
  const TopIcon = parts.length > 1 ? top?.icon ?? FolderIcon : BookTextIcon;

  return (
    <Page>
      <PageHeader
        title="文件"
        description="所有资料都是本地的 Markdown 文件，也可以用 Obsidian、VS Code 等任意编辑器打开。"
        actions={data && (
          <button
            onClick={() => { void navigator.clipboard.writeText(data.root).then(() => toast.success("已复制路径")); }}
            className="bg-card hover:bg-muted group flex max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-xs transition-colors"
            title="复制资料库路径"
          >
            <HardDriveIcon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="text-muted-foreground max-w-[340px] truncate font-mono">{data.root}</span>
            <CopyIcon className="text-muted-foreground group-hover:text-foreground size-3.5 shrink-0" />
          </button>
        )}
      />

      <div className="grid gap-5 md:grid-cols-[272px_minmax(0,1fr)]">
        {/* 文件树 */}
        <aside className="bg-card flex flex-col overflow-hidden rounded-xl border shadow-xs md:sticky md:top-16 md:max-h-[calc(100vh-5rem)] md:self-start">
          <div className="border-b p-2.5">
            <div className="bg-muted/60 focus-within:ring-ring/40 flex items-center gap-2 rounded-lg px-2.5 focus-within:ring-2">
              <SearchIcon className="text-muted-foreground size-3.5 shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="筛选文件…" className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" />
              {q && <button onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground"><XIcon className="size-3.5" /></button>}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!data ? <div className="space-y-2 p-1">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-7" />)}</div>
              : results ? (
                results.length === 0 ? <p className="text-muted-foreground px-2 py-6 text-center text-xs">没有匹配的文件</p> : results.map((f) => (
                  <button key={f.path} onClick={() => select(f.path)} className={cn("flex w-full flex-col rounded-md px-2.5 py-1.5 text-left transition-colors", sel === f.path ? "bg-accent" : "hover:bg-muted/60")}>
                    <span className="truncate text-sm">{niceName(f)}</span>
                    <span className="text-muted-foreground truncate font-mono text-[11px]">{f.path}</span>
                  </button>
                ))
              ) : tree.map((n) => <TreeItem key={n.path} node={n} sel={sel} onSelect={select} depth={0} />)}
          </div>
          {data && <div className="text-muted-foreground border-t px-4 py-2 text-[11px]">共 {all.length} 个文件</div>}
        </aside>

        {/* 内容 */}
        <MdEditor
          key={sel}
          path={sel}
          header={
            <div className="flex min-w-0 items-center gap-3">
              <span className={cn("bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", parts.length > 1 ? top?.cls ?? "text-muted-foreground" : "text-foreground")}><TopIcon /></span>
              <div className="min-w-0">
                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <span>资料库</span>
                  {crumbs.map((c, i) => <React.Fragment key={i}><ChevronRightIcon className="size-3 opacity-60" /><span className="truncate">{c}</span></React.Fragment>)}
                </div>
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-semibold">{niceName(fileNode)}</span>
                  <code className="text-muted-foreground hidden truncate text-[11px] sm:inline">{fileNode.name}</code>
                </div>
              </div>
            </div>
          }
        />
      </div>
    </Page>
  );
}

function TreeItem({ node, sel, onSelect, depth }: { node: Node; sel: string; onSelect: (p: string) => void; depth: number }) {
  const [open, setOpen] = React.useState(() => sel.startsWith(node.path + "/"));
  const meta = depth === 0 ? FOLDERS[node.name] : undefined;

  if (node.dir) {
    const n = countFiles(node);
    const Icon = meta?.icon ?? FolderIcon;
    const label = meta?.label ?? FILE_LABEL[node.path] ?? node.name;
    return (
      <div>
        <button onClick={() => setOpen(!open)} disabled={!n}
          className={cn("group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors", n ? "hover:bg-muted/60" : "cursor-default opacity-50")}>
          <ChevronRightIcon className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", open && n && "rotate-90", !n && "invisible")} />
          <Icon className={cn("size-4 shrink-0", meta?.cls ?? "text-muted-foreground")} />
          <span className={cn("truncate", depth === 0 && "font-medium")}>{label}</span>
          <span className="text-muted-foreground ml-auto text-[11px] tabular-nums">{n || ""}</span>
        </button>
        {open && n > 0 && (
          <div className="border-border ml-[15px] border-l pl-1.5">
            {node.children!.map((c) => <TreeItem key={c.path} node={c} sel={sel} onSelect={onSelect} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }
  const active = sel === node.path;
  return (
    <button onClick={() => onSelect(node.path)}
      className={cn("relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-accent text-foreground font-medium" : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
        depth === 0 && "pl-[30px]")}>
      {active && depth > 0 && <span className="bg-foreground absolute top-1.5 bottom-1.5 -left-[8px] w-0.5 rounded-full" />}
      <FileTextIcon className={cn("size-3.5 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
      <span className="truncate">{niceName(node)}</span>
    </button>
  );
}
