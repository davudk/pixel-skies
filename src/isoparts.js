// Reusable isometric building parts: pitched-roof houses, a church, props.
// All of them draw through an isometric kit K (see isokit.js).
import { hash2 } from './rng.js';
import { F, hex, shade, lin } from './raster.js';
import { LIT } from './city.js';

const DOOR = hex(0x4a3020), DARK = hex(0x2a2522);

// Window threshold from a hash: some windows never light, a few always do.
const thrOf = (h) => (h < 0.3 ? 255 : h < 0.36 ? 3 : Math.round((0.08 + ((h - 0.36) / 0.64) * 0.8) * 255));

// Pitched-roof house. Walls get windows per floor (with optional shutters and
// sills), a door on the south face, optional stone base and timber framing.
// The roof has shingle rows, an overhang, gable end walls and a smoking chimney.
export function house(K, r, o) {
  const { M } = K;
  const {
    x0, y0, x1, y1, z0 = 0, floors = 2, floorH = 5, ridge = 'gx', slope = 0.7, overhang = 1.2,
    wall, base = null, timber = false, roof, shutter = null, chimney = true, id = r.int(1, 1e6),
    pitch = 4, doorFace = 2, warm = 0.45,
  } = o;
  const zTop = z0 + floors * floorH;
  if (!K.onScreen(x0 - 2, y0 - 2, x1 + 2, y1 + 2, zTop + (y1 - y0) * slope)) return null;
  const wallC = hex(wall), baseC = base ? hex(base) : null, roofC = hex(roof), shutC = shutter ? hex(shutter) : null;
  const beam = shade(wallC, 0.62), light = shade(baseC || wallC, 1.18);
  const lit = LIT[id % LIT.length];
  let doorThr = 255;

  const wallMat = (face, X, Y, Z) => {
    const u = face === 1 ? Y - y0 : X - x0, uLen = face === 1 ? y1 - y0 : x1 - x0;
    const ui = Math.floor(u), zr = Z - z0, zi = Math.floor(zr);
    const fl = Math.floor(zr / floorH), zin = zi - fl * floorH;
    const isBase = baseC && fl === 0;
    let c = isBase ? baseC : wallC;
    // texture: stone blocks, or timber planks with beams
    if (isBase) { if (zi % 2 === 0 ? (ui % 3 === 0) : ((ui + 1) % 3 === 0)) c = shade(c, 0.85); }
    else if (timber) { if (ui % 2 === 0) c = shade(c, 0.93); if (zin === 0 || ui === 0 || ui === uLen - 1) c = beam; }
    // door
    const dc = Math.floor(uLen / 2) - 1;
    if (face === doorFace && fl === 0 && ui >= dc && ui < dc + 2 && zin < 4) {
      if (zin === 3) { const h = hash2(id, face, 11); doorThr = Math.min(254, thrOf(h) === 255 ? 40 : thrOf(h)); M.c = lit; M.f = F.WINDOW; M.e = doorThr; M.r = 255; return; }
      M.c = zin === 0 ? shade(DOOR, 0.8) : DOOR; return;
    }
    // windows: 2 wide, 2 tall, on a pitch
    const col = Math.floor((ui - 2) / pitch), cu = ui - 2 - col * pitch;
    const inWin = ui >= 2 && ui < uLen - 2 && cu < 2;
    if (inWin && zin >= 2 && zin < 4) {
      const h = hash2(id * 7 + face, fl * 131 + col, 77);
      M.c = zin === 3 ? shade(lit, 0.85) : lit; M.f = F.WINDOW; M.e = thrOf(h);
      M.r = Math.floor(hash2(id + face * 999, fl * 53 + col, 5) * 255);
      return;
    }
    if (inWin && zin === 1) { M.c = light; K.tilt(face); return; }               // sill
    if (shutC && ui >= 2 && ui < uLen - 2 && (cu === pitch - 1 || cu === 2) && zin >= 2 && zin < 4) { M.c = shutC; return; }
    if (ui === uLen - 1 && face === 2) c = shade(c, 1.12);
    else if (ui === 0) c = shade(c, 0.86);
    M.c = shade(c, 0.97 + hash2(ui, zi + face * 77, id) * 0.06);
  };
  K.box(x0, y0, x1, y1, z0, zTop, wallMat);

  const rx0 = x0 - overhang, ry0 = y0 - overhang, rx1 = x1 + overhang, ry1 = y1 + overhang;
  const roofMat = (face, X, Y, Z) => {
    const edge = Math.min(X - rx0, rx1 - X, Y - ry0, ry1 - Y);
    const row = Math.floor((Z - zTop) * 2.4);
    let c = row % 2 === 0 ? roofC : shade(roofC, 0.88);
    c = shade(c, 0.95 + hash2(Math.floor(X), Math.floor(Y) + row * 31, id) * 0.1);
    if (edge < 0.7) {
      // the eave board: faces outwards, so it stays dark when the roof is snowy
      c = shade(roofC, 0.7);
      const e = [rx1 - X, ry1 - Y, X - rx0, Y - ry0], i = e.indexOf(Math.min(...e));
      K.setN([[0.92, 0, 0.38], [0, 0.92, 0.38], [-0.92, 0, 0.38], [0, -0.92, 0.38]][i]);
    }
    M.c = c;
  };
  const gableFn = (face, X, Y, Z) => {
    const u = face === 1 ? Y - y0 : X - x0, uLen = face === 1 ? y1 - y0 : x1 - x0;
    const ui = Math.floor(u), zi = Math.floor(Z - zTop);
    if (Math.abs(u - uLen / 2) < 1 && zi >= 1 && zi < 3) { M.c = lit; M.f = F.WINDOW; M.e = thrOf(hash2(id, face, 3)); M.r = 200; return; }
    let c = timber ? (ui % 2 ? wallC : shade(wallC, 0.93)) : wallC;
    if (timber && (ui % 4 === 0)) c = beam;
    M.c = c;
  };
  const gable = ridge === 'gx' ? { x: x1, y0, y1, z0: zTop, fn: gableFn } : { y: y1, x0, x1, z0: zTop, fn: gableFn };
  const ridgeZ = K.roof(rx0, ry0, rx1, ry1, zTop, slope, ridge, roofMat, gable);

  if (chimney) {
    const along = r.float(0.2, 0.75);
    const chx = ridge === 'gx' ? x0 + (x1 - x0) * along : (x0 + x1) / 2 + r.pick([-2, 0.5]);
    const chy = ridge === 'gx' ? (y0 + y1) / 2 + r.pick([-2, 0.5]) : y0 + (y1 - y0) * along;
    const top = ridgeZ + 1.5;
    const stone = hex(0x7a6e66);
    K.box(chx, chy, chx + 1.5, chy + 1.5, zTop, top, (face, X, Y, Z) => { M.c = Math.floor(Z * 2) % 2 ? stone : shade(stone, 0.85); });
    K.box(chx - 0.25, chy - 0.25, chx + 1.75, chy + 1.75, top, top + 0.5, K.edged(shade(stone, 0.75)));
    K.vents.push({ X: chx + 0.75, Y: chy + 0.75, Z: top + 0.5, smoke: true });
  }

  // warm light spilling from the door onto the ground in front
  const dx = doorFace === 2 ? (x0 + x1) / 2 : x1 + 2, dy = doorFace === 2 ? y1 + 2 : (y0 + y1) / 2;
  K.lights.push({ X: dx, Y: dy, Z: z0 + 3, kind: 2, thr: (doorThr === 255 ? 120 : doorThr) / 255, col: lin(lit, warm), radius: 14 });
  return { ridgeZ, zTop };
}

// Village church: white nave with tall glowing windows, slate roof, and a
// square tower with a steep spire on the south (front) end.
export function church(K, r, x0, y0, wid, len) {
  const { M } = K;
  const x1 = x0 + wid, y1 = y0 + len, h = 10;
  if (!K.onScreen(x0 - 4, y0 - 4, x1 + 4, y1 + 10, 45)) return;
  const white = hex(0xd9d2c4), slate = hex(0x4a5260), glass = [hex(0x6a8cd0), hex(0xd06a6a), hex(0xe0c060)];
  const nave = (face, X, Y, Z) => {
    const u = face === 1 ? Y - y0 : X - x0, ui = Math.floor(u), zi = Math.floor(Z);
    if (face === 1 && ui % 5 === 2 && zi >= 3 && zi < 8) { M.c = glass[Math.floor(ui / 5) % 3]; M.f = F.WINDOW; M.e = Math.round(0.25 * 255); M.r = 255; return; }
    M.c = shade(white, zi < 1 ? 0.8 : 0.97 + hash2(ui, zi, 5) * 0.05);
  };
  K.box(x0, y0, x1, y1, 0, h, nave);
  const roofMat = (face, X, Y, Z) => { M.c = Math.floor((Z - h) * 2.4) % 2 ? slate : shade(slate, 0.88); };
  K.roof(x0 - 1, y0 - 1, x1 + 1, y1, h, 1.0, 'gy', roofMat, { y: y1, x0, x1, z0: h, fn: (f, X, Y, Z) => { M.c = white; } });
  // tower in front
  const tx0 = x0 + wid / 2 - 3.5, tx1 = tx0 + 7, ty0 = y1 - 1, ty1 = y1 + 6, th = 26;
  K.box(tx0, ty0, tx1, ty1, 0, th, (face, X, Y, Z) => {
    const u = face === 1 ? Y - ty0 : X - tx0, ui = Math.floor(u), zi = Math.floor(Z);
    if (zi >= th - 6 && zi < th - 2 && ui >= 2 && ui < 5) { M.c = DARK; return; }                   // belfry
    if (face === 2 && zi >= th - 10 && zi < th - 8 && ui >= 3 && ui < 4.5) { M.c = hex(0xf2e2a0); M.f = F.WINDOW; M.e = 60; M.r = 255; return; } // clock
    if (face === 2 && zi < 4 && ui >= 2 && ui < 5) { M.c = DOOR; return; }
    M.c = shade(white, zi >= th - 1 ? 1.1 : 0.96 + hash2(ui, zi, 9) * 0.06);
  });
  const spire = K.roof(tx0 - 0.5, ty0 - 0.5, tx1 + 0.5, ty1 + 0.5, th, 2.6, 'hip', (f, X, Y, Z) => { M.c = Math.floor(Z) % 2 ? slate : shade(slate, 0.85); });
  const mx = (tx0 + tx1) / 2, my = (ty0 + ty1) / 2;
  K.box(mx - 0.25, my - 0.25, mx + 0.25, my + 0.25, spire, spire + 3, K.solid(hex(0xc9a24a)));
  K.box(mx - 1, my - 0.25, mx + 1, my + 0.25, spire + 1.8, spire + 2.3, K.solid(hex(0xc9a24a)));
  K.lights.push({ X: x1 + 2, Y: (y0 + y1) / 2, Z: 5, kind: 2, thr: 0.25, col: lin([255, 200, 150], 0.4), radius: 16 });
}

export function crate(K, x, y, z0 = 0) {
  const c = shade(hex(0x9a7448), 0.9 + hash2(Math.floor(x * 3), Math.floor(y * 3), 4) * 0.2);
  K.box(x, y, x + 1.6, y + 1.6, z0, z0 + 1.5, (face, X, Y, Z) => { K.M.c = face === 0 ? shade(c, 1.1) : (Math.floor((X + Y) * 2) % 3 === 0 ? shade(c, 0.75) : c); });
}

export function barrel(K, x, y, z0 = 0) {
  const c = hex(0x7a5232);
  K.cylinder(x, y, 0.75, z0, z0 + 1.7, (face, X, Y, Z) => { K.M.c = face === 0 ? shade(c, 0.8) : (Math.abs(Z - z0 - 0.4) < 0.2 || Math.abs(Z - z0 - 1.3) < 0.2 ? hex(0x3a3330) : c); });
}

export function woodpile(K, x, y, alongX, z0 = 0) {
  const x1 = alongX ? x + 4 : x + 1.6, y1 = alongX ? y + 1.6 : y + 4;
  K.box(x, y, x1, y1, z0, z0 + 2, (face, X, Y, Z) => {
    const end = (alongX && face === 1) || (!alongX && face === 2);
    K.M.c = end ? (hash2(Math.floor((alongX ? Y : X) * 2), Math.floor(Z * 2), 7) < 0.5 ? hex(0xb08a5a) : hex(0x8a6a44)) : hex(0x6a4a30);
  });
}

// Wooden fence along a straight line (posts and two rails).
export function fence(K, x0, y0, x1, y1) {
  const wood = hex(0x6a4a30), len = Math.hypot(x1 - x0, y1 - y0), along = Math.abs(x1 - x0) > Math.abs(y1 - y0);
  for (let t = 0; t <= len; t += 2.5) {
    const x = x0 + ((x1 - x0) * t) / len, y = y0 + ((y1 - y0) * t) / len;
    K.box(x, y, x + 0.5, y + 0.5, 0, 2.2, K.solid(wood));
  }
  for (const z of [0.9, 1.7]) {
    if (along) K.box(Math.min(x0, x1), y0 + 0.1, Math.max(x0, x1) + 0.5, y0 + 0.4, z, z + 0.3, K.solid(shade(wood, 1.1)), false);
    else K.box(x0 + 0.1, Math.min(y0, y1), x0 + 0.4, Math.max(y0, y1) + 0.5, z, z + 0.3, K.solid(shade(wood, 1.1)), false);
  }
}
