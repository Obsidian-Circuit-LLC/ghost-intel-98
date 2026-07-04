import { describe, it, expect } from 'vitest';
import { scoreConfidence } from '../src/main/investigation/confidence';
import type { EvidenceSignal } from '../src/shared/investigation-types';

const sig = (kind: string, weight: number): EvidenceSignal => ({ kind, weight });

describe('scoreConfidence (deterministic)', () => {
  it('authoritative + corroborating with net weight ≥3 → high / attributed', () => {
    const r = scoreConfidence([sig('authoritative-source', 2), sig('corroborating-source', 1), sig('field-complete', 1)]);
    expect(r.band).toBe('high');
    expect(r.attribution).toBe('attributed');
    expect(r.score).toBe(4);
  });
  it('a contradiction forces unconfirmed regardless of weight', () => {
    const r = scoreConfidence([sig('authoritative-source', 2), sig('corroborating-source', 2), sig('contradiction', -1)]);
    expect(r.attribution).toBe('unconfirmed');
  });
  it('single low-weight signal → low / unattributed', () => {
    const r = scoreConfidence([sig('field-complete', 0)]);
    expect(r.band).toBe('low');
    expect(r.attribution).toBe('unattributed');
  });
  it('score exactly 3 is the high threshold; 2 is still medium (boundary)', () => {
    expect(scoreConfidence([sig('authoritative-source', 2), sig('corroborating-source', 1)]).band).toBe('high'); // score 3
    expect(scoreConfidence([sig('authoritative-source', 2)]).band).toBe('medium'); // score 2
  });
  it('is deterministic: identical input → identical output', () => {
    const s = [sig('authoritative-source', 2), sig('corroborating-source', 1)];
    expect(scoreConfidence(s)).toEqual(scoreConfidence(s));
  });
});
