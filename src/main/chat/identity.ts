/**
 * Chat identity (Phase 1) — a peer's long-term cryptographic identity and the human-comparable
 * safety number used to detect a MITM on the invite channel (TOFU + verify).
 *
 * An identity is three keypairs:
 *   - Ed25519   — signing identity (binds the handshake transcript)
 *   - X25519    — static DH for the hybrid handshake
 *   - ML-KEM-768 — static KEM for the hybrid handshake
 *
 * Pure module: keygen randomness aside, everything is deterministic and unit-testable. The onion
 * address (network locator) is owned by the transport layer and bound to an identity at the
 * contacts layer — it is intentionally NOT part of the crypto identity here.
 */
import {
  ed25519Keygen,
  x25519Keygen,
  mlkemKeygen,
  sha256,
  hkdf,
  ED25519_PUBLIC_LEN,
  X25519_PUBLIC_LEN,
  MLKEM768_PUBLIC_LEN,
  type KeyPair
} from './crypto';

export interface IdentityPublic {
  ed25519: Uint8Array;
  x25519: Uint8Array;
  mlkem768: Uint8Array;
}

export interface IdentityKeyPair {
  publicKeys: IdentityPublic;
  ed25519Secret: Uint8Array;
  x25519Secret: Uint8Array;
  mlkem768Secret: Uint8Array;
}

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

/** Fixed wire layout for the public identity bundle. */
export const IDENTITY_PUBLIC_LEN = ED25519_PUBLIC_LEN + X25519_PUBLIC_LEN + MLKEM768_PUBLIC_LEN; // 1248

const FP_DOMAIN = new TextEncoder().encode('dcs98-chat/identity-fingerprint/v1');
const SN_DOMAIN = new TextEncoder().encode('dcs98-chat/safety-number/v1');

export function generateIdentity(): IdentityKeyPair {
  const ed = ed25519Keygen();
  const x = x25519Keygen();
  const kem = mlkemKeygen();
  return {
    publicKeys: { ed25519: ed.publicKey, x25519: x.publicKey, mlkem768: kem.publicKey },
    ed25519Secret: ed.secretKey,
    x25519Secret: x.secretKey,
    mlkem768Secret: kem.secretKey
  };
}

/** Re-assemble the per-algorithm KeyPair views (for handing to crypto.ts helpers). */
export function ed25519Pair(id: IdentityKeyPair): KeyPair {
  return { publicKey: id.publicKeys.ed25519, secretKey: id.ed25519Secret };
}
export function x25519Pair(id: IdentityKeyPair): KeyPair {
  return { publicKey: id.publicKeys.x25519, secretKey: id.x25519Secret };
}

/** Canonical fixed-layout serialization of the public identity (ed‖x‖mlkem). */
export function encodeIdentityPublic(pub: IdentityPublic): Uint8Array {
  if (
    pub.ed25519.length !== ED25519_PUBLIC_LEN ||
    pub.x25519.length !== X25519_PUBLIC_LEN ||
    pub.mlkem768.length !== MLKEM768_PUBLIC_LEN
  ) {
    throw new IdentityError('identity public key has wrong component length');
  }
  const out = new Uint8Array(IDENTITY_PUBLIC_LEN);
  out.set(pub.ed25519, 0);
  out.set(pub.x25519, ED25519_PUBLIC_LEN);
  out.set(pub.mlkem768, ED25519_PUBLIC_LEN + X25519_PUBLIC_LEN);
  return out;
}

export function decodeIdentityPublic(bytes: Uint8Array): IdentityPublic {
  if (bytes.length !== IDENTITY_PUBLIC_LEN) {
    throw new IdentityError(`identity bundle must be ${IDENTITY_PUBLIC_LEN} bytes, got ${bytes.length}`);
  }
  const a = ED25519_PUBLIC_LEN;
  const b = a + X25519_PUBLIC_LEN;
  return {
    ed25519: bytes.slice(0, a),
    x25519: bytes.slice(a, b),
    mlkem768: bytes.slice(b, IDENTITY_PUBLIC_LEN)
  };
}

/** Stable 32-byte fingerprint over the whole public identity. Basis for contactId + safety number. */
export function identityFingerprint(pub: IdentityPublic): Uint8Array {
  const body = encodeIdentityPublic(pub);
  const buf = new Uint8Array(FP_DOMAIN.length + body.length);
  buf.set(FP_DOMAIN, 0);
  buf.set(body, FP_DOMAIN.length);
  return sha256(buf);
}

/** Lowercase hex of the fingerprint — used as the stable local contact id / map key. */
export function contactId(pub: IdentityPublic): string {
  return Buffer.from(identityFingerprint(pub)).toString('hex');
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Order-independent human safety number for a PAIR of identities: both peers compute the SAME value
 * and compare it out-of-band (voice / in person) to detect a MITM. 60 digits in 12 space-separated
 * groups of 5. This is a public comparison aid, not a secret.
 */
export function safetyNumber(a: IdentityPublic, b: IdentityPublic): string {
  const fa = identityFingerprint(a);
  const fb = identityFingerprint(b);
  const [lo, hi] = compareBytes(fa, fb) <= 0 ? [fa, fb] : [fb, fa]; // canonical order
  const seed = new Uint8Array(lo.length + hi.length);
  seed.set(lo, 0);
  seed.set(hi, lo.length);
  const material = hkdf(seed, SN_DOMAIN, new TextEncoder().encode('digits'), 48); // 12 × uint32
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const off = i * 4;
    const v = ((material[off] << 24) | (material[off + 1] << 16) | (material[off + 2] << 8) | material[off + 3]) >>> 0;
    groups.push(String(v % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}
