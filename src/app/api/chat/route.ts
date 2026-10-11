import { ensureRuntime } from "@/lib/runtime";
import { runAgent, type AgentEvent, type RunInput } from "@/lib/agent/loop";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 流式对话：返回 NDJSON，每行一个 AgentEvent */
export async function POST(req: Request) {
  await ensureRuntime();
  const input = (await req.json().catch(() => ({}))) as RunInput;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(e) + "\n")); } catch { /* 客户端已断开 */ }
      };
      try {
        await runAgent({ ...input, signal: req.signal }, emit);
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
        emit({ type: "done" });
      } finally {
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
