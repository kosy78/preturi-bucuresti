import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseDetailPage } from './parseDetail';

type AdOverrides = { radius?: number; latitude?: number; longitude?: number; build_year?: string; market?: string };

function page(pageProps: object): string {
  const data = { props: { pageProps } };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
}

function withAd(overrides: AdOverrides): string {
  const o = { radius: 0, latitude: 44.4268, longitude: 26.1025, build_year: '1935', market: 'secondary', ...overrides };
  const ad = {
    location: { coordinates: { latitude: o.latitude, longitude: o.longitude }, mapDetails: { radius: o.radius } },
    characteristics: [
      { key: 'market', value: o.market },
      { key: 'build_year', value: o.build_year },
    ],
  };
  return page({ ad });
}

function withoutAd(): string {
  return page({});
}

const fixture = readFileSync('collector/fixtures/detail.html', 'utf8');

test('reads position and year from a real page', () => {
  const d = parseDetailPage(fixture)!;
  expect(d.lat).toBeGreaterThan(44.33); expect(d.lat).toBeLessThan(44.55);
  expect(d.lng).toBeGreaterThan(25.95); expect(d.lng).toBeLessThan(26.25);
  expect(d.year).toBe(1986);
});
test('an exact pin is precise, a radius is not', () => {
  expect(parseDetailPage(withAd({ radius: 0 }))!.precise).toBe(true);
  expect(parseDetailPage(withAd({ radius: 300 }))!.precise).toBe(false);
});
test('a position outside Bucharest is dropped', () => {
  expect(parseDetailPage(withAd({ latitude: 45.75, longitude: 21.22 }))).toMatchObject({ lat: null, lng: null, precise: false });
});
test('implausible build years become null', () => {
  expect(parseDetailPage(withAd({ build_year: '19' }))!.year).toBeNull();
  expect(parseDetailPage(withAd({ build_year: '1984' }))!.year).toBe(1984);
});
test('reads the market, unknown values become null', () => {
  expect(parseDetailPage(withAd({ market: 'primary' }))!.market).toBe('primary');
  expect(parseDetailPage(withAd({ market: 'other' }))!.market).toBeNull();
});
test('an expired listing gives null', () => { expect(parseDetailPage(withoutAd())).toBeNull(); });
test('fails loudly on a page without data', () => {
  expect(() => parseDetailPage('<html></html>')).toThrow('Storia listing page has no data');
});
test('fails loudly on a page with broken data', () => {
  expect(() => parseDetailPage('<html><script id="__NEXT_DATA__" type="application/json">{"props":</script></html>')).toThrow('Storia listing page has no data');
});
