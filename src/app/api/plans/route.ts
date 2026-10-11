import { handler, body } from "@/lib/api";
import { listPlans, upsertPlan, type PlanInput } from "@/lib/vault/services";

export const dynamic = "force-dynamic";

export const GET = handler(() => ({ plans: listPlans() }));

export const POST = handler(async (req: Request) => {
  const b = await body<PlanInput>(req);
  return { ok: true, ...upsertPlan(b) };
});
