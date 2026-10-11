import fs from "node:fs";
import { appPath, ensureDir, APP_DIR } from "../core/paths";

/**
 * 资讯模块的配置：信源（RSS / Atom）与兴趣词。
 * 默认信源写在代码里；用户的增删改保存在 .app/news.json（不进 vault，属于本机运行配置）。
 */
export const NEWS_CATEGORIES = [
  { key: "ai", label: "AI" },
  { key: "dev", label: "开发" },
  { key: "tech", label: "科技" },
  { key: "finance", label: "财经" },
  { key: "other", label: "其他" },
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number]["key"];

export interface NewsSource {
  id: string;
  name: string;
  url: string; // RSS / Atom 地址
  category: NewsCategory;
  enabled: boolean;
  builtin?: boolean;
}

const s = (id: string, name: string, url: string, category: NewsCategory): NewsSource => ({ id, name, url, category, enabled: true, builtin: true });

export const DEFAULT_SOURCES: NewsSource[] = [
  // AI
  s("openai", "OpenAI News", "https://openai.com/news/rss.xml", "ai"),
  s("huggingface", "Hugging Face Blog", "https://huggingface.co/blog/feed.xml", "ai"),
  s("simonwillison", "Simon Willison", "https://simonwillison.net/atom/everything/", "ai"),
  s("the-decoder", "The Decoder", "https://the-decoder.com/feed/", "ai"),
  s("latent-space", "Latent Space", "https://www.latent.space/feed", "ai"),
  s("mit-tr-ai", "MIT Technology Review · AI", "https://www.technologyreview.com/topic/artificial-intelligence/feed", "ai"),
  // 开发
  s("hn", "Hacker News 首页", "https://hnrss.org/frontpage", "dev"),
  s("github-blog", "GitHub Blog", "https://github.blog/feed/", "dev"),
  s("react", "React Blog", "https://react.dev/rss.xml", "dev"),
  s("vercel", "Vercel Blog", "https://vercel.com/atom", "dev"),
  s("smashing", "Smashing Magazine", "https://www.smashingmagazine.com/feed/", "dev"),
  s("ruanyifeng", "阮一峰的网络日志", "https://www.ruanyifeng.com/blog/atom.xml", "dev"),
  s("infoq-cn", "InfoQ 中文", "https://www.infoq.cn/feed", "dev"),
  // 科技
  s("sspai", "少数派", "https://sspai.com/feed", "tech"),
  s("36kr", "36氪", "https://36kr.com/feed", "tech"),
  s("ithome", "IT之家", "https://www.ithome.com/rss/", "tech"),
  s("ifanr", "爱范儿", "https://www.ifanr.com/feed", "tech"),
  s("verge", "The Verge", "https://www.theverge.com/rss/index.xml", "tech"),
  s("techcrunch", "TechCrunch", "https://techcrunch.com/feed/", "tech"),
  // 财经
  s("ftchinese", "FT中文网", "https://www.ftchinese.com/rss/news", "finance"),
  s("bbc-business", "BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "finance"),
  s("cnbc-top", "CNBC Top News", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", "finance"),
];

export interface NewsConfig {
  sources: NewsSource[];
  /** 手动添加的兴趣词 */
  keywords: string[];
  /** 不想要的自动兴趣（主题 key 或词） */
  muted: string[];
  /** 用模型把外文标题和摘要翻译成中文 */
  translate: boolean;
}

const FILE = () => appPath("news.json");

export function readNewsConfig(): NewsConfig {
  let saved: Partial<NewsConfig> & { overrides?: Record<string, Partial<NewsSource>> } = {};
  try { saved = JSON.parse(fs.readFileSync(FILE(), "utf8")); } catch { /* 首次使用 */ }
  // 默认信源 + 用户自定义；内置信源只保存开关状态
  const custom = (saved.sources ?? []).filter((x) => !x.builtin);
  const overrides = saved.overrides ?? {};
  const removed = new Set((saved as { removed?: string[] }).removed ?? []);
  const builtin = DEFAULT_SOURCES.filter((x) => !removed.has(x.id)).map((x) => ({ ...x, ...overrides[x.id] }));
  return { sources: [...builtin, ...custom], keywords: saved.keywords ?? [], muted: saved.muted ?? [], translate: saved.translate ?? true };
}

export function writeNewsConfig(c: NewsConfig) {
  ensureDir(APP_DIR);
  const overrides: Record<string, Partial<NewsSource>> = {};
  for (const x of c.sources.filter((x) => x.builtin)) {
    const d = DEFAULT_SOURCES.find((y) => y.id === x.id);
    if (d && (d.enabled !== x.enabled || d.category !== x.category)) overrides[x.id] = { enabled: x.enabled, category: x.category };
  }
  const removed = DEFAULT_SOURCES.filter((d) => !c.sources.some((x) => x.id === d.id)).map((d) => d.id);
  fs.writeFileSync(FILE(), JSON.stringify({ sources: c.sources.filter((x) => !x.builtin), overrides, removed, keywords: c.keywords, muted: c.muted, translate: c.translate }, null, 2));
}
