import { handler } from "@/lib/api";
import { backupInfo, readSafetyBackup } from "@/lib/backup/backup";

export const dynamic = "force-dynamic";

/** GET /api/backup/info：数据概况；?download=<文件名> 下载导入前的自动备份 */
export const GET = handler(async (req: Request) => {
  const name = new URL(req.url).searchParams.get("download");
  if (!name) return await backupInfo();
  const buf = readSafetyBackup(name);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
});
