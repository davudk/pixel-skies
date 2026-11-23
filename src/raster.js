// Pixel-exact drawing into "material" layers.
//
// Every layer pixel stores more than a colour, so the shader can relight it:
//   albedo  RGBA  base colour (sRGB), alpha 255 = solid
//   mat     R,G   surface normal x/y (128 = 0, y is "up")
//           B     emissive threshold (windows/lamps switch on when it gets dark enough)
//           A     flags (see F)
//   extra   R     snow threshold: pixel turns to snow once snow cover >= R/255
//           G     per-object random value (flicker, late-night lights-out)
import { noise2 } from './rng.js';

export const F = {
  WINDOW: 1,  // lit at night, dark reflective glass by day
  NEON: 2,    // glowing tube
  GLASS: 4,   // reflects the sky
  FOLIAGE: 8,
  GROUND: 16, // gets wet / snow-covered as a whole surface
  ROAD: 32,   // mirror reflections when wet
  LAMP: 64,   // street lamp bulb
  BLINK: 128, // aviation light
};

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
export const shade = (c, f) => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
export const mix = (a, b, t) => [
  clamp255(a[0] + (b[0] - a[0]) * t),
  clamp255(a[1] + (b[1] - a[1]) * t),
  clamp255(a[2] + (b[2] - a[2]) * t),
];
// sRGB 0..255 -> linear 0..1, times k (used for light colours)
export const lin = (c, k = 1) => c.map((v) => Math.pow(v / 255, 2.2) * k);

const NONE = {};

export class Layer {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h * 4;
    this.albedo = new Uint8Array(n);
    this.mat = new Uint8Array(n);
    this.extra = new Uint8Array(n);
    for (let i = 0; i < n; i += 4) { this.mat[i] = 128; this.mat[i + 1] = 128; }
  }

  put(x, y, c, o = NONE) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.albedo[i] = c[0]; this.albedo[i + 1] = c[1]; this.albedo[i + 2] = c[2]; this.albedo[i + 3] = 255;
    this.mat[i] = 128 + Math.round((o.nx || 0) * 127);
    this.mat[i + 1] = 128 + Math.round((o.ny || 0) * 127);
    this.mat[i + 2] = o.e || 0;
    this.mat[i + 3] = o.f || 0;
    this.extra[i] = 0;
    this.extra[i + 1] = o.r || 0;
    this.extra[i + 2] = 0;
  }

  rect(x, y, w, h, c, o) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.put(xx, yy, c, o);
  }

  line(x0, y0, x1, y1, c, o) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.put(x0, y0, c, o);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

// Marks where snow can settle. Upward-facing surfaces with open air above get
// a pile that grows (pixel by pixel) as snow cover rises; ledges against a wall
// get a 1px cap. Pile edges taper so drifts look rounded.
export function computeSnow(L, rng, maxPile) {
  const { w, h, albedo, mat, extra } = L;
  const solid = (i) => albedo[i * 4 + 3] > 0;
  const upward = (i) => solid(i) && mat[i * 4 + 1] >= 185 && !(mat[i * 4 + 3] & F.GROUND); // ny > ~0.45
  const isCatch = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (upward(i) && (y === 0 || !upward(i - w))) isCatch[i] = 1;
  }
  const thrByte = (t) => Math.max(1, Math.min(255, Math.round(t * 255)));
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!isCatch[y * w + x]) { x++; continue; }
      let x1 = x;
      while (x1 + 1 < w && isCatch[y * w + x1 + 1]) x1++;
      for (let xx = x; xx <= x1; xx++) {
        const i = y * w + xx;
        if (x1 === x) {
          // lone pixel: only keep it if it's part of a diagonal slope
          let nb = 0;
          for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
            const X = xx + dx, Y = y + dy;
            if (X >= 0 && X < w && Y >= 0 && Y < h && isCatch[Y * w + X]) nb++;
          }
          if (nb === 0) continue;
        }
        extra[i * 4] = thrByte(0.05 + rng.next() * 0.07);
        const open = y === 0 || !solid(i - w);
        const edge = Math.min(xx - x, x1 - xx);
        let depth = open ? Math.round(maxPile * (0.55 + 0.45 * noise2(xx * 0.21, y * 0.3, 9))) : 1;
        depth = Math.min(depth, 1 + edge);
        for (let d = 1; d <= depth; d++) {
          const yy = y - d;
          if (yy < 0) break;
          const j = yy * w + xx;
          if (upward(j) || (open && solid(j))) break;
          const b = thrByte(0.14 + (d / depth) * 0.72 + (rng.next() - 0.5) * 0.08);
          if (extra[j * 4] === 0 || extra[j * 4] > b) extra[j * 4] = b;
        }
      }
      x = x1 + 1;
    }
  }
}
