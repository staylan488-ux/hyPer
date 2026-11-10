const VS = `#version 300 es
in vec2 aPos; uniform vec2 texel; out vec2 vUv, vL, vR, vT, vB;
void main(){ vUv = aPos * .5 + .5; vL = vUv - vec2(texel.x, 0.); vR = vUv + vec2(texel.x, 0.); vT = vUv + vec2(0., texel.y); vB = vUv - vec2(0., texel.y); gl_Position = vec4(aPos, 0., 1.); }`;
const HEAD = `#version 300 es
precision highp float; precision highp sampler2D; in vec2 vUv, vL, vR, vT, vB; out vec4 o;`;
const FS = {
  splat: HEAD + `uniform sampler2D uTarget; uniform float aspect, radius; uniform vec3 color; uniform vec2 point;
    void main(){ vec2 p = vUv - point; p.x *= aspect; vec3 s = exp(-dot(p, p) / radius) * color; o = vec4(texture(uTarget, vUv).xyz + s, 1.); }`,
  advect: HEAD + `uniform sampler2D uVelocity, uSource; uniform vec2 simTexel; uniform float dt, dissipation;
    void main(){ vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * simTexel; o = texture(uSource, coord) / (1. + dissipation * dt); }`,
  divergence: HEAD + `uniform sampler2D uVelocity;
    void main(){ float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x, T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
      vec2 C = texture(uVelocity, vUv).xy; if (vL.x < 0.) L = -C.x; if (vR.x > 1.) R = -C.x; if (vT.y > 1.) T = -C.y; if (vB.y < 0.) B = -C.y;
      o = vec4(.5 * (R - L + T - B), 0., 0., 1.); }`,
  curl: HEAD + `uniform sampler2D uVelocity;
    void main(){ float L = texture(uVelocity, vL).y, R = texture(uVelocity, vR).y, T = texture(uVelocity, vT).x, B = texture(uVelocity, vB).x;
      o = vec4(.5 * (R - L - T + B), 0., 0., 1.); }`,
  vorticity: HEAD + `uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
    void main(){ float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x, T = texture(uCurl, vT).x, B = texture(uCurl, vB).x, C = texture(uCurl, vUv).x;
      vec2 f = .5 * vec2(abs(T) - abs(B), abs(R) - abs(L)); f /= length(f) + .0001; f *= curl * C; f.y *= -1.;
      vec2 v = texture(uVelocity, vUv).xy + f * dt; o = vec4(clamp(v, -1000., 1000.), 0., 1.); }`,
  pressure: HEAD + `uniform sampler2D uPressure, uDivergence;
    void main(){ float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
      o = vec4((L + R + B + T - texture(uDivergence, vUv).x) * .25, 0., 0., 1.); }`,
  gradient: HEAD + `uniform sampler2D uPressure, uVelocity;
    void main(){ float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
      vec2 v = texture(uVelocity, vUv).xy - vec2(R - L, T - B); o = vec4(v, 0., 1.); }`,
  clear: HEAD + `uniform sampler2D uTexture; uniform float value; void main(){ o = value * texture(uTexture, vUv); }`,
  display: HEAD + `uniform sampler2D uDye; uniform vec2 dyeTexel; uniform int mode; uniform float exposure, floorv;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    vec3 toSrgb(vec3 c){ c = max(c, 0.); return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
    vec3 tone(vec3 c){ return 1. - exp(-c * exposure); }
    void main(){
      vec3 d = texture(uDye, vUv).rgb; vec3 col;
      vec3 dF = max(d - floorv, 0.) * (1. + floorv * 8.);
      if (mode == 0) {                       // ink: the dye as it is
        col = tone(dF);
      } else if (mode == 1) {                // liquid light: the dye plus a wide soft glow
        vec3 g = vec3(0.); float wsum = 0.;
        for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) { vec2 q = vec2(float(i), float(j)); float w = exp(-dot(q, q) / 8.); g += texture(uDye, clamp(vUv + q * dyeTexel * 6., dyeTexel * 3., 1. - dyeTexel * 3.)).rgb * w; wsum += w; }
        g /= wsum; g = max(g - floorv * .5, 0.); col = tone(dF * .55 + g * 1.4);
      } else {                               // thick and glossy: the ink as a liquid body with a lit surface
        float c = length(texture(uDye, vUv).rgb);
        float dx = length(texture(uDye, vUv + vec2(dyeTexel.x * 2., 0.)).rgb) - length(texture(uDye, vUv - vec2(dyeTexel.x * 2., 0.)).rgb);
        float dy = length(texture(uDye, vUv + vec2(0., dyeTexel.y * 2.)).rgb) - length(texture(uDye, vUv - vec2(0., dyeTexel.y * 2.)).rgb);
        vec3 n = normalize(vec3(-dx * 3., -dy * 3., .35));
        vec3 L = normalize(vec3(-.45, .65, .6));
        float body = smoothstep(.04, .22, c);
        float dif = clamp(dot(n, L), 0., 1.);
        float spec = pow(clamp(dot(reflect(-L, n), vec3(0., 0., 1.)), 0., 1.), 40.);
        vec3 base = d / max(c, 1e-4);
        col = body * (base * (.22 + .55 * dif) + vec3(.9, .95, 1.) * spec * .9);
        col = 1. - exp(-col * exposure * 1.6);
      }
      vec3 s = toSrgb(col);
      float lum = dot(s, vec3(.2126, .7152, .0722));
      s += (h21(gl_FragCoord.xy) - .5) / 255. * 2. * smoothstep(.004, .03, lum);   // no grain on black, so black stays #000
      o = vec4(s, 1.);
    }`,
};

class Fluid {
  constructor(canvas, f, seed) {
    this.f = f; this.rand = mulberry32(seed);
    canvas.width = W * SCALE; canvas.height = H * SCALE;
    const gl = this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    gl.getExtension('EXT_color_buffer_float');
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.prog = {};
    for (const [k, src] of Object.entries(FS)) this.prog[k] = this.program(VS, src);
    const aspect = W / H;
    this.simW = 128; this.simH = Math.round(128 / aspect);
    this.dyeW = 512; this.dyeH = Math.round(512 / aspect);
    this.velocity = this.double(this.simW, this.simH, gl.RG16F, gl.RG);
    this.dye = this.double(this.dyeW, this.dyeH, gl.RGBA16F, gl.RGBA);
    this.pressure = this.double(this.simW, this.simH, gl.R16F, gl.RED);
    this.divergence = this.fbo(this.simW, this.simH, gl.R16F, gl.RED);
    this.curlTex = this.fbo(this.simW, this.simH, gl.R16F, gl.RED);
    this.aspect = aspect;
  }
  program(vs, fs) {
    const gl = this.gl;
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  fbo(w, h, internal, format) {
    const gl = this.gl;
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h, attach(unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); return unit; } };
  }
  double(w, h, internal, format) {
    let a = this.fbo(w, h, internal, format), b = this.fbo(w, h, internal, format);
    return { get read() { return a; }, get write() { return b; }, swap() { const t = a; a = b; b = t; } };
  }
  run(prog, target, texel) {
    const gl = this.gl;
    gl.uniform2f(prog.u.texel, texel[0], texel[1]);
    if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, target.w, target.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); }
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  use(name) { const p = this.prog[name]; this.gl.useProgram(p.p); return p; }
  splat(x, y, dx, dy, color, radius) {
    const gl = this.gl; const simTexel = [1 / this.simW, 1 / this.simH];
    let p = this.use('splat');
    gl.uniform1i(p.u.uTarget, this.velocity.read.attach(0)); gl.uniform1f(p.u.aspect, this.aspect);
    gl.uniform2f(p.u.point, x, y); gl.uniform3f(p.u.color, dx, dy, 0); gl.uniform1f(p.u.radius, radius);
    this.run(p, this.velocity.write, simTexel); this.velocity.swap();
    if (color) {
      p = this.use('splat');
      gl.uniform1i(p.u.uTarget, this.dye.read.attach(0)); gl.uniform1f(p.u.aspect, this.aspect);
      gl.uniform2f(p.u.point, x, y); gl.uniform3f(p.u.color, color[0], color[1], color[2]); gl.uniform1f(p.u.radius, radius);
      this.run(p, this.dye.write, [1 / this.dyeW, 1 / this.dyeH]); this.dye.swap();
    }
  }
  step(dt) {
    const gl = this.gl, f = this.f, st = [1 / this.simW, 1 / this.simH];
    let p = this.use('curl'); gl.uniform1i(p.u.uVelocity, this.velocity.read.attach(0)); this.run(p, this.curlTex, st);
    p = this.use('vorticity'); gl.uniform1i(p.u.uVelocity, this.velocity.read.attach(0)); gl.uniform1i(p.u.uCurl, this.curlTex.attach(1));
    gl.uniform1f(p.u.curl, f.curl); gl.uniform1f(p.u.dt, dt); this.run(p, this.velocity.write, st); this.velocity.swap();
    p = this.use('divergence'); gl.uniform1i(p.u.uVelocity, this.velocity.read.attach(0)); this.run(p, this.divergence, st);
    p = this.use('clear'); gl.uniform1i(p.u.uTexture, this.pressure.read.attach(0)); gl.uniform1f(p.u.value, 0.8); this.run(p, this.pressure.write, st); this.pressure.swap();
    p = this.use('pressure'); gl.uniform1i(p.u.uDivergence, this.divergence.attach(0));
    for (let i = 0; i < 20; i++) { gl.uniform1i(p.u.uPressure, this.pressure.read.attach(1)); this.run(p, this.pressure.write, st); this.pressure.swap(); }
    p = this.use('gradient'); gl.uniform1i(p.u.uPressure, this.pressure.read.attach(0)); gl.uniform1i(p.u.uVelocity, this.velocity.read.attach(1));
    this.run(p, this.velocity.write, st); this.velocity.swap();
    p = this.use('advect'); gl.uniform1i(p.u.uVelocity, this.velocity.read.attach(0)); gl.uniform1i(p.u.uSource, this.velocity.read.attach(0));
    gl.uniform2f(p.u.simTexel, st[0], st[1]); gl.uniform1f(p.u.dt, dt); gl.uniform1f(p.u.dissipation, f.velDiss);
    this.run(p, this.velocity.write, st); this.velocity.swap();
    p = this.use('advect'); gl.uniform1i(p.u.uVelocity, this.velocity.read.attach(0)); gl.uniform1i(p.u.uSource, this.dye.read.attach(1));
    gl.uniform2f(p.u.simTexel, st[0], st[1]); gl.uniform1f(p.u.dt, dt); gl.uniform1f(p.u.dissipation, f.dyeDiss);
    this.run(p, this.dye.write, [1 / this.dyeW, 1 / this.dyeH]); this.dye.swap();
  }
  draw() {
    const gl = this.gl, p = this.use('display');
    gl.uniform1i(p.u.uDye, this.dye.read.attach(0)); gl.uniform2f(p.u.dyeTexel, 1 / this.dyeW, 1 / this.dyeH);
    gl.uniform1i(p.u.mode, this.f.display === 'ink' ? 0 : this.f.display === 'light' ? 1 : 2); gl.uniform1f(p.u.exposure, this.f.exposure); gl.uniform1f(p.u.floorv, this.f.floor);
    this.run(p, null, [1 / this.dyeW, 1 / this.dyeH]);
  }
}

