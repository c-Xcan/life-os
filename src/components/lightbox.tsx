"use client";
import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type LightboxItem = { src: string; caption?: string };

/**
 * 全屏看图：点空白或按 Esc 关闭；多张时可用 ← → 切换。
 * 用法一：<Lightbox src={url} onClose /> 单张
 * 用法二：<Lightbox items={[...]} index={i} onIndex={setI} onClose /> 多张
 */
export function Lightbox({ src, items, index = 0, onIndex, onClose, actions, side }: {
  src?: string | null; items?: LightboxItem[]; index?: number | null; onIndex?: (i: number) => void; onClose: () => void;
  /** 右上角额外的操作按钮（如删除、打开日记），参数为当前序号 */
  actions?: (index: number) => React.ReactNode;
  /** 侧边详情面板（桌面在右侧，移动端在图片下方）；返回 null 时不显示 */
  side?: (index: number) => React.ReactNode;
}) {
  const list: LightboxItem[] = items ?? (src ? [{ src }] : []);
  const open = items ? index !== null && index !== undefined && !!list[index] : !!src;
  const i = items ? (index ?? 0) : 0;
  const cur = list[i];
  const go = React.useCallback((d: number) => { if (list.length > 1 && onIndex) onIndex((i + d + list.length) % list.length); }, [i, list.length, onIndex]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, go]);

  if (!open || !cur) return null;
  const multi = list.length > 1 && !!onIndex;
  const navBtn = "absolute top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20";
  const panel = side?.(i) ?? null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm md:flex-row" onClick={onClose}>
      {/* 图片区 */}
      <div className={cn("relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-4 md:p-10", panel && "max-md:pt-14 max-md:pb-3")}>
        <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {actions?.(i)}
          <button className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={onClose} aria-label="关闭"><XIcon className="size-5" /></button>
        </div>
        {multi && <div className="absolute top-[max(1.25rem,calc(env(safe-area-inset-top)+0.25rem))] left-5 text-sm text-white/70 tabular-nums">{i + 1} / {list.length}</div>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={cur.src} src={cur.src} alt={cur.caption ?? ""} draggable={false} className="animate-in fade-in-0 zoom-in-95 max-h-[calc(100%-4rem)] max-w-full rounded-lg object-contain shadow-2xl duration-200" onClick={(e) => e.stopPropagation()} />
        {cur.caption && <p className={cn("max-w-2xl text-center text-sm leading-6 text-white/85", panel && "max-md:line-clamp-2")} onClick={(e) => e.stopPropagation()}>{cur.caption}</p>}
        {multi && (
          <>
            <button className={cn(navBtn, "left-3 md:left-6")} onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="上一张"><ChevronLeftIcon className="size-5" /></button>
            <button className={cn(navBtn, "right-3 md:right-6")} onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="下一张"><ChevronRightIcon className="size-5" /></button>
          </>
        )}
      </div>
      {/* 详情面板 */}
      {panel && (
        <aside onClick={(e) => e.stopPropagation()}
          className="bg-background text-foreground animate-in fade-in-0 max-md:slide-in-from-bottom-4 md:slide-in-from-right-4 flex h-[48%] shrink-0 flex-col overflow-hidden rounded-t-2xl duration-200 md:h-full md:w-[400px] md:rounded-none md:border-l">
          {panel}
        </aside>
      )}
    </div>
  );
}
