import fs from "node:fs";
import * as z from "zod/v4";
import { appPath, ensureDir } from "../core/paths";
import { shortId } from "../core/util";

/**
 * 审核箱：所有"改变长期记忆"的操作都先进这里，人确认后才写入 vault。
 * - facts：事实的新增 / 更新 / 作废
 * - file_update：对某个文件的整体改写建议（例如刷新 now.md）
 */
export const FactOpSchema = z.object({
  op: z.enum(["add", "update", "invalidate"]),
  fact_id: z.string().optional(),
  domain: z.string().default("life"),
  text: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.8),
  importance: z.number().int().min(1).max(5).default(3),
  reason: z.string().default(""),
  /** 审核状态 */
  decision: z.enum(["pending", "approved", "rejected"]).default("pending"),
});
export type FactOp = z.infer<typeof FactOpSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  created: z.string(),
  kind: z.enum(["facts", "file_update"]),
  title: z.string(),
  source: z.string().optional(),
  status: z.enum(["pending", "done"]).default("pending"),
  ops: z.array(FactOpSchema).optional(),
  file: z.object({ path: z.string(), before: z.string(), after: z.string() }).optional(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

const DIR = () => appPath("inbox");

export function listProposals(status: "pending" | "done" | "all" = "pending"): Proposal[] {
  ensureDir(DIR());
  return fs.readdirSync(DIR())
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return ProposalSchema.parse(JSON.parse(fs.readFileSync(`${DIR()}/${f}`, "utf8"))); } catch { return null; } })
    .filter((p): p is Proposal => !!p && (status === "all" || p.status === status))
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function getProposal(id: string): Proposal | null {
  try { return ProposalSchema.parse(JSON.parse(fs.readFileSync(`${DIR()}/${id}.json`, "utf8"))); } catch { return null; }
}

export function saveProposal(p: Omit<Proposal, "id" | "created" | "status"> & Partial<Pick<Proposal, "id" | "created" | "status">>) {
  ensureDir(DIR());
  const full = ProposalSchema.parse({ id: p.id ?? `${Date.now()}-${shortId(4)}`, created: p.created ?? new Date().toISOString(), status: p.status ?? "pending", ...p });
  fs.writeFileSync(`${DIR()}/${full.id}.json`, JSON.stringify(full, null, 2), "utf8");
  return full;
}

export function pendingCount() {
  return listProposals("pending").length;
}
