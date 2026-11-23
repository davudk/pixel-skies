// Sun, moon and atmosphere. Turns (time, date, weather) into the lighting
// uniforms the shader uses. Everything is driven by the sun's real position,
// so day length, winter's low sun and sunrise times follow the date.

const LAT = 42;            // degrees north
const D2R = Math.PI / 180;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add3 = (...vs) => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const lin3 = (c) => c.map((v) => Math.pow(Math.max(0, v) / 255, 2.2));
const gray3 = (c) => { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return [l, l, l]; };
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

// [sun elevation°, zenith, horizon]
const SKY = [
  [-90, 0x03050b, 0x070a16],
  [-18, 0x04060d, 0x0a0f22],
  [-12, 0x070b1e, 0x161c3c],
  [-8, 0x0f173a, 0x2c2f5e],
  [-4, 0x1e2c5e, 0x6a5a88],
  [-1, 0x2e4478, 0xd98a6c],
  [2, 0x3f62a0, 0xf0ae78],
  [6, 0x4b7cc0, 0xf2cf9e],
  [12, 0x4a85d0, 0xbcd7ec],
  [30, 0x3c7ddd, 0xa8cdf0],
  [90, 0x3577dc, 0xa0c8ee],
].map(([e, z, h]) => [e, rgb(z), rgb(h)]);

// [sun elevation°, sunlight colour]
const SUN = [
  [-2, 0xff5a20], [1, 0xff6a2a], [4, 0xffa060], [10, 0xffd2a0], [25, 0xfff0e0], [90, 0xfff8f0],
].map(([e, c]) => [e, rgb(c)]);

function keyed(keys, e, idx) {
  if (e <= keys[0][0]) return keys[0][idx];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (e <= b[0]) return lerp3(a[idx], b[idx], (e - a[0]) / (b[0] - a[0]));
  }
  return keys[keys.length - 1][idx];
}

// Elevation and azimuth (from south, west positive) in degrees.
function altAz(declDeg, haDeg) {
  const p = LAT * D2R, d = declDeg * D2R, h = haDeg * D2R;
  const el = Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h));
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(p) - Math.tan(d) * Math.cos(p));
  return { el: el / D2R, az: az / D2R };
}

export function moonPhase(doy, minutes) {
  const year = new Date().getFullYear();
  const t = Date.UTC(year, 0, 1) + (doy - 1) * 864e5 + minutes * 6e4;
  const days = (t - Date.UTC(2000, 0, 6, 18, 14)) / 864e5;
  return (((days / 29.530588853) % 1) + 1) % 1; // 0 new, 0.5 full
}

function interp(keys, d) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [d0, v0] = keys[i], [d1, v1] = keys[i + 1];
    if (d >= d0 && d <= d1) return v0 + (v1 - v0) * (d - d0) / (d1 - d0);
  }
  return keys[keys.length - 1][1];
}

// Foliage and colour by day of year (northern hemisphere). Quantised so the
// scene only regenerates when something visible changes.
export function seasonParams(doy) {
  const q = (v, n) => Math.round(v * n) / n;
  const s = {
    density: q(interp([[0, 0], [75, 0], [95, 0.2], [115, 0.65], [140, 1], [265, 1], [300, 0.8], [318, 0.4], [335, 0.08], [350, 0], [366, 0]], doy), 10),
    autumn: q(interp([[0, 1], [60, 1], [61, 0], [245, 0], [270, 0.35], [290, 0.8], [305, 1], [366, 1]], doy), 10),
    blossom: q(interp([[0, 0], [92, 0], [108, 0.55], [125, 0.1], [135, 0], [366, 0]], doy), 10),
    fresh: q(interp([[0, 0], [85, 0], [95, 1], [150, 1], [170, 0], [366, 0]], doy), 2),
  };
  s.key = `${s.density}|${s.autumn}|${s.blossom}|${s.fresh}`;
  return s;
}

export function computeEnv(st, wx, scene, W, H) {
  const hour = st.minutes / 60;
  const decl = -23.44 * Math.cos(2 * Math.PI * (st.doy + 10) / 365);
  const ha = (hour - 12) * 15;
  const sun = altAz(decl, ha);
  const phase = moonPhase(st.doy, st.minutes);
  const mha = ((ha - phase * 360 + 540) % 360) - 180;
  const moon = altAz(decl * Math.cos(phase * 2 * Math.PI), mha);
  const { cloud, rain, fog } = wx;
  const e = sun.el;

  // sky colours, greyed and darkened by weather
  let zen = keyed(SKY, e, 1), hor = keyed(SKY, e, 2);
  const dim = 1 - 0.35 * rain - 0.08 * cloud;
  zen = scale3(lerp3(zen, scale3(gray3(zen), 0.9), cloud * 0.85), dim);
  hor = scale3(lerp3(hor, scale3(gray3(hor), 0.95), cloud * 0.8), dim);
  hor = lerp3(hor, scale3(gray3(hor), 1.05), fog * 0.6);
  const zenL = lin3(zen), horL = lin3(hor);

  const day = smoothstep(-4, 8, e);
  const sunK = smoothstep(-1.5, 5, e) * (1 - 0.88 * cloud) * (1 - 0.6 * fog);
  const sunCol = scale3(lin3(keyed(SUN, e, 1)), 1.25 * sunK);
  const sunDir = norm3([clamp(sun.az / 90, -1, 1) * 0.85, Math.max(Math.sin(e * D2R), 0.08) * 1.3, 0.6]);

  const illum = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
  const moonK = illum * smoothstep(-2, 6, moon.el) * (1 - 0.8 * cloud) * (1 - day);
  const moonCol = scale3([0.07, 0.09, 0.15], moonK * 1.2);
  const moonDir = norm3([clamp(moon.az / 90, -1, 1) * 0.8, Math.max(Math.sin(moon.el * D2R), 0.1) * 1.2, 0.6]);

  const ambSky = add3(scale3(lerp3(zenL, horL, 0.45), 0.9), [0.010, 0.012, 0.024], scale3(moonCol, 0.8));
  const ambGround = add3(scale3(ambSky, 0.45 + 0.35 * st.snow), scale3(sunCol, 0.1));

  const night = clamp(1 - smoothstep(-7, 3, e - cloud * 4 - rain * 3 - fog * 2), 0, 1);
  const lampOn = 1 - smoothstep(-4, 6, e - cloud * 5 - fog * 5 - rain * 3);
  const h24 = hour < 12 ? hour + 24 : hour;
  const late = 0.75 * smoothstep(22.5, 26.5, h24) * (1 - smoothstep(28.5, 30.5, h24));
  // light pollution under the clouds: strong over the city, faint in the countryside
  const cityGlow = scale3([0.032, 0.020, 0.018], night * (0.3 + 0.7 * cloud + 0.5 * fog) * (scene.cityGlow ?? 1));
  const glowK = Math.exp(-(((e - 1) / 5.5) ** 2)) * (1 - 0.85 * cloud);
  const fogCol = add3(scale3(lin3(gray3(hor)), 0.8), scale3(cityGlow, 1.2));
  const disc = scale3(lin3(lerp3([255, 170, 90], [255, 246, 224], smoothstep(0, 15, e))), 2.2);

  // World-space light directions for the isometric view (+X west, +Y south, +Z up).
  const worldDir = (o) => {
    const el = o.el * D2R, az = o.az * D2R;
    return norm3([Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.max(Math.sin(el), 0.02)]);
  };

  const horizonY = scene.groundY;
  const pos = (o) => [W * (0.5 + 0.47 * (o.az / 120)), horizonY - (o.el / 90) * horizonY * 1.08];

  return {
    uZenith: zenL, uHorizon: horL,
    uGlowCol: scale3(lin3([255, 130, 70]), 0.5 * glowK),
    uCityGlow: cityGlow, uFogCol: fogCol,
    uSunDir: sunDir, uSunW: worldDir(sun), uMoonW: worldDir(moon), uSunCol: sunCol, uSunDisc: disc, uSunPos: pos(sun),
    uSunVis: e > -2 ? (1 - 0.92 * cloud) * (1 - 0.7 * fog) : 0,
    uSunR: Math.max(4, H * 0.03),
    uMoonDir: moonDir, uMoonCol: moonCol, uMoonPos: pos(moon),
    uMoonVis: moon.el > -3 ? (1 - 0.9 * cloud) * (1 - 0.7 * fog) * (0.35 + 0.65 * (1 - day)) : 0,
    uMoonPhase: phase, uMoonR: Math.max(3, H * 0.022),
    uAmbSky: ambSky, uAmbGround: ambGround,
    uNight: night, uStars: (1 - smoothstep(-16, -5, e)) * (1 - cloud) * (1 - fog),
    uLampOn: lampOn, uLate: late,
    uCloud: cloud, uFog: fog, uRain: rain, uWet: st.wet, uSnow: st.snow,
    uExposure: 1.5 + night * 0.9,
    sunEl: e,   // not a uniform; used for rainbows
  };
}
