export type SearchListing = {
  id: string;            // "storia:10733327"
  url: string;           // https://www.storia.ro/ro/oferta/<slug>
  title: string;
  total: number;         // EUR
  ppm: number;           // EUR per m², rounded
  m2: number;
  rooms: number;         // 1..10
  floor: number | null;  // 0 = ground; null when unknown
  street: string | null;
  district: string | null;   // locationLevel "district"
  sector: string | null;     // locationLevel "sector"
  privateOwner: boolean;
  isNewDev: boolean;     // developmentId > 0
  fromPrice: boolean;    // priceFromPerSquareMeter or investmentUnitsNumber present
  postedAt: string;      // ISO date
  year?: number | null;  // build year when the list page shows it (Anuntul); Storia's comes with the detail
  radiusM?: number | null;       // Storia's privacy radius around the pin, metres; 0 = exact
  createdFirst?: string | null;  // Storia's first publication date, survives reposting under the same id
};
export type SearchPage = { listings: SearchListing[]; skipped: number; totalPages: number };
export type Detail = { lat: number | null; lng: number | null; precise: boolean; year: number | null; market: 'primary' | 'secondary' | null };
export type MapListing = {
  id: string; url: string; also: string[];      // other posts of the same apartment
  title: string; total: number; ppm: number; m2: number; rooms: number;
  floor: number | null; year: number | null;
  lat: number | null; lng: number | null; precise: boolean;
  cell: string | null;                          // H3 index at H3_RESOLUTION; precise, or an approximate Storia pin, never a shared pin
  district: string | null; sector: string | null;
  metro: { name: string; minutes: number } | null;   // null when no position
  park: { name: string; minutes: number } | null;
  isNewDev: boolean; inStats: boolean;          // false when fromPrice
  delta: number | null;                         // % against the basis median, negative = cheaper
  deltaBasis: 'district' | 'sector' | null; basisName: string | null;
  basisEra: 'vechi' | 'nou' | null;             // the district median only counts blocks of this era (before / from 1990)
  priceDrop?: number | null;                    // % below the highest price recorded for this post
};
export type Meta = { updatedAt: string; total: number; placed: number; inCells: number; skippedOutliers: number; merged: number };
// ~4 000 precise listings over ~230 km²: resolution 8 cells (~0.74 km²) hold about 13 each, clearing the 5-listing minimum; resolution 9 would not.
export const H3_RESOLUTION = 8;
