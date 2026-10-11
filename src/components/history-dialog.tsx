"use client";
/* 历史版本：左侧版本列表，右侧预览 / 与当前对比，一键恢复（恢复前会先把当前内容存为一个版本，可以再撤回） */
import * as React from "react";
import { toast } from "sonner";
import { HistoryIcon, LoaderCircleIcon, RotateCcwIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

type Version = { id: string; at: string; size: number };
type Info = { path: string; title: string; current: { raw: string; mtime: number } | null; versions: Version[] };

/** 去掉 frontmatter，预览只看正文 */
const bodyOf = (raw: string) => raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

function when(iso: string) {
  const d = new Date(iso), now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dd = Math.round((day(now) - day(d)) / 864e5);
  if (dd === 0) return `今天 ${hm}`;
  if (dd === 1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
}

/** 按行对比（LCS），文件不大，够用 */
function diffLines(a: string, b: string) {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return [{ t: "same" as const, s: "（文件太大，无法对比）" }];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: "same" | "del" | "add"; s: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: "same", s: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: "del", s: A[i++] });
    else out.push({ t: "add", s: B[j++] });
  }
  while (i < n) out.push({ t: "del", s: A[i++] });
  while (j < m) out.push({ t: "add", s: B[j++] });
  return out;
}

export function HistoryDialog({ path, open, onOpenChange, onRestored }: { path: string; open: boolean; onOpenChange: (v: boolean) => void; onRestored?: () => void }) {
  const [info, setInfo] = React.useState<Info | null>(null);
  const [sel, setSel] = React.useState<string | null>(null);
  const [raw, setRaw] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"diff" | "preview">("diff");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await api<Info>(`/api/history?path=${encodeURIComponent(path)}`);
    setInfo(r);
    setSel(r.versions[0]?.id ?? null);
  }, [path]);
  React.useEffect(() => { if (open) { setInfo(null); setRaw(null); void load(); } }, [open, load]);
  React.useEffect(() => {
    if (!sel) { setRaw(null); return; }
    setRaw(null);
    api<{ raw: string }>(`/api/history?path=${encodeURIComponent(path)}&id=${sel}`).then((r) => setRaw(r.raw)).catch(() => {});
  }, [sel, path]);

  const current = info?.current?.raw ?? "";
  const diff = React.useMemo(() => (raw === null ? [] : diffLines(bodyOf(raw), bodyOf(current))), [raw, current]);
  const changes = diff.filter((d) => d.t !== "same").length;

  const restore = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      await api("/api/history", { method: "POST", json: { action: "restore", path, id: sel } });
      toast.success("已恢复到这个版本", { description: "恢复前的内容也存成了一个版本，可以随时再改回来" });
      onRestored?.();
      onOpenChange(false);
    } catch { /* api() 已提示 */ } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(720px,calc(100svh-2rem))] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base"><HistoryIcon className="size-4" />历史版本</DialogTitle>
          <DialogDescription className="mt-0.5 truncate">{info?.title ?? path} · 修改前的内容会自动保存，30 分钟内的连续修改合并为一个版本</DialogDescription>
        </div>
        {!info ? (
          <div className="grid flex-1 gap-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>
        ) : info.versions.length === 0 ? (
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm">
            <HistoryIcon className="size-8 opacity-50" />
            还没有历史版本。<br />以后每次修改，旧内容都会自动存在这里。
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* 版本列表 */}
            <div className="max-h-40 shrink-0 overflow-y-auto border-b p-2 md:max-h-none md:w-56 md:border-r md:border-b-0">
              <div className="text-muted-foreground px-2 py-1.5 text-[11px]">当前</div>
              <div className="text-muted-foreground px-3 pb-2 text-xs">{info.current ? "正在使用的内容" : "文件已不存在"}</div>
              <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px]">之前的版本 · {info.versions.length}</div>
              {info.versions.map((v) => (
                <button key={v.id} type="button" onClick={() => setSel(v.id)}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    sel === v.id ? "bg-accent font-medium" : "hover:bg-muted/60")}>
                  <span className="truncate">{when(v.at)}</span>
                  <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">{v.size < 1024 ? `${v.size} B` : `${(v.size / 1024).toFixed(1)} KB`}</span>
                </button>
              ))}
            </div>
            {/* 预览 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b px-4 py-2">
                <div className="bg-muted flex rounded-lg p-0.5">
                  {([["diff", "与当前对比"], ["preview", "这个版本"]] as const).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setView(k)}
                      className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-all", view === k ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>{label}</button>
                  ))}
                </div>
                {view === "diff" && raw !== null && <span className="text-muted-foreground text-xs">{changes ? `${changes} 行不同` : "和当前内容一样"}</span>}
                <Button size="sm" className="ml-auto" onClick={restore} disabled={busy || !sel || raw === null}>
                  {busy ? <LoaderCircleIcon className="animate-spin" /> : <RotateCcwIcon />}恢复此版本
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {raw === null ? (
                  <div className="space-y-2 p-5"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24" /></div>
                ) : view === "preview" ? (
                  <div className="px-5 py-4"><Markdown className="[&>*:first-child]:mt-0">{bodyOf(raw)}</Markdown></div>
                ) : (
                  <div className="py-2 font-mono text-[12.5px] leading-6">
                    {diff.map((d, i) => (
                      <div key={i} className={cn("flex gap-2 px-4 whitespace-pre-wrap",
                        d.t === "del" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : d.t === "add" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
                        <span className="w-3 shrink-0 select-none opacity-60">{d.t === "del" ? "−" : d.t === "add" ? "+" : " "}</span>
                        <span className="min-w-0 break-words">{d.s || " "}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {view === "diff" && raw !== null && changes > 0 && (
                <div className="text-muted-foreground border-t px-4 py-2 text-[11px]">
                  <span className="text-rose-600 dark:text-rose-400">− 红色</span>：只在这个版本里有；<span className="text-emerald-600 dark:text-emerald-400">+ 绿色</span>：当前新增的内容
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
