// East Asian–inspired temple garden (isometric): a hall with a broad hip
// roof on a stone platform, a five-tier pagoda, a red gate, a koi pond with
// an arched bridge, stone lanterns, raked gravel, moss, cherry trees that
// blossom in spring, maples that blaze red in autumn, pines and bamboo, and
// misty hills behind.
import { RNG, hash2, noise2 } from './rng.js';
import { F, hex, shade, mix, lin } from './raster.js';
import { createIso } from './isokit.js';
import { drawHills } from './backdrops.js';

const RED = hex(0xa8322a), RED_D = hex(0x7a2420), PLASTER = hex(0xe6dccb), TILE = hex(0x3e4450);
const STONE = hex(0x8e8a80), WOOD = hex(0x6a4a30);

export function generateGarden(VW, VH, seed, season) {
  const K = createIso(VW, VH, { horizon: 0.34 });
  const { M, cx, cy, hp, bottom } = K;
  const rng = new RNG(seed);
  const row = hp + (bottom - hp) * 0.5;
  const C = row + 0.5 - cy;

  // layout (world units around the centre C)
  const pond = { cx: C + 6, cy: C + 26, rx: 26, ry: 17, s: rng.int(0, 1e6) };
  const pondR = (X, Y) => {
    const a = Math.atan2(Y - pond.cy, X - pond.cx);
    const wob = 1 + 0.18 * Math.sin(a * 3 + pond.s) + 0.1 * Math.sin(a * 5 + pond.s * 2);
    return Math.hypot((X - pond.cx) / pond.rx, (Y - pond.cy) / pond.ry) / wob;
  };
  const hall = { x0: C - 34, y0: C - 46, x1: C + 4, y1: C - 18 };
  const path = (X, Y) => Math.abs(X - (C - 15)) < 3 && Y > hall.y1 && Y < C + 90 && pondR(X, Y) > 1.08;
  const gravel = (X, Y) => X > hall.x0 - 16 && X < hall.x1 + 18 && Y > hall.y0 - 10 && Y < hall.y1 + 22;
  // dry rock garden: raked gravel with ripple rings around groups of stones
  const zen = { x0: C - 72, y0: C - 8, x1: C - 34, y1: C + 44 };
  const zenRocks = [[zen.x0 + 9, zen.y0 + 12, 2.6], [zen.x0 + 26, zen.y0 + 20, 3.2], [zen.x0 + 14, zen.y0 + 38, 2.2]];
  const inZen = (X, Y) => X > zen.x0 && X < zen.x1 && Y > zen.y0 && Y < zen.y1;

  // ----------------------------------------------------------------- ground
  const moss = mix(season.density < 0.3 ? hex(0x6a7050) : hex(0x4e7a3e), hex(0x8a7a3a), season.autumn * season.density * 0.5);
  K.ground((X, Y) => {
    const n = hash2(Math.floor(X), Math.floor(Y), 3);
    M.r = Math.floor(n * 199);
    const pr = pondR(X, Y);
    if (pr < 1) { K.water(mix(hex(0x2a5a5a), hex(0x1e4448), 1 - pr), Math.max(0, 1 - (1 - pr) * 7)); M.r = 255; return; }
    if (path(X, Y)) {
      // stepping stones set in gravel
      const sx = Math.floor((Y + 1) / 4), inStone = Math.hypot(X - (C - 15) - (sx % 2 ? 0.7 : -0.7), Y - (sx * 4 + 1)) < 1.6;
      M.f = F.GROUND | F.ROAD;
      M.c = inStone ? shade(STONE, 0.9 + n * 0.15) : hex(0xc9c2b2);
      return;
    }
    if (inZen(X, Y)) {
      M.f = F.GROUND;
      const edge = Math.min(X - zen.x0, zen.x1 - X, Y - zen.y0, zen.y1 - Y);
      if (edge < 1.2) { M.c = shade(STONE, 0.85 + n * 0.12); return; }   // stone kerb
      let d = Infinity;
      for (const [rx, ry, rr] of zenRocks) d = Math.min(d, Math.hypot(X - rx, Y - ry) - rr);
      const line = d < 8 ? Math.floor(d * 1.4) % 2 : Math.floor(Y * 1.4) % 2;
      M.c = d < 0.8 ? shade(moss, 0.9) : line ? hex(0xd4cdbd) : hex(0xbcb5a5);
      return;
    }
    if (gravel(X, Y)) {
      // raked gravel: fine parallel lines, rings around rocks
      M.f = F.GROUND;
      M.c = Math.floor(X * 1.5) % 2 ? hex(0xcfc8b8) : hex(0xbdb6a6);
      return;
    }
    M.f = F.GROUND;
    let c = shade(moss, 0.85 + noise2(X * 0.12, Y * 0.12, 9) * 0.25 + n * 0.06);
    if (pr < 1.15) c = mix(c, hex(0x6a6a58), 0.5);
    M.c = c;
  });

  // --------------------------------------------------------- hall on a platform
  const plat = (face, X, Y, Z) => { M.c = face === 0 ? shade(STONE, 1.05 + hash2(Math.floor(X / 2), Math.floor(Y / 2), 4) * 0.08) : (Math.floor(Z * 2) % 2 ? STONE : shade(STONE, 0.85)); M.f = face === 0 ? F.GROUND : 0; };
  K.box(hall.x0 - 3, hall.y0 - 3, hall.x1 + 3, hall.y1 + 3, 0, 2, plat);
  K.box(C - 18, hall.y1 + 3, C - 12, hall.y1 + 6, 0, 1, plat);                     // steps
  const hallH = 9;
  K.box(hall.x0, hall.y0, hall.x1, hall.y1, 2, 2 + hallH, (face, X, Y, Z) => {
    const u = face === 1 ? Y - hall.y0 : X - hall.x0, ui = Math.floor(u), zi = Math.floor(Z - 2);
    if (ui % 6 === 0) { M.c = RED; return; }                                      // pillars
    if (zi >= hallH - 2) { M.c = RED_D; return; }                                 // beam under the eaves
    if (zi >= 2 && zi < 6 && ui % 6 >= 2 && ui % 6 <= 4) {                       // lattice windows
      M.c = (ui + zi) % 2 ? hex(0xf2d8a0) : hex(0xd8b878); M.f = F.WINDOW; M.e = 50; M.r = 255; return;
    }
    M.c = shade(PLASTER, 0.95 + hash2(ui, zi, 3) * 0.06);
  });
  const tileMat = (face, X, Y, Z) => { M.c = Math.floor((Z) * 2.6) % 2 ? TILE : shade(TILE, 0.82); };
  const ridge = K.roof(hall.x0 - 4, hall.y0 - 4, hall.x1 + 4, hall.y1 + 4, 2 + hallH, 0.55, 'hip', tileMat);
  K.box(hall.x0 + 8, (hall.y0 + hall.y1) / 2 - 0.6, hall.x1 - 8, (hall.y0 + hall.y1) / 2 + 0.6, ridge - 0.5, ridge + 0.8, K.edged(shade(TILE, 0.7)));
  // paper lanterns hanging from the eaves
  for (let X = hall.x0 + 3; X < hall.x1; X += 12) {
    const Y = hall.y1 + 2.2, z = 2 + hallH - 2.6;
    K.blob(X, Y, z, 0.9, () => { M.c = hex(0xe0482a); M.f = F.NEON; M.r = 200; }, { seed: X, doStamp: false, rough: 0 });
    K.lights.push({ X, Y, Z: z, kind: 1, thr: 0.8, col: lin([255, 110, 60], 0.7), radius: 16 });
  }

  // -------------------------------------------------------------- pagoda
  const px0 = C + 26, py0 = C - 52;
  let z = 0, apex = 0;
  K.box(px0 - 2, py0 - 2, px0 + 14, py0 + 14, 0, 1.5, plat);
  z = 1.5;
  for (let t = 0; t < 5; t++) {
    const inset = t * 1.3, s = 12 - 2 * inset;
    const x0 = px0 + inset, y0 = py0 + inset, h = t === 0 ? 7 : 5;
    K.box(x0, y0, x0 + s, y0 + s, z, z + h, (face, X, Y, Zz) => {
      const u = face === 1 ? Y - y0 : X - x0, ui = Math.floor(u);
      M.c = ui === 0 || ui === Math.floor(s) - 1 ? RED : (Zz - z > h - 1.5 ? RED_D : PLASTER);
      if (Math.abs(u - s / 2) < 1 && Zz - z > 1.5 && Zz - z < h - 2) { M.c = hex(0xf0c878); M.f = F.WINDOW; M.e = 70; M.r = 255; }
    });
    apex = K.roof(x0 - 3, y0 - 3, x0 + s + 3, y0 + s + 3, z + h, 0.42, 'hip', tileMat);
    z = z + h + 1.2;              // the next tier rises out of this roof
  }
  const top = apex;
  K.cylinder(px0 + 6, py0 + 6, 0.35, top - 1, top + 7, K.edged(hex(0xb89a4a)));
  for (let k = 0; k < 4; k++) K.cylinder(px0 + 6, py0 + 6, 0.8, top + 1 + k * 1.4, top + 1.5 + k * 1.4, K.edged(hex(0xb89a4a)));

  // ----------------------------------------------------------------- gate
  const gx = C - 15, gy = C + 72;
  for (const dx of [-5, 5]) K.cylinder(gx + dx, gy, 0.8, 0, 13, K.edged(RED));
  K.box(gx - 8, gy - 0.8, gx + 8, gy + 0.8, 13, 14.3, (face) => { M.c = face === 0 ? hex(0x2a2a2e) : hex(0x2a2a2e); });
  K.box(gx - 7, gy - 0.6, gx + 7, gy + 0.6, 11.4, 12.4, K.edged(RED));
  K.box(gx - 0.4, gy - 0.4, gx + 0.4, gy + 0.4, 12.4, 13, K.edged(RED));

  // --------------------------------------------------- arched bridge over the pond
  const bY = pond.cy + 2, bx0 = pond.cx - pond.rx * 0.55, bx1 = pond.cx + pond.rx * 0.55;
  for (let X = bx0; X < bx1; X += 1) {
    const u = (X - bx0) / (bx1 - bx0), zz = 0.5 + Math.sin(u * Math.PI) * 3.2;
    K.box(X, bY - 1.5, X + 1.01, bY + 1.5, zz - 0.6, zz, (face) => { M.c = face === 0 ? WOOD : RED; });
    if (Math.floor(X) % 3 === 0) for (const yy of [bY - 1.5, bY + 1.1]) K.box(X, yy, X + 0.4, yy + 0.4, zz, zz + 1.6, K.solid(RED));
  }
  for (const yy of [bY - 1.5, bY + 1.1]) {
    for (let X = bx0; X < bx1; X += 1) {
      const u = (X - bx0) / (bx1 - bx0), zz = 0.5 + Math.sin(u * Math.PI) * 3.2 + 1.5;
      K.box(X, yy, X + 1.01, yy + 0.4, zz, zz + 0.35, K.solid(RED), false);
    }
  }

  // --------------------------------------------------------- stone lanterns
  const lanternAt = (X, Y, r) => {
    if (!K.onScreen(X - 2, Y - 2, X + 2, Y + 2, 8)) return;
    const thr = Math.round(r.float(0.15, 0.6) * 255);
    K.box(X - 1, Y - 1, X + 1, Y + 1, 0, 0.8, K.edged(STONE));
    K.box(X - 0.4, Y - 0.4, X + 0.4, Y + 0.4, 0.8, 3.2, K.edged(STONE));
    K.box(X - 1, Y - 1, X + 1, Y + 1, 3.2, 4.8, (face) => { M.c = face === 0 ? STONE : hex(0xf0d8a0); if (face) { M.f = F.LAMP; M.e = thr; } });
    const rz = K.roof(X - 1.8, Y - 1.8, X + 1.8, Y + 1.8, 4.8, 0.6, 'hip', (f) => { M.c = shade(STONE, 0.9); });
    K.box(X - 0.3, Y - 0.3, X + 0.3, Y + 0.3, rz - 0.2, rz + 0.6, K.edged(STONE));
    K.lights.push({ X, Y, Z: 4, kind: 0, thr: thr / 255, col: lin([255, 200, 130], 1.2), radius: 18 });
  };
  const lr = new RNG(seed ^ 0x1a);
  for (let Y = hall.y1 + 10; Y < gy - 4; Y += 14) { lanternAt(C - 20, Y, lr); lanternAt(C - 10, Y + 7, lr); }
  for (let a = 0; a < 6.28; a += 1.3) {
    const X = pond.cx + Math.cos(a) * pond.rx * 1.2, Y = pond.cy + Math.sin(a) * pond.ry * 1.25;
    if (!path(X, Y)) lanternAt(X, Y, lr);
  }
  lanternAt(C + 46, C - 62, lr); lanternAt(C + 58, C - 62, lr);
  lanternAt(C - 30, C - 4, lr); lanternAt(C - 30, C + 40, lr);

  // stones of the dry garden, each on a cushion of moss
  for (const [rx, ry, rr] of zenRocks) {
    K.blob(rx, ry, -0.2, rr, (h) => { M.c = shade(hex(0x6e6a64), 0.75 + h * 0.45); }, { seed: Math.floor(rx * 3 + ry), squash: 1.1, rough: 0.3 });
    K.blob(rx + rr * 0.9, ry + rr * 0.5, -0.3, rr * 0.55, (h) => { M.c = shade(hex(0x7a766e), 0.75 + h * 0.4); }, { seed: Math.floor(rx + ry * 5), squash: 0.9 });
  }

  // a small shrine in the north-west corner
  const sx0 = C + 48, sy0 = C - 74;
  K.box(sx0 - 1, sy0 - 1, sx0 + 9, sy0 + 8, 0, 1.2, plat);
  K.box(sx0, sy0, sx0 + 8, sy0 + 7, 1.2, 6, (face, X, Y, Z) => {
    const u = face === 1 ? Y - sy0 : X - sx0, ui = Math.floor(u);
    M.c = ui === 0 || ui === (face === 1 ? 6 : 7) ? RED : Z > 5 ? RED_D : shade(hex(0x8a5a3a), 0.95 + hash2(ui, Math.floor(Z), 5) * 0.08);
    if (face === 2 && ui >= 3 && ui < 5 && Z > 2 && Z < 4.5) { M.c = hex(0xf0c878); M.f = F.WINDOW; M.e = 50; M.r = 255; }
  });
  K.roof(sx0 - 2, sy0 - 2, sx0 + 10, sy0 + 9, 6, 0.75, 'gx', tileMat);

  // -------------------------------------------------------------- rocks
  const rock = (X, Y, rad, zz = 0) => K.blob(X, Y, zz, rad, (h) => { M.c = shade(hex(0x7e7a72), 0.75 + h * 0.4); }, { seed: Math.floor(X * 13 + Y * 7), squash: 0.75, rough: 0.35 });
  const rr = new RNG(seed ^ 0x2b);
  for (let k = 0; k < 6; k++) rock(hall.x1 + rr.int(4, 14), hall.y0 + rr.int(0, 26), rr.float(1.6, 3));
  for (let a = 0.3; a < 6.28; a += rr.float(0.35, 0.7)) rock(pond.cx + Math.cos(a) * pond.rx * 1.02, pond.cy + Math.sin(a) * pond.ry * 1.02, rr.float(1, 2.1), -0.3);

  // ------------------------------------------- garden wall with a tiled cap
  const W0 = C - 78, W1 = C + 74, W2 = C - 82, W3 = gy + 3;
  const wallMat = (face, X, Y, Z) => { M.c = Z < 0.6 ? shade(STONE, 0.8) : shade(PLASTER, 0.94 + hash2(Math.floor(X), Math.floor(Y), 2) * 0.06); };
  const capMat = (face, X, Y, Z) => { M.c = Math.floor(Z * 4) % 2 ? TILE : shade(TILE, 0.8); };
  const wallRun = (x0, y0, x1, y1, ridge) => {
    K.box(x0, y0, x1, y1, 0, 3.4, wallMat);
    K.roof(x0 - 0.6, y0 - 0.6, x1 + 0.6, y1 + 0.6, 3.4, 0.7, ridge, capMat);
  };
  wallRun(W0, W2, W1, W2 + 1.4, 'gx');                         // north
  wallRun(W0, W2, W0 + 1.4, W3, 'gy');                         // east
  wallRun(W1 - 1.4, W2, W1, W3, 'gy');                         // west
  wallRun(W0, W3 - 1.4, gx - 7, W3, 'gx');                     // south, either side of the gate
  wallRun(gx + 7, W3 - 1.4, W1, W3, 'gx');

  // bell pavilion: four red posts under a hip roof, a bronze bell inside
  const bx = C + 44, by = C + 2;
  for (const [dx, dy] of [[0, 0], [7, 0], [0, 7], [7, 7]]) K.box(bx + dx, by + dy, bx + dx + 0.9, by + dy + 0.9, 0, 7, K.solid(RED));
  K.cylinder(bx + 4, by + 4, 1.6, 3.2, 6.4, (face) => { M.c = face === 0 ? hex(0x5a6a50) : hex(0x6a7a58); });
  K.roof(bx - 2, by - 2, bx + 10, by + 10, 7, 0.55, 'hip', tileMat);

  // tea house on the far side of the pond
  const thx = pond.cx + pond.rx + 4, thy = pond.cy - 6;
  K.box(thx - 1, thy - 1, thx + 11, thy + 9, 0, 1, plat);
  K.box(thx, thy, thx + 10, thy + 8, 1, 6, (face, X, Y, Z) => {
    const u = face === 1 ? Y - thy : X - thx, ui = Math.floor(u);
    if (ui % 4 === 0) { M.c = WOOD; return; }
    M.c = Z > 2 && Z < 5 ? hex(0xf2e6c8) : shade(PLASTER, 0.9);
    if (Z > 2 && Z < 5) { M.f = F.WINDOW; M.e = 60; M.r = 255; }
  });
  K.roof(thx - 2, thy - 2, thx + 12, thy + 10, 6, 0.5, 'hip', (f, X, Y, Z) => { M.c = Math.floor(Z * 3) % 2 ? hex(0x6a5a40) : hex(0x5a4a34); });

  // ----------------------------------------------------------- plants
  const tr = new RNG(seed ^ 0x3c);
  const occupied = (X, Y) => pondR(X, Y) < 1.2 || path(X, Y) || gravel(X, Y) || inZen(X, Y) || (X > sx0 - 4 && X < sx0 + 12 && Y > sy0 - 4 && Y < sy0 + 12) || (Math.abs(X - (px0 + 6)) < 12 && Math.abs(Y - (py0 + 6)) < 12)
    || (X > bx - 5 && X < bx + 13 && Y > by - 5 && Y < by + 13) || (X > thx - 5 && X < thx + 15 && Y > thy - 5 && Y < thy + 13);
  // cherries ring the pond, maples near the hall, pines and bamboo at the edges
  for (let a = 0; a < 6.28; a += 0.55) {
    const X = pond.cx + Math.cos(a) * pond.rx * 1.45 + tr.float(-3, 3), Y = pond.cy + Math.sin(a) * pond.ry * 1.55 + tr.float(-3, 3);
    if (!occupied(X, Y)) K.tree(X, Y, tr, season, { species: 'cherry', big: tr.float(1.2, 1.55) });
  }
  for (let k = 0; k < 22; k++) {
    const X = C + tr.int(-68, 66), Y = C + tr.int(-76, 80);
    if (!occupied(X, Y) && Math.abs(X - (C - 15)) > 7) K.tree(X, Y, tr, season, { species: tr.chance(0.7) ? 'maple' : 'pine', big: tr.float(1.05, 1.4) });
  }
  // shrubs and azaleas (pink in spring) dotted inside the wall
  for (let k = 0; k < 40; k++) {
    const X = C + tr.int(-70, 70), Y = C + tr.int(-75, 88);
    if (occupied(X, Y) || Math.abs(X - (C - 15)) < 6) continue;
    const pink = season.blossom > 0.15 && tr.chance(0.5);
    K.blob(X, Y, 1.2, tr.float(1.4, 2.4), (h) => {
      M.c = pink && h < 0.7 ? [hex(0xe86a9a), hex(0xf29ab8)][Math.floor(h * 9) % 2] : shade(hex(0x3e6a34), 0.8 + h * 0.35);
      M.f = F.FOLIAGE;
    }, { seed: k * 17 + 3, squash: 0.7 });
  }

  // dense woods outside the garden wall
  for (let X = C - 260; X < C + 260; X += 7) for (let Y = C - 260; Y < C + 260; Y += 7) {
    const jx = X + tr.float(-3, 3), jy = Y + tr.float(-3, 3);
    if (jx > W0 - 6 && jx < W1 + 6 && jy > W2 - 6 && jy < W3 + 6) continue;
    if ((jx + jy) / 2 + cy < hp + 2 || !tr.chance(0.75)) continue;
    const kind = noise2(jx * 0.025, jy * 0.025, 5);
    if (kind > 0.6) bamboo(K, jx, jy, tr);
    else K.tree(jx, jy, tr, season, { species: kind < 0.3 ? 'maple' : tr.chance(0.7) ? 'pine' : 'broad', big: tr.float(1, 1.5) });
  }

  // koi swimming in the pond
  const koi = [];
  const kr = new RNG(seed ^ 0x4d);
  for (let k = 0; k < 9; k++) {
    const c = kr.pick([[240, 120, 40], [250, 250, 240], [230, 70, 40], [250, 200, 80]]);
    koi.push({ X: pond.cx + kr.float(-10, 10), Y: pond.cy + kr.float(-6, 6), a: kr.float(0, 6.28), v: kr.float(1.5, 3), ph: kr.float(0, 6.28),
      c, c2: kr.chance(0.5) ? [250, 250, 240] : c, cx: pond.cx, cy: pond.cy, rx: pond.rx, ry: pond.ry });
  }

  K.backdrop((L, horizon) => drawHills(L, seed ^ 0x77, horizon));

  return K.finish({
    koi, birds: 3, leafFall: true, cityGlow: 0.2,
    fireflies: [{ x0: pond.cx - 40, y0: pond.cy - 30, x1: pond.cx + 40, y1: pond.cy + 30 }],
  });
}

// A grove of tall bamboo: slender jointed canes with feathery leaf clusters
// up their upper halves.
function bamboo(K, X, Y, r) {
  const { M } = K;
  const n = r.int(9, 15);
  for (let k = 0; k < n; k++) {
    const x = X + r.float(-3.5, 3.5), y = Y + r.float(-3.5, 3.5), h = r.float(13, 20);
    if (!K.onScreen(x - 2, y - 2, x + 2, y + 2, h + 3)) continue;
    K.box(x, y, x + 0.5, y + 0.5, 0, h, (face, XX, YY, Z) => { M.c = Math.floor(Z * 1.3) % 4 === 0 ? hex(0x4e6a30) : hex(0x86a456); });
    for (let z = h * 0.45; z <= h; z += r.float(2.2, 3.4)) {
      K.blob(x + 0.25 + r.float(-0.8, 0.8), y + 0.25 + r.float(-0.8, 0.8), z, r.float(1.2, 1.9), (hh) => {
        M.c = [hex(0x4a7a36), hex(0x6a9a46), hex(0x5a8a3e)][Math.floor(hh * 7) % 3]; M.f = F.FOLIAGE;
      }, { seed: Math.floor(x * 31 + y * 7 + z * 13), density: 0.7, squash: 0.45, doStamp: false });
    }
  }
}
