import { spawn } from "node:child_process";
import { handler, body } from "@/lib/api";
import { VAULT_DIR, APP_DIR } from "@/lib/core/paths";

export const dynamic = "force-dynamic";

/** 在系统文件管理器中打开 vault（默认）或运行数据文件夹：{ target?: "vault" | "app" } */
export const POST = handler(async (req: Request) => {
  const { target } = await body<{ target?: string }>(req);
  const dir = target === "app" ? APP_DIR : VAULT_DIR;
  const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn(cmd, [dir], { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", () => {});
    child.unref();
  } catch { /* 打不开时把路径返回给界面显示 */ }
  return { path: dir };
});
