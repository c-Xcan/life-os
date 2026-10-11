"use client";
import * as React from "react";
import {
  GraduationCapIcon, BriefcaseIcon, HeartPulseIcon, WalletIcon, UsersIcon, HouseIcon, SparklesIcon, BookOpenIcon,
  DumbbellIcon, PaletteIcon, MusicIcon, CodeIcon, PlaneIcon, BabyIcon, PawPrintIcon, SproutIcon, BrainIcon,
  CameraIcon, Gamepad2Icon, CoffeeIcon, TrophyIcon, LanguagesIcon, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDomains } from "@/lib/client";

export const DOMAIN_ICONS: Record<string, LucideIcon> = {
  "graduation-cap": GraduationCapIcon, briefcase: BriefcaseIcon, "heart-pulse": HeartPulseIcon, wallet: WalletIcon,
  users: UsersIcon, house: HouseIcon, sparkles: SparklesIcon, "book-open": BookOpenIcon, dumbbell: DumbbellIcon,
  palette: PaletteIcon, music: MusicIcon, code: CodeIcon, plane: PlaneIcon, baby: BabyIcon, "paw-print": PawPrintIcon,
  sprout: SproutIcon, brain: BrainIcon, camera: CameraIcon, gamepad: Gamepad2Icon, coffee: CoffeeIcon,
  trophy: TrophyIcon, languages: LanguagesIcon,
};

/** 领域配色：静态类名，保证 Tailwind 能扫描到 */
export const DOMAIN_COLORS: Record<string, { chip: string; bar: string; ring: string; dot: string; text: string }> = {
  blue: { chip: "bg-blue-500/12 text-blue-600 dark:text-blue-400", bar: "bg-blue-500", ring: "ring-blue-500/40", dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  violet: { chip: "bg-violet-500/12 text-violet-600 dark:text-violet-400", bar: "bg-violet-500", ring: "ring-violet-500/40", dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  emerald: { chip: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", ring: "ring-emerald-500/40", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  amber: { chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", bar: "bg-amber-500", ring: "ring-amber-500/40", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  rose: { chip: "bg-rose-500/12 text-rose-600 dark:text-rose-400", bar: "bg-rose-500", ring: "ring-rose-500/40", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  sky: { chip: "bg-sky-500/12 text-sky-600 dark:text-sky-400", bar: "bg-sky-500", ring: "ring-sky-500/40", dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" },
  orange: { chip: "bg-orange-500/12 text-orange-600 dark:text-orange-400", bar: "bg-orange-500", ring: "ring-orange-500/40", dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" },
  teal: { chip: "bg-teal-500/12 text-teal-600 dark:text-teal-400", bar: "bg-teal-500", ring: "ring-teal-500/40", dot: "bg-teal-500", text: "text-teal-600 dark:text-teal-400" },
  fuchsia: { chip: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400", bar: "bg-fuchsia-500", ring: "ring-fuchsia-500/40", dot: "bg-fuchsia-500", text: "text-fuchsia-600 dark:text-fuchsia-400" },
  slate: { chip: "bg-slate-500/12 text-slate-600 dark:text-slate-300", bar: "bg-slate-500", ring: "ring-slate-500/40", dot: "bg-slate-500", text: "text-slate-600 dark:text-slate-300" },
};

export function domainColor(c: string) {
  return DOMAIN_COLORS[c] ?? DOMAIN_COLORS.slate;
}

export function DomainIcon({ icon, color, className, size = "md" }: { icon: string; color: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const Icon = DOMAIN_ICONS[icon] ?? SparklesIcon;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg", domainColor(color).chip,
      size === "sm" ? "size-6 [&_svg]:size-3.5" : size === "lg" ? "size-10 [&_svg]:size-5" : "size-8 [&_svg]:size-4", className)}>
      <Icon />
    </span>
  );
}

/** 领域小标签：图标 + 名称（自动读取自定义领域） */
export function DomainChip({ k, className }: { k: string; className?: string }) {
  const { domains } = useDomains();
  const d = domains.find((x) => x.key === k);
  const color = d?.color ?? "slate";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md py-0.5 pr-1.5 pl-1 text-[11px] font-medium", domainColor(color).chip, className)}>
      <DomainGlyph icon={d?.icon ?? "sparkles"} className="size-3" />
      {d?.label ?? k}
    </span>
  );
}

export function DomainGlyph({ icon, className }: { icon: string; className?: string }) {
  const Icon = DOMAIN_ICONS[icon] ?? SparklesIcon;
  return <Icon className={className} />;
}
