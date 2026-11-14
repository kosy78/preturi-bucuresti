import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseAnuntulList } from './parseList';

const fixture = (name: string) => readFileSync(`collector/fixtures/anuntul/${name}`, 'utf8');

function card(o: { id?: number; price?: string; tags?: string[]; place?: string; extra?: string } = {}): string {
  const { id = 1, price = '100.000 €', tags = ['Suprafata 50 mp', 'Etaj 3 din 8'], place = 'Bucuresti, azi; 12:49', extra = '' } = o;
  return `
    <div id="aid-${id}"  class="card impression pt-1 py-1  "   data-hash="abc${id}" data-page="1">
      <div class="card-title h5"><a class="text-blue700 stretched-link fw-bold" href="/anunt-vanzare-apartament-2-camere-titan-abc${id}#k2bBmX ">Titan &amp; Pallady, 2 camere</a></div>
      <div class="card-text fs-5 fw-bold text-red-at">${price}</div>
      <div class="anunt-etichete">${tags.map((t) => `<span><i class="fa-solid fa-circle text-success"></i> ${t} </span>`).join('')}</div>
      <div class="mt-1 text-muted">${extra}<span class="float-end mt-1 d-inline-block text-end">
        ${place}                            </span></div>
    </div>`;
}
const page = (...cards: string[]) => `<html><body>${cards.join('')}</body></html>`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 14, 15, 0));
});
afterEach(() => vi.useRealTimers());

test('reads a full page of the Bucharest 2-room category', () => {
  const p = parseAnuntulList(fixture('list.html'), 2);
  expect(p.listings.length + p.skipped).toBe(50);
  expect(p.listings.length).toBeGreaterThan(40);
  expect(p.totalPages).toBe(22);
  expect(parseAnuntulList(fixture('list-page2.html'), 2).totalPages).toBe(22);
});

test('every listing is usable', () => {
  for (const l of [...parseAnuntulList(fixture('list.html'), 2).listings, ...parseAnuntulList(fixture('list-page2.html'), 2).listings]) {
    expect(l.id).toMatch(/^anuntul:\d+$/);
    expect(l.url).toMatch(/^https:\/\/www\.anuntul\.ro\/anunt-vanzare-apartament-2-camere-[\w-]+$/);
    expect(l.total).toBeGreaterThan(0);
    expect(l.m2).toBeGreaterThan(0);
    expect(l.ppm).toBe(Math.round(l.total / l.m2));
    expect(l.rooms).toBe(2);
    expect(l.sector === null || /^Sectorul [1-6]$/.test(l.sector)).toBe(true);
  }
});

test('the first card of the fixture reads as on the site', () => {
  const [first] = parseAnuntulList(fixture('list.html'), 2).listings;
  expect(first).toMatchObject({
    id: 'anuntul:57526621',
    url: 'https://www.anuntul.ro/anunt-vanzare-apartament-2-camere-rahova-dotari-premium-e00MnB',
    total: 96430,
    m2: 50,
    ppm: 1929,
  });
});

test('cards from other counties are skipped and counted', () => {
  const p = parseAnuntulList(fixture('list-all-cities.html'), 2);
  expect(p.listings.length + p.skipped).toBe(50);
  expect(p.skipped).toBeGreaterThanOrEqual(8);

  const mixed = parseAnuntulList(page(card({ id: 1 }), card({ id: 2, place: 'Ilfov, azi; 14:57' })), 2);
  expect(mixed).toMatchObject({ skipped: 1, listings: [{ id: 'anuntul:1' }] });
});

test('cards without a euro price or an area are skipped and counted', () => {
  const p = parseAnuntulList(
    page(card({ id: 1, price: '450.000 lei' }), card({ id: 2, tags: ['Etaj 3 din 8'] }), card({ id: 3, price: 'Pret la cerere' }), card({ id: 4 })),
    2,
  );
  expect(p).toMatchObject({ skipped: 3, totalPages: 1, listings: [{ id: 'anuntul:4' }] });
});

test('reads title, floor, project, size with decimals and the posting time', () => {
  const [a, b, c, d, e] = parseAnuntulList(
    page(
      card({ id: 1, tags: ['Suprafata 61,5 mp', 'Etaj parter din 4'], extra: '<a class="btn" href="/ansamblu/envogue">EnVogue</a>' }),
      card({ id: 2, tags: ['Suprafata 50 mp', 'Etaj demisol din 4'], place: 'Bucuresti, ieri; 09:05' }),
      card({ id: 3, tags: ['Suprafata 50 mp'], place: 'Bucuresti, 08 Octombrie' }),
      card({ id: 4, price: '1.250.000 €', tags: ['Suprafata 250 mp', 'Etaj 12 din 14'], place: 'Bucuresti, 3 Ianuarie &#039;25' }),
      card({ id: 5, place: 'Bucuresti, demult' }),
    ),
    2,
  ).listings;
  expect(a).toMatchObject({ title: 'Titan & Pallady, 2 camere', m2: 61.5, floor: 0, isNewDev: true, district: null, sector: null, year: null });
  expect(a.postedAt).toBe(new Date(2026, 10, 14, 12, 49).toISOString());
  expect(b).toMatchObject({ floor: null, isNewDev: false, postedAt: new Date(2026, 10, 13, 9, 5).toISOString() });
  expect(c).toMatchObject({ floor: null, postedAt: new Date(2026, 9, 8).toISOString() });
  expect(d).toMatchObject({ total: 1250000, floor: 12, postedAt: new Date(2025, 0, 3).toISOString() });
  expect(e.postedAt).toBe(new Date(2026, 10, 14, 15, 0).toISOString());
});

test('reads the build year when it is plausible', () => {
  const years = parseAnuntulList(
    page(
      card({ id: 1, tags: ['Suprafata 50 mp', 'An 1975'] }),
      card({ id: 2, tags: ['Suprafata 50 mp', 'An 2031'] }),
      card({ id: 3, tags: ['Suprafata 50 mp', 'An 2032'] }),
      card({ id: 4, tags: ['Suprafata 50 mp', 'An 1849'] }),
    ),
    2,
  ).listings.map((l) => l.year);
  expect(years).toEqual([1975, 2031, null, null]);
  expect(parseAnuntulList(fixture('list.html'), 2).listings[0].year).toBe(2026);
});

test('a full page of cards without a page count throws; a short page without one is a single page', () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => card({ id: i + 1 }));
  expect(() => parseAnuntulList(page(...cards(50)), 2)).toThrow('Anuntul list page has no page count');
  expect(parseAnuntulList(page(...cards(49)), 2).totalPages).toBe(1);
  const withPages = page(...cards(50)) + '<ul class="pagination"><li><a href="/x/bucuresti?page=2">2</a></li></ul>';
  expect(parseAnuntulList(withPages, 2).totalPages).toBe(2);
});

test('a page without listing cards throws', () => {
  expect(() => parseAnuntulList('<html><body>Verificare de securitate</body></html>', 2)).toThrow('Anuntul list page has no listing data');
});
