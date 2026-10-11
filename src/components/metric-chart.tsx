"use client";
import * as React from "react";
import Link from "next/link";
import { Area, AreaChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { METRIC_META } from "@/lib/client";

/** 每个指标固定配色，图表、图例、卡片保持一致 */
export const METRIC_COLOR: Record<string, string> = {
  mood: "#10b981", energy: "#f59e0b", sleep: "#6366f1",
  study_min: "#0ea5e9", work_min: "#8b5cf6", exercise_min: "#f43f5e", weight: "#64748b",
};
const FALLBACK = ["#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e"];
export const metricColor = (k: string, i = 0) => METRIC_COLOR[k] ?? FALLBACK[i % FALLBACK.length];

const unitOf = (k: string) => { const u = METRIC_META[k]?.unit; return u === "/5" ? "" : u === "h" ? " 小时" : u ? " 分钟" : ""; };

/**
 * 趋势图：柔和面积图（平滑曲线 + 浅色同色渐变），单轴。
 * - 只画一个指标时附带平均线
 * - 分钟类指标没有记录的日子按 0 处理，并补齐日期，保证每天都能 hover
 */
export function MetricChart({ points, keys, className }: { points: Record<string, unknown>[]; keys: string[]; className?: string }) {
  const uid = React.useId().replace(/:/g, "");
  const config: ChartConfig = Object.fromEntries(keys.map((k, i) => [k, { label: METRIC_META[k]?.label ?? k, color: metricColor(k, i), unit: unitOf(k) }]));
  if (!points.length) {
    return (
      <Empty className="h-56 border-0 bg-transparent py-6">
        <EmptyHeader>
          <EmptyTitle>还没有趋势数据</EmptyTitle>
          <EmptyDescription>写日记时记下心情、睡眠或精力，这里就会出现最近 30 天的变化。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" asChild><Link href="/journal?write=1">去写日记</Link></Button>
        </EmptyContent>
      </Empty>
    );
  }

  const zeroKeys = keys.filter((k) => k.endsWith("_min"));
  let rows = points;
  if (zeroKeys.length) {
    const byDate = new Map(points.map((p) => [String(p.date), p]));
    const dates = [...byDate.keys()].sort();
    rows = [];
    for (let d = new Date(dates[0] + "T00:00:00Z"); d.toISOString().slice(0, 10) <= dates[dates.length - 1]; d.setUTCDate(d.getUTCDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      const p = byDate.get(ds) ?? { date: ds };
      rows.push({ ...p, ...Object.fromEntries(zeroKeys.map((k) => [k, typeof p[k] === "number" ? p[k] : 0])) });
    }
  }
  const data = rows.map((p) => ({ ...p, label: String(p.date).slice(5).replace("-", "/") }));

  const single = keys.length === 1 ? keys[0] : null;
  const vals = single ? data.map((p) => (p as Record<string, unknown>)[single]).filter((v): v is number => typeof v === "number") : [];
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const scale5 = keys.every((k) => METRIC_META[k]?.unit === "/5");
  const tick = { fontSize: 11 };

  return (
    <ChartContainer config={config} className={className ?? "aspect-auto h-56 w-full"}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 16, bottom: 0 }}>
        <defs>
          {keys.map((k, i) => (
            <linearGradient key={k} id={`${uid}-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={metricColor(k, i)} stopOpacity={keys.length > 1 ? 0.12 : 0.22} />
              <stop offset="95%" stopColor={metricColor(k, i)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} tickMargin={10} minTickGap={40} tick={tick} />
        <YAxis tickLine={false} axisLine={false} width={28} tick={{ ...tick, fillOpacity: 0.7 }} allowDecimals={!scale5}
          domain={scale5 ? [1, 5] : [0, "auto"]} ticks={scale5 ? [1, 3, 5] : undefined} tickCount={scale5 ? undefined : 3} />
        {avg !== null && (
          <ReferenceLine y={avg} stroke="var(--muted-foreground)" strokeOpacity={0.35} strokeDasharray="3 5"
            label={{ value: `均值 ${single?.endsWith("_min") ? Math.round(avg) : avg.toFixed(1)}`, position: "insideTopLeft", fontSize: 11, fill: "var(--muted-foreground)", dy: -14 }} />
        )}
        <ChartTooltip cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.25, strokeWidth: 1 }} content={<ChartTooltipContent />} />
        {keys.map((k, i) => (
          <Area key={k} dataKey={k} type="monotone" stroke={metricColor(k, i)} strokeWidth={2} fill={`url(#${uid}-${k})`}
            connectNulls dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: metricColor(k, i) }} />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
