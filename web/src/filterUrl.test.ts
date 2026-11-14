import { describe, expect, it } from 'vitest';
import { fromQuery, toQuery } from './filterUrl';
import { NO_FILTERS, type Filters } from './logic';

describe('filters in the query string', () => {
  it('gives an empty string for no filters', () => {
    expect(toQuery(NO_FILTERS)).toBe('');
    expect(fromQuery('')).toEqual(NO_FILTERS);
  });

  it('round-trips every filter', () => {
    const f: Filters = {
      maxTotal: 185_000, maxPpm: 2600, rooms: [2, 4], minM2: 55, minYear: 1990,
      maxMetroMin: 10, parkWithin15: true, hideNewDev: true, district: 'Drumul Taberei', sector: 'Sectorul 6',
    };
    const q = toQuery(f);
    expect(q).toBe('buget=185000&ppm=2600&camere=2,4&mp=55&an=1990&metrou=10&parc=1&fara-noi=1&cartier=Drumul%20Taberei&sector=6');
    expect(fromQuery(q)).toEqual(f);
    expect(fromQuery(`?${q}`)).toEqual(f);
  });

  it('ignores unknown parameters and garbage values', () => {
    expect(fromQuery('ref=share&utm=x&buget=abc&ppm=-5&camere=0,7,x&mp=1e3&an=1985&metrou=&parc=yes&cartier=%20')).toEqual(NO_FILTERS);
  });

  it('keeps the valid parts of a partly broken list', () => {
    expect(fromQuery('camere=3,x,1,3').rooms).toEqual([1, 3]);
  });

  it('clamps values to each slider and snaps them to its step', () => {
    expect(fromQuery('buget=1').maxTotal).toBe(40_000);
    expect(fromQuery('buget=187400').maxTotal).toBe(185_000);
    expect(fromQuery('buget=188000').maxTotal).toBe(190_000);
    expect(fromQuery('ppm=2649').maxPpm).toBe(2600);
    expect(fromQuery('mp=27').minM2).toBe(25);
  });

  it('reads a value at or past the no-limit end of a slider as no filter', () => {
    expect(fromQuery('buget=500000').maxTotal).toBeNull();
    expect(fromQuery('buget=9000000').maxTotal).toBeNull();
    expect(fromQuery('metrou=25').maxMetroMin).toBeNull();
    expect(fromQuery('metrou=900').maxMetroMin).toBeNull();
    expect(fromQuery('mp=20').minM2).toBeNull();
    expect(fromQuery('mp=3').minM2).toBeNull();
  });

  it('reads a sector from 1 to 6 and ignores anything else', () => {
    expect(fromQuery('sector=3').sector).toBe('Sectorul 3');
    expect(toQuery({ ...NO_FILTERS, sector: 'Sectorul 1' })).toBe('sector=1');
    for (const bad of ['0', '7', '3.5', 'x', '', '03a']) expect(fromQuery(`sector=${bad}`).sector).toBeNull();
  });
});
