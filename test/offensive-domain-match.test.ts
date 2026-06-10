import { describe, it, expect } from 'vitest';
import { normalizeHost, domainRuleMatches } from '../src/main/offensive/domain-match';

describe('domain-match', () => {
  it('normalizes case, trailing dot, and punycode', () => {
    expect(normalizeHost('EXAMPLE.com.')).toBe('example.com');
  });
  it('exact rule matches only the exact host', () => {
    expect(domainRuleMatches('example.com', 'example.com')).toBe(true);
    expect(domainRuleMatches('example.com', 'a.example.com')).toBe(false);
    expect(domainRuleMatches('example.com', 'evil-example.com')).toBe(false);
  });
  it('wildcard matches subdomains but not the apex or lookalikes', () => {
    expect(domainRuleMatches('*.example.com', 'a.example.com')).toBe(true);
    expect(domainRuleMatches('*.example.com', 'a.b.example.com')).toBe(true);
    expect(domainRuleMatches('*.example.com', 'example.com')).toBe(false);
    expect(domainRuleMatches('*.example.com', 'example.com.attacker.com')).toBe(false);
    expect(domainRuleMatches('*.example.com', 'notexample.com')).toBe(false);
  });
  it('matches on labels, never substring', () => {
    expect(domainRuleMatches('example.com', 'xexample.com')).toBe(false);
  });
});
