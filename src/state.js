// App settings, weather presets, and URL-hash persistence (so any view can be shared).

export const WEATHER = {
  clear:    { cloud: 0.05, rain: 0,    snow: 0,   fog: 0,    storm: 0, wind: 0.15 },
  cloudy:   { cloud: 0.5,  rain: 0,    snow: 0,   fog: 0,    storm: 0, wind: 0.3 },
  overcast: { cloud: 0.92, rain: 0,    snow: 0,   fog: 0.1,  storm: 0, wind: 0.25 },
  fog:      { cloud: 0.6,  rain: 0,    snow: 0,   fog: 0.85, storm: 0, wind: 0.05 },
  rain:     { cloud: 0.95, rain: 0.55, snow: 0,   fog: 0.15, storm: 0, wind: 0.3 },
  storm:    { cloud: 1,    rain: 1,    snow: 0,   fog: 0.2,  storm: 1, wind: 0.75 },
  snow:     { cloud: 0.85, rain: 0,    snow: 0.6, fog: 0.06, storm: 0, wind: 0.15 },
};

// What each theme looks like when you pick it. A theme with a date runs on
// "clock" time: the real time of day, but on that date (so its season sticks).
export const THEME_DEFAULTS = {
  city:    { weather: 'cloudy', wet: 0.7 },
  skyline: { weather: 'rain', wet: 0.9 },
  village: { weather: 'snow', snow: 0.85, doy: 354 },
  harbour: { weather: 'clear', wind: 0.45, doy: 196 },
  garden:  { weather: 'clear', wind: 0.1, doy: 105 },
  isles:   { weather: 'cloudy', wind: 0.3, doy: 170 },
};

export function applyThemeDefaults(s) {
  const d = THEME_DEFAULTS[s.theme] || THEME_DEFAULTS.city;
  s.weather = d.weather;
  s.wind = d.wind ?? WEATHER[d.weather].wind;
  s.snow = d.snow ?? 0;
  s.wet = d.wet ?? 0;
  if (d.doy) { s.doy = d.doy; s.speed = 'clock'; }
  else { s.doy = dayOfYear(new Date()); s.speed = 'live'; }
}

// Target low-res height for each "pixel size" step. The real height is
// screen height / integer scale, so the picture always fills the screen.
export const PIXEL_TARGETS = [135, 170, 216, 270, 340];

export function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.min(365, Math.max(1, Math.round((d - start) / 864e5) + 1));
}

export function defaultState() {
  const now = new Date();
  return {
    seed: Math.floor(Math.random() * 1e6),
    theme: 'city',          // see themes.js
    minutes: now.getHours() * 60 + now.getMinutes(),
    doy: dayOfYear(now),
    speed: 'live',          // 'live' (real time and date), 'clock' (real time, chosen date) or simulated seconds per real second
    weather: 'clear',
    snow: 0,                // 0..1 snow lying on surfaces
    wet: 0,                 // 0..1 street wetness
    wind: WEATHER.clear.wind,
    pixel: 2,
    levels: 16,
    dither: true,
    parallax: true,
  };
}

export function loadState() {
  const s = defaultState();
  const p = new URLSearchParams(location.hash.slice(1));
  const num = (k, lo, hi) => {
    if (!p.has(k)) return undefined;
    const v = Number(p.get(k));
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
  };
  const set = (key, v) => { if (v !== undefined) s[key] = v; };
  set('seed', num('seed', 0, 1e9));
  if (['city', 'skyline', 'village', 'harbour', 'garden', 'isles'].includes(p.get('th'))) s.theme = p.get('th');
  if (s.theme === 'city' && p.get('v') === 'side') s.theme = 'skyline';   // links from before the split
  if (!p.has('w')) applyThemeDefaults(s);   // a fresh visit gets the theme's own look
  if (p.has('t')) { set('minutes', num('t', 0, 1439.99)); s.speed = 0; }
  set('doy', num('d', 1, 365));
  if (p.has('speed')) s.speed = ['live', 'clock'].includes(p.get('speed')) ? p.get('speed') : (num('speed', 0, 86400) ?? 0);
  if (WEATHER[p.get('w')]) { s.weather = p.get('w'); s.wind = WEATHER[s.weather].wind; }
  set('snow', num('snow', 0, 1));
  set('wet', num('wet', 0, 1));
  set('wind', num('wind', -1, 1));
  set('pixel', num('px', 0, PIXEL_TARGETS.length - 1));
  set('levels', num('lv', 4, 32));
  if (p.has('di')) s.dither = p.get('di') !== '0';
  if (p.has('pa')) s.parallax = p.get('pa') !== '0';
  return s;
}

export function encodeState(s) {
  const p = new URLSearchParams();
  p.set('th', s.theme);
  p.set('seed', s.seed);
  if (s.speed === 'live') p.set('speed', 'live');
  else if (s.speed === 'clock') { p.set('speed', 'clock'); p.set('d', s.doy); }
  else {
    p.set('t', Math.round(s.minutes));
    p.set('d', s.doy);
    p.set('speed', s.speed);
  }
  p.set('w', s.weather);
  if (s.snow > 0.005) p.set('snow', s.snow.toFixed(2));
  if (s.wet > 0.005) p.set('wet', s.wet.toFixed(2));
  p.set('wind', s.wind.toFixed(2));
  p.set('px', s.pixel);
  p.set('lv', s.levels);
  p.set('di', s.dither ? 1 : 0);
  p.set('pa', s.parallax ? 1 : 0);
  return p.toString();
}
