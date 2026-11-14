import { expect, test } from 'vitest';
import type { MapListing } from '../../shared/types';
import { deltaText, eur, eurM2, facts, grouped, plural, siteName, sourceName, thousands, tone, walks } from './format';

const NNBSP = ' ';
const NBSP = ' ';

test('eur groups thousands with a narrow no-break space and never wraps before €', () => {
  expect(eur(185000)).toBe(`185${NNBSP}000${NBSP}€`);
  expect(eur(1250000)).toBe(`1${NNBSP}250${NNBSP}000${NBSP}€`);
  expect(eur(950)).toBe(`950${NBSP}€`);
});

test('eurM2 prints a price per square metre', () => {
  expect(eurM2(2600)).toBe(`2${NNBSP}600${NBSP}€/m²`);
});

test('thousands shortens to k and M with a Romanian decimal comma', () => {
  expect(thousands(185000)).toBe('185k');
  expect(thousands(1250000)).toBe('1,25M');
  expect(thousands(2000000)).toBe('2M');
  expect(thousands(1500000)).toBe('1,5M');
  expect(thousands(1234567)).toBe('1,23M');
  expect(thousands(950)).toBe('950');
});

function withDelta(delta: number | null, basisName: string | null): MapListing {
  return { delta, basisName } as MapListing;
}

test('deltaText says how far a listing is from its basis median', () => {
  expect(deltaText(withDelta(-12, 'Titan'))).toBe('12% sub mediana din Titan');
  expect(deltaText(withDelta(8, 'Sectorul 3'))).toBe('8% peste mediana din Sectorul 3');
  expect(deltaText(withDelta(0, 'Titan'))).toBe('La mediana din Titan');
  expect(deltaText(withDelta(null, null))).toBe('');
});

function listing(patch: Partial<MapListing>): MapListing {
  return { rooms: 2, m2: 54, floor: 3, year: 1982, metro: null, park: null, ...patch } as MapListing;
}

test('facts lists rooms, area, floor and year, leaving out what is unknown', () => {
  expect(facts(listing({}))).toBe(`2 camere, 54${NBSP}m², etaj 3, 1982`);
  expect(facts(listing({ rooms: 1, floor: 0 }))).toBe(`Garsonieră, 54${NBSP}m², parter, 1982`);
  expect(facts(listing({ floor: null, year: null }))).toBe(`2 camere, 54${NBSP}m²`);
  expect(facts(listing({ m2: 67.52, year: null }))).toBe(`2 camere, 67,5${NBSP}m², etaj 3`);
});

test('walks names the metro and the park, or only the one that is known', () => {
  const metro = { name: 'Titan', minutes: 7 };
  const park = { name: 'Parcul IOR', minutes: 4 };
  expect(walks(listing({ metro, park }))).toBe(`7${NBSP}min până la metrou Titan, 4${NBSP}min până la Parcul IOR`);
  expect(walks(listing({ park }))).toBe(`4${NBSP}min până la Parcul IOR`);
  expect(walks(listing({ metro }))).toBe(`7${NBSP}min până la metrou Titan`);
  expect(walks(listing({}))).toBeNull();
});

test('plural uses the singular for one and adds "de" from twenty on', () => {
  expect(plural(1, 'anunț', 'anunțuri')).toBe('1 anunț');
  expect(plural(3, 'anunț', 'anunțuri')).toBe('3 anunțuri');
  expect(plural(19, 'anunț', 'anunțuri')).toBe('19 anunțuri');
  expect(plural(20, 'anunț', 'anunțuri')).toBe('20 de anunțuri');
  expect(plural(101, 'anunț', 'anunțuri')).toBe('101 anunțuri');
  expect(plural(100, 'anunț', 'anunțuri')).toBe('100 de anunțuri');
});

test('sourceName reads the site from the listing id', () => {
  expect(sourceName('storia:10733327')).toBe('Storia');
  expect(sourceName('anuntul:65762551')).toBe('Anuntul.ro');
});

test('siteName labels a link by its host and drops anything that is not a web address', () => {
  expect(siteName('https://www.storia.ro/ro/oferta/abc')).toBe('Storia');
  expect(siteName('https://www.anuntul.ro/anunt-vanzare-x')).toBe('Anuntul.ro');
  expect(siteName('https://imobiliare.ro/x')).toBe('imobiliare.ro');
  expect(siteName('javascript:alert(1)')).toBeNull();
  expect(siteName('not a url')).toBeNull();
});

test('grouped groups thousands with a narrow no-break space', () => {
  expect(grouped(2943)).toBe(`2${NNBSP}943`);
  expect(grouped(16488)).toBe(`16${NNBSP}488`);
  expect(grouped(12)).toBe('12');
});

test('tone keeps unusual prices neutral instead of green', () => {
  expect(tone({ delta: -12 } as MapListing)).toBe('under');
  expect(tone({ delta: -40 } as MapListing)).toBe('near');
  expect(tone({ delta: 8 } as MapListing)).toBe('over');
  expect(tone({ delta: null } as MapListing)).toBe('near');
});
