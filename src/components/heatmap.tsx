"use client";
import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const GAP = 3;
const MIN_CELL = 10;
const MAX_CELL = 16;

/** 记录热力图（类似 GitHub 贡献图）：有日记的日子着色，颜色深浅代表心情。格子随容器宽度伸缩，放不下时只显示最近的若干周 */
export function Heatmap({ data, today, weeks: maxWeeks = 53, maxCell = MAX_CELL, onSelect }: { data: Record<string, { mood?: number }>; today: string; weeks?: number; maxCell?: number; onSelect?: (date: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const weeks = width ? Math.max(1, Math.min(maxWeeks, Math.floor((width + GAP) / (MIN_CELL + GAP)))) : 0;

  const cells = React.useMemo(() => {
    if (!weeks) return [];
    const end = new Date(today + "T00:00:00Z");
    const endDow = (end.getUTCDay() + 6) % 7; // 周一=0
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - endDow - (weeks - 1) * 7);
    const cols: { date: string; future: boolean }[][] = [];
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const x = new Date(start);
        x.setUTCDate(start.getUTCDate() + w * 7 + d);
        const ds = x.toISOString().slice(0, 10);
        col.push({ date: ds, future: ds > today });
      }
      cols.push(col);
    }
    return cols;
  }, [today, weeks]);

  const level = (date: string) => {
    const v = data[date];
    if (!v) return 0;
    if (!v.mood) return 2;
    return Math.max(1, Math.min(4, v.mood - 1));
  };
  const COLORS = ["bg-muted", "bg-emerald-200 dark:bg-emerald-900", "bg-emerald-300 dark:bg-emerald-700", "bg-emerald-500 dark:bg-emerald-500", "bg-emerald-700 dark:bg-emerald-300"];

  // 月份标签需要约 3 列宽度，离上一个标签或右边缘太近的不显示，避免重叠和溢出
  const months: { idx: number; label: string }[] = [];
  cells.forEach((col, i) => {
    const m = col[0].date.slice(5, 7);
    if (i > 0 && m === cells[i - 1][0].date.slice(5, 7)) return;
    if (i > weeks - 3) return;
    const prev = months.at(-1);
    if (prev && i - prev.idx < 3) months.pop();
    months.push({ idx: i, label: `${Number(m)}月` });
  });

  return (
    <div ref={ref} className="flex w-full flex-col gap-1" style={{ maxWidth: maxWeeks * (maxCell + GAP) - GAP }}>
      {weeks > 0 && (
        <>
          <div className="text-muted-foreground relative h-4 text-[10px]">
            {months.map((m) => <span key={m.idx} className="absolute whitespace-nowrap" style={{ left: `${(m.idx / weeks) * 100}%` }}>{m.label}</span>)}
          </div>
          <div className="grid grid-flow-col" style={{ gap: GAP, gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, gridTemplateRows: "repeat(7, auto)" }}>
            {cells.flat().map((c) => c.future ? <div key={c.date} className="aspect-square" /> : (
              <Tooltip key={c.date}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onSelect?.(c.date)}
                    className={cn("aspect-square w-full rounded-[2px] outline-none ring-offset-1 hover:ring-1 hover:ring-foreground/40", COLORS[level(c.date)], c.date === today && "ring-1 ring-foreground/60")}
                  />
                </TooltipTrigger>
                <TooltipContent>{c.date}{data[c.date] ? (data[c.date].mood ? ` · 心情 ${data[c.date].mood}/5` : " · 已记录") : " · 未记录"}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="text-muted-foreground flex items-center justify-end gap-1 text-[10px]">
            心情低 {COLORS.slice(1).map((c) => <span key={c} className={cn("size-[10px] rounded-[2px]", c)} />)} 心情高
          </div>
        </>
      )}
    </div>
  );
}
