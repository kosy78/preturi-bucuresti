import type { Detail } from '../../shared/types';

// Pins placed by hand on the site's map widget carry full float precision (11–12 decimals);
// pins geocoded from an address or zone have 7 or fewer and can sit kilometres off.
const HAND_PLACED_DECIMALS = 10;

export function parseAnuntulMap(html: string): Map<string, Detail> {
  if (!/var anunturi\s*=\s*\[\]/.test(html)) throw new Error('Anuntul map page has no listing data');

  const positions = new Map<string, Detail>();
  for (const [, latText, lngText, id] of html.matchAll(/anunturi\.push\(\[\[(-?[\d.]+),\s*(-?[\d.]+)\],\s*(\d+)\]\)/g)) {
    const lat = Number(latText);
    const lng = Number(lngText);
    const inBucharest = lat >= 44.33 && lat <= 44.55 && lng >= 25.95 && lng <= 26.25;
    const decimals = Math.min(latText.split('.')[1]?.length ?? 0, lngText.split('.')[1]?.length ?? 0);
    positions.set(`anuntul:${id}`, {
      lat: inBucharest ? lat : null,
      lng: inBucharest ? lng : null,
      precise: inBucharest && decimals >= HAND_PLACED_DECIMALS,
      year: null,
      market: null,
    });
  }
  return positions;
}
