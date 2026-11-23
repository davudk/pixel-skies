// Theme registry: one generator per theme.
import { generateCity } from './city.js';
import { generateIsoCity } from './iso.js';
import { generateVillage } from './village.js';
import { generateHarbour } from './harbour.js';
import { generateGarden } from './garden.js';
import { generateSkyIsles } from './skyisles.js';

export const THEMES = [
  { id: 'city', name: 'City', gen: generateIsoCity },        // isometric
  { id: 'skyline', name: 'Skyline', gen: generateCity },     // side view
  { id: 'village', name: 'Village', gen: generateVillage },
  { id: 'harbour', name: 'Harbour', gen: generateHarbour },
  { id: 'garden', name: 'Garden', gen: generateGarden },
  { id: 'isles', name: 'Sky Isles', gen: generateSkyIsles },
];

export function generateScene(theme, W, H, seed, season, doy) {
  const t = THEMES.find((x) => x.id === theme) || THEMES[0];
  return t.gen(W, H, seed, season, doy);
}
