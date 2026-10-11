"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FolderMinusIcon, FolderPlusIcon, MapPinIcon, NotebookPenIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Thumb, type ViewProps } from "./shared";

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** 列表：适合整理，可多选批量加入/移出相册、删除，描述可直接改 */
export function ListView({ photos, albums, onOpen, currentAlbum, onChanged }: ViewProps & { currentAlbum?: string; onChanged: () => void }) {
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setSel(new Set()), [photos]);
  // 日记照片只能在日记里管理，不能勾选
  const free = photos.filter((p) => !p.journals.length);
  const all = free.length > 0 && sel.size === free.length;
  const toggle = (p: string) => setSel((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const albumName = (id: string) => albums.find((a) => a.id === id)?.name ?? "";
  const paths = [...sel];

  const act = async (json: object, msg: string) => {
    setBusy(true);
    try { await api("/api/photos", { method: "POST", json }); toast.success(msg); setSel(new Set()); onChanged(); } finally { setBusy(false); }
  };

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      {/* 批量操作栏 */}
      <div className={cn("flex min-h-12 flex-wrap items-center gap-2 border-b px-3 py-2", sel.size > 0 && "bg-muted/40")}>
        <input type="checkbox" className="accent-foreground size-4" checked={all} ref={(el) => { if (el) el.indeterminate = sel.size > 0 && !all; }}
          disabled={!free.length} onChange={() => setSel(all ? new Set() : new Set(free.map((p) => p.path)))} aria-label="全选" />
        <span className="text-muted-foreground text-sm">{sel.size ? `已选 ${sel.size} 张` : `共 ${photos.length} 张`}</span>
        {sel.size > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {albums.length > 0 && (
              <Select value="" onValueChange={(id) => act({ action: "addToAlbum", paths, album: id }, `已加入「${albumName(id)}」`)}>
                <SelectTrigger size="sm" className="w-36" disabled={busy}><FolderPlusIcon className="size-4" /><SelectValue placeholder="加入相册" /></SelectTrigger>
                <SelectContent>{albums.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {currentAlbum && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "removeFromAlbum", paths, album: currentAlbum }, "已移出相册")}><FolderMinusIcon />移出此相册</Button>
            )}
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2Icon />删除</Button>
          </div>
        )}
      </div>

      <div className="divide-y">
        {photos.map((p, i) => (
          <div key={p.path} className={cn("group flex items-center gap-3 px-3 py-2 transition-colors", sel.has(p.path) ? "bg-muted/50" : "hover:bg-muted/30")}>
            {p.journals.length ? (
              <span title="日记照片只能在日记里修改或删除" className="text-muted-foreground flex size-4 shrink-0 items-center justify-center"><NotebookPenIcon className="size-3.5" /></span>
            ) : (
              <input type="checkbox" className="accent-foreground size-4 shrink-0" checked={sel.has(p.path)} onChange={() => toggle(p.path)} aria-label="选择" />
            )}
            <Thumb photo={p} onClick={() => onOpen(i)} className="size-12 shrink-0 cursor-zoom-in rounded-md" />
            <div className="min-w-0 flex-1">
              <CaptionEdit photo={p} onSaved={onChanged} />
              <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="tabular-nums">{p.takenAt ? p.takenAt.replace("T", " ").slice(0, 16) : p.date}</span>
                {p.journals.map((d) => (
                  <Link key={d} href={`/journal?date=${d}`} className="hover:text-foreground flex items-center gap-0.5"><NotebookPenIcon className="size-3" />{d.slice(5)} 日记</Link>
                ))}
                {p.albums.map((a) => <span key={a} className="bg-muted rounded px-1.5">{albumName(a)}</span>)}
                {p.tags.map((t) => <span key={t}>#{t}</span>)}
                {p.lat !== undefined && <span className="flex items-center gap-0.5"><MapPinIcon className="size-3" />有位置</span>}
              </div>
            </div>
            <span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:inline">{fmtSize(p.size)}</span>
          </div>
        ))}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 {sel.size} 张照片？</DialogTitle>
            <DialogDescription>
              照片会移进回收站，30 天内可以在「设置 → 数据与系统 → 最近删除」里恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => { await act({ action: "delete", paths }, "已删除"); setConfirmDelete(false); }}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CaptionEdit({ photo, onSaved }: { photo: ViewProps["photos"][number]; onSaved: () => void }) {
  const [v, setV] = React.useState(photo.caption);
  React.useEffect(() => setV(photo.caption), [photo.caption]);
  const save = async () => {
    if (v.trim() === photo.caption) return;
    await api("/api/photos", { method: "POST", json: { action: "caption", path: photo.path, caption: v } });
    toast.success("描述已更新");
    onSaved();
  };
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(photo.caption); (e.target as HTMLInputElement).blur(); } }}
      placeholder="添加描述…" className="hover:bg-muted/60 focus:bg-muted/60 focus:ring-ring/40 -mx-1.5 w-full truncate rounded px-1.5 py-0.5 text-sm outline-none focus:ring-2" />
  );
}
