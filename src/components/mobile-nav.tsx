"use client";
/* 移动端专用外壳：顶部应用栏 + 底部标签栏 + 「更多」面板（仅在 md 以下显示） */
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Dialog as SheetPrimitive } from "radix-ui";
import { LayoutGridIcon, MonitorIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_NAV, MOBILE_TABS, isActive, titleOf } from "@/components/nav";

/** 这些页面没有大标题，顶部栏始终显示页面名 */
const ALWAYS_TITLE = ["/chat"];

export function MobileTopBar({ onSearch }: { onSearch: () => void }) {
  const pathname = usePathname();
  const title = titleOf(pathname);
  const home = pathname === "/";
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const on = () => setScrolled(window.scrollY > 36);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [pathname]);
  const showTitle = scrolled || ALWAYS_TITLE.includes(pathname);

  return (
    <header data-titlebar
      className={cn(
        "bg-background/85 sticky top-0 z-30 flex shrink-0 items-end border-b px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 transition-colors md:hidden",
        scrolled || !home ? "border-border" : "border-transparent",
      )}
    >
      <div className="flex h-14 w-full items-center gap-2">
        {home ? (
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center">
              <Image src="/logo.png" alt="Life OS 标志" width={28} height={28} className="size-7" />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">Life OS</span>
          </Link>
        ) : (
          <h1 className={cn("truncate text-[17px] font-semibold tracking-tight transition-all duration-200", showTitle ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}>{title}</h1>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconBtn onClick={onSearch} label="搜索"><SearchIcon /></IconBtn>
          <ThemeBtn />
        </div>
      </div>
    </header>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="text-foreground/80 active:bg-muted flex size-10 items-center justify-center rounded-full transition-colors [&_svg]:size-5">
      {children}
    </button>
  );
}

function ThemeBtn() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <IconBtn onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} label="切换主题">
      <SunIcon className="hidden dark:block" />
      <MoonIcon className="dark:hidden" />
    </IconBtn>
  );
}

export function MobileTabBar({ inbox }: { inbox: number }) {
  const pathname = usePathname();
  const [more, setMore] = React.useState(false);
  React.useEffect(() => { setMore(false); }, [pathname]);
  const tabs = MOBILE_TABS.map((h) => ALL_NAV.find((x) => x.href === h)!);
  const moreActive = !MOBILE_TABS.some((h) => isActive(pathname, h));

  return (
    <>
      <nav aria-label="主导航"
        className="bg-background/90 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden">
        <div className="mx-auto grid h-14 max-w-md grid-cols-5">
          {tabs.map((t) => (
            <TabItem key={t.href} href={t.href} label={t.label} icon={t.icon} active={isActive(pathname, t.href)} />
          ))}
          <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more}
            className="group flex flex-col items-center justify-center gap-0.5">
            <TabIcon active={moreActive || more} dot={inbox > 0}><LayoutGridIcon /></TabIcon>
            <span className={cn("text-[10.5px] leading-none", moreActive || more ? "text-foreground font-medium" : "text-muted-foreground")}>更多</span>
          </button>
        </div>
      </nav>
      <MoreSheet open={more} onOpenChange={setMore} inbox={inbox} pathname={pathname} />
    </>
  );
}

function TabItem({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ElementType; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className="group flex flex-col items-center justify-center gap-0.5">
      <TabIcon active={active}><Icon /></TabIcon>
      <span className={cn("text-[10.5px] leading-none", active ? "text-foreground font-medium" : "text-muted-foreground")}>{label}</span>
    </Link>
  );
}

function TabIcon({ active, dot, children }: { active: boolean; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn(
      "relative flex h-7 w-12 items-center justify-center rounded-full transition-all duration-200 [&_svg]:size-[21px] group-active:scale-90",
      active ? "bg-foreground/[0.08] text-foreground [&_svg]:stroke-[2.2]" : "text-muted-foreground [&_svg]:stroke-[1.8]",
    )}>
      {children}
      {dot && <span className="ring-background absolute top-0.5 right-2.5 size-2 rounded-full bg-rose-500 ring-2" />}
    </span>
  );
}

function MoreSheet({ open, onOpenChange, inbox, pathname }: { open: boolean; onOpenChange: (v: boolean) => void; inbox: number; pathname: string }) {
  const items = ALL_NAV.filter((x) => !MOBILE_TABS.includes(x.href));
  return (
    <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40 md:hidden" />
        <SheetPrimitive.Content
          className="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl duration-300 outline-none md:hidden"
        >
          <div className="bg-muted-foreground/25 mx-auto mt-2.5 h-1 w-10 rounded-full" />
          <div className="flex items-center px-5 pt-3 pb-1">
            <SheetPrimitive.Title className="text-base font-semibold">全部功能</SheetPrimitive.Title>
            <SheetPrimitive.Description className="sr-only">跳转到其他页面</SheetPrimitive.Description>
          </div>
          <div className="grid grid-cols-4 gap-x-2 gap-y-4 px-4 pt-3 pb-5">
            {items.map((it) => {
              const on = isActive(pathname, it.href);
              const badge = it.badge === "inbox" && inbox > 0 ? inbox : 0;
              return (
                <Link key={it.href} href={it.href} onClick={() => onOpenChange(false)}
                  className="flex flex-col items-center gap-1.5 rounded-2xl py-1 active:opacity-70">
                  <span className={cn("relative flex size-12 items-center justify-center rounded-2xl [&_svg]:size-[22px]", it.tone, on && "ring-foreground/70 ring-2 ring-offset-2 ring-offset-background")}>
                    <it.icon />
                    {badge > 0 && <span className="ring-background absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white tabular-nums ring-2">{badge}</span>}
                  </span>
                  <span className={cn("text-xs whitespace-nowrap", on ? "font-medium" : "text-foreground/80")}>{it.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="mx-4 border-t pt-4">
            <ThemeSegment />
            <p className="text-muted-foreground mt-3 text-center text-[11px]">所有数据都存储在本机</p>
          </div>
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}

function ThemeSegment() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const opts = [
    { v: "light", label: "浅色", icon: SunIcon },
    { v: "dark", label: "深色", icon: MoonIcon },
    { v: "system", label: "跟随系统", icon: MonitorIcon },
  ];
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm">外观</span>
      <div className="bg-muted ml-auto inline-flex rounded-full p-1">
        {opts.map((o) => {
          const on = mounted && theme === o.v;
          return (
            <button key={o.v} type="button" onClick={() => setTheme(o.v)} aria-pressed={on}
              className={cn("flex h-8 items-center gap-1 rounded-full px-3 text-xs transition-all [&_svg]:size-3.5", on ? "bg-background text-foreground font-medium shadow-xs" : "text-muted-foreground")}>
              <o.icon />{o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
