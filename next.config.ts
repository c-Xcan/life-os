import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 文件监听库只在服务端使用，不参与打包
  serverExternalPackages: ["chokidar"],
  devIndicators: false,
  // 不让 next dev 在项目根目录生成 AGENTS.md
  agentRules: false,
  // 明确项目根目录（用户目录里有别的 pnpm-workspace.yaml，避免 Next 误判）
  turbopack: { root: process.cwd() },
  // 桌面版打包时（desktop/scripts/build.cjs 设置）输出独立服务，平时不受影响
  ...(process.env.LIFEOS_STANDALONE ? { output: "standalone" as const } : {}),
};

export default nextConfig;
