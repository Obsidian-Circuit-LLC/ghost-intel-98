import { describe, it, expect } from 'vitest';
import { selectProfileItems, formatProfileBlock } from '../src/main/services/memory/profile/profile-retriever';
import { normalizeItemText, type MemoryItem } from '../src/main/services/memory/profile/types';

function item(over: Partial<MemoryItem>): MemoryItem {
  return {
    id: 'i1',
    scope: 'global',
    text: 'fact',
    normalized: normalizeItemText('fact'),
    provenance: [],
    confidence: 0.5,
    createdAt: 0,
    lastSeenAt: 0,
    pinned: false,
    source: 'extractor',
    ...over
  };
}

describe('selectProfileItems', () => {
  it('filters to the requested scopes', () => {
    const items = [
      item({ id: 'a', scope: 'global' }),
      item({ id: 'b', scope: 'case:c1' }),
      item({ id: 'c', scope: 'case:c2' })
    ];
    const out = selectProfileItems(items, ['global', 'case:c1']);
    expect(out.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('orders pinned desc, confidence desc, lastSeenAt desc, id asc', () => {
    const items = [
      item({ id: 'b', confidence: 0.6, lastSeenAt: 100 }),
      item({ id: 'a', confidence: 0.6, lastSeenAt: 100 }),
      item({ id: 'recent', confidence: 0.6, lastSeenAt: 200 }),
      item({ id: 'z-pinned', confidence: 0.1, pinned: true, lastSeenAt: 1 })
    ];
    const out = selectProfileItems(items, ['global']);
    expect(out.map((i) => i.id)).toEqual(['z-pinned', 'recent', 'a', 'b']);
  });

  it('caps to the default limit of 8', () => {
    const items = Array.from({ length: 12 }, (_, n) => item({ id: `i${n}`, confidence: 0.5, lastSeenAt: n }));
    const out = selectProfileItems(items, ['global']);
    expect(out).toHaveLength(8);
  });

  it('honours a custom limit', () => {
    const items = Array.from({ length: 5 }, (_, n) => item({ id: `i${n}` }));
    const out = selectProfileItems(items, ['global'], 2);
    expect(out).toHaveLength(2);
  });

  it('returns [] when no items are in scope', () => {
    const items = [item({ id: 'a', scope: 'case:other' })];
    expect(selectProfileItems(items, ['global'])).toEqual([]);
  });
});

describe('formatProfileBlock', () => {
  it('returns "" when there is nothing to show', () => {
    expect(formatProfileBlock([], '')).toBe('');
    expect(formatProfileBlock([], '   ')).toBe('');
  });

  it('includes provenance labels for each item', () => {
    const items = [item({ id: 'a', text: 'Uses Tor-only egress', provenance: ['note:x', 'convo:1'] })];
    const out = formatProfileBlock(items, '');
    expect(out).toContain('Uses Tor-only egress');
    expect(out).toContain('note:x');
    expect(out).toContain('convo:1');
  });

  it('includes the rolling summary when present', () => {
    const out = formatProfileBlock([], 'User prefers Tor-only egress.');
    expect(out).toContain('User prefers Tor-only egress.');
  });

  it('includes both items and summary when both are present', () => {
    const items = [item({ id: 'a', text: 'fact one' })];
    const out = formatProfileBlock(items, 'summary text');
    expect(out).toContain('fact one');
    expect(out).toContain('summary text');
  });
});
