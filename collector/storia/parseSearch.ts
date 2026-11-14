import type { SearchListing, SearchPage } from '../../shared/types';

type Item = {
  id: number;
  slug: string;
  href?: string;
  title: string;
  totalPrice: { value: number; currency: string } | null;
  areaInSquareMeters: number | null;
  roomsNumber: string | null;
  floorNumber: string | null;
  isPrivateOwner: boolean;
  dateCreated: string;
  hidePrice: boolean;
  developmentId: number | null;
  priceFromPerSquareMeter: unknown;
  investmentUnitsNumber: unknown;
  createdAtFirst?: string | null;
  location?: {
    mapDetails?: { radius?: number | null } | null;
    address?: { street?: { name?: string | null } | null } | null;
    reverseGeocoding?: { locations?: { locationLevel: string; name: string }[] } | null;
  } | null;
};

const ORDINALS = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH'];
const ROOMS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
const SECTOR = /^Sectorul [1-6]$/;

export function parseSearchPage(html: string): SearchPage {
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  const searchAds = json ? parseJson(json)?.props?.pageProps?.data?.searchAds : undefined;
  if (!Array.isArray(searchAds?.items)) throw new Error('Storia search page has no listing data');
  const totalPages = searchAds.pagination?.totalPages;
  if (typeof totalPages !== 'number') throw new Error('Storia search page has no page count');

  const listings: SearchListing[] = [];
  let skipped = 0;
  for (const item of searchAds.items as Item[]) {
    // A whole-development post, not one apartment.
    if (item.href === `[lang]/investment/${item.slug}`) {
      skipped++;
      continue;
    }
    // Storia mixes in a decoy that copies a real ad under a fake id; its href points elsewhere.
    if (item.href !== undefined && item.href !== `[lang]/ad/${item.slug}`) continue;
    const listing = toListing(item);
    if (listing) listings.push(listing);
    else skipped++;
  }
  if (searchAds.items.length > 0 && listings.length + skipped === 0) {
    throw new Error('Storia search page has no recognisable listing links');
  }
  return { listings, skipped, totalPages };
}

function parseJson(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function toListing(item: Item): SearchListing | null {
  const total = item.totalPrice?.currency === 'EUR' ? item.totalPrice.value : 0;
  const m2 = item.areaInSquareMeters ?? 0;
  const rooms = ROOMS.indexOf(item.roomsNumber ?? '') + 1;
  const places = item.location?.reverseGeocoding?.locations ?? [];
  const sector = places.find((p) => p.locationLevel === 'sector')?.name ?? null;
  if (item.hidePrice || !(total > 0) || !(m2 > 0) || rooms === 0 || !sector || !SECTOR.test(sector)) return null;

  return {
    id: `storia:${item.id}`,
    url: `https://www.storia.ro/ro/oferta/${item.slug}`,
    title: item.title,
    total,
    ppm: Math.round(total / m2),
    m2,
    rooms,
    floor: floorNumber(item.floorNumber),
    street: item.location?.address?.street?.name ?? null,
    district: places.find((p) => p.locationLevel === 'district')?.name ?? null,
    sector,
    privateOwner: item.isPrivateOwner,
    isNewDev: (item.developmentId ?? 0) > 0,
    fromPrice: item.priceFromPerSquareMeter != null || item.investmentUnitsNumber != null,
    postedAt: item.dateCreated,
    radiusM: typeof item.location?.mapDetails?.radius === 'number' ? item.location.mapDetails.radius : null,
    createdFirst: item.createdAtFirst ?? null,
  };
}

function floorNumber(word: string | null): number | null {
  if (word === 'GROUND') return 0;
  const i = ORDINALS.indexOf(word ?? '');
  return i === -1 ? null : i + 1;
}
