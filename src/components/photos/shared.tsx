"use client";
import * as React from "react";
import { attachmentUrl } from "@/lib/image";
import { toast } from "sonner";
import { NotebookPenIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Album = { id: string; name: string; created: string };
export type Photo = {
  path: string; caption: string; tags: string[]; albums: string[]; date: string;
  takenAt?: string; lat?: number; lng?: number; journals: string[]; size: number; mtime: string;
};

export const photoUrl = (p: Photo) => attachmentUrl(p.path);

const WEEK = "日一二三四五六";
export function fmtDay(date: string, withYear = false) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withYear ? `${y} 年 ` : ""}${m} 月 ${d} 日 · 周${wd}`;
}
export function fmtMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${y} 年 ${m} 月`;
}
export function fmtTime(p: Photo) {
  return p.takenAt ? p.takenAt.slice(11, 16) : "";
}

/** 根据路径生成稳定的伪随机数（拍立得角度等用，刷新不变） */
export function seeded(s: string, i = 0) {
  let h = 2166136261 ^ i;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/** 多选：瀑布流、时间轴共用（列表视图有自己的勾选） */
export type Selection = {
  active: boolean;
  has: (path: string) => boolean;
  toggle: (path: string) => void;
  /** 进入选择模式并选中这一张（桌面点勾选圈 / 触屏长按） */
  start: (path: string) => void;
  /** 不能选的照片（日记照片：只能在日记里管理） */
  locked: (path: string) => boolean;
};

export const isJournalPhoto = (p: Photo) => p.journals.length > 0;
const LOCKED_TIP = "日记照片只能在日记里修改或删除";
export type ViewProps = { photos: Photo[]; albums: Album[]; onOpen: (index: number) => void; select?: Selection };

/**
 * 照片格子的交互：选择模式下点击=勾选，否则点击=看大图；触屏长按进入选择模式。
 * 返回要展开到元素上的事件处理。
 */
export function useTileHandlers(select: Selection | undefined) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = React.useRef(false);
  const origin = React.useRef<{ x: number; y: number } | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return React.useCallback((path: string, open: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      longPressed.current = false;
      if (e.pointerType !== "touch" || !select) return;
      origin.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        longPressed.current = true;
        if (select.locked(path)) { toast.message(LOCKED_TIP); return; }
        if (select.active) select.toggle(path); else select.start(path);
        navigator.vibrate?.(12);
      }, 420);
    },
    onPointerMove: (e: React.PointerEvent) => {
      // 手指移动（在滚动）就取消长按
      if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => { if (select && (e.nativeEvent as PointerEvent).pointerType !== "mouse") e.preventDefault(); },
    onClick: () => {
      if (longPressed.current) { longPressed.current = false; return; }
      if (select?.active) {
        if (select.locked(path)) toast.message(LOCKED_TIP);
        else select.toggle(path);
      } else open();
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [select]);
}

/** 左上角的勾选圈：桌面悬停出现，选择模式下常驻 */
export function SelectMark({ path, select, className }: { path: string; select?: Selection; className?: string }) {
  if (!select) return null;
  if (select.locked(path)) {
    // 日记照片：选择模式下显示「日记」锁定标记，不能勾选
    return select.active ? (
      <span title={LOCKED_TIP} className={cn("pointer-events-none absolute top-2 left-2 z-10 flex h-6 items-center gap-1 rounded-full bg-black/45 px-2 text-[11px] text-white backdrop-blur-sm [&_svg]:size-3", className)}>
        <NotebookPenIcon />日记
      </span>
    ) : null;
  }
  const on = select.has(path);
  return (
    <button type="button" aria-label={on ? "取消选择" : "选择"} aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); if (select.active) select.toggle(path); else select.start(path); }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "absolute top-2 left-2 z-10 flex size-6 items-center justify-center rounded-full transition-all duration-200",
        on
          ? "scale-100 bg-sky-500 text-white opacity-100 shadow-md ring-2 ring-white dark:ring-white/90"
          : "border-[1.5px] border-white/95 bg-black/15 text-transparent shadow-sm backdrop-blur-[2px] hover:scale-110 hover:bg-white/30",
        select.active ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:hidden",
        className,
      )}>
      <svg viewBox="0 0 16 16" className={cn("size-3.5 transition-transform duration-200", on ? "scale-100" : "scale-50")} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
    </button>
  );
}

/** 懒加载缩略图（统一圆角、加载淡入） */
export function Thumb({ photo, className, imgClassName, onClick, ...rest }: { photo: Photo; className?: string; imgClassName?: string; onClick?: () => void } & Omit<React.ComponentProps<"div">, "onClick">) {
  const [loaded, setLoaded] = React.useState(false);
  // 已在缓存里的图片可能在挂上 onLoad 之前就加载完了，挂载时补一次检查
  const ref = React.useCallback((el: HTMLImageElement | null) => { if (el?.complete && el.naturalWidth) setLoaded(true); }, []);
  return (
    <div className={cn("bg-muted relative overflow-hidden", className)} onClick={onClick} {...rest}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={ref} src={photoUrl(photo)} alt={photo.caption} loading="lazy" draggable={false} onLoad={() => setLoaded(true)}
        className={cn("size-full object-cover transition-opacity duration-500 [-webkit-touch-callout:none]", loaded ? "opacity-100" : "opacity-0", imgClassName)} />
    </div>
  );
}

/* ---------- 动画视图共用 ---------- */

/** 每帧回调（dt 单位秒，上限 0.05 避免切回标签页时跳太远） */
export function useFrame(cb: (dt: number, t: number) => void) {
  const ref = React.useRef(cb);
  ref.current = cb;
  /** 立即执行一帧（dt=0），用于尺寸变化后同步重绘 */
  const now = React.useCallback(() => ref.current(0, performance.now() / 1000), []);
  React.useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ref.current(dt, now / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return now;
}

/** 元素尺寸 */
export function useSize<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** 非被动的滚轮监听（可以阻止页面滚动） */
export function useWheel(ref: React.RefObject<HTMLElement | null>, fn: (e: WheelEvent) => void) {
  const cb = React.useRef(fn);
  cb.current = fn;
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: WheelEvent) => { e.preventDefault(); cb.current(e); };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [ref]);
}

/** 整数哈希 → [0,1) */
export function hash01(...n: number[]) {
  let h = 2166136261;
  for (const v of n) { h ^= v | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return ((h >>> 0) % 100000) / 100000;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/**
 * 让元素高度填满窗口剩余空间：从元素顶部到窗口底部（留出底部边距和移动端标签栏），
 * 不低于 min。窗口缩放、上方内容变化时自动重算。设置的是内联 height，会覆盖 class 里的固定高度。
 */
export function useFitHeight(ref: React.RefObject<HTMLElement | null>, { min = 360, max = 1400, bottom = 24 } = {}) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top + window.scrollY;
        // --mobile-nav-h 是 calc() 表达式，用一个临时元素量出实际像素
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;visibility:hidden;height:var(--mobile-nav-h)";
        document.body.appendChild(probe);
        const nav = probe.offsetHeight;
        probe.remove();
        const h = Math.round(Math.min(max, Math.max(min, window.innerHeight - top - bottom - nav)));
        if (el.style.height !== `${h}px`) el.style.height = `${h}px`;
      });
    };
    fit();
    window.addEventListener("resize", fit);
    // 上方的标签、工具栏换行等导致位置变化时也重算
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement.parentElement ?? el.parentElement);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", fit); ro.disconnect(); };
  }, [ref, min, max, bottom]);
}

/** 动画视图的深色舞台 */
export const STAGE = "relative h-[620px] touch-none overflow-hidden rounded-2xl border bg-[#f5f5f5] select-none dark:bg-[#0a0a0a]";
export function StageHint({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground/80 pointer-events-none absolute inset-x-0 bottom-3 z-[9999] text-center text-[11px]">{children}</div>;
}
