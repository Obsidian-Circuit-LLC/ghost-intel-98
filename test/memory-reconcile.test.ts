import { describe, it, expect } from 'vitest';
import { reconcile } from '../src/main/services/memory/profile/reconcile';
import { normalizeItemText, type MemoryItem } from '../src/main/services/memory/profile/types';

function item(over: Partial<MemoryItem>): MemoryItem {
  return {
    id: 'i1',
    scope: 'global',
    text: 'Prefers Tor-only egress',
    normalized: normalizeItemText('Prefers Tor-only egress'),
    provenance: ['note:foo'],
    confidence: 0.5,
    createdAt: 1000,
    lastSeenAt: 1000,
    pinned: false,
    source: 'extractor',
    ...over
  };
}

function idFactory(prefix = 'new'): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

const DAY = 24 * 60 * 60 * 1000;

describe('reconcile', () => {
  it('creates a new item for a candidate with no existing match', () => {
    const out = reconcile({
      existing: [],
      candidates: [{ scope: 'global', text: 'Uses Tor-only egress', provenance: ['note:a'] }],
      now: 5000,
      newId: idFactory()
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'new-0',
      scope: 'global',
      text: 'Uses Tor-only egress',
      normalized: normalizeItemText('Uses Tor-only egress'),
      provenance: ['note:a'],
      confidence: 0.25,
      createdAt: 5000,
      lastSeenAt: 5000,
      pinned: false,
      source: 'extractor'
    });
  });

  it('reinforces a matching existing item: confidence increases (capped at 1), provenance merges, one item total', () => {
    const existing = [item({ id: 'e1', confidence: 0.5, provenance: ['note:foo'], lastSeenAt: 1000 })];
    const out = reconcile({
      existing,
      candidates: [{ scope: 'global', text: 'PREFERS   tor-only egress', provenance: ['note:bar'] }],
      now: 2000,
      newId: idFactory()
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('e1');
    expect(out[0].confidence).toBeCloseTo(0.75);
    expect(out[0].lastSeenAt).toBe(2000);
    expect(out[0].provenance.sort()).toEqual(['note:bar', 'note:foo']);
  });

  it('caps reinforced confidence at 1', () => {
    const existing = [item({ id: 'e1', confidence: 0.9 })];
    const out = reconcile({
      existing,
      candidates: [{ scope: 'global', text: 'Prefers Tor-only egress', provenance: ['note:x'] }],
      now: 2000,
      newId: idFactory()
    });
    expect(out[0].confidence).toBe(1);
  });

  it('expires a stale non-pinned item that decays below the floor', () => {
    // confidence 0.2, 30 days idle at default decayPerDay 0.02 -> -0.6, well below floor 0.1
    const existing = [item({ id: 'stale', confidence: 0.2, lastSeenAt: 0, pinned: false })];
    const out = reconcile({
      existing,
      candidates: [],
      now: 30 * DAY,
      newId: idFactory()
    });
    expect(out).toEqual([]);
  });

  it('decays a non-pinned item but keeps it when still above the floor', () => {
    const existing = [item({ id: 'ok', confidence: 0.5, lastSeenAt: 0, pinned: false })];
    const out = reconcile({
      existing,
      candidates: [],
      now: 5 * DAY,
      newId: idFactory()
    });
    // 0.5 - 0.02*5 = 0.4
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBeCloseTo(0.4);
  });

  it('pinned items are exempt from decay and expiry, and survive far past the floor', () => {
    const existing = [item({ id: 'pinned1', confidence: 1, pinned: true, lastSeenAt: 0 })];
    const out = reconcile({
      existing,
      candidates: [],
      now: 365 * DAY,
      newId: idFactory()
    });
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(1);
    expect(out[0].pinned).toBe(true);
  });

  it('a candidate matching a pinned item bumps lastSeenAt + provenance but not confidence', () => {
    const existing = [
      item({ id: 'pinned1', confidence: 1, pinned: true, lastSeenAt: 0, provenance: ['note:foo'] })
    ];
    const out = reconcile({
      existing,
      candidates: [{ scope: 'global', text: 'Prefers Tor-only egress', provenance: ['note:bar'] }],
      now: 999,
      newId: idFactory()
    });
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(1);
    expect(out[0].lastSeenAt).toBe(999);
    expect(out[0].provenance.sort()).toEqual(['note:bar', 'note:foo']);
  });

  it('matches candidates by (scope, normalized) — same text, different scope creates a separate item', () => {
    const existing = [item({ id: 'g1', scope: 'global', confidence: 0.5, lastSeenAt: 100 })];
    const out = reconcile({
      existing,
      candidates: [{ scope: 'case:c1', text: 'Prefers Tor-only egress', provenance: ['note:c1'] }],
      now: 100,
      newId: idFactory()
    });
    expect(out).toHaveLength(2);
    const byScope = new Map(out.map((i) => [i.scope, i]));
    expect(byScope.get('global')!.id).toBe('g1');
    expect(byScope.get('case:c1')!.id).toBe('new-0');
  });

  it('honours custom confidenceGain, decayPerDay, and expireFloor', () => {
    const out1 = reconcile({
      existing: [],
      candidates: [{ scope: 'global', text: 'custom gain', provenance: [] }],
      now: 0,
      confidenceGain: 0.4,
      newId: idFactory()
    });
    expect(out1[0].confidence).toBe(0.4);

    const existing = [item({ id: 'e1', confidence: 0.5, lastSeenAt: 0 })];
    const out2 = reconcile({
      existing,
      candidates: [],
      now: 10 * DAY,
      decayPerDay: 0.1,
      expireFloor: 0,
      newId: idFactory()
    });
    // 0.5 - 0.1*10 = -0.5, clamped? Spec doesn't require clamping >=0 explicitly beyond expiry floor;
    // with expireFloor 0 the item is dropped once below 0.
    expect(out2).toEqual([]);
  });

  it('output is sorted deterministically: pinned desc, confidence desc, id asc', () => {
    const existing = [
      item({ id: 'b', confidence: 0.6, pinned: false, lastSeenAt: 100 }),
      item({ id: 'a', confidence: 0.6, pinned: false, lastSeenAt: 100 }),
      item({ id: 'z-pinned', confidence: 0.3, pinned: true, lastSeenAt: 100 })
    ];
    const out = reconcile({ existing, candidates: [], now: 100, newId: idFactory() });
    expect(out.map((i) => i.id)).toEqual(['z-pinned', 'a', 'b']);
  });

  it('multiple candidates against the same new text within one call still yield a single item', () => {
    const out = reconcile({
      existing: [],
      candidates: [
        { scope: 'global', text: 'Uses a hardware wallet', provenance: ['note:a'] },
        { scope: 'global', text: 'uses a HARDWARE wallet', provenance: ['note:b'] }
      ],
      now: 0,
      newId: idFactory()
    });
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBeCloseTo(0.5); // two reinforcements of 0.25 each: 0.25 then +0.25
    expect(out[0].provenance.sort()).toEqual(['note:a', 'note:b']);
  });
});
