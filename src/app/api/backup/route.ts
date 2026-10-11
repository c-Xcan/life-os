import { handler } from "@/lib/api";
import { buildBackup, restoreBackup, type IncomingFile } from "@/lib/backup/backup";
import { readZip } from "@/lib/backup/zip";

export const dynamic = "force-dynamic";

/** 下载完整备份：GET /api/backup?history=1&app=1 */
export const GET = handler(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const { zip, filename } = buildBackup({ includeHistory: q.get("history") !== "0", includeApp: q.get("app") !== "0" });
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
});

/**
 * 导入：multipart/form-data
 *   zip=<备份 zip>                         上传压缩包
 *   files=<File> + paths=<相对路径>（成对）  上传整个文件夹
 *   restoreSettings=1                      同时恢复设置
 */
export const POST = handler(async (req: Request) => {
  const fd = await req.formData();
  const restoreSettings = fd.get("restoreSettings") === "1";
  let files: IncomingFile[];
  const zip = fd.get("zip");
  if (zip && typeof zip !== "string") {
    files = readZip(Buffer.from(await zip.arrayBuffer()));
  } else {
    const blobs = fd.getAll("files");
    const paths = fd.getAll("paths").map(String);
    if (!blobs.length || blobs.length !== paths.length) throw new Error("没有收到要导入的文件");
    files = await Promise.all(blobs.map(async (b, i) => {
      if (typeof b === "string") throw new Error("文件格式不正确");
      return { path: paths[i], data: Buffer.from(await b.arrayBuffer()) };
    }));
  }
  return await restoreBackup(files, { restoreSettings });
});
