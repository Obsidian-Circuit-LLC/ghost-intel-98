import type { GeoItem } from '@shared/post-mvp-types';

/**
 * Min/max published timestamps (epoch ms) across the located item set, ignoring undated
 * items. Returns null when no item carries a parseable `published` date.
 */
export function timeBounds(items: GeoItem[]): { min: number; max: number } | null {
  const ts = items.map((i) => (i.published ? Date.parse(i.published) : NaN)).filter((n) => !Number.isNaN(n));
  return ts.length ? { min: Math.min(...ts), max: Math.max(...ts) } : null;
}

/** Items at or before time `t`. Undated items are always included (pinned to "now"). */
export function itemsUpTo(items: GeoItem[], t: number): GeoItem[] {
  return items.filter((i) => { const p = i.published ? Date.parse(i.published) : NaN; return Number.isNaN(p) || p <= t; });
}
