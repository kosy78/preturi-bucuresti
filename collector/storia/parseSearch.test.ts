import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseSearchPage } from './parseSearch';

const validItem = {
  id: 1,
  slug: 'apartament-2-camere-ID1',
  href: '[lang]/ad/apartament-2-camere-ID1',
  title: 'Apartament 2 camere',
  totalPrice: { value: 100000, currency: 'EUR' },
  pricePerSquareMeter: { value: 2000, currency: 'EUR' },
  areaInSquareMeters: 50,
  roomsNumber: 'TWO',
  floorNumber: 'FIRST',
  isPrivateOwner: false,
  dateCreated: '2026-11-01T10:00:00Z',
  hidePrice: false,
  developmentId: 0,
  priceFromPerSquareMeter: null,
  investmentUnitsNumber: null,
  location: {
    address: { street: { name: 'Strada Fat Frumos' } },
    reverseGeocoding: {
      locations: [
        { locationLevel: 'county', name: 'Bucuresti' },
        { locationLevel: 'sector', name: 'Sectorul 5' },
        { locationLevel: 'district', name: 'Rahova' },
      ],
    },
  },
};

function withItems(items: object[]): string {
  const data = { props: { pageProps: { data: { searchAds: { items, pagination: { totalPages: 1 } } } } } };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
}

const page = parseSearchPage(readFileSync('collector/fixtures/search.html', 'utf8'));
test('reads a full page', () => {
  expect(page.listings.length + page.skipped).toBe(36);
  expect(page.totalPages).toBeGreaterThan(100);
});
test('every listing is usable', () => {
  for (const l of page.listings) {
    expect(l.id).toMatch(/^storia:\d+$/);
    expect(l.url).toMatch(/^https:\/\/www\.storia\.ro\/ro\/oferta\//);
    expect(l.total).toBeGreaterThan(0);
    expect(l.m2).toBeGreaterThan(0);
    expect(l.ppm).toBe(Math.round(l.total / l.m2));
    expect(l.rooms).toBeGreaterThanOrEqual(1);
    expect(l.sector).toMatch(/^Sectorul [1-6]$/);
  }
});
test('skips listings it cannot price', () => {
  const html = withItems([{ ...validItem, hidePrice: true }, { ...validItem, totalPrice: { value: 900000, currency: 'RON' } }, { ...validItem, areaInSquareMeters: 0 }, validItem]);
  expect(parseSearchPage(html)).toMatchObject({ skipped: 3, listings: [{ id: 'storia:1' }] });
});
test('maps room and floor words', () => {
  const [l] = parseSearchPage(withItems([{ ...validItem, roomsNumber: 'THREE', floorNumber: 'GROUND' }])).listings;
  expect([l.rooms, l.floor]).toEqual([3, 0]);
});
test('fails loudly on a page without data', () => {
  expect(() => parseSearchPage('<html></html>')).toThrow('Storia search page has no listing data');
});
test('skips listings outside Bucharest sectors', () => {
  const ilfov = { ...validItem, location: { ...validItem.location, reverseGeocoding: { locations: [{ locationLevel: 'county', name: 'Ilfov' }] } } };
  expect(parseSearchPage(withItems([ilfov, validItem]))).toMatchObject({ skipped: 1, listings: [{ id: 'storia:1' }] });
});
test('fails loudly when every item fails the link check', () => {
  const moved = { ...validItem, href: '[lang]/listing/apartament-2-camere-ID1' };
  expect(() => parseSearchPage(withItems([moved, moved]))).toThrow('Storia search page has no recognisable listing links');
});
test('fails loudly on malformed embedded JSON', () => {
  expect(() => parseSearchPage('<script id="__NEXT_DATA__" type="application/json">{not json</script>')).toThrow('Storia search page has no listing data');
});
test('fails loudly when the page count is missing', () => {
  const html = withItems([validItem]).replace('"pagination":{"totalPages":1}', '"pagination":{}');
  expect(() => parseSearchPage(html)).toThrow('Storia search page has no page count');
});
const investment = { ...validItem, id: 2, slug: 'hils-titanium-IDGXNY', href: '[lang]/investment/hils-titanium-IDGXNY' };
const decoy = { ...validItem, id: 9000000001, href: 'hpr/[lang]/ad/other-ID2' };
test('skips whole-development posts and counts them', () => {
  expect(parseSearchPage(withItems([investment, validItem, decoy]))).toMatchObject({ skipped: 1, listings: [{ id: 'storia:1' }] });
});
test('a page of only development posts and a decoy is not an error', () => {
  expect(parseSearchPage(withItems([investment, investment, decoy]))).toMatchObject({ skipped: 2, listings: [] });
});
test('ignores decoy items whose link does not match their slug', () => {
  const decoy = { ...validItem, id: 9000000001, href: 'hpr/[lang]/ad/other-ID2' };
  expect(parseSearchPage(withItems([decoy, validItem]))).toMatchObject({ skipped: 0, listings: [{ id: 'storia:1' }] });
});
