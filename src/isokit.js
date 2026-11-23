// Shared isometric toolkit used by every isometric theme.
//
// A tiny software rasterizer writes into screen-space buffers with a z-buffer.
// Each pixel keeps its material and world height so the shader can rebuild its
// 3D position (shadows, lamp light, reflections). Primitives: boxes, sloped
// roofs, cylinders, cones, sphere blobs (canopies, rocks) and a flat ground.
//
// World axes: +X west, +Y south, +Z up. The camera looks from the south-west,
// so the visible walls face west (+X, right on screen) and south (+Y, left).
// Projection (2:1 pixel iso):  screen x = X - Y,  screen y = (X + Y) / 2 - Z
import { RNG, hash2, noise2 } from './rng.js';
import { Layer, F, hex, shade, mix, lin } from './raster.js';
import { AUTUMN, GREENS, SPRING } from './city.js';

// Second set of flags, stored in the pos texture's blue channel.
export const F2 = { WATER: 1, FAR: 2 };

const S3 = 1 / Math.sqrt(3), S2 = Math.SQRT1_2, S6 = 1 / Math.sqrt(6);
export const VIEW = [S3, S3, S3], RIGHT = [S2, -S2, 0], UP = [-S6, -S6, 2 * S6];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

const BARK = hex(0x4a3527);
const POLE = hex(0x262a32), POLE_HI = hex(0x3b414d), BULB = hex(0xe9dfc2);
const MAPLE = [0xc0392b, 0xe0562b, 0xa52a2a, 0xf08a3c].map(hex);
const PINE = [0x2c5a3c, 0x23492f, 0x356a45].map(hex);
const BLOSSOM = [0xf6c1d4, 0xe98fb0, 0xfadbe6].map(hex);

// VW x VH is the visible low-res picture. The scene is rendered PX/PY pixels
// larger on each side so the camera can pan (mouse parallax) without redrawing.
export function createIso(VW, VH, { horizon = 0.36 } = {}) {
  const PX = Math.max(2, Math.round(VW * 0.02)), PY = Math.max(1, Math.round(VH * 0.015));
  const W = VW + 2 * PX, H = VH + 2 * PY;
  const cx = Math.floor(VW / 2) + PX, cy = PY;
  const hp = Math.round(VH * horizon) + PY;   // far edge of the ground; sky above
  const bottom = VH + PY;
  const N = W * H;
  const alb = new Uint8Array(N * 4), mat = new Uint8Array(N * 4), ext = new Uint8Array(N * 4), pos = new Uint8Array(N * 4);
  const zbuf = new Float32Array(N).fill(-1e9);
  const lights = [], vents = [];

  // M is the material of the pixel being written; material callbacks fill it.
  const M = { c: [128, 128, 128], nx: 0, ny: 0, nz: 1, f: 0, f2: 0, e: 0, r: 0, s: 0 };
  const enc = (v) => clamp(128 + Math.round(v * 127), 0, 255);
  const fogAt = (X, Y) => Math.round(255 * (1 - clamp(((X + Y) / 2 + cy - hp) / (bottom - hp), 0, 1)));
  const reset = (face) => {
    M.f = 0; M.f2 = 0; M.e = 0; M.r = 0; M.s = 0;
    M.nx = face === 1 ? 1 : 0; M.ny = face === 2 ? 1 : 0; M.nz = face === 0 ? 1 : 0;
  };
  const setN = (n) => { M.nx = n[0]; M.ny = n[1]; M.nz = n[2]; };
  const tilt = (face, up = 0.9) => setN(norm([face === 1 ? 0.45 : 0, face === 2 ? 0.45 : 0, up]));

  function put(px, py, depth, X, Y, Z, fog) {
    const i = py * W + px;
    if (depth <= zbuf[i]) return;
    zbuf[i] = depth;
    const j = i * 4;
    alb[j] = M.c[0]; alb[j + 1] = M.c[1]; alb[j + 2] = M.c[2]; alb[j + 3] = 255;
    mat[j] = enc(M.nx); mat[j + 1] = enc(M.ny); mat[j + 2] = enc(M.nz); mat[j + 3] = M.f;
    ext[j] = M.s; ext[j + 1] = M.r; ext[j + 2] = M.e; ext[j + 3] = fog ?? fogAt(X, Y);
    const zq = clamp(Math.round(Math.max(0, Z) * 64), 0, 65535);
    pos[j] = zq >> 8; pos[j + 1] = zq & 255; pos[j + 2] = M.f2;
  }

  // ---------------------------------------------------------------- heightmap
  // Top-down height of everything, used by the shader to trace sun shadows.
  const ext0 = Math.round(VH * 0.3);
  const sxMin = -cx - 1, sxMax = W - cx + 1, syMin = hp - cy, syMax = H + ext0 - cy;
  const margin = 70;
  const Xmin = Math.floor(syMin + sxMin / 2) - margin, Xmax = Math.ceil(syMax + sxMax / 2) + margin;
  const Ymin = Math.floor(syMin - sxMax / 2) - margin, Ymax = Math.ceil(syMax - sxMin / 2) + margin;
  const HMW = Xmax - Xmin, HMH = Ymax - Ymin;
  const hmap = new Uint8Array(HMW * HMH);
  let maxH = 0;
  function stamp(x0, y0, x1, y1, h) {
    maxH = Math.max(maxH, h);
    const hb = clamp(Math.round(h), 0, 255);
    for (let y = Math.max(Ymin, Math.floor(y0)); y < Math.min(Ymax, Math.ceil(y1)); y++) {
      for (let x = Math.max(Xmin, Math.floor(x0)); x < Math.min(Xmax, Math.ceil(x1)); x++) {
        const i = (y - Ymin) * HMW + (x - Xmin);
        if (hb > hmap[i]) hmap[i] = hb;
      }
    }
  }
  const onScreen = (x0, y0, x1, y1, z1) =>
    x1 - y0 + cx >= -2 && x0 - y1 + cx <= W + 2 && (x0 + y0) / 2 - z1 + cy <= H + 2 && (x1 + y1) / 2 + cy >= hp - 2;
  // screen bounding box of a world-space box, clamped to the buffer
  const bbox = (x0, y0, x1, y1, z0, z1) => [
    Math.max(0, Math.floor(x0 - y1 + cx) - 1), Math.min(W - 1, Math.ceil(x1 - y0 + cx) + 1),
    Math.max(0, Math.floor((x0 + y0) / 2 - z1 + cy) - 1), Math.min(H - 1, Math.ceil((x1 + y1) / 2 - z0 + cy) + 1),
  ];

  // ------------------------------------------------------------------ boxes
  // The three visible faces of an axis-aligned box. matFn(face, X, Y, Z) sets M;
  // face 0 = top, 1 = west wall (+X), 2 = south wall (+Y).
  // minRow clips the box to screen rows below it (land that would poke past the horizon).
  function box(x0, y0, x1, y1, z0, z1, matFn, doStamp = true, minRow = 0) {
    if (doStamp) stamp(x0, y0, x1, y1, z1);
    const [pxA, pxB, pyA0, pyB] = bbox(x0, y0, x1, y1, z0, z1);
    const pyA = Math.max(pyA0, minRow);
    for (let py = pyA; py <= pyB; py++) {
      const sy = py + 0.5 - cy;
      for (let px = pxA; px <= pxB; px++) {
        const sx = px + 0.5 - cx;
        let X = sy + z1 + sx / 2, Y = sy + z1 - sx / 2, Z;
        if (X >= x0 && X < x1 && Y >= y0 && Y < y1) { reset(0); matFn(0, X, Y, z1); put(px, py, X + Y + z1, X, Y, z1); continue; }
        Y = x1 - sx; Z = (x1 + Y) / 2 - sy;
        if (Y >= y0 && Y < y1 && Z >= z0 && Z < z1) { reset(1); matFn(1, x1, Y, Z); put(px, py, x1 + Y + Z, x1, Y, Z); continue; }
        X = sx + y1; Z = (X + y1) / 2 - sy;
        if (X >= x0 && X < x1 && Z >= z0 && Z < z1) { reset(2); matFn(2, X, y1, Z); put(px, py, X + y1 + Z, X, y1, Z); }
      }
    }
  }
  const solid = (c, f = 0, e = 0) => () => { M.c = c; M.f = f; M.e = e; };
  const edged = (c) => (face) => { M.c = face === 0 ? shade(c, 1.12) : c; };

  // ------------------------------------------------------------------ roofs
  // A roof is the lowest of several planes "z0 + slope * distance to an edge":
  // kind 'gx' = gable with the ridge along X, 'gy' = ridge along Y, 'hip' = all
  // four sides (a pyramid on square plans). matFn(0, X, Y, Z, plane) colours it.
  // gable: { x: wallX or y: wallY, fn } also draws the triangular end wall.
  function roof(x0, y0, x1, y1, z0, slope, kind, matFn, gable) {
    const all = [[y1, 0, -1], [-y0, 0, 1], [x1, -1, 0], [-x0, 1, 0]]; // south, north, west, east
    const planes = kind === 'gx' ? [all[0], all[1]] : kind === 'gy' ? [all[2], all[3]] : all;
    const heightAt = (X, Y) => {
      let d = Infinity;
      for (const [p, q, r] of planes) d = Math.min(d, p + q * X + r * Y);
      return z0 + slope * Math.max(0, d);
    };
    const half = kind === 'gx' ? (y1 - y0) / 2 : kind === 'gy' ? (x1 - x0) / 2 : Math.min(x1 - x0, y1 - y0) / 2;
    const zTop = z0 + slope * half;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      stamp(x, y, x + 1, y + 1, heightAt(x + 0.5, y + 0.5));
    }
    maxH = Math.max(maxH, zTop);
    const coef = planes.map(([p, q, r]) => [z0 + slope * p, slope * q, slope * r]);
    const normals = coef.map(([, b, c]) => norm([-b, -c, 1]));
    const [pxA, pxB, pyA, pyB] = bbox(x0, y0, x1, y1, z0, zTop);
    for (let py = pyA; py <= pyB; py++) {
      const sy = py + 0.5 - cy;
      for (let px = pxA; px <= pxB; px++) {
        const sx = px + 0.5 - cx;
        let best = -Infinity, bi = -1, bX = 0, bY = 0, bZ = 0;
        for (let i = 0; i < coef.length; i++) {
          const [a, b, c] = coef[i];
          const den = 1 - b - c;
          if (Math.abs(den) < 1e-6) continue;
          const Y = (sy - sx / 2 + a + b * sx) / den, X = Y + sx;
          if (X < x0 || X >= x1 || Y < y0 || Y >= y1) continue;
          const Z = a + b * X + c * Y;
          if (Math.abs(Z - heightAt(X, Y)) > 1e-3) continue;
          if (X + Y + Z > best) { best = X + Y + Z; bi = i; bX = X; bY = Y; bZ = Z; }
        }
        if (bi >= 0) { reset(0); setN(normals[bi]); matFn(0, bX, bY, bZ, bi); put(px, py, best, bX, bY, bZ); }
        if (!gable) continue;
        if (gable.x !== undefined) { // west gable wall under a ridge along X
          const Y = gable.x - sx, Z = (gable.x + Y) / 2 - sy;
          if (Y >= gable.y0 && Y < gable.y1 && Z >= gable.z0 && Z < heightAt(Math.min(gable.x, x1 - 1e-3), Y) - 0.4) {
            reset(1); gable.fn(1, gable.x, Y, Z); put(px, py, gable.x + Y + Z, gable.x, Y, Z);
          }
        } else if (gable.y !== undefined) { // south gable wall under a ridge along Y
          const X = sx + gable.y, Z = (X + gable.y) / 2 - sy;
          if (X >= gable.x0 && X < gable.x1 && Z >= gable.z0 && Z < heightAt(X, Math.min(gable.y, y1 - 1e-3)) - 0.4) {
            reset(2); gable.fn(2, X, gable.y, Z); put(px, py, X + gable.y + Z, X, gable.y, Z);
          }
        }
      }
    }
    return zTop;
  }

  // ------------------------------------------------- cylinders, cones, blobs
  // A pixel's view ray is P(t) = (X0 + t, Y0 + t, t), where (X0, Y0) is where it
  // meets the ground; t grows towards the camera, and depth = X + Y + Z.
  function cylinder(xc, yc, r, z0, z1, matFn, cap = true) {
    for (let y = Math.floor(yc - r); y <= yc + r; y++) for (let x = Math.floor(xc - r); x <= xc + r; x++) {
      if (Math.hypot(x + 0.5 - xc, y + 0.5 - yc) <= r) stamp(x, y, x + 1, y + 1, z1);
    }
    const [pxA, pxB, pyA, pyB] = bbox(xc - r, yc - r, xc + r, yc + r, z0, z1);
    for (let py = pyA; py <= pyB; py++) {
      const sy = py + 0.5 - cy;
      for (let px = pxA; px <= pxB; px++) {
        const sx = px + 0.5 - cx;
        const u = sy + sx / 2 - xc, v = sy - sx / 2 - yc;
        if (cap) {
          const X = u + z1, Y = v + z1;
          if (X * X + Y * Y <= r * r) { reset(0); matFn(0, X + xc, Y + yc, z1, Math.atan2(Y, X)); put(px, py, X + Y + xc + yc + z1, X + xc, Y + yc, z1); continue; }
        }
        const disc = (u + v) * (u + v) - 2 * (u * u + v * v - r * r);
        if (disc < 0) continue;
        const t = (-(u + v) + Math.sqrt(disc)) / 2;
        if (t < z0 || t >= z1) continue;
        const X = u + t, Y = v + t;
        reset(1); setN([X / r, Y / r, 0]);
        matFn(1, X + xc, Y + yc, t, Math.atan2(Y, X));
        put(px, py, X + Y + xc + yc + t, X + xc, Y + yc, t);
      }
    }
  }

  // Upright cone, base radius r at z0, apex at z0 + h.
  function cone(xc, yc, r, z0, h, matFn) {
    const k = r / h, apex = z0 + h;
    for (let y = Math.floor(yc - r); y <= yc + r; y++) for (let x = Math.floor(xc - r); x <= xc + r; x++) {
      const d = Math.hypot(x + 0.5 - xc, y + 0.5 - yc);
      if (d <= r) stamp(x, y, x + 1, y + 1, apex - d / k);
    }
    maxH = Math.max(maxH, apex);
    const [pxA, pxB, pyA, pyB] = bbox(xc - r, yc - r, xc + r, yc + r, z0, apex);
    const nz = k / Math.sqrt(1 + k * k), nr = 1 / Math.sqrt(1 + k * k);
    for (let py = pyA; py <= pyB; py++) {
      const sy = py + 0.5 - cy;
      for (let px = pxA; px <= pxB; px++) {
        const sx = px + 0.5 - cx;
        const u = sy + sx / 2 - xc, v = sy - sx / 2 - yc;
        // (u + t)^2 + (v + t)^2 = k^2 (apex - t)^2
        const A = 2 - k * k, B = 2 * (u + v) + 2 * k * k * apex, C = u * u + v * v - k * k * apex * apex;
        const disc = B * B - 4 * A * C;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        let t = -1e9;
        for (const tt of [(-B + sq) / (2 * A), (-B - sq) / (2 * A)]) if (tt >= z0 && tt <= apex && tt > t) t = tt;
        if (t < z0) continue;
        const X = u + t, Y = v + t, rho = Math.hypot(X, Y) || 1;
        reset(0); setN([(X / rho) * nr, (Y / rho) * nr, nz]);
        matFn(0, X + xc, Y + yc, t, rho / r);
        put(px, py, X + Y + xc + yc + t, X + xc, Y + yc, t);
      }
    }
  }

  // Noisy sphere drawn per pixel with real normals and depth (tree canopies,
  // rocks, bushes). colorFn(h, px, py, n) sets M.c and anything else.
  function blob(X, Y, Z, rad, colorFn, { density = 1, seed = 1, squash = 1, doStamp = true, rough = 0.32 } = {}) {
    if (doStamp && density > 0.3) {
      for (let yy = Math.floor(Y - rad); yy <= Y + rad; yy++) for (let xx = Math.floor(X - rad); xx <= X + rad; xx++) {
        const d = Math.hypot(xx + 0.5 - X, yy + 0.5 - Y);
        if (d < rad) stamp(xx, yy, xx + 1, yy + 1, Z + Math.sqrt(rad * rad - d * d) * 0.8 * squash);
      }
    }
    const scx = X - Y + cx, scy = (X + Y) / 2 - Z + cy;
    const rx = rad * 1.414, ry = rad * 1.225 * squash;
    for (let py = Math.max(0, Math.floor(scy - ry - 1)); py <= Math.min(H - 1, Math.ceil(scy + ry + 1)); py++) {
      for (let px = Math.max(0, Math.floor(scx - rx - 1)); px <= Math.min(W - 1, Math.ceil(scx + rx + 1)); px++) {
        const u = (px + 0.5 - scx) / rx, v = (py + 0.5 - scy) / ry;
        const d2 = u * u + v * v;
        const edge = 1 - rough + rough * noise2(px * 0.5, py * 0.5, seed);
        if (d2 > edge * edge || d2 >= 1) continue;
        if (density < 1) {
          const keep = 0.6 * noise2(px * 0.35, py * 0.35, seed + 1) + 0.4 * hash2(px, py, seed + 2);
          if (keep > density * 1.08) continue;
        }
        const w = Math.sqrt(1 - d2);
        const n = norm([u * RIGHT[0] - v * UP[0] + w * VIEW[0], u * RIGHT[1] - v * UP[1] + w * VIEW[1], u * RIGHT[2] - v * UP[2] + w * VIEW[2]]);
        const Pw = [X + n[0] * rad, Y + n[1] * rad, Z + n[2] * rad * squash];
        reset(0); setN(n);
        colorFn(hash2(px, py, seed + 3), px, py, n);
        put(px, py, Pw[0] + Pw[1] + Pw[2], X, Y, Pw[2]);
      }
    }
  }

  // ------------------------------------------------------------------ trees
  // species: 'broad' (city street tree), 'cherry', 'maple', 'pine'
  function tree(X, Y, r, season, { big = 1, species = 'broad', z0 = 0 } = {}) {
    if (species === 'pine') return pine(X, Y, r, big, z0);
    const rad = r.float(3.4, 4.8) * big;
    const th = Math.round(r.int(4, 6) * Math.max(1, big * 0.8));
    const cz = z0 + th + rad * 0.85;
    if (!onScreen(X - rad, Y - rad, X + rad, Y + rad, cz + rad)) return;
    const bare = season.density < 0.3;
    box(X, Y, X + 1, Y + 1, z0, z0 + th, solid(BARK));

    // bare branches (screen space), visible through thin or missing foliage
    const tsx = X - Y + cx, tsy = (X + Y + 1) / 2 - (z0 + th) + cy;
    const depthT = X + Y + 1 + z0 + th;
    const branch = (x, y, ang, len, dpt) => {
      for (let s = 0; s <= Math.ceil(len); s++) {
        const px = Math.round(x + Math.cos(ang) * s), py = Math.round(y - Math.sin(ang) * s);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        reset(0); M.c = dpt < 2 ? BARK : shade(BARK, 0.75); setN([VIEW[0] * 0.6, VIEW[1] * 0.6, 0.75]);
        put(px, py, depthT + 0.5, X, Y, z0 + th + (tsy - py));
      }
      if (dpt >= 2 || len < 2.5) return;
      for (let k = 0; k < 2; k++) branch(x + Math.cos(ang) * len, y - Math.sin(ang) * len, ang + r.float(-0.7, 0.7), len * r.float(0.55, 0.75), dpt + 1);
    };
    branch(tsx, tsy, Math.PI / 2 + r.float(-0.15, 0.15), rad * 0.75, 0);
    branch(tsx, tsy, Math.PI / 2 + r.float(0.55, 0.9), rad * 0.8, 1);
    branch(tsx, tsy, Math.PI / 2 - r.float(0.55, 0.9), rad * 0.8, 1);
    if (bare) {
      branch(tsx, tsy - rad * 0.4, Math.PI / 2 + 1.1, rad * 0.6, 1);
      branch(tsx, tsy - rad * 0.4, Math.PI / 2 - 1.1, rad * 0.6, 1);
    }
    let density = season.density, blossom = season.blossom;
    if (species === 'cherry') { blossom = Math.min(1, blossom * 2.2); if (blossom > 0.3) density = Math.max(density, 0.75); }
    if (density <= 0.02) return;
    const greens = season.fresh > 0.5 ? SPRING : GREENS;
    const autumnCols = species === 'maple' ? MAPLE : AUTUMN;
    const autumn = species === 'maple' ? Math.min(1, season.autumn * 1.4) : season.autumn;
    const sd = r.int(0, 1e6);
    blob(X + 0.5, Y + 0.5, cz, rad, (h, px, py) => {
      if (blossom > 0 && h < blossom * (species === 'cherry' ? 0.85 : 0.5)) M.c = BLOSSOM[Math.floor(h * 7) % 3];
      else if (noise2(px * 0.15, py * 0.15, sd + 4) < autumn * 1.1 - 0.05) M.c = autumnCols[Math.floor(h * 4) % 4];
      else M.c = greens[Math.floor(h * 3) % 3];
      M.f = F.FOLIAGE; M.r = Math.floor(h * 255);
    }, { density, seed: sd });
  }

  // Evergreen: stacked cones; pixels facing up catch speckles of snow.
  function pine(X, Y, r, big, z0) {
    const rad = r.float(3, 4.2) * big, h = rad * r.float(1.5, 1.9);
    const top = z0 + 2 + h * 1.9;
    if (!onScreen(X - rad, Y - rad, X + rad, Y + rad, top)) return;
    box(X, Y, X + 1, Y + 1, z0, z0 + 3, solid(BARK));
    const sd = r.int(0, 1e6);
    for (let i = 0; i < 3; i++) {
      const rr = rad * (1 - i * 0.28), zb = z0 + 2 + i * h * 0.45;
      cone(X + 0.5, Y + 0.5, rr, zb, h * (1 - i * 0.15), (face, x, y, z, rel) => {
        const n = hash2(Math.floor(x * 2), Math.floor(y * 2 + z * 3), sd);
        M.c = rel > 0.85 ? shade(PINE[1], 0.85) : PINE[Math.floor(n * 3) % 3];
        M.f = F.FOLIAGE;
        // clumps of snow appear as cover grows; the shaded lower boughs stay dark green
        M.s = clamp(Math.round((0.25 + n * 0.5 + rel * 0.4) * 255), 1, 255);
      });
    }
  }

  // -------------------------------------------------------------- lighting
  function lamp(X, Y, r, { z0 = 0, height = 10, col = [255, 190, 115], radius = 30 } = {}) {
    if (!onScreen(X, Y, X + 1, Y + 1, z0 + height + 3)) return;
    const thr = Math.round(r.float(0.2, 0.75) * 255);
    box(X, Y, X + 1, Y + 1, z0, z0 + height, solid(POLE));
    box(X - 0.5, Y - 0.5, X + 1.5, Y + 1.5, z0 + height, z0 + height + 2, (face) => {
      if (face === 0) { M.c = POLE_HI; return; }
      M.c = BULB; M.f = F.LAMP; M.e = thr;
    });
    box(X - 0.5, Y - 0.5, X + 1.5, Y + 1.5, z0 + height + 2, z0 + height + 2.6, edged(POLE_HI));
    lights.push({ X: X + 0.5, Y: Y + 0.5, Z: z0 + height + 1, kind: 0, thr: thr / 255, col: lin(col, 1.7), radius });
  }

  // ------------------------------------------------------------------ ground
  // Flat ground (Z = 0) under every pixel below the horizon. fn(X, Y) sets M.
  function ground(fn) {
    for (let py = hp; py < H; py++) {
      const sy = py + 0.5 - cy;
      for (let px = 0; px < W; px++) {
        const sx = px + 0.5 - cx;
        const X = sy + sx / 2, Y = sy - sx / 2;
        reset(0); fn(X, Y);
        put(px, py, X + Y, X, Y, 0);
      }
    }
  }
  const water = (c, foam = 0) => { M.c = c; M.f = F.GROUND | F.ROAD; M.f2 = F2.WATER; M.e = clamp(Math.round(foam * 255), 0, 255); };

  // Distant backdrop drawn in flat side view (skylines, mountains, hills) and
  // placed behind everything. A layer pixel's extra[3] can set its haze (0..255).
  function backdrop(draw) {
    const L = new Layer(W, H);
    draw(L, hp);
    for (let i = 0; i < N; i++) {
      if (zbuf[i] > -1e9 || L.albedo[i * 4 + 3] === 0) continue;
      const j = i * 4;
      const fx = (L.mat[j] - 128) / 127, fy = (L.mat[j + 1] - 128) / 127;
      reset(0);
      setN(norm([VIEW[0] * 0.8 + fx * RIGHT[0] + fy * UP[0], VIEW[1] * 0.8 + fx * RIGHT[1] + fy * UP[1], VIEW[2] * 0.8 + fx * RIGHT[2] + fy * UP[2]]));
      M.c = [L.albedo[j], L.albedo[j + 1], L.albedo[j + 2]];
      M.f = L.mat[j + 3]; M.e = L.mat[j + 2]; M.r = L.extra[j + 1]; M.s = L.extra[j]; M.f2 = F2.FAR;
      put(i % W, Math.floor(i / W), -1e8, 0, 0, 0, L.extra[j + 3] || 255);
    }
  }

  // Finalise: keep useful lights, mark hidden halos, and build the scene object.
  function finish(extra = {}) {
    let useful = lights.filter((l) => {
      const sx = l.X - l.Y + cx, sy = (l.X + l.Y) / 2 - l.Z + cy, rr = l.radius * 1.5;
      return sx > -rr && sx < W + rr && sy > hp - rr - 40 && sy < H + rr;
    });
    for (const l of useful) {
      const px = Math.floor(l.X - l.Y + cx), py = Math.floor((l.X + l.Y) / 2 - l.Z + cy);
      const inside = px >= 0 && py >= 0 && px < W && py < H;
      // a light inside its own glass (a lighthouse lantern) is never "behind" anything
      l.hidden = !l.exposed && (!inside || zbuf[py * W + px] > l.X + l.Y + l.Z + 4.5);
    }
    // lighthouse beams first, then visible lights, street lamps before door glows
    const rank = (l) => (l.kind === 3 ? -1 : l.kind);
    useful.sort((a, b) => (rank(a) === -1) - (rank(b) === -1) ? (rank(b) === -1) - (rank(a) === -1) : (a.hidden - b.hidden) || (rank(a) - rank(b)));
    useful = useful.slice(0, 160);
    return {
      kind: 'iso', W, H, VW, VH, PX, PY, cx, cy, zbuf, vents,
      lanes: [], boats: [], koi: [], fireflies: [], birds: 0,
      hpBuf: hp,
      groundY: hp - PY,            // horizon in picture coordinates (the sky doesn't pan)
      pan: { x: PX, y: PY },       // current buffer offset of the picture; set each frame
      alb, mat, ext, pos, hmap, HMW, HMH, Xmin, Ymin, maxH: maxH + 2,
      lights: useful,
      isSky(x, y) {
        const bx = x + this.pan.x, by = y + this.pan.y;
        return bx >= 0 && by >= 0 && bx < W && by < H && alb[(by * W + bx) * 4 + 3] === 0;
      },
      hitFront: () => false,
      killY(z) { const t = hp - this.pan.y, lo = t + (VH - t) * z * 0.5; return lo + Math.random() * (VH - lo); },
      ...extra,
    };
  }

  return {
    W, H, VW, VH, PX, PY, cx, cy, hp, bottom, M, lights, vents,
    Xmin, Xmax, Ymin, Ymax, zbuf, alb,
    reset, setN, tilt, put, stamp, onScreen, box, solid, edged, roof, cylinder, cone, blob,
    tree, lamp, ground, water, backdrop, finish,
  };
}
