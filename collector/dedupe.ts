import { metres } from './geo';
import type { StoredListing } from './store';

const located = (l: StoredListing) => l.lat != null && l.lng != null;
const placed = (l: StoredListing) => l.precise === true && located(l);
const apart = (a: StoredListing, b: StoredListing) => metres([a.lng!, a.lat!], [b.lng!, b.lat!]);
const sameStreet = (a: StoredListing, b: StoredListing) => a.street !== null && a.street === b.street && a.district === b.district;

// Sizes are usually whole metres; the same 63.47 m² at the same price on the same floor in the same neighbourhood is one
// flat, however the street is spelt. Identical units in different blocks of a development are kept apart by their pins.
const NEAR_EXACT_M = 300;
function sameExactFlat(a: StoredListing, b: StoredListing): boolean {
  return (
    !Number.isInteger(a.m2) && a.m2 === b.m2 && a.total === b.total &&
    a.floor !== null && a.floor === b.floor &&
    a.district !== null && a.district === b.district &&
    !(located(a) && located(b) && apart(a, b) > NEAR_EXACT_M)
  );
}

// A post joins a group only if its floor agrees with every known floor there: a group anchored on a post without a
// floor must not collect flats from different floors.
function floorFits(group: StoredListing[], l: StoredListing): boolean {
  return l.floor === null || group.every((g) => g.floor === null || g.floor === l.floor);
}

function sameApartment(a: StoredListing, b: StoredListing): boolean {
  if (Math.abs(a.m2 - b.m2) > 1) return false;
  if (Math.abs(a.total - b.total) > 0.03 * Math.min(a.total, b.total)) return false;
  if (a.floor !== null && b.floor !== null && a.floor !== b.floor) return false;
  if (sameExactFlat(a, b)) return true;
  if (placed(a) && placed(b)) return apart(a, b) <= 50;
  if (!placed(a) && !placed(b)) return sameStreet(a, b);
  // One exact pin and one approximate: the approximate one lands near the building, not on it.
  return sameStreet(a, b) || (located(a) && located(b) && apart(a, b) <= 150);
}

export function mergeReposts(ls: StoredListing[]): { kept: StoredListing[]; also: Map<string, string[]> } {
  const buckets = new Map<string, StoredListing[]>();
  for (const l of ls) {
    const key = `${l.sector}|${l.rooms}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(l);
    else buckets.set(key, [l]);
  }

  const mergedAway = new Set<string>();
  const also = new Map<string, string[]>();
  for (const bucket of buckets.values()) {
    // Each post joins the group whose earliest post it matches, so small steps cannot chain different flats together.
    const groups: StoredListing[][] = [];
    // Groups by whole metres of their earliest post; a match is within 1 m², so only three slots can hold it.
    const bySize = new Map<number, number[]>();
    for (const l of [...bucket].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen))) {
      const slot = Math.floor(l.m2);
      let found = -1;
      for (const s of [slot - 1, slot, slot + 1]) {
        for (const g of bySize.get(s) ?? []) {
          if ((found === -1 || g < found) && sameApartment(groups[g][0], l) && floorFits(groups[g], l)) found = g;
        }
      }
      if (found !== -1) {
        groups[found].push(l);
        continue;
      }
      groups.push([l]);
      const same = bySize.get(slot);
      if (same) same.push(groups.length - 1);
      else bySize.set(slot, [groups.length - 1]);
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
