"use client";
/* shadcn/ui Chart 的精简实现：ChartContainer 注入 --color-<key> 变量 + 统一样式的 Tooltip */
import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, { label?: React.ReactNode; color?: string; unit?: string }>;
const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

export function ChartContainer({ id, className, children, config, ...props }: React.ComponentProps<"div"> & { config: ChartConfig; children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"] }) {
  const uid = React.useId();
  const chartId = `chart-${id || uid.replace(/:/g, "")}`;
  const style = Object.fromEntries(Object.entries(config).filter(([, c]) => c.color).map(([k, c]) => [`--color-${k}`, c.color])) as React.CSSProperties;
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        style={style}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipItem = { dataKey?: string | number; name?: string | number; value?: number | string; color?: string };
export function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: TooltipItem[]; label?: string | number }) {
  const ctx = React.useContext(ChartContext);
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{label}</div>
      <div className="grid gap-1.5">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name);
          const cfg = ctx?.config[key];
          return (
            <div key={key} className="flex w-full items-center gap-2">
              <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
              <span className="text-muted-foreground">{cfg?.label ?? key}</span>
              <span className="text-foreground ml-auto font-mono font-medium tabular-nums">{item.value}{cfg?.unit ?? ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
