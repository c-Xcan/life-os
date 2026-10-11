"use client";
import * as React from "react";
import { toast } from "sonner";
import {
  CalendarRangeIcon, ImagePlusIcon, InfinityIcon, LayoutGridIcon,
  ListIcon, LoaderCircleIcon, NotebookPenIcon, PencilIcon, PlayIcon, PlusIcon, ScanIcon, SearchIcon,
  Trash2Icon, UploadIcon, CircleCheckIcon, CheckIcon, FolderInputIcon, XIcon, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lightbox } from "@/components/lightbox";
import { api, useApi, todayStr } from "@/lib/client";
import { appendExif, compressToWebp, readExif } from "@/lib/image";
import { cn } from "@/lib/utils";
import { photoUrl, type Album, type Photo } from "@/components/photos/shared";
import { MasonryView } from "@/components/photos/masonry";
import { TimelineView } from "@/components/photos/timeline";
import { ListView } from "@/components/photos/list-view";
import { TunnelView } from "@/components/photos/tunnel";
import { RibbonView } from "@/components/photos/ribbon";
import { MemoriesPlayer } from "@/components/photos/memories";
import { JournalPanel } from "@/components/photos/journal-sheet";
import { CategorizeDialog } from "@/components/photos/categorize-dialog";

type ViewId = "masonry" | "timeline" | "list" | "tunnel" | "ribbon";
const VIEWS: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "masonry", label: "瀑布流", icon: LayoutGridIcon },
  { id: "timeline", label: "时间轴", icon: CalendarRangeIcon },
  { id: "list", label: "列表", icon: ListIcon },
  { id: "tunnel", label: "隧道", icon: ScanIcon },
  { id: "ribbon", label: "丝带", icon: InfinityIcon },
];

/** 支持多选的视图（列表视图自带勾选；动画视图不支持） */
const SELECTABLE: ViewId[] = ["masonry", "timeline"];

/** 筛选：all | journal | located | loose | album:<id> */
type Filter = string;

export default function PhotosPage() {
  const { data, loading, reload } = useApi<{ albums: Album[]; photos: Photo[] }>("/api/photos");
  const albums = data?.albums ?? [];
  const all = data?.photos ?? [];

  const [filter, setFilter] = React.useState<Filter>("all");
  const [view, setViewRaw] = React.useState<ViewId>("masonry");
  const [q, setQ] = React.useState("");
  const [tag, setTag] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<number | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [uploading, setUploading] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [albumDialog, setAlbumDialog] = React.useState<{ mode: "create" | "rename" | "delete"; album?: Album } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  /* ---------- 多选 ---------- */
  const [selecting, setSelecting] = React.useState(false);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  /** 待确认删除的照片路径 */
  const [del, setDel] = React.useState<string[] | null>(null);
  /** 调整分类的照片 */
  const [cat, setCat] = React.useState<string[] | null>(null);
  const journalPaths = React.useMemo(() => new Set(all.filter((p) => p.journals.length).map((p) => p.path)), [all]);
  const exitSelect = React.useCallback(() => { setSelecting(false); setSel(new Set()); }, []);
  const selection = React.useMemo(() => ({
    active: selecting,
    has: (p: string) => sel.has(p),
    toggle: (p: string) => setSel((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; }),
    start: (p: string) => { setSelecting(true); setSel(new Set([p])); },
    locked: (p: string) => journalPaths.has(p),
  }), [selecting, sel, journalPaths]);

  /** 页面内拖动（比如拖一张图片）不能当成上传：只接受从页面外拖进来的文件 */
  const internalDrag = React.useRef(false);
  React.useEffect(() => {
    const on = () => { internalDrag.current = true; };
    const off = () => { internalDrag.current = false; };
    document.addEventListener("dragstart", on);
    document.addEventListener("dragend", off);
    document.addEventListener("drop", off);
    return () => { document.removeEventListener("dragstart", on); document.removeEventListener("dragend", off); document.removeEventListener("drop", off); };
  }, []);

  React.useEffect(() => { try { const v = localStorage.getItem("photos:view"); if (v && VIEWS.some((x) => x.id === v)) setViewRaw(v as ViewId); } catch { /* 忽略 */ } }, []);
  const setView = (v: ViewId) => { setViewRaw(v); try { localStorage.setItem("photos:view", v); } catch { /* 忽略 */ } };
  // 切换视图或分类时退出选择
  React.useEffect(() => { exitSelect(); }, [view, filter, exitSelect]);

  const currentAlbum = filter.startsWith("album:") ? filter.slice(6) : undefined;
  if (currentAlbum && data && !albums.some((a) => a.id === currentAlbum)) setTimeout(() => setFilter("all"));

  const counts = {
    all: all.length,
    journal: all.filter((p) => p.journals.length).length,
    located: all.filter((p) => p.lat !== undefined).length,
    loose: all.filter((p) => !p.journals.length && !p.albums.length).length,
  };
  const scoped = all.filter((p) =>
    filter === "all" ? true
      : filter === "journal" ? p.journals.length > 0
      : filter === "located" ? p.lat !== undefined
      : filter === "loose" ? !p.journals.length && !p.albums.length
      : p.albums.includes(currentAlbum!));
  const tags = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const p of scoped) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [scoped]);
  const kw = q.trim().toLowerCase();
  const shown = scoped.filter((p) => (!tag || p.tags.includes(tag)) && (!kw || p.caption.toLowerCase().includes(kw) || p.tags.some((t) => t.includes(kw)) || p.date.includes(kw)));

  /** 吸顶栏高度：时间轴的月份标题吸在它下方 */
  const barRef = React.useRef<HTMLDivElement>(null);
  const [barH, setBarH] = React.useState(0);
  React.useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 分类标签页：数量为 0 的系统分类不显示（选中时除外） */
  type Cat = { id: Filter; label: string; count: number; album?: Album };
  const cats: Cat[] = ([
    { id: "all", label: "全部", count: counts.all },
    { id: "journal", label: "日记", count: counts.journal },
    { id: "located", label: "有位置", count: counts.located },
    { id: "loose", label: "未分类", count: counts.loose },
    ...albums.map((a) => ({ id: `album:${a.id}`, label: a.name, count: all.filter((p) => p.albums.includes(a.id)).length, album: a })),
  ] as Cat[]).filter((c) => c.id === "all" || c.id === "journal" || c.album || c.count > 0 || filter === c.id);

  const title = filter === "all" ? "全部照片" : filter === "journal" ? "日记照片" : filter === "located" ? "有位置的照片" : filter === "loose" ? "未分类" : albums.find((a) => a.id === currentAlbum)?.name ?? "相册";

  /* ---------- 上传 ---------- */
  const upload = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!imgs.length) { if (files.length) toast.error("只能上传图片"); return; }
    setUploading((n) => n + imgs.length);
    const tid = toast.loading(`正在上传 ${imgs.length} 张照片…`);
    let ok = 0;
    let visionErr: string | null = null;
    for (const f of imgs) {
      try {
        const exif = await readExif(f);
        const webp = await compressToWebp(f);
        const fd = new FormData();
        fd.append("file", webp, "photo.webp");
        fd.append("date", exif.takenAt?.slice(0, 10) ?? todayStr());
        if (currentAlbum) fd.append("album", currentAlbum);
        appendExif(fd, exif);
        const r = await api<{ captionError?: string | null }>("/api/attachments", { method: "POST", body: fd });
        if (r.captionError) visionErr = r.captionError;
        ok++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    toast.dismiss(tid);
    if (ok) toast.success(`已上传 ${ok} 张照片${currentAlbum ? `到「${title}」` : ""}`);
    if (visionErr) toast.warning("识图失败，部分照片没有生成描述", { description: visionErr });
    void reload();
  };

  // 选择模式下按 Esc 退出（看大图时 Esc 先关大图）
  React.useEffect(() => {
    if (!selecting || viewing !== null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exitSelect(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, viewing, exitSelect]);
  // 删除后大图序号越界时，退到最后一张
  React.useEffect(() => {
    if (viewing !== null && viewing >= shown.length) setViewing(shown.length ? shown.length - 1 : null);
  }, [viewing, shown.length]);

  const act = async (json: object, msg: string) => {
    setBusy(true);
    try { await api("/api/photos", { method: "POST", json }); toast.success(msg); exitSelect(); }
    catch { /* api() 已提示错误 */ }
    finally { setBusy(false); void reload(); }
  };
  const selPaths = [...sel];
  /** 可操作的照片（日记照片只能在日记里管理） */
  const free = shown.filter((p) => !p.journals.length);
  const allSelected = free.length > 0 && free.every((p) => sel.has(p.path));
  const canSelect = SELECTABLE.includes(view) && free.length > 0 && filter !== "journal";
  const isJournalTab = filter === "journal";

  const lightboxItems = shown.map((p) => ({ src: photoUrl(p), caption: [p.caption, p.takenAt ? p.takenAt.replace("T", " ").slice(0, 16) : p.date].filter(Boolean).join(" · ") }));
  const viewProps = { photos: shown, albums, onOpen: setViewing, select: SELECTABLE.includes(view) ? selection : undefined };
  const memorySet = [...shown].sort((a, b) => (a.takenAt ?? a.date).localeCompare(b.takenAt ?? b.date));

  return (
    <Page className={cn("max-w-none xl:max-w-[1400px]", selecting && "pb-28")} style={{ "--photos-bar-h": `${barH}px` } as React.CSSProperties}
      onDragOver={(e) => { if (!internalDrag.current && filter !== "journal" && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => {
        setDragging(false);
        if (internalDrag.current || !e.dataTransfer.files.length) return;
        e.preventDefault();
        if (filter === "journal") { toast.message("日记照片只能在写日记时添加", { description: "可以切到「全部」或某个相册再上传" }); return; }
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      {/* ---------- 页头：标题 + 概况 + 主要操作 ---------- */}
      <div className="mb-3 flex items-end justify-between gap-3 md:mb-4">
        <div className="min-w-0">
          <h2 className="text-[28px] leading-tight font-semibold tracking-tight md:text-2xl">照片</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {all.length} 张照片{albums.length > 0 && ` · ${albums.length} 个相册`}
            <span className="max-md:hidden"> · 日记里的照片会自动收进来</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" disabled={!shown.length} onClick={() => setPlaying(true)} title="回忆播放"><PlayIcon /><span className="max-sm:hidden">回忆播放</span></Button>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading > 0 || isJournalTab}
            title={isJournalTab ? "日记照片只能在写日记时添加" : currentAlbum ? "上传到这个相册" : "上传照片"}>
            {uploading > 0 ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />}上传
          </Button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void upload(f); }} />

      {/* ---------- 吸顶栏：分类标签页 + 搜索 / 视图 / 选择 ---------- */}
      <div ref={barRef} className="bg-background/85 sticky top-(--app-top-h) z-20 -mx-4 mb-4 border-b px-4 backdrop-blur-xl backdrop-saturate-150 md:-mx-6 md:px-6">
        <div className="flex items-center gap-4">
          <nav className="no-scrollbar -mb-px flex min-w-0 flex-1 items-center gap-5 overflow-x-auto" aria-label="照片分类">
            {cats.map((c) => (
              <CatTab key={c.id} on={filter === c.id} onClick={() => setFilter(c.id)} label={c.label} count={c.count}
                actions={c.album && filter === c.id ? (
                  <>
                    <IconMini title="重命名相册" onClick={() => setAlbumDialog({ mode: "rename", album: c.album })}><PencilIcon /></IconMini>
                    <IconMini title="删除相册" danger onClick={() => setAlbumDialog({ mode: "delete", album: c.album })}><Trash2Icon /></IconMini>
                  </>
                ) : null} />
            ))}
            <button type="button" onClick={() => setAlbumDialog({ mode: "create" })} title="新建相册"
              className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 py-3 text-sm whitespace-nowrap transition-colors">
              <PlusIcon className="size-4" /><span>新建相册</span>
            </button>
          </nav>
          <div className="hidden shrink-0 items-center gap-2 xl:flex">
            <SearchBox value={q} onChange={setQ} className="w-56" />
            <ViewSwitch view={view} onChange={setView} />
          </div>
        </div>
        {/* 窄屏第二行：搜索 + 视图 + 选择 */}
        <div className="flex items-center gap-2 pt-1 pb-3 xl:hidden">
          <SearchBox value={q} onChange={setQ} className="min-w-0 flex-1 sm:max-w-72" placeholder="搜索照片" />
          <span className="max-sm:hidden sm:ml-auto"><ViewSwitch view={view} onChange={setView} /></span>
          <Select value={view} onValueChange={(v) => setView(v as ViewId)}>
            <SelectTrigger className="h-9 w-auto shrink-0 gap-1.5 px-2.5 sm:hidden" aria-label="视图">
              {(() => { const V = VIEWS.find((x) => x.id === view)!; return <><V.icon className="size-4" /><span className="text-sm">{V.label}</span></>; })()}
            </SelectTrigger>
            <SelectContent align="end">
              {VIEWS.map((v) => <SelectItem key={v.id} value={v.id}><v.icon />{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ---------- 标签：单行，可横滑 ---------- */}
      {/* ---------- 标签（左，可横滑）+ 选择（右） ---------- */}
      {(tags.length > 0 || canSelect) && (
        <div className="mb-4 flex items-center gap-3">
          <div className="no-scrollbar -ml-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pl-4 md:ml-0 md:pl-0 [mask-image:linear-gradient(to_right,black_88%,transparent)] md:[mask-image:linear-gradient(to_right,black_94%,transparent)]">
            {tags.length > 0 ? (
              <>
                <TagChip on={!tag} onClick={() => setTag(null)}>全部</TagChip>
                {tags.map(([t, c]) => (
                  <TagChip key={t} on={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t}<span className="ml-1 opacity-60">{c}</span></TagChip>
                ))}
              </>
            ) : <span className="text-muted-foreground text-sm">{shown.length} 张</span>}
          </div>
          {canSelect && <SelectToggle on={selecting} count={sel.size} onClick={() => (selecting ? exitSelect() : setSelecting(true))} />}
        </div>
      )}
      {(kw || tag) && (
        <p className="text-muted-foreground -mt-1 mb-3 text-xs">
          找到 {shown.length} 张{tag && <>，标签「{tag}」</>}{kw && <>，包含「{q.trim()}」</>}
          <button className="hover:text-foreground ml-2 underline underline-offset-2" onClick={() => { setQ(""); setTag(null); }}>清除</button>
        </p>
      )}

      {/* ---------- 照片 ---------- */}
      <div className="min-w-0">
          {loading && !data ? (
            <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">{[180, 240, 140, 220, 200, 160, 260, 190].map((h, i) => <Skeleton key={i} className="mb-3 w-full break-inside-avoid rounded-xl" style={{ height: h }} />)}</div>
          ) : !shown.length && isJournalTab ? (
            <div className="text-muted-foreground flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-center">
              <NotebookPenIcon className="size-8" />
              <div className="text-foreground font-medium">{all.some((p) => p.journals.length) ? "没有符合条件的日记照片" : "还没有日记照片"}</div>
              <div className="text-sm">写日记时添加的照片会自动出现在这里</div>
            </div>
          ) : !shown.length ? (
            <button onClick={() => fileRef.current?.click()}
              className="text-muted-foreground hover:border-foreground/30 hover:text-foreground flex min-h-80 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-colors">
              <ImagePlusIcon className="size-8" />
              <div className="text-foreground font-medium">{all.length ? "没有符合条件的照片" : "还没有照片"}</div>
              <div className="text-sm">把图片拖到这里，或点击上传{currentAlbum ? "到这个相册" : ""}。日记里添加的照片也会自动出现在这里。</div>
            </button>
          ) : view === "masonry" ? <MasonryView {...viewProps} />
            : view === "timeline" ? <TimelineView {...viewProps} />
            : view === "list" ? <ListView {...viewProps} currentAlbum={currentAlbum} onChanged={() => void reload()} />
            : view === "tunnel" ? <TunnelView key={filter} {...viewProps} title={title} />
            : <RibbonView key={filter} {...viewProps} />}
      </div>

      {dragging && (
        <div className="bg-background/80 pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
          <div className="border-primary flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-16 py-12">
            <UploadIcon className="text-primary size-8" />
            <div className="font-medium">松开上传{currentAlbum ? `到「${title}」` : ""}</div>
            <div className="text-muted-foreground text-xs">自动压缩为 WebP，并识别照片内容</div>
          </div>
        </div>
      )}

      {/* 多选操作栏：浮在底部（移动端在标签栏之上） */}
      {selecting && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--mobile-nav-h)+0.75rem)] z-40 flex justify-center px-3 md:bottom-6">
          <div className="bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-bottom-4 pointer-events-auto flex max-w-full items-center gap-1 rounded-full border p-1.5 shadow-xl duration-200">
            <Button variant="ghost" size="icon-sm" className="rounded-full" onClick={exitSelect} title="退出选择 (Esc)"><XIcon /></Button>
            <span className="flex items-center gap-1.5 px-1 text-sm whitespace-nowrap">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1.5 text-xs font-semibold text-white tabular-nums">{sel.size}</span>
              <span className="text-muted-foreground">已选<span className="max-sm:hidden">择</span></span>
            </span>
            <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setSel(allSelected ? new Set() : new Set(free.map((p) => p.path)))}>
              {allSelected ? "取消全选" : "全选"}
            </Button>
            <span className="bg-border mx-0.5 h-5 w-px" />
            <Button variant="ghost" size="sm" className="rounded-full" disabled={busy || !sel.size} onClick={() => setCat(selPaths)} title="调整分类（相册）">
              <FolderInputIcon /><span className="max-sm:hidden">分类</span>
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-full" disabled={busy || !sel.size} onClick={() => setDel(selPaths)} title="删除">
              <Trash2Icon /><span className="max-sm:hidden">删除</span>
            </Button>
          </div>
        </div>
      )}

      <Lightbox items={lightboxItems} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)}
        side={(i) => { const p = shown[i]; return p?.journals.length ? <JournalPanel dates={p.journals} /> : null; }}
        actions={(i) => {
          const p = shown[i];
          if (!p) return null;
          const pill = "flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/20 [&_svg]:size-4";
          return (
            <>
              {p.journals.length > 0 ? (
                <>
                  {/* 日记照片：只能查看当天日记，不能删除或调整分类 */}
                  <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs text-white/70" title="日记照片只能在日记里修改或删除"><NotebookPenIcon className="size-3.5" />日记照片</span>
                </>
              ) : (
                <>
                  <button type="button" className={pill} onClick={() => setCat([p.path])} title="调整分类（相册）"><FolderInputIcon /><span className="max-sm:hidden">分类</span></button>
                  <button type="button" className={cn(pill, "hover:bg-rose-500/80")} onClick={() => setDel([p.path])} title="删除这张照片"><Trash2Icon /><span className="max-sm:hidden">删除</span></button>
                </>
              )}
            </>
          );
        }} />
      <CategorizeDialog paths={cat} photos={all} albums={albums} onClose={() => setCat(null)}
        onDone={() => { setCat(null); exitSelect(); void reload(); }} />
      <DeleteDialog paths={del} photos={all} busy={busy} onClose={() => setDel(null)}
        onConfirm={async () => { const paths = del ?? []; await act({ action: "delete", paths }, `已删除 ${paths.length} 张照片`); setDel(null); }} />
      {playing && <MemoriesPlayer photos={memorySet} title={title} onClose={() => setPlaying(false)} />}
      <AlbumDialog state={albumDialog} onClose={() => setAlbumDialog(null)} onDone={(id) => { setAlbumDialog(null); void reload(); if (id) setFilter(`album:${id}`); }} />
    </Page>
  );
}

function CatTab({ on, onClick, label, count, actions }: { on: boolean; onClick: () => void; label: string; count: number; actions?: React.ReactNode }) {
  return (
    <div className={cn("relative flex shrink-0 items-center gap-0.5 border-b-2 transition-colors", on ? "border-foreground" : "border-transparent")}>
      <button type="button" onClick={onClick} aria-pressed={on}
        className={cn("flex items-center gap-1.5 py-3 text-sm whitespace-nowrap transition-colors", on ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>
        {label}<span className={cn("text-xs tabular-nums", on ? "text-muted-foreground" : "opacity-60")}>{count}</span>
      </button>
      {actions && <span className="ml-1 flex items-center">{actions}</span>}
    </div>
  );
}

function IconMini({ children, title, danger, onClick }: { children: React.ReactNode; title: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={cn("text-muted-foreground flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted [&_svg]:size-3.5", danger ? "hover:text-destructive" : "hover:text-foreground")}>
      {children}
    </button>
  );
}

function SearchBox({ value, onChange, className, placeholder = "搜索描述、标签、日期" }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  return (
    <div className={cn("relative", className)}>
      <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input className="h-9 pr-7 pl-8" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="清空搜索" className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"><XIcon className="size-3.5" /></button>
      )}
    </div>
  );
}

function ViewSwitch({ view, onChange }: { view: ViewId; onChange: (v: ViewId) => void }) {
  return (
    <div className="bg-muted inline-flex rounded-lg p-0.5" role="group" aria-label="视图">
      {VIEWS.map((v) => (
        <button key={v.id} type="button" onClick={() => onChange(v.id)} title={v.label} aria-label={v.label} aria-pressed={view === v.id}
          className={cn("flex size-8 items-center justify-center rounded-md transition-all [&_svg]:size-4",
            view === v.id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
          <v.icon />
        </button>
      ))}
    </div>
  );
}

function SelectToggle({ on, count, onClick }: { on: boolean; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      title={on ? "退出选择 (Esc)" : "多选照片（也可以点图片左上角的圆圈，触屏长按图片）"}
      className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all [&_svg]:size-3.5",
        on ? "bg-sky-500 text-white shadow-sm shadow-sky-500/30 hover:bg-sky-600" : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted border")}>
      {on ? <CheckIcon className="stroke-[3]" /> : <CircleCheckIcon />}
      {on ? <>完成{count > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[10px] tabular-nums">{count}</span>}</> : "选择"}
    </button>
  );
}

function TagChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap transition-colors max-sm:py-1",
        on ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-muted text-muted-foreground")}>
      {children}
    </button>
  );
}

function DeleteDialog({ paths, photos, busy, onClose, onConfirm }: { paths: string[] | null; photos: Photo[]; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const list = photos.filter((p) => paths?.includes(p.path));
  return (
    <Dialog open={!!paths} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除 {paths?.length ?? 0} 张照片？</DialogTitle>
          <DialogDescription>
            照片会移进回收站，30 天内可以在「设置 → 数据与系统 → 最近删除」里恢复。
          </DialogDescription>
        </DialogHeader>
        {list.length > 0 && (
          <div className="flex gap-1.5 overflow-hidden">
            {list.slice(0, 6).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.path} src={photoUrl(p)} alt="" draggable={false} className="bg-muted size-14 shrink-0 rounded-md object-cover" />
            ))}
            {list.length > 6 && <span className="bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-md text-sm">+{list.length - 6}</span>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircleIcon className="animate-spin" /> : <Trash2Icon />}删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AlbumDialog({ state, onClose, onDone }: { state: { mode: "create" | "rename" | "delete"; album?: Album } | null; onClose: () => void; onDone: (id?: string) => void }) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setName(state?.album?.name ?? ""); }, [state]);
  if (!state) return null;
  const submit = async () => {
    setBusy(true);
    try {
      if (state.mode === "create") { const r = await api<{ album: Album }>("/api/photos", { method: "POST", json: { action: "createAlbum", name } }); toast.success("相册已创建"); onDone(r.album.id); }
      else if (state.mode === "rename") { await api("/api/photos", { method: "POST", json: { action: "renameAlbum", id: state.album!.id, name } }); toast.success("已重命名"); onDone(); }
      else { await api("/api/photos", { method: "POST", json: { action: "deleteAlbum", id: state.album!.id } }); toast.success("相册已删除，照片保留"); onDone(); }
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{state.mode === "create" ? "新建相册" : state.mode === "rename" ? "重命名相册" : `删除「${state.album?.name}」？`}</DialogTitle>
          {state.mode === "delete" && <DialogDescription>只删除这个分组，里面的照片会保留在「全部照片」中。</DialogDescription>}
        </DialogHeader>
        {state.mode !== "delete" && (
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="比如 旅行、家人、猫" maxLength={40}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void submit(); }} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant={state.mode === "delete" ? "destructive" : "default"} disabled={busy || (state.mode !== "delete" && !name.trim())} onClick={submit}>
            {busy && <LoaderCircleIcon className="animate-spin" />}{state.mode === "create" ? "创建" : state.mode === "rename" ? "保存" : "删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
