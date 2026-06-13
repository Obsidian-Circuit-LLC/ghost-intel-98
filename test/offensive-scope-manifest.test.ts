import { describe, it, expect } from 'vitest';
import { parseScopeManifest, scopeContentHash, withDefaultExcludes, ScopeManifestError } from '../src/main/offensive/scope-manifest';

const future = '2999-01-01T00:00:00Z';
const good = { manifestId: 'eng-1', mode: 'engagement', expiresAt: future,
  include: [{ kind: 'domain', value: 'example.com' }], exclude: [] };

describe('parseScopeManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(parseScopeManifest(good).manifestId).toBe('eng-1');
  });
  it('rejects a manifest with no include rules', () => {
    expect(() => parseScopeManifest({ ...good, include: [] })).toThrow(ScopeManifestError);
  });
  it('rejects an already-expired manifest', () => {
    expect(() => parseScopeManifest({ ...good, expiresAt: '2000-01-01T00:00:00Z' })).toThrow(ScopeManifestError);
  });
  it('rejects an asn rule (deferred)', () => {
    expect(() => parseScopeManifest({ ...good, include: [{ kind: 'asn', value: 64512 }] })).toThrow(/asn/i);
  });
  it('rejects a bad CIDR and unknown mode', () => {
    expect(() => parseScopeManifest({ ...good, include: [{ kind: 'cidr', value: 'nope' }] })).toThrow(ScopeManifestError);
    expect(() => parseScopeManifest({ ...good, mode: 'x' })).toThrow(ScopeManifestError);
  });
  it('content hash is stable regardless of key order / rule order', () => {
    const a = scopeContentHash(parseScopeManifest(good));
    const b = scopeContentHash(parseScopeManifest({ mode: 'engagement', expiresAt: future, manifestId: 'eng-1',
      exclude: [], include: [{ value: 'example.com', kind: 'domain' }] }));
    expect(a).toBe(b);
  });
  it('stores a Unicode domain rule in punycode form (H3)', () => {
    const m = parseScopeManifest({ ...good, include: [{ kind: 'domain', value: 'münchen.de' }] });
    expect(m.include[0]).toEqual({ kind: 'domain', value: 'xn--mnchen-3ya.de' });
  });
  it('accepts a wildcard Unicode domain rule and stores it in punycode (H3)', () => {
    const m = parseScopeManifest({ ...good, include: [{ kind: 'domain', value: '*.münchen.de' }] });
    expect(m.include[0]).toEqual({ kind: 'domain', value: '*.xn--mnchen-3ya.de' });
  });
  it('accepts an already-punycode domain rule unchanged', () => {
    const m = parseScopeManifest({ ...good, include: [{ kind: 'domain', value: 'xn--mnchen-3ya.de' }] });
    expect(m.include[0]).toEqual({ kind: 'domain', value: 'xn--mnchen-3ya.de' });
  });
});

const lab = { manifestId: 'lab-1', mode: 'lab', expiresAt: future,
  include: [{ kind: 'cidr', value: '127.0.0.0/8' }], exclude: [] };

const cidrs = (m: { exclude: { kind: string; value: string }[] }) =>
  m.exclude.filter((r) => r.kind === 'cidr').map((r) => r.value);

describe('withDefaultExcludes', () => {
  it('always injects cloud-metadata excludes in lab mode (M3)', () => {
    const out = withDefaultExcludes(parseScopeManifest(lab));
    expect(cidrs(out)).toContain('169.254.169.254/32');
    expect(cidrs(out)).toContain('fd00:ec2::254/128');
  });
  it('lab mode does NOT get the full private ranges (loopback labs still work)', () => {
    const out = withDefaultExcludes(parseScopeManifest(lab));
    expect(cidrs(out)).not.toContain('10.0.0.0/8');
    expect(cidrs(out)).not.toContain('127.0.0.0/8');
  });
  it('lab-mode metadata injection is idempotent', () => {
    const out = withDefaultExcludes(parseScopeManifest({ ...lab,
      exclude: [{ kind: 'cidr', value: '169.254.169.254/32' }] }));
    expect(cidrs(out).filter((c) => c === '169.254.169.254/32')).toHaveLength(1);
  });
  it('non-lab modes get the full private ranges plus the metadata /32 (M3)', () => {
    const out = withDefaultExcludes(parseScopeManifest(good));
    expect(cidrs(out)).toContain('10.0.0.0/8');
    expect(cidrs(out)).toContain('169.254.0.0/16');
    expect(cidrs(out)).toContain('169.254.169.254/32');
  });
  it('non-lab injection is idempotent', () => {
    const once = withDefaultExcludes(parseScopeManifest(good));
    const twice = withDefaultExcludes(once);
    expect(cidrs(twice).length).toBe(cidrs(once).length);
  });
});
