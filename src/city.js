// Procedural pixel-art city. Builds 4 parallax layers (far skyline → street)
// at whatever low resolution fits the screen, plus a list of light sources.
import { Layer, F, hex, shade, lin, computeSnow } from './raster.js';
import { RNG, hash2, noise2 } from './rng.js';

export const LIT = [0xffd58f, 0xffc870, 0xffe4ae, 0xffb468, 0xdcecff, 0xfff0cf, 0xffd0a0].map(hex);
const OFFICE = [0xdcecff, 0xeaf4ff, 0xfff0cf].map(hex);
export const NEON = [0xff3d8b, 0x3debff, 0xc05cff, 0xffe04a, 0x4dff8a, 0xff6a3d].map(hex);
const STYLES = [
  { col: 0x8a3e34, tex: 'brick' }, { col: 0x9a5a44, tex: 'brick' }, { col: 0x6a4536, tex: 'brick' },
  { col: 0xbfa680, tex: 'stone' }, { col: 0xa98a62, tex: 'stone' },
  { col: 0x41696a, tex: 'panel' }, { col: 0x6f737c, tex: 'panel' }, { col: 0x3f4b6c, tex: 'panel' },
];
export const AWNINGS = [[0xb8342f, 0xe9e1d2], [0x2f6b40, 0xe9e1d2], [0x2b3f7a, 0xdadada], [0xc8792b, 0x3d2a1c], [0x6a2a5a, 0xe0d0e0]];
export const AUTUMN = [0xc8692a, 0xdc9a30, 0xa8432a, 0xe0b040].map(hex);
export const GREENS = [0x3e7a3a, 0x2f6434, 0x56904a].map(hex);
export const SPRING = [0x6fae4c, 0x8cc65a, 0x5a9a42].map(hex);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Emissive threshold byte: the window lights once "night" (0..1) passes it.
function winThr(rng, pNever = 0.35) {
  if (rng.chance(pNever)) return 255;
  if (rng.chance(0.06)) return 3; // lit even by day
  return Math.round(rng.float(0.12, 0.97) * 255);
}

// Solid block with lit edges: left/right columns face sideways, top row faces up.
function box(L, x, y, w, h, col, edge = 0.7) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    let nx = xx === x ? -edge : xx === x + w - 1 ? edge : 0, ny = 0, c = col;
    if (yy === y) { ny = 0.85; nx *= 0.5; c = shade(col, 1.12); }
    L.put(xx, yy, c, { nx, ny });
  }
}

export function generateCity(W, H, seed, season) {
  const rng = new RNG(seed);
  const margin = 24;
  const LW = W + margin * 2;
  const groundY = Math.round(H * 0.8);
  const curbY = groundY + Math.max(5, Math.round(H * 0.045));
  const layers = [0, 1, 2, 3].map(() => new Layer(LW, H));
  const lights = [];

  drawFar(layers[0], new RNG(rng.int(0, 1e9)), groundY);
  drawMid(layers[1], new RNG(rng.int(0, 1e9)), groundY);
  drawNear(layers[2], new RNG(rng.int(0, 1e9)), groundY, lights);
  drawStreet(layers[3], new RNG(rng.int(0, 1e9)), H, groundY, curbY, lights, season);

  const srng = new RNG(seed ^ 0x5f3759df);
  [2, 3, 4, 5].forEach((pile, i) => computeSnow(layers[i], srng, Math.max(1, Math.round(pile * H / 216))));

  // Lamps first so they survive the cap on light count.
  lights.sort((a, b) => a.kind - b.kind);
  const solidAt = (l, x, y, ignoreGround, offs) => {
    const L = layers[l], lx = x + margin - offs[l];
    if (lx < 0 || lx >= LW || y < 0 || y >= H) return false;
    const i = (y * LW + lx) * 4;
    return L.albedo[i + 3] > 0 && !(ignoreGround && (L.mat[i + 3] & F.GROUND));
  };
  return {
    kind: 'side', layers, lights: lights.slice(0, 64), margin, LW, W, H, groundY, curbY, roadAxis: curbY + 1,
    // used by the particle system
    isSky: (x, y, offs) => ![0, 1, 2, 3].some((l) => solidAt(l, x, y, false, offs)),
    hitFront: (x, y, offs) => solidAt(3, x, y, true, offs),
    killY: (z) => (z < 0.5 ? groundY * (0.55 + Math.random() * 0.45) : groundY + Math.random() * (H - groundY)),
  };
}

// ---------------------------------------------------------------- far skyline
export function drawFar(L, rng, gY) {
  const base = hex(0x2b3352);
  let x = -rng.int(0, 6), idx = 0;
  const seedBase = rng.int(0, 1e9);
  while (x < L.w) {
    const rng = new RNG(seedBase + 7919 * idx++); // per-building seed: stable when the screen resizes
    const w = rng.int(6, 18);
    let h = Math.round(gY * rng.float(0.3, 0.6));
    if (rng.chance(0.15)) h = Math.round(gY * rng.float(0.64, 0.8));
    const col = shade(base, rng.float(0.88, 1.12));
    const top = gY - h;
    box(L, x, top, w, h + 1, col);
    const px = rng.pick([2, 2, 3]), py = rng.pick([2, 3]);
    const density = rng.float(0.15, 0.4);
    for (let yy = top + 2; yy < gY - 1; yy += py) for (let xx = x + 1; xx < x + w - 1; xx += px) {
      if (!rng.chance(density)) continue;
      L.put(xx, yy, shade(rng.pick(LIT), 0.85), { f: F.WINDOW, e: winThr(rng, 0.3), r: rng.int(0, 255) });
    }
    if (h > gY * 0.45 && rng.chance(0.55)) {
      const w2 = Math.max(3, Math.round(w * rng.float(0.4, 0.7)));
      const h2 = rng.int(3, 9);
      const x2 = x + Math.floor((w - w2) / 2);
      box(L, x2, top - h2, w2, h2, col);
      if (rng.chance(0.6)) {
        const sx = x2 + Math.floor(w2 / 2), sh = rng.int(4, 12);
        L.rect(sx, top - h2 - sh, 1, sh, shade(col, 0.9));
        L.put(sx, top - h2 - sh - 1, hex(0x5a1410), { f: F.BLINK, r: rng.int(0, 255) });
      }
    }
    x += w - rng.int(0, 3);
  }
}

// ---------------------------------------------------------------- mid skyline
function drawMid(L, rng, gY) {
  let x = -rng.int(0, 10), idx = 0;
  const seedBase = rng.int(0, 1e9);
  while (x < L.w) {
    const rng = new RNG(seedBase + 7919 * idx++);
    const w = rng.int(12, 30);
    const h = Math.round(gY * rng.float(0.24, 0.55));
    const top = gY - h;
    const kind = rng.pick(['glass', 'concrete', 'concrete', 'brick']);
    if (kind === 'glass') {
      const col = shade(hex(0x34507a), rng.float(0.85, 1.1));
      const cells = new Map();
      const cellThr = (cx, cy) => {
        const k = cx * 1000 + cy;
        if (!cells.has(k)) cells.set(k, [winThr(rng, 0.35), rng.int(0, 255), rng.pick(OFFICE)]);
        return cells.get(k);
      };
      for (let yy = top; yy <= gY; yy++) for (let xx = x; xx < x + w; xx++) {
        const lx = xx - x, ly = yy - top;
        const nx = lx === 0 ? -0.7 : lx === w - 1 ? 0.7 : 0;
        if (ly === 0) { L.put(xx, yy, shade(col, 1.2), { nx: nx * 0.5, ny: 0.85 }); continue; }
        if (lx % 3 === 0 || ly % 3 === 0) { L.put(xx, yy, shade(col, 0.72), { nx }); continue; }
        const [thr, r, c] = cellThr(Math.floor(lx / 3), Math.floor(ly / 3));
        L.put(xx, yy, shade(c, 0.9), { nx, f: F.WINDOW | F.GLASS, e: thr, r });
      }
      if (rng.chance(0.4)) antenna(L, rng, x + Math.floor(w / 2), top - 1);
    } else {
      const col = shade(hex(kind === 'brick' ? 0x5c4250 : 0x4a5068), rng.float(0.85, 1.12));
      box(L, x, top, w, h + 1, col);
      const ww = rng.pick([1, 2]), gx = ww + 1 + rng.int(0, 1), gy = rng.pick([3, 4]);
      for (let yy = top + 3; yy < gY - 2; yy += gy) for (let xx = x + 2; xx + ww <= x + w - 2; xx += gx) {
        const thr = winThr(rng, 0.4), r = rng.int(0, 255), c = shade(rng.pick(LIT), 0.9);
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < ww; dx++) L.put(xx + dx, yy + dy, c, { f: F.WINDOW, e: thr, r });
      }
      if (rng.chance(0.35) && w >= 10) waterTower(L, rng, x + rng.int(1, w - 8), top - 1);
      else if (rng.chance(0.35)) acUnit(L, rng, x + rng.int(1, Math.max(1, w - 6)), top - 1);
    }
    x += w + rng.int(-2, 3);
  }
}

// ------------------------------------------------------------ near buildings
function drawNear(L, rng, gY, lights) {
  let x = -rng.int(0, 10), idx = 0;
  let prevH = 0;
  const seedBase = rng.int(0, 1e9);
  while (x < L.w) {
    const rng = new RNG(seedBase + 7919 * idx++);
    const w = rng.int(30, 58);
    let h;
    do { h = Math.round(gY * rng.float(0.17, 0.42)); } while (Math.abs(h - prevH) < 6);
    prevH = h;
    building(L, rng, x, w, gY - h, gY, lights);
    x += w;
  }
}

function building(L, rng, x0, w, top, base, lights) {
  const st = rng.pick(STYLES);
  const col = shade(hex(st.col), rng.float(0.9, 1.08));
  const dark = shade(col, 0.68), light = shade(col, 1.2);
  const seed = rng.int(0, 1e6);

  // facade with texture
  for (let y = top; y < base; y++) for (let x = x0; x < x0 + w; x++) {
    const lx = x - x0, ly = y - top;
    let f = 1;
    if (st.tex === 'brick') {
      if (ly % 3 === 2) f = 0.86;
      else if ((lx + (Math.floor(ly / 3) % 2) * 2) % 4 === 0) f = 0.94;
    } else if (st.tex === 'panel') {
      if (lx % 8 === 0 || ly % 9 === 0) f = 0.9;
    } else {
      if (ly % 4 === 3) f = 0.92;
      if ((lx < 2 || lx >= w - 2) && Math.floor(ly / 3) % 2 === 0) f = 1.12;
    }
    f *= 0.97 + hash2(x, y, seed) * 0.06;
    const nx = lx === 0 ? -0.75 : lx === w - 1 ? 0.75 : 0;
    L.put(x, y, shade(col, f), { nx });
  }

  // cornice (overhangs 1px each side, catches light and snow)
  for (let x = x0 - 1; x <= x0 + w; x++) L.put(x, top, light, { ny: 0.85 });
  for (let x = x0; x < x0 + w; x++) L.put(x, top + 1, dark, { ny: -0.6 });

  const pediment = rng.chance(0.3) && w > 34;
  if (pediment) {
    const pw = Math.round(w * rng.float(0.3, 0.45)), ph = rng.int(2, 4);
    const px = x0 + Math.floor((w - pw) / 2);
    L.rect(px, top - ph, pw, ph, col);
    for (let x = px; x < px + pw; x++) L.put(x, top - ph, light, { ny: 0.85 });
  }

  // upper floors
  const gH = rng.int(10, 12);
  const gTop = base - gH;
  const floorH = rng.int(7, 9);
  const ww = rng.pick([2, 3, 3, 4]);
  const wh = Math.min(rng.pick([4, 4, 5]), floorH - 3);
  const gap = rng.int(2, 4);
  const nCols = Math.max(1, Math.floor((w - 4 + gap) / (ww + gap)));
  const totW = nCols * ww + (nCols - 1) * gap;
  const sx = x0 + Math.floor((w - totW) / 2);
  const floors = [];
  for (let fy = top + 4; fy + wh + 1 < gTop - 1; fy += floorH) floors.push(fy);

  for (const fy of floors) for (let c = 0; c < nCols; c++) {
    const wx = sx + c * (ww + gap);
    const thr = winThr(rng), r = rng.int(0, 255), lit = rng.pick(LIT), curtain = rng.chance(0.3);
    for (let dx = -1; dx <= ww; dx++) {
      L.put(wx + dx, fy - 1, dark, { ny: -0.4 });            // lintel
      L.put(wx + dx, fy + wh, light, { ny: 0.85 });          // sill
    }
    for (let dy = 0; dy < wh; dy++) for (let dx = 0; dx < ww; dx++) {
      if ((ww === 3 && dx === 1) || (ww === 4 && dy === 1)) { L.put(wx + dx, fy + dy, dark); continue; }
      let cc = lit;
      if (dy === 0) cc = shade(lit, 0.82);
      if (curtain && (dx === 0 || dx === ww - 1)) cc = shade(lit, 0.62);
      L.put(wx + dx, fy + dy, cc, { f: F.WINDOW, e: thr, r });
    }
  }

  // ground floor
  for (let x = x0; x < x0 + w; x++) L.put(x, gTop, light, { ny: 0.85 });
  if (rng.chance(0.8)) shopfront(L, rng, x0, w, gTop, base, dark, lights, seed);
  else entrance(L, rng, x0, w, gTop, base, dark);

  // fire escape
  if (st.tex === 'brick' && w >= 34 && floors.length >= 2 && rng.chance(0.45)) {
    const metal = hex(0x24252b);
    const fw = rng.int(11, 15), fx = x0 + rng.int(3, w - fw - 3);
    for (let k = 0; k < floors.length; k++) {
      const py = floors[k] + wh + 1;
      for (let x = fx; x < fx + fw; x++) {
        L.put(x, py, metal, { ny: 0.85 });
        L.put(x, py - 3, metal, { ny: 0.5 });
        if ((x - fx) % 3 === 0) { L.put(x, py - 1, metal); L.put(x, py - 2, metal); }
      }
      if (k < floors.length - 1) {
        const py2 = floors[k + 1] + wh + 1;
        const a = fx + 1 + (k % 2) * (fw - 3), b = fx + 1 + ((k + 1) % 2) * (fw - 3);
        L.line(a, py + 1, b, py2 - 1, metal);
      }
    }
  }

  // neon blade sign
  if (floors.length >= 2 && rng.chance(0.45)) {
    const nc = rng.pick(NEON);
    const sw = 6, sh = rng.int(13, 20);
    const sxs = rng.chance(0.5) ? x0 + 1 : x0 + w - sw - 1;
    const sy = Math.max(top + 3, gTop - sh - 1);
    const seedN = rng.int(0, 255);
    const back = hex(0x1b1a22);
    for (let y = sy; y < sy + sh; y++) for (let x = sxs; x < sxs + sw; x++) {
      const border = x === sxs || x === sxs + sw - 1 || y === sy || y === sy + sh - 1;
      if (border) {
        L.put(x, y, back, { nx: x === sxs ? -0.6 : x === sxs + sw - 1 ? 0.6 : 0, ny: y === sy ? 0.85 : 0 });
        continue;
      }
      const ring = x === sxs + 1 || x === sxs + sw - 2 || y === sy + 1 || y === sy + sh - 2;
      if (ring || hash2(x, y, seed + 11) < 0.45) L.put(x, y, nc, { f: F.NEON, r: seedN });
      else L.put(x, y, shade(back, 0.8));
    }
    lights.push({ x: sxs + sw / 2, y: sy + sh / 2, layer: 2, kind: 1, thr: seedN / 255, col: lin(nc, 0.9), radius: 26 });
  }

  // rooftop clutter
  if (!pediment) {
    const n = rng.int(0, 3);
    for (let k = 0; k < n; k++) {
      const t = rng.next();
      const px = x0 + rng.int(2, Math.max(2, w - 10));
      if (t < 0.35) acUnit(L, rng, px, top - 1);
      else if (t < 0.6) vent(L, rng, px, top - 1);
      else if (t < 0.75) waterTower(L, rng, px, top - 1);
      else if (t < 0.88) hut(L, rng, px, top - 1);
      else antenna(L, rng, px, top - 1);
    }
  }
}

function shopfront(L, rng, x0, w, gTop, base, dark, lights, seed) {
  const aw = rng.pick(AWNINGS).map(hex);
  const sx0 = x0 + 2, sx1 = x0 + w - 3;
  for (let x = sx0 - 1; x <= sx1 + 1; x++) {
    const c = ((x - sx0 + 2) >> 1) & 1 ? aw[1] : aw[0];
    L.put(x, gTop + 1, shade(c, 1.05), { ny: 0.85 });
    L.put(x, gTop + 2, c, { ny: 0.35 });
    if ((x - sx0) % 2 === 0) L.put(x, gTop + 3, shade(c, 0.85), { ny: -0.3 });
  }
  const winTop = gTop + 5, winBot = base - 2;
  const doorW = 3, doorX = rng.chance(0.5) ? sx0 + 1 : sx1 - 3;
  const thr = Math.round(rng.float(0.03, 0.35) * 255), lit = rng.pick(LIT);
  for (let y = winTop; y <= winBot; y++) for (let x = sx0; x <= sx1; x++) {
    if (x >= doorX - 1 && x <= doorX + doorW) continue;
    if (x === sx0 || x === sx1 || y === winTop) { L.put(x, y, dark); continue; }
    let c = lit;
    if (y >= winBot - 1 && hash2(x, y, seed + 7) < 0.5) c = shade(lit, 0.45);
    L.put(x, y, c, { f: F.WINDOW, e: thr, r: 255 });
  }
  if (rng.chance(0.45)) {
    // little neon sign in the shop window
    const nc = rng.pick(NEON), r = rng.int(0, 255);
    const nx0 = doorX < (sx0 + sx1) / 2 ? sx1 - 6 : sx0 + 2;
    for (let dx = 0; dx < 4; dx++) L.put(nx0 + dx, winTop + 2, nc, { f: F.NEON, r });
    L.put(nx0, winTop + 3, nc, { f: F.NEON, r }); L.put(nx0 + 3, winTop + 3, nc, { f: F.NEON, r });
  }
  for (let x = sx0; x <= sx1; x++) L.put(x, base - 1, dark);
  const doorC = hex(rng.pick([0x3a2a20, 0x2a3440, 0x4a2020]));
  L.rect(doorX, winTop - 1, doorW, base - winTop + 1, doorC);
  L.put(doorX + 1, winTop + 1, lit, { f: F.WINDOW, e: thr, r: 255 });
  L.put(doorX + 2, winTop + 4, hex(0xd8c070));
  lights.push({ x: (sx0 + sx1) / 2, y: base - 3, layer: 2, kind: 2, thr: thr / 255, col: lin(lit, 0.55), radius: Math.min(32, (sx1 - sx0) * 0.6 + 10) });
}

function entrance(L, rng, x0, w, gTop, base, dark) {
  const doorX = x0 + Math.floor(w / 2) - 2;
  const doorC = hex(rng.pick([0x3a2a20, 0x2a3440, 0x24302a]));
  L.rect(doorX - 1, gTop + 3, 6, base - gTop - 3, dark);
  L.rect(doorX, gTop + 4, 4, base - gTop - 4, doorC);
  const thr = winThr(rng, 0.1), lit = rng.pick(LIT);
  L.rect(doorX, gTop + 4, 4, 1, lit, { f: F.WINDOW, e: thr, r: 255 });
  for (const wx of [x0 + 4, x0 + w - 8]) {
    const t = winThr(rng), r = rng.int(0, 255);
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      L.put(wx + dx, gTop + 4 + dy, dx === 1 || dx === 2 ? lit : shade(lit, 0.7), { f: F.WINDOW, e: t, r });
    }
  }
}

// --------------------------------------------------------------- roof props
function acUnit(L, rng, x, y) {
  const c = shade(hex(0x8a8d93), rng.float(0.85, 1.1));
  const w = rng.int(4, 6);
  for (let dx = 0; dx < w; dx++) {
    L.put(x + dx, y - 2, shade(c, 1.1), { ny: 0.85 });
    L.put(x + dx, y - 1, dx % 2 ? shade(c, 0.7) : c, { nx: dx === 0 ? -0.6 : dx === w - 1 ? 0.6 : 0 });
    L.put(x + dx, y, shade(c, 0.85));
  }
}

function vent(L, rng, x, y) {
  const c = hex(0x5a5d66), h = rng.int(2, 5);
  for (let i = 0; i < h; i++) L.put(x, y - i, c);
  L.rect(x - 1, y - h, 3, 1, shade(c, 1.15), { ny: 0.85 });
}

function hut(L, rng, x, y) {
  const c = shade(hex(0x6c6f78), rng.float(0.85, 1.1));
  box(L, x, y - 4, 7, 5, c);
  L.rect(x + 2, y - 2, 2, 3, hex(0x2a2a30));
}

function antenna(L, rng, x, y) {
  const c = hex(0x3a3d45), h = rng.int(7, 14);
  for (let i = 0; i < h; i++) L.put(x, y - i, c);
  L.rect(x - 1, y - Math.floor(h * 0.6), 3, 1, c);
  L.put(x, y - h, hex(0x5a1410), { f: F.BLINK, r: rng.int(0, 255) });
}

function waterTower(L, rng, x, y) {
  const wood = shade(hex(0x6e4a33), rng.float(0.85, 1.1)), dark = hex(0x2a2522), hoop = shade(wood, 0.6);
  const legH = 4, bw = 7, bh = 6;
  for (let i = 0; i < legH; i++) { L.put(x + 1, y - i, dark); L.put(x + bw - 2, y - i, dark); }
  L.rect(x + 1, y - 2, bw - 2, 1, dark);
  const by = y - legH - bh + 1;
  for (let yy = by; yy < by + bh; yy++) for (let xx = x; xx < x + bw; xx++) {
    const nx = ((xx - x) - (bw - 1) / 2) / ((bw - 1) / 2) * 0.8;
    L.put(xx, yy, (yy - by) % 3 === 1 ? hoop : wood, { nx });
  }
  for (let xx = x; xx < x + bw; xx++) L.put(xx, by - 1, dark, { nx: xx < x + 3 ? -0.4 : xx > x + 3 ? 0.4 : 0, ny: 0.6 });
  for (let xx = x + 1; xx < x + bw - 1; xx++) L.put(xx, by - 2, dark, { ny: 0.8 });
  for (let xx = x + 2; xx < x + bw - 2; xx++) L.put(xx, by - 3, dark, { ny: 0.85 });
}

// ------------------------------------------------------------------- street
function drawStreet(L, rng, H, gY, curbY, lights, season) {
  const sw = hex(0x8a8781), joint = hex(0x6f6d69);
  const seed = rng.int(0, 1e6);
  for (let y = gY; y < curbY; y++) for (let x = 0; x < L.w; x++) {
    let c = x % 12 === 0 ? joint : shade(sw, 0.96 + hash2(x, y, seed) * 0.08);
    if (y === gY) c = shade(sw, 0.6);
    else if (y === gY + 1) c = shade(sw, 0.82);
    L.put(x, y, c, { ny: 0.72, f: F.GROUND });
  }
  for (let x = 0; x < L.w; x++) {
    L.put(x, curbY, hex(0xa9a59e), { ny: 0.85 });
    L.put(x, curbY + 1, hex(0x56534f), { ny: -0.2 });
  }
  const roadTop = curbY + 2;
  const laneY = roadTop + Math.round((H - roadTop) * 0.55);
  for (let y = roadTop; y < H; y++) for (let x = 0; x < L.w; x++) {
    let c = shade(hex(0x2c2d33), 0.92 + hash2(x, y, seed + 5) * 0.16);
    if (y === roadTop) c = hex(0x1f2024);
    if (y === laneY && (x >> 3) % 2 === 0) c = hex(0xbfa452);
    L.put(x, y, c, { ny: 0.8, f: F.GROUND | F.ROAD });
  }

  // fallen leaves in autumn
  const leaves = Math.round(L.w * 0.3 * season.autumn * (1.2 - season.density));
  for (let i = 0; i < leaves; i++) {
    L.put(rng.int(0, L.w - 1), rng.int(gY + 2, curbY - 1), rng.pick(AUTUMN), { ny: 0.72, f: F.GROUND });
  }

  let x = rng.int(12, 40), idx = 0;
  const seedBase = rng.int(0, 1e9);
  while (x < L.w - 4) {
    const rng = new RNG(seedBase + 7919 * idx++);
    lamp(L, rng, x, curbY - 1, H, lights);
    const gap = rng.int(72, 112);
    if (rng.chance(0.8)) tree(L, rng, Math.round(x + gap * rng.float(0.38, 0.62)), curbY - 2, H, season);
    const px = Math.round(x + gap * rng.pick([0.2, 0.8]));
    const r = rng.next();
    if (r < 0.3) bench(L, px, curbY);
    else if (r < 0.5) hydrant(L, px, curbY - 1);
    else if (r < 0.65) bin(L, px, curbY - 1);
    x += gap;
  }
}

function lamp(L, rng, x, baseY, H, lights) {
  const pole = hex(0x262a32), hi = hex(0x3b414d);
  const ph = Math.round(H * 0.15);
  L.rect(x - 1, baseY - 1, 3, 2, pole);
  for (let y = baseY - ph; y < baseY - 1; y++) L.put(x, y, pole);
  const ty = baseY - ph;
  const thr = Math.round(rng.float(0.2, 0.75) * 255);
  L.rect(x - 1, ty - 1, 3, 1, pole);
  for (let y = ty - 4; y <= ty - 2; y++) {
    L.put(x - 2, y, pole, { nx: -0.7 });
    L.put(x + 2, y, pole, { nx: 0.7 });
    for (let xx = x - 1; xx <= x + 1; xx++) L.put(xx, y, hex(0xe9dfc2), { f: F.LAMP, e: thr });
  }
  L.rect(x - 2, ty - 5, 5, 1, hi, { ny: 0.8 });
  L.rect(x - 1, ty - 6, 3, 1, hi, { ny: 0.85 });
  L.put(x, ty - 7, pole);
  lights.push({ x, y: ty - 3, layer: 3, kind: 0, thr: thr / 255, col: lin([255, 190, 115], 1.7), radius: Math.round(H * 0.24) });
}

export function tree(L, rng, cx, baseY, H, season) {
  const bark = hex(0x4a3527), barkD = hex(0x35261c);
  const th = Math.round(H * rng.float(0.05, 0.07));
  const topY = baseY - th;
  for (let y = topY; y <= baseY; y++) { L.put(cx, y, bark, { nx: -0.6 }); L.put(cx + 1, y, barkD, { nx: 0.6 }); }
  L.rect(cx - 2, baseY + 1, 6, 1, hex(0x3a3633), { ny: 0.7 });

  const tips = [];
  const branch = (x, y, ang, len, depth) => {
    const x2 = x + Math.cos(ang) * len, y2 = y - Math.sin(ang) * len;
    L.line(x, y, x2, y2, depth < 2 ? bark : barkD, { ny: 0.5 });
    if (depth >= 2 || len < 3) { tips.push([x2, y2]); return; }
    const n = depth === 0 ? 3 : 2;
    for (let k = 0; k < n; k++) branch(x2, y2, ang + rng.float(-0.75, 0.75), len * rng.float(0.55, 0.78), depth + 1);
  };
  const len0 = H * rng.float(0.035, 0.05);
  branch(cx + 0.5, topY, Math.PI / 2 + rng.float(-0.15, 0.15), len0, 0);
  branch(cx + 0.5, topY + 2, Math.PI / 2 + 0.9, len0 * 0.75, 1);
  branch(cx + 0.5, topY + 3, Math.PI / 2 - 0.9, len0 * 0.75, 1);

  if (season.density <= 0.02) return;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, ccx = 0, ccy = 0;
  for (const [tx, ty] of tips) {
    minX = Math.min(minX, tx); maxX = Math.max(maxX, tx);
    minY = Math.min(minY, ty); maxY = Math.max(maxY, ty);
    ccx += tx / tips.length; ccy += ty / tips.length;
  }
  const R = rng.float(3.4, 4.8) * Math.max(1, H / 216);
  const rx = (maxX - minX) / 2 + R, ry = (maxY - minY) / 2 + R;
  const seed = rng.int(0, 1e6);
  const greens = season.fresh > 0.5 ? SPRING : GREENS;
  for (let y = Math.floor(minY - R); y <= maxY + R; y++) for (let x = Math.floor(minX - R); x <= maxX + R; x++) {
    let dmin = 1e9;
    for (const [tx, ty] of tips) dmin = Math.min(dmin, Math.hypot(x - tx, (y - ty) * 1.15));
    if (dmin > R * (0.75 + 0.5 * noise2(x * 0.5, y * 0.5, seed))) continue;
    const v = 0.6 * noise2(x * 0.35, y * 0.35, seed + 1) + 0.4 * hash2(x, y, seed + 2);
    if (v > season.density * 1.08) continue;
    const nx = clamp((x - ccx) / rx, -1, 1) * 0.8;
    const ny = clamp(-(y - ccy) / ry, -1, 1) * 0.8;
    const h = hash2(x, y, seed + 3);
    let c;
    if (season.blossom > 0 && h < season.blossom * 0.5) c = hex(h < season.blossom * 0.25 ? 0xf6c1d4 : 0xe98fb0);
    else if (noise2(x * 0.15, y * 0.15, seed + 4) < season.autumn * 1.1 - 0.05) c = AUTUMN[Math.floor(h * 4) % 4];
    else c = greens[Math.floor(h * 3) % 3];
    L.put(x, y, c, { nx, ny, f: F.FOLIAGE, r: Math.floor(h * 255) });
  }
}

function bench(L, x, curbY) {
  const wood = hex(0x6b4a32), metal = hex(0x2b2b30);
  const y = curbY - 6;
  L.rect(x, y, 8, 1, shade(wood, 0.9));
  L.rect(x, y + 2, 8, 1, wood, { ny: 0.85 });
  L.put(x + 1, y + 1, metal); L.put(x + 6, y + 1, metal);
  for (let i = 3; i <= 5; i++) { L.put(x + 1, y + i, metal); L.put(x + 6, y + i, metal); }
}

function hydrant(L, x, baseY) {
  const red = hex(0xb8322a);
  L.rect(x, baseY - 3, 3, 4, red);
  L.put(x - 1, baseY - 2, shade(red, 0.8)); L.put(x + 3, baseY - 2, shade(red, 0.8));
  L.rect(x, baseY - 4, 3, 1, shade(red, 1.15), { ny: 0.85 });
  L.put(x + 1, baseY - 5, red, { ny: 0.85 });
}

function bin(L, x, baseY) {
  const c = hex(0x2f4a3a);
  L.rect(x, baseY - 4, 4, 5, c);
  L.rect(x - 1, baseY - 5, 6, 1, shade(c, 1.2), { ny: 0.85 });
}
