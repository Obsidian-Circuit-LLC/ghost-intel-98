import type { ScopeManifest, ScopeRule } from './scope-manifest';
import { cidrContains } from './net-match';
import { domainRuleMatches } from './domain-match';

export type ScopeDecision = { allow: true } | { allow: false; reason: string };
export interface ResolvedTarget { host: string; ips: string[]; }

const ipMatches = (rule: ScopeRule, ip: string): boolean => rule.kind === 'cidr' && cidrContains(rule.value, ip);
const hostMatches = (rule: ScopeRule, host: string): boolean => rule.kind === 'domain' && domainRuleMatches(rule.value, host);

export function decide(m: ScopeManifest, t: ResolvedTarget, now: number): ScopeDecision {
  if (now >= Date.parse(m.expiresAt)) return { allow: false, reason: 'scope expired' };
  if (m.notBefore && now < Date.parse(m.notBefore)) return { allow: false, reason: 'scope not yet active' };
  if (t.ips.length === 0) return { allow: false, reason: 'no resolved address' };

  for (const ex of m.exclude) {
    if (hostMatches(ex, t.host)) return { allow: false, reason: `host excluded: ${ex.value}` };
    for (const ip of t.ips) if (ipMatches(ex, ip)) return { allow: false, reason: `ip ${ip} excluded: ${ex.value}` };
  }
  const hostIncluded = m.include.some((r) => hostMatches(r, t.host));
  if (hostIncluded) return { allow: true };
  const allIpsIncluded = t.ips.every((ip) => m.include.some((r) => ipMatches(r, ip)));
  if (allIpsIncluded) return { allow: true };
  return { allow: false, reason: 'target not in scope' };
}
