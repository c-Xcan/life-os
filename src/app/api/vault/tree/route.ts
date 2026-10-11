import { handler } from "@/lib/api";
import { tree } from "@/lib/vault/fs";
import { VAULT_DIR } from "@/lib/core/paths";

export const dynamic = "force-dynamic";

export const GET = handler(() => ({ root: VAULT_DIR, tree: tree() }));
