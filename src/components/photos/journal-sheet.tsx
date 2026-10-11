"use client";
/* 在照片页里直接查看「当时的日记」：右侧抽屉（移动端全宽） */
import * as React from "react";
import Link from "next/link";
import { ArrowUpRightIcon, BatteryMediumIcon, MoonIcon, NotebookPenIcon, SmileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Markdown } from "@/components/markdown";
import { fmtDay } from "./shared";

export type JournalDoc = { date: string; exists: boolean; fm: Record<string, unknown>; body: string };

/** 简单的内存缓存：同一篇日记在分组卡片和抽屉里只请求一次 */
const cache = new Map<string, Promise<JournalDoc>>();
export function loadJournal(date: string) {
  let p = cache.get(date);
  if (!p) {
    p = fetch(`/api/journal?date=${date}`, { cache: "no-store" }).then((r) => r.json());
    cache.set(date, p);
    p.catch(() => cache.delete(date));
  }
  return p;
}
export function useJournal(date: string | null) {
  const [doc, setDoc] = React.useState<JournalDoc | null>(null);
  React.useEffect(() => {
    setDoc(null);
    if (!date) return;
    let alive = true;
    loadJournal(date).then((d) => { if (alive) setDoc(d); }).catch(() => {});
    return () => { alive = false; };
  }, [date]);
  return doc;
}

/** 去掉标题、图片、列表符号，取正文开头作为摘要 */
export function excerpt(body: string, max = 90) {
  const lines = body.replace(/<!--[\s\S]*?-->/g, "").split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !/^!\[/.test(l) && !/^---/.test(l))
    .map((l) => l.replace(/^[-*+]\s+|^\d+\.\s+/, "").replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"));
  const t = lines.join("；");
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** 去掉一级标题和图片（照片已经在旁边看到了） */
function cleanBody(body: string) {
  return body.replace(/^\s*#\s[^\n]*\n/, "").replace(/^##\s*照片\s*\n(?:!\[.*\n?)*/m, "").replace(/!\[[^\]]*\]\([^)]*\)\n?/g, "");
}

export function MetricPills({ fm }: { fm: Record<string, unknown> }) {
  const items = [
    { k: "mood", icon: SmileIcon, label: "心情", unit: "/5" },
    { k: "energy", icon: BatteryMediumIcon, label: "精力", unit: "/5" },
    { k: "sleep", icon: MoonIcon, label: "睡眠", unit: "h" },
  ].filter((x) => typeof fm[x.k] === "number");
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((x) => (
        <span key={x.k} className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] [&_svg]:size-3">
          <x.icon />{x.label}<b className="text-foreground font-medium tabular-nums">{String(fm[x.k])}</b>{x.unit}
        </span>
      ))}
    </div>
  );
}

export function JournalSheet({ date, onClose }: { date: string | null; onClose: () => void }) {
  const doc = useJournal(date);
  // 正文里的照片已经在照片页看过了，这里只保留文字，避免重复
  const body = cleanBody(doc?.body ?? "");
  return (
    <Sheet open={!!date} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <div className="border-b px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4">
          <div className="text-muted-foreground text-xs">当天的日记</div>
          <SheetTitle className="mt-0.5 text-lg">{date ? fmtDay(date, true) : ""}</SheetTitle>
          <SheetDescription className="sr-only">查看拍下这些照片那天写的日记</SheetDescription>
          {doc?.exists && <div className="mt-2.5"><MetricPills fm={doc.fm} /></div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!doc ? (
            <div className="space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-20" /><Skeleton className="h-16" /></div>
          ) : !doc.exists ? (
            <p className="text-muted-foreground text-sm">这篇日记已经不存在了。</p>
          ) : (
            <Markdown className="[&>*:first-child]:mt-0">{body}</Markdown>
          )}
        </div>
        {date && (
          <div className="border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button asChild className="w-full"><Link href={`/journal?date=${date}`}>在日记中打开<ArrowUpRightIcon /></Link></Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** 看大图时的日记详情面板（嵌在 Lightbox 侧边） */
export function JournalPanel({ dates }: { dates: string[] }) {
  const sorted = React.useMemo(() => [...dates].sort().reverse(), [dates]);
  const [date, setDate] = React.useState(sorted[0]);
  React.useEffect(() => { setDate(sorted[0]); }, [sorted]);
  const doc = useJournal(date);
  const body = cleanBody(doc?.body ?? "");
  return (
    <>
      <div className="border-b px-5 pt-5 pb-4">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs"><NotebookPenIcon className="size-3.5" />当天的日记</div>
        <div className="mt-1 text-lg font-semibold">{fmtDay(date, true)}</div>
        {sorted.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {sorted.map((d) => (
              <button key={d} type="button" onClick={() => setDate(d)}
                className={cn("rounded-full border px-2.5 py-0.5 text-xs tabular-nums transition-colors", d === date ? "bg-foreground text-background border-foreground" : "text-muted-foreground hover:bg-muted")}>
                {d.slice(5)}
              </button>
            ))}
          </div>
        )}
        {doc?.exists && <div className="mt-2.5"><MetricPills fm={doc.fm} /></div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!doc ? (
          <div className="space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-20" /><Skeleton className="h-16" /></div>
        ) : !doc.exists ? (
          <p className="text-muted-foreground text-sm">这篇日记已经不存在了。</p>
        ) : (
          <Markdown className="[&>*:first-child]:mt-0">{body}</Markdown>
        )}
      </div>
      <div className="border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button asChild variant="outline" className="w-full"><Link href={`/journal?date=${date}`}>在日记中打开<ArrowUpRightIcon /></Link></Button>
      </div>
    </>
  );
}
