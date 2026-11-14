// Slider ranges, shared by the filter panel and the URL reader so the two cannot drift apart.
// `open` is the end of the track that means "no limit".
export type Range = { min: number; max: number; step: number; open: 'min' | 'max' };

export const RANGES = {
  maxTotal: { min: 40_000, max: 500_000, step: 5_000, open: 'max' },
  maxPpm: { min: 1_200, max: 4_600, step: 100, open: 'max' },
  minM2: { min: 20, max: 150, step: 5, open: 'min' },
  maxMetroMin: { min: 5, max: 25, step: 1, open: 'max' },
} satisfies Record<string, Range>;

// Clamps to the range and snaps to the step; the no-limit end reads as null.
export function fit(v: number, r: Range): number | null {
  const n = Math.min(r.max, Math.max(r.min, r.min + Math.round((v - r.min) / r.step) * r.step));
  return n === (r.open === 'max' ? r.max : r.min) ? null : n;
}

// A typed money limit is kept exactly as typed (no slider step), raised to the range's lowest value if below it.
// Only an empty field means no limit: a large typed budget stays a real budget.
export function exactLimit(n: number, r: Range): number {
  return Math.max(r.min, Math.round(n));
}

// Reads "180000", "180 000", "180.000", "180.000,50", "180k" or "180 mii". Anything else is undefined, so the old limit stays.
export function parseLimit(text: string, r: Range): number | null | undefined {
  const t = text.trim().toLowerCase().replace(/€|eur|\/m²|\/mp/g, '').trim();
  if (t === '') return null;
  const m = t.match(/^(\d{1,3}(?:[ .\u202f\u00a0]\d{3})+|\d+)(?:,(\d+))?\s*(k|mii)?$/);
  if (!m) return undefined;
  // "2,5k" is 2 500; without k/mii the decimals are cents and are dropped.
  const whole = Number(m[1].replace(/[ .\u202f\u00a0]/g, ''));
  const n = m[3] ? Number(`${whole}.${m[2] ?? 0}`) * 1000 : whole;
  return exactLimit(n, r);
}
