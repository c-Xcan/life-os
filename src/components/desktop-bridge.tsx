"use client";
/* 桌面版（Electron）桥接：网页版里什么都不做 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

export type DesktopSettings = {
  version: string; platform: string; dev: boolean; dataDir: string | null;
  openAtLogin: boolean; closeToTray: boolean; shortcut: string;
  notify: { memory: boolean; review: boolean; journal: boolean; journalTime: string };
  checkUpdates: boolean; logsDir: string;
};
export type UpdateInfo = { ok: boolean; error?: string; current?: string; latest?: string; url?: string; newer?: boolean; notes?: string };

type DesktopAPI = {
  platform: string;
  setTheme: (t: string) => void;
  onNavigate: (cb: (route: string) => void) => () => void;
  getSettings: () => Promise<DesktopSettings>;
  setSettings: (patch: Partial<DesktopSettings>) => Promise<{ ok?: boolean; error?: string }>;
  changeDataDir: () => Promise<{ changed: boolean; error?: string }>;
  openPath: (which: "logs" | "data") => Promise<void>;
  checkUpdate: () => Promise<UpdateInfo>;
  openExternal: (url: string) => Promise<void>;
  testNotification: () => Promise<void>;
};

declare global {
  interface Window { lifeosDesktop?: DesktopAPI }
}

/** 当前是否运行在桌面版里（首次渲染时为 false，避免水合不一致） */
export function useDesktop() {
  const [api, setApi] = React.useState<DesktopAPI | null>(null);
  React.useEffect(() => { setApi(window.lifeosDesktop ?? null); }, []);
  return api;
}

export function DesktopBridge() {
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  React.useEffect(() => {
    if (resolvedTheme) window.lifeosDesktop?.setTheme(resolvedTheme);
  }, [resolvedTheme]);
  // 托盘菜单、全局快捷键、通知点击 → 跳转页面
  React.useEffect(() => window.lifeosDesktop?.onNavigate((route) => router.push(route)), [router]);
  return null;
}
