// Airships drifting between the sky islands (side view), drawn each frame into
// the particle buffer behind the main islands but in front of distant ones.
const SHIP = [
  '.......oooooooooooo.......',
  '....oobbbbbbbbbbbbbboo....',
  'f.obbbbssbbbbbbssbbbbbbo..',
  'ffobbbbssbbbbbbssbbbbbbbo.',
  'fffbbbbssbbbbbbssbbbbbbbbo',
  'ffobbbbssbbbbbbssbbbbbbbo.',
  'f.obbbbssbbbbbbssbbbbbbo..',
  '....oobbbbbbbbbbbbbboo....',
  '.......oooooooooooo.......',
  '.........r......r.........',
  '.........gggggggggp.......',
  '.........gwgwgwgwg........',
  '..........ggggggg.........',
];

export class SkyLife {
  constructor(scene) {
    this.s = scene;
    this.ships = scene.airships.map((a) => ({ ...a }));
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    const W = this.s.W;
    for (const a of this.ships) {
      a.x += a.vx * dt;
      if (a.x > W + 40) a.x = -40; else if (a.x < -40) a.x = W + 40;
    }
  }

  draw(buf, amb) {
    const { W, H } = this.s;
    const night = amb.night > 0.45;
    const offs = amb.offs;
    for (const a of this.ships) {
      const flip = a.vx < 0;
      const ox = Math.round(a.x + (offs ? offs[1] * 0.7 : 0)), oy = Math.round(a.y + Math.sin(this.t * 0.6 + a.bob) * 1.5);
      const env = a.col, outline = env.map((v) => v * 0.6), stripe = env.map((v) => Math.min(255, v * 0.75 + 30));
      for (let r = 0; r < SHIP.length; r++) {
        const line = SHIP[r];
        for (let c = 0; c < line.length; c++) {
          const ch = line[flip ? line.length - 1 - c : c];
          if (ch === '.') continue;
          const x = ox + c - 13, y = oy + r - 6;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          if (this.s.solidAt(2, x, y, offs) || this.s.solidAt(3, x, y, offs)) continue;
          let col, al = 242;
          switch (ch) {
            case 'o': col = outline; break;
            case 'b': col = r < 4 ? env.map((v) => Math.min(255, v * 1.08)) : env.map((v) => v * 0.88); break;
            case 's': col = stripe; break;
            case 'f': col = outline; break;
            case 'r': col = [70, 60, 50]; break;
            case 'g': col = [110, 78, 50]; break;
            case 'p': col = [60, 60, 60]; break;
            case 'w': if (night) { col = [255, 214, 140]; al = 255; } else col = [60, 74, 90]; break;
            default: continue;
          }
          const j = (y * W + x) * 4;
          buf[j] = col[0]; buf[j + 1] = col[1]; buf[j + 2] = col[2]; buf[j + 3] = al;
        }
      }
      // navigation light blinking at the tail
      if (night && Math.sin(this.t * 3 + a.bob) > 0.6) {
        const x = ox + (flip ? 13 : -13), y = oy - 2;
        if (x >= 0 && y >= 0 && x < W && y < H) { const j = (y * W + x) * 4; buf[j] = 255; buf[j + 1] = 60; buf[j + 2] = 50; buf[j + 3] = 255; }
      }
    }
  }
}
