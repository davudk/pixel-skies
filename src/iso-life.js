// Moving things in the isometric city: traffic and rooftop steam.
//
// They are drawn every frame on the CPU into the particle buffer, depth-tested
// against the static city's z-buffer so they pass behind buildings correctly.
// Alpha codes the shader understands (see addParticles in shaders.js):
//   255      emissive (headlights, tail lights)
//   245-254  additive glow (headlight beams on the road)
//   240-244  opaque lit surface (car bodies)
//   < 240    translucent lit particle (steam)
import { RNG } from './rng.js';

const CAR_COLS = [
  [184, 50, 42], [43, 79, 138], [216, 212, 200], [42, 44, 48], [63, 110, 74],
  [201, 162, 58], [122, 125, 132], [140, 40, 60], [230, 230, 226],
];
const TAXI = [232, 184, 40];
const GLASS = [40, 52, 66];
const A_EMIT = 255, A_GLOW = 248, A_SOLID = 242;

export class IsoLife {
  constructor(scene, seed) {
    this.s = scene;
    const r = new RNG((seed ^ 0x51ed270b) >>> 0);
    this.cars = [];
    for (const lane of scene.lanes) {
      for (let s = lane.s0 + r.float(0, 70); s < lane.s1; s += r.float(28, 80)) {
        const taxi = r.chance(0.1);
        this.cars.push({ lane, s, v: r.float(8, 15), col: taxi ? TAXI : r.pick(CAR_COLS) });
      }
    }
    this.puffs = [];
    this.acc = 0;
    this.flies = [];
    this.t = 0;
    this.boats = (scene.boats || []).map((b) => ({ ...b }));
    this.koi = (scene.koi || []).map((k) => ({ ...k }));
    this.dep = new Float32Array(scene.VW * scene.VH);
  }

  update(dt, amb) {
    const { wind, cold } = amb;
    this.t += dt;
    for (const c of this.cars) {
      const { s0, s1, dir } = c.lane;
      c.s += c.v * dir * dt;
      if (c.s > s1) c.s -= s1 - s0;
      else if (c.s < s0) c.s += s1 - s0;
    }

    // Steam from roof vents (more in winter) and wood smoke from chimneys,
    // drifting with the wind as it rises and fades.
    const vents = this.s.vents;
    if (vents.length) {
      const smoky = vents[0].smoke;
      this.acc += dt * vents.length * (smoky ? 0.9 * (0.5 + cold * 0.5) : 0.6 * cold);
      while (this.acc >= 1) {
        this.acc -= 1;
        if (this.puffs.length >= 600) { this.acc = 0; break; }
        const v = vents[Math.floor(Math.random() * vents.length)];
        this.puffs.push({ X: v.X, Y: v.Y, Z: v.Z, age: 0, life: (v.smoke ? 3 : 1.5) + Math.random() * 2.5, j: Math.random() * 6.28, smoke: !!v.smoke });
      }
    }

    for (const b of this.boats) {
      if (!b.vx) continue;
      b.X += b.vx * dt;
      if (b.X > b.s1) b.X = b.s0; else if (b.X < b.s0) b.X = b.s1;
    }
    for (const k of this.koi) {
      // koi wander around their pond, turning gently
      k.a += Math.sin(this.t * 0.5 + k.ph) * dt * 0.8;
      const nx = k.X + Math.cos(k.a) * k.v * dt, ny = k.Y + Math.sin(k.a) * k.v * dt;
      if (Math.hypot((nx - k.cx) / k.rx, (ny - k.cy) / k.ry) < 0.8) { k.X = nx; k.Y = ny; } else k.a += Math.PI * 0.6;
    }

    // fireflies on warm summer nights
    const zones = this.s.fireflies;
    const s = amb.season;
    const want = zones.length && amb.night > 0.55 && s.density > 0.85 && s.autumn < 0.2 ? 70 : 0;
    while (this.flies.length < want) {
      const z = zones[Math.floor(Math.random() * zones.length)];
      this.flies.push({ X: z.x0 + Math.random() * (z.x1 - z.x0), Y: z.y0 + Math.random() * (z.y1 - z.y0), Z: 1 + Math.random() * 3, ph: Math.random() * 6.28, sp: 0.6 + Math.random() });
    }
    if (this.flies.length > want) this.flies.length = want;
    for (const f of this.flies) {
      f.ph += dt * f.sp;
      f.X += Math.sin(f.ph * 0.7) * dt * 1.5; f.Y += Math.cos(f.ph * 0.53) * dt * 1.5;
      f.Z = Math.max(0.6, f.Z + Math.sin(f.ph * 1.3) * dt * 0.8);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      p.Z += dt * (2.6 - p.age * 0.4);
      const drift = (wind * 3 + Math.sin(p.age * 2 + p.j) * 0.6) * dt;
      p.X += drift; p.Y -= drift;
      if (p.age > p.life) { this.puffs[i] = this.puffs[this.puffs.length - 1]; this.puffs.pop(); }
    }
  }

  // Everything is computed in buffer pixels; buf is the visible picture, which
  // starts at buffer pixel (pan.x, pan.y).
  draw(buf, amb) {
    const lampOn = amb.lampOn;
    const { W, H, VW, VH, cx, cy, zbuf, hpBuf: groundY, pan } = this.s;
    const ox = pan.x, oy = pan.y;
    const dep = this.dep;
    dep.fill(-1e9);
    const lightsOn = lampOn > 0.4;
    const pix = (px, py) => { // buffer pixel -> index into the picture, or -1
      const vx = px - ox, vy = py - oy;
      return vx < 0 || vy < 0 || vx >= VW || vy >= VH ? -1 : vy * VW + vx;
    };

    const spos = this.s.pos;
    let mirror = false;
    const put = (px, py, depth, c, a, Z = 0) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const v = pix(px, py);
      if (v < 0) return;
      const zs = zbuf[py * W + px];
      if (zs < -1e7 || depth <= zs + 0.01 || depth <= dep[v]) return;
      dep[v] = depth;
      const j = v * 4;
      buf[j] = c[0]; buf[j + 1] = c[1]; buf[j + 2] = c[2]; buf[j + 3] = a;
      if (mirror && Z > 0.05) {
        // a dark, rippling reflection on the water below
        const my = py + Math.round(2 * Z + Math.sin(py * 0.9 + this.t * 3) * 0.6);
        if (my >= H || !(spos[(my * W + px) * 4 + 2] & 1)) return;
        const mv = pix(px, my);
        if (mv < 0 || buf[mv * 4 + 3] >= 130) return;
        const k = a === 255 ? 1 : 0.55;
        buf[mv * 4] = c[0] * k; buf[mv * 4 + 1] = c[1] * k; buf[mv * 4 + 2] = c[2] * k; buf[mv * 4 + 3] = a === 255 ? 200 : 130;
      }
    };

    // Same face tests as the static rasterizer; fn returns [colour, alpha].
    const box = (x0, y0, x1, y1, z0, z1, fn) => {
      const pxA = Math.max(0, Math.floor(x0 - y1 + cx) - 1), pxB = Math.min(W - 1, Math.ceil(x1 - y0 + cx) + 1);
      const pyA = Math.max(0, Math.floor((x0 + y0) / 2 - z1 + cy) - 1), pyB = Math.min(H - 1, Math.ceil((x1 + y1) / 2 - z0 + cy) + 1);
      for (let py = pyA; py <= pyB; py++) {
        const sy = py + 0.5 - cy;
        for (let px = pxA; px <= pxB; px++) {
          const sx = px + 0.5 - cx;
          let X = sy + z1 + sx / 2, Y = sy + z1 - sx / 2, Z;
          if (X >= x0 && X < x1 && Y >= y0 && Y < y1) { const o = fn(0, X, Y, z1); if (o) put(px, py, X + Y + z1, o[0], o[1], z1); continue; }
          Y = x1 - sx; Z = (x1 + Y) / 2 - sy;
          if (Y >= y0 && Y < y1 && Z >= z0 && Z < z1) { const o = fn(1, x1, Y, Z); if (o) put(px, py, x1 + Y + Z, o[0], o[1], Z); continue; }
          X = sx + y1; Z = (X + y1) / 2 - sy;
          if (X >= x0 && X < x1 && Z >= z0 && Z < z1) { const o = fn(2, X, y1, Z); if (o) put(px, py, X + y1 + Z, o[0], o[1], Z); }
        }
      }
    };
    const sh = (c, k) => [Math.min(255, c[0] * k) | 0, Math.min(255, c[1] * k) | 0, Math.min(255, c[2] * k) | 0];

    // headlight beam: additive warm light on visible road ahead of the car
    const beam = (X, Y, fx, fy) => {
      for (let d = 1; d <= 12; d++) {
        const half = 0.8 + d * 0.22, f = 1 - d / 13;
        for (let k = -half; k <= half; k += 0.5) {
          const wx = X + fx * d + (fx ? 0 : k), wy = Y + fy * d + (fy ? 0 : k);
          const px = Math.floor(wx - wy + cx), py = Math.floor((wx + wy) / 2 + cy);
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const v = pix(px, py);
          if (v < 0 || Math.abs(zbuf[py * W + px] - (wx + wy)) > 1 || buf[v * 4 + 3] !== 0) continue;
          const j = v * 4;
          buf[j] = 150 * f; buf[j + 1] = 128 * f; buf[j + 2] = 90 * f; buf[j + 3] = A_GLOW;
        }
      }
    };

    for (const car of this.cars) {
      const { alongX, c, dir } = car.lane;
      const L = 6, Wd = 3;
      const x0 = alongX ? car.s : c - Wd / 2, x1 = alongX ? car.s + L : c + Wd / 2;
      const y0 = alongX ? c - Wd / 2 : car.s, y1 = alongX ? c + Wd / 2 : car.s + L;
      const gy = (x1 + y1) / 2 + cy;
      if (x1 - y0 + cx < ox - 2 || x0 - y1 + cx > ox + VW + 2 || gy < groundY + 6 || (x0 + y0) / 2 - 4 + cy > oy + VH + 2) continue;

      const col = car.col;
      const endFace = alongX ? 1 : 2;         // the end of the car we can see
      const front = dir > 0;                  // moving towards the viewer: we see its front
      box(x0, y0, x1, y1, 0.4, 1.8, (face, X, Y, Z) => {
        if (face === 0) return [sh(col, 1.15), A_SOLID];
        if (face === endFace) {
          const across = alongX ? Y - y0 : X - x0;
          if ((across < 0.9 || across > Wd - 0.9) && Z >= 0.8 && Z < 1.5) {
            if (front) return lightsOn ? [[255, 244, 210], A_EMIT] : [[220, 220, 210], A_SOLID];
            return lightsOn ? [[230, 40, 30], A_EMIT] : [[150, 30, 25], A_SOLID];
          }
          return [sh(col, 0.9), A_SOLID];
        }
        return [face === 2 ? sh(col, 0.82) : col, A_SOLID];
      });
      const cab = alongX ? [x0 + 1.6, y0 + 0.35, x0 + 4.4, y1 - 0.35] : [x0 + 0.35, y0 + 1.6, x1 - 0.35, y0 + 4.4];
      box(cab[0], cab[1], cab[2], cab[3], 1.8, 2.8, (face) => (face === 0 ? [sh(col, 1.05), A_SOLID] : [GLASS, A_SOLID]));

      if (lightsOn) {
        if (alongX) beam(dir > 0 ? x1 : x0, c, dir, 0);
        else beam(c, dir > 0 ? y1 : y0, 0, dir);
      }
    }

    // boats: bobbing hulls, cabins, masts and sails, reflected in the water
    mirror = true;
    for (const b of this.boats) {
      const z = 0.22 * Math.sin(this.t * 1.3 + b.ph);
      const L = b.len, Wd = b.wid;
      const x0 = b.X, y0 = b.Y, x1 = b.alongX ? b.X + L : b.X + Wd, y1 = b.alongX ? b.Y + Wd : b.Y + L;
      if (x1 - y0 + cx < ox - 4 || x0 - y1 + cx > ox + VW + 4) continue;
      const at = (u, v) => (b.alongX ? [x0 + u * L, y0 + v * Wd] : [x0 + v * Wd, y0 + u * L]);   // u along, v across (0..1)
      const seg = (u0, u1, v0, v1, za, zb, fn) => { const [ax, ay] = at(u0, v0), [bx, by] = at(u1, v1); box(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), za, zb, fn); };
      const hull = (face, X, Y, Z) => {
        if (face === 0) return [b.kind === 'row' ? [90, 64, 40] : [150, 112, 72], A_SOLID];
        return [Z > 0.65 + z ? [228, 226, 218] : sh(b.col, face === 2 ? 0.85 : 1), A_SOLID];
      };
      seg(0.12, 1, 0, 1, -0.6 + z, 1 + z, hull);
      seg(0, 0.12, 0.25, 0.75, -0.6 + z, 1 + z, hull);                    // pointed bow
      if (b.kind === 'fish') {
        seg(0.6, 0.88, 0.12, 0.88, 1 + z, 2.7 + z, (face, X, Y, Z) => {
          if (face === 0) return [[200, 200, 196], A_SOLID];
          if (Z > 1.7 + z && Z < 2.3 + z) return lightsOn ? [[255, 220, 150], A_EMIT] : [GLASS, A_SOLID];
          return [[236, 234, 228], A_SOLID];
        });
        seg(0.3, 0.34, 0.45, 0.55, 1 + z, 7 + z, () => [[60, 60, 64], A_SOLID]);
        seg(0.3, 0.34, 0.45, 0.55, 7 + z, 7.5 + z, () => (lightsOn ? [[255, 255, 230], A_EMIT] : [[220, 220, 220], A_SOLID]));
      } else if (b.kind === 'sail') {
        seg(0.38, 0.42, 0.45, 0.55, 1 + z, 10 + z, () => [[70, 66, 60], A_SOLID]);
        // triangular sail in the boat's long plane
        seg(0.42, 0.95, 0.47, 0.53, 1.6 + z, 9.6 + z, (face, X, Y, Z) => {
          const u = b.alongX ? (X - x0) / L : (Y - y0) / L;
          const frac = (u - 0.42) / 0.53;
          if (Z - 1.6 - z > 8 * (1 - frac)) return null;
          return [face === 2 ? [226, 222, 210] : [242, 238, 228], A_SOLID];
        });
        seg(0.38, 0.42, 0.45, 0.55, 10 + z, 10.5 + z, () => (lightsOn ? [[255, 90, 70], A_EMIT] : null));
      }
    }
    mirror = false;

    // koi just under the pond's surface: orange and white flecks
    for (const k of this.koi) {
      const px = Math.floor(k.X - k.Y + cx), py = Math.floor((k.X + k.Y) / 2 + cy);
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const tx = Math.round(-Math.cos(k.a - 0.785) * 1.4), ty = Math.round(-Math.sin(k.a + 0.785) * 0.7);
      const paint = (x, y, c) => {
        if (x < 0 || y < 0 || x >= W || y >= H || !(spos[(y * W + x) * 4 + 2] & 1)) return;
        const vv = pix(x, y);
        if (vv < 0) return;
        const j = vv * 4; buf[j] = c[0]; buf[j + 1] = c[1]; buf[j + 2] = c[2]; buf[j + 3] = 170;
      };
      paint(px, py, k.c); paint(px + tx, py + ty, k.c2);
    }

    for (const f of this.flies) {
      if (Math.sin(f.ph * 3) < 0.55) continue;
      const px = Math.floor(f.X - f.Y + cx), py = Math.floor((f.X + f.Y) / 2 - f.Z + cy);
      put(px, py, f.X + f.Y + f.Z, [210, 255, 120], 255);
    }

    for (const p of this.puffs) {
      const t = p.age / p.life;
      const a = Math.round((1 - t) * (1 - t) * (p.smoke ? 170 : 150));
      if (a < 8) continue;
      const px = Math.floor(p.X - p.Y + cx), py = Math.floor((p.X + p.Y) / 2 - p.Z + cy);
      const d = p.X + p.Y + p.Z;
      const c = p.smoke ? [176, 172, 168] : [228, 230, 236];
      const soft = (x, y, aa) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const v = pix(x, y);
        if (v < 0) return;
        const zs = zbuf[y * W + x];
        if (zs >= -1e7 && d <= zs) return;
        const j = v * 4;
        if (buf[j + 3] >= aa) return;
        buf[j] = c[0]; buf[j + 1] = c[1]; buf[j + 2] = c[2]; buf[j + 3] = aa;
      };
      soft(px, py, a);
      if (t > 0.25) { soft(px + 1, py, a * 0.7 | 0); soft(px, py - 1, a * 0.7 | 0); }
      if (t > 0.55) { soft(px - 1, py, a * 0.5 | 0); soft(px + 1, py - 1, a * 0.5 | 0); }
      if (p.smoke && t > 0.4) { soft(px, py - 2, a * 0.45 | 0); soft(px - 1, py - 1, a * 0.5 | 0); soft(px + 2, py - 1, a * 0.35 | 0); }
    }
  }
}
