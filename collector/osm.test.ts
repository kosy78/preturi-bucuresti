import { expect, test } from 'vitest';
import { sectorAt, within } from './geo';
import { loadBoundaries, toMetro, toParks, type OsmElement } from './osm';

const node = (id: number, name: string, lon: number, lat: number): OsmElement => ({
  type: 'node',
  id,
  lon,
  lat,
  tags: { station: 'subway', name },
});
const geom = (pts: [number, number][]) => pts.map(([lon, lat]) => ({ lon, lat }));

test('interchange nodes become one station at their average position', () => {
  const metro = toMetro([
    node(1, 'Piața Unirii 1', 26.1, 44.42),
    node(2, 'Piața Unirii 2', 26.102, 44.428),
    node(3, '1 Mai', 26.06, 44.47),
  ]);
  expect(metro.features.map((f) => [f.properties.name, f.geometry.coordinates])).toEqual([
    ['Piața Unirii', [26.101, 44.424]],
    ['1 Mai', [26.06, 44.47]],
  ]);
});

test('both directions of a line merge into one line, proposed routes are left out', () => {
  const route = (id: number, ref: string, ways: number[]): OsmElement => ({
    type: 'relation',
    id,
    tags: { type: 'route', route: 'subway', ref, colour: '#FFFF00' },
    members: ways.map((ref) => ({ type: 'way', ref, role: '', geometry: geom([[26 + ref / 100, 44.4], [26.5, 44.5]]) })),
  });
  const metro = toMetro([
    route(10, 'M1', [1, 2]),
    route(11, 'M1', [2, 3]),
    { type: 'relation', id: 12, tags: { type: 'proposed', route: 'subway', name: 'Extensie' }, members: [] },
  ]);
  expect(metro.features).toHaveLength(1);
  expect(metro.features[0].properties).toEqual({ kind: 'line', name: 'M1', colour: '#FFFF00' });
  expect(metro.features[0].geometry.coordinates).toHaveLength(3);
});

const big: [number, number][] = [[26.0, 44.4], [26.01, 44.4], [26.01, 44.41], [26.0, 44.41], [26.0, 44.4]];

test('a park split into several outer ways is stitched into one ring', () => {
  const parks = toParks([
    {
      type: 'relation',
      id: 1,
      tags: { leisure: 'park', name: 'Parcul Unirii' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: geom(big.slice(0, 3)) },
        { type: 'way', ref: 2, role: 'outer', geometry: geom(big.slice(2).reverse()) },
      ],
    },
  ]);
  expect(parks.features).toHaveLength(1);
  expect(parks.features[0].geometry.coordinates[0]).toEqual(big);
});

test('parks under a hectare are left out', () => {
  const tiny = geom([[26.0, 44.4], [26.0005, 44.4], [26.0005, 44.4005], [26.0, 44.4]]);
  const parks = toParks([
    { type: 'way', id: 1, tags: { leisure: 'park', name: 'Scuar' }, geometry: tiny },
    { type: 'way', id: 2, tags: { leisure: 'park', name: 'Parc' }, geometry: geom(big) },
  ]);
  expect(parks.features.map((f) => f.properties.name)).toEqual(['Parc']);
});

test('loadBoundaries reads the city and its six sectors from the site outlines', () => {
  const b = loadBoundaries();
  expect(b.sectors.map((s) => s.name)).toEqual(['Sectorul 1', 'Sectorul 2', 'Sectorul 3', 'Sectorul 4', 'Sectorul 5', 'Sectorul 6']);
  expect(sectorAt([26.0864, 44.4527], b)).toBe('Sectorul 1'); // Piața Victoriei
  expect(sectorAt([26.1712, 44.4186], b)).toBe('Sectorul 3'); // Parcul Titan
  expect(within(b.city, [26.0864, 44.4527])).toBe(true);
  expect(within(b.city, [26.0845, 44.5704])).toBe(false); // Otopeni, Ilfov
});
