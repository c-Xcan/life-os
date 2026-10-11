import { handler, body } from "@/lib/api";
import { generateBrief, getBriefCached } from "@/lib/news/brief";
import { canTranslate } from "@/lib/news/translate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET：返回速览（过期或推荐变化较大时重新生成）；?cached=1 只读缓存 */
export const GET = handler(async (req: Request) => {
  if (!canTranslate()) return { brief: null, available: false };
  if (new URL(req.url).searchParams.get("cached")) return { brief: getBriefCached(), available: true };
  return { brief: await generateBrief(), available: true };
});

/** POST：强制重新生成 */
export const POST = handler(async (req: Request) => {
  await body(req);
  return { brief: await generateBrief(true), available: true };
});
