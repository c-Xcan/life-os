/* 日记页共用：小节解析、照片小节、心情定义、日期工具 */
import { AnnoyedIcon, FrownIcon, LaughIcon, MehIcon, SmileIcon } from "lucide-react";

export type Journal = { date: string; exists: boolean; fm: Record<string, unknown>; body: string };

export const MOOD = [
  null,
  { icon: FrownIcon, label: "很差", bg: "bg-rose-400", soft: "bg-rose-400/15 text-rose-600 dark:text-rose-400" },
  { icon: AnnoyedIcon, label: "低落", bg: "bg-orange-400", soft: "bg-orange-400/15 text-orange-600 dark:text-orange-400" },
  { icon: MehIcon, label: "一般", bg: "bg-amber-300", soft: "bg-amber-400/20 text-amber-700 dark:text-amber-300" },
  { icon: SmileIcon, label: "不错", bg: "bg-lime-400", soft: "bg-lime-400/20 text-lime-700 dark:text-lime-400" },
  { icon: LaughIcon, label: "很好", bg: "bg-emerald-500", soft: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
] as const;
export const ENERGY_LABEL = ["", "耗尽", "疲惫", "一般", "充沛", "满格"];

/* ---------- 正文按 ## 小节拆分（基于行号，保证未改动部分原样保留） ---------- */
export type Sec = { title: string; content: string; hint: string; start: number; end: number };
export function parseSections(body: string) {
  const lines = body.split("\n");
  const secs: Sec[] = [];
  let cur: Sec | null = null;
  const close = (end: number) => {
    if (!cur) return;
    const raw = lines.slice(cur.start + 1, end).join("\n");
    cur.hint = /<!--([\s\S]*?)-->/.exec(raw)?.[1].trim() ?? "";
    cur.content = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
    cur.end = end;
    secs.push(cur);
    cur = null;
  };
  lines.forEach((l, i) => {
    if (/^#\s/.test(l)) close(i);
    else if (/^##\s/.test(l)) { close(i); cur = { title: l.replace(/^##\s+/, "").trim(), content: "", hint: "", start: i, end: i }; }
  });
  close(lines.length);
  return secs;
}
export function setSectionContent(body: string, idx: number, content: string) {
  const s = parseSections(body)[idx];
  if (!s) return body;
  const lines = body.split("\n");
  const next = content.trim() ? content.replace(/\s+$/, "") : (s.hint ? `<!-- ${s.hint} -->` : "");
  const tail = lines.slice(s.end);
  return [...lines.slice(0, s.start + 1), "", ...(next ? [next] : []), ...(tail.length ? [""] : []), ...tail].join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ---------- 照片：保存在正文末尾的「## 照片」小节里，Obsidian 也能直接显示 ---------- */
export const PHOTO_TITLE = "照片";
export const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
export type JPhoto = { src: string; alt: string };
export function getPhotos(body: string): JPhoto[] {
  const sec = parseSections(body).find((x) => x.title === PHOTO_TITLE);
  return sec ? [...sec.content.matchAll(IMG_RE)].map((m) => ({ alt: m[1], src: m[2] })) : [];
}
export function setPhotos(body: string, photos: JPhoto[]) {
  const idx = parseSections(body).findIndex((x) => x.title === PHOTO_TITLE);
  const content = photos.map((p) => `![${p.alt.replace(/[\[\]\n]/g, " ")}](${p.src})`).join("\n");
  if (idx >= 0) {
    if (photos.length) return setSectionContent(body, idx, content);
    const sec = parseSections(body)[idx];
    const lines = body.split("\n");
    return [...lines.slice(0, sec.start), ...lines.slice(sec.end)].join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
  }
  if (!photos.length) return body;
  return `${body.replace(/\s+$/, "")}\n\n## ${PHOTO_TITLE}\n\n${content}\n`;
}

/** 列表卡片用：按小节取正文（不含照片、提示注释） */
export function digest(body: string) {
  return parseSections(body)
    .filter((s) => s.title !== PHOTO_TITLE && s.content)
    .map((s) => ({ title: s.title, text: s.content.replace(IMG_RE, "").split("\n").map((l) => l.trim().replace(/^[-*+]\s+|^\d+\.\s+/, "").replace(/\*\*|__|`/g, "")).filter(Boolean).join("；") }))
    .filter((s) => s.text);
}
export function charCount(body: string) {
  return body.replace(/^#.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "").replace(IMG_RE, "").replace(/\s/g, "").length;
}

/* ---------- 日期 ---------- */
export function shift(d: string, n: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export function weekStart(d: string) {
  return shift(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
}
export function weekday(d: string, short = false) {
  return (short ? "周" : "星期") + "日一二三四五六"[new Date(d + "T00:00:00Z").getUTCDay()];
}
