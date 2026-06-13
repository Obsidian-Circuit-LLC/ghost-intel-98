import { describe, it, expect } from 'vitest';
import { buildNetnsNftRuleset } from '../src/main/offensive/confinement/linux-netns';

// The nft ruleset STRING construction is the pure, groundable core of the netns jail
// (Task 3). It is platform-independent (just builds a string), so it is unit-testable
// off-Linux. The live mechanism is proven separately by the tcpdump gate (Task 4).

describe('buildNetnsNftRuleset', () => {
  it('emits a drop-by-default output chain', () => {
    const rs = buildNetnsNftRuleset(18443, ['203.0.113.0/24']);
    expect(rs).toContain('type filter hook output priority 0; policy drop;');
  });

  it('accepts lo, established/related, the proxy path, and the v4 allow set', () => {
    const rs = buildNetnsNftRuleset(18443, ['203.0.113.0/24', '198.51.100.0/24']);
    expect(rs).toContain('oif "lo" accept');
    expect(rs).toContain('ct state established,related accept');
    expect(rs).toContain('ip daddr 10.255.255.0 tcp dport 18443 accept');
    expect(rs).toContain('ip daddr { 203.0.113.0/24, 198.51.100.0/24 } accept');
  });

  it('never emits an unconditional udp/53 accept (DNS must hit the drop policy)', () => {
    const rs = buildNetnsNftRuleset(18443, ['203.0.113.0/24']);
    expect(rs).not.toMatch(/udp dport 53 accept/);
    expect(rs).not.toMatch(/dport 53/);
  });

  it('partitions v4 and v6 allow CIDRs into ip and ip6 daddr sets', () => {
    const rs = buildNetnsNftRuleset(443, ['203.0.113.0/24', '2001:db8::/32']);
    expect(rs).toContain('ip daddr { 203.0.113.0/24 } accept');
    expect(rs).toContain('ip6 daddr { 2001:db8::/32 } accept');
  });

  it('omits an allow-set line when a family has no CIDRs (nft rejects empty sets)', () => {
    const v4only = buildNetnsNftRuleset(443, ['203.0.113.0/24']);
    expect(v4only).not.toContain('ip6 daddr');
    const v6only = buildNetnsNftRuleset(443, ['2001:db8::/32']);
    expect(v6only).not.toMatch(/\bip daddr \{/); // proxy-path "ip daddr 10..." has no brace
  });

  it('emits a valid ruleset even with zero allow CIDRs (proxy-only jail)', () => {
    const rs = buildNetnsNftRuleset(9050, []);
    expect(rs).toContain('policy drop;');
    expect(rs).toContain('ip daddr 10.255.255.0 tcp dport 9050 accept');
    expect(rs).not.toMatch(/daddr \{/);
  });

  it('honours an explicit host-veth IP override', () => {
    const rs = buildNetnsNftRuleset(8080, ['10.0.0.0/8'], '10.200.0.0');
    expect(rs).toContain('ip daddr 10.200.0.0 tcp dport 8080 accept');
  });

  it('rejects an out-of-range proxy port', () => {
    expect(() => buildNetnsNftRuleset(0, [])).toThrow();
    expect(() => buildNetnsNftRuleset(70000, [])).toThrow();
    expect(() => buildNetnsNftRuleset(1.5, [])).toThrow();
  });
});
