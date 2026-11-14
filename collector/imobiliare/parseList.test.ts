import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseImobiliareList } from './parseList';

const fixture = readFileSync('collector/fixtures/imobiliare/list.html', 'utf8');

function card(o: { id?: number; price?: number; surface?: number; floor?: string; county?: string; city?: string; extra?: string } = {}): string {
  const { id = 1, price = 150000, surface = 75, floor = 'Etaj 3 / 8', county = 'Bucuresti', city = 'Sector 2', extra = '' } = o;
  return `<article class="x" id="listing-${id}" data-item-price="${price}" data-surface="${surface}" data-year="1985"
    data-category3="3 bedrooms" data-category4="established" data-sellertype="agency" data-city="${city}" data-county="${county}"
    data-area="Colentina" data-days-market="2" data-name="Apartament &amp; 3 camere">
    <a href="https://www.imobiliare.ro/oferta/apartament-${id}" class="x"></a><span>150.000 €</span><span>Colentina, Sector 2</span>
    <span class="card-pill"> 3 camere</span><span class="card-pill"> ${surface} mp</span><span class="card-pill"> ${floor}</span><span>1985 (Finalizată)</span>${extra}</article>`;
}

test('reads the cards of a saved results page', () => {
  const p = parseImobiliareList(fixture);
  expect(p.listings).toHaveLength(3);
  expect(p.skipped).toBe(1); // the card from Ilfov
  for (const l of p.listings) {
    expect(l.id).toMatch(/^imobiliare:\d+$/);
    expect(l.url).toMatch(/^https:\/\/www\.imobiliare\.ro\/oferta\//);
    expect(l.ppm).toBe(Math.round(l.total / l.m2));
    expect(l.sector).toMatch(/^Sectorul [1-6]$/);
    expect(l.rooms).toBeGreaterThan(0);
  }
});

test('reads one card as on the site', () => {
  const [l] = parseImobiliareList(`<body>${card()}</body>`).listings;
  expect(l).toMatchObject({
    id: 'imobiliare:1', url: 'https://www.imobiliare.ro/oferta/apartament-1', title: 'Apartament & 3 camere',
    total: 150000, m2: 75, ppm: 2000, rooms: 3, floor: 3, year: 1985, sector: 'Sectorul 2', district: 'Colentina', privateOwner: false, isNewDev: false,
  });
});

test('a card without days on the market still reads', () => {
  const html = card().replace('data-days-market="2"', 'data-days-market="not applicable"');
  expect(parseImobiliareList(`<body>${html}</body>`).listings).toHaveLength(1);
});

test('floor: ground, numbered, or absent', () => {
  const floors = (f: string) => parseImobiliareList(`<body>${card({ floor: f })}</body>`).listings[0].floor;
  expect(floors('Parter / 5')).toBe(0);
  expect(floors('Etaj 7')).toBe(7);
  expect(floors('Mansardă')).toBeNull();
});

test('skips cards outside Bucharest or without a price', () => {
  const p = parseImobiliareList(`<body>${card({ id: 1 })}${card({ id: 2, county: 'Judetul Ilfov' })}${card({ id: 3, price: 0 })}</body>`);
  expect(p.listings.map((l) => l.id)).toEqual(['imobiliare:1']);
  expect(p.skipped).toBe(2);
});

test('fails loudly on a page it does not recognise', () => {
  expect(() => parseImobiliareList('<html>Acces refuzat</html>')).toThrow(/no listing cards/);
  expect(() => parseImobiliareList(`<body>${card({ price: 0 })}</body>`)).toThrow(/none could be read/);
});
