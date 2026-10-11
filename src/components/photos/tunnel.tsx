"use client";
import * as React from "react";
import { photoUrl, useFrame, useWheel, useFitHeight, hash01, clamp, STAGE, type ViewProps } from "./shared";
import { lookAt, perspective, v3, lerpPose, ease, twist, type Pose, type QuadDraw, type V3 } from "./gl";
import { useMiniGL, useStageTheme, FocusCaption, GLError } from "./gl-stage";

const LANES = 5;      // 地面/顶面每排几格（1 格 = 1 个单位）
const DEPTH = 22;     // 可见深度（格）
const SPEED = 0.35;   // 每秒前进几格
const BOOST = 10;     // 按住加速倍数
const PHOTO = 0.3, ACCENT = 0.06, GAP = 0.1, FOV = 72;

type Cell = { id: number; wall: number; lane: number; n: number; kind: 0 | 1; photo: number };

/** 照片隧道（WebGL）：在铺满照片的走廊里前进；点击照片会从墙上飞到面前 */
export function TunnelView({ photos, onOpen }: ViewProps & { title?: string }) {
  const theme = useStageTheme();
  const { box, canvas, gl, size, error, redraw } = useMiniGL(theme.bg, theme.accent);
  const st = React.useRef({
    s: 0, vel: 0, boost: 1, held: false, holdTimer: 0 as unknown as ReturnType<typeof setTimeout>,
    look: [0, 0] as [number, number], target: [0, 0] as [number, number],
    drag: null as null | { y: number; moved: number }, hover: -1, mouse: [0, 0] as [number, number],
    hoverAmt: new Map<number, number>(), // 每张照片的悬停进度 0~1（缓动）
    speedMul: 1,
    focus: null as null | { cell: Cell; from: Pose; t: number; dir: 1 | -1 },
  });
  const [focused, setFocused] = React.useState<number | null>(null);
  const [captionOn, setCaptionOn] = React.useState(false);

  const close = React.useCallback(() => { const f = st.current.focus; if (f) { f.dir = -1; setCaptionOn(false); } }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  redraw.current = useFrame((dt) => {
    const g = gl.current, { w, h } = size.current;
    if (!g || !w || !photos.length) return;
    const S = st.current;
    const W = LANES, H = W * (h / w), rows = Math.max(1, Math.round(H)), rowH = H / rows;

    // 运动：巡航 + 按住加速 + 滚轮/拖动的惯性；照片飞出时停下
    S.speedMul += ((S.focus ? 0 : S.hover >= 0 ? 0.35 : 1) - S.speedMul) * Math.min(1, dt * 3);
    const cruising = S.speedMul;
    S.boost += ((S.held ? BOOST : 1) - S.boost) * Math.min(1, dt * 4);
    S.vel *= Math.pow(0.03, dt);
    S.s = Math.max(0, S.s + (SPEED * S.boost * cruising + S.vel) * dt);
    S.look[0] += (S.target[0] - S.look[0]) * (1 - Math.exp(-dt * 2.2));
    S.look[1] += (S.target[1] - S.look[1]) * (1 - Math.exp(-dt * 2.2));

    const eye: V3 = [0, 0, -S.s];
    const cam = lookAt(eye, [S.look[0] * 0.55, -S.look[1] * 0.35, -S.s - 1]);
    g.fog.near = 2; g.fog.far = DEPTH * 0.95;
    g.begin(perspective(FOV, w / h, 0.05, DEPTH + 4), cam.view);

    // 网格线
    const pts: number[] = [];
    const z0 = -Math.floor(S.s), z1 = z0 - DEPTH;
    const ln = (a: V3, b: V3) => pts.push(...a, ...b);
    for (let i = 0; i <= W; i++) { const x = -W / 2 + i; ln([x, -H / 2, z0], [x, -H / 2, z1]); ln([x, H / 2, z0], [x, H / 2, z1]); }
    for (let j = 0; j <= rows; j++) { const y = -H / 2 + j * rowH; ln([-W / 2, y, z0], [-W / 2, y, z1]); ln([W / 2, y, z0], [W / 2, y, z1]); }
    for (let z = z0; z >= z1; z--) { ln([-W / 2, -H / 2, z], [W / 2, -H / 2, z]); ln([-W / 2, H / 2, z], [W / 2, H / 2, z]); ln([-W / 2, -H / 2, z], [-W / 2, H / 2, z]); ln([W / 2, -H / 2, z], [W / 2, H / 2, z]); }
    g.lines(pts, theme.line, theme.lineAlpha * (1 - (S.focus ? ease(S.focus.t) : 0) * 0.7));

    // 格子：0 地面 1 顶面 2 左墙 3 右墙
    const draws: (QuadDraw & { d: number })[] = [];
    let focusDraw: QuadDraw | null = null;
    const blur = clamp((S.boost - 2) / BOOST, 0, 1);
    const fk = S.focus ? ease(S.focus.t) : 0;
    for (let n = Math.floor(S.s); n < Math.floor(S.s) + DEPTH; n++) {
      for (let wall = 0; wall < 4; wall++) {
        const lanes = wall < 2 ? W : rows;
        for (let lane = 0; lane < lanes; lane++) {
          const r = hash01(wall, lane, n);
          if (r >= PHOTO + ACCENT) continue;
          const cell: Cell = { id: (n * 4 + wall) * 64 + lane, wall, lane, n, kind: r < PHOTO ? 0 : 1, photo: Math.floor(hash01(n, lane, wall, 7) * photos.length) };
          const z = -(n + 0.5);
          const cw = 1 - GAP, ch = (wall < 2 ? 1 : rowH) - GAP;
          let pose: Pose;
          if (wall === 0) pose = { pos: [-W / 2 + lane + 0.5, -H / 2, z], right: [1, 0, 0], up: [0, 0, -1], w: cw, h: 1 - GAP };
          else if (wall === 1) pose = { pos: [-W / 2 + lane + 0.5, H / 2, z], right: [1, 0, 0], up: [0, 0, 1], w: cw, h: 1 - GAP };
          else if (wall === 2) pose = { pos: [-W / 2, -H / 2 + (lane + 0.5) * rowH, z], right: [0, 0, -1], up: [0, 1, 0], w: 1 - GAP, h: ch };
          else pose = { pos: [W / 2, -H / 2 + (lane + 0.5) * rowH, z], right: [0, 0, 1], up: [0, 1, 0], w: 1 - GAP, h: ch };
          // 悬停：抬起、放大、提亮都按缓动曲线过渡（进入快一点，离开慢一点）
          const want = S.hover === cell.id && cell.kind === 0 && !S.focus ? 1 : 0;
          const prev = S.hoverAmt.get(cell.id) ?? 0;
          const hv = prev + (want - prev) * Math.min(1, dt * (want > prev ? 9 : 5));
          if (hv > 0.001) S.hoverAmt.set(cell.id, hv); else S.hoverAmt.delete(cell.id);
          const he = hv * hv * (3 - 2 * hv);
          if (he > 0.001) {
            const nrm = v3.norm(v3.cross(pose.right, pose.up));
            pose = { ...pose, pos: v3.add(pose.pos, v3.scale(nrm, he * 0.12)), w: pose.w * (1 + he * 0.06), h: pose.h * (1 + he * 0.06) };
          }
          const near = clamp((-z - S.s) / 0.8, 0, 1); // 贴近镜头时淡出
          const tex = cell.kind === 0 ? g.texture(photoUrl(photos[cell.photo])) : undefined;
          if (S.focus && S.focus.cell.id === cell.id) { S.focus.from = pose; continue; }
          draws.push({ pose, tex, mode: cell.kind, colors: cell.kind === 1 ? theme.gradients[Math.floor(hash01(n, lane, wall, 3) * theme.gradients.length)] : undefined, opacity: near * (1 - fk * 0.6), bright: (0.92 - blur * 0.25 + he * 0.3) * (1 - fk * 0.4), id: cell.kind === 0 ? cell.id : undefined, d: g.depthOf(pose.pos) });
        }
      }
    }
    draws.sort((a, b) => b.d - a.d);
    g.quads(draws);

    // 飞出来的照片：从墙上的位置插值到镜头正前方
    const F = S.focus;
    if (F) {
      F.t = clamp(F.t + (F.dir * dt) / 0.8, 0, 1);
      const tex = g.texture(photoUrl(photos[F.cell.photo]));
      const ta = tex.ready ? clamp(tex.w / tex.h, 0.5, 2.2) : 1;
      const d = 2.2, viewH = 2 * d * Math.tan((FOV * Math.PI) / 360);
      let hh = viewH * 0.62, ww = hh * ta;
      if (ww > viewH * (w / h) * 0.8) { ww = viewH * (w / h) * 0.8; hh = ww / ta; }
      const to: Pose = { pos: v3.add(v3.add(cam.eye, v3.scale(cam.forward, d)), v3.scale(cam.up, viewH * 0.04)), right: cam.right, up: cam.up, w: ww, h: hh };
      const k = ease(F.t);
      // 从墙上“抽”出来：沿弧线飞向镜头，途中带一点翻转
      const arc = Math.sin(Math.PI * k);
      const pose = twist(lerpPose(F.from, to, k), arc * 0.35 * F.dir);
      pose.pos = v3.add(pose.pos, v3.scale(cam.forward, -arc * 0.15));
      g.fog.near = 100; g.fog.far = 200; // 飞出的照片不受雾影响
      focusDraw = { pose, tex, opacity: 1, radius: 0.03, id: -1 };
      g.quads([focusDraw], false);
      if (F.t === 0 && F.dir === -1) { S.focus = null; setFocused(null); }
    }

    // 悬停检测（每帧根据鼠标位置拾取）
    if (!S.drag && !S.focus) { const id = g.pick(S.mouse[0], S.mouse[1]); S.hover = id ?? -1; }
  });

  useFitHeight(box);
  useWheel(box, (e) => {
    if (st.current.focus) { close(); }
    st.current.vel += e.deltaY * 0.03;
  });

  const cellFromId = (id: number): Cell | null => {
    const lane = id % 64, rest = (id - lane) / 64, wall = rest % 4, n = (rest - wall) / 4;
    const r = hash01(wall, lane, n);
    return { id, wall, lane, n, kind: r < PHOTO ? 0 : 1, photo: Math.floor(hash01(n, lane, wall, 7) * photos.length) };
  };

  if (!photos.length) return null;
  const fp = focused !== null ? photos[focused] : undefined;
  return (
    <div ref={box} className={STAGE + (st.current.hover >= 0 ? " cursor-zoom-in" : "")}
      onPointerMove={(e) => {
        const r = box.current!.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        st.current.mouse = [x, y];
        st.current.target = [x / r.width - 0.5, y / r.height - 0.5];
        const d = st.current.drag;
        if (d) {
          const dy = e.clientY - d.y;
          st.current.vel = clamp(st.current.vel - dy * 0.1, -12, 12);
          d.y = e.clientY; d.moved += Math.abs(dy);
          if (d.moved > 6) { clearTimeout(st.current.holdTimer); st.current.held = false; }
        }
        if (box.current) box.current.style.cursor = st.current.hover >= 0 && !st.current.focus ? "zoom-in" : st.current.focus ? "zoom-out" : "";
      }}
      onPointerLeave={() => { st.current.target = [0, 0]; st.current.held = false; st.current.drag = null; st.current.hover = -1; }}
      onPointerDown={(e) => {
        st.current.drag = { y: e.clientY, moved: 0 };
        if (!st.current.focus) st.current.holdTimer = setTimeout(() => { st.current.held = true; }, 220);
      }}
      onPointerUp={(e) => {
        clearTimeout(st.current.holdTimer);
        const wasHeld = st.current.held;
        st.current.held = false;
        const moved = st.current.drag?.moved ?? 0;
        st.current.drag = null;
        if (moved > 6 || wasHeld) return;
        const S = st.current;
        if (S.focus) { close(); return; }
        const g = gl.current; if (!g) return;
        const r = box.current!.getBoundingClientRect();
        const id = g.pick(e.clientX - r.left, e.clientY - r.top);
        if (id === null || id < 0) return;
        const cell = cellFromId(id);
        if (!cell || cell.kind !== 0) return;
        S.focus = { cell, from: { pos: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], w: 1, h: 1 }, t: 0, dir: 1 };
        setFocused(cell.photo);
        setCaptionOn(true);
      }}
      onDoubleClick={() => { if (focused !== null) onOpen(focused); }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      {error && <GLError message={error} />}
      <FocusCaption photo={fp} index={focused ?? 0} total={photos.length} visible={captionOn} />
    </div>
  );
}
