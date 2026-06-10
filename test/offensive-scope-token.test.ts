import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { scopeTokenHash, verifyScopeToken, type ScopeToken } from '../src/main/offensive/scope-token';
import type { TrustKeyset } from '../src/main/plugins/trust';

const edSec = ed25519.utils.randomSecretKey();
const pq = ml_dsa65.keygen();
const issuer: TrustKeyset = { edPub: ed25519.getPublicKey(edSec), pqPub: pq.publicKey };
const NOW = Date.parse('2026-06-10T00:00:00Z');

function makeToken(over: Partial<ScopeToken> = {}): ScopeToken {
  const payload = { manifestContentHash: 'abc', engagementId: 'eng-1', issuedAt: '2026-06-10T00:00:00Z',
    nonce: 'n1', expiresAt: '2026-06-11T00:00:00Z', ...over };
  const h = scopeTokenHash(payload);
  const sig = new Uint8Array([...ed25519.sign(h, edSec), ...ml_dsa65.sign(h, pq.secretKey)]);
  return { ...payload, signatureHex: Buffer.from(sig).toString('hex') };
}

describe('verifyScopeToken', () => {
  it('accepts a valid token, binds the manifest hash, and records the nonce', () => {
    const seen = new Set<string>();
    const r = verifyScopeToken(makeToken(), 'abc', 'eng-1', [issuer], NOW, seen);
    expect(r.ok).toBe(true);
    expect(seen.has('n1')).toBe(true);
  });
  it('rejects a replayed nonce', () => {
    const seen = new Set<string>(['n1']);
    expect(verifyScopeToken(makeToken(), 'abc', 'eng-1', [issuer], NOW, seen).ok).toBe(false);
  });
  it('rejects a manifest-hash mismatch (token not for this manifest)', () => {
    expect(verifyScopeToken(makeToken(), 'DIFFERENT', 'eng-1', [issuer], NOW, new Set()).ok).toBe(false);
  });
  it('rejects an expired token and a wrong issuer', () => {
    expect(verifyScopeToken(makeToken(), 'abc', 'eng-1', [issuer], Date.parse('2026-06-12T00:00:00Z'), new Set()).ok).toBe(false);
    const other = ml_dsa65.keygen();
    const wrong: TrustKeyset = { edPub: ed25519.getPublicKey(ed25519.utils.randomSecretKey()), pqPub: other.publicKey };
    expect(verifyScopeToken(makeToken(), 'abc', 'eng-1', [wrong], NOW, new Set()).ok).toBe(false);
  });
  it('a plugin-domain signature does NOT validate as a scope token (domain separation)', () => {
    const payload = { manifestContentHash: 'abc', engagementId: 'eng-1', issuedAt: '2026-06-10T00:00:00Z', nonce: 'z', expiresAt: '2026-06-11T00:00:00Z' };
    const wrongHash = Buffer.from(JSON.stringify(payload)); // no DCS98-SCOPE-v1 domain
    const sig = new Uint8Array([...ed25519.sign(wrongHash, edSec), ...ml_dsa65.sign(wrongHash, pq.secretKey)]);
    const tok: ScopeToken = { ...payload, signatureHex: Buffer.from(sig).toString('hex') };
    expect(verifyScopeToken(tok, 'abc', 'eng-1', [issuer], NOW, new Set()).ok).toBe(false);
  });
});
