// Entry point: sizing, the clock, weather blending and the render loop.
import { createRenderer } from './renderer.js';
import { generateScene } from './themes.js';
import { IsoLife } from './iso-life.js';
import { SkyLife } from './skylife.js';
import { computeEnv, seasonParams } from './sky.js';
import { Particles } from './particles.js';
import { initUI } from './ui.js';
import { loadState, encodeState, WEATHER, PIXEL_TARGETS, dayOfYear } from './state.js';

const canvas = document.getElementById('view');
const state = loadState();
if (new URLSearchParams(location.hash.slice(1)).get('ui') === '0') document.body.classList.add('ui-hidden');

let R;
try { R = createRenderer(canvas); } catch (err) { console.error(err); }
if (!R) {
  document.getElementById('error').hidden = false;
  throw new Error('WebGL2 unavailable');
}

// Track the canvas size in real device pixels so the upscale maps 1:1 onto
// the screen (no browser resampling, so no blur).
let devW = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
let devH = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
const ro = new ResizeObserver(([entry]) => {
  if (entry.devicePixelContentBoxSize) {
    devW = entry.devicePixelContentBoxSize[0].inlineSize;
    devH = entry.devicePixelContentBoxSize[0].blockSize;
  } else {
    devW = Math.round(entry.contentBoxSize[0].inlineSize * devicePixelRatio);
    devH = Math.round(entry.contentBoxSize[0].blockSize * devicePixelRatio);
  }
});
try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }

const wx = { ...WEATHER[state.weather], wind: state.wind }; // current (blended) weather
const particles = new Particles();
let scene = null, sceneKey = '', life = null;
// crossfade: the outgoing picture is copied here and faded away
const fadeCanvas = document.getElementById('fade');
const fadeCtx = fadeCanvas.getContext('2d');
let lastDraw = null, identity = '';
// rainbow: shows when the sun comes out within a couple of minutes of rain
let sinceRain = 1e9, rainbow = 0;
// Mouse parallax: -1..1 on each axis, eased. Recentres when the pointer leaves
// the window, and stays off for people who prefer reduced motion.
const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  parallax.tx = (e.clientX / window.innerWidth - 0.5) * 2;
  parallax.ty = (e.clientY / window.innerHeight - 0.5) * 2;
});
document.documentElement.addEventListener('pointerleave', () => { parallax.tx = 0; parallax.ty = 0; });

const ui = initUI(state, { reroll: () => { state.seed = Math.floor(Math.random() * 1e6); } });

// Both taken from requestAnimationFrame's own clock on the first frame.
let last = null, t0 = null;
let cloudX = 0, lastHash = '', lastHashTime = 0;

function frame(now) {
  if (last === null) { last = now; t0 = now; }
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;

  if (canvas.width !== devW || canvas.height !== devH) { canvas.width = devW; canvas.height = devH; }
  const scale = Math.max(1, Math.round(devH / PIXEL_TARGETS[state.pixel]));
  // One spare low-res column and row, so the picture can shift by a fraction
  // of a pixel (smooth camera pan) without exposing an edge.
  const W = Math.ceil(devW / scale) + 1, H = Math.ceil(devH / scale) + 1;
  // Centre horizontally; anchor to the bottom so any cropped row is sky.
  const dims = { W, H, scale, cw: devW, ch: devH, offX: 0, offY: 0 };

  // clock
  if (state.speed === 'clock') {
    const d = new Date();
    state.minutes = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  } else if (state.speed === 'live') {
    const d = new Date();
    state.minutes = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    state.doy = dayOfYear(d);
  } else if (state.speed > 0) {
    state.minutes += (dt * state.speed) / 60;
    if (state.minutes >= 1440) { state.minutes -= 1440; state.doy = (state.doy % 365) + 1; }
  }

  // scene (rebuilt only when size, seed or season visibly changes)
  const season = seasonParams(state.doy);
  // the fir in the village square is only decorated around Christmas
  const festive = state.theme === 'village' && (state.doy >= 335 || state.doy <= 6);
  const key = `${state.theme}|${W}x${H}|${state.seed}|${season.key}|${festive}`;
  if (key !== sceneKey) {
    const ident = `${state.theme}|${state.seed}`;
    if (lastDraw && ident !== identity && !reduceMotion?.matches) {
      // draw the old scene once more and keep it as a snapshot that fades away
      R.render(lastDraw.scene, lastDraw.env, lastDraw.f);
      fadeCanvas.width = devW; fadeCanvas.height = devH;
      fadeCtx.drawImage(canvas, 0, 0);
      fadeCanvas.style.transition = 'none';
      fadeCanvas.style.opacity = '1';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fadeCanvas.style.transition = 'opacity 0.9s ease';
        fadeCanvas.style.opacity = '0';
      }));
    }
    identity = ident;
    scene = generateScene(state.theme, W, H, state.seed, season, state.doy);
    R.uploadScene(scene);
    life = scene.kind === 'iso' ? new IsoLife(scene, state.seed) : scene.airships ? new SkyLife(scene) : null;
    sceneKey = key;
    particles.reset();
  }

  // weather blends smoothly towards the chosen preset
  const target = { ...WEATHER[state.weather], wind: state.wind };
  const k = 1 - Math.exp(-dt * 0.8);
  for (const p in target) wx[p] += (target[p] - wx[p]) * k;

  // snow settles while it snows; rain wets streets and melts snow; then it dries
  if (wx.snow > 0.05) state.snow = Math.min(1, state.snow + dt * wx.snow * 0.025);
  if (wx.rain > 0.05) {
    state.wet = Math.min(1, state.wet + dt * wx.rain * 0.12);
    state.snow = Math.max(0, state.snow - dt * wx.rain * 0.01);
  } else if (wx.snow < 0.05) {
    state.wet = Math.max(0, state.wet - dt * 0.0012);   // streets take ~10 minutes to dry
  }

  const on = state.parallax && !reduceMotion?.matches;
  const ease = 1 - Math.exp(-dt * 2.5);
  parallax.x += ((on ? parallax.tx : 0) - parallax.x) * ease;
  parallax.y += ((on ? parallax.ty : 0) - parallax.y) * ease;
  let offs = [0, 0, 0, 0];
  if (scene.kind === 'side') {
    offs = [0.15, 0.35, 0.62, 1].map((f) => Math.round(-parallax.x * f * (scene.margin - 2)));
  } else {
    // Camera pan: whole pixels move the view inside the city buffer; the
    // leftover fraction shifts the final image by whole *screen* pixels, so the
    // motion glides instead of stepping in chunky art pixels.
    const fx = parallax.x * scene.PX, fy = parallax.y * scene.PY;
    const ix = Math.floor(fx), iy = Math.ceil(fy);
    scene.pan = { x: scene.PX + ix, y: scene.PY + iy };
    dims.offX = -Math.round((fx - ix) * scale);
    dims.offY = -Math.round((iy - fy) * scale);
  }
  cloudX += dt * (1.5 + wx.wind * 10) * (H / 216);

  const env = computeEnv(state, wx, scene, W, H);
  if (wx.rain > 0.15) sinceRain = 0; else sinceRain += dt;
  const bow = sinceRain > 2 && sinceRain < 150 && env.sunEl > 2 && env.sunEl < 40 ? 1 - wx.cloud : 0;
  rainbow += (bow - rainbow) * (1 - Math.exp(-dt * 0.4));
  env.uRainbow = rainbow;
  // what the moving bits need to know about the moment
  const amb = { night: env.uNight, lampOn: env.uLampOn, stars: env.uStars, season, wind: wx.wind, cold: season.density < 0.3 ? 1 : 0.35, offs };
  particles.update(dt, wx, scene, W, H, offs, amb);
  if (life) life.update(dt, amb);
  const part = particles.render(scene, W, H, offs, life ? (b) => life.draw(b, amb) : null);
  env.uWind = wx.wind;

  env.uTime = (now - t0) / 1000;
  env.uCloudX = cloudX;
  env.uFlash = particles.flash;

  const f = { ...dims, offs, part, levels: state.levels, dither: state.dither ? 1 : 0 };
  R.render(scene, env, f);
  lastDraw = { scene, env, f };
  ui.sync(dims, now);

  if (now - lastHashTime > 1000) {
    lastHashTime = now;
    const h = encodeState(state);
    if (h !== lastHash) { lastHash = h; history.replaceState(null, '', '#' + h); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
