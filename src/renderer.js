// WebGL2 plumbing: scene textures, the low-res lighting pass (side or
// isometric), and the crisp integer upscale to the full-resolution canvas.
import { VERT, LIGHT_FRAG, ISO_FRAG, UPSCALE_FRAG } from './shaders.js';

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const cache = new Map();
  p.loc = (name) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
    return cache.get(name);
  };
  return p;
}

function nearest(gl, target) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) return null;
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const sideProg = program(gl, VERT, LIGHT_FRAG);
  const isoProg = program(gl, VERT, ISO_FRAG);
  const upProg = program(gl, VERT, UPSCALE_FRAG);
  const vao = gl.createVertexArray();

  const tex = {}; // created on demand
  const T = (name) => (tex[name] ??= gl.createTexture());
  const fbo = gl.createFramebuffer();
  let lowW = 0, lowH = 0;

  // side view: lights as uniform arrays
  const LA = new Float32Array(64 * 4), LB = new Float32Array(64 * 4);
  let lightCount = 0;

  function tex2D(name, internal, format, type, w, h, data) {
    gl.bindTexture(gl.TEXTURE_2D, T(name));
    nearest(gl, gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  }

  function uploadScene(scene) {
    if (scene.kind === 'iso') {
      const { W, H } = scene;
      for (const k of ['alb', 'mat', 'ext', 'pos']) tex2D('iso_' + k, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, W, H, scene[k]);
      tex2D('iso_height', gl.R8, gl.RED, gl.UNSIGNED_BYTE, scene.HMW, scene.HMH, scene.hmap);
      const n = Math.max(1, scene.lights.length);
      const data = new Float32Array(n * 2 * 4);
      scene.lights.forEach((l, i) => {
        data.set([l.X, l.Y, l.Z, l.kind + Math.min(l.thr, 1) * 0.999], i * 4);
        data.set([l.col[0], l.col[1], l.col[2], l.hidden ? -l.radius : l.radius], (n + i) * 4);
      });
      tex2D('iso_lights', gl.RGBA32F, gl.RGBA, gl.FLOAT, n, 2, data);
      lightCount = scene.lights.length;
      return;
    }
    const { layers, LW, H } = scene;
    const n = LW * H * 4;
    for (const key of ['albedo', 'mat', 'extra']) {
      const data = new Uint8Array(n * 4);
      layers.forEach((L, i) => data.set(L[key], i * n));
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, T('side_' + key));
      nearest(gl, gl.TEXTURE_2D_ARRAY);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, LW, H, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    LA.fill(0); LB.fill(0);
    lightCount = scene.lights.length;
    scene.lights.forEach((l, i) => {
      LA.set([l.x, l.y, l.layer, l.kind + Math.min(l.thr, 1) * 0.999], i * 4);
      LB.set([l.col[0], l.col[1], l.col[2], l.radius], i * 4);
    });
  }

  function ensureLowRes(W, H) {
    if (W === lowW && H === lowH) return;
    lowW = W; lowH = H;
    tex2D('low', gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, W, H, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T('low'), 0);
    tex2D('part', gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, W, H, null);
  }

  function bindTextures(prog, list) {
    list.forEach(([name, uniform, target], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(target, T(name));
      gl.uniform1i(prog.loc(uniform), i);
    });
  }

  function render(scene, env, f) {
    const { W, H } = f;
    ensureLowRes(W, H);
    gl.bindTexture(gl.TEXTURE_2D, T('part'));
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, f.part);
    gl.bindVertexArray(vao);

    // pass 1: lighting at low resolution
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    const iso = scene.kind === 'iso';
    const prog = iso ? isoProg : sideProg;
    const u = prog.loc;
    gl.useProgram(prog);
    if (iso) {
      bindTextures(prog, [['iso_alb', 'uAlbI', gl.TEXTURE_2D], ['iso_mat', 'uMatI', gl.TEXTURE_2D], ['iso_ext', 'uExtI', gl.TEXTURE_2D],
        ['iso_pos', 'uPosI', gl.TEXTURE_2D], ['iso_height', 'uHeight', gl.TEXTURE_2D], ['iso_lights', 'uLights', gl.TEXTURE_2D],
        ['part', 'uPart', gl.TEXTURE_2D]]);
      gl.uniform2f(u('uCam'), scene.cx, scene.cy);
      gl.uniform2f(u('uHMOrigin'), scene.Xmin, scene.Ymin);
      gl.uniform2f(u('uHMSize'), scene.HMW, scene.HMH);
      gl.uniform1f(u('uMaxH'), scene.maxH);
      gl.uniform2f(u('uPan'), scene.pan.x, scene.pan.y);
      gl.uniform2f(u('uBuf'), scene.W, scene.H);
      gl.uniform1f(u('uHpBuf'), scene.hpBuf);
    } else {
      bindTextures(prog, [['side_albedo', 'uAlb', gl.TEXTURE_2D_ARRAY], ['side_mat', 'uMat', gl.TEXTURE_2D_ARRAY],
        ['side_extra', 'uExt', gl.TEXTURE_2D_ARRAY], ['part', 'uPart', gl.TEXTURE_2D]]);
      gl.uniform1f(u('uMargin'), scene.margin);
      gl.uniform1f(u('uLayerW'), scene.LW);
      gl.uniform1fv(u('uOff'), f.offs);
      gl.uniform1f(u('uRoadAxis'), scene.roadAxis);
      gl.uniform4fv(u('uLA'), LA);
      gl.uniform4fv(u('uLB'), LB);
    }
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform1f(u('uHorizonY'), scene.groundY);
    gl.uniform1i(u('uLightCount'), lightCount);
    gl.uniform1f(u('uLevels'), f.levels);
    gl.uniform1f(u('uDither'), f.dither);
    for (const [name, v] of Object.entries({ uSeaY: 0, uRainbow: 0, ...env, ...(scene.env || {}) })) {
      const loc = u(name);
      if (!loc) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2: exact integer upscale to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, f.cw, f.ch);
    gl.useProgram(upProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, T('low'));
    gl.uniform1i(upProg.loc('uTex'), 0);
    gl.uniform2f(upProg.loc('uOffset'), f.offX, f.offY);
    gl.uniform1f(upProg.loc('uScale'), f.scale);
    gl.uniform2f(upProg.loc('uLowRes'), W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return { uploadScene, render };
}
