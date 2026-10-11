"use client";
/* 调整分类：勾选照片所属的相册（多张时显示半选），可直接新建相册 */
import * as React from "react";
import { toast } from "sonner";
import { CheckIcon, FolderIcon, LoaderCircleIcon, MinusIcon, PlusIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { Album, Photo } from "./shared";

type State = "on" | "off" | "some";

export function CategorizeDialog({ paths, photos, albums, onClose, onDone }: {
  paths: string[] | null; photos: Photo[]; albums: Album[]; onClose: () => void; onDone: () => void;
}) {
  const list = React.useMemo(() => photos.filter((p) => paths?.includes(p.path)), [photos, paths]);
  const initial = React.useCallback((id: string): State => {
    const n = list.filter((p) => p.albums.includes(id)).length;
    return n === 0 ? "off" : n === list.length ? "on" : "some";
  }, [list]);
  const [state, setState] = React.useState<Record<string, State>>({});
  const [extra, setExtra] = React.useState<Album[]>([]);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setState({}); setExtra([]); setName(""); }, [paths]);

  const all = [...albums, ...extra.filter((e) => !albums.some((a) => a.id === e.id))];
  const get = (id: string) => state[id] ?? initial(id);
  const toggle = (id: string) => setState((s) => ({ ...s, [id]: get(id) === "on" ? "off" : "on" }));
  const changed = all.filter((a) => state[a.id] && state[a.id] !== initial(a.id));

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const r = await api<{ album: Album }>("/api/photos", { method: "POST", json: { action: "createAlbum", name: n } });
      setExtra((x) => [...x, r.album]);
      setState((s) => ({ ...s, [r.album.id]: "on" }));
      setName("");
    } catch { /* api() 已提示 */ } finally { setBusy(false); }
  };

  const save = async () => {
    if (!paths) return;
    setBusy(true);
    try {
      for (const a of changed) {
        await api("/api/photos", { method: "POST", json: { action: state[a.id] === "on" ? "addToAlbum" : "removeFromAlbum", paths, album: a.id } });
      }
      toast.success(changed.length ? "分类已更新" : "没有变化");
      onDone();
    } catch { /* api() 已提示 */ } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!paths} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>调整分类</DialogTitle>
          <DialogDescription>{list.length > 1 ? `${list.length} 张照片` : "这张照片"}放进哪些相册？一张照片可以同时在多个相册里。</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 max-h-72 space-y-0.5 overflow-y-auto">
          {all.length === 0 && <p className="text-muted-foreground px-2 py-3 text-sm">还没有相册，在下面新建一个吧。</p>}
          {all.map((a) => {
            const st = get(a.id);
            return (
              <button key={a.id} type="button" onClick={() => toggle(a.id)} aria-pressed={st === "on"}
                className="hover:bg-muted flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors">
                <span className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors [&_svg]:size-3",
                  st === "off" ? "border-input" : "border-sky-500 bg-sky-500 text-white")}>
                  {st === "on" ? <CheckIcon className="stroke-[3]" /> : st === "some" ? <MinusIcon className="stroke-[3]" /> : null}
                </span>
                <FolderIcon className="text-muted-foreground size-4" />
                <span className="flex-1 truncate">{a.name}</span>
                {st === "some" && <span className="text-muted-foreground text-xs">部分</span>}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="新建相册，比如 旅行" maxLength={40}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } }} />
          <Button variant="outline" onClick={create} disabled={busy || !name.trim()}><PlusIcon />新建</Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy}>{busy && <LoaderCircleIcon className="animate-spin" />}保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
