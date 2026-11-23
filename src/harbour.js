// Fishing harbour (isometric): a colourful waterfront town on a stone quay,
// wooden piers with moored boats, open sea out to the horizon, and a striped
// lighthouse at the end of a rocky jetty whose beam sweeps round at night.
import { RNG, hash2, noise2 } from './rng.js';
import { F, hex, shade, mix, lin } from './raster.js';
import { createIso } from './isokit.js';
import { house, crate, barrel } from './isoparts.js';
import { drawIslands } from './backdrops.js';

const QUAY = 1.6; // height of the quay above the water
const FACADES = [0xc8443a, 0xe0b040, 0x3a7aa8, 0xe8e0d0, 0x5aa080, 0xd8803a, 0x8a5aa0, 0xd8c8a8];
const ROOFS = [0x4a5260, 0x7a3a2e, 0x3a3e46, 0x8a4a34];
const BOATS = [0xb8322a, 0x2b5f8a, 0xe8e4da, 0x2f6a4a, 0xd0a030, 0x3a3f4a].map(hex);

export function generateHarbour(VW, VH, seed, season) {
  const K = createIso(VW, VH, { horizon: 0.3 });
  const { M, cx, cy, hp, bottom } = K;
  const rng = new RNG(seed);
  const row = hp + (bottom - hp) * 0.55;
  const C = row + 0.5 - cy;
  const yc = C - 4 + rng.int(-3, 3);                       // the coastline (land is south of it)
  const headX = C - 70;                                     // a headland juts out on the left
  const headY = yc - 62;                                    // its north shore
  const jy = headY + 3;                                     // the jetty runs east from the headland
  const lands = [
    { kind: 'main', x0: K.Xmin - 300, y0: yc, x1: K.Xmax + 300, y1: K.Ymax + 300 },
    { kind: 'head', x0: K.Xmin - 300, y0: headY, x1: headX, y1: yc },
    { kind: 'jetty', x0: headX - 1, y0: jy, x1: headX + 96, y1: jy + 6 },
  ];
  const piers = [];
  for (let px = C - 30 + rng.int(0, 10); px < C + 140; px += rng.int(34, 46)) {
    piers.push({ kind: 'pier', x0: px, y0: yc - 26, x1: px + 4, y1: yc });
  }
  lands.push(...piers);
  const rectDist = (l, X, Y) => Math.hypot(Math.max(l.x0 - X, 0, X - l.x1), Math.max(l.y0 - Y, 0, Y - l.y1));

  // ------------------------------------------------------------------ sea
  const sea = hex(0x24506a), deep = hex(0x1c3e58);
  K.ground((X, Y) => {
    let d = Infinity;
    for (const l of lands) d = Math.min(d, rectDist(l, X, Y));
    const far = 1 - Math.min(1, Math.max(0, ((X + Y) / 2 + cy - hp) / (bottom - hp)));
    K.water(mix(sea, deep, far * 0.6 + noise2(X * 0.05, Y * 0.05, 3) * 0.2), Math.max(0, 1 - d / 3.5));
  });

  // ----------------------------------------------------------- land tops
  const grass = mix(season.density < 0.3 ? hex(0x7a7a5a) : hex(0x5d8a44), hex(0x9a8a48), season.autumn * season.density * 0.5);
  const streetRows = [];
  for (let k = 0; k < 40; k++) streetRows.push(yc + 22 + k * 18);
  const isStreet = (X, Y) => streetRows.some((s) => Y >= s - 3 && Y < s + 3) || ((Math.floor(X - C) % 60 + 60) % 60 < 6 && Y > yc + 9);
  const landMat = (l) => (face, X, Y, Z) => {
    const n = hash2(Math.floor(X * 2), Math.floor(Y * 2), 5);
    if (face !== 0) {                                     // quay wall
      const zi = Math.floor(Z * 2), u = Math.floor((face === 1 ? Y : X) * 0.7 + (zi % 2) * 0.5);
      M.c = Z < 0.6 ? shade(hex(0x2e3a30), 0.9 + n * 0.2) : (u % 2 ? hex(0x6e685f) : hex(0x7a746a));
      if (l.kind === 'pier') M.c = Z < 0.6 ? hex(0x2e3a30) : hex(0x4a3828);
      return;
    }
    M.f = F.GROUND;
    if (l.kind === 'pier') {
      M.c = Math.floor(Y * 1.5) % 2 ? hex(0x7a5a3a) : hex(0x6a4c30);
      if (n > 0.9) M.c = shade(M.c, 0.8);
      return;
    }
    if (l.kind === 'head') {
      const rock = noise2(X * 0.08, Y * 0.08, 11) > 0.6 || X > headX - 3 || Y < headY + 3;
      M.c = rock ? shade(hex(0x7a756c), 0.9 + n * 0.2) : shade(grass, 0.88 + noise2(X * 0.2, Y * 0.2, 7) * 0.2);
      return;
    }
    M.f = F.GROUND | F.ROAD;
    if (l.kind === 'jetty') { M.c = (Math.floor(X / 3) + Math.floor(Y / 3)) % 2 ? hex(0x8a857a) : hex(0x7e7970); return; }
    if (Y < yc + 0.9) { M.c = hex(0xb0aa9e); return; }       // quay edge stones
    if (Y < yc + 9) {                                         // promenade slabs
      M.c = Math.floor(X) % 4 === 0 || Math.floor(Y) % 4 === 0 ? hex(0x8a857a) : shade(hex(0x9a958a), 0.95 + n * 0.08);
      return;
    }
    if (isStreet(X, Y)) { M.c = (Math.floor(X * 1.5) + Math.floor(Y * 1.5)) % 2 ? hex(0x7d766c) : hex(0x6f695f); return; }
    M.c = shade(hex(0x8a8378), 0.95 + n * 0.08);
  };
  for (const l of lands) K.box(l.x0, l.y0, l.x1, l.y1, 0, QUAY, landMat(l), true, hp + 1);

  // ------------------------------------------------------------- town
  const visX = (Y) => [Y - cx - 30, Y - cx + K.W + 30];
  let id = 1;
  for (let ri = 0; ri < streetRows.length; ri++) {
    const y0 = ri === 0 ? yc + 10 : streetRows[ri - 1] + 3, y1 = streetRows[ri] - 3;
    const [xa, xb] = visX(y1);
    if (y0 - (cx + 30) / 2 + cy > bottom + 30) break;
    const r = new RNG((hash2(ri, 1, seed) * 4294967296) >>> 0);
    let x = Math.floor(xa);
    while (x < xb) {
      if ((Math.floor(x - C) % 60 + 60) % 60 < 6) { x++; continue; }     // cross street
      const nearPier = ri === 0 && piers.some((p) => Math.abs(x - p.x0) < 12);
      if (nearPier && r.chance(0.6)) {
        // brick warehouse with a long roof
        const w = r.int(14, 18);
        house(K, r, { x0: x, y0, x1: x + w, y1, z0: QUAY, floors: 1, floorH: 8, ridge: 'gx', slope: 0.6, overhang: 0.8,
          wall: 0x8a4a3a, roof: 0x4a4e56, chimney: false, id: id++, pitch: 5, warm: 0.3 });
        x += w + 1;
        continue;
      }
      const w = r.int(6, 9);
      house(K, r, { x0: x, y0, x1: x + w, y1, z0: QUAY, floors: r.int(2, 3), floorH: 5, ridge: 'gy', slope: 1.05, overhang: 0.5,
        wall: r.pick(FACADES), roof: r.pick(ROOFS), shutter: r.chance(0.3) ? 0x2e4a5a : null, chimney: r.chance(0.5), id: id++, pitch: 3 });
      x += w;
    }
  }

  // promenade: lamps, bollards, stalls; piers: crates, barrels
  const pr = new RNG(seed ^ 0x77);
  const [pa, pb] = visX(yc);
  for (let X = Math.floor(pa / 16) * 16; X < pb + 20; X += 16) {
    K.lamp(X, yc + 6.5, pr, { z0: QUAY, height: 8, col: [255, 196, 130], radius: 26 });
    for (let b = 2; b < 16; b += 6) K.cylinder(X + b, yc + 1.2, 0.45, QUAY, QUAY + 0.9, K.edged(hex(0x2a2c30)));
    if (pr.chance(0.35)) crate(K, X + 8, yc + 4, QUAY);
    if (pr.chance(0.25)) barrel(K, X + 11, yc + 3, QUAY);
  }
  for (const p of piers) {
    for (let Y = p.y0 + 2; Y < p.y1 - 2; Y += 5) {
      if (pr.chance(0.4)) crate(K, p.x0 + 1, Y, QUAY);
      else if (pr.chance(0.3)) barrel(K, p.x0 + 2, Y + 1, QUAY);
    }
    K.cylinder(p.x0 + 0.5, p.y0 + 0.5, 0.45, 0, QUAY + 0.8, K.edged(hex(0x3a2c20)));
    K.cylinder(p.x1 - 0.5, p.y0 + 0.5, 0.45, 0, QUAY + 0.8, K.edged(hex(0x3a2c20)));
  }

  // headland: pines, rocks along the shore, a fisherman's hut
  const hr = new RNG(seed ^ 0x99);
  for (let k = 0; k < 70; k++) {
    const X = hr.int(K.Xmin + 10, headX - 6), Y = hr.int(headY + 5, yc - 6);
    if ((X + Y) / 2 + cy < hp + 4) continue;
    if (noise2(X * 0.08, Y * 0.08, 11) > 0.55) continue;
    K.tree(X, Y, hr, season, { species: hr.chance(0.8) ? 'pine' : 'broad', z0: QUAY, big: hr.float(0.9, 1.3) });
  }
  house(K, hr, { x0: headX - 24, y0: headY + 18, x1: headX - 14, y1: headY + 27, z0: QUAY, floors: 1, floorH: 5, ridge: 'gx', slope: 0.8,
    wall: 0x8a5a3a, timber: true, roof: 0x4a3a32, id: 999 });
  const rock = (X, Y, rad, z = 0) => K.blob(X, Y, z, rad, (h) => { M.c = shade(hex(0x6e6a62), 0.8 + h * 0.35); }, { seed: Math.floor(X * 7 + Y), squash: 0.7, rough: 0.4 });
  for (let Y = headY; Y < yc; Y += 3.5) rock(headX + 1 + hr.float(0, 1.5), Y, hr.float(1.2, 2.2), 0.3);
  for (let X = K.Xmin; X < headX; X += 3.5) if ((X + headY) / 2 + cy > hp + 3) rock(X, headY - 1 - hr.float(0, 1), hr.float(1.2, 2.2), 0.3);
  for (let X = headX; X < headX + 92; X += 3) { rock(X, jy + 7 + hr.float(0, 1), hr.float(1.3, 2.2), 0.2); rock(X + 1.5, jy - 1.5 - hr.float(0, 1), hr.float(1.2, 2), 0.2); }

  // lighthouse at the end of the jetty
  const lx = headX + 91, ly = jy + 3;
  for (let a = 0; a < 6.28; a += 0.5) rock(lx + Math.cos(a) * 6, ly + Math.sin(a) * 6, hr.float(1.5, 2.4), 0.2);
  K.cylinder(lx, ly, 4.6, 0, QUAY + 1.6, (face, X, Y, Z) => { M.c = face === 0 ? hex(0x8a857a) : (Z < 0.6 ? hex(0x2e3a30) : hex(0x7a746a)); });
  const towerTop = 30;
  K.cylinder(lx, ly, 3.1, QUAY + 1.6, towerTop, (face, X, Y, Z, ang) => {
    const band = Math.floor((Z - QUAY) / 5) % 2;
    M.c = band ? hex(0xc8352e) : hex(0xeeeae0);
    if (face === 1 && Math.abs(Math.sin(ang * 1.5)) < 0.18 && Math.floor(Z) % 7 === 3) { M.c = hex(0xffe4a0); M.f = F.WINDOW; M.e = 40; M.r = 255; }
  });
  K.cylinder(lx, ly, 4.0, towerTop, towerTop + 0.8, K.edged(hex(0x2a2c30)));
  K.cylinder(lx, ly, 2.3, towerTop + 0.8, towerTop + 4.5, (face) => {
    if (face === 0) { M.c = hex(0x2a2c30); return; }
    M.c = hex(0xfff0c0); M.f = F.LAMP; M.e = 40;
  });
  K.cone(lx, ly, 2.8, towerTop + 4.5, 2.6, () => { M.c = hex(0xb02a24); });
  K.lights.push({ X: lx, Y: ly, Z: towerTop + 2.6, kind: 3, thr: 0.16, col: lin([255, 236, 190], 2.2), radius: 40, exposed: true });

  // boats: moored beside the piers, a few at anchor, sailboats out at sea
  const br = new RNG(seed ^ 0x5b);
  const boats = [];
  const boat = (o) => boats.push({ ph: br.float(0, 6.28), col: br.pick(BOATS), ...o });
  for (const p of piers) {
    for (const side of [-1, 1]) {
      for (let Y = p.y0 + 2; Y < p.y1 - 10; Y += 13) {
        if (!br.chance(0.7)) continue;
        const X = side < 0 ? p.x0 - 4.2 : p.x1 + 0.6;
        boat({ X, Y, alongX: false, len: br.int(9, 12), wid: 3.6, kind: br.chance(0.7) ? 'fish' : 'sail' });
      }
    }
  }
  for (let k = 0; k < 4; k++) boat({ X: br.int(headX + 10, C + 120), Y: yc - br.int(34, 50), alongX: br.chance(0.5), len: br.int(6, 9), wid: 3, kind: br.chance(0.5) ? 'row' : 'fish' });
  for (let k = 0; k < 3; k++) {
    const Y = jy - br.int(25, 70), lo = 2 * (hp - cy) - Y + 10;   // keep them in front of the horizon
    boat({ X: br.int(Math.max(lo, C - 40), C + 220), Y, alongX: true, len: 11, wid: 3.4, kind: 'sail', vx: br.float(2, 4) * br.pick([-1, 1]), s0: lo, s1: K.Xmax });
  }

  K.backdrop((L, horizon) => drawIslands(L, seed ^ 0x1234, horizon));

  return K.finish({ boats, birds: 6, birdColor: [232, 234, 238], cityGlow: 0.35 });
}
