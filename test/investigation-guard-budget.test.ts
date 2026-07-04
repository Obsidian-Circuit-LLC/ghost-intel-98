import { describe, it, expect } from 'vitest';
import { createGuard, checkBudget, recordAction, pause, resume, stop, type ProposedAction } from '../src/main/investigation/guard';

const budget = { maxPivots: 3, maxDepth: 2, maxWallClockMs: 10_000, maxTokens: 1000 };
const act = (o: Partial<ProposedAction> = {}): ProposedAction =>
  ({ transformId: 't', transformActive: false, entityId: 'e', entityValue: 'evil.tld', depth: 0, estTokens: 100, ...o });

describe('guard budget rail', () => {
  it('allows an action within budget (checkBudget returns null)', () => {
    const g = createGuard(budget, 0);
    expect(checkBudget(g, act(), 5_000)).toBeNull();
  });
  it('denies once maxPivots is reached', () => {
    const g = createGuard(budget, 0);
    for (let i = 0; i < 3; i++) recordAction(g, act(), 100);
    expect(checkBudget(g, act(), 0)).toBe('budget-pivots');
  });
  it('denies past the wall-clock ceiling', () => {
    const g = createGuard(budget, 0);
    expect(checkBudget(g, act(), 10_000)).toBe('budget-wallclock');
  });
  it('denies beyond max depth', () => {
    const g = createGuard(budget, 0);
    expect(checkBudget(g, act({ depth: 3 }), 0)).toBe('budget-depth');
  });
  it('denies when the estimated tokens would exceed the ceiling', () => {
    const g = createGuard(budget, 0);
    recordAction(g, act(), 950);
    expect(checkBudget(g, act({ estTokens: 100 }), 0)).toBe('budget-tokens');
  });
  it('recordAction accrues pivots + tokens deterministically', () => {
    const g = createGuard(budget, 0);
    recordAction(g, act(), 200);
    expect(g.spentPivots).toBe(1);
    expect(g.spentTokens).toBe(200);
  });
  it('pause/resume/stop flip the flags', () => {
    const g = createGuard(budget, 0);
    pause(g); expect(g.paused).toBe(true);
    resume(g); expect(g.paused).toBe(false);
    stop(g, 'user'); expect(g.stopped).toBe(true); expect(g.stopReason).toBe('user');
  });
  it('the depth/token ceilings are inclusive at the boundary (pins > vs >=)', () => {
    const g = createGuard(budget, 0);
    expect(checkBudget(g, act({ depth: 2 }), 0)).toBeNull();          // depth === maxDepth is allowed
    expect(checkBudget(g, act({ depth: 3 }), 0)).toBe('budget-depth'); // one past is denied
    recordAction(g, act(), 900);
    expect(checkBudget(g, act({ estTokens: 100 }), 0)).toBeNull();    // spent+est === maxTokens is allowed
    expect(checkBudget(g, act({ estTokens: 101 }), 0)).toBe('budget-tokens'); // one over is denied
  });
});
