import { NO_FILTERS, type Filters } from './logic';
import { fit, RANGES, type Range } from './sliders';

export const YEARS = [1977, 1990, 2010, 2020];

function int(v: string | null): number | null {
  if (v === null || !/^\d{1,7}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

function ranged(v: string | null, r: Range): number | null {
  const n = int(v);
  return n === null ? null : fit(n, r);
}

export function toQuery(f: Filters): string {
  const p: string[] = [];
  const add = (key: string, value: string) => p.push(`${key}=${encodeURIComponent(value)}`);
  if (f.maxTotal !== null) add('buget', String(f.maxTotal));
  if (f.maxPpm !== null) add('ppm', String(f.maxPpm));
  if (f.rooms.length > 0) p.push(`camere=${[...f.rooms].sort((a, b) => a - b).join(',')}`);
  if (f.minM2 !== null) add('mp', String(f.minM2));
  if (f.minYear !== null) add('an', String(f.minYear));
  if (f.maxMetroMin !== null) add('metrou', String(f.maxMetroMin));
  if (f.parkWithin15) add('parc', '1');
  if (f.hideNewDev) add('fara-noi', '1');
  if (f.district !== null) add('cartier', f.district);
  if (f.sector !== null) add('sector', f.sector.replace('Sectorul ', ''));
  return p.join('&');
}

export function fromQuery(q: string): Filters {
  const p = new URLSearchParams(q);
  const rooms = [...new Set((p.get('camere') ?? '').split(',').map(int))].filter((r): r is number => r !== null && r <= 4);
  const year = int(p.get('an'));
  const district = p.get('cartier')?.trim() || null;
  const sector = /^[1-6]$/.test(p.get('sector') ?? '') ? `Sectorul ${p.get('sector')}` : null;
  return {
    ...NO_FILTERS,
    maxTotal: ranged(p.get('buget'), RANGES.maxTotal),
    maxPpm: ranged(p.get('ppm'), RANGES.maxPpm),
    rooms: rooms.sort((a, b) => a - b),
    minM2: ranged(p.get('mp'), RANGES.minM2),
    minYear: year !== null && YEARS.includes(year) ? year : null,
    maxMetroMin: ranged(p.get('metrou'), RANGES.maxMetroMin),
    parkWithin15: p.get('parc') === '1',
    hideNewDev: p.get('fara-noi') === '1',
    district,
    sector,
  };
}
