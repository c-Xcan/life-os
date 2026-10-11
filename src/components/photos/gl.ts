/*
 * 极简 WebGL 渲染器（无依赖）：圆角贴图卡片 + 线段 + 距离雾 + 拾取
 * 照片隧道、深度丝带共用。
 */

export type V3 = [number, number, number];
export type M4 = Float32Array;

/* ---------------- 向量 / 矩阵 ---------------- */
export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

export function perspective(fovyDeg: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan((fovyDeg * Math.PI) / 360), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

/** 相机：返回视图矩阵和相机基向量 */
export function lookAt(eye: V3, target: V3, upHint: V3 = [0, 1, 0]) {
  const f = v3.norm(v3.sub(target, eye));
  let r = v3.cross(f, upHint);
  if (v3.len(r) < 1e-5) r = v3.cross(f, [0, 0, 1]);
  r = v3.norm(r);
  const u = v3.cross(r, f);
  const view = new Float32Array([
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -v3.dot(r, eye), -v3.dot(u, eye), v3.dot(f, eye), 1,
  ]);
  return { view, right: r, up: u, forward: f, eye };
}

export function mul(a: M4, b: M4, o: M4 = new Float32Array(16)): M4 {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

/** 卡片姿态：中心、右方向、上方向、宽高 */
export type Pose = { pos: V3; right: V3; up: V3; w: number; h: number };

export function poseMatrix(p: Pose, o: M4 = new Float32Array(16)): M4 {
  const n = v3.norm(v3.cross(p.right, p.up));
  o[0] = p.right[0] * p.w; o[1] = p.right[1] * p.w; o[2] = p.right[2] * p.w; o[3] = 0;
  o[4] = p.up[0] * p.h; o[5] = p.up[1] * p.h; o[6] = p.up[2] * p.h; o[7] = 0;
  o[8] = n[0]; o[9] = n[1]; o[10] = n[2]; o[11] = 0;
  o[12] = p.pos[0]; o[13] = p.pos[1]; o[14] = p.pos[2]; o[15] = 1;
  return o;
}

/** 绕卡片自身的竖轴转一个角度（飞出时的翻转效果） */
export function twist(p: Pose, angle: number): Pose {
  const n = v3.norm(v3.cross(p.right, p.up));
  const c = Math.cos(angle), s = Math.sin(angle);
  return { ...p, right: v3.norm(v3.add(v3.scale(p.right, c), v3.scale(n, s))) };
}

/** 两个姿态之间插值（方向向量插值后重新正交化） */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const right = v3.norm(v3.lerp(a.right, b.right, t));
  let up = v3.lerp(a.up, b.up, t);
  up = v3.norm(v3.sub(up, v3.scale(right, v3.dot(up, right))));
  return { pos: v3.lerp(a.pos, b.pos, t), right, up, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------------- 着色器 ---------------- */
const QUAD_VS = `
attribute vec2 a_pos;
uniform mat4 u_proj, u_viewModel;
varying vec2 v_uv; varying float v_depth;
void main() {
  vec4 p = u_viewModel * vec4(a_pos, 0.0, 1.0);
  v_depth = -p.z;
  v_uv = a_pos + 0.5;
  gl_Position = u_proj * p;
}`;
const QUAD_FS = `
precision mediump float;
varying vec2 v_uv; varying float v_depth;
uniform sampler2D u_tex;
uniform float u_opacity, u_bright, u_radius, u_aspect, u_mode, u_fogNear, u_fogFar, u_aa, u_gray;
uniform vec3 u_fogColor, u_c1, u_c2;
uniform vec4 u_uvRect;
void main() {
  vec2 p = (v_uv - 0.5) * vec2(u_aspect, 1.0);
  vec2 q = abs(p) - (vec2(u_aspect * 0.5, 0.5) - u_radius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;
  float mask = 1.0 - smoothstep(-u_aa, u_aa, d);
  vec3 col = u_mode < 0.5 ? texture2D(u_tex, u_uvRect.xy + v_uv * u_uvRect.zw).rgb : mix(u_c1, u_c2, clamp((v_uv.x + 1.0 - v_uv.y) * 0.5, 0.0, 1.0));
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), u_gray);
  col *= u_bright;
  float fog = clamp((v_depth - u_fogNear) / max(u_fogFar - u_fogNear, 0.001), 0.0, 1.0);
  col = mix(col, u_fogColor, fog * fog);
  float a = mask * u_opacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}`;
const LINE_VS = `
attribute vec3 a_pos;
uniform mat4 u_proj, u_view;
varying float v_depth;
void main() { vec4 p = u_view * vec4(a_pos, 1.0); v_depth = -p.z; gl_Position = u_proj * p; }`;
const LINE_FS = `
precision mediump float;
varying float v_depth;
uniform vec4 u_color; uniform float u_fogNear, u_fogFar;
void main() {
  float fog = clamp((v_depth - u_fogNear) / max(u_fogFar - u_fogNear, 0.001), 0.0, 1.0);
  float a = u_color.a * (1.0 - fog);
  gl_FragColor = vec4(u_color.rgb * a, a);
}`;

function compile(gl: WebGLRenderingContext, vs: string, fs: string) {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  const uni: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i)!; uni[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, uni, attr: (name: string) => gl.getAttribLocation(p, name) };
}

const hexCache = new Map<string, V3>();
const hexCached = (c: string): V3 => { let v = hexCache.get(c); if (!v) { v = hex(c); hexCache.set(c, v); } return v; };
const hex = (c: string): V3 => { const n = parseInt(c.replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export type Tex = { tex: WebGLTexture; w: number; h: number; ready: boolean; readyAt: number };
export type QuadDraw = {
  pose: Pose; tex?: Tex; mode?: 0 | 1; opacity?: number; bright?: number; gray?: number;
  /** 圆角（占短边比例） */ radius?: number;
  /** object-cover 裁剪：按卡片比例裁切贴图；false 时完整显示 */ cover?: boolean;
  /** 色块模式（mode 1）的渐变两端颜色，不传则用默认 accent */ colors?: [string, string];
  id?: number;
};

/* ---------------- 渲染器 ---------------- */
export class MiniGL {
  gl: WebGLRenderingContext;
  private quad; private line;
  private quadBuf: WebGLBuffer; private lineBuf: WebGLBuffer;
  private texCache = new Map<string, Tex>();
  private isGL2: boolean;
  proj: M4 = new Float32Array(16);
  view: M4 = new Float32Array(16);
  width = 1; height = 1; dpr = 1;
  fog = { near: 5, far: 30, color: hex("#0a0a0a") };
  accent: [V3, V3] = [hex("#5227FF"), hex("#FF9FFC")];
  /** 本帧绘制过的卡片屏幕轮廓（用于点击拾取） */
  private hits: { id: number; pts: [number, number][]; depth: number }[] = [];
  private scratch = { model: new Float32Array(16), vm: new Float32Array(16), pvm: new Float32Array(16), hit: new Float32Array(16) };
  private lastLines: Float32Array | null = null;

  constructor(public canvas: HTMLCanvasElement, background = "#0a0a0a") {
    const opts = { antialias: true, alpha: false, premultipliedAlpha: true };
    const gl2 = canvas.getContext("webgl2", opts) as WebGLRenderingContext | null;
    this.isGL2 = !!gl2;
    const gl = gl2 ?? (canvas.getContext("webgl", opts) as WebGLRenderingContext | null);
    if (!gl) throw new Error("浏览器不支持 WebGL");
    this.gl = gl;
    this.fog.color = hex(background);
    this.quad = compile(gl, QUAD_VS, QUAD_FS);
    this.line = compile(gl, LINE_VS, LINE_FS);
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    this.lineBuf = gl.createBuffer()!;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  /** 切换背景/雾颜色（跟随系统明暗主题） */
  setTheme(background: string, accent: [string, string]) {
    this.fog.color = hex(background);
    this.accent = [hex(accent[0]), hex(accent[1])];
  }

  /** 调整画布尺寸；返回是否真的变了（变了的话画面已被清空，调用方应立即重绘一帧） */
  resize(cssW: number, cssH: number, maxDpr = 2) {
    this.dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    this.width = cssW; this.height = cssH;
    const w = Math.max(1, Math.round(cssW * this.dpr)), h = Math.max(1, Math.round(cssH * this.dpr));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w; this.canvas.height = h;
    // 改尺寸会把不透明画布清成黑色：先铺上背景色，避免闪黑
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    const [r, g, b] = this.fog.color;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    return true;
  }

  texture(url: string): Tex {
    let t = this.texCache.get(url);
    if (t) return t;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([30, 30, 34, 255]));
    t = { tex, w: 1, h: 1, ready: false, readyAt: 0 };
    this.texCache.set(url, t);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const tt = t!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      const pot = (n: number) => (n & (n - 1)) === 0;
      if (this.isGL2 || (pot(img.width) && pot(img.height))) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tt.w = img.naturalWidth; tt.h = img.naturalHeight; tt.ready = true; tt.readyAt = performance.now();
    };
    img.src = url;
    return t;
  }

  begin(proj: M4, view: M4) {
    const gl = this.gl;
    this.proj = proj; this.view = view; this.hits = [];
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const [r, g, b] = this.fog.color;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
  }

  /** 视空间深度（排序用） */
  depthOf(pos: V3) {
    const v = this.view;
    return -(v[2] * pos[0] + v[6] * pos[1] + v[10] * pos[2] + v[14]);
  }

  /** 传入同一个 Float32Array 时只上传一次（静态线条，如丝带的丝线） */
  lines(points: number[] | Float32Array, color: string, alpha: number, depthTest = true) {
    if (points.length < 6) return;
    const gl = this.gl, L = this.line;
    gl.useProgram(L.p);
    depthTest ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    if (points instanceof Float32Array) {
      if (this.lastLines !== points) { gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW); this.lastLines = points; }
    } else { gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW); this.lastLines = null; }
    const a = L.attr("a_pos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(L.uni.u_proj, false, this.proj);
    gl.uniformMatrix4fv(L.uni.u_view, false, this.view);
    const c = hex(color);
    gl.uniform4f(L.uni.u_color, c[0], c[1], c[2], alpha);
    gl.uniform1f(L.uni.u_fogNear, this.fog.near);
    gl.uniform1f(L.uni.u_fogFar, this.fog.far);
    gl.drawArrays(gl.LINES, 0, points.length / 3);
    gl.depthMask(true);
  }

  /** 画一批卡片（调用方负责排序；depthTest=false 时总在最上层） */
  quads(list: QuadDraw[], depthTest = true) {
    const gl = this.gl, Q = this.quad, U = Q.uni;
    gl.useProgram(Q.p);
    depthTest ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    const a = Q.attr("a_pos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(U.u_proj, false, this.proj);
    gl.uniform1f(U.u_fogNear, this.fog.near);
    gl.uniform1f(U.u_fogFar, this.fog.far);
    gl.uniform3fv(U.u_fogColor, this.fog.color);
    gl.uniform3fv(U.u_c1, this.accent[0]);
    gl.uniform3fv(U.u_c2, this.accent[1]);
    gl.uniform1i(U.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    const pvm = mul(this.proj, this.view, this.scratch.pvm);
    for (const q of list) {
      const model = poseMatrix(q.pose, this.scratch.model);
      gl.uniformMatrix4fv(U.u_viewModel, false, mul(this.view, model, this.scratch.vm));
      const aspect = q.pose.w / q.pose.h;
      gl.uniform1f(U.u_aspect, aspect);
      gl.uniform1f(U.u_radius, (q.radius ?? 0.06) * Math.min(aspect, 1));
      // 抗锯齿宽度：约 1.5 个像素（按卡片在屏幕上的高度估算）
      const depth = Math.max(0.05, this.depthOf(q.pose.pos));
      const pxH = (q.pose.h / depth) * this.proj[5] * 0.5 * this.height * this.dpr;
      gl.uniform1f(U.u_aa, Math.min(0.08, 1.5 / Math.max(pxH, 1)));
      // 图片加载完成后 0.35 秒内淡入，避免占位色块突然变成照片
      const fadeIn = q.tex && (q.mode ?? 0) === 0 ? (q.tex.ready ? Math.min(1, (performance.now() - q.tex.readyAt) / 350) : 0) : 1;
      gl.uniform1f(U.u_opacity, (q.opacity ?? 1) * fadeIn);
      gl.uniform1f(U.u_bright, q.bright ?? 1);
      gl.uniform1f(U.u_gray, q.gray ?? 0);
      gl.uniform1f(U.u_mode, q.mode ?? 0);
      if (q.mode === 1) {
        const [c1, c2] = q.colors ? [hexCached(q.colors[0]), hexCached(q.colors[1])] : this.accent;
        gl.uniform3fv(U.u_c1, c1); gl.uniform3fv(U.u_c2, c2);
      }
      let rect: [number, number, number, number] = [0, 0, 1, 1];
      if (q.tex) {
        gl.bindTexture(gl.TEXTURE_2D, q.tex.tex);
        if (q.cover !== false && q.tex.ready) {
          const ta = q.tex.w / q.tex.h;
          rect = ta > aspect ? [(1 - aspect / ta) / 2, 0, aspect / ta, 1] : [0, (1 - ta / aspect) / 2, 1, ta / aspect];
        }
      }
      gl.uniform4f(U.u_uvRect, rect[0], rect[1], rect[2], rect[3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (q.id !== undefined) this.recordHit(q.id, model, pvm, depth);
    }
  }

  private recordHit(id: number, model: M4, pvm: M4, depth: number) {
    const m = mul(pvm, model, this.scratch.hit);
    const pts: [number, number][] = [];
    for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const cx = m[0] * x + m[4] * y + m[12], cy = m[1] * x + m[5] * y + m[13], cw = m[3] * x + m[7] * y + m[15];
      if (cw <= 0.01) return; // 在相机后面
      pts.push([((cx / cw + 1) / 2) * this.width, ((1 - cy / cw) / 2) * this.height]);
    }
    this.hits.push({ id, pts, depth });
  }

  /** 屏幕坐标（CSS 像素）下最上层的卡片 id */
  pick(x: number, y: number): number | null {
    let best: { id: number; depth: number } | null = null;
    for (const h of this.hits) {
      let inside = true, sign = 0;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = h.pts[i], [bx, by] = h.pts[(i + 1) % 4];
        const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        const s = Math.sign(c);
        if (s !== 0) { if (sign === 0) sign = s; else if (s !== sign) { inside = false; break; } }
      }
      if (inside && (!best || h.depth < best.depth)) best = { id: h.id, depth: h.depth };
    }
    return best?.id ?? null;
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.texCache.values()) gl.deleteTexture(t.tex);
    this.texCache.clear();
    gl.deleteBuffer(this.quadBuf); gl.deleteBuffer(this.lineBuf);
    gl.deleteProgram(this.quad.p); gl.deleteProgram(this.line.p);
    // 不主动 loseContext：开发模式下 React 会先卸载再挂载同一个 canvas，丢失的上下文无法恢复
  }
}
