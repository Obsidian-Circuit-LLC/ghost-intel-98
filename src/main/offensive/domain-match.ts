import { domainToASCII } from 'node:url';

export function normalizeHost(host: string): string {
  let s = host.trim().toLowerCase();
  if (s.endsWith('.')) s = s.slice(0, -1);
  // Convert Unicode/IDN labels to their punycode (xn--) ASCII form so that a Unicode
  // host and a punycode rule (or vice versa) compare equal, and a confusable mixed-script
  // host maps to a *different* punycode than the Latin rule (so it fails to match).
  // domainToASCII returns '' on invalid input — fall back to the cleaned string so a
  // malformed host degrades safely (fail-closed: it simply won't match a valid rule).
  const ascii = domainToASCII(s);
  return ascii || s;
}

export function domainRuleMatches(rule: string, host: string): boolean {
  const h = normalizeHost(host).split('.').filter(Boolean);
  if (rule.startsWith('*.')) {
    const base = normalizeHost(rule.slice(2)).split('.').filter(Boolean);
    if (base.length === 0 || h.length <= base.length) return false;
    const suffix = h.slice(h.length - base.length);
    return suffix.length === base.length && suffix.every((l, i) => l === base[i]);
  }
  if (rule.includes('*')) return false;
  const r = normalizeHost(rule).split('.').filter(Boolean);
  return r.length === h.length && r.every((l, i) => l === h[i]);
}
