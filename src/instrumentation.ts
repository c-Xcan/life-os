export async function register() {
  // next build 时也会加载这里：不要启动文件监听和定时任务，否则构建进程无法退出
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureRuntime } = await import("./lib/runtime");
    await ensureRuntime().catch((e) => console.error("[life-os] 初始化失败：", e));
  }
}
