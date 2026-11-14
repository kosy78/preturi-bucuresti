import { expect, test } from 'vitest';
import type { MapListing } from '../../shared/types';
import { cellStats, colourDomain, districtFitsSector, isUnusual, listFor, matchCount, matches, matchesKind, MIN_CELL_LISTINGS, NO_FILTERS, UNUSUAL_DELTA, type CellStat, type Filters } from './logic';

let next = 0;
function listing(overrides: Partial<MapListing> = {}): MapListing {
  next += 1;
  return {
    id: `storia:${next}`,
    url: `https://www.storia.ro/ro/oferta/apartament-${next}`,
    also: [],
    title: `Apartament ${next}`,
    total: 150000,
    ppm: 2500,
    m2: 60,
    rooms: 2,
    floor: 3,
    year: 1980,
    lat: 44.43,
    lng: 26.1,
    precise: true,
    cell: 'cellA',
    district: 'Titan',
    sector: 'Sectorul 3',
    metro: { name: 'Titan', minutes: 8 },
    park: { name: 'Parcul IOR', minutes: 6 },
    isNewDev: false,
    inStats: true,
    delta: 0,
    deltaBasis: 'district',
    basisName: 'Titan',
    ...overrides,
  };
}

function filters(overrides: Partial<Filters>): Filters {
  return { ...NO_FILTERS, ...overrides };
}

function cell(stats: ReturnType<typeof cellStats>, id: string) {
  const found = stats.find((s) => s.cell === id);
  if (!found) throw new Error(`no stats for ${id}`);
  return found;
}

test('no filters lets every listing through', () => {
  expect(matches(listing({ year: null, lat: null, lng: null, metro: null, park: null }), NO_FILTERS)).toBe(true);
});

test('a listing with unknown year fails when minYear is set', () => {
  const f = filters({ minYear: 1990 });
  expect(matches(listing({ year: null }), f)).toBe(false);
  expect(matchesKind(listing({ year: null }), f)).toBe(false);
  expect(matches(listing({ year: 1990 }), f)).toBe(true);
  expect(matches(listing({ year: 1989 }), f)).toBe(false);
});

test('a listing with no position fails when maxMetroMin or parkWithin15 is set', () => {
  const nowhere = listing({ lat: null, lng: null, precise: false, cell: null, metro: null, park: null });
  expect(matches(nowhere, filters({ maxMetroMin: 30 }))).toBe(false);
  expect(matches(nowhere, filters({ parkWithin15: true }))).toBe(false);
});

test('maxMetroMin and parkWithin15 compare walking minutes inclusively', () => {
  expect(matches(listing({ metro: { name: 'Titan', minutes: 10 } }), filters({ maxMetroMin: 10 }))).toBe(true);
  expect(matches(listing({ metro: { name: 'Titan', minutes: 11 } }), filters({ maxMetroMin: 10 }))).toBe(false);
  expect(matches(listing({ park: { name: 'IOR', minutes: 15 } }), filters({ parkWithin15: true }))).toBe(true);
  expect(matches(listing({ park: { name: 'IOR', minutes: 16 } }), filters({ parkWithin15: true }))).toBe(false);
});

test('price, size, new-development and district filters', () => {
  expect(matches(listing({ ppm: 2600 }), filters({ maxPpm: 2600 }))).toBe(true);
  expect(matches(listing({ ppm: 2601 }), filters({ maxPpm: 2600 }))).toBe(false);
  expect(matches(listing({ total: 200001 }), filters({ maxTotal: 200000 }))).toBe(false);
  expect(matches(listing({ m2: 49 }), filters({ minM2: 50 }))).toBe(false);
  expect(matches(listing({ isNewDev: true }), filters({ hideNewDev: true }))).toBe(false);
  expect(matches(listing({ district: 'Titan' }), filters({ district: 'Titan' }))).toBe(true);
  expect(matches(listing({ district: 'Dristor' }), filters({ district: 'Titan' }))).toBe(false);
});

test('rooms: [4] matches a 5-room listing', () => {
  expect(matches(listing({ rooms: 5 }), filters({ rooms: [4] }))).toBe(true);
  expect(matches(listing({ rooms: 3 }), filters({ rooms: [4] }))).toBe(false);
});

test('rooms: [1, 4] means one room, or four and more', () => {
  const f = filters({ rooms: [1, 4] });
  expect([1, 2, 3, 4, 7].map((rooms) => matches(listing({ rooms }), f))).toEqual([true, false, false, true, true]);
});

test('matchesKind ignores price, location and district filters', () => {
  const f = filters({ maxPpm: 1000, maxTotal: 1000, maxMetroMin: 1, parkWithin15: true, district: 'Dristor' });
  expect(matchesKind(listing({ metro: null, park: null }), f)).toBe(true);
  expect(matchesKind(listing({ rooms: 3 }), filters({ rooms: [2] }))).toBe(false);
  expect(matchesKind(listing({ m2: 40 }), filters({ minM2: 50 }))).toBe(false);
  expect(matchesKind(listing({ isNewDev: true }), filters({ hideNewDev: true }))).toBe(false);
});

test('cellStats colours a cell from listings with a cell, inStats and passing matchesKind', () => {
  const ls = [
    ...[2000, 2100, 2200, 2300].map((ppm) => listing({ ppm })),
    listing({ ppm: 2400, precise: false }),
    listing({ ppm: 9000, inStats: false }),
    listing({ ppm: 9000, precise: false, cell: null }),
    listing({ ppm: 9000, rooms: 3 }),
  ];
  const s = cell(cellStats(ls, filters({ rooms: [2] })), 'cellA');
  expect(s.n).toBe(5);
  expect(s.median).toBe(2200);
  expect(s.thin).toBe(false);
});

test('the median of an even count is the rounded mean of the middle two', () => {
  const ls = [2000, 2100, 2201, 2300, 2400, 2500].map((ppm) => listing({ ppm }));
  expect(cell(cellStats(ls, NO_FILTERS), 'cellA').median).toBe(2251);
});

test('a cell with fewer than MIN_CELL_LISTINGS is thin and has no median', () => {
  const ls = Array.from({ length: MIN_CELL_LISTINGS - 1 }, () => listing());
  ls.push(listing({ inStats: false }));
  const s = cell(cellStats(ls, NO_FILTERS), 'cellA');
  expect(s).toMatchObject({ n: MIN_CELL_LISTINGS - 1, thin: true, median: null });
});

test('every cell with a listing in it gets an entry, whatever the filters', () => {
  const ls = [listing({ cell: 'cellA' }), listing({ cell: 'cellB', rooms: 3 }), listing({ precise: false, cell: null })];
  const stats = cellStats(ls, filters({ rooms: [2] }));
  expect(stats.map((s) => s.cell).sort()).toEqual(['cellA', 'cellB']);
  expect(cell(stats, 'cellB')).toMatchObject({ n: 0, thin: true, median: null, faded: true });
});

test('a cell fades when none of its listings passes matches', () => {
  const ls = [listing({ cell: 'cellA', metro: { name: 'Titan', minutes: 25 } }), listing({ cell: 'cellB' })];
  const stats = cellStats(ls, filters({ maxMetroMin: 15 }));
  expect(cell(stats, 'cellA').faded).toBe(true);
  expect(cell(stats, 'cellB').faded).toBe(false);
});

test('maxTotal fades a cell whose every listing is over budget but leaves its median unchanged', () => {
  const ls = [2000, 2100, 2200, 2300, 2400].map((ppm) => listing({ ppm, total: 300000 }));
  const before = cell(cellStats(ls, NO_FILTERS), 'cellA');
  const after = cell(cellStats(ls, filters({ maxTotal: 200000 })), 'cellA');
  expect(before.faded).toBe(false);
  expect(after.faded).toBe(true);
  expect(after.median).toBe(before.median);
  expect(after.median).toBe(2200);
});

test('choosing rooms: [2] changes a mixed cell median to the 2-room median', () => {
  const ls = [
    ...[2000, 2100, 2200, 2300, 2400].map((ppm) => listing({ ppm, rooms: 2 })),
    ...[3000, 3100, 3200, 3300, 3400].map((ppm) => listing({ ppm, rooms: 3 })),
  ];
  expect(cell(cellStats(ls, NO_FILTERS), 'cellA').median).toBe(2700);
  expect(cell(cellStats(ls, filters({ rooms: [2] })), 'cellA').median).toBe(2200);
});

test('a cell takes the most common district of its listings', () => {
  const ls = [
    listing({ district: 'Dristor' }),
    listing({ district: 'Titan' }),
    listing({ district: 'Titan' }),
    listing({ district: null }),
    listing({ cell: 'cellB', district: null }),
  ];
  const stats = cellStats(ls, NO_FILTERS);
  expect(cell(stats, 'cellA').district).toBe('Titan');
  expect(cell(stats, 'cellB').district).toBeNull();
});

test('a chosen district fades cells of other districts but not its own', () => {
  const ls = [
    listing({ cell: 'cellA', district: 'Titan' }),
    listing({ cell: 'cellA', district: 'Titan' }),
    // Lies in Dristor but its cell is mostly Titan: the cell stays lit through it.
    listing({ cell: 'cellA', district: 'Dristor' }),
    listing({ cell: 'cellB', district: 'Dristor' }),
  ];
  const stats = cellStats(ls, filters({ district: 'Titan' }));
  expect(cell(stats, 'cellA').faded).toBe(false);
  expect(cell(stats, 'cellB').faded).toBe(true);

  const dristor = cellStats(ls, filters({ district: 'Dristor' }));
  expect(cell(dristor, 'cellA').faded).toBe(true);
  expect(cell(dristor, 'cellB').faded).toBe(false);
});

test('listFor keeps matching listings inside the bounds, boundary included', () => {
  const bounds: [number, number, number, number] = [26.0, 44.4, 26.2, 44.5];
  const inside = listing({ lng: 26.1, lat: 44.45 });
  const onEdge = listing({ lng: 26.2, lat: 44.4 });
  const outside = listing({ lng: 26.3, lat: 44.45 });
  const noPosition = listing({ lng: null, lat: null, precise: false, cell: null });
  const filteredOut = listing({ lng: 26.1, lat: 44.45, rooms: 3 });
  const imprecise = listing({ lng: 26.1, lat: 44.45, precise: false, cell: null });
  const result = listFor([inside, onEdge, outside, noPosition, filteredOut, imprecise], filters({ rooms: [2] }), bounds);
  expect(result.map((l) => l.id).sort()).toEqual([inside.id, onEdge.id, imprecise.id].sort());
});

test('listFor sorts by delta ascending with unknown delta last', () => {
  const ls = [listing({ delta: 5 }), listing({ delta: null }), listing({ delta: -12 }), listing({ delta: 0 })];
  const result = listFor(ls, NO_FILTERS, [26.0, 44.4, 26.2, 44.5]);
  expect(result.map((l) => l.delta)).toEqual([-12, 0, 5, null]);
});

test('isUnusual flags listings 40% or more under their median', () => {
  expect(UNUSUAL_DELTA).toBe(-40);
  expect(isUnusual(listing({ delta: -39 }))).toBe(false);
  expect(isUnusual(listing({ delta: -40 }))).toBe(true);
  expect(isUnusual(listing({ delta: -77 }))).toBe(true);
  expect(isUnusual(listing({ delta: null }))).toBe(false);
});

test('listFor puts unusual prices last, after plausible and unknown deltas', () => {
  const ls = [listing({ delta: -52 }), listing({ delta: null }), listing({ delta: 4 }), listing({ delta: -39 }), listing({ delta: -40 })];
  const result = listFor(ls, NO_FILTERS, [26.0, 44.4, 26.2, 44.5]);
  expect(result.map((l) => l.delta)).toEqual([-39, 4, null, -52, -40]);
});

test('a chosen sector keeps only listings in that sector', () => {
  expect(NO_FILTERS.sector).toBeNull();
  expect(matches(listing({ sector: 'Sectorul 3' }), filters({ sector: 'Sectorul 3' }))).toBe(true);
  expect(matches(listing({ sector: 'Sectorul 2' }), filters({ sector: 'Sectorul 3' }))).toBe(false);
  expect(matches(listing({ sector: null }), filters({ sector: 'Sectorul 3' }))).toBe(false);
});

test('a cell takes the most common sector of its listings and fades outside the chosen sector', () => {
  const ls = [
    listing({ cell: 'cellA', sector: 'Sectorul 3' }),
    listing({ cell: 'cellA', sector: 'Sectorul 3' }),
    // On the border: lies in Sectorul 2 but its cell is mostly Sectorul 3, and still lights it.
    listing({ cell: 'cellA', sector: 'Sectorul 2', rooms: 3 }),
    listing({ cell: 'cellB', sector: 'Sectorul 2' }),
  ];
  const s3 = cellStats(ls, filters({ sector: 'Sectorul 3' }));
  expect(cell(s3, 'cellA').sector).toBe('Sectorul 3');
  expect(cell(s3, 'cellA').faded).toBe(false);
  expect(cell(s3, 'cellB').faded).toBe(true);

  // Only the border listing passes the room filter, yet the cell is judged by its own majority sector.
  const s2 = cellStats(ls, filters({ sector: 'Sectorul 2', rooms: [3] }));
  expect(cell(s2, 'cellA').faded).toBe(true);
  expect(cellStats(ls, filters({ sector: 'Sectorul 3', rooms: [3] })).find((c) => c.cell === 'cellA')!.faded).toBe(false);
});

function stat(overrides: Partial<CellStat>): CellStat {
  return { cell: 'c', median: 2000, n: 10, thin: false, faded: false, inert: false, district: null, sector: 'Sectorul 3', ...overrides };
}

test('colourDomain is the fixed city range with no sector chosen', () => {
  expect(colourDomain([stat({ median: 1900 }), stat({ median: 2600 })], NO_FILTERS)).toEqual([1200, 4500]);
});

test('colourDomain spans the chosen sector\'s lit cells, rounded outward to 50', () => {
  const stats = [
    stat({ median: 1937 }),
    stat({ median: 2612 }),
    stat({ median: 2280 }),
    stat({ median: 900, faded: true, inert: true }),
    stat({ median: null, thin: true }),
    stat({ median: 5000, sector: 'Sectorul 1' }),
  ];
  expect(colourDomain(stats, filters({ sector: 'Sectorul 3' }))).toEqual([1900, 2650]);
});

test('colourDomain keeps a cell faded only by the selected district in the range', () => {
  const stats = [stat({ median: 1937, district: 'Titan' }), stat({ median: 2612, district: 'Dristor', faded: true })];
  expect(colourDomain(stats, filters({ sector: 'Sectorul 3', district: 'Titan' }))).toEqual([1900, 2650]);
});

test('colourDomain falls back to the fixed range with fewer than two cells or no spread', () => {
  const f = filters({ sector: 'Sectorul 3' });
  expect(colourDomain([stat({ median: 2000 })], f)).toEqual([1200, 4500]);
  expect(colourDomain([], f)).toEqual([1200, 4500]);
  expect(colourDomain([stat({ median: 2000 }), stat({ median: 2000 })], f)).toEqual([1200, 4500]);
});

test('districtFitsSector keeps a district only when it lies in the sector', () => {
  const ls = [
    listing({ district: 'Titan', sector: 'Sectorul 3' }),
    listing({ district: 'Titan', sector: 'Sectorul 3' }),
    listing({ district: 'Militari', sector: 'Sectorul 6' }),
  ];
  expect(districtFitsSector(ls, 'Titan', 'Sectorul 3')).toBe(true);
  expect(districtFitsSector(ls, 'Militari', 'Sectorul 3')).toBe(false);
  expect(districtFitsSector(ls, 'Nowhere', 'Sectorul 3')).toBe(false);
});

test('a cell faded only by the chosen district can still be clicked; other fades make it inert', () => {
  const ls = [
    listing({ cell: 'cellA', district: 'Titan', sector: 'Sectorul 3' }),
    listing({ cell: 'cellB', district: 'Dristor', sector: 'Sectorul 3' }),
    listing({ cell: 'cellC', district: 'Militari', sector: 'Sectorul 6' }),
    listing({ cell: 'cellD', district: 'Vitan', sector: 'Sectorul 3', rooms: 4 }),
  ];
  const stats = cellStats(ls, filters({ district: 'Titan', sector: 'Sectorul 3', rooms: [2] }));
  expect(cell(stats, 'cellA')).toMatchObject({ faded: false, inert: false });
  expect(cell(stats, 'cellB')).toMatchObject({ faded: true, inert: false });
  expect(cell(stats, 'cellC')).toMatchObject({ faded: true, inert: true });
  expect(cell(stats, 'cellD')).toMatchObject({ faded: true, inert: true });
});

test('matchCount counts only listings with a position, on both sides', () => {
  const ls = [
    listing({ rooms: 2 }),
    listing({ rooms: 3 }),
    listing({ rooms: 2, lat: null, lng: null }),
  ];
  expect(matchCount(ls, filters({ rooms: [2] }))).toEqual({ count: 1, total: 2 });
});
