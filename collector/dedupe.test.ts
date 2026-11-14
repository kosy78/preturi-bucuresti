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

test('different floors do not merge, two unknown floors do', () => {
  expect(mergeReposts([stored(1), stored(2, { floor: 4 })]).kept).toHaveLength(2);
  expect(mergeReposts([stored(1, { floor: null }), stored(2, { floor: null })]).kept).toHaveLength(1);
});

test('non-precise posts merge on the same street and district', () => {
  const approx = { precise: false, lat: 44.4, lng: 26.0 };
  expect(mergeReposts([stored(1, approx), stored(2, { ...approx, lat: 44.5 })]).kept).toHaveLength(1);
  expect(mergeReposts([stored(1, approx), stored(2, { ...approx, street: 'Strada Smârdan' })]).kept).toHaveLength(2);
});

test('a precise post does not merge with a non-precise one', () => {
  const { kept } = mergeReposts([stored(1), stored(2, { precise: false })]);
  expect(kept).toHaveLength(2);
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
