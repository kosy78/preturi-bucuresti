export type LngLat = [lng: number, lat: number];
export type Named = { name: string; at: LngLat };
export type NamedPolygon = { name: string; ring: LngLat[] };
// GeoJSON MultiPolygon coordinates: polygons, each an outer ring followed by its holes.
export type MultiPolygon = LngLat[][][];
export type Boundaries = { city: MultiPolygon; sectors: { name: string; area: MultiPolygon }[] };

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function metres(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Streets are not straight lines: 1.3 approximates the detour, 80 m/min is a normal walking pace.
export function walkMinutes(m: number): number {
  return Math.round((m * 1.3) / 80);
}

export function nearestPoint(p: LngLat, pts: Named[]): { name: string; minutes: number } {
  let best = { name: '', m: Infinity };
  for (const { name, at } of pts) {
    const m = metres(p, at);
    if (m < best.m) best = { name, m };
  }
  return { name: best.name, minutes: walkMinutes(best.m) };
}

export function nearestPolygon(p: LngLat, polys: NamedPolygon[]): { name: string; minutes: number } {
  let best = { name: '', m: Infinity };
  for (const { name, ring } of polys) {
    if (contains(ring, p)) return { name, minutes: 0 };
    for (const v of ring) {
      const m = metres(p, v);
      if (m < best.m) best = { name, m };
    }
  }
  return { name: best.name, minutes: walkMinutes(best.m) };
}

export function contains(ring: LngLat[], [x, y]: LngLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function within(area: MultiPolygon, p: LngLat): boolean {
  return area.some(([outer, ...holes]) => contains(outer, p) && !holes.some((h) => contains(h, p)));
}

export function sectorAt(p: LngLat, b: Boundaries): string | null {
  return b.sectors.find((s) => within(s.area, p))?.name ?? null;
}

// Planar approximation around the ring's latitude; plenty for a "bigger than a hectare" cut-off.
export function areaM2(ring: LngLat[]): number {
  const lat0 = rad(ring.reduce((s, [, lat]) => s + lat, 0) / ring.length);
  const k = (EARTH_RADIUS_M * Math.PI) / 180;
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * k * Math.cos(lat0);
    const yi = ring[i][1] * k;
    const xj = ring[j][0] * k * Math.cos(lat0);
    const yj = ring[j][1] * k;
    twice += xj * yi - xi * yj;
  }
  return Math.abs(twice) / 2;
}
