import { describe, it, expect } from 'vitest';
import { relatedEvents, sourceLabel } from '../src/renderer/modules/geoint/event-details';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string }): GeoItem =>
  ({ sourceId: 's', title: o.id, located: 'none', ...o } as GeoItem);

describe('sourceLabel', () => {
  it('resolves a known id to its label, else falls back to the raw id', () => {
    const src = [{ id: 'wt', label: 'War-Tracker' }];
    expect(sourceLabel('wt', src)).toBe('War-Tracker');
    expect(sourceLabel('unknown', src)).toBe('unknown');
  });
});

describe('relatedEvents', () => {
  const target = mk({ id: 'T', country: 'UA', eventType: 'Military Strike', published: '2026-07-30T10:00:00Z' });

  it('returns same-country same-type events within the window, excluding self + corroboration set', () => {
    const rel = mk({ id: 'R', country: 'ua', eventType: 'military strike', published: '2026-07-28T10:00:00Z' });
    const dupe = mk({ id: 'D', country: 'UA', eventType: 'Military Strike', published: '2026-07-30T09:00:00Z' });
    const otherCountry = mk({ id: 'X', country: 'PL', eventType: 'Military Strike', published: '2026-07-30T09:00:00Z' });
    const otherType = mk({ id: 'Y', country: 'UA', eventType: 'Protest', published: '2026-07-30T09:00:00Z' });
    const out = relatedEvents(target, [target, rel, dupe, otherCountry, otherType], new Set(['D']));
    expect(out.map((i) => i.id)).toEqual(['R']);
  });

  it('falls back to category as the relation key when eventType is absent', () => {
    const t2 = mk({ id: 'T2', country: 'US', category: 'cyber', published: '2026-07-30T10:00:00Z' });
    const rel = mk({ id: 'C', country: 'US', category: 'cyber', published: '2026-07-29T10:00:00Z' });
    expect(relatedEvents(t2, [t2, rel], new Set()).map((i) => i.id)).toEqual(['C']);
  });

  it('returns [] when the target has no country or no relation key', () => {
    const noCountry = mk({ id: 'NC', eventType: 'Military Strike' });
    const noKey = mk({ id: 'NK', country: 'UA' });
    expect(relatedEvents(noCountry, [noCountry], new Set())).toEqual([]);
    expect(relatedEvents(noKey, [noKey], new Set())).toEqual([]);
  });

  it('excludes events outside the window and caps the result', () => {
    const old = mk({ id: 'O', country: 'UA', eventType: 'Military Strike', published: '2026-06-01T10:00:00Z' });
    const many = Array.from({ length: 12 }, (_, n) =>
      mk({ id: `M${String(n).padStart(2, '0')}`, country: 'UA', eventType: 'Military Strike', published: `2026-07-2${3 + (n % 6)}T10:00:00Z` }));
    const out = relatedEvents(target, [target, old, ...many], new Set(), { max: 8 });
    expect(out).toHaveLength(8);
    expect(out.some((i) => i.id === 'O')).toBe(false);
  });
});
