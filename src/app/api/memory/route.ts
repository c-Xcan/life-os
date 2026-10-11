import { handler, body } from "@/lib/api";
import { listProposals } from "@/lib/memory/inbox";
import { applyProposal } from "@/lib/memory/pipeline";
import { listFacts } from "@/lib/index/search";
import { readFacts, writeFacts } from "@/lib/vault/services";
import { dateStr } from "@/lib/core/util";

export const dynamic = "force-dynamic";

export const GET = handler(() => ({
  inbox: listProposals("pending"),
  done: listProposals("done").slice(0, 20),
  facts: listFacts(),
}));

/** 审核：{ id, decisions, fileDecision }；或直接作废一条事实：{ invalidate: factId, domain } */
export const POST = handler(async (req: Request) => {
  const b = await body<{
    id?: string;
    decisions?: Record<number, { decision: "approved" | "rejected"; text?: string }>;
    fileDecision?: { decision: "approved" | "rejected"; after?: string };
    invalidate?: string;
    domain?: string;
  }>(req);
  if (b.invalidate && b.domain) {
    const facts = readFacts(b.domain);
    const f = facts.find((x) => x.id === b.invalidate);
    if (f) { f.status = "invalid"; f.valid_to = dateStr(); writeFacts(b.domain, facts, { reason: `invalidate ${f.id}` }); }
    return { ok: true };
  }
  if (!b.id) throw new Error("缺少 id");
  return { ok: true, proposal: applyProposal(b.id, b.decisions ?? {}, b.fileDecision) };
});
