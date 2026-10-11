"use client";
import * as React from "react";
import { toast } from "sonner";

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && typeof data === "object" && "error" in data && data.error)) {
    const msg = (data as { error?: string }).error ?? `请求失败 (${res.status})`;
    toast.error(msg);
    throw new Error(msg);
  }
  return data as T;
}

/** 简单的数据获取 hook：返回 data / loading / reload */
export function useApi<T>(path: string | null) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(!!path);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const res = await fetch(path, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error ?? `请求失败 (${res.status})`);
      setData(j as T);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  React.useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load, setData };
}

export const METRIC_META: Record<string, { label: string; unit: string; min: number; max: number; step: number }> = {
  mood: { label: "心情", unit: "/5", min: 1, max: 5, step: 1 },
  energy: { label: "精力", unit: "/5", min: 1, max: 5, step: 1 },
  sleep: { label: "睡眠", unit: "h", min: 0, max: 12, step: 0.5 },
  study_min: { label: "学习", unit: "min", min: 0, max: 600, step: 10 },
  work_min: { label: "工作", unit: "min", min: 0, max: 720, step: 10 },
  exercise_min: { label: "运动", unit: "min", min: 0, max: 240, step: 5 },
};

/** 领域名称表。内置领域预置；自定义领域在 useDomains() 加载后合并进来 */
export const DOMAIN_LABEL: Record<string, string> = {
  learning: "学习", work: "工作", health: "健康", finance: "财务", relationships: "关系", life: "生活",
};

export type DomainInfo = { key: string; label: string; description: string; icon: string; color: string; builtin: boolean; path: string; order: number };

const BUILTIN_STYLE: Record<string, [string, string]> = {
  learning: ["graduation-cap", "blue"], work: ["briefcase", "violet"], health: ["heart-pulse", "emerald"],
  finance: ["wallet", "amber"], relationships: ["users", "rose"], life: ["house", "sky"],
};
const BUILTIN_DOMAINS: DomainInfo[] = Object.entries(DOMAIN_LABEL).map(([key, label], i) => ({
  key, label, description: "", icon: BUILTIN_STYLE[key]?.[0] ?? "sparkles", color: BUILTIN_STYLE[key]?.[1] ?? "slate", builtin: true, path: `domains/${key}.md`, order: i,
}));
let domainCache: DomainInfo[] | null = null;
let domainReq: Promise<DomainInfo[]> | null = null;
const domainSubs = new Set<(d: DomainInfo[]) => void>();

function setDomains(list: DomainInfo[]) {
  domainCache = list;
  const keys = new Set(list.map((d) => d.key));
  for (const k of Object.keys(DOMAIN_LABEL)) if (!keys.has(k) && !BUILTIN_DOMAINS.some((b) => b.key === k)) delete DOMAIN_LABEL[k];
  for (const d of list) DOMAIN_LABEL[d.key] = d.label;
  domainSubs.forEach((fn) => fn(list));
}

/** 重新拉取领域列表（新增 / 删除领域后调用），所有 useDomains() 会同步更新 */
export async function reloadDomains() {
  domainReq = fetch("/api/domains", { cache: "no-store" }).then((r) => r.json()).then((j: { domains?: DomainInfo[] }) => {
    const list = j.domains ?? BUILTIN_DOMAINS;
    setDomains(list);
    return list;
  }).catch(() => domainCache ?? BUILTIN_DOMAINS).finally(() => { domainReq = null; });
  return domainReq;
}

/** 领域列表（含自定义领域），带模块级缓存 */
export function useDomains() {
  const [list, setList] = React.useState<DomainInfo[]>(domainCache ?? BUILTIN_DOMAINS);
  React.useEffect(() => {
    domainSubs.add(setList);
    if (!domainCache && !domainReq) void reloadDomains();
    else if (domainCache) setList(domainCache);
    return () => { domainSubs.delete(setList); };
  }, []);
  const labels = React.useMemo(() => Object.fromEntries(list.map((d) => [d.key, d.label])) as Record<string, string>, [list]);
  return { domains: list, labels, reload: reloadDomains };
}

export function todayStr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
