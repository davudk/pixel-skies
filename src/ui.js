// Wires the settings panel to the shared state object. The render loop reads
// state every frame, so the UI only has to write to it.
import { WEATHER, PIXEL_TARGETS, applyThemeDefaults } from './state.js';
import { THEMES } from './themes.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtTime(min) {
  const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtDate(doy) {
  const d = new Date(2025, 0, doy); // non-leap year for display
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function initUI(state, { reroll }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('panel');
  // on phones the panel would cover most of the scene: start it folded away
  if (window.innerWidth < 640) panel.classList.add('collapsed');
  const busy = new Set();
  let lastSpeed = 60;

  const slider = (id, toState, fromState) => {
    const el = $(id);
    el.addEventListener('pointerdown', () => busy.add(el));
    el.addEventListener('input', () => toState(Number(el.value)));
    return { el, fromState };
  };
  window.addEventListener('pointerup', () => busy.clear());

  const pauseIfLive = () => { if (state.speed === 'live' || state.speed === 'clock') state.speed = 0; };

  const sliders = [
    slider('time', (v) => { pauseIfLive(); state.minutes = v; }, () => Math.floor(state.minutes)),
    // choosing a date keeps the clock running in real time, on that date
    slider('date', (v) => { if (state.speed === 'live') state.speed = 'clock'; state.doy = v; }, () => state.doy),
    slider('snow', (v) => { state.snow = v / 100; }, () => Math.round(state.snow * 100)),
    slider('wet', (v) => { state.wet = v / 100; }, () => Math.round(state.wet * 100)),
    slider('wind', (v) => { state.wind = v / 100; }, () => Math.round(state.wind * 100)),
    slider('pixel', (v) => { state.pixel = v; }, () => state.pixel),
    slider('levels', (v) => { state.levels = v; }, () => state.levels),
  ];

  $('speeds').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = b.dataset.speed;
    state.speed = v === 'live' ? 'live' : Number(v);
    if (state.speed !== 'live' && state.speed > 0) lastSpeed = state.speed;
  });

  for (const t of THEMES) {
    const b = document.createElement('button');
    b.dataset.th = t.id; b.textContent = t.name;
    $('themes').appendChild(b);
  }
  $('themes').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.th === state.theme) return;
    state.theme = b.dataset.th;
    applyThemeDefaults(state);
  });
  $('reset').addEventListener('click', () => applyThemeDefaults(state));

  $('weathers').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.weather = b.dataset.w;
    state.wind = WEATHER[state.weather].wind;
  });

  $('dither').addEventListener('change', (e) => { state.dither = e.target.checked; });
  $('parallax').addEventListener('change', (e) => { state.parallax = e.target.checked; });
  $('seed').addEventListener('click', reroll);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };
  const toggleHidden = () => document.body.classList.toggle('ui-hidden');
  $('fullscreen').addEventListener('click', toggleFullscreen);
  $('hideUI').addEventListener('click', toggleHidden);
  $('panelToggle').addEventListener('click', () => panel.classList.toggle('collapsed'));

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'h') toggleHidden();
    else if (k === 'f') toggleFullscreen();
    else if (k === 'r') reroll();
    else if (k === ' ') {
      e.preventDefault();
      if (state.speed === 'live' || state.speed > 0) state.speed = 0;
      else state.speed = lastSpeed;
    } else return;
  });

  let lastSync = 0;
  function sync(dims, now) {
    if (now - lastSync < 120) return;
    lastSync = now;
    for (const s of sliders) {
      if (busy.has(s.el)) continue;
      const v = String(s.fromState());
      if (s.el.value !== v) s.el.value = v;
    }
    $('timeOut').textContent = fmtTime(state.minutes);
    $('dateOut').textContent = fmtDate(state.doy);
    $('snowOut').textContent = `${Math.round(state.snow * 100)}%`;
    $('wetOut').textContent = `${Math.round(state.wet * 100)}%`;
    $('windOut').textContent = state.wind === 0 ? 'calm' : `${Math.round(Math.abs(state.wind) * 100)}% ${state.wind < 0 ? '←' : '→'}`;
    $('pixelOut').textContent = `×${dims.scale}`;
    $('levelsOut').textContent = String(state.levels);
    $('dither').checked = state.dither;
    $('parallax').checked = state.parallax;
    $('info').textContent = `${dims.W}×${dims.H} px`;
    const press = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
    for (const b of $('speeds').children) press(b, String(state.speed === 'clock' ? 'live' : state.speed) === b.dataset.speed);
    $('speeds').firstElementChild.title = state.speed === 'clock' ? 'Real time of day, on the chosen date (click for today)' : 'Follow your clock';
    for (const b of $('weathers').children) press(b, state.weather === b.dataset.w);
    for (const b of $('themes').children) press(b, state.theme === b.dataset.th);
    const theme = THEMES.find((t) => t.id === state.theme) || THEMES[0];
    $('seed').title = `Seed ${state.seed}: click for a new random layout (R)`;
    document.querySelector('#panel h1').textContent = theme.name;
    document.title = `Pixel Skies — ${theme.name}`;
  }

  return { sync, PIXEL_TARGETS };
}
