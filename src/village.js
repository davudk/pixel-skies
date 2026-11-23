// Cozy mountain village (isometric): timber chalets with smoking chimneys,
// winding dirt roads, a cobbled square with a big fir (lit up around
// Christmas), a church with a spire, a pond that freezes in winter, pine
// forest around the edges and snowy mountains behind.
import { RNG, hash2, noise2 } from './rng.js';
import { F, hex, shade, mix, lin } from './raster.js';
import { createIso } from './isokit.js';
import { house, church, woodpile, fence } from './isoparts.js';
import { drawMountains } from './backdrops.js';

const WALLS = [0x8a5a3a, 0x7a4e30, 0x9a6a42, 0xd8cfc0, 0xcabba0, 0xb89a74];
const BASES = [0x8c8680, 0x7d776f, 0x968e84];
const ROOFS = [0x4a3a32, 0x5a4a44, 0x6e3a2e, 0x4a5260, 0x5e4636];
const SHUTTERS = [0x3f6e4a, 0x8a3a30, 0x3b5a7a, 0x6a4a30];
const ORNAMENTS = [0xff4a4a, 0xffd24a, 0x4ac8ff, 0x8aff6a, 0xff8ae0].map(hex);

export function generateVillage(VW, VH, seed, season, doy) {
  const K = createIso(VW, VH, { horizon: 0.4 });
  const { M, cx, cy, hp, bottom } = K;
  const rng = new RNG(seed);
  const s0 = rng.int(0, 1e6);

  // the village centre sits a little below the middle of the ground
  const row = hp + (bottom - hp) * 0.5;
  const C = row + 0.5 - cy;
  const toScreen = (X, Y) => [X - Y + cx, (X + Y) / 2 + cy];
  const roadY = (X) => C + 4 + 9 * Math.sin((X - C) / 37 + s0 % 7);
  const laneX = (Y) => C + 12 + 7 * Math.sin((Y - C) / 29 + (s0 % 5));
  const pond = { x: C - 46 + rng.int(-6, 6), y: C + 34 + rng.int(-4, 4), rx: 15, ry: 10 };
  const pondD = (X, Y) => Math.hypot((X - pond.x) / pond.rx, (Y - pond.y) / pond.ry);
  const plaza = (X, Y) => Math.hypot(X - C, Y - C) < 13;
  const onRoad = (X, Y, pad = 0) => Math.abs(Y - roadY(X)) < 3 + pad || (Math.abs(X - laneX(Y)) < 2.5 + pad && Y > C - 60 && Y < C + 70);

  // ---------------------------------------------------------------- ground
  const grass = mix(season.density < 0.3 ? hex(0x7a7a58) : season.fresh > 0.5 ? hex(0x6aa04a) : hex(0x5a8a40), hex(0x9a8a48), season.autumn * season.density * 0.6);
  const flowers = season.density > 0.6 && season.autumn < 0.3;
  K.ground((X, Y) => {
    const n = hash2(Math.floor(X), Math.floor(Y), 3);
    M.r = Math.floor(n * 199);
    const pd = pondD(X, Y);
    if (pd < 1) { K.water(hex(0x2d5a6e), Math.max(0, 1 - (1 - pd) * 6)); M.r = 255; return; } // freezable
    if (plaza(X, Y)) {
      M.f = F.GROUND | F.ROAD;
      M.c = ((Math.floor(X) + Math.floor(Y * 0.5)) % 3 === 0) ? hex(0x7a746a) : shade(hex(0x8e877a), 0.94 + n * 0.1);
      return;
    }
    if (onRoad(X, Y)) {
      M.f = F.GROUND | F.ROAD;
      const rut = Math.abs(Math.abs(Y - roadY(X)) - 1.2) < 0.4;
      M.c = shade(hex(0x7a6a55), rut ? 0.82 : 0.94 + n * 0.12);
      if (rut) M.r = 230;
      return;
    }
    M.f = F.GROUND;
    let c = shade(grass, 0.88 + noise2(X * 0.15, Y * 0.15, 5) * 0.2 + n * 0.05);
    if (pd < 1.25) c = mix(c, hex(0x6a6a52), 0.5);                       // muddy pond edge
    if (flowers && n > 0.965) c = [hex(0xf2e06a), hex(0xffffff), hex(0xd86a9a), hex(0x8a9aff)][Math.floor(n * 1000) % 4];
    M.c = c;
  });

  // ----------------------------------------------------------- buildings
  const SP = 21;
  const ex = VW * 0.44, ey = (bottom - hp) * 0.42;
  const taken = [];
  const free = (x0, y0, x1, y1) => taken.every((t) => x1 < t[0] || x0 > t[2] || y1 < t[1] || y0 > t[3]);
  const blocked = (x0, y0, x1, y1) => {
    for (let x = x0; x <= x1; x += 2) for (let y = y0; y <= y1; y += 2) {
      if (onRoad(x, y, 2) || plaza(x, y) || pondD(x, y) < 1.4) return true;
    }
    return false;
  };

  // church on the square's north-east side
  const chX = C - 36, chY = C - 40;
  church(K, new RNG(seed ^ 77), chX, chY, 11, 20);
  taken.push([chX - 3, chY - 3, chX + 15, chY + 30]);

  const span = Math.ceil((VW + VH) / SP) + 4;
  const forest = [];
  for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) {
    const r = new RNG((hash2(i, j, seed) * 4294967296) >>> 0);
    const X = C + i * SP + r.int(-4, 4), Y = C + j * SP + r.int(-4, 4);
    const [sx, sy] = toScreen(X + 6, Y + 6);
    if (sy < hp - 10 || sy > bottom + 60 || sx < -40 || sx > K.W + 40) continue;
    const e = ((sx - cx) / ex) ** 2 + ((sy - (row + cy)) / ey) ** 2;
    if (e < 1 && r.chance(0.86)) {
      const w = r.int(9, 13), d = r.int(8, 12);
      if (blocked(X - 2, Y - 2, X + w + 2, Y + d + 2) || !free(X - 2, Y - 2, X + w + 2, Y + d + 2)) { forest.push([X + 5, Y + 5, 1]); continue; }
      taken.push([X - 2, Y - 2, X + w + 2, Y + d + 2]);
      const wallHex = r.pick(WALLS);
      house(K, r, {
        x0: X, y0: Y, x1: X + w, y1: Y + d, floors: r.chance(0.6) ? 2 : 1, floorH: 5,
        ridge: r.chance(0.5) ? 'gx' : 'gy', slope: r.float(0.65, 0.85), overhang: 1.3,
        wall: wallHex, base: r.chance(0.7) ? r.pick(BASES) : null, timber: wallHex < 0xa00000,
        roof: r.pick(ROOFS), shutter: r.chance(0.7) ? r.pick(SHUTTERS) : null, doorFace: r.chance(0.7) ? 2 : 1,
      });
      if (r.chance(0.45)) woodpile(K, X - 2.2, Y + r.int(1, d - 4), false);
      if (r.chance(0.3)) fence(K, X - 1, Y + d + 4, X + w + 1, Y + d + 4);
      if (r.chance(0.35)) forest.push([X + w + 4, Y + r.int(0, d), 0]);
    } else if (e >= 1) {
      // forest gets denser away from the village
      const dense = Math.min(1, (e - 1) * 0.8 + 0.25);
      const n = Math.round(dense * 4 * r.float(0.5, 1.2));
      for (let k = 0; k < n; k++) forest.push([X + r.int(0, SP), Y + r.int(0, SP), 1]);
    }
  }
  for (const [X, Y, pine] of forest) {
    const r = new RNG((hash2(Math.floor(X), Math.floor(Y), seed + 9) * 4294967296) >>> 0);
    if (onRoad(X, Y, 2) || plaza(X, Y) || pondD(X, Y) < 1.3 || !free(X - 2, Y - 2, X + 2, Y + 2)) continue;
    K.tree(X, Y, r, season, { species: pine || r.chance(0.3) ? 'pine' : 'broad', big: r.float(0.9, 1.35) });
  }

  // big fir in the square, decorated from December to early January
  const fr = new RNG(seed ^ 0x1f1f);
  K.tree(C - 0.5, C - 0.5, fr, season, { species: 'pine', big: 1.9 });
  const festive = doy >= 335 || doy <= 6;
  if (festive) {
    for (let k = 0; k < 26; k++) {
      const t = fr.float(0.05, 0.85), a = fr.float(0, Math.PI * 2);
      const rad = 7.2 * (1 - t) + 0.4, z = 4 + t * 22;
      const ox = Math.cos(a) * rad, oy = Math.sin(a) * rad;
      const c = fr.pick(ORNAMENTS), seedN = fr.int(30, 255);
      K.box(C + ox - 0.3, C + oy - 0.3, C + ox + 0.4, C + oy + 0.4, z, z + 0.7, () => { M.c = c; M.f = F.NEON; M.r = seedN; }, false);
    }
    K.box(C - 0.5, C - 0.5, C + 0.6, C + 0.6, 26.5, 27.6, () => { M.c = hex(0xffe060); M.f = F.NEON; M.r = 200; }, false);
    K.lights.push({ X: C, Y: C, Z: 14, kind: 1, thr: 0.9, col: lin([255, 200, 120], 0.8), radius: 26 });
  }

  // lanterns along the main road
  for (let X = C - 160, k = 0; X < C + 200; X += 23, k++) {
    const Y = roadY(X) + (k % 2 ? 4.5 : -5);
    if (plaza(X, Y) || pondD(X, Y) < 1.3) continue;
    K.lamp(X, Y, new RNG(k * 31 + seed), { height: 7, col: [255, 175, 100], radius: 24 });
  }

  K.backdrop((L, horizon) => drawMountains(L, seed ^ 0x3a7, horizon, { height: 0.95, snowLine: 0.3 + 0.35 * season.density }));

  return K.finish({
    fireflies: [{ x0: C - 120, y0: C - 60, x1: C + 120, y1: C + 120 }],
    birds: 4,
    cityGlow: 0.25,
    leafFall: true,
  });
}
