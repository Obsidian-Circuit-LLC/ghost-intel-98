/**
 * Chat crypto primitives (Phase 1) — thin, audited-library-only wrappers. NO bespoke primitives.
 *
 *  - Classical leg via Node's built-in `crypto` (the same engine the vault trusts for AES-256-GCM /
 *    scrypt): X25519 ECDH, Ed25519 sign/verify, ChaCha20-Poly1305 AEAD, HKDF-SHA-256, SHA-256.
 *  - PQ leg via `@noble/post-quantum` ML-KEM-768 (self-audited; swap to an audited native binding
 *    later behind this module — it is the ONLY place ML-KEM is referenced).
 *
 * This module deliberately stops at primitives + a generic KDF. The PQ-hybrid HANDSHAKE that
 * composes X25519 ⊕ ML-KEM-768 (PQXDH-style) is built in handshake.ts and frozen only after the
 * formalist + crypto-auditor gate — it is NOT defined here.
 *
 * All inputs/outputs are raw `Uint8Array`. Everything here is deterministic given its inputs, except
 * the *keygen* / *encapsulate* / *randomBytes* calls whose randomness is intended.
 */
import * as nodeCrypto from 'node:crypto';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

// ---- sizes (bytes) — used by upper layers to bound/validate wire + stored material ----
export const X25519_PUBLIC_LEN = 32;
export const X25519_SECRET_LEN = 32;
export const ED25519_PUBLIC_LEN = 32;
export const ED25519_SECRET_LEN = 32;
export const ED25519_SIG_LEN = 64;
export const MLKEM768_PUBLIC_LEN = 1184;
export const MLKEM768_SECRET_LEN = 2400;
export const MLKEM768_CT_LEN = 1088;
export const SHARED_SECRET_LEN = 32;
export const AEAD_KEY_LEN = 32;
export const AEAD_NONCE_LEN = 12;
export const AEAD_TAG_LEN = 16;

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

const u8 = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

// ---- X25519 (ECDH) ----
// Raw-byte via @noble/curves rather than Node's JWK path: the JWK round-trip copies private keys
// into immutable V8 strings that zeroize() can never reach (crypto-audit H1). Noble operates on
// Uint8Array end-to-end, so secret material stays in buffers we can wipe.

export function x25519Keygen(): KeyPair {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** Raw X25519 shared secret. Throws (via noble) on a low-order / all-zero peer point — fail-closed. */
export function x25519Ecdh(self: KeyPair, peerPublic: Uint8Array): Uint8Array {
  if (peerPublic.length !== X25519_PUBLIC_LEN) throw new CryptoError('bad X25519 public key length');
  try {
    return x25519.getSharedSecret(self.secretKey, peerPublic);
  } catch (err) {
    throw new CryptoError('X25519 ECDH failed');
  }
}

// ---- Ed25519 (identity signatures) ----

export function ed25519Keygen(): KeyPair {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

export function ed25519Sign(message: Uint8Array, self: KeyPair): Uint8Array {
  return ed25519.sign(message, self.secretKey);
}

export function ed25519Verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  if (signature.length !== ED25519_SIG_LEN || publicKey.length !== ED25519_PUBLIC_LEN) return false;
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

// ---- ML-KEM-768 (PQ KEM) — the only reference to the PQ library ----

export function mlkemKeygen(): KeyPair {
  const kp = ml_kem768.keygen();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

export function mlkemEncapsulate(peerPublic: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array } {
  if (peerPublic.length !== MLKEM768_PUBLIC_LEN) throw new CryptoError('bad ML-KEM public key length');
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(peerPublic);
  return { cipherText, sharedSecret };
}

export function mlkemDecapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array {
  if (cipherText.length !== MLKEM768_CT_LEN) throw new CryptoError('bad ML-KEM ciphertext length');
  return ml_kem768.decapsulate(cipherText, secretKey);
}

// ---- symmetric: AEAD, KDF, hash, RNG, zeroize ----

/** ChaCha20-Poly1305 seal → ciphertext‖tag. */
export function aeadSeal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.length !== AEAD_KEY_LEN) throw new CryptoError('bad AEAD key length');
  if (nonce.length !== AEAD_NONCE_LEN) throw new CryptoError('bad AEAD nonce length');
  // @types/node lists chacha20-poly1305 under the CCM cipher types (whose setAAD demands a
  // plaintextLength option); it actually behaves like GCM (AAD, 16-byte tag, no plaintextLength),
  // so type it as the GCM variant to get the correct optional-AAD signature.
  const c = nodeCrypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: AEAD_TAG_LEN }) as nodeCrypto.CipherGCM;
  if (aad && aad.length) c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return new Uint8Array(Buffer.concat([ct, c.getAuthTag()]));
}

/** Open ciphertext‖tag; throws CryptoError on tag/auth failure (never returns garbage). */
export function aeadOpen(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.length !== AEAD_KEY_LEN) throw new CryptoError('bad AEAD key length');
  if (nonce.length !== AEAD_NONCE_LEN) throw new CryptoError('bad AEAD nonce length');
  if (sealed.length < AEAD_TAG_LEN) throw new CryptoError('AEAD ciphertext too short');
  const split = sealed.length - AEAD_TAG_LEN;
  const ct = sealed.subarray(0, split);
  const tag = sealed.subarray(split);
  const d = nodeCrypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: AEAD_TAG_LEN }) as nodeCrypto.DecipherGCM;
  if (aad && aad.length) d.setAAD(aad);
  d.setAuthTag(tag);
  try {
    return new Uint8Array(Buffer.concat([d.update(ct), d.final()]));
  } catch {
    throw new CryptoError('AEAD authentication failed');
  }
}

/** HKDF-SHA-256. Deterministic. */
export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  return u8(Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, info, length)));
}

export function sha256(data: Uint8Array): Uint8Array {
  return u8(nodeCrypto.createHash('sha256').update(data).digest());
}

/** HMAC-SHA256 — used for the cheap token pre-gate (mac_T) that fails before any asymmetric op. */
export function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  return u8(nodeCrypto.createHmac('sha256', key).update(msg).digest());
}

export function randomBytes(n: number): Uint8Array {
  return u8(nodeCrypto.randomBytes(n));
}

/** Constant-time equality (wraps Node's timingSafeEqual; false on length mismatch). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return nodeCrypto.timingSafeEqual(a, b);
}

/** Best-effort wipe of secret buffers. JS can't guarantee no copies, but we clear what we hold. */
export function zeroize(...arrays: Uint8Array[]): void {
  for (const a of arrays) a.fill(0);
}
