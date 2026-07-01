import { describe, it, expect } from 'vitest';
import { groupItemsByScope, formatRecallProvenance } from '../src/renderer/modules/ai-assistant/memory-view';
import { normalizeItemText } from '../src/main/services/memory/profile/types';
import type { MemoryItem, RecallHitShape } from '../src/shared/ipc-contracts';

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

function hit(over: Partial<RecallHitShape>): RecallHitShape {
  return {
    caseId: 'c1',
    caseTitle: 'Op Nightshade',
    kind: 'note',
    ref: 'n1',
    text: 'full text',
    snippet: 'full text',
    score: 0.9,
    ...over
  };
}

describe('groupItemsByScope', () => {
  it('returns [] for no items', () => {
    expect(groupItemsByScope([])).toEqual([]);
  });

  it('labels global as General, case:x as Case x, subject:h as @h', () => {
    const items = [
      item({ id: 'a', scope: 'global' }),
      item({ id: 'b', scope: 'case:c1' }),
      item({ id: 'c', scope: 'subject:someHandle' })
    ];
    const groups = groupItemsByScope(items);
    const byScope = new Map(groups.map((g) => [g.scope, g.label]));
    expect(byScope.get('global')).toBe('General');
    expect(byScope.get('case:c1')).toBe('Case c1');
    expect(byScope.get('subject:someHandle')).toBe('@someHandle');
  });

  it('sorts groups with General first, then alphabetically by label', () => {
    const items = [
      item({ id: 'a', scope: 'case:zeta' }),
      item({ id: 'b', scope: 'case:beta' }),
      item({ id: 'c', scope: 'global' }),
      item({ id: 'd', scope: 'case:alpha' })
    ];
    const groups = groupItemsByScope(items);
    expect(groups.map((g) => g.scope)).toEqual(['global', 'case:alpha', 'case:beta', 'case:zeta']);
  });

  it('orders items within a group pinned-first then confidence desc', () => {
    const items = [
      item({ id: 'low', scope: 'global', confidence: 0.3 }),
      item({ id: 'high', scope: 'global', confidence: 0.9 }),
      item({ id: 'pinned-low', scope: 'global', confidence: 0.1, pinned: true })
    ];
    const groups = groupItemsByScope(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['pinned-low', 'high', 'low']);
  });

  it('breaks ties deterministically by id asc', () => {
    const items = [
      item({ id: 'b', scope: 'global', confidence: 0.5 }),
      item({ id: 'a', scope: 'global', confidence: 0.5 })
    ];
    const groups = groupItemsByScope(items);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('formatRecallProvenance', () => {
  it('returns [] for no rag hits and no profile items', () => {
    expect(formatRecallProvenance([], [])).toEqual([]);
  });

  it('labels rag hits by case title, kind, and ref', () => {
    const out = formatRecallProvenance([hit({ caseTitle: 'Op Nightshade', kind: 'note', ref: 'n1' })], []);
    expect(out).toEqual(['Case “Op Nightshade” › note:n1']);
  });

  it('labels profile items as Memory: <text>', () => {
    const out = formatRecallProvenance([], [item({ id: 'a', text: 'Uses Tor-only egress' })]);
    expect(out).toEqual(['Memory: Uses Tor-only egress']);
  });

  it('truncates long memory text', () => {
    const longText = 'x'.repeat(200);
    const out = formatRecallProvenance([], [item({ id: 'a', text: longText })]);
    expect(out[0]!.length).toBeLessThan(200);
    expect(out[0]!.startsWith('Memory: ')).toBe(true);
    expect(out[0]!.endsWith('…')).toBe(true);
  });

  it('combines rag hits then profile items, in input order', () => {
    const out = formatRecallProvenance(
      [hit({ caseTitle: 'A', kind: 'desc', ref: 'r1' }), hit({ caseTitle: 'B', kind: 'file', ref: 'r2' })],
      [item({ id: 'a', text: 'fact one' })]
    );
    expect(out).toEqual([
      'Case “A” › desc:r1',
      'Case “B” › file:r2',
      'Memory: fact one'
    ]);
  });
});
