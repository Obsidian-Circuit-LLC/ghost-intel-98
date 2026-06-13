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
  it('normalizes a Unicode host to punycode (H3)', () => {
    expect(normalizeHost('MÜNCHEN.de.')).toBe('xn--mnchen-3ya.de');
  });
  it('a Unicode host matches a punycode rule (H3)', () => {
    expect(domainRuleMatches('xn--mnchen-3ya.de', 'münchen.de')).toBe(true);
  });
  it('a punycode host matches a Unicode rule (H3)', () => {
    expect(domainRuleMatches('münchen.de', 'xn--mnchen-3ya.de')).toBe(true);
  });
  it('a Unicode wildcard rule matches a Unicode subdomain host (H3)', () => {
    expect(domainRuleMatches('*.münchen.de', 'shop.münchen.de')).toBe(true);
  });
  it('a confusable Cyrillic host does NOT match the Latin rule (H3)', () => {
    // host uses Cyrillic "а" (U+0430); rule is all-Latin ASCII
    expect(domainRuleMatches('paypal.com', 'pаypal.com')).toBe(false);
  });
});
