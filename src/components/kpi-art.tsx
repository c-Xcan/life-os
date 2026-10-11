import Image from "next/image";
import { cn } from "@/lib/utils";

const ART: Record<string, string> = {
  sleep: "/images/kpi/sleep.png",
  mood: "/images/kpi/mood.png",
  energy: "/images/kpi/energy.png",
  study_min: "/images/kpi/study.png",
  exercise_min: "/images/kpi/exercise.png",
};

/** Decorative artwork: the card text supplies the metric and its value. */
export function KpiArt({ k, className }: { k: string; className?: string }) {
  const src = ART[k];
  if (!src) return null;
  return (
    <span aria-hidden="true" className={cn("pointer-events-none select-none", className)}>
      <Image src={src} alt="" fill sizes="(min-width: 1024px) 72px, 56px" className="object-contain" />
    </span>
  );
}
