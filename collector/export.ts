import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gridDisk, latLngToCell } from 'h3-js';
import { H3_RESOLUTION, type MapListing, type Meta } from '../shared/types';
import { mergeReposts } from './dedupe';
import { metres, nearestPoint, nearestPolygon, sectorAt, within, type Boundaries, type LngLat, type Named, type NamedPolygon } from './geo';
import type { Store, StoredListing } from './store';

const MIN_PPM = 400;
const MAX_PPM = 15000;
const MIN_DISTRICT_SAMPLE = 15;
const SHARED_PIN_COUNT = 4;
const NEIGHBOUR_M = 600;
// Resolution 7 cells are ~1.2 km across, so a cell and its ring hold every point within 600 m.
const NEIGHBOUR_CELL_RESOLUTION = 7;
// Storia hides some pins behind a circle; past this the pin says little about which cell the flat is in.
const MAX_CELL_RADIUS_M = 500;
// In one neighbourhood old blocks sell under its median and new ones over (pre-1977 about 0.9x, 2020 on about 1.2x),
// so comparing with the whole neighbourhood made old flats look like bargains.
const NEW_ERA_FROM = 1990;
const DAY_MS = 86_400_000;

type Era = 'vechi' | 'nou';
type Median = { median: number; count: number };

const position = (l: StoredListing) => (l.hasDetail && l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null);
const pinKey = (p: { lat: number; lng: number }) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const eraOf = (l: StoredListing): Era | null => (l.year == null ? null : l.year < NEW_ERA_FROM ? 'vechi' : 'nou');
const districtEra = (l: StoredListing) => {
  const era = eraOf(l);
  return era && l.district !== null ? `${l.district}|${era}` : null;
};

function mediansBy(ls: StoredListing[], key: (l: StoredListing) => string | null): Map<string, Median> {
  const groups = new Map<string, number[]>();
  for (const l of ls) {
    const name = key(l);
    if (name === null) continue;
    const ppms = groups.get(name);
    if (ppms) ppms.push(l.ppm);
    else groups.set(name, [l.ppm]);
  }
  return new Map([...groups].map(([name, ppms]) => [name, { median: median(ppms), count: ppms.length }]));
}

type Medians = { districtEras: Map<string, Median>; districts: Map<string, Median>; sectors: Map<string, Median> };

// The narrowest comparison with enough listings: same neighbourhood and era, then neighbourhood, then sector.
function basisFor(l: StoredListing, m: Medians): { kind: 'district' | 'sector'; name: string; era: Era | null; median: number } | null {
  if (l.fromPrice) return null;
  const key = districtEra(l);
  const byEra = key !== null ? m.districtEras.get(key) : undefined;
  if (byEra && byEra.count >= MIN_DISTRICT_SAMPLE) return { kind: 'district', name: l.district!, era: eraOf(l), median: byEra.median };
  const district = l.district !== null ? m.districts.get(l.district) : undefined;
  if (district && district.count >= MIN_DISTRICT_SAMPLE) return { kind: 'district', name: l.district!, era: null, median: district.median };
  const sector = l.sector !== null ? m.sectors.get(l.sector) : undefined;
  return sector ? { kind: 'sector', name: l.sector!, era: null, median: sector.median } : null;
}

function priceDrop(l: StoredListing): number | null {
  const drop = l.peakTotal != null ? Math.round((1 - l.total / l.peakTotal) * 100) : 0;
  return drop > 0 ? drop : null;
}

// Each site names neighbourhoods its own way, which would split the medians; Storia's names win.
// Sectors come from the official outlines instead, so they hold even where no Storia listing is near.
function withStoriaPlaces(ls: StoredListing[], boundaries: Boundaries): StoredListing[] {
  const cellOf = (p: { lat: number; lng: number }) => latLngToCell(p.lat, p.lng, NEIGHBOUR_CELL_RESOLUTION);
  const storia = new Map<string, { at: LngLat; l: StoredListing }[]>();
  for (const l of ls) {
    const p = position(l);
    if (!p || !l.id.startsWith('storia:') || l.district === null) continue;
    const cell = cellOf(p);
    const entry = { at: [p.lng, p.lat] as LngLat, l };
    const bucket = storia.get(cell);
    if (bucket) bucket.push(entry);
    else storia.set(cell, [entry]);
  }

  return ls.flatMap((l): StoredListing[] => {
    const p = position(l);
    if (!p || l.id.startsWith('storia:')) return [l];
    // The tool covers Bucharest only: an exact pin outside the city is an Ilfov flat and is left out; a rough geocode
    // outside may just be a mis-read street, so the flat stays, without a position.
    if (!within(boundaries.city, [p.lng, p.lat])) return l.precise === true ? [] : [{ ...l, lat: null, lng: null, precise: false }];
    const placed = { ...l, sector: sectorAt([p.lng, p.lat], boundaries) ?? l.sector };
    // A geocoded pin can sit kilometres off; it would borrow the wrong neighbourhood.
    if (l.precise !== true) return [placed];
    let nearest: StoredListing | null = null;
    let best = NEIGHBOUR_M;
    for (const cell of gridDisk(cellOf(p), 1)) {
      for (const { at, l: s } of storia.get(cell) ?? []) {
        const m = metres([p.lng, p.lat], at);
        if (m <= best) [nearest, best] = [s, m];
      }
    }
    return [nearest ? { ...placed, district: nearest.district } : placed];
  });
}

export function buildExport(
  ls: StoredListing[],
  stations: Named[],
  parks: NamedPolygon[],
  boundaries: Boundaries,
  sweepFinishedAt: string,
): { listings: MapListing[]; meta: Meta } {
  const sane = ls.filter((l) => l.ppm >= MIN_PPM && l.ppm <= MAX_PPM);
  const { kept, also } = mergeReposts(withStoriaPlaces(sane, boundaries));

  // Agents often drop the pin on a neighbourhood centre or their usual spot rather than the building.
  const pins = new Map<string, number>();
  for (const l of kept) {
    const p = position(l);
    if (p) pins.set(pinKey(p), (pins.get(pinKey(p)) ?? 0) + 1);
  }

  const stats = kept.filter((l) => !l.fromPrice);
  const medians: Medians = {
    districtEras: mediansBy(stats, districtEra),
    districts: mediansBy(stats, (l) => l.district),
    sectors: mediansBy(stats, (l) => l.sector),
  };

  const listings = kept.map((l): MapListing => {
    const p = position(l);
    const sharedPin = p !== null && pins.get(pinKey(p))! >= SHARED_PIN_COUNT;
    const wideCircle = l.id.startsWith('storia:') && (l.radiusM ?? 0) > MAX_CELL_RADIUS_M;
    const precise = p !== null && l.precise === true && !sharedPin && !wideCircle;
    // Storia's approximate pins are right to the neighbourhood, enough for a cell; other sites' are raw geocodes.
    const inCell = p !== null && !sharedPin && !wideCircle && (precise || l.id.startsWith('storia:'));
    const at: LngLat | null = p && [p.lng, p.lat];
    const basis = basisFor(l, medians);

    return {
      id: l.id,
      url: l.url,
      also: also.get(l.id) ?? [],
      title: l.title,
      total: l.total,
      ppm: l.ppm,
      m2: l.m2,
      rooms: l.rooms,
      floor: l.floor,
      year: l.year ?? null,
      lat: p?.lat ?? null,
      lng: p?.lng ?? null,
      precise,
      cell: inCell ? latLngToCell(p.lat, p.lng, H3_RESOLUTION) : null,
      district: l.district,
      sector: l.sector,
      metro: at && stations.length ? nearestPoint(at, stations) : null,
      park: at && parks.length ? nearestPolygon(at, parks) : null,
      isNewDev: l.isNewDev || l.market === 'primary',
      inStats: !l.fromPrice,
      delta: basis ? Math.round((l.ppm / basis.median - 1) * 100) : null,
      deltaBasis: basis?.kind ?? null,
      basisName: basis?.name ?? null,
      basisEra: basis?.era ?? null,
      // Left out when there is none, so 16 000 listings do not each carry an empty field.
      ...(priceDrop(l) !== null ? { priceDrop: priceDrop(l) } : {}),
    };
  });

  return {
    listings,
    meta: {
      updatedAt: sweepFinishedAt,
      total: listings.length,
      placed: listings.filter((l) => l.lat !== null).length,
      inCells: listings.filter((l) => l.cell !== null).length,
      skippedOutliers: ls.length - sane.length,
      merged: sane.length - kept.length,
    },
  };
}

function writeAtomically(path: string, data: unknown) {
  writeFileSync(`${path}.tmp`, JSON.stringify(data) + '\n');
  renameSync(`${path}.tmp`, path);
}

function count(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ' ');
}

export function runExport(
  store: Store,
  stations: Named[],
  parks: NamedPolygon[],
  boundaries: Boundaries,
  outDir: string,
  log: (line: string) => void,
  ...others: (Store | undefined)[]
): void {
  const sweep = store.lastCompleteSweep();
  if (!sweep) throw new Error('Nu există nicio colectare completă');
  // A source with no complete collection yet adds nothing.
  const extras = others.flatMap((o) => (o?.lastCompleteSweep() ? [o] : []));

  const ls = [store, ...extras].flatMap((s) => s.current());
  const updatedAt = [store, ...extras].map((s) => s.lastCompleteSweep()!.finishedAt).reduce((a, b) => (b < a ? b : a));
  const { listings, meta } = buildExport(ls, stations, parks, boundaries, updatedAt);
  mkdirSync(outDir, { recursive: true });
  writeAtomically(join(outDir, 'listings.json'), listings);
  writeAtomically(join(outDir, 'meta.json'), meta);
  log(
    `Export gata: ${count(meta.total)} anunțuri, ${count(meta.placed)} cu poziție, ` +
      `${count(meta.merged)} dubluri unite, ${count(meta.skippedOutliers)} prețuri aberante sărite.`,
  );
}
