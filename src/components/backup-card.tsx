"use client";
import * as React from "react";
import { toast } from "sonner";
import {
  ArchiveIcon, CheckIcon, DownloadIcon, FileArchiveIcon, FileTextIcon, FolderInputIcon, FolderOpenIcon,
  HardDriveIcon, HistoryIcon, LoaderCircleIcon, NotebookPenIcon, ShieldCheckIcon,
  TriangleAlertIcon, UploadIcon, XIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, useApi } from "@/lib/client";
import { cn } from "@/lib/utils";

type Info = { vaultPath: string; notes: number; journals: number; bytes: number; versions: number; safety: { name: string; size: number; mtime: string }[] };
type Picked = { file: File; path: string };
type Pending =
  | { kind: "zip"; file: File }
  | { kind: "folder"; files: Picked[]; label: string; notes: number };
type RestoreResult = { vaultFiles: number; withHistory: boolean; appFiles: number; settingsRestored: boolean; safetyBackup: string };

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

const SKIP_DIR = /(^|\/)node_modules(\/|$)/;
const isReadme = (p: string) => /(^|\/)README\.ai\.md$/.test(p) && !p.includes(".git/");

/* ---------- 拖拽：把拖进来的文件 / 文件夹展开成带相对路径的文件列表 ---------- */

function readEntries(reader: FileSystemDirectoryReader) {
  return new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
}
function entryFile(entry: FileSystemFileEntry) {
  return new Promise<File>((res, rej) => entry.file(res, rej));
}
async function walkEntry(entry: FileSystemEntry, prefix: string, out: Picked[]) {
  const path = prefix + entry.name;
  if (SKIP_DIR.test(path)) return;
  if (entry.isFile) {
    out.push({ file: await entryFile(entry as FileSystemFileEntry), path });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries 每次最多返回 100 项，要循环读到空为止
    for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
      for (const e of batch) await walkEntry(e, `${path}/`, out);
    }
  }
}

/* ---------- 页面 ---------- */

export function BackupCard({ className }: { className?: string }) {
  const { data: info, reload } = useApi<Info>("/api/backup/info");
  const [includeHistory, setIncludeHistory] = React.useState(true);
  const [includeApp, setIncludeApp] = React.useState(true);
  const [downloading, setDownloading] = React.useState(false);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [restoreSettings, setRestoreSettings] = React.useState(true);
  const [importing, setImporting] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [reading, setReading] = React.useState(false);
  const dragDepth = React.useRef(0);
  const folderRef = React.useRef<HTMLInputElement>(null);
  const zipRef = React.useRef<HTMLInputElement>(null);

  const saveBlob = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const fetchZip = async (url: string, fallback: string) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? `下载失败 (${res.status})`);
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallback;
    saveBlob(blob, name);
    return blob;
  };

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await fetchZip(`/api/backup?history=${includeHistory ? 1 : 0}&app=${includeApp ? 1 : 0}`, "life-os-backup.zip");
      toast.success(`已下载完整备份（${fmtSize(blob.size)}）`, { description: "建议存到网盘或 U 盘，不要只放在这台电脑上。" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  };

  const downloadSafety = (name: string) =>
    fetchZip(`/api/backup/info?download=${encodeURIComponent(name)}`, name).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));

  const openFolder = async () => {
    const r = await api<{ path: string }>("/api/backup/open", { method: "POST", json: {} });
    toast.success("已在文件管理器中打开 vault", { description: r.path });
  };

  /** 统一处理选中 / 拖入的内容：单个 zip 或一个 vault 文件夹 */
  const accept = (files: Picked[]) => {
    const list = files.filter((f) => !SKIP_DIR.test(f.path));
    if (!list.length) return;
    if (list.length === 1 && /\.zip$/i.test(list[0].file.name)) {
      setPending({ kind: "zip", file: list[0].file });
      return;
    }
    if (!list.some((f) => isReadme(f.path))) {
      toast.error("没有找到 README.ai.md", { description: "请拖入 Life OS 的备份 zip，或者整个 vault 文件夹。" });
      return;
    }
    // 以前 git 留下的 .git 目录不再上传
    const picked = list.filter((f) => !/(^|\/)\.git(\/|$)/.test(f.path));
    const notes = picked.filter((f) => f.path.endsWith(".md")).length;
    const label = picked[0].path.includes("/") ? picked[0].path.split("/")[0] : "所选文件";
    setPending({ kind: "folder", files: picked, label, notes });
  };

  const onFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).map((file) => ({
      file,
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));
    e.target.value = "";
    accept(files);
  };
  const onZipInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) accept([{ file, path: file.name }]);
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (importing) return;
    // 必须在第一个 await 之前取出 entry，之后 DataTransfer 会失效
    const entries = Array.from(e.dataTransfer.items)
      .map((it) => (it.kind === "file" ? it.webkitGetAsEntry?.() : null))
      .filter((x): x is FileSystemEntry => !!x);
    const plain = Array.from(e.dataTransfer.files);
    setReading(true);
    try {
      const out: Picked[] = [];
      if (entries.length) for (const en of entries) await walkEntry(en, "", out);
      else out.push(...plain.map((file) => ({ file, path: file.name })));
      accept(out);
    } catch {
      toast.error("读取拖入的内容失败，可以改用下方按钮选择");
    } finally {
      setReading(false);
    }
  };

  const doImport = async () => {
    if (!pending) return;
    setImporting(true);
    try {
      const fd = new FormData();
      if (restoreSettings) fd.append("restoreSettings", "1");
      if (pending.kind === "zip") fd.append("zip", pending.file);
      else for (const f of pending.files) { fd.append("files", f.file); fd.append("paths", f.path); }
      const r = await api<RestoreResult>("/api/backup", { method: "POST", body: fd });
      setPending(null);
      toast.success(`导入完成：${r.vaultFiles} 个文件${r.withHistory ? "，含版本历史" : ""}${r.settingsRestored ? "，已恢复设置" : ""}`, {
        description: "原来的数据已自动备份，可在本页底部找到。页面即将刷新。",
        duration: 8000,
      });
      void reload();
      setTimeout(() => window.location.reload(), 2500);
    } catch {
      /* api() 已经弹出错误提示 */
    } finally {
      setImporting(false);
    }
  };

  const stats = [
    { icon: FileTextIcon, label: "笔记", value: info ? `${info.notes} 篇` : null },
    { icon: NotebookPenIcon, label: "日记", value: info ? `${info.journals} 篇` : null },
    { icon: HistoryIcon, label: "历史版本", value: info ? `${info.versions} 个` : null },
    { icon: HardDriveIcon, label: "占用空间", value: info ? fmtSize(info.bytes) : null },
  ];

  return (
    <div className={cn("grid gap-4", className)}>
      {/* 当前数据概况 */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="bg-border grid grid-cols-2 gap-px sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-card flex items-center gap-3 px-5 py-4">
              <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"><s.icon className="size-4" /></div>
              <div className="min-w-0">
                <div className="text-muted-foreground text-xs">{s.label}</div>
                {s.value ? <div className="text-lg font-semibold tabular-nums">{s.value}</div> : <Skeleton className="mt-1 h-6 w-14" />}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <span className="text-muted-foreground text-xs">数据位置</span>
          <code className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={info?.vaultPath}>{info?.vaultPath ?? "…"}</code>
          <Button size="sm" variant="ghost" onClick={openFolder}><FolderOpenIcon />打开文件夹</Button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 导出 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ArchiveIcon className="size-4" />导出完整备份</CardTitle>
            <CardDescription>下载一个 zip，解压后就是原样的 vault 文件夹，换电脑时用「导入 / 迁移」恢复即可。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="divide-y rounded-lg border">
              <label htmlFor="bk-history" className="flex cursor-pointer items-center justify-between gap-4 p-3">
                <div className="grid gap-0.5"><span className="text-sm font-medium">历史版本</span><span className="text-muted-foreground text-xs">每份资料修改前的旧内容，换电脑后也能找回</span></div>
                <Switch id="bk-history" checked={includeHistory} onCheckedChange={setIncludeHistory} />
              </label>
              <label htmlFor="bk-app" className="flex cursor-pointer items-center justify-between gap-4 p-3">
                <div className="grid gap-0.5"><span className="text-sm font-medium">设置与聊天记录</span><span className="text-muted-foreground text-xs">模型角色、原始对话、待审核的记忆</span></div>
                <Switch id="bk-app" checked={includeApp} onCheckedChange={setIncludeApp} />
              </label>
            </div>
            <ul className="grid gap-1.5 text-sm">
              <li className="flex items-center gap-2"><CheckIcon className="size-4 text-emerald-600" />全部日记、档案、计划、复盘、记忆和附件</li>
              <li className="flex items-center gap-2"><CheckIcon className="size-4 text-emerald-600" />解压即可用 Obsidian 或其他 AI 工具直接打开</li>
              <li className="text-muted-foreground flex items-center gap-2"><XIcon className="size-4" />不含 API Key 和索引（索引导入后自动重建）</li>
            </ul>
            <Button className="mt-auto w-full" size="lg" onClick={download} disabled={downloading}>
              {downloading ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}下载完整备份
            </Button>
          </CardContent>
        </Card>

        {/* 导入 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FolderInputIcon className="size-4" />导入 / 迁移</CardTitle>
            <CardDescription>导入会替换当前 vault，替换前会自动备份现有数据，出问题可以随时找回。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <div
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40 hover:bg-muted/30",
              )}
            >
              <div className={cn("flex size-12 items-center justify-center rounded-full transition-colors", dragging ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {reading ? <LoaderCircleIcon className="size-5 animate-spin" /> : <UploadIcon className={cn("size-5 transition-transform", dragging && "-translate-y-0.5")} />}
              </div>
              <div className="grid gap-1">
                <div className="font-medium">{reading ? "正在读取…" : dragging ? "松开即可导入" : "把备份 zip 或 vault 文件夹拖到这里"}</div>
                <div className="text-muted-foreground text-xs">支持本页导出的 zip、自己压缩的 vault，或者直接拖入整个文件夹</div>
              </div>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => zipRef.current?.click()} disabled={reading}><FileArchiveIcon />选择 zip</Button>
                <Button size="sm" variant="outline" onClick={() => folderRef.current?.click()} disabled={reading}><FolderInputIcon />选择文件夹</Button>
              </div>
            </div>
            <input ref={zipRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onZipInput} />
            <input ref={folderRef} type="file" className="hidden" multiple onChange={onFolderInput} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          </CardContent>
        </Card>
      </div>

      {/* 导入前的自动备份 */}
      {!!info?.safety.length && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><HistoryIcon className="size-4" />导入前的自动备份</CardTitle>
            <CardDescription>每次导入前都会保存一份。想回到导入前的状态，下载后在上方导入即可。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-lg border">
              {info.safety.map((b) => (
                <div key={b.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <ShieldCheckIcon className="text-muted-foreground size-4 shrink-0" />
                  <span className="tabular-nums">{fmtTime(b.mtime)}</span>
                  <span className="text-muted-foreground text-xs">{fmtSize(b.size)}</span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void downloadSafety(b.name)}><DownloadIcon />下载</Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 导入确认 */}
      <Dialog open={!!pending} onOpenChange={(v) => { if (!v && !importing) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入并替换当前数据？</DialogTitle>
            <DialogDescription>确认后会用下面的内容替换当前 vault。</DialogDescription>
          </DialogHeader>
          {pending && (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                {pending.kind === "zip" ? <FileArchiveIcon className="size-5" /> : <FolderInputIcon className="size-5" />}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{pending.kind === "zip" ? pending.file.name : pending.label}</div>
                <div className="text-muted-foreground text-xs">
                  {pending.kind === "zip"
                    ? `压缩包 · ${fmtSize(pending.file.size)}`
                    : `文件夹 · ${pending.notes} 篇笔记 · ${pending.files.length} 个文件`}
                </div>
              </div>
            </div>
          )}
          <div className="grid gap-2 rounded-lg bg-amber-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400"><TriangleAlertIcon className="size-4" />导入前请注意</div>
            <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-xs">
              <li>当前 vault 会被替换，替换前自动完整备份，可在本页底部找到。</li>
              <li>聊天记录和待审核记忆会合并，不会删除现有的。</li>
              <li>请先关闭正在编辑 vault 的其他程序（如 Obsidian），避免文件被占用。</li>
            </ul>
          </div>
          <label htmlFor="bk-settings" className="flex cursor-pointer items-center justify-between gap-4">
            <div className="grid gap-0.5"><Label htmlFor="bk-settings">同时恢复设置</Label><span className="text-muted-foreground text-xs">模型角色等配置；API Key 不受影响</span></div>
            <Switch id="bk-settings" checked={restoreSettings} onCheckedChange={setRestoreSettings} />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={importing}>取消</Button>
            <Button onClick={doImport} disabled={importing}>{importing && <LoaderCircleIcon className="animate-spin" />}导入并替换</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
