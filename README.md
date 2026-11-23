# Pixel Skies

Animated pixel-art backgrounds that fill the whole screen, crisp at any
resolution, with a live time of day, real seasons and weather. Plain HTML,
CSS and JavaScript (WebGL2), with no libraries and no build step.

## Themes

| Theme | View | Highlights |
|---|---|---|
| City | Isometric | Traffic with headlights, rooftop steam, neon, wet-street reflections |
| Skyline | Side | Street-level skyline, mirror-wet road, neon signs, parallax layers |
| Village | Isometric | Chalets with chimney smoke, church spire, pond that freezes, snowy peaks, Christmas tree in December |
| Harbour | Isometric | Sea to the horizon, bobbing boats, piers, a lighthouse beam sweeping at night, gulls |
| Garden | Isometric | Pagoda and hall, koi pond, arched bridge, stone lanterns, cherry blossom and red maples |
| Sky Isles | Side | Floating islands, waterfalls into a sea of clouds, airships, a windmill village |

Each theme opens with its own look: a cloudy city with wet streets, a rainy
skyline, a snowy
December village, a breezy midsummer harbour, the garden in cherry-blossom
season and the sky isles in early summer. Themes with a set date still follow
your real time of day. **Reset** in the panel restores that look, and **Seed**
generates a new random layout. Fine-grained settings (snow, wetness, wind,
pixel size, colours, dither, parallax) live under *Advanced settings*.

Every theme reacts to the time (sun and moon follow their real paths for the
date), the season (foliage, blossom, autumn colour, bare winter trees),
weather (clear, cloudy, overcast, fog, rain, storm with lightning, snow) and
settling snow or wet ground. Look out for shooting stars on clear nights and a
rainbow when the sun breaks through after rain. Switching theme or seed
crossfades between scenes.

## Run it locally

ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8642
```

Then open http://localhost:8642.

## Controls

- **H**: hide the panel (wallpaper mode) · **F**: fullscreen · **R**: new seed (random layout) · **Space**: pause or resume time
- Moving the mouse pans the camera a little (turn it off under *Mouse parallax*).
- The URL stores the current settings, so a link reopens the same view.
  Add `ui=0` to start with the panel hidden.

## Deploy to GitHub Pages

Push the folder to a repository, then go to *Settings → Pages* and serve from
the default branch's root. There's nothing to build.

## How it works

Scenes are drawn by code at a low resolution (about 216 pixels tall). Every
pixel stores its material, surface direction and, in isometric scenes, its
height. A WebGL shader relights everything each frame: sun and moon with real
shadows, lamps, glowing windows, fog, reflections, snow. It then quantises the
colours with ordered dithering and scales the result up by a whole number, so
pixels stay sharp on any screen.

- `src/themes.js`: theme list
- `src/isokit.js`: isometric renderer (boxes, roofs, cylinders, cones, trees)
- `src/iso.js`, `village.js`, `harbour.js`, `garden.js`: isometric themes
- `src/city.js` (Skyline), `skyisles.js`: side-view themes
- `src/shaders.js`: lighting, sky, water and weather
- `src/sky.js`: sun, moon and season model
- `src/particles.js`, `iso-life.js`, `skylife.js`: rain, snow, birds, traffic, boats, airships
