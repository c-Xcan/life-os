"use client";
/* 日记编辑弹窗：新建 / 编辑都在这里。关闭或切换日期时有未保存修改会先确认 */
import * as React from "react";
import { toast } from "sonner";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  BookOpenIcon, BriefcaseIcon, ChevronLeftIcon, ChevronRightIcon, DumbbellIcon, EyeIcon, ImagePlusIcon,
  HistoryIcon, LoaderCircleIcon, NotebookTextIcon, PenLineIcon, SaveIcon, XIcon, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/misc";
import { Markdown } from "@/components/markdown";
import { Lightbox } from "@/components/lightbox";
import { HistoryDialog } from "@/components/history-dialog";
import { appendExif, attachmentUrl, compressToWebp, readExif } from "@/lib/image";
import { api, METRIC_META, todayStr } from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  ENERGY_LABEL, MOOD, PHOTO_TITLE, charCount, getPhotos, parseSections, setPhotos, setSectionContent,
  weekday, type Journal,
} from "./lib";

type Mode = "guided" | "free" | "preview";
const MINUTES: { k: string; icon: LucideIcon }[] = [
  { k: "study_min", icon: BookOpenIcon }, { k: "work_min", icon: BriefcaseIcon }, { k: "exercise_min", icon: DumbbellIcon },
];
const PROMPTS = [
  "今天有什么值得记住的小事？", "今天最有成就感的一刻是什么？", "有什么让你卡住了？", "今天学到了什么？",
  "如果重来一次，今天你会怎么过？", "此刻的身体和情绪感觉怎么样？", "明天最想推进的一件事是什么？", "今天想感谢谁？",
];
/** temp：刚上传、还没保存进日记的图片，直接删除；否则移进回收站 */
const deleteAttachment = (src: string, temp = false) =>
  fetch(`/api/attachments?path=${encodeURIComponent(src)}${temp ? "&temp=1" : ""}`, { method: "DELETE", keepalive: true }).catch(() => {});

/** 弹窗外壳：date 为 null 时关闭 */
export function JournalDialog({ date, days, onDate, onClose, onSaved, onMonth }: {
  date: string | null; days: Record<string, number | null>;
  onDate: (d: string) => void; onClose: () => void; onSaved: (d: string) => void;
  /** 日历翻到某个月时，让页面加载那个月有日记的日期 */
  onMonth?: (m: string) => void;
}) {
  const dirty = React.useRef(false);
  const saveRef = React.useRef<(() => Promise<boolean>) | null>(null);
  const [confirm, setConfirm] = React.useState<null | { then: () => void }>(null);
  React.useEffect(() => { setConfirm(null); }, [date]);

  /** 有未保存修改时先确认，再执行 */
  const guard = (then: () => void) => { if (dirty.current) setConfirm({ then }); else then(); };

  return (
    <DialogPrimitive.Root open={!!date} onOpenChange={(v) => { if (!v) guard(onClose); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] max-md:data-[state=open]:slide-in-from-bottom-6 fixed inset-0 z-50 flex flex-col overflow-hidden outline-none md:inset-auto md:top-1/2 md:left-1/2 md:h-auto md:max-h-[min(780px,calc(100svh-4rem))] md:min-h-[520px] md:w-[min(1040px,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:shadow-2xl">
          <DialogPrimitive.Title className="sr-only">日记 {date}</DialogPrimitive.Title>
          {date && (
            <Editor key={date} date={date} days={days} onMonth={onMonth}
              onPick={(d) => guard(() => onDate(d))}
              onClose={() => guard(onClose)}
              onSaved={onSaved}
              reportDirty={(v) => { dirty.current = v; }}
              saveRef={saveRef} />
          )}
          {confirm && (
            <div className="bg-background/70 absolute inset-0 z-30 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-popover w-full max-w-sm rounded-2xl border p-5 shadow-xl">
                <div className="font-semibold">还有没保存的修改</div>
                <p className="text-muted-foreground mt-1 text-sm">要先保存吗？不保存的话，这次写的内容会丢失。</p>
                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setConfirm(null)}>继续写</Button>
                  <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => { const t = confirm.then; dirty.current = false; setConfirm(null); t(); }}>不保存</Button>
                  <Button onClick={async () => { const t = confirm.then; const ok = await saveRef.current?.(); if (ok) { dirty.current = false; setConfirm(null); t(); } }}><SaveIcon />保存</Button>
                </div>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Editor({ date, days, onMonth, onPick, onClose, onSaved, reportDirty, saveRef }: {
  date: string; days: Record<string, number | null>; onMonth?: (m: string) => void; onPick: (d: string) => void; onClose: () => void; onSaved: (d: string) => void;
  reportDirty: (v: boolean) => void; saveRef: React.RefObject<(() => Promise<boolean>) | null>;
}) {
  const today = todayStr();
  const [j, setJ] = React.useState<Journal | null>(null);
  const [body, setBody] = React.useState("");
  const [metrics, setMetrics] = React.useState<Record<string, number | undefined>>({});
  const [mode, setModeRaw] = React.useState<Mode>("guided");
  const [drafts, setDrafts] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const initial = React.useRef("");
  const [uploading, setUploading] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [viewing, setViewing] = React.useState<number | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const [reloadTick, setReloadTick] = React.useState(0);
  const fileRef = React.useRef<HTMLInputElement>(null);
  // 本次新上传、还没保存进日记的图片：移除或放弃时直接删文件
  const pending = React.useRef(new Set<string>());
  // 已保存过、这次被移除的图片：保存日记成功后再删文件
  const removed = React.useRef(new Set<string>());

  // 关闭弹窗 / 切换日期 / 离开页面时，没保存的新图片直接删掉
  React.useEffect(() => {
    const drop = () => { for (const src of pending.current) void deleteAttachment(src, true); pending.current.clear(); removed.current.clear(); };
    window.addEventListener("pagehide", drop);
    return () => { window.removeEventListener("pagehide", drop); drop(); };
  }, []);

  React.useEffect(() => {
    api<Journal>(`/api/journal?date=${date}`).then((r) => {
      setJ(r);
      setBody(r.body);
      const m: Record<string, number | undefined> = {};
      for (const k of Object.keys(METRIC_META)) if (typeof r.fm[k] === "number") m[k] = r.fm[k] as number;
      setMetrics(m);
      initial.current = JSON.stringify([r.body, m]);
      setDrafts(parseSections(r.body).map((x) => x.content));
      setModeRaw(r.exists && parseSections(r.body).length === 0 ? "free" : "guided");
    }).catch(() => {});
  }, [date, reloadTick]);

  const dirty = j ? JSON.stringify([body, metrics]) !== initial.current : false;
  React.useEffect(() => { reportDirty(dirty); }, [dirty, reportDirty]);
  const setMode = (m: Mode) => { if (m === "guided") setDrafts(parseSections(body).map((x) => x.content)); setModeRaw(m); };

  const save = React.useCallback(async () => {
    setSaving(true);
    try {
      await api("/api/journal", { method: "PUT", json: { date, body, metrics } });
      initial.current = JSON.stringify([body, metrics]);
      const kept = new Set(getPhotos(body).map((p) => p.src));
      for (const src of removed.current) if (!kept.has(src)) void deleteAttachment(src);
      for (const src of pending.current) if (!kept.has(src)) void deleteAttachment(src, true);
      removed.current.clear();
      pending.current.clear();
      setJ((x) => (x ? { ...x, exists: true } : x));
      reportDirty(false);
      toast.success("日记已保存");
      onSaved(date);
      return true;
    } catch { return false; } finally { setSaving(false); }
  }, [date, body, metrics, onSaved, reportDirty]);
  React.useEffect(() => { saveRef.current = save; }, [save, saveRef]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const sections = React.useMemo(() => parseSections(body), [body]);
  const photos = React.useMemo(() => getPhotos(body), [body]);

  /** 压缩成 WebP → 上传到 vault/attachments（识图模型顺便写一句描述）→ 写进「照片」小节 */
  const addImages = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!imgs.length) { if (files.length) toast.error("只能添加图片"); return; }
    setUploading((n) => n + imgs.length);
    let ok = 0;
    let captionError: string | null = null;
    for (const f of imgs) {
      try {
        const exif = await readExif(f);
        const webp = await compressToWebp(f);
        const fd = new FormData();
        fd.append("file", webp, "photo.webp");
        fd.append("date", date);
        appendExif(fd, exif);
        const r = await api<{ path: string; caption: string | null; captionError: string | null }>("/api/attachments", { method: "POST", body: fd });
        pending.current.add(r.path);
        setBody((b) => setPhotos(b, [...getPhotos(b), { src: r.path, alt: r.caption ?? "" }]));
        if (r.captionError) captionError = r.captionError;
        ok++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (ok) toast.success(`已添加 ${ok} 张照片`);
    if (captionError) toast.warning("识图失败，照片没有生成描述", { description: captionError });
  };
  const removePhoto = (src: string) => {
    setBody((b) => setPhotos(b, getPhotos(b).filter((x) => x.src !== src)));
    if (pending.current.has(src)) { pending.current.delete(src); void deleteAttachment(src, true); }
    else removed.current.add(src);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); void addImages(files); }
  };

  const chars = charCount(body);
  const [yy, mm, dd] = date.split("-").map(Number);
  const prompt = PROMPTS[(yy * 372 + mm * 31 + dd) % PROMPTS.length];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col"
      onPaste={mode === "preview" ? undefined : onPaste}
      onDragOver={(e) => { if (mode !== "preview" && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { if (mode === "preview") return; e.preventDefault(); setDragging(false); void addImages(Array.from(e.dataTransfer.files)); }}>
      {dragging && (
        <div className="bg-background/80 ring-primary pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 ring-2 ring-inset backdrop-blur-[2px]">
          <ImagePlusIcon className="text-primary size-8" />
          <div className="text-sm font-medium">松开即可添加照片</div>
          <div className="text-muted-foreground text-xs">会自动压缩为 WebP</div>
        </div>
      )}

      {/* ---------- 抬头：日期 + 本周切换 + 关闭 ---------- */}
      <header className="flex items-center gap-4 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 md:px-6 md:py-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-lg font-semibold tracking-tight">{mm} 月 {dd} 日</h3>
            <span className="text-muted-foreground text-sm">{weekday(date)}</span>
          </div>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
            <span className="tabular-nums">{yy}</span>
            {date === today
              ? <span className="text-foreground font-medium">今天</span>
              : <button onClick={() => onPick(today)} className="hover:text-foreground underline-offset-2 hover:underline">回到今天</button>}
            <span className="bg-border h-3 w-px" />
            {!j ? null : j.exists
              ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" />已记录</span>
              : <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-sky-500" />新日记</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭" className="text-muted-foreground hover:bg-muted hover:text-foreground ml-auto flex size-9 items-center justify-center rounded-full transition-colors"><XIcon className="size-5" /></button>
      </header>

      {/* ---------- 正文 + 状态 ---------- */}
      <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_288px] md:overflow-hidden">
        <div className="flex min-h-0 flex-col md:overflow-y-auto">
          <div className="flex-1">
            {!j ? (
              <div className="space-y-4 px-6 py-8 md:px-10">{[0, 1, 2].map((i) => <div key={i} className="space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-16" /></div>)}</div>
            ) : mode === "preview" ? (
              <div className="px-5 py-6 md:px-8">
                {chars || photos.length ? <Markdown className="text-[15px] leading-8 [&>h1:first-child]:hidden">{body}</Markdown>
                  : <p className="text-muted-foreground py-10 text-center text-sm">这一天还没有内容</p>}
              </div>
            ) : mode === "guided" && sections.length > 0 ? (
              <div className="divide-y divide-dashed px-5 md:px-8">
                {sections.map((s, i) => s.title === PHOTO_TITLE ? null : (
                  <section key={`${s.title}-${i}`} className="group py-5">
                    <label className="mb-2 flex items-baseline gap-3">
                      <span className="text-muted-foreground/60 font-mono text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-sm font-semibold tracking-tight">{s.title}</span>
                    </label>
                    <textarea
                      autoFocus={i === 0 && !j.exists}
                      value={drafts[i] ?? s.content}
                      onChange={(e) => { const v = e.target.value; setDrafts((d) => { const n = [...d]; n[i] = v; return n; }); setBody((b) => setSectionContent(b, i, v)); }}
                      placeholder={s.hint || (i === 0 ? prompt : "想到什么就写什么…")}
                      rows={2}
                      className="placeholder:text-muted-foreground/50 field-sizing-content block min-h-16 w-full resize-none bg-transparent pl-7 text-base leading-8 outline-none md:text-[15px]"
                    />
                  </section>
                ))}
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="今天发生了什么？"
                spellCheck={false}
                className="placeholder:text-muted-foreground/50 block min-h-[40vh] w-full resize-none bg-transparent px-5 py-6 font-mono text-[13.5px] leading-7 outline-none md:px-8"
              />
            )}
          </div>

          {/* 照片 */}
          {j && mode !== "preview" && (photos.length > 0 || uploading > 0) && (
            <div className="border-t border-dashed px-5 py-5 md:px-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight">照片</span>
                <span className="text-muted-foreground text-xs tabular-nums">{photos.length}</span>
                <span className="text-muted-foreground/70 ml-auto hidden text-xs sm:inline">可直接拖入或粘贴图片</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {photos.map((p, idx) => (
                  <figure key={p.src} className="group w-24 sm:w-28" title={p.alt || undefined}>
                    <div className="bg-muted relative aspect-square overflow-hidden rounded-lg border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={attachmentUrl(p.src)} alt={p.alt} loading="lazy" draggable={false} onClick={() => setViewing(idx)} className="size-full cursor-zoom-in object-cover transition-transform duration-300 group-hover:scale-105" />
                      <button onClick={() => removePhoto(p.src)} title="移除" className="absolute top-1 right-1 rounded-full bg-black/55 p-0.5 text-white transition-opacity hover:bg-black/75 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"><XIcon className="size-3" /></button>
                    </div>
                    {p.alt && <figcaption className="text-muted-foreground mt-1 line-clamp-2 text-[11px] leading-4">{p.alt}</figcaption>}
                  </figure>
                ))}
                {Array.from({ length: uploading }, (_, i) => (
                  <div key={`u${i}`} className="bg-muted text-muted-foreground flex aspect-square w-24 items-center justify-center rounded-lg border sm:w-28">
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 今日状态：桌面在右侧，移动端在正文下方 */}
        <aside className="bg-muted/25 space-y-4 border-t p-4 md:overflow-y-auto md:border-t-0 md:border-l">
          <MiniCalendar date={date} days={days} onPick={onPick} onMonth={onMonth} />
          <div className="border-t pt-4"><StateCard metrics={metrics} setMetrics={setMetrics} /></div>
        </aside>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void addImages(f); }} />
      <Lightbox items={photos.map((p) => ({ src: attachmentUrl(p.src), caption: p.alt }))} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      <HistoryDialog path={`journal/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`} open={showHistory} onOpenChange={setShowHistory}
        onRestored={() => { setReloadTick((n) => n + 1); onSaved(date); }} />

      {/* ---------- 底栏 ---------- */}
      <footer className="flex items-center gap-2 border-t px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:gap-3 md:px-5">
        <div className="bg-muted flex rounded-lg p-0.5">
          {([["guided", "引导", PenLineIcon], ["free", "Markdown", NotebookTextIcon], ["preview", "预览", EyeIcon]] as const).map(([m, label, Icon]) => (
            <button key={m} onClick={() => setMode(m)} title={label}
              className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all [&_svg]:size-3.5",
                mode === m ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
              <Icon /><span className={cn(m !== mode && "max-sm:hidden")}>{label}</span>
            </button>
          ))}
        </div>
        {mode !== "preview" && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => fileRef.current?.click()} disabled={!j} title="也可以直接拖入或粘贴图片">
            <ImagePlusIcon /><span className="max-sm:hidden">照片</span>
          </Button>
        )}
        {j?.exists && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setShowHistory(true)} title="查看和恢复这篇日记的历史版本">
            <HistoryIcon /><span className="max-sm:hidden">历史</span>
          </Button>
        )}
        <span className="text-muted-foreground text-xs tabular-nums max-sm:hidden">{chars} 字</span>
        <div className="ml-auto flex items-center gap-3">
          {dirty ? <span className="hidden items-center gap-1.5 text-xs text-amber-600 sm:flex"><span className="size-1.5 rounded-full bg-amber-500" />未保存 · Ctrl+S</span>
            : j?.exists && <span className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex"><span className="size-1.5 rounded-full bg-emerald-500" />已保存</span>}
          <Button size="sm" variant={dirty ? "default" : "outline"} onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}保存
          </Button>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- 月历：选择日期，心情着色 ---------------- */
function MiniCalendar({ date, days, onPick, onMonth }: { date: string; days: Record<string, number | null>; onPick: (d: string) => void; onMonth?: (m: string) => void }) {
  const today = todayStr();
  const [month, setMonth] = React.useState(date.slice(0, 7));
  React.useEffect(() => { setMonth(date.slice(0, 7)); }, [date]);
  React.useEffect(() => { onMonth?.(month); }, [month, onMonth]);

  const [y, m] = month.split("-").map(Number);
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const move = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));

  const inMonth = Object.entries(days).filter(([d]) => d.startsWith(month));

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <div className="text-sm font-semibold tabular-nums">{y} 年 {m} 月</div>
        <span className="text-muted-foreground text-[11px]">记录 {inMonth.length} 天</span>
        <div className="ml-auto flex items-center">
          {month !== today.slice(0, 7) && (
            <button type="button" onClick={() => setMonth(today.slice(0, 7))} className="text-muted-foreground hover:bg-muted hover:text-foreground mr-0.5 rounded-md px-1.5 py-0.5 text-[11px] transition-colors">本月</button>
          )}
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground size-7" onClick={() => move(-1)} title="上个月"><ChevronLeftIcon /></Button>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground size-7" onClick={() => move(1)} disabled={month >= today.slice(0, 7)} title="下个月"><ChevronRightIcon /></Button>
        </div>
      </div>

      <div className="text-muted-foreground grid grid-cols-7 text-center text-[10px]">
        {"一二三四五六日".split("").map((d, i) => <div key={d} className={cn("py-0.5", i >= 5 && "text-muted-foreground/70")}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          if (!c) return <div key={`e${i}`} className="h-8" />;
          const has = c in days, mv = days[c], sel = c === date, future = c > today, isToday = c === today;
          const M = has && mv ? MOOD[Math.max(1, Math.min(5, Math.round(mv)))] : null;
          return (
            <div key={c} className="flex h-8 items-center justify-center">
              <button type="button" disabled={future} onClick={() => onPick(c)}
                title={has ? (M ? `${c} · 心情${M.label}` : `${c} · 有日记`) : future ? undefined : `${c} · 还没写`}
                className={cn("relative flex size-7 items-center justify-center rounded-full text-[11px] tabular-nums transition-all",
                  sel ? "bg-foreground text-background font-semibold shadow-sm"
                    : M ? cn(M.soft, "font-medium hover:brightness-95")
                    : has ? "bg-muted text-foreground font-medium hover:bg-muted/70"
                    : future ? "text-muted-foreground/30"
                    : "text-muted-foreground hover:bg-muted",
                  isToday && !sel && "ring-foreground/60 ring-[1.5px]")}>
                {Number(c.slice(8))}
                {sel && M && <span className={cn("ring-background absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2", M.bg)} />}
              </button>
            </div>
          );
        })}
      </div>

    </div>
  );
}

/* ---------------- 今日状态 ---------------- */
/** 放在组件外：如果定义在 StateCard 里面，每次重新渲染都是新组件，滑块会被重建，导致无法拖动 */
function StateRow({ label, value, children }: { label: string; value: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center text-xs"><span className="font-medium">{label}</span><span className="text-muted-foreground ml-auto">{value}</span></div>
      {children}
    </div>
  );
}

function StateCard({ metrics, setMetrics }: { metrics: Record<string, number | undefined>; setMetrics: React.Dispatch<React.SetStateAction<Record<string, number | undefined>>> }) {
  const set = (k: string, v: number | undefined) => setMetrics((x) => { const y = { ...x }; if (v === undefined) delete y[k]; else y[k] = v; return y; });
  const sleep = metrics.sleep;
  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">今日状态</div>

      <StateRow label="心情" value={metrics.mood ? MOOD[metrics.mood]!.label : "未填"}>
        <div className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4, 5].map((n) => {
            const M = MOOD[n]!, on = metrics.mood === n;
            return (
              <button key={n} onClick={() => set("mood", on ? undefined : n)} title={M.label}
                className={cn("flex h-9 items-center justify-center rounded-lg transition-colors [&_svg]:size-[18px]",
                  on ? cn(M.bg, "text-black/70") : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground border")}>
                <M.icon />
              </button>
            );
          })}
        </div>
      </StateRow>

      <StateRow label="精力" value={metrics.energy ? ENERGY_LABEL[metrics.energy] : "未填"}>
        <div className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => set("energy", metrics.energy === n ? undefined : n)} title={ENERGY_LABEL[n]}
              className={cn("h-2 rounded-full transition-colors", metrics.energy !== undefined && n <= metrics.energy ? "bg-amber-400" : "bg-muted hover:bg-foreground/15")} />
          ))}
        </div>
      </StateRow>

      <StateRow label="睡眠" value={sleep === undefined ? "未填" : <span className="text-foreground font-medium tabular-nums">{sleep} 小时</span>}>
        <Slider min={0} max={12} step={0.5} value={[sleep ?? 7]} className={cn("py-1", sleep === undefined && "opacity-40")} onValueChange={(v) => set("sleep", v[0])} />
      </StateRow>

      <div>
        <div className="mb-1.5 text-xs font-medium">时间投入 <span className="text-muted-foreground font-normal">分钟</span></div>
        <div className="grid grid-cols-3 gap-1.5">
          {MINUTES.map(({ k, icon: Icon }) => (
            <label key={k} className="bg-background focus-within:ring-ring/40 flex flex-col items-center gap-0.5 rounded-lg border py-2 focus-within:ring-2">
              <span className="text-muted-foreground flex items-center gap-1 text-[11px]"><Icon className="size-3" />{METRIC_META[k].label}</span>
              <input type="number" inputMode="numeric" min={0} step={5} value={metrics[k] ?? ""} placeholder="—"
                onChange={(e) => set(k, e.target.value === "" ? undefined : Number(e.target.value))}
                className="w-full bg-transparent text-center text-base font-semibold tabular-nums outline-none [appearance:textfield] placeholder:text-muted-foreground/40 [&::-webkit-inner-spin-button]:appearance-none" />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

