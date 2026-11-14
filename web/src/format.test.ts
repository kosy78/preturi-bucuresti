import { expect, test } from 'vitest';
import type { MapListing } from '../../shared/types';
import { cleanTitle, filterSummary, kindLabel, parkName, deltaText, tagTone, eur, eurM2, facts, grouped, plural, siteName, sourceName, thousands, placeName, tone, walks } from './format';

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
  expect(walks(listing({ metro, park }))).toBe(`~7${NBSP}min până la metrou Titan, ~4${NBSP}min până la Parcul IOR`);
  expect(walks(listing({ park }))).toBe(`~4${NBSP}min până la Parcul IOR`);
  expect(walks(listing({ metro }))).toBe(`~7${NBSP}min până la metrou Titan`);
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

test('placeName restores diacritics and leaves unknown names alone', () => {
  expect(placeName('Baneasa')).toBe('Băneasa');
  expect(placeName('Stefan cel Mare')).toBe('Ștefan cel Mare');
  expect(placeName('Titan')).toBe('Titan');
});

test('cleanTitle turns agent separators into middle dots', () => {
  expect(cleanTitle('Apartament 3 camere I Baneasa I Parcare')).toBe('Apartament 3 camere · Baneasa · Parcare');
  expect(cleanTitle('Bloc nou  |  metrou')).toBe('Bloc nou · metrou');
  expect(cleanTitle('Etaj I din IV, bloc I')).toBe('Etaj I din IV, bloc I');
});


test('tagTone separates prices without a trustworthy comparison from those near the median', () => {
  expect(tagTone(listing({ delta: -20 }))).toBe('under');
  expect(tagTone(listing({ delta: -30 }))).toBe('deep');
  expect(tagTone(listing({ delta: 2 }))).toBe('near');
  expect(tagTone(listing({ delta: 12 }))).toBe('over');
  expect(tagTone(listing({ delta: null }))).toBe('none');
  expect(tagTone(listing({ delta: -60 }))).toBe('none');
});

test('filterSummary lists only the filters that are on, and nothing when none are', () => {
  const none = { maxPpm: null, maxTotal: null, rooms: [], minM2: null, minYear: null, maxMetroMin: null, parkWithin15: false, hideNewDev: false, district: null, sector: null };
  expect(filterSummary(none)).toBeNull();
  expect(filterSummary({ ...none, maxTotal: 180000, rooms: [2, 3], maxMetroMin: 15, district: 'Baneasa' })).toBe(
    `max. 180${NNBSP}000${NBSP}€ · 2, 3 camere · Băneasa · metrou ≤ 15${NBSP}min`,
  );
  expect(filterSummary({ ...none, rooms: [1] })).toBe('1 cameră');
});

test('cleanTitle turns shouting into sentence case and drops sales words', () => {
  expect(cleanTitle('DE VANZARE 3 CAMERE 100 MP | BOXA 10 MP')).toBe('3 camere 100 mp · boxa 10 mp');
  expect(cleanTitle('SUPER OFERTA! Apartament 3 camere Drumul Sarii')).toBe('Apartament 3 camere Drumul Sarii');
  expect(cleanTitle('Oferta')).toBe('Oferta');
  expect(cleanTitle('Apartament 2 camere ofertă')).toBe('Apartament 2 camere');
  expect(cleanTitle('Super ofertă apartament')).toBe('Apartament');
});

test('walks says far from the metro beyond 25 minutes and leaves out a park beyond 20', () => {
  const far = listing({ metro: { name: 'Straulesti', minutes: 63 }, park: { name: 'Parcul Casa Alba', minutes: 41 } });
  expect(walks(far)).toBe('departe de metrou (peste 25 min)');
});

test('parkName uses the everyday name in brackets and lowercases "al"', () => {
  expect(parkName('Parcul Regele Mihai I Al României (Herăstrău)')).toBe('Parcul Herăstrău');
  expect(parkName('Grădina Botanică Al Universității')).toBe('Grădina Botanică al Universității');
  expect(parkName('Parcul IOR')).toBe('Parcul IOR');
});


test('kindLabel names only the filters that change which flats the colours come from', () => {
  const none = { maxPpm: null, maxTotal: 150000, rooms: [], minM2: null, minYear: null, maxMetroMin: 10, parkWithin15: false, hideNewDev: false, district: null, sector: null };
  expect(kindLabel(none)).toBeNull();
  expect(kindLabel({ ...none, rooms: [2], minM2: 50 })).toBe(`2 camere, min. 50${NBSP}m²`);
});

test('deltaText names the building era when the comparison used one', () => {
  expect(deltaText({ delta: -12, basisName: 'Titan', basisEra: 'vechi' } as MapListing)).toBe('12% sub mediana blocurilor vechi din Titan');
  expect(deltaText({ delta: 8, basisName: 'Baneasa', basisEra: 'nou' } as MapListing)).toBe('8% peste mediana blocurilor noi din Băneasa');
  expect(deltaText({ delta: -3, basisName: 'Titan', basisEra: null } as MapListing)).toBe('3% sub mediana din Titan');
});
