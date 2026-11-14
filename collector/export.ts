import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gridDisk, latLngToCell } from 'h3-js';
import { H3_RESOLUTION, type MapListing, type Meta } from '../shared/types';
import { mergeReposts } from './dedupe';
import { metres, nearestPoint, nearestPolygon, type LngLat, type Named, type NamedPolygon } from './geo';
import type { Store, StoredListing } from './store';

const MIN_PPM = 400;
const MAX_PPM = 15000;
const MIN_DISTRICT_SAMPLE = 15;
const SHARED_PIN_COUNT = 4;
const NEIGHBOUR_M = 600;
// Resolution 7 cells are ~1.2 km across, so a cell and its ring hold every point within 600 m.
const NEIGHBOUR_CELL_RESOLUTION = 7;

const position = (l: StoredListing) => (l.hasDetail && l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null);
const pinKey = (p: { lat: number; lng: number }) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mediansBy(ls: StoredListing[], key: 'district' | 'sector') {
  const groups = new Map<string, number[]>();
  for (const l of ls) {
    const name = l[key];
    if (name === null) continue;
    const ppms = groups.get(name);
    if (ppms) ppms.push(l.ppm);
    else groups.set(name, [l.ppm]);
  }
  return new Map([...groups].map(([name, ppms]) => [name, { median: median(ppms), count: ppms.length }]));
}

// Each site names neighbourhoods its own way, which would split the medians; Storia's names win.
function withStoriaPlaces(ls: StoredListing[]): StoredListing[] {
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

  return ls.map((l) => {
    const p = position(l);
    // A geocoded pin can sit kilometres off; it would borrow the wrong neighbourhood.
    if (!p || l.precise !== true || l.id.startsWith('storia:')) return l;
    let nearest: StoredListing | null = null;
    let best = NEIGHBOUR_M;
    for (const cell of gridDisk(cellOf(p), 1)) {
      for (const { at, l: s } of storia.get(cell) ?? []) {
        const m = metres([p.lng, p.lat], at);
        if (m <= best) [nearest, best] = [s, m];
      }
    }
    return nearest ? { ...l, district: nearest.district, sector: nearest.sector } : l;
  });
}

export function buildExport(
  ls: StoredListing[],
  stations: Named[],
  parks: NamedPolygon[],
  sweepFinishedAt: string,
): { listings: MapListing[]; meta: Meta } {
  const sane = ls.filter((l) => l.ppm >= MIN_PPM && l.ppm <= MAX_PPM);
  const { kept, also } = mergeReposts(withStoriaPlaces(sane));

  // Agents often drop the pin on a neighbourhood centre or their usual spot rather than the building.
  const pins = new Map<string, number>();
  for (const l of kept) {
    const p = position(l);
    if (p) pins.set(pinKey(p), (pins.get(pinKey(p)) ?? 0) + 1);
  }

  const stats = kept.filter((l) => !l.fromPrice);
  const districts = mediansBy(stats, 'district');
  const sectors = mediansBy(stats, 'sector');

  const listings = kept.map((l): MapListing => {
    const p = position(l);
    const sharedPin = p !== null && pins.get(pinKey(p))! >= SHARED_PIN_COUNT;
    const precise = p !== null && l.precise === true && !sharedPin;
    // Storia's approximate pins are right to the neighbourhood, enough for a cell; other sites' are raw geocodes.
    const inCell = p !== null && !sharedPin && (precise || l.id.startsWith('storia:'));
    const at: LngLat | null = p && [p.lng, p.lat];

    const district = l.district !== null ? districts.get(l.district) : undefined;
    const sector = l.sector !== null ? sectors.get(l.sector) : undefined;
    const basis = l.fromPrice
      ? null
      : district && district.count >= MIN_DISTRICT_SAMPLE
        ? { kind: 'district' as const, name: l.district, median: district.median }
        : sector
          ? { kind: 'sector' as const, name: l.sector, median: sector.median }
          : null;

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
      isNewDev: l.isNewDev,
      inStats: !l.fromPrice,
      delta: basis ? Math.round((l.ppm / basis.median - 1) * 100) : null,
      deltaBasis: basis?.kind ?? null,
      basisName: basis?.name ?? null,
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
  const { listings, meta } = buildExport(ls, stations, parks, updatedAt);
  mkdirSync(outDir, { recursive: true });
  writeAtomically(join(outDir, 'listings.json'), listings);
  writeAtomically(join(outDir, 'meta.json'), meta);
  log(
    `Export gata: ${count(meta.total)} anunțuri, ${count(meta.placed)} cu poziție, ` +
      `${count(meta.merged)} dubluri unite, ${count(meta.skippedOutliers)} prețuri aberante sărite.`,
  );
}
