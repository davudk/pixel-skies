// Rain, snow, splashes and lightning, simulated on the CPU at the low
// resolution so every particle lands on whole pixels.
export class Particles {
  constructor() {
    this.drops = [];
    this.flakes = [];
    this.splashes = [];
    this.bolt = null;
    this.boltAge = 99;
    this.boltPower = 1;
    this.nextBolt = 2 + Math.random() * 4;
    this.flash = 0;
    this.t = 0;
    this.vx = 0;
    this.buf = null;
    this.birds = [];
    this.leaves = [];
    this.meteor = null;
    this.nextMeteor = 6 + Math.random() * 12;
  }

  reset() { this.drops.length = 0; this.flakes.length = 0; this.splashes.length = 0; this.bolt = null; }

  spawn(kind, W, H, scene, sc) {
    const z = Math.random();
    const vy = kind === 'rain' ? (150 + 130 * z) * sc : (8 + 22 * z) * sc;
    const drift = this.vx * (H / vy);
    return {
      x: Math.random() * (W + 40) - 20 - drift,
      y: -Math.random() * 12,
      z, vy,
      ph: Math.random() * 6.28,
      killY: scene.killY(z),
    };
  }

  update(dt, wx, scene, W, H, offs, amb = {}) {
    this.t += dt;
    const sc = H / 216, gY = scene.groundY;
    this.vx = wx.wind * 80 * sc;

    // rain
    const rainTarget = Math.round(wx.rain * W * 1.1);
    while (this.drops.length < rainTarget) this.drops.push(this.spawn('rain', W, H, scene, sc));
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.x += this.vx * (0.5 + 0.5 * d.z) * dt;
      d.y += d.vy * dt;
      let dead = d.y >= d.killY;
      if (!dead && d.z > 0.6 && d.y > 0 && scene.hitFront(Math.round(d.x), Math.round(d.y), offs)) dead = true;
      if (!dead) continue;
      if (d.z > 0.45 && Math.random() < 0.7) this.splash(d.x, Math.min(d.y, d.killY), sc);
      if (this.drops.length > rainTarget) { this.drops[i] = this.drops[this.drops.length - 1]; this.drops.pop(); }
      else this.drops[i] = this.spawn('rain', W, H, scene, sc);
    }

    // snow
    const snowTarget = Math.round(wx.snow * W * 1.3);
    while (this.flakes.length < snowTarget) this.flakes.push(this.spawn('snow', W, H, scene, sc));
    for (let i = this.flakes.length - 1; i >= 0; i--) {
      const f = this.flakes[i];
      f.x += (this.vx * 0.5 * (0.4 + f.z) + Math.sin(this.t * 1.3 + f.ph) * 6 * sc * (0.5 + f.z)) * dt;
      f.y += f.vy * dt;
      let dead = f.y >= f.killY || f.x < -30 || f.x > W + 30;
      if (!dead && f.z > 0.6 && f.y > 0 && scene.hitFront(Math.round(f.x), Math.round(f.y), offs)) dead = true;
      if (!dead) continue;
      if (this.flakes.length > snowTarget) { this.flakes[i] = this.flakes[this.flakes.length - 1]; this.flakes.pop(); }
      else this.flakes[i] = this.spawn('snow', W, H, scene, sc);
    }

    // A shooting star every so often on clear nights.
    if (amb.stars > 0.5 && wx.rain < 0.05 && wx.snow < 0.05 && wx.cloud < 0.5) {
      this.nextMeteor -= dt;
      if (this.nextMeteor <= 0 && !this.meteor) {
        this.nextMeteor = 10 + Math.random() * 25;
        const dir = Math.random() < 0.5 ? 1 : -1, a = 0.35 + Math.random() * 0.4;
        const sp = (160 + Math.random() * 80) * sc;
        this.meteor = { x: W * (0.15 + Math.random() * 0.7), y: H * (0.04 + Math.random() * 0.2), vx: Math.cos(a) * sp * dir, vy: Math.sin(a) * sp, age: 0, life: 0.45 + Math.random() * 0.4 };
      }
    }
    if (this.meteor) {
      const m = this.meteor;
      m.age += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.age > m.life) this.meteor = null;
    }

    // Birds by day: small flocks crossing the sky, flapping.
    const birdTarget = scene.birds && amb.night < 0.4 ? scene.birds * 3 : 0;
    if (this.birds.length < birdTarget && Math.random() < dt * 0.6) {
      const dir = Math.random() < 0.5 ? 1 : -1, y = H * (0.08 + Math.random() * 0.35), n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) this.birds.push({ x: dir > 0 ? -5 - k * 4 : W + 5 + k * 4, y: y + (k % 2) * 3 + k, vx: dir * (14 + Math.random() * 6) * sc, ph: Math.random() * 6.28 });
    }
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.x += b.vx * dt; b.ph += dt * 7; b.y += Math.sin(b.ph * 0.3) * dt * 2;
      if (b.x < -30 || b.x > W + 30) { this.birds[i] = this.birds[this.birds.length - 1]; this.birds.pop(); }
    }

    // Falling blossom petals in spring and leaves in autumn.
    const s = amb.season;
    let leafCols = null;
    if (scene.leafFall && s) {
      if (s.blossom > 0.2) leafCols = [[246, 193, 212], [233, 143, 176], [250, 219, 230]];
      else if (s.autumn > 0.35 && s.density > 0.1) leafCols = [[200, 105, 42], [220, 154, 48], [168, 67, 42], [224, 176, 64]];
    }
    const leafTarget = leafCols ? Math.round(W * 0.09) : 0;
    while (this.leaves.length < leafTarget) {
      this.leaves.push({ x: Math.random() * W, y: -Math.random() * H, vy: (6 + Math.random() * 8) * sc, ph: Math.random() * 6.28, c: leafCols[Math.floor(Math.random() * leafCols.length)] });
    }
    if (this.leaves.length > leafTarget) this.leaves.length = leafTarget;
    for (const l of this.leaves) {
      l.ph += dt * 2.2;
      l.x += (this.vx * 0.6 + Math.sin(l.ph) * 9 * sc) * dt;
      l.y += l.vy * dt * (0.7 + 0.3 * Math.cos(l.ph * 1.3));
      if (l.y > H + 2 || l.x < -10 || l.x > W + 10) { l.x = Math.random() * W; l.y = -2; }
    }

    // splashes
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.vy += 400 * sc * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) { this.splashes[i] = this.splashes[this.splashes.length - 1]; this.splashes.pop(); }
    }

    // lightning
    this.boltAge += dt;
    if (wx.storm > 0.5) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 3 + Math.random() * 9;
        this.boltAge = 0;
        this.boltPower = 0.6 + Math.random() * 0.4;
        this.bolt = Math.random() < 0.7 ? this.makeBolt(W, gY) : null; // sometimes just sheet lightning
      }
    }
    const a = this.boltAge;
    const f = a < 0.06 ? 1 : a < 0.12 ? 0.15 : a < 0.2 ? 0.75 : 0.75 * Math.exp(-(a - 0.2) * 6);
    this.flash = f * this.boltPower;
  }

  splash(x, y, sc) {
    const n = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      this.splashes.push({ x, y: y - 1, vx: (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 18) * sc, vy: -(25 + Math.random() * 25) * sc, life: 0.12 + Math.random() * 0.1 });
    }
  }

  makeBolt(W, gY) {
    const pts = [];
    const walk = (x, y, endY, depth) => {
      let dir = Math.random() < 0.5 ? -1 : 1;
      while (y < endY) {
        y += 1;
        if (Math.random() < 0.3) dir = -dir;
        if (Math.random() < 0.55) x += dir;
        pts.push(x, y);
        if (depth < 1 && Math.random() < 0.04) walk(x, y, y + 6 + Math.random() * 16, depth + 1);
      }
    };
    walk(Math.round(W * (0.1 + Math.random() * 0.8)), 0, Math.round(gY * (0.5 + Math.random() * 0.4)), 0);
    return pts;
  }

  // pre(buf) draws scene objects (traffic, steam) before weather goes on top.
  render(scene, W, H, offs, pre) {
    const n = W * H * 4;
    if (!this.buf || this.buf.length !== n) this.buf = new Uint8Array(n);
    const b = this.buf;
    b.fill(0);
    if (pre) pre(b);
    const put = (x, y, r, g, bl, a) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      const ex = b[i + 3];
      if (ex >= a && ex < 240) return; // weather draws over cars and glows
      b[i] = r; b[i + 1] = g; b[i + 2] = bl; b[i + 3] = a;
    };

    for (const d of this.drops) {
      const vx = this.vx * (0.5 + 0.5 * d.z);
      const len = 2 + Math.round(d.z * 3);
      const inv = 1 / Math.hypot(vx, d.vy);
      const dx = vx * inv, dy = d.vy * inv;
      const a = (0.3 + 0.5 * d.z) * 255;
      for (let k = 0; k < len; k++) put(d.x - dx * k, d.y - dy * k, 180, 195, 220, Math.round(a * (1 - k / (len + 1))));
    }
    for (const s of this.splashes) put(s.x, s.y, 190, 205, 228, 150);
    if (this.meteor) {
      // bright head and a fading trail, only against open sky
      const m = this.meteor, sp = Math.hypot(m.vx, m.vy), fade = 1 - m.age / m.life;
      const len = Math.round(10 * (H / 216));
      for (let k = 0; k < len; k++) {
        const x = Math.round(m.x - (m.vx / sp) * k), y = Math.round(m.y - (m.vy / sp) * k);
        if (!scene.isSky(x, y, offs)) continue;
        const b = (1 - k / len) * fade;
        put(x, y, 255 * b, 250 * b, 235 * b, k === 0 ? 255 : 248);   // head emissive, trail additive
      }
    }
    const bc = scene.birdColor || [45, 45, 52];
    for (const b of this.birds) {
      const up = Math.sin(b.ph) > 0;
      put(b.x, b.y, bc[0], bc[1], bc[2], 242);
      put(b.x - 1, b.y + (up ? -1 : 0), bc[0], bc[1], bc[2], 242);
      put(b.x + 1, b.y + (up ? -1 : 0), bc[0], bc[1], bc[2], 242);
    }
    for (const l of this.leaves) {
      put(l.x, l.y, l.c[0], l.c[1], l.c[2], 242);
      if (Math.sin(l.ph * 2) > 0.3) put(l.x + 1, l.y, l.c[0] * 0.8, l.c[1] * 0.8, l.c[2] * 0.8, 242);
    }
    for (const f of this.flakes) {
      const a = Math.round((0.5 + 0.5 * f.z) * 235);
      put(f.x, f.y, 240, 244, 255, a);
      if (f.z > 0.88) { put(f.x + 1, f.y, 240, 244, 255, a); put(f.x, f.y + 1, 240, 244, 255, a); put(f.x + 1, f.y + 1, 225, 230, 245, a); }
    }

    // bolt: only drawn where there's open sky, with a brief flicker gap
    const a = this.boltAge;
    if (this.bolt && a < 0.22 && !(a > 0.07 && a < 0.11)) {
      const p = this.bolt;
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i], y = p[i + 1];
        if (scene.isSky(x, y, offs)) put(x, y, 235, 240, 255, 255);
      }
    }
    return b;
  }
}
