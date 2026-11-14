import type { MapListing } from '../../shared/types';
import { isUnusual } from './logic';

// Narrow no-break space between digit groups and a no-break space before the unit keep a price on one line.
const GROUP = ' ';
const NBSP = ' ';

export function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
}

export function eur(n: number): string {
  return `${grouped(n)}${NBSP}€`;
}

export function eurM2(n: number): string {
  return `${grouped(n)}${NBSP}€/m²`;
}

export function area(n: number): string {
  return `${grouped(n)}${NBSP}m²`;
}

export function minutes(n: number): string {
  return `${n}${NBSP}min`;
}

export function thousands(n: number): string {
  if (n < 1000) return String(n);
  if (n < 999_500) return `${Math.round(n / 1000)}k`;
  return `${String(Math.round(n / 10_000) / 100).replace('.', ',')}M`;
}

export function deltaText(l: MapListing): string {
  if (l.delta === null) return '';
  if (l.delta < 0) return `${Math.abs(l.delta)}% sub mediana din ${l.basisName}`;
  if (l.delta > 0) return `${l.delta}% peste mediana din ${l.basisName}`;
  return `La mediana din ${l.basisName}`;
}

export function tone(l: MapListing): 'under' | 'over' | 'near' {
  if (isUnusual(l)) return 'near';
  if (l.delta !== null && l.delta <= -5) return 'under';
  if (l.delta !== null && l.delta >= 5) return 'over';
  return 'near';
}

// Romanian puts "de" between a number and its noun from 20 on, except when the last two digits are 01–19.
export function plural(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const rest = n % 100;
  return rest === 0 || rest >= 20 ? `${n} de ${many}` : `${n} ${many}`;
}

export function facts(l: MapListing): string {
  const m2 = String(Math.round(l.m2 * 10) / 10).replace('.', ',');
  return [
    l.rooms === 1 ? 'Garsonieră' : `${l.rooms} camere`,
    `${m2}${NBSP}m²`,
    l.floor === null ? null : l.floor === 0 ? 'parter' : `etaj ${l.floor}`,
    l.year === null ? null : String(l.year),
  ]
    .filter((part) => part !== null)
    .join(', ');
}

export function walks(l: MapListing): string | null {
  const parts = [
    l.metro && `${minutes(l.metro.minutes)} până la metrou ${l.metro.name}`,
    l.park && `${minutes(l.park.minutes)} până la ${l.park.name}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

const SITES: Record<string, string> = { storia: 'Storia', anuntul: 'Anuntul.ro' };

export function sourceName(id: string): string {
  return SITES[id.slice(0, id.indexOf(':'))] ?? 'site';
}

// Links come from third-party pages, so anything that is not a plain web address is dropped.
export function siteName(url: string): string | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    host = u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (host === 'storia.ro') return SITES.storia;
  if (host === 'anuntul.ro') return SITES.anuntul;
  return host;
}
