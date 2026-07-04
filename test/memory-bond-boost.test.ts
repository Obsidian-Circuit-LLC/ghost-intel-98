import { describe, it, expect } from 'vitest';
import { applyBondBoost } from '../src/main/services/memory/retriever';
import type { RecallHit } from '../src/main/services/memory/retriever';
const hit = (ref: string, score: number, extra: Partial<RecallHit> = {}): RecallHit =>
  ({ caseId: '__library__', caseTitle: 'Library', kind: 'doc', ref, text: ref, snippet: ref, score, ...extra });
describe('bond boost', () => {
  it('boosts a one-hop neighbor of a top hit and re-sorts, marking viaBond', () => {
    // node ids derived as `doc:<ref>` for this test's nodeIdOf
    const hits = [hit('a', 0.9), hit('b', 0.5)];
    const neighbors = (id: string) => new Set(id === 'doc:a' ? ['doc:b'] : id === 'doc:b' ? ['doc:a'] : []);
    const out = applyBondBoost(hits, neighbors, { boost: 0.15 });
    const b = out.find((h) => h.ref === 'b')!;
    expect(b.score).toBeCloseTo(0.65);
    expect(b.viaBond).toBe(true);
  });
});
