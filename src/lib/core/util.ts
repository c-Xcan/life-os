import crypto from "node:crypto";

const TZ = () => process.env.TZ_OVERRIDE || "Asia/Shanghai";

/** 某时区下的 YYYY-MM-DD */
export function dateStr(d: Date = new Date(), tz = TZ()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function nowLocal(tz = TZ()) {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour, minute: Number(get("minute")), weekday: wd, iso: d.toISOString() };
}

export function addDays(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO 周：返回 { year, week, start(周一), end(周日) } */
export function isoWeek(date: string) {
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // 周一=0
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Monday = new Date(jan4);
  jan4Monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.round((monday.getTime() - jan4Monday.getTime()) / (7 * 864e5)) + 1;
  const start = monday.toISOString().slice(0, 10);
  return { year, week, label: `${year}-W${String(week).padStart(2, "0")}`, start, end: addDays(start, 6) };
}

export function shortId(n = 6) {
  return crypto.randomBytes(8).toString("base64url").replace(/[-_]/g, "").slice(0, n).toLowerCase();
}

export function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

/** 粗略 token 估算：中文约 0.6 token/字，其他约 4 字符/token */
export function estimateTokens(s: string) {
  let cjk = 0;
  for (const ch of s) if (/[　-鿿＀-￯]/.test(ch)) cjk++;
  return Math.ceil(cjk * 0.6 + (s.length - cjk) / 4);
}

export function truncateTokens(s: string, budget: number) {
  if (estimateTokens(s) <= budget) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (estimateTokens(s.slice(0, mid)) <= budget) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo) + "\n…（已截断）";
}

export function slugify(s: string) {
  const base = s.trim().toLowerCase()
    .replace(/[\s/\\:*?"<>|#]+/g, "-")
    .replace(/-+/g, "-").replace(/^-|-$/g, "");
  return base.slice(0, 60) || shortId();
}
