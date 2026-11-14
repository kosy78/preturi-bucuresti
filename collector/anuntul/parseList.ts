import type { SearchListing, SearchPage } from '../../shared/types';

const BASE = 'https://www.anuntul.ro';
const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const CARD_START = /<div id="aid-(\d+)"\s+class="card impression/g;
const CARDS_PER_PAGE = 50;

export function parseAnuntulList(html: string, rooms: number): SearchPage {
  const starts = [...html.matchAll(CARD_START)];
  if (starts.length === 0) throw new Error('Anuntul list page has no listing data');

  const pagination = html.match(/<ul class="pagination[\s\S]*?<\/ul>/)?.[0] ?? '';
  const pages = [...pagination.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1]));
  // A full page with no page links means the layout changed, not that the category ends here.
  if (pages.length === 0 && starts.length >= CARDS_PER_PAGE) throw new Error('Anuntul list page has no page count');
  const totalPages = Math.max(1, ...pages);

  const listings: SearchListing[] = [];
  let skipped = 0;
  starts.forEach((start, i) => {
    const end = starts[i + 1]?.index ?? html.indexOf('<ul class="pagination', start.index);
    const listing = toListing(start[1], html.slice(start.index, end === -1 ? undefined : end), rooms);
    if (listing) listings.push(listing);
    else skipped++;
  });
  return { listings, skipped, totalPages };
}

function toListing(id: string, card: string, rooms: number): SearchListing | null {
  const link = card.match(/class="card-title[^"]*"><a [^>]*href="([^"#]+)[^"]*"[^>]*>([^<]*)<\/a>/);
  const place = card.match(/<span class="float-end[^"]*text-end">\s*([^<]*?)\s*<\/span>/)?.[1] ?? '';
  const [city, when = ''] = place.split(/,\s*/);
  const price = card.match(/<div class="card-text[^"]*text-red-at">\s*([\d.]+) €\s*<\/div>/)?.[1];
  const total = price ? Number(price.replaceAll('.', '')) : 0;
  const m2 = Number(card.match(/Suprafata ([\d.,]+) mp/)?.[1].replace(',', '.') ?? 0);
  if (!link || city !== 'Bucuresti' || !(total > 0) || !(m2 > 0)) return null;

  const floor = card.match(/Etaj (\d+|parter)\b/)?.[1];
  const year = Number(card.match(/\bAn (\d{4})\b/)?.[1]);
  return {
    id: `anuntul:${id}`,
    url: BASE + link[1].trim(),
    title: decode(link[2].trim()),
    total,
    ppm: Math.round(total / m2),
    m2,
    rooms,
    floor: floor === undefined ? null : floor === 'parter' ? 0 : Number(floor),
    street: null,
    // The cards name no sector or neighbourhood; the export takes both from the nearest Storia listing.
    district: null,
    sector: null,
    privateOwner: false,
    isNewDev: card.includes('href="/ansamblu/'),
    fromPrice: false,
    postedAt: postedAt(decode(when)),
    year: year >= 1850 && year <= new Date().getFullYear() + 5 ? year : null,
  };
}

// The site shows "azi; 12:49", "ieri; 09:05" or "08 Octombrie" (with "'25" for an earlier year).
// The date only orders listings, so an unknown format falls back to the time it was read.
function postedAt(when: string): string {
  const now = new Date();
  const relative = when.match(/^(azi|ieri); (\d{1,2}):(\d{2})/);
  if (relative) {
    const day = now.getDate() - (relative[1] === 'ieri' ? 1 : 0);
    return new Date(now.getFullYear(), now.getMonth(), day, Number(relative[2]), Number(relative[3])).toISOString();
  }
  const dated = when.match(/^(\d{1,2}) (\p{L}+)(?: '(\d{2}))?/u);
  const month = dated ? MONTHS.indexOf(dated[2].toLowerCase()) : -1;
  if (dated && month !== -1) {
    const year = dated[3] ? 2000 + Number(dated[3]) : now.getFullYear();
    const date = new Date(year, month, Number(dated[1]));
    if (!dated[3] && date > now) date.setFullYear(year - 1);
    return date.toISOString();
  }
  return now.toISOString();
}

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
