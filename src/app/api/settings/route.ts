import { handler, body } from "@/lib/api";
import { getSettings, saveSettings, keyStatus, setApiKey, type Settings, type RoleName } from "@/lib/core/settings";
import { testRole } from "@/lib/llm/client";
import { usageSummary } from "@/lib/agent/trace";
import { VAULT_DIR, APP_DIR } from "@/lib/core/paths";
import { embedPending } from "@/lib/index/embed";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const s = getSettings();
  return {
    settings: s,
    keys: keyStatus(s),
    usage: usageSummary(),
    paths: { vault: VAULT_DIR, app: APP_DIR },
  };
});

export const PUT = handler(async (req: Request) => {
  const b = await body<Settings>(req);
  const before = getSettings();
  const saved = saveSettings(b);
  const e1 = before.roles.embedding, e2 = saved.roles.embedding;
  if (e1.provider !== e2.provider || e1.model !== e2.model || e1.enabled !== e2.enabled) void embedPending().catch(() => {});
  return { ok: true, settings: saved };
});

/** { action: "setKey", provider, key } | { action: "test", role } */
export const POST = handler(async (req: Request) => {
  const b = await body<{ action: string; provider?: string; key?: string; role?: RoleName }>(req);
  if (b.action === "setKey" && b.provider) {
    setApiKey(b.provider, (b.key ?? "").trim());
    return { ok: true, keys: keyStatus(getSettings()) };
  }
  if (b.action === "test" && b.role) {
    try { return await testRole(b.role); } catch (e) { return { ok: false, info: e instanceof Error ? e.message : String(e) }; }
  }
  throw new Error("未知操作");
});
