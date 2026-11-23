// Isometric pixel-art city, built with the shared isometric kit (isokit.js).
import { RNG, hash2, noise2 } from './rng.js';
import { F, hex, shade, mix, lin } from './raster.js';
import { drawFar, LIT, NEON, AWNINGS } from './city.js';
import { createIso, clamp } from './isokit.js';

const P = 52;          // street grid period (world units)
const ST = 14;         // street width: 3 sidewalk + 8 road + 3 sidewalk
const FH = 6;          // floor height
const GF = 6;          // ground floor height

const STYLES = [
  { wall: 0x8a3e34, tex: 'brick', roof: 0x8a8580 },
  { wall: 0x9a5a44, tex: 'brick', roof: 0x7a6f66 },
  { wall: 0x6a4536, tex: 'brick', roof: 0x8f8b84 },
  { wall: 0xbfa680, tex: 'stone', roof: 0x9a968c },
  { wall: 0xa98a62, tex: 'stone', roof: 0x6f8a78 },
  { wall: 0x41696a, tex: 'panel', roof: 0x7c8088 },
  { wall: 0x6f737c, tex: 'panel', roof: 0x8a8d92 },
  { wall: 0x3f4b6c, tex: 'panel', roof: 0x6e737c },
];
const GLASS_STYLES = [
  { wall: 0x34507a, tex: 'glass', roof: 0x5e646e },
  { wall: 0x2f5a6a, tex: 'glass', roof: 0x5a626a },
  { wall: 0x4a5a70, tex: 'glass', roof: 0x6a6e76 },
];
const CAR_COLS = [0xb8322a, 0x2b4f8a, 0xd8d4c8, 0x2a2c30, 0x3f6e4a, 0xc9a23a, 0x7a7d84].map(hex);
const ASPHALT = hex(0x34353b), SIDEWALK = hex(0x8a8781), CURB = hex(0xa9a59e), CONCRETE = hex(0x77746f);

export function generateIsoCity(VW, VH, seed, season) {
  const K = createIso(VW, VH);
  const { W, H, cx, cy, hp, M, lights, vents, Xmin, Xmax, Ymin, Ymax, tilt, box, solid, edged, onScreen } = K;
  const bottom = K.bottom, PY = K.PY;
  const rngL = new RNG(seed);
  const ox = rngL.int(0, P - 1), oy = rngL.int(0, P - 1);
  const hseed = rngL.int(0, 1e6);
  const tree = (X, Y, r, big = 1) => K.tree(X, Y, r, season, { big });
  const lamp = (X, Y, r) => K.lamp(X, Y, r);

  // -------------------------------------------------------------- city layout
  // Blocks split into lots; each lot is a building, park, plaza or car park.
  const blocks = new Map();
  const bxA = Math.floor((Xmin - ox) / P), bxB = Math.floor((Xmax - ox) / P);
  const byA = Math.floor((Ymin - oy) / P), byB = Math.floor((Ymax - oy) / P);
  for (let bx = bxA; bx <= bxB; bx++) for (let by = byA; by <= byB; by++) {
    const r = new RNG((hash2(bx, by, seed) * 4294967296) >>> 0);
    const X0 = ox + bx * P + ST, Y0 = oy + by * P + ST, S = P - ST;
    const lots = [];
    const blockType = r.next() < 0.08 ? 'park' : null;
    const split = (x, y, w, h, d) => {
      if (d >= 2 || (w < 22 && h < 22) || (d >= 1 && r.chance(0.3))) {
        const t = r.next();
        lots.push({ x0: x, y0: y, x1: x + w, y1: y + h, type: blockType || (t < 0.06 ? 'park' : t < 0.11 ? 'plaza' : t < 0.15 ? 'parking' : 'building') });
        return;
      }
      if (w >= h) { const k = Math.round(w * r.float(0.4, 0.6)); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
      else { const k = Math.round(h * r.float(0.4, 0.6)); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
    };
    split(X0, Y0, S, S, 0);
    blocks.set(bx * 100003 + by, { bx, by, lots });
  }
  const lotAt = (X, Y) => {
    const bx = Math.floor((X - ox) / P), by = Math.floor((Y - oy) / P);
    const b = blocks.get(bx * 100003 + by);
    if (!b) return null;
    for (const l of b.lots) if (X >= l.x0 && X < l.x1 && Y >= l.y0 && Y < l.y1) return l;
    return null;
  };
  // street cross-section: 'side' | 'road' | null (inside a block)
  const streetAt = (X, Y) => {
    const mx = ((X - ox) % P + P) % P, my = ((Y - oy) % P + P) % P;
    const sX = mx < ST, sY = my < ST;
    if (!sX && !sY) return null;
    const side = (m) => m < 3 || m >= ST - 3;
    if (sX && sY) return side(mx) && side(my) ? 'side' : 'road';
    return side(sX ? mx : my) ? 'side' : 'road';
  };

  // ---------------------------------------------------------- ground material
  const grassBase = season.density < 0.3 ? hex(0x6b6650) : season.fresh > 0.5 ? hex(0x5f9a45) : hex(0x4f7d3a);
  const grass = mix(grassBase, hex(0x8a8240), season.autumn * season.density * 0.7);
  function groundMat(X, Y) {
    M.nx = 0; M.ny = 0; M.nz = 1; M.e = 0; M.s = 0;
    const Xi = Math.floor(X), Yi = Math.floor(Y);
    const n = hash2(Xi, Yi, 3);
    M.r = Math.floor(n * 199);
    const mx = ((X - ox) % P + P) % P, my = ((Y - oy) % P + P) % P;
    const sX = mx < ST, sY = my < ST;
    if (sX || sY) {
      const kind = streetAt(X, Y);
      const m = sX && !sY ? mx : sY && !sX ? my : Math.min(mx, my);
      const along = sX && !sY ? my : mx;
      if (kind === 'side') {
        M.f = F.GROUND;
        const mi = Math.floor(m);
        if (!(sX && sY) && (mi === 2 || mi === ST - 3)) M.c = CURB;
        else if (Math.floor(along) % 4 === 0) M.c = shade(SIDEWALK, 0.86);
        else M.c = shade(SIDEWALK, 0.95 + n * 0.08);
        return;
      }
      M.f = F.GROUND | F.ROAD;
      let c = shade(ASPHALT, 0.9 + n * 0.16);
      if (!(sX && sY)) {
        const mi = Math.floor(m), ai = Math.floor(along);
        if ((ai >= ST && ai < ST + 3) || ai >= P - 3) { if (mi % 2 === 0) c = hex(0xc9c6bc); }
        else if (mi === 7 && ai % 6 < 3) c = hex(0xbfa452);
        if (mi === 4 || mi === 5 || mi === 9 || mi === 10) M.r = 230; // tyre tracks in snow
      }
      M.c = c;
      return;
    }
    const lot = lotAt(X, Y);
    const type = lot ? lot.type : 'building';
    if (type === 'park') {
      M.f = F.GROUND;
      M.c = shade(grass, 0.88 + noise2(X * 0.2, Y * 0.2, 5) * 0.2 + n * 0.06);
    } else if (type === 'plaza') {
      M.f = F.GROUND | F.ROAD;
      M.c = ((Xi >> 1) + (Yi >> 1)) % 2 ? hex(0xa39c8e) : hex(0x948d80);
    } else if (type === 'parking') {
      M.f = F.GROUND | F.ROAD;
      M.c = (Xi - lot.x0) % 5 === 0 && Yi > lot.y0 + 1 && Yi < lot.y1 - 2 ? hex(0xd0cdc4) : shade(ASPHALT, 0.95 + n * 0.1);
    } else {
      M.f = F.GROUND;
      M.c = shade(CONCRETE, 0.9 + n * 0.1);
    }
  }

  K.ground(groundMat);

  // ---------------------------------------------------------------- buildings
  function wallMaterial(b) {
    const { x0, y0, x1, y1, z0, z1, style, id, shop, shopThr } = b;
    const wall = hex(style.wall), roof = hex(style.roof);
    const dark = shade(wall, 0.7), light = shade(wall, 1.2);
    const glass = style.tex === 'glass';
    return (face, X, Y, Z) => {
      if (face === 0) {
        const edge = Math.min(X - x0, x1 - X, Y - y0, y1 - Y);
        M.c = edge < 1 ? shade(roof, 1.28) : shade(roof, 0.94 + hash2(X | 0, Y | 0, id) * 0.12);
        return;
      }
      const u = face === 1 ? Y - y0 : X - x0, uLen = face === 1 ? y1 - y0 : x1 - x0;
      const ui = Math.floor(u), zi = Math.floor(Z);
      let c = wall, k = 1;
      if (zi >= z1 - 1) { M.c = light; tilt(face, 0.8); return; } // cornice
      if (glass) {
        if (ui % 3 === 0 || zi % 3 === 0 || ui === uLen - 1) { M.c = shade(wall, 0.72); }
        else {
          const cu = Math.floor(ui / 3), cz = Math.floor(zi / 3);
          const h = hash2(id * 7 + face, cu * 131 + cz, 77);
          M.c = shade(LIT[4 + Math.floor(h * 3) % 3], 0.9);
          M.f = F.WINDOW | F.GLASS;
          M.e = h < 0.4 ? 255 : Math.round((0.1 + (h - 0.4) / 0.6 * 0.85) * 255);
          M.r = Math.floor(hash2(id + face * 999, cu * 53 + cz, 5) * 255);
        }
        if (ui === uLen - 1 && face === 2) M.c = shade(M.c, 1.15);
        return;
      }
      if (z0 === 0 && zi < GF && shop) {
        if (zi === GF - 1) { // awning
          const aw = AWNINGS[id % AWNINGS.length];
          M.c = hex((ui >> 1) & 1 ? aw[1] : aw[0]);
          tilt(face, 0.6);
          return;
        }
        if (zi === 0) { M.c = dark; return; }
        const door = ui >= 3 && ui < 5;
        if (door) { M.c = zi === 4 ? LIT[0] : hex(0x3a2a20); if (zi === 4) { M.f = F.WINDOW; M.e = shopThr[face]; M.r = 255; } return; }
        if (ui >= 1 && ui < uLen - 1) {
          const lit = LIT[(id + face) % LIT.length];
          M.c = zi === 1 && hash2(ui, id, 9) < 0.5 ? shade(lit, 0.5) : lit;
          M.f = F.WINDOW; M.e = shopThr[face]; M.r = 255;
          return;
        }
        M.c = dark;
        return;
      }
      // upper floors (and plain ground floors)
      const fl = Math.floor((zi - GF) / FH), zin = zi - GF - fl * FH;
      const wp = b.wp, ww = b.ww;
      const col = Math.floor((ui - 2) / wp), cu = ui - 2 - col * wp;
      const inU = ui >= 2 && ui < uLen - 2 && cu < ww;
      if (zi >= GF && zi < z1 - 2 && inU && zin >= 2 && zin < 5) {
        const h = hash2(id * 7 + face, fl * 131 + col, 77);
        const t = hash2(id * 13 + face, fl * 37 + col, 91);
        const lit = LIT[Math.floor(h * LIT.length)];
        M.c = zin === 4 ? shade(lit, 0.82) : h > 0.7 && (cu === 0 || cu === ww - 1) ? shade(lit, 0.62) : lit;
        M.f = F.WINDOW;
        M.e = t < 0.35 ? 255 : t < 0.4 ? 3 : Math.round((0.12 + ((t - 0.4) / 0.6) * 0.85) * 255);
        M.r = Math.floor(hash2(id + face * 999, fl * 53 + col, 5) * 255);
        return;
      }
      if (zi >= GF && inU && zin === 1 && zi < z1 - 2) { M.c = light; tilt(face); return; } // sill
      if (z0 === 0 && zi < GF && ui >= Math.floor(uLen / 2) - 1 && ui <= Math.floor(uLen / 2)) { M.c = hex(0x3a2a20); return; } // door
      if (style.tex === 'brick') {
        if (zi % 3 === 0) k = 0.86;
        else if ((ui + (Math.floor(zi / 3) % 2) * 2) % 4 === 0) k = 0.94;
      } else if (style.tex === 'panel') {
        if (ui % 8 === 0 || (zi - GF) % FH === 0) k = 0.9;
      } else if (zi % 4 === 3) k = 0.92;
      if (ui === uLen - 1 && face === 2) k *= 1.15;   // front corner highlight
      else if (ui === 0) k *= 0.85;
      M.c = shade(c, k * (0.97 + hash2(ui, zi + face * 977, id) * 0.06));
    };
  }

  const facesStreet = (X, Y) => streetAt(X, Y) !== null;
  let bid = 1;
  function building(lot, r) {
    const inset = r.chance(0.35) ? 1 : 0;
    const x0 = lot.x0 + inset, y0 = lot.y0 + inset, x1 = lot.x1 - inset, y1 = lot.y1 - inset;
    const gy = (x0 + y0 + x1 + y1) / 4 + cy;
    const t = clamp((gy - hp) / (bottom - hp), 0, 1);
    const downtown = 0.45 + 0.9 * noise2((x0 - y0) / 140, 3.3, hseed);
    let h = ((0.4 * (1 - t) + 0.12 * t) * VH * downtown) * r.float(0.3, 1);
    h = Math.min(h, (x0 + y0) / 2 + cy - PY - 0.13 * VH);   // keep a band of sky above the city
    h = Math.max(GF + FH + 2, Math.round((h - GF - 2) / FH) * FH + GF + 2);
    if (!onScreen(x0, y0, x1, y1, h + 20)) return;
    const tall = h > 0.3 * VH;
    const style = tall && r.chance(0.5) ? r.pick(GLASS_STYLES) : r.pick(STYLES);
    const id = bid++;
    const shopThr = [0, Math.round(r.float(0.03, 0.35) * 255), Math.round(r.float(0.03, 0.35) * 255)];
    const b = { x0, y0, x1, y1, z0: 0, z1: h, style, id, shop: style.tex !== 'glass' && r.chance(0.75), shopThr, wp: r.pick([4, 4, 5]), ww: r.pick([2, 2, 3]) };
    const roofZ = roofed(b);

    if (b.shop) {
      // light spilling from shop windows onto the sidewalk
      const lit = LIT[(id + 1) % LIT.length];
      if (facesStreet(x1 + 2, (y0 + y1) / 2)) lights.push({ X: x1 + 2.5, Y: (y0 + y1) / 2, Z: 2.5, kind: 2, thr: shopThr[1] / 255, col: lin(lit, 0.5), radius: Math.min(20, (y1 - y0) * 0.7 + 6) });
      if (facesStreet((x0 + x1) / 2, y1 + 2)) lights.push({ X: (x0 + x1) / 2, Y: y1 + 2.5, Z: 2.5, kind: 2, thr: shopThr[2] / 255, col: lin(LIT[(id + 2) % LIT.length], 0.5), radius: Math.min(20, (x1 - x0) * 0.7 + 6) });
      if (h >= GF + 2 * FH && r.chance(0.4)) {
        // neon blade sign sticking out of a wall
        const nc = r.pick(NEON), seedN = r.int(0, 255), sh = r.int(8, 12);
        const z0n = GF + 1;
        if (r.chance(0.5)) {
          const ys = y0 + r.int(2, Math.max(2, y1 - y0 - 4));
          box(x1, ys, x1 + 1.5, ys + 1, z0n, z0n + sh, (face) => { M.c = face === 0 ? hex(0x1b1a22) : nc; if (face) { M.f = F.NEON; M.r = seedN; } });
          lights.push({ X: x1 + 1.2, Y: ys + 0.5, Z: z0n + sh / 2, kind: 1, thr: seedN / 255, col: lin(nc, 0.9), radius: 22 });
        } else {
          const xs = x0 + r.int(2, Math.max(2, x1 - x0 - 4));
          box(xs, y1, xs + 1, y1 + 1.5, z0n, z0n + sh, (face) => { M.c = face === 0 ? hex(0x1b1a22) : nc; if (face) { M.f = F.NEON; M.r = seedN; } });
          lights.push({ X: xs + 0.5, Y: y1 + 1.2, Z: z0n + sh / 2, kind: 1, thr: seedN / 255, col: lin(nc, 0.9), radius: 22 });
        }
      }
    }

    // setback tower
    let top = roofZ, tx0 = x0, ty0 = y0, tx1 = x1, ty1 = y1;
    if (tall && Math.min(x1 - x0, y1 - y0) >= 12 && r.chance(0.55)) {
      const i0 = r.int(2, 4), i1 = r.int(2, 4);
      tx0 = x0 + i0; ty0 = y0 + i1; tx1 = x1 - r.int(2, 4); ty1 = y1 - r.int(2, 4);
      const h2 = r.int(2, 5) * FH;
      top = roofed({ ...b, x0: tx0, y0: ty0, x1: tx1, y1: ty1, z0: roofZ, z1: roofZ + h2, shop: false });
    }
    roofClutter(r, tx0, ty0, tx1, ty1, top, style.tex === 'glass');
  }

  // Building body plus a 1-unit parapet ring, so roofs have a raised rim that
  // throws a thin shadow when the sun is low. Returns the roof height.
  function roofed(b) {
    const { x0, y0, x1, y1, z0, z1 } = b;
    const mat = wallMaterial(b);
    if (x1 - x0 < 6 || y1 - y0 < 6) { box(x0, y0, x1, y1, z0, z1, mat); return z1; }
    box(x0, y0, x1, y1, z0, z1 - 1, mat);
    const roof = hex(b.style.roof);
    const rim = (bx1, by1) => (face, X, Y, Z) => {
      if (face === 0) { M.c = shade(roof, 1.3); return; }
      const outer = face === 1 ? bx1 === x1 : by1 === y1;
      if (outer) mat(face, X, Y, Z);
      else M.c = shade(roof, 0.78);
    };
    box(x1 - 1, y0, x1, y1, z1 - 1, z1, rim(x1, y1));
    box(x0, y1 - 1, x1, y1, z1 - 1, z1, rim(x1, y1));
    box(x0, y0, x0 + 1, y1, z1 - 1, z1, rim(x0 + 1, y1));
    box(x0, y0, x1, y0 + 1, z1 - 1, z1, rim(x1, y0 + 1));
    return z1 - 1;
  }

  function roofClutter(r, x0, y0, x1, y1, top, glass) {
    const w = x1 - x0, d = y1 - y0;
    if (w < 6 || d < 6) return;
    const n = r.int(0, 3);
    for (let k = 0; k < n; k++) {
      const ax = x0 + r.int(1, w - 4), ay = y0 + r.int(1, d - 4);
      const t = r.next();
      if (t < 0.45) box(ax, ay, ax + 3, ay + 2, top, top + 2, edged(shade(hex(0x8a8d93), r.float(0.85, 1.1))));
      else if (t < 0.7) box(ax, ay, ax + 3, ay + 3, top, top + 3, edged(shade(hex(0x6c6f78), r.float(0.85, 1.1))));
      else if (!glass && t < 0.85 && w >= 10 && d >= 10) waterTower(r, ax, ay, top);
      else vent(ax, ay, top);
    }
    if (r.chance(0.5)) vent(x0 + r.int(1, w - 2), y0 + r.int(1, d - 2), top);
    if (r.chance(glass ? 0.5 : 0.15)) {
      const axx = x0 + Math.floor(w / 2), ayy = y0 + Math.floor(d / 2), ah = r.int(8, 16);
      box(axx, ayy, axx + 1, ayy + 1, top, top + ah, solid(hex(0x3a3d45)));
      box(axx, ayy, axx + 1, ayy + 1, top + ah, top + ah + 1, (face) => { M.c = hex(0x5a1410); M.f = F.BLINK; M.r = r.int(0, 255); });
    }
  }

  function vent(x, y, top) {
    box(x, y, x + 1, y + 1, top, top + 2, edged(hex(0x7a7d86)));
    box(x - 0.3, y - 0.3, x + 1.3, y + 1.3, top + 2, top + 2.6, edged(hex(0x5a5d66)));
    if (onScreen(x, y, x + 1, y + 1, top + 3)) vents.push({ X: x + 0.5, Y: y + 0.5, Z: top + 2.6 });
  }

  // Wooden water tank on steel legs with a conical cap; the hoops and the
  // lit/shaded sides keep it readable at a few pixels wide.
  function waterTower(r, x, y, top) {
    const wood = shade(hex(0x9a6a42), r.float(0.9, 1.1)), hoop = hex(0x3a3330), steel = hex(0x4a4d55), cap = hex(0x5b4a40);
    for (const [lx, ly] of [[0, 0], [3, 0], [0, 3], [3, 3]]) box(x + lx, y + ly, x + lx + 1, y + ly + 1, top, top + 3, solid(steel));
    box(x, y, x + 4, y + 4, top + 3, top + 8, (face, X, Y, Z) => {
      if (face === 0) { M.c = shade(wood, 0.8); return; }
      M.c = Math.floor(Z - top) % 2 === 0 ? hoop : wood;
      M.nx *= 0.85; M.ny *= 0.85; M.nz = 0.2;
    });
    box(x + 0.5, y + 0.5, x + 3.5, y + 3.5, top + 8, top + 9, edged(cap));
    box(x + 1, y + 1, x + 3, y + 3, top + 9, top + 10, edged(cap));
    box(x + 1.5, y + 1.5, x + 2.5, y + 2.5, top + 10, top + 10.7, edged(cap));
  }

  // ----------------------------------------------------------- street props
  function car(X, Y, alongX, r) {
    const col = r.pick(CAR_COLS);
    const L = 6, Wd = 3;
    const x1 = alongX ? X + L : X + Wd, y1 = alongX ? Y + Wd : Y + L;
    if (!onScreen(X, Y, x1, y1, 4)) return;
    box(X, Y, x1, y1, 0.4, 2, (face) => { M.c = face === 0 ? shade(col, 1.12) : col; });
    const c0 = alongX ? [X + 1.5, Y + 0.4, X + 4.5, Y + 2.6] : [X + 0.4, Y + 1.5, X + 2.6, Y + 4.5];
    box(c0[0], c0[1], c0[2], c0[3], 2, 3.2, (face) => {
      if (face === 0) { M.c = shade(col, 1.05); return; }
      M.c = hex(0x2a3440); M.f = F.GLASS;
    });
  }

  // ------------------------------------------------------------ place things
  for (const b of blocks.values()) {
    const r = new RNG((hash2(b.bx, b.by, seed + 1) * 4294967296) >>> 0);
    for (const lot of b.lots) {
      const lr = new RNG(r.int(0, 1e9));
      if ((lot.x0 + lot.y0 + lot.x1 + lot.y1) / 4 + cy < hp) continue;
      if (lot.type === 'building') building(lot, lr);
      else if (lot.type === 'park') {
        const n = Math.round(((lot.x1 - lot.x0) * (lot.y1 - lot.y0)) / 60);
        for (let i = 0; i < n; i++) tree(lr.int(lot.x0 + 2, lot.x1 - 3), lr.int(lot.y0 + 2, lot.y1 - 3), lr, lr.float(1, 1.35));
      } else if (lot.type === 'plaza') {
        if (lr.chance(0.7)) tree(Math.round((lot.x0 + lot.x1) / 2), Math.round((lot.y0 + lot.y1) / 2), lr, 1.3);
      } else if (lot.type === 'parking') {
        for (let x = lot.x0 + 1; x + 4 < lot.x1; x += 5) if (lr.chance(0.6)) car(x + 0.5, lot.y0 + 2, false, lr);
      }
    }
    // the two streets on this block's north and east sides
    const sx0 = ox + b.bx * P, sy0 = oy + b.by * P;
    const segs = [
      { alongX: false, fixed: sx0, from: sy0 + ST, to: sy0 + P }, // street running north-south
      { alongX: true, fixed: sy0, from: sx0 + ST, to: sx0 + P },  // street running east-west
    ];
    for (const s of segs) {
      const sr = new RNG(r.int(0, 1e9));
      const at = (along, m) => (s.alongX ? [along, s.fixed + m] : [s.fixed + m, along]);
      for (let a = s.from + 3, k = 0; a < s.to - 2; a += 9, k++) {
        // lamps alternate sides of the street; trees fill the gaps
        for (const [side, m] of [[0, 1], [1, ST - 2]]) {
          const [X, Y] = at(a, m);
          if ((X + Y) / 2 + cy < hp - 2) continue;
          if (k % 4 === side * 2) lamp(X, Y, sr);
          else if (k % 2 === 1 && sr.chance(0.75)) tree(X, Y, sr);
        }
      }
    }
  }

  // ------------------------------------------------- distant skyline behind
  K.backdrop((layer, horizon) => drawFar(layer, new RNG(seed ^ 0x2545f491), horizon + 8));

  // Traffic lanes: every street has one lane each way either side of the centre line.
  const lanes = [];
  for (let bx = bxA; bx <= bxB; bx++) {
    const X = ox + bx * P;
    lanes.push({ alongX: false, c: X + 5, dir: -1, s0: Ymin, s1: Ymax }, { alongX: false, c: X + 9, dir: 1, s0: Ymin, s1: Ymax });
  }
  for (let by = byA; by <= byB; by++) {
    const Y = oy + by * P;
    lanes.push({ alongX: true, c: Y + 5, dir: -1, s0: Xmin, s1: Xmax }, { alongX: true, c: Y + 9, dir: 1, s0: Xmin, s1: Xmax });
  }

  return K.finish({ lanes });
}
