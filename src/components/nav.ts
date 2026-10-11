import {
  LayoutDashboardIcon, MessageSquareIcon, NewspaperIcon, NotebookPenIcon, SquareKanbanIcon, UserRoundIcon,
  CalendarCheckIcon, BrainIcon, FolderTreeIcon, PackageIcon, SettingsIcon, ImagesIcon, type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: "inbox"; tone?: string };

/** 全站导航：桌面端侧边栏、移动端底部标签栏与「更多」面板共用 */
export const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "日常", items: [
      { href: "/", label: "概览", icon: LayoutDashboardIcon },
      { href: "/chat", label: "对话", icon: MessageSquareIcon },
      { href: "/journal", label: "日记", icon: NotebookPenIcon },
      { href: "/photos", label: "照片", icon: ImagesIcon, tone: "bg-pink-500/12 text-pink-600 dark:text-pink-400" },
      { href: "/plans", label: "计划", icon: SquareKanbanIcon },
      { href: "/news", label: "资讯", icon: NewspaperIcon, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
    ],
  },
  {
    label: "了解我", items: [
      { href: "/profile", label: "档案", icon: UserRoundIcon, tone: "bg-amber-500/14 text-amber-700 dark:text-amber-400" },
      { href: "/reviews", label: "复盘", icon: CalendarCheckIcon, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
      { href: "/memory", label: "记忆", icon: BrainIcon, badge: "inbox", tone: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
    ],
  },
  {
    label: "系统", items: [
      { href: "/files", label: "文件", icon: FolderTreeIcon, tone: "bg-slate-500/12 text-slate-600 dark:text-slate-300" },
      { href: "/export", label: "备份与迁移", icon: PackageIcon, tone: "bg-orange-500/12 text-orange-600 dark:text-orange-400" },
      { href: "/settings", label: "设置", icon: SettingsIcon, tone: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-300" },
    ],
  },
];

export const ALL_NAV = NAV.flatMap((g) => g.items);

/** 移动端底部标签栏常驻的 4 个入口，其余收进「更多」 */
export const MOBILE_TABS = ["/", "/chat", "/journal", "/plans"];

export const TITLES: Record<string, string> = Object.fromEntries(ALL_NAV.map((x) => [x.href, x.label]));

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function titleOf(pathname: string) {
  return TITLES["/" + (pathname.split("/")[1] ?? "")] ?? "";
}
