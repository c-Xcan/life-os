import { handler } from "@/lib/api";
import { loadSession, deleteSession } from "@/lib/agent/sessions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = loadSession(id);
  if (!s) throw new Error("会话不存在");
  return s;
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  deleteSession(id);
  return { ok: true };
});
