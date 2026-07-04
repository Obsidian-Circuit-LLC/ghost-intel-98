import { describe, it, expect } from 'vitest';
import { createGuard, isAuthorized, addToScope, removeFromScope } from '../src/main/investigation/guard';

const budget = { maxPivots: 10, maxDepth: 5, maxWallClockMs: 99_999, maxTokens: 99_999 };

describe('guard authorized-target scope', () => {
  it('exact match is authorized; unrelated is not', () => {
    const s = new Set(['evil.tld']);
    expect(isAuthorized(s, 'evil.tld')).toBe(true);
    expect(isAuthorized(s, 'good.tld')).toBe(false);
  });
  it('a subdomain of an authorized domain is authorized, but a lookalike is not', () => {
    const s = new Set(['evil.tld']);
    expect(isAuthorized(s, 'sub.evil.tld')).toBe(true);
    expect(isAuthorized(s, 'evil.tld.attacker.com')).toBe(false); // NOT a subdomain of evil.tld
  });
  it('empty scope authorizes nothing', () => {
    expect(isAuthorized(new Set(), 'evil.tld')).toBe(false);
  });
  it('add/remove mutate the run scope', () => {
    const g = createGuard(budget, 0);
    addToScope(g, 'evil.tld');
    expect(isAuthorized(g.scope, 'evil.tld')).toBe(true);
    removeFromScope(g, 'evil.tld');
    expect(isAuthorized(g.scope, 'evil.tld')).toBe(false);
  });
});
