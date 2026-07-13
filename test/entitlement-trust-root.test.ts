import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { verifyPluginSignature } from '../src/main/plugins/verify';
import { getEntitlementKeysets, getPinnedKeysets } from '../src/main/plugins/trust';

// Mirrors scripts/gen-entitlement.mjs + the plugin's entitlement.ts: JSON with sorted top-level keys.
function canonicalBytes(token: Record<string, unknown>): Uint8Array {
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(token).sort()) ordered[k] = token[k];
  return new TextEncoder().encode(JSON.stringify(ordered));
}
function sign(msg: Uint8Array, edSec: Uint8Array, pqSec: Uint8Array): Uint8Array {
  return new Uint8Array([...ed25519.sign(msg, edSec), ...ml_dsa65.sign(msg, pqSec)]);
}
const tok = { subject: 'ghostexodus', tier: 'tester', issuedAt: '2026-07-13T00:00:00Z', features: ['llm'] };

describe('entitlement trust root', () => {
  it('an entitlement signed by an entitlement key verifies via verifyPluginSignature; a wrong key does not', () => {
    const edSec = ed25519.utils.randomSecretKey();
    const pq = ml_dsa65.keygen();
    const keyset = [{ edPub: ed25519.getPublicKey(edSec), pqPub: pq.publicKey }];
    const msg = canonicalBytes(tok);
    const sig = sign(msg, edSec, pq.secretKey);
    expect(verifyPluginSignature(msg, sig, keyset)).toBe(true); // proves gen-entitlement's sign layout matches verification

    const otherEd = ed25519.utils.randomSecretKey();
    const otherKeyset = [{ edPub: ed25519.getPublicKey(otherEd), pqPub: ml_dsa65.keygen().publicKey }];
    expect(verifyPluginSignature(msg, sig, otherKeyset)).toBe(false);
  });

  it('canonicalBytes is key-order independent (signer + verifier agree)', () => {
    const a = canonicalBytes(tok);
    const b = canonicalBytes({ features: ['llm'], tier: 'tester', issuedAt: '2026-07-13T00:00:00Z', subject: 'ghostexodus' });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('is a SEPARATE trust root from the plugin-package keys (distinct pin, non-empty)', () => {
    const ent = getEntitlementKeysets();
    expect(ent.length).toBeGreaterThan(0);
    // Different key material than the plugin-signature root — the whole point of "separate entitlement key".
    const entEd = Buffer.from(ent[0].edPub).toString('hex');
    const pluginEd = Buffer.from(getPinnedKeysets()[0].edPub).toString('hex');
    expect(entEd).not.toBe(pluginEd);
  });

  it('the pinned DEV entitlement key validates a token signed by its secret (skipped in CI if the key file is absent)', () => {
    const keyPath = join(process.cwd(), 'scripts', '.entitlement-dev-key.json');
    if (!existsSync(keyPath)) return; // dev-only file; not present in CI — the mechanism tests above still run
    const k = JSON.parse(readFileSync(keyPath, 'utf8')) as { ED_SEC: string; PQ_SEC: string };
    const edSec = Uint8Array.from(Buffer.from(k.ED_SEC, 'hex'));
    const pqSec = Uint8Array.from(Buffer.from(k.PQ_SEC, 'hex'));
    const msg = canonicalBytes(tok);
    const sig = sign(msg, edSec, pqSec);
    expect(verifyPluginSignature(msg, sig, getEntitlementKeysets())).toBe(true); // the pinned pub matches the dev secret
  });
});
