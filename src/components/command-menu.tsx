"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileTextIcon, MessageSquarePlusIcon, NotebookPenIcon, LayoutDashboardIcon, SquareKanbanIcon, NewspaperIcon, BrainIcon, PackageIcon, SettingsIcon, CalendarCheckIcon, UserRoundIcon, FolderTreeIcon, ImagesIcon } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";

type Hit = { path: string; title: string; type: string; date: string | null; snippet: string };

const PAGES = [
  { href: "/", label: "概览", icon: LayoutDashboardIcon },
  { href: "/journal", label: "日记", icon: NotebookPenIcon },
  { href: "/photos", label: "照片", icon: ImagesIcon },
  { href: "/plans", label: "计划", icon: SquareKanbanIcon },
  { href: "/news", label: "资讯", icon: NewspaperIcon },
  { href: "/profile", label: "档案", icon: UserRoundIcon },
  { href: "/reviews", label: "复盘", icon: CalendarCheckIcon },
  { href: "/memory", label: "记忆", icon: BrainIcon },
  { href: "/files", label: "文件", icon: FolderTreeIcon },
  { href: "/export", label: "备份与迁移", icon: PackageIcon },
  { href: "/settings", label: "设置", icon: SettingsIcon },
];

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);

  React.useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((j) => setHits(j.hits ?? [])).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = (href: string) => { onOpenChange(false); setQ(""); router.push(href); };
  const ql = q.trim().toLowerCase();
  const pages = PAGES.filter((p) => !ql || p.label.includes(q.trim()) || p.href.includes(ql));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput placeholder="搜索日记、档案、计划…或输入页面名" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>没有找到相关内容</CommandEmpty>
        <CommandGroup heading="快速操作">
          <CommandItem value="new-chat" onSelect={() => go(`/chat?q=${encodeURIComponent(q)}`)}>
            <MessageSquarePlusIcon />
            {q.trim() ? `问 AI：${q}` : "新对话"}
          </CommandItem>
          <CommandItem value="today" onSelect={() => go("/journal?write=1")}>
            <NotebookPenIcon />
            写今天的日记
          </CommandItem>
        </CommandGroup>
        {hits.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="资料">
              {hits.map((h) => (
                <CommandItem key={h.path} value={h.path} onSelect={() => go(h.type === "journal" && h.date ? `/journal?date=${h.date}` : `/files?path=${encodeURIComponent(h.path)}`)}>
                  <FileTextIcon />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{h.title}{h.date ? <span className="text-muted-foreground ml-2 text-xs">{h.date}</span> : null}</span>
                    <span className="text-muted-foreground truncate text-xs">{h.snippet.replace(/\s+/g, " ").slice(0, 80)}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {pages.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="页面">
              {pages.map((p) => (
                <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)}>
                  <p.icon />
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
