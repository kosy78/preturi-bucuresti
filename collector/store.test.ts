import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Detail, SearchListing } from '../shared/types';
import { openStore, type Store } from './store';

function listing(n: number, overrides: Partial<SearchListing> = {}): SearchListing {
  return {
    id: `storia:${n}`,
    url: `https://www.storia.ro/ro/oferta/apartament-${n}`,
    title: `Apartament ${n}`,
    total: 120000,
    ppm: 2000,
    m2: 60,
    rooms: 2,
    floor: 3,
    street: 'Strada Lipscani',
    district: 'Centrul Vechi',
    sector: 'Sector 3',
    privateOwner: false,
    isNewDev: false,
    fromPrice: false,
    postedAt: '2026-11-01T10:00:00Z',
    ...overrides,
  };
}

const detail: Detail = { lat: 44.43, lng: 26.1, precise: true, year: 1935, market: 'secondary' };

function sweep(store: Store, ls: SearchListing[], ok = true): number {
  const id = store.startSweep();
  store.saveSearchListings(id, ls);
  store.finishSweep(id, ok);
  return id;
}

let store: Store;

beforeEach(() => {
  store = openStore(':memory:');
});

afterEach(() => {
  store.close();
  vi.useRealTimers();
});

test('saving the same listing in two sweeps keeps one row and the original firstSeen', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T08:00:00Z'));
  sweep(store, [listing(1)]);
  vi.setSystemTime(new Date('2026-11-12T08:00:00Z'));
  sweep(store, [listing(1)]);

  const rows = store.current();
  expect(rows).toHaveLength(1);
  expect(rows[0].firstSeen).toBe('2026-11-10T08:00:00.000Z');
});

test('a price change updates total and ppm', () => {
  sweep(store, [listing(1)]);
  sweep(store, [listing(1, { total: 110000, ppm: 1833 })]);

  const [row] = store.current();
  expect(row.total).toBe(110000);
  expect(row.ppm).toBe(1833);
});

test('current() returns every search field as saved', () => {
  const l = listing(1, { floor: null, street: null, privateOwner: true, isNewDev: true, fromPrice: true });
  sweep(store, [l]);

  const [row] = store.current();
  expect(row).toEqual({ ...l, firstSeen: expect.any(String), hasDetail: false });
});

test('current() excludes a listing missing from the last complete sweep', () => {
  sweep(store, [listing(1), listing(2)]);
  sweep(store, [listing(1)]);

  expect(store.current().map((r) => r.id)).toEqual(['storia:1']);
});

test('current() keeps the previous sweep while a newer one is unfinished', () => {
  const first = sweep(store, [listing(1), listing(2)]);
  const second = store.startSweep();
  store.saveSearchListings(second, [listing(1)]);

  expect(store.lastCompleteSweep()?.id).toBe(first);
  expect(store.current().map((r) => r.id).sort()).toEqual(['storia:1', 'storia:2']);
});

test('current() keeps the previous sweep when a newer one finished with ok: false', () => {
  const first = sweep(store, [listing(1), listing(2)]);
  sweep(store, [listing(1)], false);

  expect(store.lastCompleteSweep()?.id).toBe(first);
  expect(store.current().map((r) => r.id).sort()).toEqual(['storia:1', 'storia:2']);
});

test('with no complete sweep, current() is empty and lastCompleteSweep() is null', () => {
  sweep(store, [listing(1)], false);

  expect(store.lastCompleteSweep()).toBeNull();
  expect(store.current()).toEqual([]);
  expect(store.needingDetail(10)).toEqual([]);
});

test('lastCompleteSweep() reports when the sweep finished', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T06:30:00Z'));
  const id = sweep(store, [listing(1)]);

  expect(store.lastCompleteSweep()).toEqual({ id, finishedAt: '2026-11-14T06:30:00.000Z' });
});

test('needingDetail skips listings that already have a detail or were marked gone', () => {
  sweep(store, [listing(1), listing(2), listing(3)]);
  store.saveDetail('storia:1', detail);
  store.saveDetail('storia:2', null);

  expect(store.needingDetail(10)).toEqual([{ id: 'storia:3', url: listing(3).url }]);
});

test('needingDetail returns newest posted first, up to the limit', () => {
  sweep(store, [
    listing(1, { postedAt: '2026-11-01T10:00:00Z' }),
    listing(2, { postedAt: '2026-11-03T10:00:00Z' }),
    listing(3, { postedAt: '2026-11-02T10:00:00Z' }),
  ]);

  expect(store.needingDetail(2).map((l) => l.id)).toEqual(['storia:2', 'storia:3']);
});

test('needingDetail offers the priority sector first, then the rest newest first', () => {
  sweep(store, [
    listing(1, { postedAt: '2026-11-03T10:00:00Z', sector: 'Sectorul 2' }),
    listing(2, { postedAt: '2026-11-01T10:00:00Z', sector: 'Sectorul 1' }),
    listing(3, { postedAt: '2026-11-02T10:00:00Z', sector: 'Sectorul 1' }),
  ]);

  expect(store.needingDetail(10, 'Sectorul 1').map((l) => l.id)).toEqual(['storia:3', 'storia:2', 'storia:1']);
  expect(store.needingDetail(2, 'Sectorul 1').map((l) => l.id)).toEqual(['storia:3', 'storia:2']);
});

test('needingDetail only offers listings seen in the last complete sweep', () => {
  sweep(store, [listing(1), listing(2)]);
  sweep(store, [listing(1)]);

  expect(store.needingDetail(10).map((l) => l.id)).toEqual(['storia:1']);
});

test('a saved detail shows in current() and survives the listing reappearing', () => {
  sweep(store, [listing(1)]);
  store.saveDetail('storia:1', detail);
  sweep(store, [listing(1)]);

  const [row] = store.current();
  expect(row).toMatchObject({ ...detail, hasDetail: true });
});

test('a listing marked gone is excluded from current()', () => {
  sweep(store, [listing(1), listing(2)]);
  store.saveDetail('storia:2', null);

  expect(store.current().map((r) => r.id)).toEqual(['storia:1']);
});

test('opening a file store creates its directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-test-'));
  try {
    const path = join(dir, 'data', 'prices.sqlite');
    openStore(path).close();
    expect(existsSync(path)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a list year shows as year until a detail brings its own', () => {
  sweep(store, [listing(1, { year: 2024 }), listing(2, { year: 2024 }), listing(3)]);
  store.saveDetail('storia:2', detail);
  store.saveDetail('storia:3', { ...detail, year: null });
  const byId = new Map(store.current().map((r) => [r.id, r]));
  expect(byId.get('storia:1')).toMatchObject({ hasDetail: false, year: 2024 });
  expect(byId.get('storia:2')!.year).toBe(1935);
  expect(byId.get('storia:3')!.year).toBeNull();
});

test('a database created with the old schema opens, keeps its rows and stores a year', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-test-'));
  try {
    const path = join(dir, 'prices.sqlite');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE sweeps (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT, ok INTEGER);
      CREATE TABLE listings (
        id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, total REAL NOT NULL, ppm REAL NOT NULL, m2 REAL NOT NULL,
        rooms INTEGER NOT NULL, floor INTEGER, street TEXT, district TEXT, sector TEXT, private_owner INTEGER NOT NULL,
        is_new_dev INTEGER NOT NULL, from_price INTEGER NOT NULL, posted_at TEXT NOT NULL, first_seen TEXT NOT NULL,
        last_sweep INTEGER NOT NULL REFERENCES sweeps(id), complete_sweep INTEGER REFERENCES sweeps(id),
        detail_state TEXT, lat REAL, lng REAL, precise INTEGER, year INTEGER, market TEXT
      );
      INSERT INTO sweeps (started_at, finished_at, ok) VALUES ('2026-11-14T06:00:00Z', '2026-11-14T07:00:00Z', 1);
      INSERT INTO listings (id, url, title, total, ppm, m2, rooms, private_owner, is_new_dev, from_price, posted_at, first_seen, last_sweep, complete_sweep)
        VALUES ('storia:7', 'u7', 'Apartament 7', 100000, 2000, 50, 2, 0, 0, 0, '2026-11-01T10:00:00Z', '2026-11-01T08:00:00Z', 1, 1);
    `);
    old.close();

    const migrated = openStore(path);
    expect(migrated.current().map((r) => r.id)).toEqual(['storia:7']);
    sweep(migrated, [listing(8, { year: 1977 })]);
    expect(migrated.current().map((r) => [r.id, r.year])).toEqual([['storia:8', 1977]]);
    migrated.close();

    const again = openStore(path);
    expect(again.current().map((r) => [r.id, r.year])).toEqual([['storia:8', 1977]]);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
