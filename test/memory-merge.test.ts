import { describe, it, expect } from 'vitest';
import { detectConflicts, mergeItems } from '../src/main/services/memory/graph/merge';
import type { MemoryItem } from '../src/main/services/memory/profile/types';

function item(over: Partial<MemoryItem> & { id: string }): MemoryItem {
  return {
    id: over.id,
    scope: 'global',
    text: over.text ?? over.normalized ?? '',
    normalized: over.normalized ?? (over.text ?? '').toLowerCase(),
    provenance: over.provenance ?? [],
    confidence: over.confidence ?? 0.5,
    createdAt: over.createdAt ?? 0,
    lastSeenAt: over.lastSeenAt ?? 0,
    pinned: over.pinned ?? false,
    source: over.source ?? 'extractor'
  };
}

describe('memory/graph/merge', () => {
  it('mergeItems unions provenance, keeps the higher confidence, and drops the other', () => {
    const items = [
      item({ id: 'a', normalized: "operator's favourite colour is blue", confidence: 0.4, provenance: ['conversation:1'] }),
      item({ id: 'b', normalized: "operator's favourite colour is blue", confidence: 0.9, provenance: ['conversation:2'] })
    ];
    const out = mergeItems(items, 'a', 'b', 1000);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
    expect(out[0].confidence).toBe(0.9);
    expect([...out[0].provenance].sort()).toEqual(['conversation:1', 'conversation:2']);
    expect(out[0].lastSeenAt).toBe(1000);
  });

  it('mergeItems returns items unchanged when either id is missing', () => {
    const items = [item({ id: 'a' })];
    expect(mergeItems(items, 'a', 'missing', 1)).toBe(items);
  });

  it('detectConflicts finds an obvious contradiction and ignores unrelated items', () => {
    const items = [
      item({ id: 'a', normalized: "operator's favourite colour is blue" }),
      item({ id: 'b', normalized: "operator's favourite colour is red" }),
      item({ id: 'c', normalized: "operator's favourite food is pizza" })
    ];
    const pairs = detectConflicts(items);
    expect(pairs).toEqual([['a', 'b']]);
  });

  it('detectConflicts ignores items with no separable subject prefix', () => {
    const items = [item({ id: 'a', normalized: 'blue' }), item({ id: 'b', normalized: 'red' })];
    expect(detectConflicts(items)).toEqual([]);
  });
});
