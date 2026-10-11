import { readNote, writeNote, deleteNote, listMarkdown, exists, P } from "./fs";
import { DOMAINS, DOMAIN_LABEL } from "./schema";

/**
 * 领域档案：domains/<key>.md 一个文件一个领域。
 * 内置 6 个领域，用户可以新增自定义领域；元信息（名称、图标、颜色、简介）存在 frontmatter 里。
 */
export const DOMAIN_SECTIONS: { title: string; hint: string }[] = [
  { title: "现状", hint: "在做什么、进展如何、当前的节奏" },
  { title: "目标", hint: "长期目标和本阶段目标" },
  { title: "挑战", hint: "困难、瓶颈、反复出现的问题" },
  { title: "资源与方法", hint: "在用的工具、方法、可以求助的人" },
  { title: "记录", hint: "值得长期保留的要点，按日期追加" },
];

const BUILTIN_META: Record<string, { icon: string; color: string; description: string }> = {
  learning: { icon: "graduation-cap", color: "blue", description: "课程、考试、技能成长" },
  work: { icon: "briefcase", color: "violet", description: "职业、项目、工作节奏" },
  health: { icon: "heart-pulse", color: "emerald", description: "睡眠、运动、饮食、身心状态" },
  finance: { icon: "wallet", color: "amber", description: "收支、储蓄、投资与财务目标" },
  relationships: { icon: "users", color: "rose", description: "家人、朋友、伴侣与社交" },
  life: { icon: "house", color: "sky", description: "日常生活、兴趣与环境" },
};

export interface DomainInfo {
  key: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  builtin: boolean;
  path: string;
  order: number;
}

export const DOMAIN_KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function listDomains(): DomainInfo[] {
  const keys = new Set<string>(DOMAINS);
  for (const rel of listMarkdown("domains")) {
    const m = /^domains\/([^/]+)\.md$/.exec(rel);
    if (m) keys.add(m[1]);
  }
  const out: DomainInfo[] = [];
  for (const key of keys) {
    const builtin = (DOMAINS as readonly string[]).includes(key);
    const n = readNote(P.domain(key));
    const fm = n?.fm ?? {};
    const meta = BUILTIN_META[key];
    out.push({
      key,
      label: String(fm.title ?? DOMAIN_LABEL[key] ?? key),
      description: String(fm.description ?? meta?.description ?? ""),
      icon: String(fm.icon ?? meta?.icon ?? "sparkles"),
      color: String(fm.color ?? meta?.color ?? "slate"),
      builtin,
      path: P.domain(key),
      order: typeof fm.order === "number" ? fm.order : builtin ? (DOMAINS as readonly string[]).indexOf(key) : 100 + (n ? Math.floor(n.mtime / 1000) % 1e6 : 0),
    });
  }
  // 自定义领域按创建时间排在内置领域之后
  return out.sort((a, b) => a.order - b.order || String(a.key).localeCompare(b.key));
}

export function domainKeys() {
  return listDomains().map((d) => d.key);
}

export function domainLabels(): Record<string, string> {
  return Object.fromEntries(listDomains().map((d) => [d.key, d.label]));
}

/** 统计 Markdown 正文里 "## 小节" 的填写情况（去掉 HTML 注释占位后是否有内容） */
export function sectionCompletion(body: string) {
  const lines = body.split("\n");
  let total = 0;
  let filled = 0;
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    total++;
    if (cur.join("\n").replace(/<!--[\s\S]*?-->/g, "").trim()) filled++;
  };
  for (const l of lines) {
    if (/^##\s+/.test(l)) { flush(); cur = []; continue; }
    if (/^#\s+/.test(l)) { flush(); cur = null; continue; }
    if (cur) cur.push(l);
  }
  flush();
  return { filled, total };
}

export function createDomain(input: { key?: string; label: string; description?: string; icon?: string; color?: string }) {
  const label = input.label?.trim();
  if (!label) throw new Error("请填写领域名称");
  if (label.length > 20) throw new Error("领域名称最多 20 个字");
  const all = listDomains();
  if (all.some((d) => d.label === label)) throw new Error(`已经有名为「${label}」的领域了`);
  let key = (input.key ?? "").trim().toLowerCase();
  if (key) {
    if (!DOMAIN_KEY_RE.test(key)) throw new Error("标识只能使用小写字母、数字和短横线，且以字母或数字开头");
    if (all.some((d) => d.key === key) || exists(P.domain(key))) throw new Error(`标识「${key}」已被使用`);
  } else {
    const ascii = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
    let base = ascii && DOMAIN_KEY_RE.test(ascii) ? ascii : "custom";
    if (base === "custom") base = `custom-${Date.now().toString(36).slice(-4)}`;
    key = base;
    for (let i = 2; all.some((d) => d.key === key) || exists(P.domain(key)); i++) key = `${base}-${i}`;
  }
  const maxOrder = Math.max(99, ...all.map((d) => d.order));
  const fm: Record<string, unknown> = {
    type: "domain",
    domain: key,
    title: label,
    description: input.description?.trim() || undefined,
    icon: input.icon || "sparkles",
    color: input.color || "slate",
    order: Math.min(maxOrder, 1e6) + 1,
  };
  const body = [`# ${label}`, "", ...DOMAIN_SECTIONS.flatMap((s) => [`## ${s.title}`, "", `<!-- ${s.hint} -->`, ""])].join("\n");
  const rel = writeNote(P.domain(key), fm, body, { reason: `create domain ${key}` });
  return { key, path: rel };
}

export function deleteDomain(key: string) {
  if ((DOMAINS as readonly string[]).includes(key)) throw new Error("内置领域不能删除");
  if (!DOMAIN_KEY_RE.test(key) || !exists(P.domain(key))) throw new Error("领域不存在");
  deleteNote(P.domain(key), { reason: `delete domain ${key}` });
  return { ok: true };
}

/** 事实记忆文件里出现过的领域（可能包含已删除的自定义领域） */
export function factDomains(): string[] {
  return listMarkdown("memory/facts").map((p) => p.split("/").pop()!.replace(/\.md$/, "")).filter(Boolean);
}
