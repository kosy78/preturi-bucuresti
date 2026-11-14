import type { Detail } from '../../shared/types';

type Ad = {
  location?: {
    coordinates?: { latitude?: number | null; longitude?: number | null } | null;
    mapDetails?: { radius?: number | null } | null;
  } | null;
  characteristics?: { key: string; value: string }[] | null;
};

export function parseDetailPage(html: string): Detail | null {
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  let data;
  try {
    data = JSON.parse(json ?? '');
  } catch {
    // The collector stores null as "listing gone" for good, so a blocked or broken page must not look like one.
    throw new Error('Storia listing page has no data');
  }
  const ad: Ad | undefined = data?.props?.pageProps?.ad;
  if (!ad) return null;

  const lat = ad.location?.coordinates?.latitude;
  const lng = ad.location?.coordinates?.longitude;
  const inBucharest = typeof lat === 'number' && typeof lng === 'number' && lat >= 44.33 && lat <= 44.55 && lng >= 25.95 && lng <= 26.25;
  const characteristic = (key: string) => ad.characteristics?.find((c) => c.key === key)?.value;
  const year = Number(characteristic('build_year'));
  const market = characteristic('market');

  return {
    lat: inBucharest ? lat : null,
    lng: inBucharest ? lng : null,
    precise: inBucharest && ad.location?.mapDetails?.radius === 0,
    year: Number.isInteger(year) && year >= 1850 && year <= new Date().getFullYear() + 5 ? year : null,
    market: market === 'primary' || market === 'secondary' ? market : null,
  };
}
