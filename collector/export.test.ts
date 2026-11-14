import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getResolution } from 'h3-js';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildExport, runExport } from './export';
import type { Named, NamedPolygon } from './geo';
import { openStore, type Store, type StoredListing } from './store';

const stations: Named[] = [{ name: 'Piața Unirii', at: [26.1025, 44.4268] }];
const parks: NamedPolygon[] = [
  {
    name: 'Parcul Carol',
    ring: [
      [26.09, 44.41],
      [26.1, 44.41],
      [26.1, 44.42],
      [26.09, 44.42],
      [26.09, 44.41],
    ],
  },
];
const FINISHED = '2026-11-14T06:00:00.000Z';

// Each listing gets its own street, size and spot so none of them count as reposts of each other.
function stored(n: number, overrides: Partial<StoredListing> = {}): StoredListing {
  return {
    id: `storia:${n}`,
    url: `https://www.storia.ro/ro/oferta/apartament-${n}`,
    title: `Apartament ${n}`,
    total: 100000 + n * 1000,
    ppm: 2000,
    m2: 50 + n * 2,
    rooms: 2,
    floor: 3,
    street: `Strada ${n}`,
    district: 'Titan',
    sector: 'Sector 3',
    privateOwner: false,
    isNewDev: false,
    fromPrice: false,
    postedAt: '2026-11-01T10:00:00Z',
    firstSeen: '2026-11-01T08:00:00.000Z',
    hasDetail: true,
    lat: 44.42 + n * 0.001,
    lng: 26.12 + n * 0.001,
    precise: true,
    year: 1975,
    market: 'secondary',
    ...overrides,
  };
}

const many = (from: number, count: number, overrides: Partial<StoredListing> = {}) =>
  Array.from({ length: count }, (_, i) => stored(from + i, overrides));

const build = (ls: StoredListing[]) => buildExport(ls, stations, parks, FINISHED);
const byId = (r: ReturnType<typeof build>, id: string) => r.listings.find((l) => l.id === id)!;

test('two reposts come out as one listing whose also holds the other URL', () => {
  const a = stored(1, { firstSeen: '2026-11-01T08:00:00.000Z' });
  const b = { ...a, id: 'storia:99', url: 'https://www.storia.ro/ro/oferta/apartament-99', firstSeen: '2026-11-05T08:00:00.000Z' };
  const r = build([b, a]);
  expect(r.listings.map((l) => l.id)).toEqual(['storia:1']);
  expect(r.listings[0].also).toEqual(['https://www.storia.ro/ro/oferta/apartament-99']);
  expect(r.meta.merged).toBe(1);
});

test('a 100 €/m² listing is left out and counted as an outlier', () => {
  const r = build([stored(1), stored(2, { ppm: 100 })]);
  expect(r.listings.map((l) => l.id)).toEqual(['storia:1']);
  expect(r.meta.skippedOutliers).toBe(1);
});

test('a 15 001 €/m² listing is left out and counted as an outlier; 15 000 stays', () => {
  const r = build([stored(1, { ppm: 15000 }), stored(2, { ppm: 15001 })]);
  expect(r.listings.map((l) => l.id)).toEqual(['storia:1']);
  expect(r.meta.skippedOutliers).toBe(1);
});

test('a district with 15 listings is its own basis; one with 14 falls back to the sector', () => {
  const r = build([...many(1, 15, { district: 'Titan' }), ...many(101, 14, { district: 'Dristor' })]);
  expect(byId(r, 'storia:1')).toMatchObject({ deltaBasis: 'district', basisName: 'Titan' });
  expect(byId(r, 'storia:101')).toMatchObject({ deltaBasis: 'sector', basisName: 'Sector 3' });
});

test('a listing with neither district nor sector has no delta', () => {
  const r = build([stored(1, { district: null, sector: null })]);
  expect(byId(r, 'storia:1')).toMatchObject({ delta: null, deltaBasis: null, basisName: null });
});

test('a listing 10 % under its basis median has delta -10', () => {
  const r = build([...many(1, 15), stored(50, { ppm: 1800 })]);
  expect(byId(r, 'storia:50').delta).toBe(-10);
  expect(byId(r, 'storia:1').delta).toBe(0);
});

test('four listings on identical coordinates all lose precision, three keep it', () => {
  const four = build(many(1, 4, { lat: 44.4312345, lng: 26.1012345 }));
  for (const l of four.listings) expect(l).toMatchObject({ precise: false, cell: null });
  expect(four.listings[0].lat).toBe(44.4312345);

  // An agent's neighbourhood-centre pin: approximate Storia pins sharing it get no cell either.
  const mixed = build([...many(1, 2, { lat: 44.4312345, lng: 26.1012345 }), ...many(3, 2, { lat: 44.4312345, lng: 26.1012345, precise: false })]);
  for (const l of mixed.listings) expect(l).toMatchObject({ precise: false, cell: null });
  expect(mixed.meta.inCells).toBe(0);

  const three = build(many(1, 3, { lat: 44.4312345, lng: 26.1012345 }));
  for (const l of three.listings) {
    expect(l.precise).toBe(true);
    expect(getResolution(l.cell!)).toBe(8);
  }
});

test('an approximate Storia pin stays non-precise, gets a cell and counts in its district median', () => {
  const r = build([...many(1, 14), stored(50, { precise: false, ppm: 3000 })]);
  const approx = byId(r, 'storia:50');
  expect(approx).toMatchObject({ precise: false, deltaBasis: 'district' });
  expect(getResolution(approx.cell!)).toBe(8);
  expect(approx.metro?.name).toBe('Piața Unirii');
  expect(r.meta).toMatchObject({ placed: 15, inCells: 15 });
});

test('a fromPrice listing is out of stats and does not move the median', () => {
  // Counted, the 9000 would lift the sector median from 2100 to 2200.
  const r = build([stored(1), stored(2, { ppm: 2200 }), stored(50, { fromPrice: true, ppm: 9000 })]);
  expect(byId(r, 'storia:50').inStats).toBe(false);
  expect(byId(r, 'storia:1').delta).toBe(-5);
});

test('a fromPrice listing has no delta, so a "from" price never reads as under the median', () => {
  const r = build([...many(1, 15), stored(50, { fromPrice: true, ppm: 1500 })]);
  expect(byId(r, 'storia:50')).toMatchObject({ inStats: false, delta: null, deltaBasis: null, basisName: null });
});

test('a listing without detail has no position but counts toward medians', () => {
  const noDetail = { hasDetail: false, lat: undefined, lng: undefined, precise: undefined, year: undefined, market: undefined };
  const r = build([...many(1, 14), stored(50, noDetail)]);
  expect(byId(r, 'storia:50')).toMatchObject({
    lat: null, lng: null, precise: false, cell: null, metro: null, park: null, year: null, deltaBasis: 'district',
  });
  expect(r.meta).toEqual({ updatedAt: FINISHED, total: 15, placed: 14, inCells: 14, skippedOutliers: 0, merged: 0 });
});

test('a placed listing gets its nearest metro and park', () => {
  const l = byId(build([stored(1, { lat: 44.415, lng: 26.095 })]), 'storia:1');
  expect(l.park).toEqual({ name: 'Parcul Carol', minutes: 0 });
  expect(l.metro?.name).toBe('Piața Unirii');
});

// An Anuntul post: the site gives no neighbourhood names of its own.
const anuntul = (n: number, overrides: Partial<StoredListing> = {}) =>
  stored(n, { id: `anuntul:${n}`, url: `https://www.anuntul.ro/anunt-vanzare-apartament-${n}`, street: null, district: null, sector: null, ...overrides });

test('an approximate Anuntul pin gets no cell; a precise one does', () => {
  const r = build([anuntul(1, { precise: false }), anuntul(2)]);
  expect(byId(r, 'anuntul:1')).toMatchObject({ precise: false, cell: null });
  expect(byId(r, 'anuntul:1').lat).not.toBeNull();
  expect(getResolution(byId(r, 'anuntul:2').cell!)).toBe(8);
  expect(r.meta).toMatchObject({ placed: 2, inCells: 1 });
});

test('a Storia and an Anuntul post of the same flat merge into one listing with the other URL in also', () => {
  const s = stored(1, { firstSeen: '2026-11-01T08:00:00.000Z' });
  const a = anuntul(2, { m2: s.m2, total: s.total + 500, lat: s.lat! + 0.0001, lng: s.lng, firstSeen: '2026-11-03T08:00:00.000Z' });
  const r = build([a, s]);
  expect(r.listings.map((l) => l.id)).toEqual(['storia:1']);
  expect(r.listings[0].also).toEqual(['https://www.anuntul.ro/anunt-vanzare-apartament-2']);
  expect(r.meta.merged).toBe(1);
});

test('an Anuntul listing 200 m from a Storia listing takes its district and sector; one 2 km away keeps its own', () => {
  const s = stored(1, { lat: 44.42, lng: 26.12, district: 'Titan', sector: 'Sectorul 3' });
  const near = anuntul(2, { lat: 44.4218, lng: 26.12 });
  const far = anuntul(3, { lat: 44.438, lng: 26.12, district: 'Iancului', sector: 'Sectorul 2' });
  const unplaced = anuntul(4, { hasDetail: false, lat: undefined, lng: undefined, precise: undefined });
  const r = build([s, near, far, unplaced]);
  expect(byId(r, 'anuntul:2')).toMatchObject({ district: 'Titan', sector: 'Sectorul 3' });
  expect(byId(r, 'anuntul:3')).toMatchObject({ district: 'Iancului', sector: 'Sectorul 2' });
  expect(byId(r, 'anuntul:4')).toMatchObject({ district: null, sector: null });
});

test('the nearest Storia listing with a district wins', () => {
  const r = build([
    stored(1, { lat: 44.42, lng: 26.12, district: 'Titan', sector: 'Sectorul 3' }),
    stored(2, { lat: 44.4201, lng: 26.12, district: null, sector: 'Sectorul 4' }),
    stored(3, { lat: 44.423, lng: 26.12, district: 'Dristor', sector: 'Sectorul 3' }),
    anuntul(4, { lat: 44.4202, lng: 26.12 }),
  ]);
  expect(byId(r, 'anuntul:4')).toMatchObject({ district: 'Titan', sector: 'Sectorul 3' });
});

test('an imprecise Anuntul pin 200 m from a Storia listing keeps no district and leaves the median alone', () => {
  // Titan's median is 2080; counting the 9000 would lift it to 2085 and turn storia:1's -3 into -4.
  const titan = Array.from({ length: 15 }, (_, i) =>
    stored(i + 1, { lat: 44.42, lng: 26.12 + i * 0.0001, district: 'Titan', sector: 'Sectorul 3', ppm: 2010 + i * 10 }),
  );
  const r = build([...titan, anuntul(60, { lat: 44.4218, lng: 26.12, precise: false, ppm: 9000 })]);
  expect(byId(r, 'anuntul:60')).toMatchObject({ district: null, sector: null, delta: null, basisName: null });
  expect(byId(r, 'storia:1').delta).toBe(-3);
});

let store: Store;
let dir: string;
let lines: string[];

beforeEach(() => {
  store = openStore(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'export-'));
  lines = [];
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('export with no complete sweep throws and writes nothing', () => {
  expect(() => runExport(store, stations, parks, dir, (l) => lines.push(l))).toThrow('Nu există nicio colectare completă');
  expect(readdirSync(dir)).toEqual([]);
});

test('export writes listings.json and meta.json and logs a summary', () => {
  const id = store.startSweep();
  const { firstSeen, hasDetail, lat, lng, precise, year, market, ...search } = stored(1);
  store.saveSearchListings(id, [search, { ...search, id: 'storia:2', url: 'u2', ppm: 50 }]);
  store.finishSweep(id, true);

  runExport(store, stations, parks, dir, (l) => lines.push(l));

  expect(readdirSync(dir).sort()).toEqual(['listings.json', 'meta.json']);
  const listings = JSON.parse(readFileSync(join(dir, 'listings.json'), 'utf8'));
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  expect(listings.map((l: { id: string }) => l.id)).toEqual(['storia:1']);
  expect(meta).toMatchObject({ total: 1, placed: 0, inCells: 0, skippedOutliers: 1, merged: 0, updatedAt: store.lastCompleteSweep()!.finishedAt });
  expect(lines).toEqual(['Export gata: 1 anunțuri, 0 cu poziție, 0 dubluri unite, 1 prețuri aberante sărite.']);
});

function sweepInto(target: Store, ls: StoredListing[]) {
  const id = target.startSweep();
  target.saveSearchListings(id, ls.map(({ firstSeen, hasDetail, lat, lng, precise, year, market, ...search }) => search));
  target.finishSweep(id, true);
}

test('export reads both stores and dates the data by the older sweep', () => {
  const other = openStore(':memory:');
  try {
    sweepInto(other, [anuntul(2)]);
    sweepInto(store, [stored(1)]);

    runExport(store, stations, parks, dir, (l) => lines.push(l), other);

    const listings = JSON.parse(readFileSync(join(dir, 'listings.json'), 'utf8'));
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    expect(listings.map((l: { id: string }) => l.id).sort()).toEqual(['anuntul:2', 'storia:1']);
    expect(meta.updatedAt).toBe(other.lastCompleteSweep()!.finishedAt);
  } finally {
    other.close();
  }
});

test('export ignores a second store without a complete sweep', () => {
  const other = openStore(':memory:');
  try {
    const id = other.startSweep();
    other.saveSearchListings(id, [{ ...stored(2), id: 'anuntul:2' }]);
    sweepInto(store, [stored(1)]);

    runExport(store, stations, parks, dir, (l) => lines.push(l), other);

    const listings = JSON.parse(readFileSync(join(dir, 'listings.json'), 'utf8'));
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    expect(listings.map((l: { id: string }) => l.id)).toEqual(['storia:1']);
    expect(meta.updatedAt).toBe(store.lastCompleteSweep()!.finishedAt);
  } finally {
    other.close();
  }
});

test('export reads a third store too', () => {
  const second = openStore(':memory:');
  const third = openStore(':memory:');
  try {
    sweepInto(second, [anuntul(2)]);
    sweepInto(third, [{ ...anuntul(3), id: 'imobiliare:3' }]);
    sweepInto(store, [stored(1)]);

    runExport(store, stations, parks, dir, (l) => lines.push(l), second, third);

    const listings = JSON.parse(readFileSync(join(dir, 'listings.json'), 'utf8'));
    expect(listings.map((l: { id: string }) => l.id).sort()).toEqual(['anuntul:2', 'imobiliare:3', 'storia:1']);
  } finally {
    second.close();
    third.close();
  }
});
