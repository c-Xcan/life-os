import * as z from "zod/v4";
import { chatJSON } from "../llm/client";
import { listFacts, search } from "../index/search";
import { domainKeys } from "../vault/domains";
import { readFacts, writeFacts, newFactId, findFact } from "../vault/services";
import { readNote, writeRaw } from "../vault/fs";
import { dateStr } from "../core/util";
import { saveProposal, getProposal, FactOpSchema, type Proposal } from "./inbox";
import { trace } from "../agent/trace";

const EXTRACT_SYSTEM = `你是一个"个人记忆管理器"。任务：从新材料中找出关于用户本人、值得长期记住的事实，并与已有记忆比对，输出记忆操作。

什么值得记：
- 身份、背景、处境的变化（换工作、开始备考、搬家、恋爱 / 分手）
- 目标、计划、截止日期
- 稳定的偏好、习惯、价值观
- 健康状况、长期困扰
- 重要的人际关系

什么不记：
- 一次性的琐事、当天情绪的小波动
- AI 自己说的话、建议
- 已有记忆里已经包含的信息

操作类型：
- add：全新的事实
- update：已有事实发生了变化（必须给出 fact_id，text 写新的完整表述）
- invalidate：已有事实不再成立（必须给出 fact_id）

规则：
- 每条 text 是一句完整、独立、带主语的陈述，例如"用户正在准备 2026 年 12 月的雅思考试，目标 7 分"。不要写"他""这个"等需要上下文才能看懂的词。
- domain 只能取 {{DOMAINS}}。
- confidence 表示材料对该事实的支持程度（0–1）；importance 表示对理解用户的重要性（1–5）。
- reason 用一句话说明依据。
- 没有值得记的内容就返回空数组。

输出格式：{"operations":[{"op":"add","fact_id":null,"domain":"learning","text":"...","confidence":0.9,"importance":4,"reason":"..."}]}`;

const ExtractOut = z.object({
  operations: z.array(z.object({
    op: z.enum(["add", "update", "invalidate"]),
    fact_id: z.string().nullish(),
    domain: z.string(),
    text: z.string().default(""),
    confidence: z.number().default(0.8),
    importance: z.number().default(3),
    reason: z.string().default(""),
  })).default([]),
});

/** 从一段材料中抽取记忆候选，写入审核箱。返回 proposal（没有候选时返回 null） */
export async function extractMemory(material: string, source: string, title = "新的记忆候选"): Promise<Proposal | null> {
  if (material.trim().length < 20) return null;
  // 只把相关的已有事实给模型看，控制上下文长度
  const all = listFacts({ status: "active" });
  let existing = all;
  if (all.length > 60) {
    const hits = await search(material.slice(0, 500), { types: ["facts"], limit: 6, includePrivate: true }).catch(() => []);
    const domains = new Set(hits.map((h) => h.path.split("/").pop()!.replace(/\.md$/, "")));
    existing = all.filter((f) => domains.has(f.domain)).slice(0, 80);
  }
  const existingText = existing.length
    ? existing.map((f) => `[${f.id}] (${f.domain}) ${f.text}`).join("\n")
    : "（暂无）";

  const out = await chatJSON({
    label: "memory.extract",
    system: EXTRACT_SYSTEM.replace("{{DOMAINS}}", domainKeys().join(" / ")),
    user: `今天是 ${dateStr()}。\n\n## 已有记忆\n${existingText}\n\n## 新材料（来源：${source}）\n${material.slice(0, 12000)}`,
    parse: (v) => ExtractOut.parse(v),
  });

  const validIds = new Set(all.map((f) => f.id));
  const keys = domainKeys();
  const ops = out.operations
    .filter((o) => o.op === "add" ? o.text.trim() : !!o.fact_id && validIds.has(o.fact_id))
    .map((o) => FactOpSchema.parse({
      ...o,
      fact_id: o.fact_id ?? undefined,
      domain: keys.includes(o.domain) ? o.domain : "life",
      confidence: Math.min(1, Math.max(0, o.confidence)),
      importance: Math.min(5, Math.max(1, Math.round(o.importance))),
    }));
  trace({ kind: "memory.extract", source, ops: ops.length });
  if (!ops.length) return null;
  return saveProposal({ kind: "facts", title, source, ops });
}

/** 应用审核结果：decisions = { 操作序号: 'approved' | 'rejected', 可附带修改后的 text } */
export function applyProposal(id: string, decisions: Record<number, { decision: "approved" | "rejected"; text?: string }>, fileDecision?: { decision: "approved" | "rejected"; after?: string }) {
  const p = getProposal(id);
  if (!p) throw new Error("审核项不存在");
  if (p.status === "done") return p;
  const today = dateStr();
  const source = p.source ?? `inbox/${p.id}`;
  let applied = 0;

  if (p.kind === "facts" && p.ops) {
    const byDomain = new Map<string, ReturnType<typeof readFacts>>();
    const load = (d: string) => { if (!byDomain.has(d)) byDomain.set(d, readFacts(d)); return byDomain.get(d)!; };

    p.ops.forEach((op, i) => {
      const d = decisions[i];
      if (!d) return;
      op.decision = d.decision;
      if (d.decision !== "approved") return;
      const text = (d.text ?? op.text).trim();
      if (op.op === "add") {
        load(op.domain).push({ id: newFactId(), text, status: "active", confidence: op.confidence, importance: op.importance, valid_from: today, source });
      } else if (op.fact_id) {
        const found = findFact(op.fact_id);
        if (!found) return;
        const list = load(found.domain);
        const old = list.find((f) => f.id === op.fact_id);
        if (!old || old.status !== "active") return;
        old.status = op.op === "update" ? "superseded" : "invalid";
        old.valid_to = today;
        if (op.op === "update") {
          const domain = op.domain || found.domain;
          load(domain).push({ id: newFactId(), text, status: "active", confidence: op.confidence, importance: op.importance, valid_from: today, source, supersedes: old.id });
        }
      }
      applied++;
    });
    for (const [domain, facts] of byDomain) writeFacts(domain, facts, { reason: `memory: ${p.title}`, actor: "system" });
  }

  if (p.kind === "file_update" && p.file && fileDecision) {
    if (fileDecision.decision === "approved") {
      writeRaw(p.file.path, fileDecision.after ?? p.file.after, { reason: `review: ${p.title}`, actor: "system" });
      applied++;
    }
  }

  p.status = "done";
  saveProposal(p);
  trace({ kind: "memory.apply", id, applied });
  return p;
}

/** 生成"整体改写某文件"的建议（例如刷新 now.md） */
export function proposeFileUpdate(path: string, after: string, title: string, source?: string) {
  const before = readNote(path)?.raw ?? "";
  if (before.trim() === after.trim()) return null;
  return saveProposal({ kind: "file_update", title, source, file: { path, before, after } });
}
