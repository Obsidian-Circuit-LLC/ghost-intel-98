import { describe, it, expect } from 'vitest';
import { deriveThreatLevel, categoryCounts, filterByCategories, UNCATEGORIZED } from '../src/renderer/modules/geoint/threat';
import type { GeoItem } from '../src/shared/post-mvp-types';

// R9 command-center rail pure helpers. These back the rail's HONEST-DATA panels: the threat level is
// a transparent step function of the high-severity count (no fabricated index), and the category
// filter is exact set membership (no implicit "show all" on an empty set).

function item(id: string, p: Partial<GeoItem> = {}): GeoItem {
  return { id, sourceId: p.sourceId ?? `src-${id}`, title: `t-${id}`, located: 'geo', ...p };
}

describe('deriveThreatLevel', () => {
  it('NONE when no high-severity events', () => {
    const r = deriveThreatLevel([item('a'), item('b', { severity: 'low' }), item('c', { severity: 'medium' })]);
    expect(r.level).toBe('NONE');
    expect(r.high).toBe(0);
    expect(r.basis).toContain('0 high-severity');
  });

  it('walks the buckets by high-severity count', () => {
    const highs = (n: number): GeoItem[] => Array.from({ length: n }, (_, i) => item(`h${i}`, { severity: 'high' }));
    expect(deriveThreatLevel(highs(1)).level).toBe('GUARDED');
    expect(deriveThreatLevel(highs(2)).level).toBe('GUARDED');
    expect(deriveThreatLevel(highs(3)).level).toBe('ELEVATED');
    expect(deriveThreatLevel(highs(5)).level).toBe('ELEVATED');
    expect(deriveThreatLevel(highs(6)).level).toBe('HIGH');
    expect(deriveThreatLevel(highs(9)).level).toBe('HIGH');
    expect(deriveThreatLevel(highs(10)).level).toBe('SEVERE');
    expect(deriveThreatLevel(highs(50)).level).toBe('SEVERE');
  });

  it('basis reports the exact count it derived from (singular/plural)', () => {
    expect(deriveThreatLevel([item('a', { severity: 'high' })]).basis).toBe('1 high-severity event in view');
    expect(deriveThreatLevel([item('a', { severity: 'high' }), item('b', { severity: 'high' })]).basis)
      .toBe('2 high-severity events in view');
  });

  it('only severity:high counts (low/medium/undefined do not)', () => {
    const r = deriveThreatLevel([
      item('a', { severity: 'high' }),
      item('b', { severity: 'medium' }),
      item('c', { severity: 'low' }),
      item('d')
    ]);
    expect(r.high).toBe(1);
  });
});

describe('categoryCounts', () => {
  it('buckets by category and totals to items.length (uncategorized included)', () => {
    const items = [
      item('a', { category: 'conflict' }),
      item('b', { category: 'conflict' }),
      item('c', { category: 'cyber' }),
      item('d') // no category
    ];
    const c = categoryCounts(items);
    expect(c.get('conflict')).toBe(2);
    expect(c.get('cyber')).toBe(1);
    expect(c.get(UNCATEGORIZED)).toBe(1);
    const total = [...c.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(items.length);
  });
});

describe('filterByCategories', () => {
  const items = [
    item('a', { category: 'conflict' }),
    item('b', { category: 'cyber' }),
    item('c') // uncategorized
  ];

  it('keeps only enabled categories', () => {
    const out = filterByCategories(items, new Set(['conflict']));
    expect(out.map((i) => i.id)).toEqual(['a']);
  });

  it('treats no-category items as the UNCATEGORIZED bucket', () => {
    const out = filterByCategories(items, new Set([UNCATEGORIZED]));
    expect(out.map((i) => i.id)).toEqual(['c']);
  });

  it('an empty enabled set hides everything (no implicit show-all)', () => {
    expect(filterByCategories(items, new Set())).toEqual([]);
  });

  it('all categories enabled returns the full set', () => {
    const out = filterByCategories(items, new Set(['conflict', 'cyber', UNCATEGORIZED]));
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
