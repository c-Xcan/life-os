"use client";
import * as React from "react";
import { useTheme } from "next-themes";
import { MiniGL } from "./gl";

/** 装饰色块的随机渐变（浅色主题偏柔和，深色主题更饱和） */
const GRADIENTS_LIGHT: [string, string][] = [
  ["#ff9a9e", "#fecfef"], ["#a1c4fd", "#c2e9fb"], ["#fbc2eb", "#a6c1ee"], ["#fdcbf1", "#e6dee9"],
  ["#84fab0", "#8fd3f4"], ["#ffecd2", "#fcb69f"], ["#f6d365", "#fda085"], ["#cfd9df", "#e2ebf0"],
  ["#a8edea", "#fed6e3"], ["#d4fc79", "#96e6a1"], ["#e0c3fc", "#8ec5fc"], ["#fccb90", "#d57eeb"],
];
const GRADIENTS_DARK: [string, string][] = [
  ["#5227ff", "#ff9ffc"], ["#0f2027", "#2c5364"], ["#ff512f", "#dd2476"], ["#4776e6", "#8e54e9"],
  ["#11998e", "#38ef7d"], ["#f7971e", "#ffd200"], ["#c31432", "#240b36"], ["#00c6ff", "#0072ff"],
  ["#fc466b", "#3f5efb"], ["#8e2de2", "#4a00e0"], ["#f953c6", "#b91d73"], ["#1d976c", "#93f9b9"],
];

/** 3D 舞台配色：和系统的浅色 / 深色主题保持一致 */
export function useStageTheme() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return dark
    ? { dark, bg: "#0a0a0a", line: "#ffffff", lineAlpha: 0.1, thread: "#a3a3a3", threadAlpha: 0.35, accent: ["#262626", "#404040"] as [string, string], gradients: GRADIENTS_DARK }
    : { dark, bg: "#f5f5f5", line: "#000000", lineAlpha: 0.08, thread: "#737373", threadAlpha: 0.4, accent: ["#e5e5e5", "#d4d4d4"] as [string, string], gradients: GRADIENTS_LIGHT };
}
import { fmtDay, type Photo } from "./shared";

/** 创建 WebGL 渲染器并跟随容器尺寸；返回容器 ref、画布 ref、渲染器 ref 和尺寸 */
export function useMiniGL(background: string, accent: [string, string] = ["#5227FF", "#FF9FFC"]) {
  const box = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const gl = React.useRef<MiniGL | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const size = React.useRef({ w: 0, h: 0 });
  /** 视图注册的「立即画一帧」：尺寸变化后同步重绘，不等下一个动画帧 */
  const redraw = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    const el = box.current, cv = canvas.current;
    if (!el || !cv) return;
    try { gl.current = new MiniGL(cv, background); gl.current.setTheme(background, accent); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    const fit = () => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      if (gl.current?.resize(el.clientWidth, el.clientHeight)) { try { redraw.current?.(); } catch { /* 下一帧会正常绘制 */ } }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // 浏览器缩放会改变像素密度（尺寸不一定变），也要重新适配
    let mq: MediaQueryList | null = null;
    const watchDpr = () => {
      mq?.removeEventListener("change", onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener("change", onDpr);
    };
    function onDpr() { fit(); watchDpr(); }
    watchDpr();
    return () => { ro.disconnect(); mq?.removeEventListener("change", onDpr); gl.current?.dispose(); gl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 主题切换时只换颜色，不重建渲染器
  React.useEffect(() => { gl.current?.setTheme(background, accent); }, [background, accent[0], accent[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return { box, canvas, gl, size, error, redraw };
}

/** 聚焦照片下方的说明：和镜头动画同时进场 / 出场（标题、日期依次错开） */
export function FocusCaption({ photo, index, total, visible }: { photo?: Photo; index: number; total: number; visible: boolean }) {
  // 出场动画期间保留上一张的文字
  const [shown, setShown] = React.useState<{ photo?: Photo; index: number }>({ photo, index });
  React.useEffect(() => { if (photo) setShown({ photo, index }); }, [photo, index]);
  const p = photo ?? shown.photo;
  const i = photo ? index : shown.index;
  const line = (delayIn: number) => ({
    transition: "opacity 600ms cubic-bezier(.22,1,.36,1), transform 700ms cubic-bezier(.22,1,.36,1), filter 600ms ease",
    transitionDelay: visible ? `${delayIn}ms` : "0ms",
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(14px)",
    filter: visible ? "blur(0)" : "blur(6px)",
  }) as React.CSSProperties;
  if (!p) return null;
  return (
    <div className="text-foreground pointer-events-none absolute inset-x-0 bottom-8 z-10 text-center">
      <div className="mx-auto max-w-xl px-6 text-sm font-medium" style={line(250)}>{p.caption || "　"}</div>
      <div className="text-muted-foreground mt-1 text-xs tabular-nums" style={line(380)}>{fmtDay(p.date, true)} · {i + 1} / {total}</div>
    </div>
  );
}

export function GLError({ message }: { message: string }) {
  return <div className="absolute inset-0 flex items-center justify-center p-6 text-muted-foreground text-center text-sm">无法启动 3D 渲染：{message}。请使用最新版 Chrome 或 Edge，并确认已开启硬件加速。</div>;
}
