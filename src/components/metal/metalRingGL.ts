import { subscribeMotionLight, type MotionLight } from '@/lib/motionLight';

/**
 * The liquid-metal ring, drawn by one shared WebGL context.
 *
 * Loaded only through dynamic import() from MetalRing. Every ring on screen
 * draws through the same offscreen GL canvas and copies its pixels into its
 * own 2D canvas, so iOS's live-context limit is never at stake. The frame
 * loop runs only while a live ring is visible; static rings (reduced motion,
 * reduced transparency or increased contrast) draw a single settled frame.
 *
 * The shader is the approved prototype's (scratchpad metal-ring /
 * OBSERVATIONS.txt): a fixed phase field scrolled at constant speed (3.33 s
 * loop), a thin polished band with travelling glints, prismatic flecks only at
 * the sharp breaks, a quiet top-lit lip, and a vertically shaded face.
 */

const FRAG = `#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
uniform vec2  uRes;
uniform float uRpx;
uniform float uPhase;
uniform vec2  uTilt;
uniform float uLight;
uniform float uGlyph;
uniform float uGlyphB;
uniform float uGlyphMix;
uniform float uInk;
uniform float uHW;
uniform float uFlash;

const float B0 = 0.900;
const float B1 = 0.973;
const float DB = 0.0125;
const float DR = 0.008;
const float DISP = 0.011;

float field(vec2 a){
  float c = a.x, s = a.y;
  float c2 = c*c - s*s, s2 = 2.0*c*s;
  float c3 = c*c2 - s*s2, s3 = s*c2 + c*s2;
  float c4 = c2*c2 - s2*s2, s4 = 2.0*c2*s2;
  float c6 = c3*c3 - s3*s3;
  return -0.350 + 0.408*c + 0.554*s + 0.103*c2 - 0.100*s2 - 0.052*c3 - 0.045*s3
         + 0.027*c4 + 0.007*s4 + 0.044*c6;
}

vec2 strip(float x, float x0, float fl, float tl, float wl){
  x = fract(x);
  float ramp = clamp((x - x0) / (0.40 - 0.10 * fl), 0.0, 1.0);
  float v = ramp * wl;
  v = mix(wl, v, smoothstep(0.0, 0.022, x));
  float line = smoothstep(0.036, 0.068, x) * (1.0 - smoothstep(0.098, 0.140, x));
  v = max(v, line * tl * 0.95);
  v = max(v, fl);
  float brk = smoothstep(0.004, 0.016, x) * (1.0 - smoothstep(0.030, 0.046, x));
  return vec2(v, brk);
}

vec3 band(vec2 az, float sb, float aaw){
  float t = dot(uTilt, az);
  float ph = field(az) + 0.55 * t;
  float x = uPhase - ph;
  vec2 hz = normalize(vec2(1.0, 0.30 * uTilt.x));
  float hc = abs(dot(az, hz));
  float side = pow(hc, 5.0);
  float side9 = side * hc * hc * hc * hc;
  float x0 = 0.50 - 0.44 * side9 - 0.10 * t;
  float fl = 0.30 * hc * hc * hc;
  float tl = 1.0 - 0.85 * side;
  float wl = 0.93 + 0.06 * side;
  float o = aaw * 0.34;
  float ds = uLight > 0.5 ? min(1.0, 3.0 * aaw / DB) : 1.0;
  float DBs = DB * ds, DRs = DR * ds;
  vec2 r = (strip(x - DRs - o, x0, fl, tl, wl) + strip(x - DRs, x0, fl, tl, wl) + strip(x - DRs + o, x0, fl, tl, wl)) / 3.0;
  vec2 g = (strip(x - o, x0, fl, tl, wl) + strip(x, x0, fl, tl, wl) + strip(x + o, x0, fl, tl, wl)) / 3.0;
  vec2 b = (strip(x + DBs - o, x0, fl, tl, wl) + strip(x + DBs, x0, fl, tl, wl) + strip(x + DBs + o, x0, fl, tl, wl)) / 3.0;
  vec3 v = vec3(r.x, g.x, b.x);
  vec3 brk = vec3(r.y, g.y, b.y);
  float m = g.x;
  if (uLight < 0.5) {
    v += vec3(-0.012, 0.0, 0.095) * (0.55 + 0.45 * side) * 4.0 * m * (1.0 - m);
    v.b += 0.03 * m * m;
    return v;
  }
  vec3 c = mix(vec3(0.47, 0.475, 0.50), vec3(0.93, 0.93, 0.935), v);
  c *= 1.0 - 0.70 * brk;
  return c;
}

float seg(vec2 p, vec2 a, vec2 b, out vec2 n){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  vec2 d = pa - ba * h;
  float l = length(d);
  n = d / max(l, 1e-5);
  return l;
}

float glyph(vec2 p, float gt, out vec2 n){
  vec2 n1, n2, n3;
  float d1, d2, d3 = 1e3;
  if (gt < 0.5) {
    d1 = seg(p, vec2(-0.235, 0.005), vec2(-0.075, -0.155), n1);
    d2 = seg(p, vec2(-0.075, -0.155), vec2(0.245, 0.165), n2);
  } else if (gt < 1.5) {
    d1 = seg(p, vec2(-0.235, 0.0), vec2(0.235, 0.0), n1);
    d2 = seg(p, vec2(0.0, -0.235), vec2(0.0, 0.235), n2);
  } else {
    d1 = seg(p, vec2(-0.235, 0.0), vec2(0.235, 0.0), n1);
    d2 = seg(p, vec2(0.235, 0.0), vec2(0.06, 0.175), n2);
    d3 = seg(p, vec2(0.235, 0.0), vec2(0.06, -0.175), n3);
  }
  n = d1 < d2 ? n1 : n2;
  float d = min(d1, d2);
  if (d3 < d) { n = n3; d = d3; }
  return d;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag - 0.5 * uRes) / uRpx;
  float r = length(p);
  float px = 1.0 / uRpx;
  float a = clamp((1.0 - r) * uRpx + 0.5, 0.0, 1.0);
  if (a <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec2 az = p / max(r, 1e-4);

  float sb = clamp((r - B0) / (B1 - B0), 0.0, 1.0);
  float aaw = 0.0;
#ifdef GL_OES_standard_derivatives
  float phU = field(az) + 0.55 * dot(uTilt, az);
  aaw = fwidth(phU);
#else
  aaw = 1.3 * px;
#endif
  vec3 bandC = vec3(0.0);
  if (r > B0 - 2.0 * px) bandC = band(az, sb, aaw);

  float up = dot(az, normalize(vec2(-0.20 * uTilt.x, 1.0)));
  vec3 lipC = uLight < 0.5
    ? vec3(0.262, 0.262, 0.268) * pow(clamp(0.3 + 0.7 * up, 0.0, 1.0), 0.8)
    : vec3(0.72, 0.72, 0.72) + 0.05 * up;

  float yn = clamp(p.y / B0, -1.0, 1.0);
  vec3 faceC;
  if (uLight < 0.5) {
    float f = max(0.0, 0.243 * pow(0.5 + 0.5 * yn, 1.6) - 0.014);
    faceC = vec3(f);
  } else {
    faceC = vec3(mix(0.915, 0.972, 0.5 + 0.5 * yn));
  }

  vec2 gnA, gnB;
  float gdA = glyph(p, uGlyph, gnA);
  float gdB = glyph(p, uGlyphB, gnB);
  float cover = mix(clamp((uHW - gdA) * uRpx + 0.5, 0.0, 1.0), clamp((uHW - gdB) * uRpx + 0.5, 0.0, 1.0), uGlyphMix);
  vec2 gn = uGlyphMix < 0.5 ? gnA : gnB;
  float gd = uGlyphMix < 0.5 ? gdA : gdB;
  vec3 gC;
  if (uLight < 0.5) {
    gC = vec3(mix(uInk, 1.0, uFlash));
  } else {
    float q = clamp(gd / uHW, 0.0, 1.0);
    vec3 N = vec3(gn * q, sqrt(max(1.0 - q*q, 0.0)));
    vec2 R = 2.0 * N.z * N.xy;
    float ph = 0.30 * dot(R, vec2(0.45, 0.89)) + 0.9 * dot(p, vec2(0.74, 0.67)) + 0.5 * dot(uTilt, 0.4 * R + p);
    float x = uPhase * 1.0 - ph;
    vec2 g0 = strip(x, 0.42, 0.0, 1.0, 1.0);
    vec3 v = vec3(strip(x - DISP, 0.42, 0.0, 1.0, 1.0).x, g0.x, strip(x + DISP, 0.42, 0.0, 1.0, 1.0).x);
    gC = mix(vec3(0.13, 0.13, 0.14), vec3(0.90), v);
    gC *= 1.0 - 0.35 * pow(q, 6.0);
    gC = mix(gC, vec3(1.0), uFlash * 0.5);
    vec2 sn;
    float sd = glyph(p + vec2(0.0, 0.022), uGlyphMix < 0.5 ? uGlyph : uGlyphB, sn);
    faceC *= 1.0 - 0.07 * (1.0 - smoothstep(uHW, uHW + 0.06, sd));
  }
  faceC = mix(faceC, gC, cover);

  float mLip = clamp((r - B1) * uRpx + 0.5, 0.0, 1.0);
  float mFace = clamp((B0 - r) * uRpx + 0.5, 0.0, 1.0);
  vec3 col = mix(bandC, lipC, mLip);
  col = mix(col, faceC, mFace);
  gl_FragColor = vec4(col * a, a);
}`;

const VERT = 'attribute vec2 aP; void main(){ gl_Position = vec4(aP, 0.0, 1.0); }';
const UNIFORMS = ['uRes', 'uRpx', 'uPhase', 'uTilt', 'uLight', 'uGlyph', 'uGlyphB', 'uGlyphMix', 'uInk', 'uHW', 'uFlash'] as const;

export type RingGlyph = 'check' | 'plus' | 'arrow';
const GLYPH_ID: Record<RingGlyph, number> = { check: 0, plus: 1, arrow: 2 };

/** One loop period of the light, seconds (measured from the reference). */
export const RING_PERIOD_S = 3.33;
/** Phase of the settled frame used under reduced motion / transparency. */
export const STATIC_PHASE = 0.36;

interface DrawState {
  px: number;
  phase: number;
  tilt: MotionLight;
  light: boolean;
  glyphA: number;
  glyphB: number;
  mix: number;
  flash: number;
}

interface Renderer {
  draw(target: CanvasRenderingContext2D, state: DrawState): boolean;
}

let renderer: Renderer | null | undefined;
let dead = false;
const failListeners = new Set<() => void>();

function createRenderer(): Renderer | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    premultipliedAlpha: true, alpha: true, antialias: false,
    powerPreference: 'low-power', preserveDrawingBuffer: true,
  }) as WebGLRenderingContext | null;
  if (!gl) return null;
  gl.getExtension('OES_standard_derivatives');
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'aP');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<typeof UNIFORMS[number], WebGLUniformLocation | null>;

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    dead = true;
    renderer = null;
    failListeners.forEach((listener) => listener());
  });

  return {
    draw(target, state) {
      if (dead || gl.isContextLost()) return false;
      const { px } = state;
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const rpx = px / 2 - 0.75;
      gl.viewport(0, 0, px, px);
      gl.uniform2f(u.uRes, px, px);
      gl.uniform1f(u.uRpx, rpx);
      gl.uniform1f(u.uPhase, state.phase);
      gl.uniform2f(u.uTilt, state.tilt.x, state.tilt.y);
      gl.uniform1f(u.uLight, state.light ? 1 : 0);
      gl.uniform1f(u.uGlyph, state.glyphA);
      gl.uniform1f(u.uGlyphB, state.glyphB);
      gl.uniform1f(u.uGlyphMix, state.mix);
      gl.uniform1f(u.uInk, 0.84);
      gl.uniform1f(u.uHW, ((state.light ? 2.0 : 1.75) * 0.5 * dpr) / rpx);
      gl.uniform1f(u.uFlash, state.flash * state.flash);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      target.clearRect(0, 0, px, px);
      target.drawImage(canvas, 0, 0, px, px, 0, 0, px, px);
      return true;
    },
  };
}

function getRenderer(): Renderer | null {
  if (dead) return null;
  if (renderer === undefined) {
    try {
      renderer = createRenderer();
    } catch {
      renderer = null;
    }
  }
  return renderer;
}

/** Test seam / capability check: true when the shared context compiled. */
export function ringRendererAvailable(): boolean {
  return getRenderer() !== null;
}

// ── Shared frame loop ──────────────────────────────────────────────────

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let tilt: MotionLight = { x: 0, y: 0 };
let stopLight: (() => void) | null = null;
let raf = 0;
let last = 0;
const live = new Set<RingInstance>();

function ensureLight() {
  if (stopLight) return;
  stopLight = subscribeMotionLight((light) => { tilt = light; });
}

function releaseLight() {
  if (live.size > 0 || !stopLight) return;
  stopLight();
  stopLight = null;
  tilt = { x: 0, y: 0 };
}

function loop(now: number) {
  raf = 0;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { last = 0; return; }
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
  last = now;
  let any = false;
  live.forEach((ring) => {
    if (ring.visible) {
      ring.tick(dt);
      any = true;
    }
  });
  if (any) raf = requestAnimationFrame(loop);
  else last = 0;
}

function wake() {
  if (!raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(loop);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
}

export interface RingOptions {
  /** CSS pixels. */
  size: number;
  glyph: RingGlyph;
  light: boolean;
  /** `live`: moving light. `still`: one settled frame. */
  mode: 'live' | 'still';
  /** Called if the shared context is lost; show the static ring. */
  onFail?: () => void;
}

class RingInstance {
  visible = true;
  private ctx: CanvasRenderingContext2D;
  private px = 0;
  private phase = 0;
  private base = 0;
  private kick = -1;
  private flash = 0;
  private boost = 0;
  private speed = 1;
  private idle = Math.random() * 10;
  private glyphA: number;
  private glyphB: number;
  private morphT = 1;
  private disposed = false;
  private readonly fail: () => void;
  private options: RingOptions;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, options: RingOptions) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.options = options;
    this.glyphA = this.glyphB = GLYPH_ID[options.glyph];
    this.phase = options.mode === 'still' ? STATIC_PHASE : Math.random();
    this.fail = () => options.onFail?.();
    failListeners.add(this.fail);
    this.resize();
    this.apply();
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.max(8, Math.round(this.options.size * dpr));
    if (px === this.px) return;
    this.px = px;
    this.canvas.width = px;
    this.canvas.height = px;
  }

  private apply() {
    if (this.options.mode === 'live') {
      live.add(this);
      ensureLight();
      wake();
    } else {
      live.delete(this);
      releaseLight();
      this.draw();
    }
  }

  update(next: Partial<Omit<RingOptions, 'onFail'>>) {
    const prev = this.options;
    this.options = { ...prev, ...next };
    if (next.size !== undefined && next.size !== prev.size) this.resize();
    if (next.glyph && next.glyph !== prev.glyph) {
      const id = GLYPH_ID[next.glyph];
      if (this.options.mode === 'still') {
        this.glyphA = this.glyphB = id;
        this.morphT = 1;
      } else {
        // Cross-fade from whatever is showing; the glints hurry briefly.
        this.glyphA = this.morphT < 0.5 ? this.glyphA : this.glyphB;
        this.glyphB = id;
        this.morphT = 0;
        this.boost = 1;
      }
    }
    if (next.mode && next.mode !== prev.mode) {
      if (next.mode === 'still') { this.phase = STATIC_PHASE; this.base = 0; this.kick = -1; this.flash = 0; this.glyphA = this.glyphB; this.morphT = 1; }
      this.apply();
    } else if (this.options.mode === 'still') {
      this.draw();
    }
  }

  /** Busy rings run their light faster. */
  setSpeed(speed: number) {
    this.speed = speed;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (visible && this.options.mode === 'live') wake();
  }

  press() {
    if (this.options.mode !== 'live') return;
    this.flash = 1;
    if (this.kick < 0) this.kick = 0;
  }

  tick(dt: number) {
    this.boost = Math.max(0, this.boost - dt / 1.1);
    this.phase += (dt / RING_PERIOD_S) * this.speed * (1 + 4 * this.boost * this.boost);
    this.idle += dt;
    if (this.kick >= 0) {
      this.kick += dt / 1.1;
      if (this.kick >= 1) { this.base += 0.6; this.kick = -1; }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / 0.9);
    if (this.morphT < 1) {
      this.morphT = Math.min(1, this.morphT + dt / 0.45);
      if (this.morphT >= 1) this.glyphA = this.glyphB;
    }
    this.draw();
  }

  private draw() {
    if (this.disposed) return;
    const r = getRenderer();
    if (!r) { this.fail(); return; }
    const still = this.options.mode === 'still';
    const kickExtra = this.kick >= 0 ? 0.6 * (1 - Math.pow(1 - this.kick, 3)) : 0;
    // A slow idle drift keeps a resting phone's ring alive; the motion
    // light (CoreMotion on iOS) leads whenever it moves.
    const drift = still ? { x: 0, y: 0 } : {
      x: 0.12 * Math.sin(this.idle * 0.41) + 0.05 * Math.sin(this.idle * 1.13),
      y: 0.09 * Math.sin(this.idle * 0.29 + 1.3),
    };
    const ok = r.draw(this.ctx, {
      px: this.px,
      phase: still ? STATIC_PHASE : this.phase + this.base + kickExtra,
      tilt: still ? { x: 0, y: 0 } : { x: tilt.x + drift.x, y: tilt.y + drift.y },
      light: this.options.light,
      glyphA: this.glyphA,
      glyphB: this.glyphB,
      mix: this.glyphA === this.glyphB ? 0 : smooth(0.2, 0.7, this.morphT),
      flash: still ? 0 : this.flash,
    });
    if (!ok) this.fail();
  }

  dispose() {
    this.disposed = true;
    live.delete(this);
    failListeners.delete(this.fail);
    releaseLight();
  }
}

export type RingHandle = Pick<RingInstance, 'update' | 'setVisible' | 'press' | 'setSpeed' | 'dispose'>;

/** Attach a live or still ring to a 2D canvas; null when WebGL is unavailable. */
export function mountRing(canvas: HTMLCanvasElement, options: RingOptions): RingHandle | null {
  if (!getRenderer()) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return new RingInstance(canvas, ctx, options);
}
