import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { canonicalPluginHash, verifyPluginSignature, type PluginParts } from '../src/main/plugins/verify';
import type { TrustKeyset } from '../src/main/plugins/trust';

// API confirmed from installed types:
//   ed25519.utils.randomSecretKey()          (NOT randomPrivateKey — that name doesn't exist)
//   ed25519.sign(msg, secretKey)
//   ed25519.verify(sig, msg, publicKey)
//   ml_dsa65.keygen()                        => { secretKey, publicKey }
//   ml_dsa65.sign(msg, secretKey)            (msg first, secretKey second)
//   ml_dsa65.verify(sig, msg, publicKey)     (sig first, msg second, pubKey third)

function makeKeyset(): { keyset: TrustKeyset; edSec: Uint8Array; pqSec: Uint8Array } {
  const edSec = ed25519.utils.randomSecretKey();
  const edPub = ed25519.getPublicKey(edSec);
  const pq = ml_dsa65.keygen();
  return { keyset: { edPub, pqPub: pq.publicKey }, edSec, pqSec: pq.secretKey };
}

function sign(hash: Uint8Array, edSec: Uint8Array, pqSec: Uint8Array): Uint8Array {
  const ed = ed25519.sign(hash, edSec);
  const pq = ml_dsa65.sign(hash, pqSec);
  const out = new Uint8Array(ed.length + pq.length);
  out.set(ed, 0); out.set(pq, ed.length);
  return out;
}

const parts: PluginParts = {
  manifest: Buffer.from('{"id":"x"}'), main: Buffer.from('MAIN'), renderer: Buffer.from('REND'), assets: []
};

describe('plugin verify', () => {
  it('a valid hybrid signature verifies', () => {
    const { keyset, edSec, pqSec } = makeKeyset();
    const h = canonicalPluginHash(parts);
    expect(verifyPluginSignature(h, sign(h, edSec, pqSec), [keyset])).toBe(true);
  });
  it('tampered content fails', () => {
    const { keyset, edSec, pqSec } = makeKeyset();
    const sig = sign(canonicalPluginHash(parts), edSec, pqSec);
    const tampered = canonicalPluginHash({ ...parts, main: Buffer.from('EVIL') });
    expect(verifyPluginSignature(tampered, sig, [keyset])).toBe(false);
  });
  it('a forged Ed leg fails even with a valid PQ leg', () => {
    const { keyset, pqSec } = makeKeyset();
    const h = canonicalPluginHash(parts);
    const badEd = new Uint8Array(64);
    const pq = ml_dsa65.sign(h, pqSec);
    const sig = new Uint8Array(64 + pq.length); sig.set(badEd, 0); sig.set(pq, 64);
    expect(verifyPluginSignature(h, sig, [keyset])).toBe(false);
  });
  it('a wrong keyset fails', () => {
    const a = makeKeyset(); const b = makeKeyset();
    const h = canonicalPluginHash(parts);
    expect(verifyPluginSignature(h, sign(h, a.edSec, a.pqSec), [b.keyset])).toBe(false);
  });
  it('accepts a second pinned keyset (rotation)', () => {
    const a = makeKeyset(); const b = makeKeyset();
    const h = canonicalPluginHash(parts);
    expect(verifyPluginSignature(h, sign(h, b.edSec, b.pqSec), [a.keyset, b.keyset])).toBe(true);
  });
});
