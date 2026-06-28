/**
 * Pure helper functions for the Searchlight sweep panel UI (Task 11).
 *
 * Extracted from SweepPanel.tsx to keep them testable in the Vitest/Node
 * environment without importing renderer/Electron code.
 *
 * Constraints:
 *   - No Date.now / Math.random (deterministic)
 *   - No side-effects
 *   - No Electron or browser APIs
 */

import type { SweepResult } from './types';

// ── FilterBucket ──────────────────────────────────────────────────────────────

export type FilterBucket =
  | 'all'
  | 'found'
  | 'maybe'
  | 'notfound'
  | 'blocked'
  | 'redirect'
  | 'error';

// ── matchesBucket ─────────────────────────────────────────────────────────────

/** Returns whether a result belongs to the given filter bucket. */
/**
 * Whether a result can be labelled inline for adaptive learning: it must be a
 * found/maybe candidate (the only statuses whose feature vector is captured at
 * sweep time) AND there must be an active case to attach the label to.
 */
export function canLabel(status: string, activeCaseId: string | null): boolean {
  return activeCaseId != null && (status === 'found' || status === 'maybe');
}

export function matchesBucket(r: SweepResult, bucket: FilterBucket): boolean {
  const isRedirect = [301, 302, 307, 308].includes(r.statusCode);
  switch (bucket) {
    case 'all':      return true;
    case 'found':    return r.status === 'found';
    case 'maybe':    return r.status === 'maybe';
    case 'notfound': return r.status === 'not_found' && !isRedirect;
    case 'blocked':  return r.status === 'blocked';
    case 'redirect': return isRedirect && r.status === 'not_found';
    case 'error':    return r.status === 'error' || r.status === 'unknown';
  }
}

// ── Sort ──────────────────────────────────────────────────────────────────────

/** Canonical order for status-column sort (ascending).
 *  Must stay consistent with the sweep result buckets. */
export const STATUS_ORDER: Record<string, number> = {
  found:     0,
  maybe:     1,
  blocked:   2,
  not_found: 3,
  unknown:   4,
  error:     5,
};

/**
 * Return a STABLE-sorted copy of `results`.
 *
 * Primary key: `sortKey` with direction `dir` (1 = ascending, -1 = descending).
 * Tie-break: siteName ascending (deterministic regardless of insertion order).
 *
 * No Date.now / Math.random — same input always produces identical output.
 */
export function sortResults(
  results: SweepResult[],
  sortKey: string,
  dir: 1 | -1,
): SweepResult[] {
  return [...results].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'status':
        cmp = (STATUS_ORDER[a.status] ?? 6) - (STATUS_ORDER[b.status] ?? 6);
        break;
      case 'probability':
        cmp = (a.probability ?? -1) - (b.probability ?? -1);
        break;
      case 'elapsed':
        cmp = a.elapsed - b.elapsed;
        break;
      case 'site':
        cmp = a.siteName.localeCompare(b.siteName);
        break;
      case 'category':
        cmp = a.category.localeCompare(b.category);
        break;
      default:
        cmp = 0;
    }
    if (cmp !== 0) return cmp * dir;
    // Stable tie-break: siteName ascending (always deterministic)
    return a.siteName.localeCompare(b.siteName);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────

export interface SweepSummary {
  found:     number;
  maybe:     number;
  not_found: number;
  blocked:   number;
  error:     number;
  unknown:   number;
  /** Categories that had at least one found or maybe result. */
  byCategory: Record<string, { found: number; maybe: number }>;
}

/**
 * Compute per-status tallies and per-category found/maybe counts.
 * Pure function of the result list — updates live on each render.
 */
export function summarizeSweep(results: SweepResult[]): SweepSummary {
  const summary: SweepSummary = {
    found:     0,
    maybe:     0,
    not_found: 0,
    blocked:   0,
    error:     0,
    unknown:   0,
    byCategory: {},
  };

  for (const r of results) {
    // Per-status tally
    switch (r.status) {
      case 'found':     summary.found++;     break;
      case 'maybe':     summary.maybe++;     break;
      case 'not_found': summary.not_found++; break;
      case 'blocked':   summary.blocked++;   break;
      case 'error':     summary.error++;     break;
      case 'unknown':   summary.unknown++;   break;
    }

    // By-category breakdown (found + maybe only)
    if (r.status === 'found' || r.status === 'maybe') {
      const cat = r.category;
      if (!summary.byCategory[cat]) {
        summary.byCategory[cat] = { found: 0, maybe: 0 };
      }
      if (r.status === 'found') summary.byCategory[cat]!.found++;
      else                       summary.byCategory[cat]!.maybe++;
    }
  }

  return summary;
}

// ── ETA ───────────────────────────────────────────────────────────────────────

/**
 * Estimate remaining sweep time in milliseconds.
 *
 * Formula: `(elapsedMs / checked) * (total - checked)`
 *
 * Returns `null` when:
 *  - `checked === 0` (divide-by-zero guard)
 *  - `elapsedMs === 0` (no time elapsed)
 *  - `total <= checked` (sweep done / overrun)
 *
 * Caller is responsible for passing `elapsedMs = Date.now() - job.startedAt`
 * (renderer-side; Date.now is intentionally NOT called here so the function
 * remains deterministic/testable).
 */
export function computeEta(
  checked: number,
  total: number,
  elapsedMs: number,
): number | null {
  const remaining = total - checked;
  if (checked <= 0 || elapsedMs <= 0 || remaining <= 0) return null;
  return (elapsedMs / checked) * remaining;
}
