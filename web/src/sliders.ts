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
