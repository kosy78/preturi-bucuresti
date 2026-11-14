import type { MapListing } from '../../shared/types';

export type Filters = {
  maxPpm: number | null; maxTotal: number | null; rooms: number[];   // empty = any; 4 means 4 or more
  minM2: number | null; minYear: number | null;
  maxMetroMin: number | null; parkWithin15: boolean; hideNewDev: boolean;
  district: string | null;       // set by clicking a cell
  sector: string | null;         // "Sectorul 1" … "Sectorul 6"
};

export const NO_FILTERS: Filters = {
  maxPpm: null, maxTotal: null, rooms: [], minM2: null, minYear: null,
  maxMetroMin: null, parkWithin15: false, hideNewDev: false, district: null, sector: null,
};

export const MIN_CELL_LISTINGS = 5;

// `inert`: faded by something other than the clicked district (filters or sector), so clicking it must not pick its district.
export type CellStat = { cell: string; median: number | null; n: number; thin: boolean; faded: boolean; inert: boolean; district: string | null; sector: string | null };

export function matchesKind(l: MapListing, f: Filters): boolean {
  if (f.rooms.length > 0 && !f.rooms.some((r) => r === l.rooms || (r === 4 && l.rooms > 4))) return false;
  if (f.minM2 !== null && l.m2 < f.minM2) return false;
  if (f.minYear !== null && (l.year === null || l.year < f.minYear)) return false;
  if (f.hideNewDev && l.isNewDev) return false;
  return true;
}

export function matches(l: MapListing, f: Filters): boolean {
  if (!matchesKind(l, f)) return false;
  if (f.maxPpm !== null && l.ppm > f.maxPpm) return false;
  if (f.maxTotal !== null && l.total > f.maxTotal) return false;
  if (f.maxMetroMin !== null && (l.metro === null || l.metro.minutes > f.maxMetroMin)) return false;
  if (f.parkWithin15 && (l.park === null || l.park.minutes > 15)) return false;
  if (f.district !== null && l.district !== f.district) return false;
  if (f.sector !== null && l.sector !== f.sector) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function commonest(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let most = 0;
  for (const [name, count] of counts) {
    if (count > most) {
      best = name;
      most = count;
    }
  }
  return best;
}

export function cellStats(ls: MapListing[], f: Filters): CellStat[] {
  // The clicked district and the chosen sector fade whole cells by the cell's own district and sector,
  // so a cell on a border stays lit through its listings that sit on the other side.
  const anyArea: Filters = { ...f, district: null, sector: null };
  const cells = new Map<string, { ppms: number[]; lit: boolean; districts: Map<string, number>; sectors: Map<string, number> }>();
  for (const l of ls) {
    if (l.cell === null) continue;
    let c = cells.get(l.cell);
    if (!c) {
      c = { ppms: [], lit: false, districts: new Map(), sectors: new Map() };
      cells.set(l.cell, c);
    }
    if (l.inStats && matchesKind(l, f)) c.ppms.push(l.ppm);
    if (!c.lit && matches(l, anyArea)) c.lit = true;
    if (l.district !== null) c.districts.set(l.district, (c.districts.get(l.district) ?? 0) + 1);
    if (l.sector !== null) c.sectors.set(l.sector, (c.sectors.get(l.sector) ?? 0) + 1);
  }

  const out: CellStat[] = [];
  for (const [cell, c] of cells) {
    const district = commonest(c.districts);
    const sector = commonest(c.sectors);
    const inert = !c.lit || (f.sector !== null && sector !== f.sector);
    const n = c.ppms.length;
    const thin = n < MIN_CELL_LISTINGS;
    out.push({
      cell,
      median: thin ? null : median(c.ppms),
      n,
      thin,
      faded: inert || (f.district !== null && district !== f.district),
      inert,
      district,
      sector,
    });
  }
  return out;
}

// Only listings with a position can show on the map or in the list; the legend's coverage line accounts for the rest.
export function matchCount(ls: MapListing[], f: Filters): { count: number; total: number } {
  const placed = ls.filter((l) => l.lat !== null && l.lng !== null);
  return { count: placed.filter((l) => matches(l, f)).length, total: placed.length };
}

export function listFor(ls: MapListing[], f: Filters, bounds: [w: number, s: number, e: number, n: number]): MapListing[] {
  const [w, s, e, n] = bounds;
  return ls
    .filter((l) => l.lat !== null && l.lng !== null && l.lng >= w && l.lng <= e && l.lat >= s && l.lat <= n && matches(l, f))
    .sort((a, b) => rank(a) - rank(b) || (a.delta ?? 0) - (b.delta ?? 0));
}

// Shares of houses, basements and typos sit far under their area's median; they would crowd the top of a best-value list.
export const UNUSUAL_DELTA = -40;

export function isUnusual(l: MapListing): boolean {
  return l.delta !== null && l.delta <= UNUSUAL_DELTA;
}

// Plausible prices first, then those without a median to compare against, then unusual ones.
function rank(l: MapListing): number {
  if (l.delta === null) return 1;
  return isUnusual(l) ? 2 : 0;
}

export const CITY_DOMAIN: [min: number, max: number] = [1200, 4500];

// Inside one sector the colours compare its cells with each other, so the cheapest lit cell is the low end of the ramp.
export function colourDomain(stats: CellStat[], f: Filters): [min: number, max: number] {
  if (f.sector === null) return CITY_DOMAIN;
  const medians = stats.filter((s) => s.sector === f.sector && !s.thin && !s.inert && s.median !== null).map((s) => s.median!);
  if (medians.length < 2) return CITY_DOMAIN;
  const min = Math.floor(Math.min(...medians) / 50) * 50;
  const max = Math.ceil(Math.max(...medians) / 50) * 50;
  return min === max ? CITY_DOMAIN : [min, max];
}

// A district lies inside one sector; any listing placing it in the sector is enough.
export function districtFitsSector(ls: MapListing[], district: string, sector: string): boolean {
  return ls.some((l) => l.district === district && l.sector === sector);
}
