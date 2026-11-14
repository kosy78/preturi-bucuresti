import { expect, test } from 'vitest';
import { mergeReposts } from './dedupe';
import type { StoredListing } from './store';

function stored(n: number, overrides: Partial<StoredListing> = {}): StoredListing {
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
    firstSeen: `2026-11-${String(n).padStart(2, '0')}T08:00:00.000Z`,
    hasDetail: true,
    lat: 44.43,
    lng: 26.1,
    precise: true,
    year: 1970,
    market: 'secondary',
    ...overrides,
  };
}

test('two reposts merge into the earliest and the survivor lists the other URL', () => {
  const { kept, also } = mergeReposts([stored(2, { lat: 44.4302 }), stored(1, { m2: 60.5, total: 122000 })]);
  expect(kept.map((l) => l.id)).toEqual(['storia:1']);
  expect(also.get('storia:1')).toEqual(['https://www.storia.ro/ro/oferta/apartament-2']);
});

test('a 5 % price gap does not merge', () => {
  const { kept } = mergeReposts([stored(1), stored(2, { total: 126000 })]);
  expect(kept).toHaveLength(2);
});

test('precise posts more than 50 m apart do not merge', () => {
  const { kept } = mergeReposts([stored(1), stored(2, { lat: 44.4306 })]);
  expect(kept).toHaveLength(2);
});

test('different floors do not merge; an unknown floor on either side does not stop a merge', () => {
  expect(mergeReposts([stored(1), stored(2, { floor: 4 })]).kept).toHaveLength(2);
  expect(mergeReposts([stored(1, { floor: null }), stored(2, { floor: null })]).kept).toHaveLength(1);
  expect(mergeReposts([stored(1), stored(2, { floor: null })]).kept).toHaveLength(1);
  expect(mergeReposts([stored(1, { floor: null }), stored(2)]).kept).toHaveLength(1);
});

test('non-precise posts merge on the same street and district', () => {
  const approx = { precise: false, lat: 44.4, lng: 26.0 };
  expect(mergeReposts([stored(1, approx), stored(2, { ...approx, lat: 44.5 })]).kept).toHaveLength(1);
  expect(mergeReposts([stored(1, approx), stored(2, { ...approx, street: 'Strada Smârdan' })]).kept).toHaveLength(2);
});

test('a precise and an approximate post merge on the same street and district, even far apart', () => {
  const approx = { precise: false, lat: 44.45, lng: 26.0 };
  expect(mergeReposts([stored(1), stored(2, approx)]).kept).toHaveLength(1);
  expect(mergeReposts([stored(1), stored(2, { ...approx, district: 'Lipscani' })]).kept).toHaveLength(2);
});

test('a precise and an approximate post on different streets merge within 150 m, not beyond', () => {
  const other = { precise: false, street: 'Strada Smârdan' };
  // 0.001° of latitude is about 111 m, 0.0015° about 167 m.
  expect(mergeReposts([stored(1), stored(2, { ...other, lat: 44.431 })]).kept).toHaveLength(1);
  expect(mergeReposts([stored(1), stored(2, { ...other, lat: 44.4315 })]).kept).toHaveLength(2);
  expect(mergeReposts([stored(1), stored(2, { ...other, hasDetail: false, lat: undefined, lng: undefined, precise: undefined })]).kept).toHaveLength(2);
});

test('the same decimal size, price and known floor in one sector is one flat whatever the street', () => {
  const exact = { m2: 63.47, total: 120000, precise: false, lat: undefined, lng: undefined };
  expect(mergeReposts([stored(1, exact), stored(2, { ...exact, street: 'Bulevardul Unirii' })]).kept).toHaveLength(1);
  // A different neighbourhood is a different flat, even at the same decimal size and price.
  expect(mergeReposts([stored(1, exact), stored(2, { ...exact, street: 'Bulevardul Unirii', district: 'Titan' })]).kept).toHaveLength(2);
  // Whole metres are too common to tell flats apart.
  expect(mergeReposts([stored(1, { ...exact, m2: 63 }), stored(2, { ...exact, m2: 63, street: 'Bulevardul Unirii' })]).kept).toHaveLength(2);
  expect(mergeReposts([stored(1, exact), stored(2, { ...exact, total: 120500, street: 'Bulevardul Unirii' })]).kept).toHaveLength(2);
  expect(mergeReposts([stored(1, { ...exact, floor: null }), stored(2, { ...exact, floor: null, street: 'Bulevardul Unirii' })]).kept).toHaveLength(2);
  expect(mergeReposts([stored(1, exact), stored(2, { ...exact, sector: 'Sector 2', street: 'Bulevardul Unirii' })]).kept).toHaveLength(2);
});

test('posts sized either side of a whole metre still merge', () => {
  const { kept } = mergeReposts([stored(1, { m2: 59.6 }), stored(2, { m2: 60.4 })]);
  expect(kept).toHaveLength(1);
});

test('three matching posts all merge into the earliest', () => {
  const { kept, also } = mergeReposts([stored(3), stored(1), stored(2)]);
  expect(kept.map((l) => l.id)).toEqual(['storia:1']);
  expect(also.get('storia:1')?.sort()).toEqual([
    'https://www.storia.ro/ro/oferta/apartament-2',
    'https://www.storia.ro/ro/oferta/apartament-3',
  ]);
});

test('a chain of small steps does not join posts whose ends differ: A~B and B~C but not A~C keeps C apart', () => {
  const { kept, also } = mergeReposts([stored(1), stored(2, { total: 123000 }), stored(3, { total: 126500 })]);
  expect(kept.map((l) => l.id)).toEqual(['storia:1', 'storia:3']);
  expect(also.get('storia:1')).toEqual(['https://www.storia.ro/ro/oferta/apartament-2']);
  expect(also.has('storia:3')).toBe(false);
});

test('the earliest matching group wins when a post matches two', () => {
  // storia:2 and storia:3 differ by more than 3 %, so they form two groups; storia:4 sits between and matches both.
  const { also } = mergeReposts([stored(2, { total: 118000 }), stored(3, { total: 122000, m2: 61 }), stored(4, { total: 120000, m2: 60.5 })]);
  expect(also.get('storia:2')).toEqual(['https://www.storia.ro/ro/oferta/apartament-4']);
  expect(also.has('storia:3')).toBe(false);
});

test('25 000 posts merge in well under a second', () => {
  const many = Array.from({ length: 25000 }, (_, i) =>
    stored((i % 28) + 1, { id: `storia:${i}`, sector: `Sector ${(i % 6) + 1}`, m2: 30 + (i % 900) / 10, total: 50000 + i * 7, lat: 44.4 + (i % 500) / 5000 }),
  );
  const started = performance.now();
  mergeReposts(many);
  expect(performance.now() - started).toBeLessThan(1000);
});

test('a group anchored on a post without a floor does not collect flats from different floors', () => {
  const noFloor = stored(1, { floor: null, lat: null, lng: null, precise: false });
  const second = stored(2, { floor: 2, lat: null, lng: null, precise: false });
  const fifth = stored(3, { floor: 5, lat: null, lng: null, precise: false });
  const { kept } = mergeReposts([noFloor, second, fifth]);
  // The no-floor post may take one of them, but floors 2 and 5 never end up in the same group.
  expect(kept.map((l) => l.id)).toContain(fifth.id);
  expect(kept).toHaveLength(2);
});

test('the exact-size rule needs the same neighbourhood and pins that are not far apart', () => {
  const exact = { m2: 48.8, total: 100000, floor: 5, street: null };
  const a = stored(1, { ...exact, district: 'IMGB', lat: 44.37, lng: 26.15 });
  const otherDistrict = stored(2, { ...exact, district: 'Aparatorii Patriei', lat: 44.38, lng: 26.15 });
  const farPin = stored(3, { ...exact, district: 'IMGB', lat: 44.39, lng: 26.15 });
  const near = stored(4, { ...exact, district: 'IMGB', lat: 44.3705, lng: 26.15 });
  const { kept } = mergeReposts([a, otherDistrict, farPin, near]);
  expect(kept.map((l) => l.id).sort()).toEqual([a.id, otherDistrict.id, farPin.id].sort());
});
