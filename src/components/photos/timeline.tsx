"use client";
import Link from "next/link";
import { MapPinIcon, NotebookPenIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SelectMark, Thumb, fmtDay, fmtMonth, useTileHandlers, type ViewProps } from "./shared";

/** 时间轴：按月分组（标题吸顶），每天一行 */
export function TimelineView({ photos, onOpen, select }: ViewProps) {
  const handlers = useTileHandlers(select);
  const months: { ym: string; days: { date: string; items: { p: (typeof photos)[number]; i: number }[] }[] }[] = [];
  photos.forEach((p, i) => {
    const ym = p.date.slice(0, 7);
    let m = months[months.length - 1];
    if (!m || m.ym !== ym) months.push((m = { ym, days: [] }));
    let d = m.days[m.days.length - 1];
    if (!d || d.date !== p.date) m.days.push((d = { date: p.date, items: [] }));
    d.items.push({ p, i });
  });
  return (
    <div className="space-y-8">
      {months.map((m) => (
        <section key={m.ym}>
          <div className="bg-background/85 sticky top-[calc(var(--app-top-h)+var(--photos-bar-h,0px))] z-10 -mx-1 mb-3 flex items-baseline gap-2 px-1 py-2 backdrop-blur">
            <h3 className="text-base font-semibold">{fmtMonth(m.ym)}</h3>
            <span className="text-muted-foreground text-xs">{m.days.reduce((n, d) => n + d.items.length, 0)} 张</span>
          </div>
          <div className="relative space-y-5 border-l pl-4 sm:pl-5">
            {m.days.map((d) => {
              const journal = d.items.find((x) => x.p.journals.includes(d.date));
              const located = d.items.some((x) => x.p.lat !== undefined);
              return (
                <div key={d.date} className="relative">
                  <span className="bg-background ring-border absolute top-1.5 -left-[21px] size-2.5 sm:-left-[25px] rounded-full ring-2" />
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <span className="font-medium">{fmtDay(d.date)}</span>
                    <span className="text-muted-foreground text-xs">{d.items.length} 张</span>
                    {located && <MapPinIcon className="text-muted-foreground size-3.5" />}
                    {journal && (
                      <Link href={`/journal?date=${d.date}`} className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs">
                        <NotebookPenIcon className="size-3.5" />当天日记
                      </Link>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1 sm:grid-cols-5 sm:gap-1.5 lg:grid-cols-7">
                    {d.items.map(({ p, i }) => {
                      const on = !!select?.has(p.path);
                      return (
                        <div key={p.path} className="group relative select-none">
                          <Thumb photo={p} {...handlers(p.path, () => onOpen(i))}
                            className={cn("aspect-square rounded-md transition-colors sm:rounded-lg", select?.active ? "cursor-pointer" : "cursor-zoom-in", on && "bg-sky-500/12 ring-2 ring-sky-500 ring-inset dark:bg-sky-400/15")}
                            imgClassName={cn("transition-all duration-300", on ? "scale-[0.82] rounded-md" : !select?.active && "hover:scale-105")} />
                          {select?.active && select.locked(p.path) && <span className="bg-background/45 pointer-events-none absolute inset-0 rounded-md sm:rounded-lg" />}
                          <SelectMark path={p.path} select={select} className={select?.locked(p.path) ? "top-1 left-1 h-5 px-1.5" : "top-1.5 left-1.5 size-5"} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
