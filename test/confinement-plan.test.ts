import { describe, it, expect } from 'vitest';
import { buildConfinementPlan } from '../src/main/offensive/confinement/plan';
import type { ScopeRule, ScopeManifest } from '../src/main/offensive/scope-manifest';

const future = '2999-01-01T00:00:00Z';

// Minimal valid manifest carrying the supplied include rules. The builder only
// reads `include`, but we keep the shape complete so the type checks honestly.
function base(include: ScopeRule[]): ScopeManifest {
  return {
    manifestId: 'eng-1',
    mode: 'engagement',
    expiresAt: future,
    include,
    exclude: [],
  };
}

describe('buildConfinementPlan', () => {
  it('keeps only CIDR includes in allowCidrs and records domains separately', () => {
    const plan = buildConfinementPlan(
      base([
        { kind: 'cidr', value: '10.0.0.0/8' },
        { kind: 'domain', value: 'example.com' },
        { kind: 'cidr', value: '2001:db8::/32' },
      ]),
      9050,
    );
    expect(plan.proxyPort).toBe(9050);
    expect(plan.allowCidrs).toEqual(['10.0.0.0/8', '2001:db8::/32']);
    expect(plan.domainOnlyIncludes).toEqual(['example.com']);
  });

  it('throws on a malformed CIDR include', () => {
    expect(() =>
      buildConfinementPlan(base([{ kind: 'cidr', value: 'not-a-cidr' }]), 9050),
    ).toThrow(/invalid CIDR/);
  });

  it('rejects CIDR_RE-shaped but semantically-invalid CIDRs (bad base / out-of-range prefix)', () => {
    // These all pass the permissive CIDR_RE but must NOT become OS firewall rules.
    for (const bad of ['999.999.999.999/8', '203.0.113.0/99', '2001:db8::/200', '10.0.0.0/300']) {
      expect(() => buildConfinementPlan(base([{ kind: 'cidr', value: bad }]), 9050), bad).toThrow(/invalid CIDR/);
    }
  });

  it('throws on an out-of-range proxy port', () => {
    expect(() => buildConfinementPlan(base([]), 0)).toThrow(/proxy port/);
    expect(() => buildConfinementPlan(base([]), 70000)).toThrow(/proxy port/);
    expect(() => buildConfinementPlan(base([]), 1024.5)).toThrow(/proxy port/);
  });

  it('returns empty allow-sets for an empty include with a valid port', () => {
    const plan = buildConfinementPlan(base([]), 1080);
    expect(plan.proxyPort).toBe(1080);
    expect(plan.allowCidrs).toEqual([]);
    expect(plan.domainOnlyIncludes).toEqual([]);
  });
});
