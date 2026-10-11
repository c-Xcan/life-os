import { bootstrapVault } from "./vault/bootstrap";
import { pruneHistory } from "./vault/history";
import { ensureIndexReady } from "./index/indexer";
import { schedulerTick } from "./memory/consolidate";

const g = globalThis as unknown as { __lifeosRuntime?: Promise<void>; __lifeosTimer?: NodeJS.Timeout };

/** 服务端运行时初始化（幂等）：初始化 vault → 清理过期历史版本 / 回收站 → 建索引 + 文件监听 → 启动调度器 */
export function ensureRuntime(): Promise<void> {
  if (!g.__lifeosRuntime) {
    g.__lifeosRuntime = (async () => {
      await bootstrapVault();
      try { pruneHistory(); } catch (e) { console.error("[life-os] 清理历史版本失败：", e); }
      await ensureIndexReady();
      if (!g.__lifeosTimer) {
        // unref：定时器不阻止进程退出（构建、脚本场景）
        let lastPrune = Date.now();
        g.__lifeosTimer = setInterval(() => {
          void schedulerTick();
          if (Date.now() - lastPrune > 864e5) { lastPrune = Date.now(); try { pruneHistory(); } catch { /* 下次再试 */ } }
        }, 10 * 60 * 1000);
        g.__lifeosTimer.unref?.();
        setTimeout(() => { void schedulerTick(); }, 30 * 1000).unref?.();
      }
      console.log("[life-os] 运行时已就绪");
    })().catch((e) => {
      g.__lifeosRuntime = undefined;
      throw e;
    });
  }
  return g.__lifeosRuntime;
}
