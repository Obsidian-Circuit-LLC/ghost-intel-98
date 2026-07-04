import { describe, it, expect } from 'vitest';
import { createGuard, recordAction, isDuplicate, recordProgress, noProgress, type ProposedAction } from '../src/main/investigation/guard';

const budget = { maxPivots: 10, maxDepth: 5, maxWallClockMs: 99_999, maxTokens: 99_999 };
const act = (o: Partial<ProposedAction> = {}): ProposedAction =>
  ({ transformId: 'whois', transformActive: false, entityId: 'e1', entityValue: 'evil.tld', depth: 0, estTokens: 0, ...o });

describe('guard dedup + no-progress', () => {
  it('a transform+entity already run is a duplicate; a new pair is not', () => {
    const g = createGuard(budget, 0);
    expect(isDuplicate(g, act())).toBe(false);
    recordAction(g, act(), 0);
    expect(isDuplicate(g, act())).toBe(true);                       // same transform+entity
    expect(isDuplicate(g, act({ entityId: 'e2' }))).toBe(false);    // different entity
    expect(isDuplicate(g, act({ transformId: 'dns' }))).toBe(false);// different transform
  });
  it('noProgress is true when the last N entity counts are unchanged', () => {
    const g = createGuard(budget, 0);
    recordProgress(g, 5); recordProgress(g, 5); recordProgress(g, 5);
    expect(noProgress(g, 3)).toBe(true);
  });
  it('noProgress is false when a recent turn added entities', () => {
    const g = createGuard(budget, 0);
    recordProgress(g, 5); recordProgress(g, 5); recordProgress(g, 6);
    expect(noProgress(g, 3)).toBe(false);
  });
  it('noProgress is false before there are `window` turns of history', () => {
    const g = createGuard(budget, 0);
    recordProgress(g, 5); recordProgress(g, 5);
    expect(noProgress(g, 3)).toBe(false);
  });
});
