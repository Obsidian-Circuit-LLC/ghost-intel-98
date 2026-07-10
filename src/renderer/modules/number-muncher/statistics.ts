/**
 * Statistics engine — pure aggregate stats over a dataset, no DOM/state.
 *
 * All measures are computed directly from the input array on each call
 * (no incremental/streaming state, no `Date.now()` / `Math.random()`).
 * Empty-dataset inputs are handled explicitly so callers never see NaN
 * leak into count/sum.
 */

export interface Stats {
  count: number;
  sum: number;
  mean: number;
  median: number;
  mode: number[];
  min: number;
  max: number;
  variancePop: number;
  varianceSample: number;
  stdevPop: number;
  stdevSample: number;
}

const EMPTY_STATS: Stats = {
  count: 0,
  sum: 0,
  mean: 0,
  median: 0,
  mode: [],
  min: 0,
  max: 0,
  variancePop: 0,
  varianceSample: 0,
  stdevPop: 0,
  stdevSample: 0,
};

/** Compute descriptive statistics for `xs`. Empty-safe (zeros, not NaN). */
export function stats(xs: number[]): Stats {
  const count = xs.length;
  if (count === 0) return { ...EMPTY_STATS };

  const sum = xs.reduce((a, b) => a + b, 0);
  const mean = sum / count;

  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(count / 2);
  const median = count % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const min = sorted[0];
  const max = sorted[count - 1];

  const freq = new Map<number, number>();
  for (const x of xs) freq.set(x, (freq.get(x) ?? 0) + 1);
  const maxFreq = Math.max(...freq.values());
  const mode = maxFreq > 1 ? [...freq.entries()].filter(([, f]) => f === maxFreq).map(([v]) => v).sort((a, b) => a - b) : [];

  const sqDiffs = xs.map((x) => (x - mean) ** 2);
  const variancePop = sqDiffs.reduce((a, b) => a + b, 0) / count;
  const varianceSample = count > 1 ? sqDiffs.reduce((a, b) => a + b, 0) / (count - 1) : 0;
  const stdevPop = Math.sqrt(variancePop);
  const stdevSample = Math.sqrt(varianceSample);

  return { count, sum, mean, median, mode, min, max, variancePop, varianceSample, stdevPop, stdevSample };
}
