// Distant scenery drawn in flat side view, placed behind isometric scenes
// (see isokit backdrop()). Pixels carry normals so the sun can light the
// slopes, a snow threshold so they whiten with snow cover, and a haze amount
// in extra[3] (255 = farthest).
import { hex, shade, mix } from './raster.js';
import { RNG, noise2, hash2 } from './rng.js';

const hazeOf = (L, x, y, h) => { L.extra[(y * L.w + x) * 4 + 3] = h; };

// Sharp alpine ridges: absolute-value noise gives pointed peaks.
function ridge(x, seed, scale) {
  let v = 0, a = 0.55, f = 1 / scale;
  for (let i = 0; i < 4; i++) {
    v += a * (1 - Math.abs(2 * noise2(x * f, i * 7.1, seed) - 1));
    a *= 0.48; f *= 2.1;
  }
  return v;
}

// Two or three ranges of snow-capped mountains rising behind the horizon.
export function drawMountains(L, seed, gY, { height = 0.75, snowLine = 0.5 } = {}) {
  const rng = new RNG(seed);
  const ranges = [
    { col: hex(0x6f7f9c), peak: height, haze: 235, scale: 70, s: rng.int(0, 1e6) },
    { col: hex(0x52627a), peak: height * 0.72, haze: 185, scale: 55, s: rng.int(0, 1e6) },
    { col: hex(0x3d4c5a), peak: height * 0.45, haze: 140, scale: 40, s: rng.int(0, 1e6), trees: true },
  ];
  const snowCol = hex(0xe8eef6);
  for (const R of ranges) {
    const top = (x) => gY + 6 - gY * R.peak * (0.25 + 0.75 * ridge(x, R.s, R.scale));
    for (let x = 0; x < L.w; x++) {
      const t = top(x), slope = top(x + 1) - top(x - 1);
      const nx = Math.max(-0.85, Math.min(0.85, slope * 0.35));
      const peakness = (gY - t) / (gY * R.peak);                // 0 at foot .. 1 at summit
      for (let y = Math.max(0, Math.floor(t)); y < gY + 12 && y < L.h; y++) {
        const depth = y - t;
        let c = shade(R.col, 0.92 + noise2(x * 0.3, y * 0.15, R.s) * 0.16);
        if ((x + Math.floor(y * 0.5)) % 7 === 0) c = shade(c, 0.9);    // rock strata
        let snowThr = 0;
        const heightFrac = 1 - (y - (gY - gY * R.peak)) / (gY * R.peak);
        if (heightFrac > snowLine + 0.08 * noise2(x * 0.2, 1, R.s) && depth < 18 + peakness * 20) c = mix(snowCol, c, nx > 0.3 ? 0.25 : 0.05);
        else snowThr = Math.round(Math.min(1, 0.15 + (1 - heightFrac) * 0.8) * 255); // lower slopes whiten later
        if (R.trees && depth > 2 && hash2(x, y, R.s) < 0.25 && heightFrac < 0.55) {
          c = shade(hex(0x2c4a3a), 0.85);
          snowThr = Math.round((0.2 + hash2(y, x, R.s) * 0.45) * 255);   // snow-dusted forest
        } else if (R.trees) snowThr = Math.round((0.1 + hash2(y, x, R.s + 1) * 0.3) * 255);
        L.put(x, y, c, { nx, ny: depth < 1.5 ? 0.7 : 0.25 });
        L.extra[(y * L.w + x) * 4] = snowThr;
        hazeOf(L, x, y, R.haze);
      }
    }
  }
}

// Soft layered hills fading into mist, with tree-tufted crests.
export function drawHills(L, seed, gY) {
  const rng = new RNG(seed);
  const ranges = [
    { col: hex(0x7d93a0), amp: 0.42, haze: 240, scale: 90 },
    { col: hex(0x5f7d80), amp: 0.3, haze: 200, scale: 70 },
    { col: hex(0x4a6b5e), amp: 0.18, haze: 160, scale: 50, tufts: true },
  ];
  for (const R of ranges) {
    const s = rng.int(0, 1e6);
    const top = (x) => gY + 4 - gY * R.amp * (0.35 + 0.65 * (noise2(x / R.scale, 0, s) * 0.7 + noise2(x / (R.scale * 0.4), 3, s) * 0.3));
    for (let x = 0; x < L.w; x++) {
      let t = top(x);
      if (R.tufts && noise2(x * 0.5, 2, s) > 0.55) t -= 1 + Math.round(noise2(x * 0.9, 5, s) * 3);
      const slope = top(x + 1) - top(x - 1);
      for (let y = Math.max(0, Math.floor(t)); y < gY + 10 && y < L.h; y++) {
        const c = shade(R.col, 0.94 + noise2(x * 0.2, y * 0.2, s) * 0.12);
        L.put(x, y, c, { nx: Math.max(-0.7, Math.min(0.7, slope * 0.5)), ny: y - t < 1.5 ? 0.6 : 0.2 });
        L.extra[(y * L.w + x) * 4] = Math.round((0.35 + 0.5 * hash2(x, y, s)) * 255);
        hazeOf(L, x, y, R.haze);
      }
    }
  }
}

// A few low islands on the sea horizon.
export function drawIslands(L, seed, gY) {
  const rng = new RNG(seed);
  const n = rng.int(1, 3);
  for (let k = 0; k < n; k++) {
    const cx = rng.int(0, L.w), w = rng.int(40, 110), h = rng.int(5, 14);
    const s = rng.int(0, 1e6);
    for (let x = cx - w / 2; x < cx + w / 2; x++) {
      const u = (x - cx) / (w / 2);
      const t = gY - h * Math.pow(Math.max(0, 1 - u * u), 0.6) * (0.75 + 0.25 * noise2(x * 0.1, 0, s));
      for (let y = Math.floor(t); y <= gY; y++) {
        if (x < 0 || x >= L.w) continue;
        L.put(x, y, hex(0x5a6f7a), { nx: u * 0.5, ny: 0.4 });
        hazeOf(L, Math.round(x), y, 235);
      }
    }
  }
}
