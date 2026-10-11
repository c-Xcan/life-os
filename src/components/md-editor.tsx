"use client";
import * as React from "react";
import { toast } from "sonner";
import { EyeIcon, PencilIcon, SaveIcon, HistoryIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { HistoryDialog } from "@/components/history-dialog";

type FileRes = { path: string; exists: boolean; raw: string; body: string; fm: Record<string, unknown>; versions?: number };

const FM_LABEL: Record<string, string> = {
  type: "类型", status: "状态", domain: "领域", date: "日期", updated: "更新", created: "创建", priority: "优先级",
  horizon: "周期", due: "截止", progress: "进度", period: "周期", label: "标签", private: "隐私", tags: "标签",
  mood: "心情", energy: "精力", sleep: "睡眠", start: "开始", end: "结束",
};

function fmChips(fm: Record<string, unknown>) {
  return Object.entries(fm)
    .filter(([k, v]) => k !== "title" && k !== "facts" && !k.startsWith("_") && v !== "" && v !== null && v !== undefined && (typeof v !== "object" || (Array.isArray(v) && v.length > 0 && v.length <= 6 && v.every((x) => typeof x !== "object"))))
    .slice(0, 10)
    .map(([k, v]) => ({ k, label: FM_LABEL[k] ?? k, value: Array.isArray(v) ? v.join("、") : typeof v === "boolean" ? (v ? "是" : "否") : String(v) }));
}

/** 通用 Markdown 文件编辑器：预览 / 编辑（含 frontmatter）/ Ctrl+S 保存 / 版本记录 */
export function MdEditor({ path, className, onSaved, defaultMode = "preview", showPath = true, header }: {
  path: string; className?: string; onSaved?: () => void; defaultMode?: "preview" | "edit"; showPath?: boolean;
  /** 标题栏左侧内容（不传则显示路径） */
  header?: React.ReactNode;
}) {
  const [file, setFile] = React.useState<FileRes | null>(null);
  const [mode, setMode] = React.useState<"preview" | "edit">(defaultMode);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const dirty = file ? draft !== file.raw : false;

  const load = React.useCallback(async () => {
    const f = await api<FileRes>(`/api/vault/file?path=${encodeURIComponent(path)}`);
    setFile(f);
    setDraft(f.raw);
  }, [path]);
  React.useEffect(() => { setFile(null); void load(); }, [load]);

  const save = React.useCallback(async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await api("/api/vault/file", { method: "PUT", json: { path, raw: draft } });
      toast.success("已保存");
      await load();
      onSaved?.();
    } finally { setSaving(false); }
  }, [dirty, draft, path, load, onSaved]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const chips = file ? fmChips(file.fm) : [];
  const empty = file ? !file.body.replace(/<!--[\s\S]*?-->/g, "").replace(/^#.*$/gm, "").trim() : false;

  return (
    <div className={cn("bg-card text-card-foreground flex min-h-0 flex-col overflow-hidden rounded-xl border shadow-xs", className)}>
      {/* 标题栏 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 md:px-5">
        <div className="min-w-0 flex-1">
          {header ?? (showPath && <code className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">{path}</code>)}
        </div>
        <div className="flex items-center gap-1.5">
          {file?.exists && (
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)} title="查看和恢复历史版本"><HistoryIcon />历史{file.versions ? <span className="text-muted-foreground text-xs tabular-nums">{file.versions}</span> : null}</Button>
          )}
          <div className="bg-muted flex rounded-lg p-0.5">
            {([["preview", "预览", EyeIcon], ["edit", "编辑", PencilIcon]] as const).map(([m, label, Icon]) => (
              <button key={m} onClick={() => setMode(m)}
                className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all [&_svg]:size-3.5",
                  mode === m ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                <Icon />{label}
              </button>
            ))}
          </div>
          <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || saving} onClick={save}>
            {saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}保存
          </Button>
        </div>
      </div>

      <HistoryDialog path={path} open={showHistory} onOpenChange={setShowHistory} onRestored={() => void load()} />

      {!file ? (
        <div className="space-y-3 p-6"><Skeleton className="h-7 w-1/3" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-48 w-full" /></div>
      ) : mode === "edit" ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          autoFocus
          placeholder="开始用 Markdown 书写…"
          className="min-h-[65vh] flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[13px] leading-6 outline-none md:px-8 md:py-6"
        />
      ) : (
        <div className="flex-1 px-5 py-5 md:px-10 md:py-8">
          <div className="mx-auto max-w-3xl">
            {chips.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-1.5 border-b border-dashed pb-5">
                {chips.map((c) => (
                  <span key={c.k} className="bg-muted/60 inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-xs">
                    <span className="text-muted-foreground">{c.label}</span>
                    <span className="truncate font-medium">{c.value}</span>
                  </span>
                ))}
              </div>
            )}
            {!file.exists ? (
              <p className="text-muted-foreground text-sm">这个文件还不存在，切换到「编辑」写点内容，保存后会自动创建。</p>
            ) : empty ? (
              <div>
                <Markdown className="opacity-60">{file.body}</Markdown>
                <button onClick={() => setMode("edit")} className="text-muted-foreground hover:border-foreground/30 hover:text-foreground mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-sm transition-colors"><PencilIcon className="size-4" />这里还是空的，点击开始填写</button>
              </div>
            ) : <Markdown className="[&>h1:first-child]:mt-0">{file.body}</Markdown>}
          </div>
        </div>
      )}

      {file && (
        <div className="text-muted-foreground flex items-center gap-3 border-t px-4 py-2 text-[11px] md:px-5">
          {dirty ? <span className="flex items-center gap-1.5 text-amber-600"><span className="size-1.5 rounded-full bg-amber-500" />有未保存的修改 · Ctrl+S 保存</span>
            : <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" />已保存</span>}
          <span className="ml-auto tabular-nums">{draft.length.toLocaleString()} 字符 · {draft.split("\n").length} 行</span>
        </div>
      )}
    </div>
  );
}
