"use client";
/* shadcn/ui Sidebar 的精简实现：保留相同的组件 API 与 data-slot，可被官方版本直接替换 */
import * as React from "react";
import { Slot } from "radix-ui";
import { PanelLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void; mobileOpen: boolean; setMobileOpen: (v: boolean) => void; isMobile: boolean };
const SidebarContext = React.createContext<Ctx | null>(null);

export function useSidebar() {
  const c = React.useContext(SidebarContext);
  if (!c) throw new Error("useSidebar 必须在 SidebarProvider 内使用");
  return c;
}

function useIsMobile() {
  const [m, setM] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

export function SidebarProvider({ children, className, ...props }: React.ComponentProps<"div">) {
  const isMobile = useIsMobile();
  const [open, setOpenState] = React.useState(true);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => {
    try { const v = localStorage.getItem("sidebar:open"); if (v !== null) setOpenState(v === "1"); } catch { /* ignore */ }
  }, []);
  const setOpen = React.useCallback((v: boolean) => { setOpenState(v); try { localStorage.setItem("sidebar:open", v ? "1" : "0"); } catch { /* ignore */ } }, []);
  const toggle = React.useCallback(() => (isMobile ? setMobileOpen((x) => !x) : setOpen(!open)), [isMobile, open, setOpen]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "b" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); toggle(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return (
    <SidebarContext.Provider value={{ open, setOpen, toggle, mobileOpen, setMobileOpen, isMobile }}>
      <div data-slot="sidebar-wrapper" data-state={open ? "expanded" : "collapsed"} className={cn("group/sidebar-wrapper flex min-h-svh w-full", className)} {...props}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ children, className }: { children: React.ReactNode; className?: string }) {
  const { open, isMobile, mobileOpen, setMobileOpen } = useSidebar();
  if (isMobile) {
    return (
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="bg-sidebar text-sidebar-foreground w-72 p-0 [&>button]:hidden">
          <SheetTitle className="sr-only">导航</SheetTitle>
          <SheetDescription className="sr-only">主导航</SheetDescription>
          <div className="flex h-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <aside
      data-slot="sidebar"
      data-state={open ? "expanded" : "collapsed"}
      className={cn(
        "group/sidebar bg-sidebar text-sidebar-foreground sticky top-0 hidden h-svh shrink-0 flex-col overflow-hidden border-r transition-[width] duration-200 ease-linear md:flex",
        open ? "w-60" : "w-14",
        className
      )}
    >
      {/* 内层先切到目标宽度，外层动画时只做裁剪，避免文字在过渡中被挤压换行 */}
      <div className={cn("flex h-full min-h-0 flex-col", open ? "w-60" : "w-14")}>{children}</div>
    </aside>
  );
}

export function SidebarHeader({ className, ...p }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-header" className={cn("flex flex-col gap-2 p-2", className)} {...p} />;
}
export function SidebarFooter({ className, ...p }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-footer" className={cn("mt-auto flex flex-col gap-2 p-2", className)} {...p} />;
}
export function SidebarContent({ className, ...p }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-content" className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-auto", className)} {...p} />;
}
export function SidebarGroup({ className, ...p }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-group" className={cn("relative flex w-full min-w-0 flex-col p-2", className)} {...p} />;
}
export function SidebarGroupLabel({ className, ...p }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-group-label" className={cn("text-sidebar-foreground/70 flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium group-data-[state=collapsed]/sidebar:hidden", className)} {...p} />;
}
export function SidebarMenu({ className, ...p }: React.ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" className={cn("flex w-full min-w-0 flex-col gap-1", className)} {...p} />;
}
export function SidebarMenuItem({ className, ...p }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cn("group/menu-item relative", className)} {...p} />;
}
export function SidebarMenuButton({ asChild, isActive, className, ...p }: React.ComponentProps<"button"> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        "peer/menu-button hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-medium flex h-8 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm outline-hidden transition-[width,height,padding] [&>svg]:size-4 [&>svg]:shrink-0 [&>span:last-child]:truncate",
        "group-data-[state=collapsed]/sidebar:mx-auto group-data-[state=collapsed]/sidebar:size-8 group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:px-0 group-data-[state=collapsed]/sidebar:[&>span]:hidden",
        className
      )}
      {...p}
    />
  );
}
export function SidebarMenuBadge({ className, ...p }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-menu-badge" className={cn("bg-primary text-primary-foreground pointer-events-none absolute top-1.5 right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums group-data-[state=collapsed]/sidebar:top-0 group-data-[state=collapsed]/sidebar:right-1 group-data-[state=collapsed]/sidebar:h-4 group-data-[state=collapsed]/sidebar:min-w-4", className)} {...p} />;
}
export function SidebarInset({ className, ...p }: React.ComponentProps<"main">) {
  return <main data-slot="sidebar-inset" className={cn("bg-background relative flex min-w-0 flex-1 flex-col", className)} {...p} />;
}
export function SidebarTrigger({ className, ...p }: React.ComponentProps<typeof Button>) {
  const { toggle } = useSidebar();
  return (
    <Button data-slot="sidebar-trigger" variant="ghost" size="icon-sm" className={cn("size-7", className)} onClick={toggle} {...p}>
      <PanelLeftIcon />
      <span className="sr-only">切换侧边栏</span>
    </Button>
  );
}
