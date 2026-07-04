import { describe, it, expect } from 'vitest';
import { applyBondBoost, type RecallHit } from '../src/main/services/memory/retriever';

// applyBondBoost re-sorts with the production tie-break; with no neighbors it is a pure sort, so
// it is a convenient vehicle for asserting the tie-break is a total order (input-order-independent).
const hit = (caseId: string, id: string, score: number): RecallHit =>
  ({ caseId, caseTitle: caseId, kind: 'doc', ref: 'same-ref', text: 't', snippet: 't', score, id });

const noNeighbors = () => new Set<string>();

describe('recall ordering determinism', () => {
  it('equal score + equal ref → unique total order independent of input order', () => {
    const a = hit('A', 'x1', 0.5);
    const b = hit('B', 'x2', 0.5);

    const forward = applyBondBoost([a, b], noNeighbors).map((h) => `${h.caseId}/${h.id}`);
    const reversed = applyBondBoost([b, a], noNeighbors).map((h) => `${h.caseId}/${h.id}`);

    expect(forward).toEqual(reversed);
    // tie broken by `${caseId} ${id}` ascending → A before B
    expect(forward).toEqual(['A/x1', 'B/x2']);
  });

  it('two hits sharing caseId are still totally ordered by their unique chunk id', () => {
    const a = hit('C', 'id-aaa', 0.7);
    const b = hit('C', 'id-bbb', 0.7);
    const forward = applyBondBoost([a, b], noNeighbors).map((h) => h.id);
    const reversed = applyBondBoost([b, a], noNeighbors).map((h) => h.id);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(['id-aaa', 'id-bbb']);
  });
});
