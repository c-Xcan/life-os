/** 轻量 RSS 2.0 / Atom / RDF 解析：只取标题、链接、时间、摘要，不做全文抓取 */
export interface FeedItem { title: string; url: string; publishedAt: string | null; summary: string; author: string | null }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function stripTags(html: string) {
  // 先解码一次得到 HTML，去掉标签后再解码一次（处理 type="html" 的双重转义）
  return decode(
    decode(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/?[a-z][^>]*>/gi, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, ...names: string[]) {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(block);
    if (m && m[1].trim()) return m[1];
  }
  return "";
}

function atomLink(block: string) {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) ?? links.find((a) => !/rel=/i.test(a)) ?? links[0];
  return pick ? /href=["']([^"']+)["']/i.exec(pick)?.[1] ?? "" : "";
}

function toIso(s: string) {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseFeed(xml: string, base: string): FeedItem[] {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const title = stripTags(tag(b, "title"));
    let url = isAtom ? atomLink(b) : decode(tag(b, "link")).trim() || decode(tag(b, "guid")).trim();
    if (!url && !isAtom) url = atomLink(b);
    if (!title || !url) continue;
    try { url = new URL(url, base).toString(); } catch { continue; }
    let summary = stripTags(tag(b, "description", "summary", "content:encoded", "content")).slice(0, 400);
    // 只有“点击查看原文 / Read more”之类的占位摘要，当作没有摘要
    if (/^(点击查看原文|阅读原文|查看原文|read more|continue reading)\s*[>›»]*$/i.test(summary)) summary = "";
    out.push({
      title,
      url,
      publishedAt: toIso(decode(tag(b, "pubDate", "published", "updated", "dc:date"))),
      summary,
      author: stripTags(tag(b, "dc:creator", "author")) || null,
    });
  }
  return out;
}

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (LifeOS news reader)", accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Error("不是 RSS / Atom 格式");
  return parseFeed(xml, res.url || url);
}
