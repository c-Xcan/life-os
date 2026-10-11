import { NextResponse } from "next/server";
import { ensureRuntime } from "./runtime";

/** API 路由统一包装：确保运行时已初始化，异常转为 JSON 错误 */
export function handler<T extends unknown[]>(fn: (...args: T) => Promise<unknown> | unknown) {
  return async (...args: T) => {
    try {
      await ensureRuntime();
      const r = await fn(...args);
      if (r instanceof Response) return r;
      return NextResponse.json(r ?? { ok: true });
    } catch (e) {
      console.error("[life-os] API 错误：", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}
