import fs from "node:fs";
import { appPath, ensureDir } from "../core/paths";
import { dateStr } from "../core/util";

/** 运行轨迹：每次模型调用 / 工具调用 / 后台任务追加一行 jsonl，方便排查和评估 */
export function trace(entry: Record<string, unknown>) {
  try {
    const dir = appPath("traces");
    ensureDir(dir);
    fs.appendFileSync(`${dir}/${dateStr()}.jsonl`, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch { /* 轨迹失败不影响主流程 */ }
}

export function readTraces(date = dateStr()) {
  try {
    return fs.readFileSync(appPath("traces", `${date}.jsonl`), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function usageSummary(date = dateStr()) {
  const rows = readTraces(date).filter((r) => r.kind === "llm");
  const sum = { calls: rows.length, prompt: 0, completion: 0, cacheHit: 0 };
  for (const r of rows) {
    sum.prompt += r.usage?.prompt_tokens ?? 0;
    sum.completion += r.usage?.completion_tokens ?? 0;
    sum.cacheHit += r.usage?.prompt_cache_hit_tokens ?? 0;
  }
  return sum;
}
