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
  // Walking limits need a trustworthy position: a loose pin's distances could be off by a whole neighbourhood.
  if (f.maxMetroMin !== null && (!l.precise || l.metro === null || l.metro.minutes > f.maxMetroMin)) return false;
  if (f.parkWithin15 && (!l.precise || l.park === null || l.park.minutes > 15)) return false;
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
  const cells = new Map<string, { ppms: number[]; all: number; lit: boolean; members: MapListing[]; districts: Map<string, number>; sectors: Map<string, number> }>();
  for (const l of ls) {
    if (l.cell === null) continue;
    let c = cells.get(l.cell);
    if (!c) {
      c = { ppms: [], all: 0, lit: false, members: [], districts: new Map(), sectors: new Map() };
      cells.set(l.cell, c);
    }
    if (l.inStats) c.all += 1;
    if (l.inStats && matchesKind(l, f)) c.ppms.push(l.ppm);
    if (!c.lit && matches(l, anyArea)) c.lit = true;
    c.members.push(l);
    if (l.district !== null) c.districts.set(l.district, (c.districts.get(l.district) ?? 0) + 1);
    if (l.sector !== null) c.sectors.set(l.sector, (c.sectors.get(l.sector) ?? 0) + 1);
  }

  const out: CellStat[] = [];
  for (const [cell, c] of cells) {
    const district = commonest(c.districts);
    const sector = commonest(c.sectors);
    // A click picks the cell's most common district, so the cell is clickable only if that district has a match here.
    // The colour follows the cell's own sector; whether a click may pick its district is a stricter question.
    const ruledOut = !c.lit || (f.sector !== null && sector !== f.sector);
    const pickable = district !== null && c.members.some((l) => matches(l, { ...f, district }));
    // The picked district's own cells stay clickable (a click there clears it).
    const inert = ruledOut || (district !== f.district && !pickable);
    const n = c.ppms.length;
    // "Too few listings" is about the data, so it counts every listing; a cell with data but too few flats of the
    // filtered kind is a filter result instead, and fades like any other cell the filters rule out.
    const thin = c.all < MIN_CELL_LISTINGS;
    const fewOfKind = !thin && n < MIN_CELL_LISTINGS;
    out.push({
      cell,
      median: thin || fewOfKind ? null : median(c.ppms),
      n,
      thin,
      faded: ruledOut || fewOfKind || (f.district !== null && district !== f.district),
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

export type Order = 'value' | 'price';

export function byOrder(order: Order) {
  return order === 'price'
    ? (a: MapListing, b: MapListing) => a.total - b.total
    : (a: MapListing, b: MapListing) => rank(a) - rank(b) || (a.delta ?? 0) - (b.delta ?? 0);
}

// A picked district lists all of itself, wherever the map happens to be; otherwise the list follows the visible map.
export function listFor(ls: MapListing[], f: Filters, bounds: [w: number, s: number, e: number, n: number], order: Order = 'value'): MapListing[] {
  return listFromSorted([...ls].sort(byOrder(order)), f, bounds);
}

// The shortlist: every saved apartment, placed or not, whatever the filters.
export function favouritesFor(ls: MapListing[], favs: Set<string>, order: Order = 'value'): MapListing[] {
  return ls.filter((l) => favs.has(l.id)).sort(byOrder(order));
}

// The same lists from listings already sorted once for the order: a stable sort followed by a filter gives exactly what
// filtering then sorting gives, without sorting thousands of listings again on every filter step.
export function listFromSorted(sorted: MapListing[], f: Filters, bounds: [w: number, s: number, e: number, n: number]): MapListing[] {
  const [w, s, e, n] = bounds;
  const inView = (l: MapListing) => f.district !== null || (l.lng! >= w && l.lng! <= e && l.lat! >= s && l.lat! <= n);
  return sorted.filter((l) => l.lat !== null && l.lng !== null && inView(l) && matches(l, f));
}

export function unplacedFromSorted(sorted: MapListing[], f: Filters): MapListing[] {
  const noWalking = { ...f, maxMetroMin: null, parkWithin15: false };
  return sorted.filter((l) => (l.lat === null || l.lng === null) && matches(l, noWalking));
}

// Apartments that match but have no map position yet. Without a position no walking time can be known, so the walking
// filters do not apply to them (the list says so) rather than hiding all of them.
export function unplacedFor(ls: MapListing[], f: Filters, order: Order = 'value'): MapListing[] {
  return unplacedFromSorted([...ls].sort(byOrder(order)), f);
}

// spread: a robust standard deviation (1.4826 x the median absolute deviation), unmoved by a few wild prices.
type AreaStat = { median: number; n: number; spread: number };
export type AreaMedians = { district: Map<string, AreaStat>; sector: Map<string, AreaStat>; districtEra: Map<string, AreaStat> };

// Built in 1990 or later counts as a newer block; the collector splits neighbourhood medians the same way.
const NEW_ERA_FROM = 1990;
const eraOf = (l: MapListing) => (l.year === null ? null : l.year < NEW_ERA_FROM ? 'vechi' : 'nou');

// The same medians the collector compares each listing against: every listing with a real price, by district, by
// district and building era, and by sector.
export function areaMedians(ls: MapListing[]): AreaMedians {
  const group = (keyOf: (l: MapListing) => string | null) => {
    const ppms = new Map<string, number[]>();
    for (const l of ls) {
      const name = l.inStats ? keyOf(l) : null;
      if (name === null) continue;
      const xs = ppms.get(name);
      if (xs) xs.push(l.ppm);
      else ppms.set(name, [l.ppm]);
    }
    return new Map(
      [...ppms].map(([name, xs]) => {
        const median = exactMedian(xs);
        return [name, { median, n: xs.length, spread: 1.4826 * exactMedian(xs.map((x) => Math.abs(x - median))) }];
      }),
    );
  };
  return {
    district: group((l) => l.district),
    sector: group((l) => l.sector),
    districtEra: group((l) => (l.district !== null && eraOf(l) !== null ? `${l.district}|${eraOf(l)}` : null)),
  };
}

function exactMedian(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// The median a listing's difference was measured against, or null when it has none.
export function basisOf(l: MapListing, m: AreaMedians): AreaStat | null {
  if (l.delta === null || l.deltaBasis === null || l.basisName === null) return null;
  if (l.deltaBasis === 'district' && l.basisEra) return m.districtEra.get(`${l.basisName}|${l.basisEra}`) ?? null;
  return m[l.deltaBasis].get(l.basisName) ?? null;
}

// Shares of houses, basements and typos sit far under their area's median; they would crowd the top of a best-value list.
export const UNUSUAL_DELTA = -40;

// Set by flagUnusual on listings far below their own comparison group, or too cheap or cramped to be a whole flat.
export type Flagged = MapListing & { odd?: boolean };

// Unusual: 40% or more under the median (Cosmin's rule, kept for every listing), or flagged by flagUnusual.

export function isUnusual(l: MapListing): boolean {
  return (l as Flagged).odd === true || (l.delta !== null && l.delta <= UNUSUAL_DELTA);
}

const MIN_FLAT_EUR = 20_000;
const MIN_M2_PER_ROOM = 12;
// How far under its comparison group's median a price must sit, in robust standard deviations, to be called unusual.
const UNUSUAL_SPREADS = 3;
const MIN_UNUSUAL_GAP = 0.3;

// The bottom of a best-value list is where typos, shares and basements gather. On top of the fixed 40% rule, a price is
// also flagged when it is both far below its own comparison group's spread (median minus 3 robust deviations) and at
// least 30% under it; a total too low for a whole flat, or rooms too small to be rooms, is flagged too. Studios are normal.
export function flagUnusual(ls: MapListing[], m: AreaMedians): Flagged[] {
  return ls.map((l) => {
    const basis = basisOf(l, m);
    // Tight groups make 3 deviations a small gap, so an ordinary discount must also be a big one to count as unusual.
    const farBelow = basis !== null && basis.spread > 0 && l.ppm < basis.median - UNUSUAL_SPREADS * basis.spread && l.ppm < basis.median * (1 - MIN_UNUSUAL_GAP);
    const odd = l.total < MIN_FLAT_EUR || l.m2 / Math.max(1, l.rooms) < MIN_M2_PER_ROOM || farBelow;
    return odd ? { ...l, odd } : l;
  });
}

// Plausible prices first, then those without a median to compare against, then unusual ones.
function rank(l: MapListing): number {
  if (isUnusual(l)) return 2;
  return l.delta === null ? 1 : 0;
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

const TWIN_METRES = 250;

function metresApart(a: MapListing, b: MapListing): number {
  const dy = (a.lat! - b.lat!) * 111_320;
  const dx = (a.lng! - b.lng!) * 111_320 * Math.cos((a.lat! * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

// The same flat posted twice (same price, size, floor, year, rooms and district, pinned within 250 m of each other)
// shows as one card; the second post's links join the first's "also" links. Flats that only share their numbers stay apart.
export function mergeTwins(ls: MapListing[]): MapListing[] {
  const seen = new Map<string, MapListing[]>();
  const out: MapListing[] = [];
  for (const l of ls) {
    if (l.lat === null || l.lng === null || l.district === null || l.floor === null || l.year === null) {
      out.push(l);
      continue;
    }
    const key = [l.total, Math.round(l.m2), l.floor, l.year, l.rooms, l.district].join('|');
    const group = seen.get(key) ?? [];
    const first = group.find((g) => metresApart(g, l) <= TWIN_METRES);
    if (first) {
      first.also.push(l.url, ...l.also);
      continue;
    }
    const kept = { ...l, also: [...l.also] };
    seen.set(key, [...group, kept]);
    out.push(kept);
  }
  return out;
}

// Anuntul.ro gives no neighbourhood of its own for a loosely placed pin, so a comparison with "its" area would rest on a guess.
// Storia names the neighbourhood itself, so its loosely placed listings keep their comparison.
export function trustLocations(ls: MapListing[]): MapListing[] {
  return ls.map((l) => (!l.precise && l.id.startsWith('anuntul:') && l.delta !== null ? { ...l, delta: null, deltaBasis: null, basisName: null } : l));
}

// value: for a money limit, the lowest round limit that brings results back (instead of dropping the limit).
export type Relax = { key: keyof Filters; count: number; value?: number };

const SUGGEST_AT_LEAST = 5;

function suggestLimit(ls: MapListing[], f: Filters, key: 'maxTotal' | 'maxPpm'): { value: number; count: number } | null {
  const loose = { ...f, [key]: null };
  const prices = ls.filter((l) => l.lat !== null && matches(l, loose)).map((l) => (key === 'maxTotal' ? l.total : l.ppm)).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const step = key === 'maxTotal' ? 5000 : 100;
  const value = Math.ceil(prices[Math.min(prices.length, SUGGEST_AT_LEAST) - 1] / step) * step;
  return { value, count: prices.filter((p) => p <= value).length };
}

// For an empty result: how many apartments each active filter, dropped on its own, would bring back. Most first.
export function relaxations(ls: MapListing[], f: Filters): Relax[] {
  const off: Partial<Record<keyof Filters, Filters[keyof Filters]>> = {
    maxTotal: null, maxPpm: null, rooms: [], minM2: null, minYear: null, maxMetroMin: null, parkWithin15: false, hideNewDev: false, sector: null, district: null,
  };
  const out: Relax[] = [];
  for (const key of Object.keys(off) as (keyof Filters)[]) {
    if (JSON.stringify(f[key]) === JSON.stringify(off[key])) continue;
    if (key === 'maxTotal' || key === 'maxPpm') {
      const s = suggestLimit(ls, f, key);
      if (s) out.push({ key, ...s });
      continue;
    }
    const loose = { ...f, [key]: off[key] } as Filters;
    const count = ls.filter((l) => l.lat !== null && l.lng !== null && matches(l, loose)).length;
    if (count > 0) out.push({ key, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

// A district lies inside one sector; any listing placing it in the sector is enough.
export function districtFitsSector(ls: MapListing[], district: string, sector: string): boolean {
  return ls.some((l) => l.district === district && l.sector === sector);
}
