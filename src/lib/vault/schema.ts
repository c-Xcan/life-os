import * as z from "zod/v4";

/**
 * vault 内每个 md 文件的 frontmatter 规范。
 * 未知字段一律保留（passthrough），保证人和任意 AI 都能自由扩展。
 */
export const NOTE_TYPES = [
  "readme", "profile", "now", "domain", "journal", "plan", "review",
  "facts", "preferences", "skill", "session", "export", "note",
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const DOMAINS = ["learning", "work", "health", "finance", "relationships", "life"] as const;
export type Domain = (typeof DOMAINS)[number];
export const DOMAIN_LABEL: Record<string, string> = {
  learning: "学习", work: "工作", health: "健康", finance: "财务", relationships: "关系", life: "生活",
};

const base = {
  type: z.enum(NOTE_TYPES).default("note"),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  private: z.boolean().optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
};

/** 日记里可以被统计的数字指标 */
export const JOURNAL_METRICS = {
  mood: { label: "心情", unit: "/5", min: 1, max: 5 },
  energy: { label: "精力", unit: "/5", min: 1, max: 5 },
  sleep: { label: "睡眠", unit: "h", min: 0, max: 14 },
  study_min: { label: "学习", unit: "min", min: 0, max: 900 },
  work_min: { label: "工作", unit: "min", min: 0, max: 960 },
  exercise_min: { label: "运动", unit: "min", min: 0, max: 600 },
  weight: { label: "体重", unit: "kg", min: 20, max: 300 },
} as const;
export type MetricKey = keyof typeof JOURNAL_METRICS;

export const JournalFM = z.looseObject({
  ...base,
  type: z.literal("journal"),
  date: z.string(),
  mood: z.number().min(1).max(5).optional(),
  energy: z.number().min(1).max(5).optional(),
  sleep: z.number().optional(),
  study_min: z.number().optional(),
  work_min: z.number().optional(),
  exercise_min: z.number().optional(),
  weight: z.number().optional(),
});

export const PLAN_STATUS = ["todo", "doing", "done", "dropped"] as const;
export const PlanFM = z.looseObject({
  ...base,
  type: z.literal("plan"),
  title: z.string(),
  domain: z.string().optional(),
  status: z.enum(PLAN_STATUS).default("todo"),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  horizon: z.enum(["year", "quarter", "month", "week"]).optional(),
  due: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
});
export type PlanFMType = z.infer<typeof PlanFM>;

/** 语义记忆：一条关于你的事实，带时间维度 */
export const FACT_STATUS = ["active", "superseded", "invalid"] as const;
export const FactSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: z.enum(FACT_STATUS).default("active"),
  confidence: z.number().min(0).max(1).default(0.8),
  importance: z.number().int().min(1).max(5).default(3),
  valid_from: z.string(),
  valid_to: z.string().optional(),
  source: z.string().optional(),
  supersedes: z.string().optional(),
});
export type Fact = z.infer<typeof FactSchema>;

export const FactsFM = z.looseObject({
  ...base,
  type: z.literal("facts"),
  domain: z.string(),
  facts: z.array(FactSchema).default([]),
});

export const GenericFM = z.looseObject(base);
