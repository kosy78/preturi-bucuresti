import type { SearchListing } from '../../shared/types';

const BASE = 'https://www.imobiliare.ro';
const CARD = /<article\b[^>]*\bid="listing-(\d+)"([^>]*)>([\s\S]*?)<\/article>/g;

export type ImobiliarePage = {
  listings: SearchListing[];
  skipped: number;
};

// Reads the cards in the page body. The JSON blob inside a saved page repeats page 1 whatever page was saved,
// so it is not used.
export function parseImobiliareList(html: string): ImobiliarePage {
  const cards = [...html.matchAll(CARD)];
  if (cards.length === 0) throw new Error('no listing cards found');

  const listings: SearchListing[] = [];
  for (const [, id, attrs, body] of cards) {
    const listing = toListing(id, attrs, body);
    if (listing) listings.push(listing);
  }
  // Every card failing means the layout changed, not that the page is empty.
  if (listings.length === 0) throw new Error(`${cards.length} cards found but none could be read`);
  return { listings, skipped: cards.length - listings.length };
}

function toListing(id: string, attrs: string, body: string): SearchListing | null {
  const attr = (name: string) => attrs.match(new RegExp(`\\bdata-${name}="([^"]*)"`))?.[1];
  const total = Number(attr('item-price'));
  const m2 = Number(attr('surface'));
  const href = body.match(/<a href="(?:https:\/\/www\.imobiliare\.ro)?(\/oferta\/[^"]+)"/)?.[1];
  const sector = attr('city')?.match(/^Sector ([1-6])$/)?.[1];
  const text = body.replace(/<[^>]+>/g, '|');
  const rooms = Number(text.match(/\|\s*(\d+) camer[ae]\s*\|/)?.[1] ?? attr('category3')?.match(/^(\d+) bedrooms?/)?.[1]);
  if (!href || attr('county') !== 'Bucuresti' || !sector || !(total > 0) || !(m2 > 0) || !(rooms > 0)) return null;

  const floor = text.match(/\|\s*(Parter|Etaj (\d+))(?: \/ \d+)?\s*\|/);
  const year = Number(attr('year'));
  return {
    id: `imobiliare:${id}`,
    url: BASE + href,
    title: decode(attr('name') ?? ''),
    total,
    ppm: Math.round(total / m2),
    m2,
    rooms,
    floor: floor ? (floor[2] ? Number(floor[2]) : 0) : null,
    street: null,
    district: attr('area') && attr('area') !== 'not applicable' ? decode(attr('area')!) : null,
    sector: `Sectorul ${sector}`,
    privateOwner: /owner|private|proprietar/i.test(attr('sellertype') ?? ''),
    isNewDev: attr('category4') === 'new' || attr('sellertype') === 'developer',
    fromPrice: false,
    // Cards give days on the market, not a date; it only orders listings.
    postedAt: new Date(Date.now() - (Number(attr('days-market')) || 0) * 86_400_000).toISOString(),
    year: year >= 1850 && year <= new Date().getFullYear() + 5 ? year : null,
  };
}

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
