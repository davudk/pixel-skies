// GLSL for the two render passes.
//  1. LIGHT: runs once per low-res pixel. Composites the 4 layers, lights them
//     (sun, moon, sky ambient, lamps, neon), adds sky, fog, reflections,
//     particles, then quantises colour with ordered dithering.
//  2. UPSCALE: copies each low-res pixel into an exact integer block of screen
//     pixels (nearest neighbour), so the picture is crisp at any resolution.

export const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const UPSCALE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uOffset;
uniform float uScale;
uniform vec2 uLowRes;
out vec4 outColor;
void main() {
  vec2 lp = floor((gl_FragCoord.xy - uOffset) / uScale);
  lp = clamp(lp, vec2(0.0), uLowRes - 1.0);
  outColor = texelFetch(uTex, ivec2(lp), 0);
}`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2D uPart;

uniform vec2 uRes;
uniform float uHorizonY;
uniform float uTime;

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlowCol;
uniform vec3 uCityGlow;
uniform vec3 uFogCol;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSunDisc;
uniform vec2 uSunPos;
uniform float uSunVis;
uniform float uSunR;
uniform vec3 uMoonDir;
uniform vec3 uMoonCol;
uniform vec2 uMoonPos;
uniform float uMoonVis;
uniform float uMoonPhase;
uniform float uMoonR;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform float uNight;
uniform float uStars;
uniform float uLampOn;
uniform float uLate;
uniform float uCloud;
uniform float uCloudX;
uniform float uFog;
uniform float uRain;
uniform float uWet;
uniform float uSnow;
uniform float uFlash;
uniform float uExposure;
uniform float uRainbow; // 0..1: a rainbow opposite the sun after rain
uniform float uSeaY;   // > 0: a sea of clouds fills the sky below this row (sky islands)
uniform float uLevels;
uniform float uDither;

out vec4 outColor;

const int F_WINDOW = 1, F_NEON = 2, F_GLASS = 4, F_FOLIAGE = 8, F_GROUND = 16, F_ROAD = 32, F_LAMP = 64, F_BLINK = 128;
const vec3 SNOW = vec3(0.80, 0.84, 0.92);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }

float bayer4(ivec2 p) {
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0;
}

float flicker(float seed) {
  if (seed > 0.16) return 1.0;
  return hash12(vec2(floor(uTime * 9.0), seed * 331.0)) > 0.3 ? 1.0 : 0.12;
}

float lightOn(vec4 la) {
  float kind = floor(la.w), f = fract(la.w);
  if (kind < 0.5) return step(f, uLampOn);         // street lamp
  if (kind < 1.5) return uNight * flicker(f);       // neon sign
  if (kind < 2.5) return step(f, uNight + 0.04);    // shop window
  return step(f, uLampOn);                          // lighthouse
}


// ------------------------------------------------------------------ sky
vec3 skyGrad(float y) {
  float g = clamp(1.0 - y / uHorizonY, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(g, 0.75));
  return c + uCityGlow * pow(1.0 - g, 3.0);
}

float gStarK = 1.0;   // lowered while computing reflections, so water doesn't sparkle with every star

vec3 skyColor(vec2 p) {
  float hz = clamp(p.y / uHorizonY, 0.0, 1.0);
  vec3 c = skyGrad(p.y);
  vec2 sd = (p - uSunPos) * vec2(0.55, 1.0);
  c += uGlowCol * exp(-length(sd) / (uRes.y * 0.3)) * (0.4 + 0.6 * hz);

  if (uStars > 0.01) {
    float h = hash12(floor(p) + 7.3);
    if (h > 0.993) {
      float b = (h - 0.993) / 0.007;
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + b * 4.0) + h * 300.0);
      c += vec3(0.75, 0.8, 1.0) * b * tw * uStars * (1.0 - hz * 0.8) * 0.8 * gStarK;
    }
  }

  if (uMoonVis > 0.0) {
    vec2 m = (p - uMoonPos) / uMoonR;
    float r2 = dot(m, m);
    float a = uMoonPhase * 6.2831853;
    if (r2 <= 1.0) {
      float z = sqrt(1.0 - r2);
      float lit = dot(vec3(m.x, -m.y, z), vec3(sin(a), 0.0, -cos(a))) > 0.0 ? 1.0 : 0.0;
      float mare = vnoise(m * 2.2 + 5.0) > 0.58 ? 0.78 : 1.0;
      vec3 mc = vec3(0.95, 0.92, 0.82) * mare * 1.6;
      vec3 dark = c * 0.85 + vec3(0.004, 0.005, 0.01);
      c = mix(c, mix(dark, mc, lit), uMoonVis);
    } else {
      float illum = 0.5 - 0.5 * cos(a);
      c += vec3(0.25, 0.3, 0.45) * exp(-(sqrt(r2) - 1.0) * 0.9) * 0.12 * illum * uMoonVis;
    }
  }

  if (uSunVis > 0.0) {
    float d = length(p - uSunPos) / uSunR;
    if (d <= 1.0) c = mix(c, uSunDisc, uSunVis);
    else c += uSunDisc * exp(-(d - 1.0) * 1.2) * 0.25 * uSunVis;
  }

  if (uCloud > 0.02) {
    vec2 q = vec2((p.x + uCloudX) / 64.0, p.y / 20.0);
    float n = fbm(q);
    float th = mix(0.78, 0.22, uCloud);
    float dens = clamp((n - th) / 0.16, 0.0, 1.0);
    if (dens > 0.0) {
      vec2 toSun = normalize(uSunPos - p + vec2(0.001));
      float n2 = fbm(q + toSun * vec2(0.06, 0.18));
      float lit = clamp((n - n2) * 5.0 + 0.5, 0.0, 1.0);
      vec3 cl = uAmbSky * 1.15 + uSunCol * 0.55 + uGlowCol * 0.8 * hz + uMoonCol * 0.6;
      vec3 cd = uAmbSky * 0.6 + uCityGlow * (0.6 + 1.2 * hz);
      vec3 cc = mix(cd, cl, lit * (1.0 - 0.5 * uCloud)) + uFlash * vec3(0.8, 0.85, 1.0) * 0.8;
      dens = floor(dens * 3.0 + 0.5) / 3.0;
      c = mix(c, cc, dens * 0.97);
    }
  }
  c += uFlash * vec3(0.5, 0.55, 0.7) * 0.4;

  if (uRainbow > 0.01) {
    // Centred on the point opposite the sun (the sun mirrored below the
    // horizon), red on the outside, violet inside, plus a faint second bow.
    vec2 anti = vec2(uRes.x - uSunPos.x, 2.0 * uHorizonY - uSunPos.y);
    float R = uHorizonY * 0.75 + uRes.y * 0.16;
    float d = length(p - anti) / R;
    float t1 = (d - 0.9) / 0.1, t2 = (d - 1.14) / 0.07;
    vec3 bow = vec3(0);
    if (t1 > 0.0 && t1 < 1.0) bow += clamp(abs(fract((1.0 - t1) * 0.75 + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0) * sin(t1 * 3.1416);
    if (t2 > 0.0 && t2 < 1.0) bow += clamp(abs(fract(t2 * 0.75 + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0) * sin(t2 * 3.1416) * 0.35;
    c += bow * (uSunCol * 0.42 + uAmbSky * 0.25) * uRainbow * smoothstep(0.0, 0.25, 1.0 - hz * 0.9);
  }

  c = mix(c, uFogCol, uFog * 0.75 * pow(hz, 1.5));

  if (uSeaY > 0.0) {
    // Sea of clouds: a billowing top edge, sunlit tops, shadowed depths.
    float x = p.x + uTime * 1.2;
    float top = uSeaY + (fbm(vec2(x / 45.0, 1.3)) - 0.5) * 22.0 + sin(x * 0.11) * 2.0;
    if (p.y > top) {
      float d = p.y - top;
      float n = fbm(vec2(x / 28.0, p.y / 9.0 - uTime * 0.02));
      float lit = clamp(exp(-d / 9.0) * 0.9 + (n - 0.45) * 0.8, 0.0, 1.0);
      lit = floor(lit * 4.0 + 0.5) / 4.0;
      vec3 bright = uSunCol * 0.7 + uAmbSky * 1.25 + uGlowCol * 1.6 + uMoonCol * 0.9 + vec3(0.015, 0.016, 0.022);
      vec3 shadow = uAmbSky * 0.55 + uAmbGround * 0.25 + uCityGlow;
      c = mix(shadow, bright, lit) + uFlash * vec3(0.6, 0.65, 0.8) * 0.7;
    }
  }
  return c;
}


// Tone map, then quantise to a few levels per channel with ordered dithering.
vec4 finish(vec3 col, ivec2 ip) {
  col = vec3(1.0) - exp(-col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  float L = uLevels - 1.0;
  col = floor(col * L + mix(0.5, bayer4(ip), uDither)) / L;
  return vec4(clamp(col, 0.0, 1.0), 1.0);
}

// Things drawn on the CPU each frame (rain, snow, lightning, cars, steam).
// The alpha byte says how to combine them:
//   255      emissive, replaces the pixel (lightning, headlights)
//   245-254  additive glow (headlight beams)
//   240-244  opaque surface lit by the scene (car bodies)
//   below    translucent particle lit by the scene (rain, snow, steam)
vec3 addParticles(vec3 col, ivec2 ip, vec3 localLight) {
  vec4 pc = texelFetch(uPart, ip, 0);
  int a = int(pc.a * 255.0 + 0.5);
  if (a == 0) return col;
  if (a == 255) return toLin(pc.rgb) * 3.0;
  if (a >= 245) return col + toLin(pc.rgb) * 1.2;
  if (a >= 240) return toLin(pc.rgb) * (uAmbSky * 0.7 + uAmbGround * 0.3 + uSunCol * 0.9 + uMoonCol * 0.6 + uFlash + localLight * 1.3);
  vec3 pl = toLin(pc.rgb) * (uAmbSky * 1.3 + vec3(0.035, 0.04, 0.05) + uSunCol * 0.35 + uMoonCol * 0.5 + uFlash + localLight * 1.2);
  return mix(col, pl, pc.a * 255.0 / 240.0);
}

`;

export const LIGHT_FRAG = COMMON + `
uniform sampler2DArray uAlb;
uniform sampler2DArray uMat;
uniform sampler2DArray uExt;
uniform float uMargin;
uniform float uLayerW;
uniform float uOff[4];
uniform float uRoadAxis;
uniform int uLightCount;
uniform vec4 uLA[64]; // x, y (layer space), layer, kind + fract(threshold)
uniform vec4 uLB[64]; // linear rgb, radius
const float HAZE[4] = float[4](0.5, 0.28, 0.1, 0.0);
const float FOGL[4] = float[4](0.75, 0.6, 0.42, 0.2);

vec2 lightScreen(vec4 a) { return vec2(a.x - uMargin + uOff[int(a.z)], a.y); }

// --------------------------------------------------------------- surfaces
struct Surf { bool hit; int layer; vec3 alb; vec3 n; int flags; int flags2; float emit; float rnd; bool snow; };

Surf sampleScene(ivec2 ip) {
  Surf s;
  s.hit = false; s.layer = -1; s.alb = vec3(0); s.n = vec3(0, 0, 1);
  s.flags = 0; s.flags2 = 0; s.emit = 0.0; s.rnd = 0.0; s.snow = false;
  if (ip.y < 0 || ip.y >= int(uRes.y)) return s;
  for (int l = 3; l >= 0; l--) {
    int lx = ip.x + int(uMargin) - int(uOff[l]);
    if (lx < 0 || lx >= int(uLayerW)) continue;
    ivec3 tc = ivec3(lx, ip.y, l);
    vec4 a = texelFetch(uAlb, tc, 0);
    vec4 e = texelFetch(uExt, tc, 0);
    bool sn = e.r > 0.0 && uSnow >= e.r;
    if (a.a > 0.5 || sn) {
      vec4 m = texelFetch(uMat, tc, 0);
      float nx = (m.r * 255.0 - 128.0) / 127.0, ny = (m.g * 255.0 - 128.0) / 127.0;
      s.hit = true; s.layer = l; s.alb = a.rgb;
      s.n = vec3(nx, ny, sqrt(max(0.0, 1.0 - nx * nx - ny * ny)));
      s.flags = int(m.a * 255.0 + 0.5); s.emit = m.b; s.rnd = e.g; s.snow = sn;
      s.flags2 = int(e.b * 255.0 + 0.5);
      return s;
    }
  }
  return s;
}

vec3 surfLights(vec2 p, int layer, vec3 n) {
  vec3 acc = vec3(0);
  if (layer < 2) return acc;
  for (int i = 0; i < 64; i++) {
    if (i >= uLightCount) break;
    vec4 a = uLA[i], b = uLB[i];
    int ll = int(a.z);
    float on = lightOn(a);
    if (on <= 0.0) continue;
    vec2 d = lightScreen(a) - p;
    float dist = length(d);
    if (dist > b.w) continue;
    float att = 1.0 - dist / b.w;
    att *= att;
    if (floor(a.w) < 0.5 && d.y > 1.0) att *= 0.3;   // lamp shade blocks upward light
    vec3 L = normalize(vec3(d.x, -d.y, float(abs(ll - layer)) * 10.0 + 4.0));
    acc += b.rgb * att * on * (0.25 + 0.75 * max(dot(n, L), 0.0));
  }
  return acc;
}

vec3 glows(vec2 p) {
  vec3 acc = vec3(0);
  float atm = min(0.35 + uFog * 1.5 + uRain, 1.2);
  for (int i = 0; i < 64; i++) {
    if (i >= uLightCount) break;
    vec4 a = uLA[i], b = uLB[i];
    float on = lightOn(a);
    if (on <= 0.0) continue;
    vec2 d = p - lightScreen(a);
    float kind = floor(a.w);
    float r = (kind < 0.5 ? 2.2 : 3.5) * (1.0 + uFog * 1.5 + uRain * 0.8);
    acc += b.rgb * exp(-dot(d, d) / (r * r)) * 0.55 * on * atm;
    if (kind < 0.5 && d.y > 1.0) {
      float cone = step(abs(d.x), d.y * 0.5 + 1.0) * (1.0 - smoothstep(0.0, b.w * 0.8, d.y));
      acc += b.rgb * cone * 0.05 * (uFog + uRain * 0.7) * on;
    }
  }
  return acc;
}

vec3 shadeSurf(Surf s, vec2 p) {
  vec3 alb = toLin(s.alb);
  vec3 n = s.n;
  int fl = s.flags;
  if (s.snow) { alb = SNOW; n = normalize(vec3(n.x * 0.3, 0.85, 0.5)); fl = 0; }

  if ((fl & F_GROUND) != 0) {
    float nz = hash12(floor(p * vec2(0.5, 1.0)));
    float k;
    if ((fl & F_ROAD) != 0) {
      float track = abs(fract((p.y - uRoadAxis) / 9.0) - 0.5) < 0.17 ? 0.55 : 1.0;
      k = smoothstep(0.25, 0.85, uSnow + (nz - 0.5) * 0.25) * track * 0.95;
    } else {
      k = smoothstep(0.08, 0.5, uSnow + (nz - 0.5) * 0.3);
    }
    alb = mix(alb * mix(1.0, 0.45, uWet), SNOW, k);
  }

  vec3 light = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  light += uSunCol * max(dot(n, uSunDir), 0.0);
  light += uMoonCol * max(dot(n, uMoonDir), 0.0);
  light += uFlash * vec3(0.75, 0.8, 1.0) * (0.5 + 0.5 * max(n.y, 0.0));
  light += surfLights(p, s.layer, n);

  vec3 col = alb * light;
  vec3 emi = vec3(0);

  if ((fl & F_WINDOW) != 0) {
    bool on = (uNight + 0.04 > s.emit) && (s.rnd >= uLate);
    if (on) {
      col *= 0.2;
      emi = alb * 1.5;
    } else {
      vec3 glass = vec3(0.012, 0.016, 0.026) * (0.6 + 0.8 * dot(s.alb, vec3(0.33)));
      col = glass * light * 2.0 + skyGrad(max(p.y - 25.0, 0.0)) * 0.22;
    }
  }
  if ((fl & F_NEON) != 0) {
    col *= 0.6;
    emi = alb * (0.15 + 1.8 * uNight * flicker(s.rnd));
  }
  if ((fl & F_LAMP) != 0 && uLampOn >= s.emit) {
    col *= 0.5;
    emi = vec3(1.0, 0.82, 0.55) * 2.2;
  }
  if ((fl & F_BLINK) != 0) {
    emi = vec3(1.0, 0.08, 0.05) * 2.5 * step(fract(uTime * 0.7 + s.rnd), 0.12) * smoothstep(0.1, 0.5, uNight);
  }
  if ((fl & F_GLASS) != 0) {
    col = col * 0.45 + skyGrad(max(p.y - 40.0, 0.0)) * 0.55 * (1.0 - 0.6 * uNight);
  }

  if ((s.flags2 & 1) != 0) {
    // waterfall: bright streaks that scroll downwards
    float st = fract(p.y * 0.18 - uTime * 2.6 + hash12(vec2(floor(p.x), 3.0)) * 7.0);
    vec3 wcol = mix(vec3(0.35, 0.55, 0.75), vec3(0.9, 0.95, 1.0), step(0.55, st) * 0.8 + 0.2);
    col = wcol * (light * 0.9 + 0.06);
  }

  int l = s.layer;
  float h = clamp(HAZE[l] * (1.0 - 0.3 * uNight) + uFog * FOGL[l], 0.0, 0.92);
  vec3 hc = mix(skyGrad(uHorizonY * 0.8), uFogCol, uFog);
  col = mix(col, hc, h);
  emi *= 1.0 - h * 0.75;
  return col + emi;
}

vec3 sceneAt(ivec2 ip, out Surf s) {
  s = sampleScene(ip);
  vec2 p = vec2(ip) + 0.5;
  return s.hit ? shadeSurf(s, p) : skyColor(p);
}

void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  ivec2 ip = ivec2(fc.x, int(uRes.y) - 1 - fc.y);   // y = 0 at the top
  vec2 p = vec2(ip) + 0.5;

  Surf s;
  vec3 col = sceneAt(ip, s);

  // wet road: mirror the scene above the curb, with rain ripples and puddles
  if (s.hit && !s.snow && (s.flags & F_ROAD) != 0 && uWet > 0.01) {
    float dy = p.y - uRoadAxis;
    float wob = sin(p.y * 1.7 + uTime * 7.0) * uRain * 1.2 + sin(p.y * 0.5 + uTime * 2.0) * 0.6;
    ivec2 rp = ivec2(int(floor(p.x + wob)), max(int(floor(uRoadAxis - dy)), 0));
    Surf s2;
    vec3 rc = sceneAt(rp, s2) + glows(vec2(rp) + 0.5);
    float pud = smoothstep(0.42, 0.6, vnoise(vec2(p.x * 0.06, p.y * 0.4)));
    float k = uWet * (0.3 + 0.5 * pud) * (1.0 - smoothstep(0.25, 0.85, uSnow));
    col = mix(col, rc * vec3(0.75, 0.8, 0.9), k);
  }

  col += glows(p);

  col = addParticles(col, ip, surfLights(p, 3, vec3(0, 0, 1)));
  outColor = finish(col, ip);
}`;

// ------------------------------------------------------------- isometric view
// Every pixel knows its world height, so its 3D position can be rebuilt. That
// gives real sun/moon shadows (traced through a top-down heightmap), 3D lamp
// light, cloud shadows drifting over the roofs, and mirror reflections in
// wet streets.
export const ISO_FRAG = COMMON + `
uniform sampler2D uAlbI;
uniform sampler2D uMatI;
uniform sampler2D uExtI;
uniform sampler2D uPosI;
uniform sampler2D uHeight;
uniform sampler2D uLights;   // row 0: x, y, z, kind + threshold   row 1: rgb, radius (< 0: halo hidden)
uniform int uLightCount;
uniform vec2 uCam;
uniform vec2 uHMOrigin;
uniform vec2 uHMSize;
uniform float uMaxH;
uniform vec3 uSunW;
uniform vec3 uMoonW;
uniform vec2 uPan;     // where the visible picture starts inside the city buffer (camera pan)
uniform vec2 uBuf;     // city buffer size
uniform float uHpBuf;  // horizon row in the buffer (water mirrors far things about it)
uniform float uWind;

const int F2_WATER = 1, F2_FAR = 2;

struct ISurf { bool hit; vec3 alb; vec3 n; int flags; int flags2; float emit; float rnd; float snowThr; float fog; float Z; vec3 P; };

vec3 worldPos(vec2 p, float Z) {
  vec2 s = p - uCam;
  return vec3(s.y + Z + s.x * 0.5, s.y + Z - s.x * 0.5, Z);
}
vec2 toScreen(vec3 w) { return vec2(w.x - w.y, (w.x + w.y) * 0.5 - w.z) + uCam; }

ISurf fetchI(ivec2 ip) {
  ISurf s;
  vec4 a = texelFetch(uAlbI, ip, 0);
  s.hit = a.a > 0.5;
  s.alb = a.rgb; s.n = vec3(0, 0, 1); s.flags = 0; s.flags2 = 0; s.emit = 0.0; s.rnd = 0.0; s.snowThr = 0.0; s.fog = 1.0; s.Z = 0.0; s.P = vec3(0);
  if (!s.hit) return s;
  vec4 m = texelFetch(uMatI, ip, 0), e = texelFetch(uExtI, ip, 0), q = texelFetch(uPosI, ip, 0);
  s.n = normalize((m.rgb * 255.0 - 128.0) / 127.0 + vec3(0.0, 0.0, 1e-4));
  s.flags = int(m.a * 255.0 + 0.5);
  s.snowThr = e.r; s.rnd = e.g; s.emit = e.b; s.fog = e.a;
  s.flags2 = int(q.b * 255.0 + 0.5);
  s.Z = (q.r * 255.0 * 256.0 + q.g * 255.0) / 64.0;
  s.P = worldPos(vec2(ip) + 0.5, s.Z);
  return s;
}

float hm(vec2 xy) {
  vec2 c = floor(xy - uHMOrigin);
  if (c.x < 0.0 || c.y < 0.0 || c.x >= uHMSize.x || c.y >= uHMSize.y) return 0.0;
  return texelFetch(uHeight, ivec2(c), 0).r * 255.0;
}

// March towards the light through the heightmap, one world unit per step.
float shadowAt(vec3 P, vec3 L, float off) {
  if (L.z <= 0.005) return 0.0;
  float hl = length(L.xy);
  if (hl < 1e-4) return 1.0;
  vec3 st = L / hl;
  vec3 q = P + st * off;
  for (int i = 0; i < 240; i++) {
    if (q.z > uMaxH) return 1.0;
    if (hm(q.xy) > q.z) return 0.0;
    q += st;
  }
  return 1.0;
}

float cloudShadow(vec2 XY) {
  if (uCloud < 0.05) return 1.0;
  vec2 q = vec2((XY.x - XY.y + uCloudX * 1.5) / 90.0, (XY.x + XY.y) / 90.0);
  float d = clamp((fbm(q) - mix(0.78, 0.22, uCloud)) / 0.16, 0.0, 1.0);
  return 1.0 - 0.7 * d;
}

vec3 pointLightsW(vec3 P, vec3 n) {
  vec3 acc = vec3(0);
  for (int i = 0; i < 256; i++) {
    if (i >= uLightCount) break;
    vec4 a = texelFetch(uLights, ivec2(i, 0), 0);
    vec4 b = texelFetch(uLights, ivec2(i, 1), 0);
    float r = abs(b.w);
    vec3 d = a.xyz - P;
    if (abs(d.x) > r || abs(d.y) > r) continue;
    float dist = length(d);
    if (dist > r) continue;
    float on = lightOn(a);
    if (on <= 0.0) continue;
    float att = 1.0 - dist / r;
    att *= att;
    acc += b.rgb * att * on * (0.15 + 0.85 * max(dot(n, d / max(dist, 1e-3)), 0.0));
  }
  return acc;
}

// Halos around lights (and their mirror images in wet streets).
vec3 glowsW(vec2 p, bool mirror) {
  vec3 acc = vec3(0);
  float atm = min(0.35 + uFog * 1.5 + uRain, 1.2);
  for (int i = 0; i < 256; i++) {
    if (i >= uLightCount) break;
    vec4 a = texelFetch(uLights, ivec2(i, 0), 0);
    vec4 b = texelFetch(uLights, ivec2(i, 1), 0);
    if (b.w < 0.0) continue;
    vec3 lp = a.xyz;
    if (mirror) lp.z = -lp.z;
    vec2 d = p - toScreen(lp);
    float kind = floor(a.w);
    if (kind < 2.5 && (abs(d.x) > 24.0 || abs(d.y) > 40.0)) continue;   // beams reach much further
    float on = lightOn(a);
    if (on <= 0.0) continue;
    float r = (kind < 0.5 ? 2.0 : 3.0) * (1.0 + uFog * 1.5 + uRain * 0.8);
    acc += b.rgb * exp(-dot(d, d) / (r * r)) * 0.55 * on * atm;
    if (kind > 2.5 && !mirror) {
      // Rotating lighthouse beam: a horizontal ray sweeping round, seen from
      // above. It flares brightly whenever it points at the viewer.
      float ang = uTime * 0.9 + fract(a.w) * 6.2831;
      vec2 dw = vec2(cos(ang), sin(ang));
      vec2 ds = normalize(vec2(dw.x - dw.y, (dw.x + dw.y) * 0.5));
      float along = dot(d, ds), perp = abs(d.x * ds.y - d.y * ds.x);
      if (along > 0.0) {
        float wd = 0.7 + along * 0.07;
        acc += b.rgb * exp(-perp * perp / (wd * wd)) * exp(-along / 150.0) * (0.14 + uFog * 1.2 + uRain * 0.5 + uCloud * 0.15) * on * 0.45;
      }
      float facing = max(dot(dw, vec2(0.7071)), 0.0);
      acc += b.rgb * exp(-dot(d, d) / 10.0) * pow(facing, 10.0) * 3.0 * on;
    }
    if (!mirror && kind < 0.5 && d.y > 1.0 && d.y < a.z) {
      float cone = step(abs(d.x), d.y * 0.45 + 0.5);
      acc += b.rgb * cone * 0.06 * (uFog + uRain * 0.7) * on;
    }
  }
  return acc;
}

vec3 shadeI(ISurf s, vec2 p, out float snowK) {
  vec3 alb = toLin(s.alb);
  vec3 n = s.n;
  int fl = s.flags;
  bool far = (s.flags2 & F2_FAR) != 0;
  bool water = (s.flags2 & F2_WATER) != 0;
  float ice = water && s.rnd > 0.99 ? smoothstep(0.3, 0.6, uSnow) : 0.0;   // ponds freeze, the sea doesn't
  bool up = n.z > 0.55;

  if (water) {
    // little moving waves: tilt the normal with drifting noise
    float amp = 0.06 + 0.22 * abs(uWind) + 0.15 * uRain;
    vec2 q = s.P.xy * 0.35 + vec2(uTime * 0.6, uTime * 0.37);
    vec2 g = vec2(vnoise(q) - vnoise(q + vec2(0.7, 0.0)), vnoise(q) - vnoise(q + vec2(0.0, 0.7)));
    n = normalize(vec3(g * amp * 4.0 * (1.0 - ice), 1.0));
    alb = mix(alb, vec3(0.55, 0.66, 0.75), ice);
  }

  snowK = (s.snowThr > 0.0 && uSnow >= s.snowThr) ? 1.0 : 0.0;
  if (up && !far && (!water || ice > 0.5)) {
    float nz = hash12(floor(s.P.xy * 0.5) + 3.1);
    float k;
    if ((fl & F_GROUND) != 0 && !water) {
      if ((fl & F_ROAD) != 0) k = smoothstep(0.25, 0.85, uSnow + (nz - 0.5) * 0.25) * (s.rnd > 0.85 ? 0.5 : 1.0) * 0.95;
      else k = smoothstep(0.1, 0.55, uSnow + (nz - 0.5) * 0.3);
    } else if (water) {
      k = smoothstep(0.55, 0.95, uSnow + (nz - 0.5) * 0.3) * 0.8;
    } else {
      k = smoothstep(0.04, 0.3, uSnow + (nz - 0.5) * 0.2);
    }
    snowK = max(snowK, k);
  }
  if (up && !water) alb *= mix(1.0, (fl & F_GROUND) != 0 ? 0.45 : 0.7, uWet * (1.0 - snowK));
  if (snowK > 0.0) alb = mix(alb, SNOW, snowK);

  float shSun = 1.0, shMoon = 1.0, cs = 1.0, ao = 1.0;
  if (!far) {
    float off = (fl & F_FOLIAGE) != 0 ? 5.0 : 0.6;
    vec3 P0 = s.P + s.n * 0.3;
    if (dot(uSunCol, vec3(1)) > 0.003 && dot(s.n, uSunW) > 0.0) shSun = shadowAt(P0, uSunW, off);
    if (dot(uMoonCol, vec3(1)) > 0.002 && dot(s.n, uMoonW) > 0.0) shMoon = shadowAt(P0, uMoonW, off);
    cs = cloudShadow(s.P.xy);
    if (s.n.z > 0.9 && (fl & F_GROUND) != 0) {
      ao = 1.0 - 0.22 * step(s.P.z + 0.5, hm(s.P.xy - vec2(1.0, 0.0))) - 0.22 * step(s.P.z + 0.5, hm(s.P.xy - vec2(0.0, 1.0)));
    } else if (abs(n.z) < 0.3) {
      ao = 0.68 + 0.32 * smoothstep(0.0, 4.0, s.Z);
    }
  }

  // Stylised: strong key light, cool and dim fill, so shadows read clearly.
  vec3 light = mix(uAmbGround, uAmbSky, n.z * 0.5 + 0.5) * ao * 0.6;
  light += uSunCol * 1.7 * max(dot(n, uSunW), 0.0) * shSun * cs;
  light += uMoonCol * max(dot(n, uMoonW), 0.0) * shMoon;
  light += uFlash * vec3(0.75, 0.8, 1.0) * (0.5 + 0.5 * max(n.z, 0.0));
  if (!far) light += pointLightsW(s.P, n);
  // snow bounces the city's glow and moonlight back up, so it stays pale at night
  light += (uCityGlow * 2.5 + vec3(0.012, 0.016, 0.03) + uMoonCol * 0.5) * snowK;

  vec3 col = alb * light;
  vec3 emi = vec3(0);
  if (snowK < 0.5) {
    if ((fl & F_WINDOW) != 0) {
      bool on = (uNight + 0.04 > s.emit) && (s.rnd >= uLate);
      if (on) { col *= 0.2; emi = alb * 1.5; }
      else {
        vec3 glass = vec3(0.012, 0.016, 0.026) * (0.6 + 0.8 * dot(s.alb, vec3(0.33)));
        col = glass * light * 2.0 + skyGrad(uHorizonY * 0.4) * 0.2;
      }
    }
    if ((fl & F_NEON) != 0) { col *= 0.6; emi = alb * (0.15 + 1.8 * uNight * flicker(s.rnd)); }
    if ((fl & F_LAMP) != 0 && uLampOn >= s.emit) { col *= 0.5; emi = vec3(1.0, 0.82, 0.55) * 2.2; }
    if ((fl & F_BLINK) != 0) emi = vec3(1.0, 0.08, 0.05) * 2.5 * step(fract(uTime * 0.7 + s.rnd), 0.12) * smoothstep(0.1, 0.5, uNight);
    if ((fl & F_GLASS) != 0) col = col * 0.5 + skyGrad(uHorizonY * 0.3) * 0.45 * (1.0 - 0.6 * uNight);
  }

  // distance haze and fog grow towards the back of the scene
  float h = far ? s.fog * 0.62 + uFog * 0.35 : pow(s.fog, 1.8) * 0.32 * (1.0 - 0.3 * uNight) + uFog * (0.12 + 0.7 * s.fog);
  h = clamp(h, 0.0, 0.93);
  vec3 hc = mix(skyGrad(uHorizonY * 0.9), uFogCol, uFog);
  col = mix(col, hc, h);
  emi *= 1.0 - h * 0.75;
  return col + emi;
}

// What a mirror-like surface at buffer pixel ipb reflects: walk up the column
// until a wall sits at twice its height above us (it stands right behind); if
// we reach the backdrop or sky, mirror it about the horizon instead.
vec3 reflectAt(ivec2 ipb, float wob) {
  int rx = clamp(int(floor(float(ipb.x) + 0.5 + wob)), 0, int(uBuf.x) - 1);
  for (int d = 1; d < 220; d++) {
    ivec2 q = ivec2(rx, ipb.y - d);
    if (q.y < 0) break;
    ISurf r = fetchI(q);
    bool farR = !r.hit || (r.flags2 & F2_FAR) != 0;
    if (farR) break;
    if (r.n.z > 0.5) continue;
    if (abs(2.0 * r.Z - float(d)) <= 0.75) { float k2; return shadeI(r, vec2(q) + 0.5, k2); }
  }
  int my = int(2.0 * uHpBuf) - ipb.y;
  if (my >= 0) {
    ivec2 q = ivec2(rx, my);
    ISurf r = fetchI(q);
    if (r.hit && (r.flags2 & F2_FAR) != 0) { float k2; return shadeI(r, vec2(q) + 0.5, k2); }
  }
  gStarK = 0.15;
  vec3 c = skyColor(vec2(float(rx), float(my)) + 0.5 - uPan);
  gStarK = 1.0;
  return c;
}

void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  ivec2 ip = ivec2(fc.x, int(uRes.y) - 1 - fc.y);   // picture pixel (the sky stays put)
  vec2 p = vec2(ip) + 0.5;
  ivec2 ipb = ip + ivec2(uPan);                      // scene pixel (pans with the camera)
  vec2 pb = vec2(ipb) + 0.5;

  ISurf s = fetchI(ipb);
  float snowK = 0.0;
  vec3 col = s.hit ? shadeI(s, pb, snowK) : skyColor(p);
  bool water = s.hit && (s.flags2 & F2_WATER) != 0;

  if (water) {
    float ice = s.rnd > 0.99 ? smoothstep(0.3, 0.6, uSnow) : 0.0;
    float amp = 0.4 + 1.6 * abs(uWind) + uRain;
    float wob = (sin(pb.y * 1.3 + uTime * 3.0) + 0.6 * sin(pb.y * 0.37 - uTime * 1.7)) * amp * (1.0 - ice);
    vec3 rc = reflectAt(ipb, wob) + glowsW(pb, true);
    float k = mix(0.45 + 0.35 * s.fog, 0.22, ice) * (1.0 - snowK);
    col = mix(col, rc * vec3(0.8, 0.88, 0.95), k);
    // foam along the shore and whitecaps when it's windy or stormy
    float fm = s.emit;
    float t = vnoise(s.P.xy * 0.45 + vec2(uTime * 0.8, -uTime * 0.5));
    float foam = fm * smoothstep(0.35, 0.75, t + fm * 0.4 * sin(uTime * 1.5 + s.P.x * 0.3)) * (1.0 - ice);
    float caps = step(0.92 - 0.12 * abs(uWind) - 0.07 * uRain, vnoise(s.P.xy * 0.6 + vec2(uTime * 1.2, uTime * 0.4))) * min(abs(uWind) + uRain, 1.0) * 0.55 * (1.0 - ice);
    vec3 white = vec3(0.85, 0.9, 0.95) * (uAmbSky * 1.2 + uSunCol * 0.8 + uMoonCol + vec3(0.006));
    caps *= mix(1.0, 0.3, uNight);   // whitecaps fade into the dark at night
    col = mix(col, white, clamp(foam + caps, 0.0, 0.85) * (1.0 - snowK));
  } else if (s.hit && (s.flags & F_ROAD) != 0 && s.n.z > 0.9 && uWet > 0.01 && snowK < 0.6) {
    // wet streets mirror whatever stands behind them, with rain ripples
    float wob = sin(pb.y * 1.7 + uTime * 7.0) * uRain * 1.2 + sin(pb.y * 0.5 + uTime * 2.0) * 0.5;
    vec3 rc = reflectAt(ipb, wob) + glowsW(pb, true);
    float pud = smoothstep(0.42, 0.6, vnoise(s.P.xy * 0.08));
    float k = uWet * (0.25 + 0.5 * pud) * (1.0 - snowK);
    col = mix(col, rc * vec3(0.75, 0.8, 0.9), k);
  }

  col += glowsW(pb, false);
  col = addParticles(col, ip, s.hit ? pointLightsW(s.P + vec3(1.0, 1.0, 1.0), vec3(0.577)) : vec3(0));
  outColor = finish(col, ip);
}`;
