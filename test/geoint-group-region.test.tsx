import { describe, it, expect } from 'vitest';
import { filterByRegion } from '../src/renderer/modules/geoint/GeoIntModule';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string }): GeoItem =>
  ({ sourceId: 's', title: o.id, located: 'none', ...o } as GeoItem);

describe('filterByRegion', () => {
  const items = [mk({ id: 'A', country: 'UA' }), mk({ id: 'B', country: 'ua' }), mk({ id: 'C', country: 'PL' }), mk({ id: 'D' })];
  it('returns all items when no region is set', () => {
    expect(filterByRegion(items, null).map((i) => i.id)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('filters case-insensitively by country, excluding items with no country', () => {
    expect(filterByRegion(items, 'UA').map((i) => i.id)).toEqual(['A', 'B']);
    expect(filterByRegion(items, 'pl').map((i) => i.id)).toEqual(['C']);
  });
});
