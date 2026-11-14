import { expect, test } from 'vitest';
import { areaM2, metres, nearestPoint, nearestPolygon, walkMinutes, type LngLat } from './geo';

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
