"use client";
import * as React from "react";
import { toast } from "sonner";
import { CheckIcon, FileTextIcon, HistoryIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/misc";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { HistoryDialog } from "@/components/history-dialog";

type FileRes = { path: string; exists: boolean; raw: string; body: string; fm: Record<string, unknown>; versions?: number };

type Section = { title: string; content: string; hint: string; start: number; end: number };

const COMMENT_RE = /<!--([\s\S]*?)-->/g;
const isBlank = (s: string) => !s.replace(COMMENT_RE, "").trim();

/** 把整份 Markdown 拆成：H1 标题、导语（H1 和第一个 ## 之间）、各个 ## 小节（行号区间基于 raw） */
function parseDoc(raw: string) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") { i = 1; while (i < lines.length && lines[i].trim() !== "---") i++; i++; }
  let title = "";
  const intro: string[] = [];
  const sections: Section[] = [];
  let cur: Section | null = null;
  const close = (end: number) => {
    if (!cur) return;
    cur.end = end;
    const body = lines.slice(cur.start + 1, end).join("\n");
    const m = /<!--([\s\S]*?)-->/.exec(body);
    cur.hint = m ? m[1].trim() : "";
    cur.content = body.replace(COMMENT_RE, "").trim();
    sections.push(cur);
    cur = null;
  };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^#\s+/.test(l)) { close(i); if (!title) title = l.replace(/^#\s+/, "").trim(); continue; }
    if (/^##\s+/.test(l)) { close(i); cur = { title: l.replace(/^##\s+/, "").trim(), content: "", hint: "", start: i, end: i }; continue; }
    if (!cur && title) intro.push(l);
  }
  close(lines.length);
  return { lines, title, intro: intro.join("\n").replace(COMMENT_RE, "").trim(), sections };
}

/** 用新内容替换某个小节；清空时保留原来的提示注释 */
function replaceSection(raw: string, s: Section, content: string) {
  const { lines } = parseDoc(raw);
  const next = content.trim() ? content.trim() : (s.hint ? `<!-- ${s.hint} -->` : "");
  const out = [...lines.slice(0, s.start + 1), "", ...(next ? [next, ""] : []), ...lines.slice(s.end)];
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
}

export interface SectionDocProps {
  path: string;
  /** 标题左侧的图标 */
  leading?: React.ReactNode;
  /** 覆盖文件里的 H1 标题 */
  title?: string;
  description?: string;
  /** 标题栏右侧额外的操作按钮 */
  actions?: React.ReactNode;
  /** 进度条颜色类名，例如 bg-blue-500 */
  accentClass?: string;
  onSaved?: () => void;
  className?: string;
  /** 标题栏下方、正文上方的额外内容（如数据概览） */
  banner?: React.ReactNode;
  /** 无外框的紧凑样式（用于侧边栏 / 弹窗）：小节标题在上、内容在下 */
  bare?: boolean;
  /** 标题下方的元信息行额外内容 */
  meta?: React.ReactNode;
}

/** 档案类文档：按 ## 小节分块展示，每块可以单独编辑；也支持编辑全文 */
export function SectionDoc({ path, leading, title, description, actions, accentClass = "bg-primary", onSaved, className, banner, meta, bare = false }: SectionDocProps) {
  const [file, setFile] = React.useState<FileRes | null>(null);
  const [editing, setEditing] = React.useState<number | null>(null);
  const [rawMode, setRawMode] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);

  const load = React.useCallback(async () => {
    const f = await api<FileRes>(`/api/vault/file?path=${encodeURIComponent(path)}`);
    setFile(f);
    return f;
  }, [path]);
  React.useEffect(() => { setFile(null); setEditing(null); setRawMode(false); void load(); }, [load]);

  const doc = React.useMemo(() => (file ? parseDoc(file.raw) : null), [file]);
  const total = doc?.sections.length ?? 0;
  const updated = (typeof file?.fm.updated === "string" && file.fm.updated) || "";

  const persist = React.useCallback(async (raw: string) => {
    setSaving(true);
    try {
      await api("/api/vault/file", { method: "PUT", json: { path, raw } });
      toast.success("已保存");
      await load();
      onSaved?.();
      return true;
    } catch { return false; } finally { setSaving(false); }
  }, [path, load, onSaved]);

  const startSection = (i: number) => { if (!doc) return; setRawMode(false); setEditing(i); setDraft(doc.sections[i].content); };
  const saveSection = async () => {
    if (!file || !doc || editing === null) return;
    const s = doc.sections[editing];
    if (draft.trim() === s.content.trim()) { setEditing(null); return; }
    if (await persist(replaceSection(file.raw, s, draft))) setEditing(null);
  };
  const startRaw = () => { if (!file) return; setEditing(null); setRawMode(true); setDraft(file.raw); };
  const saveRaw = async () => {
    if (!file) return;
    if (draft === file.raw) { setRawMode(false); return; }
    if (await persist(draft)) setRawMode(false);
  };

  React.useEffect(() => {
    if (!rawMode && editing === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void (rawMode ? saveRaw() : saveSection()); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!file || !doc) {
    return (
      <div className={cn("bg-card rounded-xl border p-6", className)}>
        <Skeleton className="h-6 w-40" /><Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-6 grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      </div>
    );
  }

  const shownTitle = title ?? (doc.title || String(file.fm.title ?? path));

  return (
    <div className={cn(bare ? "text-card-foreground" : "bg-card text-card-foreground overflow-hidden rounded-xl border shadow-xs", className)}>
      {/* 标题栏 */}
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", bare ? "pb-2" : "border-b px-5 py-3 md:px-6")}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {leading}
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h3 className={cn("leading-tight font-semibold tracking-tight", bare ? "text-sm" : "text-base")}>{shownTitle}</h3>
              {description && <span className="text-muted-foreground truncate text-sm">{description}</span>}
            </div>
            {(meta || updated || !file.exists) && (
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {meta}
                {updated && <span>更新于 {updated}</span>}
                {!file.exists && <span className="text-amber-600">还没有这个文件，保存后会自动创建</span>}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {actions}
          {file.exists && (
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => setShowHistory(true)} title="历史版本"><HistoryIcon /></Button>
          )}
          {rawMode ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setRawMode(false)} disabled={saving}>取消</Button>
              <Button size="sm" onClick={saveRaw} disabled={saving || draft === file.raw}><CheckIcon />{saving ? "保存中" : "保存"}</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={startRaw}><FileTextIcon />编辑全文</Button>
          )}
        </div>
      </div>

      <HistoryDialog path={path} open={showHistory} onOpenChange={setShowHistory} onRestored={() => void load()} />

      {banner && !rawMode && <div className="border-b px-5 py-4 md:px-6">{banner}</div>}

      {rawMode ? (
        <div className={bare ? "pt-1" : "p-4 md:p-5"}>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[60vh] font-mono text-[13px] leading-6 field-sizing-fixed" spellCheck={false} autoFocus />
          <p className="text-muted-foreground mt-2 text-xs">直接编辑 Markdown 原文（含 frontmatter）。Ctrl+S 保存。</p>
        </div>
      ) : (
        <div className={bare ? "" : "px-5 py-4 md:px-6"}>
          {doc.intro && (
            <div className="bg-muted/50 text-muted-foreground mb-5 rounded-lg px-4 py-3 text-sm [&_blockquote]:m-0 [&_blockquote]:border-0 [&_blockquote]:p-0 [&_p]:m-0">
              <Markdown>{doc.intro}</Markdown>
            </div>
          )}
          {total === 0 ? (
            <div className="text-sm">
              {isBlank(file.body.replace(/^#.*$/gm, "")) ? (
                <button onClick={startRaw} className="text-muted-foreground hover:border-foreground/30 hover:text-foreground flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-10 transition-colors"><PlusIcon className="size-4" />开始填写</button>
              ) : <Markdown>{file.body}</Markdown>}
            </div>
          ) : (
            <div className={cn("grid", bare ? "gap-x-8 gap-y-1" : "gap-2.5")}>
              {doc.sections.map((s, i) => {
                const empty = isBlank(s.content);
                const isEditing = editing === i;
                const editor = (
                  <div className="grid gap-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={s.hint || `写点关于「${s.title}」的内容…`}
                      className="bg-background min-h-28 text-sm leading-6"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveSection(); }
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground mr-auto text-xs">支持 Markdown · Ctrl+Enter 保存 · Esc 取消</span>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={saving}><XIcon />取消</Button>
                      <Button size="sm" onClick={saveSection} disabled={saving}><CheckIcon />{saving ? "保存中" : "保存"}</Button>
                    </div>
                  </div>
                );
                const emptyBtn = (
                  <button
                    onClick={() => startSection(i)}
                    className="text-muted-foreground hover:border-foreground/25 hover:bg-muted/40 hover:text-foreground flex w-full flex-1 items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm transition-colors"
                  >
                    <PlusIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{s.hint || "点击填写"}</span>
                  </button>
                );

                if (!bare) {
                  // 卡片式：每个小节一张卡片，单列排列
                  return (
                    <section key={`${s.title}-${i}`} className={cn("group flex flex-col gap-2 rounded-xl border px-4 py-3.5 transition-colors", empty ? "bg-transparent" : "bg-muted/25 hover:bg-muted/40", isEditing && "bg-card")}>
                      <div className="flex items-center gap-2">
                        <span className={cn("size-1.5 shrink-0 rounded-full", empty ? "bg-muted-foreground/30" : accentClass)} />
                        <h4 className="text-sm font-medium">{s.title}</h4>
                        {!empty && !isEditing && (
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground -my-1 ml-auto size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5"
                            onClick={() => startSection(i)} aria-label={`编辑${s.title}`}><PencilIcon /></Button>
                        )}
                      </div>
                      {isEditing ? editor : empty ? emptyBtn : (
                        <Markdown className="text-foreground/80 text-[13px] leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_li]:my-0 [&_li]:marker:text-muted-foreground/50 [&_ol]:my-0 [&_ol]:pl-4 [&_p]:my-1 [&_strong]:text-foreground [&_ul]:my-0 [&_ul]:pl-4">{s.content}</Markdown>
                      )}
                    </section>
                  );
                }

                return (
                  <section key={`${s.title}-${i}`} className="group grid gap-x-6 gap-y-2 border-b border-dashed py-3.5 last:border-b-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("size-1.5 shrink-0 rounded-full", empty ? "bg-muted-foreground/30" : accentClass)} />
                      <h4 className="text-sm font-medium">{s.title}</h4>
                    </div>
                    <div className="min-w-0">
                      {isEditing ? editor : empty ? emptyBtn : (
                        <div className="relative -mx-3 rounded-lg py-2 pr-12 pl-3 transition-colors hover:bg-muted/40">
                          <Markdown className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{s.content}</Markdown>
                          <Button
                            variant="outline" size="icon-sm"
                            className="bg-background text-muted-foreground hover:text-foreground absolute top-2 right-2 size-7 opacity-0 shadow-xs transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5"
                            onClick={() => startSection(i)} aria-label={`编辑${s.title}`}
                          ><PencilIcon /></Button>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
