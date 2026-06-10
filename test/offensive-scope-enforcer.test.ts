import { describe, it, expect } from 'vitest';
import { decide, type ResolvedTarget } from '../src/main/offensive/scope-enforcer';
import { parseScopeManifest } from '../src/main/offensive/scope-manifest';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const base = { manifestId: 'e', mode: 'engagement', expiresAt: '2026-06-11T00:00:00Z' };
const mk = (include: unknown[], exclude: unknown[] = []) =>
  parseScopeManifest({ ...base, include, exclude }, NOW);
const t = (host: string, ips: string[]): ResolvedTarget => ({ host, ips });

describe('decide', () => {
  it('allows an in-scope CIDR target', () => {
    const m = mk([{ kind: 'cidr', value: '10.0.0.0/8' }]);
    expect(decide(m, t('h', ['10.1.1.1']), NOW).allow).toBe(true);
  });
  it('denies when ANY resolved IP is out of scope (dual-stack)', () => {
    const m = mk([{ kind: 'cidr', value: '10.0.0.0/8' }]);
    expect(decide(m, t('h', ['10.1.1.1', '2001:db8::1']), NOW).allow).toBe(false);
  });
  it('exclude wins over include', () => {
    const m = mk([{ kind: 'cidr', value: '10.0.0.0/8' }], [{ kind: 'cidr', value: '10.9.0.0/16' }]);
    expect(decide(m, t('h', ['10.9.0.1']), NOW).allow).toBe(false);
  });
  it('allows an in-scope domain target regardless of IP (domain rule)', () => {
    const m = mk([{ kind: 'domain', value: '*.example.com' }]);
    expect(decide(m, t('a.example.com', ['203.0.113.5']), NOW).allow).toBe(true);
  });
  it('denies expired', () => {
    const m = mk([{ kind: 'cidr', value: '10.0.0.0/8' }]);
    expect(decide(m, t('h', ['10.1.1.1']), Date.parse('2026-06-12T00:00:00Z')).allow).toBe(false);
  });
  it('deny-by-default for an unmatched target', () => {
    const m = mk([{ kind: 'domain', value: 'example.com' }]);
    expect(decide(m, t('other.com', ['8.8.8.8']), NOW).allow).toBe(false);
  });
});
