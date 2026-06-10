import { describe, it, expect } from 'vitest';
import { parseScopeManifest, scopeContentHash, ScopeManifestError } from '../src/main/offensive/scope-manifest';

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
});
