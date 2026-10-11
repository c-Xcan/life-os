"use client";
import * as React from "react";
import { photoUrl, useFrame, useWheel, useFitHeight, clamp, smooth, STAGE, type ViewProps } from "./shared";
import { lookAt, perspective, v3, ease, type QuadDraw, type V3 } from "./gl";
import { useMiniGL, useStageTheme, FocusCaption, GLError } from "./gl-stage";

const TAU = Math.PI * 2;
const FOV = 50;
const INTRO_HOLD = 1.4;  // 开场先俯瞰全貌的时长（秒）
const INTRO_DIVE = 2.6;  // 俯冲进丝带的时长（秒）

/** 卡片高度（世界单位） */
const CARD_H = 0.72;

/** 8 字形空间曲线（放大、拉开卡片间距，带起伏） */
const P = (t: number): V3 => [34 * Math.sin(t), 4 * Math.sin(3 * t + 0.6), 17 * Math.sin(2 * t)];

/** 深度丝带（WebGL）：卡片沿 8 字形丝带排开，镜头先俯瞰全貌，再俯冲进去沿着丝带穿行，然后拉远，循环往复 */
export function RibbonView({ photos, onOpen }: ViewProps) {
  const theme = useStageTheme();
  const { box, canvas, gl, size, error, redraw } = useMiniGL(theme.bg, theme.accent);
  const N = 110; // 卡片多、路径大：穿行时看到的一段丝带接近直线，卡片沿对角线整齐地排向远方
  const st = React.useRef({
    u: 0, vel: 0, intro: 0, introBoost: 0, orbit: 0, held: false, heldMix: 0, speedMul: 1,
    camEye: null as V3 | null, camTarget: [0, 0, 0] as V3, hoverAmt: [] as number[],
    holdTimer: 0 as unknown as ReturnType<typeof setTimeout>,
    drag: null as null | { x: number; y: number; moved: number }, hover: -1, mouse: [-1, -1] as [number, number],
    // 聚焦：镜头飞到卡片正前方；dirFrom 是点击时从卡片指向镜头的方向（飞过去的落点）
    focus: null as null | { i: number; t: number; dir: 1 | -1; dirFrom: V3 },
  });
  const [focused, setFocused] = React.useState<number | null>(null);
  const [captionOn, setCaptionOn] = React.useState(false);
  const close = React.useCallback(() => { const f = st.current.focus; if (f) { f.dir = -1; setCaptionOn(false); } }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // 丝线是静态的，只生成一次
  const thread = React.useMemo(() => {
    const SEG = 480, arr = new Float32Array(SEG * 6);
    for (let i = 0; i < SEG; i++) { arr.set(P((i / SEG) * TAU), i * 6); arr.set(P(((i + 1) / SEG) * TAU), i * 6 + 3); }
    return arr;
  }, []);

  redraw.current = useFrame((dt) => {
    const g = gl.current, { w, h } = size.current;
    if (!g || !w || !photos.length) return;
    const S = st.current;
    const step = TAU / N;
    const INTRO = INTRO_HOLD + INTRO_DIVE;

    // 开场只播一次：俯瞰 → 俯冲。滚动会让开场加速推进（平滑，不跳）
    S.introBoost *= Math.pow(0.15, dt);
    S.intro = Math.min(INTRO, S.intro + dt * (1 + S.introBoost));
    let b = smooth((S.intro - INTRO_HOLD) / INTRO_DIVE);
    S.heldMix += ((S.held ? 1 : 0) - S.heldMix) * Math.min(1, dt * 3);
    b *= 1 - S.heldMix; // 按住时拉远看全貌，松手再俯冲回去

    // 沿丝带前进：自动巡航 + 滚轮/拖动惯性；悬停或飞出时速度平滑降到 0，避免一顿一顿
    const wantStop = S.hover >= 0 || !!S.focus;
    S.speedMul += ((wantStop ? 0 : 1) - S.speedMul) * Math.min(1, dt * 4);
    S.vel *= Math.pow(0.12, dt);
    S.u += (0.5 * step * S.speedMul + S.vel * (S.focus ? 0 : 1)) * dt;
    S.orbit += dt * 0.05 * (1 - b);

    // 镜头目标位置：俯瞰时在高处环绕；穿行时在丝带右上方、略靠后，视线顺着路径稍偏左下
    const overEye: V3 = [Math.sin(S.orbit) * 68, 38, Math.cos(S.orbit) * 68];
    const tan = v3.norm(v3.sub(P(S.u + 0.02), P(S.u - 0.02)));
    const right = v3.norm(v3.cross(tan, [0, 1, 0]));
    const rideEye = v3.add(v3.add(v3.add(P(S.u), v3.scale(tan, -0.8)), v3.scale(right, 1.6)), [0, 1.0, 0]);
    const lookDir = v3.norm(v3.add(v3.add(tan, v3.scale(right, -0.55)), [0, -0.28, 0]));
    const rideTarget = v3.add(rideEye, v3.scale(lookDir, 6));
    const wantEye = v3.lerp(overEye, rideEye, b);
    const wantTarget = v3.lerp([0, 0, 0], rideTarget, b);
    // 镜头再做一次平滑跟随，转弯和滚轮冲量都会更顺
    const k = 1 - Math.exp(-dt * 7);
    S.camEye = S.camEye ? v3.lerp(S.camEye, wantEye, k) : wantEye;
    S.camTarget = v3.lerp(S.camTarget, wantTarget, k);
    const F = S.focus;
    let eye = S.camEye, look = S.camTarget, fk = 0;
    if (F) {
      // 点击后整个镜头飞到这张卡片正前方，卡片居中、占画面约六成高度；卡片本身不动
      F.t = clamp(F.t + (F.dir * dt) / 0.9, 0, 1);
      fk = ease(F.t);
      const tex = g.texture(photoUrl(photos[F.i % photos.length]));
      const ta = tex.ready ? clamp(tex.w / tex.h, 0.75, 1.35) : 1; // 和丝带上的卡片同一比例
      const cardPos = P(F.i * step);
      const cardH = CARD_H; // 卡片不放大，只是镜头靠过去
      // 距离同时满足：高度约占画面 62%、宽度不超过画面 80%
      const tanH = Math.tan((FOV * Math.PI) / 360);
      const dist = Math.max(cardH / (0.62 * 2 * tanH), (cardH * ta) / (0.8 * 2 * tanH * (w / h)));
      const focusEye = v3.add(cardPos, v3.scale(F.dirFrom, dist));
      // 飞行途中稍微抬高一点，形成弧线
      const arc = v3.scale([0, 1, 0], Math.sin(Math.PI * fk) * dist * 0.15);
      eye = v3.add(v3.lerp(S.camEye, focusEye, fk), arc);
      look = v3.lerp(S.camTarget, cardPos, fk);
      if (F.t === 0 && F.dir === -1) { S.focus = null; setFocused(null); }
    }
    const cam = lookAt(eye, look);
    g.fog.near = 52 + (6 - 52) * b;
    g.fog.far = 160 + (36 - 160) * b;
    g.begin(perspective(FOV, w / h, 0.05, 320), cam.view);

    g.lines(thread, theme.thread, theme.threadAlpha * (1 - fk * 0.7));

    // 卡片：固定在丝带上、始终朝向镜头；按远近排序后不开深度测试绘制，避免相互穿插闪烁
    const draws: (QuadDraw & { d: number })[] = [];
    for (let i = 0; i < N; i++) {
      const tex = g.texture(photoUrl(photos[i % photos.length]));
      const ta = tex.ready ? clamp(tex.w / tex.h, 0.75, 1.35) : 1;
      const hv = (S.hoverAmt[i] ?? 0) + (((S.hover === i ? 1 : 0) - (S.hoverAmt[i] ?? 0)) * Math.min(1, dt * 10));
      S.hoverAmt[i] = hv;
      const hh = CARD_H * (1 + hv * 0.1);
      const pos = P(i * step);
      if (F && F.i === i) continue; // 聚焦的卡片单独画在最上层
      const d = g.depthOf(pos);
      if (d < 0.2) continue;
      const near = clamp((d - 0.4) / 1.2, 0, 1); // 贴近镜头时淡出，不会突然被裁掉
      draws.push({ pose: { pos, right: cam.right, up: cam.up, w: hh * ta, h: hh }, tex, id: i, radius: 0.08, opacity: near * (1 - fk * 0.7), bright: (1 + hv * 0.15) * (1 - fk * 0.35), d });
    }
    draws.sort((a, b2) => b2.d - a.d);
    g.quads(draws, false);

    // 聚焦的卡片：位置、大小都不变，只是画在最上层、不受雾影响（镜头已经贴近它）
    if (F) {
      const tex = g.texture(photoUrl(photos[F.i % photos.length]));
      const ta = tex.ready ? clamp(tex.w / tex.h, 0.75, 1.35) : 1;
      g.fog.near = 100; g.fog.far = 200;
      g.quads([{ pose: { pos: P(F.i * step), right: cam.right, up: cam.up, w: CARD_H * ta, h: CARD_H }, tex, radius: 0.08 }], false);
    }

    if (!S.drag && !S.focus && S.mouse[0] >= 0) S.hover = g.pick(S.mouse[0], S.mouse[1]) ?? -1;
    if (box.current) box.current.style.cursor = S.focus ? "zoom-out" : S.hover >= 0 ? "zoom-in" : "grab";
  });

  useFitHeight(box);
  useWheel(box, (e) => {
    const S = st.current;
    if (S.focus) { close(); return; }
    const INTRO = INTRO_HOLD + INTRO_DIVE;
    if (S.intro < INTRO) { S.introBoost = Math.min(4, S.introBoost + Math.abs(e.deltaY) * 0.01); return; } // 开场时滚动只加快开场
    S.vel = clamp(S.vel + e.deltaY * 0.0016, -2, 2);
  });

  if (!photos.length) return null;
  const fp = focused !== null ? photos[focused % photos.length] : undefined;
  return (
    <div ref={box} className={STAGE}
      onPointerMove={(e) => {
        const r = box.current!.getBoundingClientRect();
        st.current.mouse = [e.clientX - r.left, e.clientY - r.top];
        const d = st.current.drag;
        if (d) {
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (st.current.intro < INTRO_HOLD + INTRO_DIVE) st.current.introBoost = Math.min(4, st.current.introBoost + (Math.abs(dx) + Math.abs(dy)) * 0.02);
          else st.current.vel = clamp(st.current.vel - (dy + dx) * 0.003, -2, 2);
          d.moved += Math.abs(dx) + Math.abs(dy); d.x = e.clientX; d.y = e.clientY;
          if (d.moved > 6) { clearTimeout(st.current.holdTimer); }
        }
      }}
      onPointerLeave={() => { st.current.mouse = [-1, -1]; st.current.hover = -1; st.current.drag = null; st.current.held = false; }}
      onPointerDown={(e) => {
        st.current.drag = { x: e.clientX, y: e.clientY, moved: 0 };
        if (!st.current.focus) st.current.holdTimer = setTimeout(() => { if ((st.current.drag?.moved ?? 99) < 6) st.current.held = true; }, 550); // 长按超过 0.55 秒才拉远，普通点击不会误触
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
        if (id === null) return;
        const pos = P(id * (TAU / N));
        const toCam = v3.sub(S.camEye ?? [0, 10, 30], pos);
        // 落点在卡片和当前镜头的连线上，但压低俯仰角，让卡片接近正视
        const dirFrom = v3.norm([toCam[0], toCam[1] * 0.35, toCam[2]]);
        S.focus = { i: id, t: 0, dir: 1, dirFrom };
        S.hover = -1;
        setFocused(id);
        setCaptionOn(true);
      }}
      onDoubleClick={() => { if (focused !== null) onOpen(focused % photos.length); }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      {error && <GLError message={error} />}
      <FocusCaption photo={fp} index={(focused ?? 0) % photos.length} total={photos.length} visible={captionOn} />
    </div>
  );
}
