"use client";
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { SearchIcon, MoonIcon, SunIcon } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/misc";
import { CommandMenu } from "@/components/command-menu";
import { MobileTabBar, MobileTopBar } from "@/components/mobile-nav";
import { NAV, isActive, titleOf } from "@/components/nav";

export const InboxContext = React.createContext<{ inbox: number; refreshInbox: () => void }>({ inbox: 0, refreshInbox: () => {} });

export function AppShell({ children }: { children: React.ReactNode }) {
  const [inbox, setInbox] = React.useState(0);
  const [search, setSearch] = React.useState(false);
  const refreshInbox = React.useCallback(() => {
    fetch("/api/memory", { cache: "no-store" }).then((r) => r.json()).then((j) => setInbox(j?.inbox?.length ?? 0)).catch(() => {});
  }, []);
  React.useEffect(() => {
    refreshInbox();
    const t = setInterval(refreshInbox, 60_000);
    return () => clearInterval(t);
  }, [refreshInbox]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setSearch((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <InboxContext.Provider value={{ inbox, refreshInbox }}>
      <SidebarProvider>
        <AppSidebar inbox={inbox} />
        <SidebarInset>
          <Header onSearch={() => setSearch(true)} />
          <MobileTopBar onSearch={() => setSearch(true)} />
          {/* 移动端给底部标签栏留出空间 */}
          <div className="flex min-h-0 flex-1 flex-col pb-(--mobile-nav-h)">{children}</div>
          <MobileTabBar inbox={inbox} />
          <CommandMenu open={search} onOpenChange={setSearch} />
        </SidebarInset>
      </SidebarProvider>
    </InboxContext.Provider>
  );
}

function AppSidebar({ inbox }: { inbox: number }) {
  const pathname = usePathname();
  const { isMobile, setMobileOpen } = useSidebar();
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex h-10 items-center gap-2 px-2 group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:px-0">
          <div className="flex size-7 shrink-0 items-center justify-center">
            <Image src="/logo.png" alt="Life OS 标志" width={24} height={24} className="size-6" />
          </div>
          <div className="grid leading-tight whitespace-nowrap group-data-[state=collapsed]/sidebar:hidden">
            <span className="text-sm font-semibold">Life OS</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarMenu>
              {g.items.map((it) => (
                <SidebarMenuItem key={it.href}>
                  <SidebarMenuButton asChild isActive={isActive(pathname, it.href)} title={it.label}>
                    <Link href={it.href} onClick={() => isMobile && setMobileOpen(false)}>
                      <it.icon />
                      <span>{it.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {it.badge === "inbox" && inbox > 0 && <SidebarMenuBadge>{inbox}</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="text-muted-foreground px-2 pb-1 text-[11px] leading-relaxed whitespace-nowrap group-data-[state=collapsed]/sidebar:hidden">
          数据本地存储
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

/** 桌面端顶栏（移动端由 MobileTopBar 代替） */
function Header({ onSearch }: { onSearch: () => void }) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <header data-titlebar className="bg-background/80 sticky top-0 z-30 hidden h-12 shrink-0 items-center gap-2 border-b px-3 backdrop-blur md:flex">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mx-1 !h-4" />
      <h1 className="text-sm font-medium">{titleOf(pathname)}</h1>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" className="text-muted-foreground w-60 justify-start gap-2" onClick={onSearch}>
          <SearchIcon />
          <span className="flex-1 text-left">搜索资料、跳转…</span>
          <Kbd>Ctrl K</Kbd>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} title="切换主题">
          <SunIcon className="hidden dark:block" />
          <MoonIcon className="dark:hidden" />
        </Button>
      </div>
    </header>
  );
}
