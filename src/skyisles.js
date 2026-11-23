// Floating sky islands (side view): grassy islands with rocky undersides and
// dangling roots drift above a sea of clouds. The main island has a little
// village, a windmill and a waterfall pouring off its edge; a rope bridge
// links it to a neighbour, and smaller islands fade into the distance.
import { Layer, F, hex, shade, mix, lin, computeSnow } from './raster.js';
import { RNG, hash2, noise2 } from './rng.js';
import { tree, LIT } from './city.js';

const ROCK = [0x6e6258, 0x7a6e62, 0x5e544c, 0x857868].map(hex);
const DIRT = hex(0x6a4a32);
const ROOFS = [0xa8443a, 0x4a5a7a, 0x7a5a3a, 0x3e6a4a].map(hex);
const WALLS = [0xe6dcc8, 0xd8c8a8, 0xc8b8a0].map(hex);
const WATERFALL = 1; // extra.b flag the side shader animates

function grassOf(season) {
  const base = season.density < 0.3 ? hex(0x7a7a58) : season.fresh > 0.5 ? hex(0x6aa64a) : hex(0x5a9440);
  return mix(base, hex(0xa08a40), season.autumn * season.density * 0.6);
}

// One island: an uneven grassy top, a soil band, then rock tapering down to a
// jagged point, with roots and vines hanging off the underside.
function island(L, r, cx, topY, w, depth, season) {
  const s = r.int(0, 1e6), half = w / 2;
  const grass = grassOf(season);
  const topAt = (x) => {
    const e = Math.abs(x - cx) - (half - 5);
    return Math.round(topY + (noise2(x * 0.07, 1, s) - 0.5) * 3 + (e > 0 ? e * e * 0.18 : 0));
  };
  const botAt = (x) => {
    const u = (x - cx) / half;
    const spike = hash2(Math.floor(x / 2), 9, s) < 0.18 ? hash2(Math.floor(x / 2), 3, s) * 6 : 0;
    return topY + depth * Math.pow(Math.max(0, 1 - u * u), 0.75) * (0.7 + 0.5 * noise2(x * 0.1, 2, s)) + spike;
  };
  for (let x = Math.floor(cx - half); x <= cx + half; x++) {
    const t = topAt(x), b = botAt(x);
    if (b <= t + 1) continue;
    const edge = (x - cx) / half;
    for (let y = t; y <= b; y++) {
      const d = y - t, frac = (y - t) / Math.max(1, b - t);
      let c, nx = Math.abs(edge) > 0.85 ? Math.sign(edge) * 0.6 : 0, ny = 0;
      if (d < 2) { c = shade(grass, d === 0 ? 1.12 : 0.9 + hash2(x, y, s) * 0.1); ny = d === 0 ? 0.85 : 0.3; }
      else if (d < 5) c = shade(DIRT, 0.85 + hash2(x, y, s + 1) * 0.2);
      else {
        c = ROCK[Math.floor(noise2(x * 0.15, y * 0.4, s + 2) * 4) % 4];
        if ((y + Math.floor(x * 0.3)) % 5 === 0) c = shade(c, 0.85);   // strata
        c = shade(c, 1 - frac * 0.35);
        if (y > b - 2) ny = -0.6;
      }
      L.put(x, y, c, { nx, ny });
    }
    // dangling roots and vines
    if (hash2(x, 5, s) < 0.12) {
      const len = 3 + Math.floor(hash2(x, 6, s) * 9), vine = hash2(x, 7, s) < 0.5;
      for (let k = 1; k <= len; k++) L.put(x + (k > len / 2 && hash2(x, k, s) < 0.3 ? 1 : 0), Math.round(b) + k, vine ? shade(hex(0x3e6a34), 1 - k / (len * 2)) : shade(DIRT, 0.7));
    }
  }
  return { topAt, x0: Math.floor(cx - half), x1: Math.floor(cx + half), cx, topY, w };
}

// Side-view cottage with a pitched roof, lit windows and a chimney.
function cottage(L, r, x, baseY, w, h, lights, layer) {
  const wall = r.pick(WALLS), roof = r.pick(ROOFS), lit = r.pick(LIT);
  for (let yy = baseY - h; yy < baseY; yy++) for (let xx = x; xx < x + w; xx++) {
    const lx = xx - x, ly = yy - (baseY - h);
    let c = shade(wall, 0.96 + hash2(xx, yy, 3) * 0.06), o = { nx: lx === 0 ? -0.7 : lx === w - 1 ? 0.7 : 0 };
    if (ly >= h - 4 && lx >= Math.floor(w / 2) - 1 && lx < Math.floor(w / 2) + 1) c = hex(0x4a3020);           // door
    else if (ly >= 2 && ly < 4 && (lx % 4 === 1 || lx % 4 === 2) && lx < w - 1) { c = lit; o = { f: F.WINDOW, e: Math.round(r.float(0.1, 0.6) * 255), r: 255 }; }
    L.put(xx, yy, c, o);
  }
  const rh = Math.ceil((w + 2) / 2);
  for (let k = 0; k < rh; k++) {
    const y = baseY - h - 1 - k;
    for (let xx = x - 1 + k; xx <= x + w - k; xx++) {
      const left = xx < x + w / 2;
      L.put(xx, y, k === 0 && (xx === x - 1 || xx === x + w) ? shade(roof, 0.7) : shade(roof, (xx + k) % 2 ? 1 : 0.9), { nx: left ? -0.55 : 0.55, ny: 0.7 });
    }
  }
  const chx = x + w - 3;
  for (let y = baseY - h - rh - 1; y < baseY - h - Math.floor(rh / 2); y++) L.put(chx, y, hex(0x7a6e66), { nx: 0.4 });
  lights.push({ x: x + w / 2, y: baseY - 3, layer, kind: 2, thr: 0.3, col: lin(lit, 0.4), radius: 14 });
}

function windmill(L, r, x, baseY, layer) {
  const body = hex(0xd8ccb4), cap = hex(0x8a4a3a), sail = hex(0xe8e0d0), frame = hex(0x5a4a3a);
  const h = 16;
  for (let k = 0; k < h; k++) {
    const half = Math.round(4 - k * 0.12);
    for (let xx = x - half; xx <= x + half; xx++) L.put(xx, baseY - k, shade(body, 0.95 + hash2(xx, k, 2) * 0.06), { nx: (xx - x) / 5 });
  }
  for (let k = 0; k < 4; k++) for (let xx = x - 3 + k; xx <= x + 3 - k; xx++) L.put(xx, baseY - h - k, cap, { nx: (xx - x) / 4, ny: 0.7 });
  L.put(x, baseY - 5, hex(0xffd890), { f: F.WINDOW, e: 80, r: 255 });
  const hubY = baseY - h + 1;
  for (const [dx, dy] of [[1, -1], [1, 1], [-1, 1], [-1, -1]]) {
    for (let k = 1; k <= 10; k++) {
      L.put(x + dx * k, hubY + dy * k, frame);
      if (k > 3) L.put(x + dx * k + (dy > 0 ? -dx : dx) * 0, hubY + dy * k - dy, sail, { ny: 0.2 });
    }
  }
}

function lantern(L, r, x, baseY, lights, layer) {
  const thr = Math.round(r.float(0.2, 0.6) * 255);
  for (let y = baseY - 7; y < baseY; y++) L.put(x, y, hex(0x2a2a30));
  L.put(x - 1, baseY - 8, hex(0x2a2a30)); L.put(x + 1, baseY - 8, hex(0x2a2a30));
  L.put(x, baseY - 8, hex(0xf2e0b0), { f: F.LAMP, e: thr });
  L.put(x, baseY - 9, hex(0x3a3a40), { ny: 0.85 });
  lights.push({ x, y: baseY - 8, layer, kind: 0, thr: thr / 255, col: lin([255, 190, 110], 1.4), radius: 22 });
}

function waterfall(L, x, y0, y1) {
  for (let y = y0; y < y1; y++) for (let dx = 0; dx < 3; dx++) {
    if (dx === 2 && y < y0 + 2) continue;
    L.put(x + dx, y, hex(0x8ab4d8));
    L.extra[(y * L.w + x + dx) * 4 + 2] = WATERFALL;
  }
}

function bridge(L, xa, ya, xb, yb) {
  const rope = hex(0x5a4632), plank = hex(0x8a6a44);
  for (let x = xa; x <= xb; x++) {
    const t = (x - xa) / (xb - xa), sag = Math.sin(t * Math.PI) * 5;
    const y = Math.round(ya + (yb - ya) * t + sag);
    L.put(x, y, x % 2 ? plank : shade(plank, 0.85), { ny: 0.6 });
    L.put(x, y - 3, rope);
    if (x % 4 === 0) { L.put(x, y - 1, rope); L.put(x, y - 2, rope); }
  }
}

export function generateSkyIsles(W, H, seed, season) {
  const rng = new RNG(seed);
  const margin = 24, LW = W + margin * 2;
  const layers = [0, 1, 2, 3].map(() => new Layer(LW, H));
  const lights = [];
  const seaY = Math.round(H * 0.8);
  const sc = H / 216;

  // far islands: small, high and low, many
  const far = layers[0];
  for (let x = rng.int(-20, 20); x < LW; x += rng.int(50, 90)) {
    const isl = island(far, rng, x, Math.round(H * rng.float(0.2, 0.6)), rng.int(16, 34) * sc, rng.int(10, 22) * sc, season);
    if (rng.chance(0.4)) waterfall(far, isl.x1 - 3, isl.topAt(isl.x1 - 3) + 1, seaY + 10);
    if (rng.chance(0.5)) tree(far, rng, Math.round(isl.cx), isl.topAt(isl.cx) - 1, H * 0.6, season);
  }
  // middle islands
  const mid = layers[1];
  for (let x = rng.int(0, 40); x < LW; x += rng.int(90, 140)) {
    const top = Math.round(H * rng.float(0.3, 0.55));
    const isl = island(mid, rng, x, top, rng.int(34, 56) * sc, rng.int(20, 34) * sc, season);
    for (let k = 0; k < 2; k++) { const tx = isl.x0 + rng.int(4, isl.x1 - isl.x0 - 4); tree(mid, rng, tx, isl.topAt(tx) - 1, H * 0.8, season); }
    if (rng.chance(0.5)) cottage(mid, rng, Math.round(isl.cx - 3), isl.topAt(isl.cx) , 7, 5, lights, 1);
    if (rng.chance(0.35)) waterfall(mid, isl.x0 + 2, isl.topAt(isl.x0 + 2) + 1, seaY + 12);
  }

  // the main island with a village, plus a neighbour joined by a rope bridge
  const near = layers[2];
  const mw = Math.min(LW * 0.55, 230 * sc), mcx = margin + W * 0.38;
  const main = island(near, rng, mcx, Math.round(H * 0.5), mw, Math.round(H * 0.36), season);
  const ncx = margin + W * 0.84, nisl = island(near, rng, ncx, Math.round(H * 0.42), Math.min(90 * sc, W * 0.24), Math.round(H * 0.24), season);
  bridge(near, main.x1 - 3, main.topAt(main.x1 - 3), nisl.x0 + 3, nisl.topAt(nisl.x0 + 3));
  waterfall(near, main.x0 + 6, main.topAt(main.x0 + 6) + 1, H);
  for (let x = main.x0 + 6; x < main.x0 + 18; x++) near.put(x, main.topAt(x), hex(0x7aa8d0), { ny: 0.85 }); // stream to the falls
  windmill(near, rng, Math.round(main.x0 + mw * 0.22), main.topAt(Math.round(main.x0 + mw * 0.22)), 2);
  let x = Math.round(main.x0 + mw * 0.36);
  while (x < main.x1 - 22) {
    const w = rng.int(8, 12), h = rng.int(6, 8);
    const base = Math.max(main.topAt(x), main.topAt(x + w)) ;
    cottage(near, rng, x, base, w, h, lights, 2);
    x += w + rng.int(3, 7);
    if (rng.chance(0.6)) { tree(near, rng, x, main.topAt(x) - 1, H, season); x += 8; }
    if (rng.chance(0.5)) { lantern(near, rng, x, main.topAt(x), lights, 2); x += 4; }
  }
  // a little chapel tower on the neighbour island
  const tx = Math.round(ncx - 3), tb = nisl.topAt(tx);
  for (let y = tb - 18; y < tb; y++) for (let xx = tx; xx < tx + 7; xx++) near.put(xx, y, shade(hex(0xd8d0c0), 0.95 + hash2(xx, y, 4) * 0.06), { nx: xx === tx ? -0.7 : xx === tx + 6 ? 0.7 : 0 });
  for (let k = 0; k < 6; k++) for (let xx = tx + Math.floor(k / 2); xx < tx + 7 - Math.floor(k / 2); xx++) near.put(xx, tb - 19 - k, hex(0x4a5a7a), { nx: (xx - tx - 3) / 4, ny: 0.7 });
  near.put(tx + 3, tb - 12, hex(0xffe0a0), { f: F.WINDOW, e: 50, r: 255 });
  for (let k = 0; k < 3; k++) tree(near, rng, Math.round(nisl.x0 + 8 + k * 12), nisl.topAt(nisl.x0 + 8 + k * 12) - 1, H, season);

  // foreground: the corner of a big island at the bottom left, close to us
  const fg = layers[3];
  const fisl = island(fg, rng, margin + W * 0.04, Math.round(H * 0.86), W * 0.32, H * 0.3, season);
  tree(fg, rng, Math.round(margin + W * 0.1), fisl.topAt(Math.round(margin + W * 0.1)) - 1, H * 1.3, season);
  lantern(fg, rng, Math.round(margin + W * 0.17), fisl.topAt(Math.round(margin + W * 0.17)), lights, 3);

  const srng = new RNG(seed ^ 0x5f3759df);
  [1, 2, 3, 3].forEach((pile, i) => computeSnow(layers[i], srng, Math.max(1, Math.round(pile * sc))));

  // airships cruising between the islands
  const ar = new RNG(seed ^ 0xa1);
  const airships = [];
  for (let k = 0; k < 2; k++) airships.push({ x: ar.float(0, W), y: H * ar.float(0.12, 0.35), vx: ar.float(3, 6) * ar.pick([-1, 1]) * sc, col: ar.pick([[226, 214, 190], [200, 80, 70], [90, 120, 170]]), bob: ar.float(0, 6) });

  const solidAt = (l, x, y, offs) => {
    const L = layers[l], lx = x + margin - offs[l];
    if (lx < 0 || lx >= LW || y < 0 || y >= H) return false;
    return L.albedo[(y * LW + lx) * 4 + 3] > 0;
  };
  return {
    kind: 'side', layers, lights: lights.slice(0, 64), margin, LW, W, H,
    groundY: seaY, curbY: H, roadAxis: H + 100, env: { uSeaY: seaY },
    airships, birds: 4, leafFall: true, cityGlow: 0.1, solidAt,
    isSky: (x, y, offs) => ![0, 1, 2, 3].some((l) => solidAt(l, x, y, offs)),
    hitFront: (x, y, offs) => solidAt(3, x, y, offs) || solidAt(2, x, y, offs),
    killY: (z) => seaY * (0.4 + Math.random() * 0.2) + (H - seaY * 0.5) * z * Math.random(),
  };
}
