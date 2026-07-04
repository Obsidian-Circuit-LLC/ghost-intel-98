import { describe, it, expect } from 'vitest';
import { createGuard, recordAction, recordProgress, addToScope, stop, pause, checkAction, shouldStop, type ProposedAction } from '../src/main/investigation/guard';

const budget = { maxPivots: 2, maxDepth: 2, maxWallClockMs: 10_000, maxTokens: 1000 };
const act = (o: Partial<ProposedAction> = {}): ProposedAction =>
  ({ transformId: 't', transformActive: false, entityId: 'e1', entityValue: 'evil.tld', depth: 0, estTokens: 100, ...o });

describe('checkAction (composed rails, priority order)', () => {
  it('allows a fresh, in-budget, passive action', () => {
    expect(checkAction(createGuard(budget, 0), act(), 0)).toEqual({ allow: true });
  });
  it('stopped beats everything', () => {
    const g = createGuard(budget, 0); stop(g, 'user');
    expect(checkAction(g, act(), 0)).toEqual({ allow: false, reason: 'stopped' });
  });
  it('paused denies', () => {
    const g = createGuard(budget, 0); pause(g);
    expect(checkAction(g, act(), 0)).toEqual({ allow: false, reason: 'paused' });
  });
  it('a duplicate is denied', () => {
    const g = createGuard(budget, 0); recordAction(g, act(), 100);
    expect(checkAction(g, act(), 0)).toEqual({ allow: false, reason: 'duplicate' });
  });
  it('an ACTIVE transform on an out-of-scope target is denied; in-scope is allowed', () => {
    const g = createGuard(budget, 0);
    expect(checkAction(g, act({ transformActive: true }), 0)).toEqual({ allow: false, reason: 'not-authorized-target' });
    addToScope(g, 'evil.tld');
    expect(checkAction(g, act({ transformActive: true }), 0)).toEqual({ allow: true });
  });
  it('budget denial (pivots) outranks a scope issue', () => {
    const g = createGuard(budget, 0); recordAction(g, act(), 0); recordAction(g, act({ entityId: 'e2' }), 0);
    expect(checkAction(g, act({ entityId: 'e3', transformActive: true }), 0)).toEqual({ allow: false, reason: 'budget-pivots' });
  });
});

describe('shouldStop', () => {
  it('does not stop a fresh run', () => {
    expect(shouldStop(createGuard(budget, 0), 0, 3)).toEqual({ stop: false, reason: null });
  });
  it('stops when explicitly stopped, carrying the reason', () => {
    const g = createGuard(budget, 0); stop(g, 'user');
    expect(shouldStop(g, 0, 3)).toEqual({ stop: true, reason: 'user' });
  });
  it('stops when the pivot budget is exhausted', () => {
    const g = createGuard(budget, 0); recordAction(g, act(), 0); recordAction(g, act({ entityId: 'e2' }), 0);
    expect(shouldStop(g, 0, 3)).toEqual({ stop: true, reason: 'budget-pivots' });
  });
  it('stops on the wall-clock ceiling', () => {
    expect(shouldStop(createGuard(budget, 0), 10_000, 3)).toEqual({ stop: true, reason: 'budget-wallclock' });
  });
  it('stops when the last `window` turns made no progress', () => {
    const g = createGuard(budget, 0); recordProgress(g, 4); recordProgress(g, 4); recordProgress(g, 4);
    expect(shouldStop(g, 0, 3)).toEqual({ stop: true, reason: 'no-progress' });
  });
});
