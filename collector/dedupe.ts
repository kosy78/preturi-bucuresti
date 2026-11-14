import { metres } from './geo';
import type { StoredListing } from './store';

const placed = (l: StoredListing) => l.precise === true && l.lat != null && l.lng != null;

function sameApartment(a: StoredListing, b: StoredListing): boolean {
  if (Math.abs(a.m2 - b.m2) > 1) return false;
  if (Math.abs(a.total - b.total) > 0.03 * Math.min(a.total, b.total)) return false;
  if (placed(a) && placed(b)) return metres([a.lng!, a.lat!], [b.lng!, b.lat!]) <= 50;
  if (!placed(a) && !placed(b)) return a.street !== null && a.street === b.street && a.district === b.district;
  return false;
}

export function mergeReposts(ls: StoredListing[]): { kept: StoredListing[]; also: Map<string, string[]> } {
  const buckets = new Map<string, StoredListing[]>();
  for (const l of ls) {
    const key = `${l.sector}|${l.rooms}|${l.floor}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(l);
    else buckets.set(key, [l]);
  }

  const mergedAway = new Set<string>();
  const also = new Map<string, string[]>();
  for (const bucket of buckets.values()) {
    // Each post joins the group whose earliest post it matches, so small steps cannot chain different flats together.
    const groups: StoredListing[][] = [];
    for (const l of [...bucket].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen))) {
      const group = groups.find((g) => sameApartment(g[0], l));
      if (group) group.push(l);
      else groups.push([l]);
    }
    for (const group of groups) {
      if (group.length < 2) continue;
      const [first, ...rest] = group;
      also.set(first.id, rest.map((l) => l.url));
      for (const l of rest) mergedAway.add(l.id);
    }
  }
  return { kept: ls.filter((l) => !mergedAway.has(l.id)), also };
}
