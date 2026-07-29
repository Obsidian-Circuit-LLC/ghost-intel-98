import { describe, it, expect } from 'vitest';
import { corroboratingItems } from '../src/renderer/modules/geoint/corroborate';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem => ({
  title: o.id, located: 'geo', ...o
} as GeoItem);

describe('corroboratingItems', () => {
  const target = mk({ id: 'T', sourceId: 'wt', lat: 50, lon: 30, published: '2026-07-30T10:00:00Z' });

  it('returns other items within radius+window, nearest first, excluding the target itself', () => {
    const near = mk({ id: 'A', sourceId: 'reuters', lat: 50.05, lon: 30.05, published: '2026-07-30T09:00:00Z' });
    const far = mk({ id: 'B', sourceId: 'ajz', lat: 10, lon: 10, published: '2026-07-30T10:00:00Z' });
    const out = corroboratingItems(target, [target, near, far]);
    expect(out.map((c) => c.item.id)).toEqual(['A']);
    expect(out[0].distanceKm).toBeGreaterThan(0);
    expect(out[0].distanceKm).toBeLessThan(25);
  });

  it('includes same-source items (for the "this source" filter) but never the target', () => {
    const sameSrc = mk({ id: 'C', sourceId: 'wt', lat: 50.01, lon: 30.01, published: '2026-07-30T10:05:00Z' });
    const out = corroboratingItems(target, [target, sameSrc]);
    expect(out.map((c) => c.item.id)).toEqual(['C']);
  });

  it('excludes items outside the time window when both are dated', () => {
    const old = mk({ id: 'D', sourceId: 'reuters', lat: 50.01, lon: 30.01, published: '2026-07-20T10:00:00Z' });
    expect(corroboratingItems(target, [target, old], { windowHours: 48 })).toEqual([]);
  });

  it('is proximity-only when either side is undated', () => {
    const undated = mk({ id: 'E', sourceId: 'reuters', lat: 50.01, lon: 30.01 });
    expect(corroboratingItems(target, [target, undated]).map((c) => c.item.id)).toEqual(['E']);
  });

  it('returns [] when the target has no coordinates', () => {
    const noCoord = mk({ id: 'N', sourceId: 'wt' });
    const other = mk({ id: 'A', sourceId: 'reuters', lat: 50, lon: 30 });
    expect(corroboratingItems(noCoord, [noCoord, other])).toEqual([]);
  });

  it('sorts ties by published desc then id asc (deterministic)', () => {
    const a = mk({ id: 'ID2', sourceId: 's1', lat: 50.01, lon: 30.01, published: '2026-07-30T09:00:00Z' });
    const b = mk({ id: 'ID1', sourceId: 's2', lat: 50.01, lon: 30.01, published: '2026-07-30T09:00:00Z' });
    const out = corroboratingItems(target, [target, a, b]);
    // identical coords => equal distance; equal published => id asc
    expect(out.map((c) => c.item.id)).toEqual(['ID1', 'ID2']);
  });
});
