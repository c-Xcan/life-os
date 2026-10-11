import { handler } from "@/lib/api";
import { listSessions } from "@/lib/agent/sessions";

export const dynamic = "force-dynamic";

export const GET = handler(() => ({ sessions: listSessions() }));
