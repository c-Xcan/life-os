"use client";
import * as React from "react";
import { NotebookPenIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SelectMark, photoUrl, useSize, useTileHandlers, type Photo, type ViewProps } from "./shared";

/** 目标列宽（px）：按容器宽度自动决定列数 */
const COL_W = 280;

/**
 * 瀑布流：按图片真实比例，把每张放进当前最矮的一列（不用 CSS columns，
 * 那种写法照片少时会把最后几列空着）。支持多选。
 */
export function MasonryView({ photos, onOpen, select }: ViewProps) {
  const handlers = useTileHandlers(select);
  const [ref, { w }] = useSize<HTMLDivElement>();
  const gap = w < 640 ? 8 : 12;
  const cols = Math.max(2, Math.min(6, Math.round((w + gap) / (COL_W + gap)) || 2));
  // 已加载图片的高宽比；未加载的先按 3:4 估计
  const [ratio, setRatio] = React.useState<Record<string, number>>({});

  const columns = React.useMemo(() => {
    const out: { p: Photo; i: number }[][] = Array.from({ length: cols }, () => []);
    const h = new Array(cols).fill(0);
    photos.forEach((p, i) => {
      let c = 0;
      for (let k = 1; k < cols; k++) if (h[k] < h[c] - 0.01) c = k;
      out[c].push({ p, i });
      h[c] += (ratio[p.path] ?? 0.75) + 0.05;
    });
    return out;
  }, [photos, cols, ratio]);

  return (
    <div ref={ref} className="flex items-start" style={{ gap }}>
      {columns.map((col, ci) => (
        <div key={ci} className="flex min-w-0 flex-1 flex-col" style={{ gap }}>
          {col.map(({ p, i }) => {
            const on = !!select?.has(p.path);
            return (
              <figure key={p.path} {...handlers(p.path, () => onOpen(i))}
                className={cn("group relative overflow-hidden rounded-lg transition-colors duration-200 select-none sm:rounded-xl",
                  on ? "bg-sky-500/12 dark:bg-sky-400/15" : "bg-muted",
                  select?.active ? "cursor-pointer" : "cursor-zoom-in")}
                style={ratio[p.path] ? undefined : { aspectRatio: "4 / 3" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(p)} alt={p.caption} loading="lazy" draggable={false}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    if (el.naturalWidth) { const r = el.naturalHeight / el.naturalWidth; setRatio((m) => (m[p.path] === r ? m : { ...m, [p.path]: r })); }
                  }}
                  className={cn("block w-full transition-all duration-300 [-webkit-touch-callout:none]",
                    !ratio[p.path] && "h-full object-cover",
                    on ? "scale-[0.86] rounded-md sm:rounded-lg" : select?.active ? "" : "group-hover:scale-[1.03]")} />
                {/* 选择模式：顶部加一层淡淡的暗角，让勾选圈在亮图上也看得清 */}
                {select?.active && !on && <span className={cn("pointer-events-none absolute inset-0", select.locked(p.path) ? "bg-background/45" : "bg-linear-to-b from-black/30 via-transparent to-transparent")} />}
                {/* 日记照片角标：平时也显示，一眼能分清 */}
                {p.journals.length > 0 && !select?.active && (
                  <span className="pointer-events-none absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm [&_svg]:size-3.5" title="日记照片">
                    <NotebookPenIcon />
                  </span>
                )}
                {on && <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-sky-500 ring-inset" />}
                <SelectMark path={p.path} select={select} />
                {!select?.active && (
                  <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 via-black/20 to-transparent px-3 pt-10 pb-2.5 text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    {p.caption && <div className="line-clamp-2 text-xs leading-5">{p.caption}</div>}
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/70">
                      <span className="tabular-nums">{p.date}</span>
                      {p.journals.length > 0 && <span className="flex items-center gap-0.5"><NotebookPenIcon className="size-3" />日记</span>}
                    </div>
                  </figcaption>
                )}
              </figure>
            );
          })}
        </div>
      ))}
    </div>
  );
}
