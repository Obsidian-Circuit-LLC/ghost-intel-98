import type { GeoItem } from '@shared/post-mvp-types';

/**
 * GeoINT command-center rail (R9) pure helpers. Kept out of CommandRail.tsx so the data
 * derivations — threat level and category filtering — are unit-testable without rendering.
 *
 * HONESTY (charter): every number the rail shows is computed here from the real item set. No
 * panel invents a "live" metric. deriveThreatLevel's level is a transparent function of the
 * high-severity count in the visible set, and it returns the basis string it derived from.
 */

export type ThreatLevel = 'NONE' | 'GUARDED' | 'ELEVATED' | 'HIGH' | 'SEVERE';

/**
 * Derive a threat level from the visible item set, transparently. The level is a step function of
 * the count of `severity:'high'` events in the passed set; `basis` states exactly that count so the
 * UI can show the formula rather than an unexplained label. There is NO hidden weighting, no time
 * decay, no fabricated index — just a bucketed high-severity count.
 *
 * Buckets:  0 high → NONE · 1–2 → GUARDED · 3–5 → ELEVATED · 6–9 → HIGH · 10+ → SEVERE
 */
export function deriveThreatLevel(items: GeoItem[]): { level: ThreatLevel; basis: string; high: number } {
  let high = 0;
  for (const i of items) if (i.severity === 'high') high++;
  let level: ThreatLevel;
  if (high === 0) level = 'NONE';
  else if (high <= 2) level = 'GUARDED';
  else if (high <= 5) level = 'ELEVATED';
  else if (high <= 9) level = 'HIGH';
  else level = 'SEVERE';
  const basis = `${high} high-severity event${high === 1 ? '' : 's'} in view`;
  return { level, basis, high };
}

/**
 * Per-category counts over the item set. Items with no `category` are bucketed under the literal
 * key `'(uncategorized)'` so the breakdown total always equals items.length (nothing vanishes).
 */
export function categoryCounts(items: GeoItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of items) {
    const k = i.category ?? '(uncategorized)';
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/**
 * Filter items to those whose category is enabled. `enabled` is the set of category keys that are
 * ON; an item with no `category` is keyed as `'(uncategorized)'` (matching categoryCounts) so it can
 * be toggled like any other bucket. An empty `enabled` set hides everything (the user turned all off);
 * that is intentional and honest — it is not silently treated as "show all".
 */
export function filterByCategories(items: GeoItem[], enabled: ReadonlySet<string>): GeoItem[] {
  return items.filter((i) => enabled.has(i.category ?? '(uncategorized)'));
}

/** The category key used for items that carry no `category`. Shared so the rail and tests agree. */
export const UNCATEGORIZED = '(uncategorized)';
