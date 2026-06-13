import type { GeoItem } from '@shared/post-mvp-types';

/**
 * Min/max published timestamps (epoch ms) across the located item set, ignoring undated
 * items. Returns null when no item carries a parseable `published` date.
 */
export function timeBounds(items: GeoItem[]): { min: number; max: number } | null {
  // Single-pass min/max. Must NOT use Math.min(...ts)/Math.max(...ts): spreading an
  // item-sized array (130k+ cached events) as call args overflows the engine call stack
  // (RangeError: Maximum call stack size exceeded) and white-screens the module on load.
  let min = Infinity;
  let max = -Infinity;
  let seen = false;
  for (const i of items) {
    const p = i.published ? Date.parse(i.published) : NaN;
    if (Number.isNaN(p)) continue;
    seen = true;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return seen ? { min, max } : null;
}

/** Items at or before time `t`. Undated items are always included (pinned to "now"). */
export function itemsUpTo(items: GeoItem[], t: number): GeoItem[] {
  return items.filter((i) => { const p = i.published ? Date.parse(i.published) : NaN; return Number.isNaN(p) || p <= t; });
}
