// The molten-glass shaders, ported line for line from the approved WebGL reference
// (modules/hyper-glass-field/reference/fluid-core.js for the simulation, reference/glass6.html for the look).
//
// Texture convention: row 0 is the reference's v = 0 (the bottom of the screen in GL terms),
// so every pass reads and writes exactly as the WebGL passes did; only the final display flips
// the screen's top-down pixel rows into that convention. All simulation passes are compute
// kernels on half-float textures sampled bilinearly with clamp-to-edge, as the GL FBOs were.
//
// The source is compiled at runtime (once per process) so the pod needs no metallib resource.
enum GlassShaders {
  static let source = """
#include <metal_stdlib>
using namespace metal;

constexpr sampler S(coord::normalized, filter::linear, address::clamp_to_edge);

struct P {
  float2 texel;      // the target's texel (the reference's `texel` uniform)
  float2 simTexel;   // the velocity grid's texel (advection)
  float dt;
  float dissipation;
  float curl;
  float value;       // clear
  float aspect;      // splat
  int count;         // splat
  float2 pad;
};

struct Splat { float2 point; float radius; float pad; float4 color; };

#define UV  float2 uv = (float2(gid) + 0.5) * p.texel; \\
            float2 vL = uv - float2(p.texel.x, 0.), vR = uv + float2(p.texel.x, 0.); \\
            float2 vT = uv + float2(0., p.texel.y), vB = uv - float2(0., p.texel.y);
#define BOUNDS if (gid.x >= dst.get_width() || gid.y >= dst.get_height()) return;

kernel void zero(texture2d<float, access::write> dst [[texture(0)]], uint2 gid [[thread_position_in_grid]]) {
  BOUNDS
  dst.write(float4(0., 0., 0., 1.), gid);
}

// splat: o = texture(uTarget, vUv).xyz + exp(-dot(p, p) / radius) * color, p.x *= aspect.
// Splats only add, so a frame's splats are summed in one pass; the result is the same as
// running the reference's splat program once per splat.
kernel void splat(texture2d<float> src [[texture(0)]], texture2d<float, access::write> dst [[texture(1)]],
                  constant P& p [[buffer(0)]], constant Splat* s [[buffer(1)]], uint2 gid [[thread_position_in_grid]]) {
  BOUNDS UV
  float3 acc = src.sample(S, uv).xyz;
  for (int i = 0; i < p.count; i++) {
    float2 q = uv - s[i].point; q.x *= p.aspect;
    acc += exp(-dot(q, q) / s[i].radius) * s[i].color.xyz;
  }
  dst.write(float4(acc, 1.), gid);
}

kernel void advect(texture2d<float> vel [[texture(0)]], texture2d<float> src [[texture(1)]], texture2d<float, access::write> dst [[texture(2)]],
                   constant P& p [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
  BOUNDS UV
  float2 coord = uv - p.dt * vel.sample(S, uv).xy * p.simTexel;
  dst.write(src.sample(S, coord) / (1. + p.dissipation * p.dt), gid);
}

kernel void divergence(texture2d<float> vel [[texture(0)]], texture2d<float, access::write> dst [[texture(1)]],
                       constant P& p [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
  BOUNDS UV
  float L = vel.sample(S, vL).x, R = vel.sample(S, vR).x, T = vel.sample(S, vT).y, B = vel.sample(S, vB).y;
  float2 C = vel.sample(S, uv).xy;
  if (vL.x < 0.) L = -C.x; if (vR.x > 1.) R = -C.x; if (vT.y > 1.) T = -C.y; if (vB.y < 0.) B = -C.y;
  dst.write(float4(.5 * (R - L + T - B), 0., 0., 1.), gid);
}

kernel void curlK(texture2d<float> vel [[texture(0)]], texture2d<float, access::write> dst [[texture(1)]],
                  constant P& p [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
  BOUNDS UV
  float L = vel.sample(S, vL).y, R = vel.sample(S, vR).y, T = vel.sample(S, vT).x, B = vel.sample(S, vB).x;
  dst.write(float4(.5 * (R - L - T + B), 0., 0., 1.), gid);
}

kernel void vorticity(texture2d<float> vel [[texture(0)]], texture2d<float> cu [[texture(1)]], texture2d<float, access::write> dst [[texture(2)]],
                      constant P& p [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
  BOUNDS UV
  float L = cu.sample(S, vL).x, R = cu.sample(S, vR).x, T = cu.sample(S, vT).x, B = cu.sample(S, vB).x, C = cu.sample(S, uv).x;
  float2 f = .5 * float2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + .0001; f *= p.curl * C; f.y *= -1.;
  float2 v = vel.sample(S, uv).xy + f * p.dt;
  dst.write(float4(clamp(v, -1000., 1000.), 0., 1.), gid);
}

kernel void pressure(texture2d<float> pr [[texture(0)]], texture2d<float> dv [[texture(1)]], texture2d<float, access::write> dst [[texture(2)]],
                     constant P& p [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
  BOUNDS UV
  float L = pr.sample(S, vL).x, R = pr.sample(S, vR).x, T = pr.sample(S, vT).x, B = pr.sample(S, vB).x;
  dst.write(float4((L + R + B + T - dv.sample(S, uv).x) * .25, 0., 0., 1.), gid);
}

kernel void gradient(texture2d<float> pr [[texture(0)]], texture2d<float> vel [[texture(1)]], texture2d<float, access::write> dst [[texture(2)]],
                     constant P& p [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
  BOUNDS UV
  float L = pr.sample(S, vL).x, R = pr.sample(S, vR).x, T = pr.sample(S, vT).x, B = pr.sample(S, vB).x;
  float2 v = vel.sample(S, uv).xy - float2(R - L, T - B);
  dst.write(float4(v, 0., 1.), gid);
}

kernel void clearK(texture2d<float> src [[texture(0)]], texture2d<float, access::write> dst [[texture(1)]],
                   constant P& p [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
  BOUNDS UV
  dst.write(p.value * src.sample(S, uv), gid);
}

// ---- Display: glass6.html's SHADE, literally ----

struct D { float2 dyeTexel; float2 size; int light; int quiet; float gain; float waveGain; };
struct VOut { float4 pos [[position]]; };

vertex VOut fullscreen(uint vid [[vertex_id]]) {
  float2 q = float2((vid << 1) & 2, vid & 2);
  VOut o; o.pos = float4(q * 2. - 1., 0., 1.); return o;
}

static float3 toSrgb(float3 c) { c = max(c, 0.); return mix(c * 12.92, 1.055 * pow(c, float3(1. / 2.4)) - .055, step(.0031308, c)); }
static float L1(texture2d<float> t, float2 uv) { return length(t.sample(S, uv).rgb); }

// The colour of the glass at vUv (the reference's vUv: y runs bottom-up), shared by the
// display and the meter so both see exactly the same picture.
static float3 glassColor(texture2d<float> uDye, float2 vUv, float2 dyeTexel, int light, thread float &warmOut) {
  float3 d = uDye.sample(S, vUv).rgb;
  float c = length(d);
  float dx = L1(uDye, vUv + float2(dyeTexel.x * 2., 0.)) - L1(uDye, vUv - float2(dyeTexel.x * 2., 0.));
  float dy = L1(uDye, vUv + float2(0., dyeTexel.y * 2.)) - L1(uDye, vUv - float2(0., dyeTexel.y * 2.));
  float3 n = normalize(float3(-dx * 3., -dy * 3., .35));
  float3 Lt = normalize(float3(-.45, .65, .6));
  float body = smoothstep(.02, .14, c);
  float warm = clamp((d.r - d.b) / max(c, 1e-4) * 1.4, 0., 1.);
  warmOut = warm;
  float3 ember = float3(1., .45, .22);
  float spec = pow(clamp(dot(reflect(-Lt, n), float3(0., 0., 1.)), 0., 1.), 24.);
  float edge = smoothstep(.01, .16, length(float2(dx, dy)) * 3.);
  float fres = pow(1. - n.z, 1.6) * edge;
  if (light == 0) {
    float3 hi = mix(float3(.88, .93, 1.), ember, warm);
    return toSrgb(body * (hi * spec * 1.35 + hi * fres * 1.1));
  } else {
    float3 ground = float3(.949, .945, .929);
    float lines = clamp((spec * 2.1 + fres * 1.7) * body, 0., 1.);
    float3 ink = mix(float3(.42, .43, .46), float3(.80, .36, .20), warm);
    return mix(ground, ink, lines * .85);
  }
}

fragment float4 shade(VOut in [[stage_in]], texture2d<float> uDye [[texture(0)]], constant D& u [[buffer(0)]]) {
  // Screen pixel rows run top-down; the reference's vUv.y runs bottom-up.
  float2 vUv = float2(in.pos.x / u.size.x, 1. - in.pos.y / u.size.y);
  float warm;
  float3 c = glassColor(uDye, vUv, u.dyeTexel, u.light, warm);
  // How strongly the glass is drawn over the page: the look's gain (1 is the reference), with
  // the warm wave kept nearer full so the one loud moment stays a moment.
  float g = mix(u.gain, max(u.gain, u.waveGain), warm);
  // Increase Contrast: drawn faintly, so text keeps 4.5:1 where an edge passes behind it (the
  // strongest edge is then about #C4C4C3 on chalk, #4D4D4D on black).
  if (u.quiet != 0) g = min(g, u.light == 0 ? .3 : .4);
  c = u.light == 0 ? clamp(c, 0., 1.) * g : mix(float3(.949, .945, .929), c, g);
  return float4(c, 1.);
}

// ---- The glass meter: how much glass is showing ----
// The dye thins out over time and the display only draws glass where enough of it is left, so
// an untended field goes blank after about ten seconds. The keep-alive (HyperGlassFieldView)
// adds a little glass back whenever this reading falls under its target.
// The reading is in the units the keep-alive was tuned in (modules/hyper-glass-field/reference/glass7.html):
// every 4th pixel of every row of that page's 540-px-wide canvas, each pixel's largest 8-bit
// channel difference from the page colour. One thread per row: out[2 * row] is the row's sum
// of those differences and out[2 * row + 1] how many of its samples differ by more than 30.

struct M { float2 dyeTexel; uint cols; uint rows; int light; int pad0; float2 pad1; };

kernel void meter(texture2d<float> uDye [[texture(0)]], constant M& m [[buffer(0)]], device float* out [[buffer(1)]],
                  uint2 gid [[thread_position_in_grid]]) {
  if (gid.x != 0 || gid.y >= m.rows) return;
  float3 ground = m.light == 0 ? float3(0.) : float3(242., 241., 237.);
  float sum = 0., hi = 0.;
  for (uint i = 0; i < m.cols; i++) {
    float2 uv = float2((float(i) * 4. + .5) / (float(m.cols) * 4.), (float(gid.y) + .5) / float(m.rows));
    float warm;
    float3 c = floor(clamp(glassColor(uDye, uv, m.dyeTexel, m.light, warm), 0., 1.) * 255. + .5);
    float3 d = abs(c - ground);
    float v = max(d.x, max(d.y, d.z));
    sum += v;
    if (v > 30.) hi += 1.;
  }
  out[gid.y * 2] = sum;
  out[gid.y * 2 + 1] = hi;
}
"""
}
