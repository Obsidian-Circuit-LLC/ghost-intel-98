/**
 * Canonical plugin hash + PQ-hybrid (Ed25519 ∥ ML-DSA-65) signature verification.
 *
 * Hash construction:
 *   SHA-512( DOMAIN || 0x00 || len64be(manifest) || manifest
 *                           || len64be(main)     || main
 *                           || len64be(renderer)  || renderer
 *                           || [assets sorted by path, each len64be(path\0bytes)] )
 *
 * Signature layout (concatenated, no framing):
 *   bytes  0..63  — Ed25519 signature (64 bytes, fixed)
 *   bytes 64..end — ML-DSA-65 signature (3309 bytes, fixed for this param-set)
 *
 * Verification: BOTH legs must pass against the SAME keyset.  We try each pinned
 * keyset in order; the first one that satisfies both legs wins.
 *
 * API note — confirmed from installed @noble/post-quantum types:
 *   ml_dsa65.sign(msg, secretKey)        (msg first, secretKey second)
 *   ml_dsa65.verify(sig, msg, publicKey) (sig first, msg second, pubKey third)
 *   ed25519.sign(msg, secretKey)
 *   ed25519.verify(sig, msg, publicKey)
 */
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import type { TrustKeyset } from './trust';

const DOMAIN = Buffer.from('DCS98-PLUGIN-v1');
const ED_SIG_LEN = 64;

export interface PluginAsset { path: string; bytes: Buffer; }
export interface PluginParts { manifest: Buffer; main: Buffer; renderer: Buffer; assets: PluginAsset[]; }

/** 8-byte big-endian length prefix followed by the buffer contents. */
function lenPrefixed(buf: Buffer): Buffer {
  const len = Buffer.alloc(8);
  len.writeBigUInt64BE(BigInt(buf.length));
  return Buffer.concat([len, buf]);
}

/**
 * Produce the canonical SHA-512 hash over all plugin parts.
 * The domain separator and length-prefixing prevent cross-context collisions.
 */
export function canonicalPluginHash(p: PluginParts): Buffer {
  const h = createHash('sha512');
  h.update(DOMAIN);
  h.update(Buffer.from([0])); // separator between domain and content
  h.update(lenPrefixed(p.manifest));
  h.update(lenPrefixed(p.main));
  h.update(lenPrefixed(p.renderer));
  // Sort assets by path for determinism; path is NUL-terminated before bytes.
  const sorted = [...p.assets].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const a of sorted) {
    h.update(lenPrefixed(Buffer.concat([Buffer.from(a.path), Buffer.from([0]), a.bytes])));
  }
  return h.digest();
}

/**
 * Verify a PQ-hybrid signature against a list of pinned keysets.
 *
 * Returns true iff the signature is a valid hybrid (Ed25519 ∥ ML-DSA-65) produced
 * by the secret keys corresponding to at least one entry in `keysets`.
 *
 * Both legs must pass for the same keyset — a valid PQ leg with a forged Ed leg,
 * or vice-versa, is rejected.  Exceptions from either library (malformed inputs,
 * wrong lengths) are caught and treated as verification failure so callers never
 * need to handle crypto exceptions.
 */
export function verifyPluginSignature(
  hash: Uint8Array,
  signature: Uint8Array,
  keysets: TrustKeyset[],
): boolean {
  if (signature.length <= ED_SIG_LEN) return false;
  const edSig = signature.subarray(0, ED_SIG_LEN);
  const pqSig = signature.subarray(ED_SIG_LEN);
  for (const k of keysets) {
    try {
      // Both legs must verify against the same keyset.
      if (
        ed25519.verify(edSig, hash, k.edPub) &&
        ml_dsa65.verify(pqSig, hash, k.pqPub)
      ) {
        return true;
      }
    } catch {
      // Malformed key or signature bytes — try next keyset.
    }
  }
  return false;
}
