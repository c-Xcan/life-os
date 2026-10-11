import fs from "node:fs";
import * as z from "zod/v4";
import { appPath, ensureDir, APP_DIR } from "./paths";

/* ---------- 模型服务商 ---------- */
export const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** OpenAI 兼容接口地址（不含 /chat/completions） */
  baseURL: z.string(),
  /** deepseek：支持 thinking 开关并需要回传 reasoning_content；openai：标准兼容接口 */
  kind: z.enum(["deepseek", "openai"]).default("openai"),
  /** 是否为本机模型（本地模型可以看到 private 内容） */
  local: z.boolean().default(false),
});
export type Provider = z.infer<typeof ProviderSchema>;

export const RoleSchema = z.object({
  provider: z.string(),
  model: z.string(),
  thinking: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type RoleConfig = z.infer<typeof RoleSchema>;
export type RoleName = "chat" | "background" | "embedding" | "private" | "vision";

export const SettingsSchema = z.object({
  user: z.object({
    name: z.string().default(""),
    timezone: z.string().default("Asia/Shanghai"),
  }).default({ name: "", timezone: "Asia/Shanghai" }),
  providers: z.array(ProviderSchema),
  roles: z.object({
    chat: RoleSchema,
    background: RoleSchema,
    embedding: RoleSchema,
    private: RoleSchema,
    vision: RoleSchema,
  }),
  agent: z.object({
    requireApprovalForWrites: z.boolean().default(true),
    maxSteps: z.number().int().min(1).max(30).default(10),
    contextBudgetTokens: z.number().int().default(24000),
    autoExtractMemory: z.boolean().default(true),
  }),
  privacy: z.object({
    /** 是否允许把 private: true 的内容发给云端模型 */
    sendPrivateToCloud: z.boolean().default(false),
  }),
  scheduler: z.object({
    enabled: z.boolean().default(true),
    /** 每天几点之后运行日常整理（抽取记忆、刷新 now.md 建议） */
    dailyHour: z.number().int().min(0).max(23).default(21),
    /** 周几生成周复盘草稿，0 = 周日 */
    weeklyReviewDay: z.number().int().min(0).max(6).default(0),
  }),
  /** 内置历史版本（替代 git） */
  history: z.object({
    enabled: z.boolean().default(true),
    /** 历史版本保留天数（每个文件最近 3 个版本始终保留） */
    keepDays: z.number().int().min(7).max(3650).default(90),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  user: { name: "", timezone: "Asia/Shanghai" },
  providers: [
    { id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com", kind: "deepseek", local: false },
    { id: "ollama", name: "Ollama（本机）", baseURL: "http://localhost:11434/v1", kind: "openai", local: true },
  ],
  roles: {
    chat: { provider: "deepseek", model: "deepseek-v4-pro", thinking: true, enabled: true },
    background: { provider: "deepseek", model: "deepseek-flash", thinking: false, enabled: true },
    embedding: { provider: "ollama", model: "bge-m3", thinking: false, enabled: true },
    private: { provider: "ollama", model: "qwen3:8b", thinking: false, enabled: false },
    vision: { provider: "deepseek", model: "deepseek-v4-flash-vision-exp", thinking: false, enabled: true },
  },
  agent: { requireApprovalForWrites: true, maxSteps: 10, contextBudgetTokens: 24000, autoExtractMemory: true },
  privacy: { sendPrivateToCloud: false },
  scheduler: { enabled: true, dailyHour: 21, weeklyReviewDay: 0 },
  history: { enabled: true, keepDays: 90 },
};

const SETTINGS_FILE = () => appPath("settings.json");
const SECRETS_FILE = () => appPath("secrets.json");

export function getSettings(): Settings {
  ensureDir(APP_DIR);
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
    const merged = { ...DEFAULT_SETTINGS, ...raw };
    for (const k of ["user", "agent", "privacy", "scheduler", "history"] as const) {
      (merged as Record<string, unknown>)[k] = { ...DEFAULT_SETTINGS[k], ...(raw?.[k] ?? {}) };
    }
    merged.roles = { ...DEFAULT_SETTINGS.roles, ...(raw?.roles ?? {}) };
    return SettingsSchema.parse(merged);
  } catch {
    saveSettings(DEFAULT_SETTINGS);
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings) {
  ensureDir(APP_DIR);
  const parsed = SettingsSchema.parse(s);
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(parsed, null, 2), "utf8");
  return parsed;
}

/* ---------- 密钥：只存本机 .app/secrets.json，在「设置」页面填写 ---------- */
function readSecrets(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_FILE(), "utf8"));
  } catch {
    return {};
  }
}

export function getApiKey(provider: Provider): string | undefined {
  const s = readSecrets();
  return s[provider.id] || undefined;
}

export function setApiKey(providerId: string, key: string) {
  ensureDir(APP_DIR);
  const s = readSecrets();
  if (key) s[providerId] = key;
  else delete s[providerId];
  fs.writeFileSync(SECRETS_FILE(), JSON.stringify(s, null, 2), "utf8");
}

/** 给前端看的状态：只告诉有没有 key，不返回 key 本身 */
export function keyStatus(settings: Settings) {
  return Object.fromEntries(settings.providers.map((p) => [p.id, Boolean(getApiKey(p))]));
}

export function getProvider(settings: Settings, id: string): Provider {
  const p = settings.providers.find((x) => x.id === id);
  if (!p) throw new Error(`未找到模型服务商：${id}`);
  return p;
}
