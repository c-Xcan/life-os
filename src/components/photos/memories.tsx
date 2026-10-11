"use client";
import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { photoUrl, fmtDay, seeded, type Photo } from "./shared";

const DURATION = 5000;

/** 回忆播放：全屏自动播放，照片缓慢平移放大（Ken Burns），交叉淡入，配描述和日期 */
export function MemoriesPlayer({ photos, title, onClose }: { photos: Photo[]; title: string; onClose: () => void }) {
  const [idx, setIdx] = React.useState(0);
  const [playing, setPlaying] = React.useState(true);
  const [tick, setTick] = React.useState(0); // 每次切换重置进度条动画
  const n = photos.length;
  const go = React.useCallback((d: number) => { setIdx((i) => (i + d + n) % n); setTick((t) => t + 1); }, [n]);

  React.useEffect(() => {
    if (!playing || n < 2) return;
    const t = setTimeout(() => go(1), DURATION);
    return () => clearTimeout(t);
  }, [playing, idx, tick, go, n]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [go, onClose]);

  // 预加载下一张
  React.useEffect(() => { if (n > 1) { const img = new Image(); img.src = photoUrl(photos[(idx + 1) % n]); } }, [idx, n, photos]);

  if (!n) return null;
  const cur = photos[idx];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black text-white select-none">
      <style>{`
        @keyframes kb { from { transform: scale(var(--s0)) translate(var(--x0), var(--y0)); } to { transform: scale(var(--s1)) translate(var(--x1), var(--y1)); } }
        @keyframes fadein { from { opacity: 0 } to { opacity: 1 } }
        @keyframes rise { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
        @keyframes bar { from { transform: scaleX(0) } to { transform: scaleX(1) } }
      `}</style>

      {photos.map((p, i) => {
        if (i !== idx) return null;
        const r = (k: number) => seeded(p.path, k + tick * 7);
        const zoomIn = r(0) > 0.4;
        const vars = {
          "--s0": zoomIn ? 1.02 : 1.14, "--s1": zoomIn ? 1.14 : 1.02,
          "--x0": `${(r(1) - 0.5) * 4}%`, "--y0": `${(r(2) - 0.5) * 4}%`,
          "--x1": `${(r(3) - 0.5) * 4}%`, "--y1": `${(r(4) - 0.5) * 4}%`,
        } as React.CSSProperties;
        return (
          <div key={`${p.path}-${tick}`} className="absolute inset-0" style={{ animation: "fadein 1.2s ease both" }}>
            {/* 模糊背景铺满，主图完整显示 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(p)} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-3xl" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(p)} alt={p.caption} className="absolute inset-0 size-full object-contain"
              style={{ ...vars, animation: `kb ${DURATION + 1500}ms ease-in-out both`, animationPlayState: playing ? "running" : "paused" }} />
          </div>
        );
      })}

      {/* 顶部：进度条 + 标题 */}
      <div className="absolute inset-x-0 top-0 bg-linear-to-b from-black/60 to-transparent px-5 pt-4 pb-10">
        <div className="flex gap-1">
          {photos.slice(0, 60).map((p, i) => (
            <div key={p.path} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
              {i < idx && <div className="h-full bg-white" />}
              {i === idx && <div key={tick} className="h-full origin-left bg-white" style={{ animation: `bar ${DURATION}ms linear both`, animationPlayState: playing ? "running" : "paused" }} />}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-white/60 tabular-nums">{idx + 1} / {n}</div>
          <button onClick={onClose} className="ml-auto rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="退出"><XIcon className="size-5" /></button>
        </div>
      </div>

      {/* 底部：日期 + 描述 */}
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 via-black/30 to-transparent px-6 pt-24 pb-8 text-center md:px-16">
        <div key={`${cur.path}-${tick}`} style={{ animation: "rise .9s .3s ease both" }}>
          <div className="text-xs tracking-widest text-white/60 tabular-nums">{fmtDay(cur.date, true)}</div>
          {cur.caption && <div className="mx-auto mt-2 max-w-2xl text-lg leading-8 font-light md:text-xl">{cur.caption}</div>}
        </div>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button onClick={() => go(-1)} className="rounded-full bg-white/10 p-2.5 hover:bg-white/20" aria-label="上一张"><ChevronLeftIcon className="size-5" /></button>
          <button onClick={() => setPlaying((p) => !p)} className="rounded-full bg-white p-3 text-black hover:bg-white/90" aria-label={playing ? "暂停" : "播放"}>
            {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
          </button>
          <button onClick={() => go(1)} className="rounded-full bg-white/10 p-2.5 hover:bg-white/20" aria-label="下一张"><ChevronRightIcon className="size-5" /></button>
        </div>
      </div>

      {/* 左右点击区域 */}
      <button className={cn("absolute top-24 bottom-40 left-0 w-1/4 cursor-w-resize")} onClick={() => go(-1)} aria-label="上一张" />
      <button className={cn("absolute top-24 right-0 bottom-40 w-1/4 cursor-e-resize")} onClick={() => go(1)} aria-label="下一张" />
    </div>
  );
}
