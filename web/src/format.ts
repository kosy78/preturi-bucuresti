import type { MapListing } from '../../shared/types';
import { isUnusual, type Filters } from './logic';

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

// The sites give neighbourhood names without diacritics. Names stay as given in filters and links; only what is shown gets them back.
const PLACES: Record<string, string> = {
  'Aparatorii Patriei': 'Apărătorii Patriei', Aviatiei: 'Aviației', Baneasa: 'Băneasa', Brancusi: 'Brâncuși',
  'Bucurestii Noi': 'Bucureștii Noi', Cismigiu: 'Cișmigiu', Crangasi: 'Crângași', Damaroaia: 'Dămăroaia',
  Dorobanti: 'Dorobanți', Grivita: 'Grivița', Herastrau: 'Herăstrău', Mosilor: 'Moșilor', 'Piata Romana': 'Piața Romană',
  Pieptanari: 'Pieptănari', Primaverii: 'Primăverii', Salajan: 'Sălăjan', 'Stefan cel Mare': 'Ștefan cel Mare',
  Stirbei: 'Știrbei', Straulesti: 'Străulești', Vacaresti: 'Văcărești', Postavaru: 'Postăvaru',
};

export function placeName(name: string): string {
  return PLACES[name] ?? name;
}

// Sales noise that says nothing about the flat.
// Letter boundaries rather than \b, which treats ă, â, î, ș, ț as non-letters.
const NOISE = /(?<!\p{L})(de vanzare|de vânzare|vand|vând|vanzare|vânzare|super oferta|super ofertă|ocazie|oferta|ofertă)(?!\p{L})[!.]*/giu;

// Agents separate title parts with a pipe or a capital I. A lone " I " is more likely a Roman numeral ("etaj I"), so I counts only when it repeats.
// Titles typed in capitals are turned to sentence case, and sales words are dropped.
export function cleanTitle(title: string): string {
  const sep = (title.match(/\sI\s/g) ?? []).length >= 2 ? /\s+[|I]\s+/g : /\s+\|\s+/g;
  let t = title.replace(sep, ' · ');
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length > 6 && letters === letters.toUpperCase()) t = t.toLowerCase().replace(/^\s*\p{L}/u, (c) => c.toUpperCase());
  t = t.replace(NOISE, '').replace(/!+/g, '').replace(/\s*·\s*(·\s*)+/g, ' · ').replace(/\s+/g, ' ').replace(/^[\s·,:-]+|[\s·,:-]+$/g, '');
  return t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : title.trim();
}

export function deltaText(l: MapListing): string {
  if (l.delta === null || l.basisName === null) return '';
  // An era-specific comparison says so: an old block is compared with old blocks, a new one with new ones.
  const of = l.basisEra === 'vechi' ? `blocurilor vechi din ${placeName(l.basisName)}` : l.basisEra === 'nou' ? `blocurilor noi din ${placeName(l.basisName)}` : `din ${placeName(l.basisName)}`;
  if (l.delta < 0) return `${Math.abs(l.delta)}% sub mediana ${of}`;
  if (l.delta > 0) return `${l.delta}% peste mediana ${of}`;
  return `La mediana ${of}`;
}

// Tag style on the map: 'none' when there is no trustworthy comparison (no median, or a price too unusual to rank).
// 'deep' marks the strongest bargains (a quarter or more under the median) so value can be compared tag to tag.
export function tagTone(l: MapListing): 'deep' | 'under' | 'over' | 'near' | 'none' {
  if (l.delta === null || isUnusual(l)) return 'none';
  if (l.delta <= -25) return 'deep';
  return tone(l);
}

export function tagLabel(l: MapListing): string {
  const status = l.delta === null ? 'fără comparație cu zona' : isUnusual(l) ? 'preț neobișnuit' : deltaText(l);
  return `${eur(l.total)}, ${eurM2(l.ppm)}, ${status}`;
}

// The kind of flat the map colours are computed for, when the filters narrow it; null when they cover every flat.
export function kindLabel(f: Filters): string | null {
  const rooms = f.rooms.map((r) => (r === 4 ? '4+' : String(r)));
  const parts = [
    rooms.length > 0 && `${rooms.join(', ')} ${rooms.length === 1 && rooms[0] === '1' ? 'cameră' : 'camere'}`,
    f.minM2 !== null && `min. ${area(f.minM2)}`,
    f.minYear !== null && `după ${f.minYear}`,
    f.hideNewDev && 'fără ansambluri noi',
  ].filter((p): p is string => typeof p === 'string');
  return parts.length > 0 ? parts.join(', ') : null;
}

// One line naming the filters that are on, for the header once the filter panel has scrolled away. Null when none are on.
export function filterSummary(f: Filters): string | null {
  const rooms = f.rooms.map((r) => (r === 4 ? '4+' : String(r)));
  const parts = [
    f.maxTotal !== null && `max. ${eur(f.maxTotal)}`,
    f.maxPpm !== null && `max. ${eurM2(f.maxPpm)}`,
    rooms.length > 0 && `${rooms.join(', ')} ${rooms.length === 1 && rooms[0] === '1' ? 'cameră' : 'camere'}`,
    f.minM2 !== null && `min. ${area(f.minM2)}`,
    f.minYear !== null && `după ${f.minYear}`,
    f.hideNewDev && 'fără ansambluri noi',
    f.sector !== null && f.sector,
    f.district !== null && placeName(f.district),
    f.maxMetroMin !== null && `metrou ≤ ${minutes(f.maxMetroMin)}`,
    f.parkWithin15 && 'parc aproape',
  ].filter((p): p is string => typeof p === 'string');
  return parts.length > 0 ? parts.join(' · ') : null;
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
  return rest === 0 || rest >= 20 ? `${grouped(n)} de ${many}` : `${grouped(n)} ${many}`;
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

// Beyond these, straight-line estimates stop meaning much as walking times.
const FAR_METRO = 25;
const FAR_PARK = 20;

// Official park names can be long ("Parcul Regele Mihai I al României (Herăstrău)"); the name in brackets is the one people use.
export function parkName(name: string): string {
  const everyday = name.match(/\(([^)]+)\)\s*$/);
  return everyday ? `Parcul ${everyday[1]}` : name.replace(/\bAl\b/g, 'al');
}

export function walks(l: MapListing): string | null {
  const parts = [
    // Straight-line distance turned into walking time, so it is an estimate.
    l.metro && (l.metro.minutes > FAR_METRO ? `departe de metrou (peste ${FAR_METRO} min)` : `~${minutes(l.metro.minutes)} până la metrou ${l.metro.name}`),
    // A park farther than this is not "near" in any useful sense, so it is not named.
    l.park && l.park.minutes <= FAR_PARK && `~${minutes(l.park.minutes)} până la ${parkName(l.park.name)}`,
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
