import { expect, test } from 'vitest';
import { areaM2, metres, nearestPoint, nearestPolygon, sectorAt, walkMinutes, within, type LngLat } from './geo';

const UNIRII: LngLat = [26.1025, 44.4268];
const VICTORIEI: LngLat = [26.0864, 44.4527];

test('Piața Unirii to Piața Victoriei is a bit over 3 km', () => {
  const d = metres(UNIRII, VICTORIEI);
  expect(d).toBeGreaterThan(3000);
  expect(d).toBeLessThan(3300);
});

test('800 m of straight line is a 13-minute walk', () => {
  expect(walkMinutes(800)).toBe(13);
});

test('nearestPoint picks the closer station', () => {
  const stations = [
    { name: 'Piața Victoriei', at: VICTORIEI },
    { name: 'Piața Unirii', at: UNIRII },
  ];
  const near = nearestPoint([26.1, 44.43], stations);
  expect(near.name).toBe('Piața Unirii');
  expect(near.minutes).toBe(walkMinutes(metres([26.1, 44.43], UNIRII)));
});

const square: LngLat[] = [
  [26.0, 44.4],
  [26.01, 44.4],
  [26.01, 44.41],
  [26.0, 44.41],
  [26.0, 44.4],
];

test('a point inside a park is 0 minutes away', () => {
  expect(nearestPolygon([26.005, 44.405], [{ name: 'Parc', ring: square }])).toEqual({ name: 'Parc', minutes: 0 });
});

test('a point outside a park walks to its nearest vertex', () => {
  const p: LngLat = [26.02, 44.41];
  expect(nearestPolygon(p, [{ name: 'Parc', ring: square }])).toEqual({
    name: 'Parc',
    minutes: walkMinutes(metres(p, [26.01, 44.41])),
  });
});

test('areaM2 of a 0.01° square in Bucharest is about 88 hectares', () => {
  const ha = areaM2(square) / 10_000;
  expect(ha).toBeGreaterThan(85);
  expect(ha).toBeLessThan(92);
});

const box = (w: number, s: number, e: number, n: number): LngLat[] => [[w, s], [e, s], [e, n], [w, n], [w, s]];

test('within counts the outer ring and leaves out holes and other parts', () => {
  const area = [[box(26.0, 44.4, 26.1, 44.5), box(26.04, 44.44, 26.06, 44.46)], [box(26.2, 44.4, 26.3, 44.5)]];
  expect(within(area, [26.02, 44.42])).toBe(true);
  expect(within(area, [26.05, 44.45])).toBe(false);
  expect(within(area, [26.25, 44.45])).toBe(true);
  expect(within(area, [26.15, 44.45])).toBe(false);
});

test('sectorAt names the sector holding the point, or null in none', () => {
  const b = {
    city: [[box(26.0, 44.4, 26.2, 44.5)]],
    sectors: [
      { name: 'Sectorul 1', area: [[box(26.0, 44.4, 26.1, 44.5)]] },
      { name: 'Sectorul 2', area: [[box(26.1, 44.4, 26.2, 44.5)]] },
    ],
  };
  expect(sectorAt([26.05, 44.45], b)).toBe('Sectorul 1');
  expect(sectorAt([26.15, 44.45], b)).toBe('Sectorul 2');
  expect(sectorAt([26.25, 44.45], b)).toBeNull();
});
