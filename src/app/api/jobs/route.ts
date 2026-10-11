import { handler, body } from "@/lib/api";
import { generateWeeklyReview, proposeNowRefresh, extractFromRecentJournals, schedulerState } from "@/lib/memory/consolidate";
import { reindexAll, indexStatus } from "@/lib/index/indexer";
import { embedPending, embedStatus } from "@/lib/index/embed";
import { getDb } from "@/lib/index/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handler(() => ({ scheduler: schedulerState(), index: indexStatus(), embed: embedStatus() }));

export const POST = handler(async (req: Request) => {
  const { job, date, full } = await body<{ job: string; date?: string; full?: boolean }>(req);
  switch (job) {
    case "weekly":
      return await generateWeeklyReview(date, true);
    case "now": {
      const p = await proposeNowRefresh();
      return { proposal: p?.id ?? null, message: p ? "已生成当前处境的更新建议，请到「记忆」审核" : "最近两周没有日记，或没有需要更新的内容" };
    }
    case "extract": {
      const p = await extractFromRecentJournals();
      return { proposal: p?.id ?? null, message: p ? "已从日记中发现新的记忆候选" : "没有发现新的记忆" };
    }
    case "reindex": {
      if (full) getDb().exec("DELETE FROM chunks; DELETE FROM metrics; DELETE FROM facts; DELETE FROM notes;");
      const r = reindexAll();
      void embedPending().catch(() => {});
      return { ...r, message: `索引完成：更新 ${r.indexed}，未变 ${r.unchanged}，删除 ${r.removed}` };
    }
    case "embed":
      await embedPending(16, 1000);
      return embedStatus();
    default:
      throw new Error(`未知任务：${job}`);
  }
});
