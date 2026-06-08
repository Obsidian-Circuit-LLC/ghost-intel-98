/**
 * Chat identity (Phase 1, v3) — a peer's long-term identity (Ed25519 + X25519) and the human-
 * comparable safety number for out-of-band MITM verification (TOFU + verify).
 *
 * v3 change: identity no longer carries a static ML-KEM key. The KEM is ephemeral/prekey (that's
 * what gives forward secrecy); see KemPrekey below. Pure module.
 */
import {
  ed25519Keygen,
  ed25519Sign,
  ed25519Verify,
  x25519Keygen,
  mlkemKeygen,
  sha256,
  hkdf,
  randomBytes,
  zeroize,
  ED25519_PUBLIC_LEN,
  ED25519_SIG_LEN,
  X25519_PUBLIC_LEN,
  MLKEM_PUBLIC_LEN,
  type KeyPair
} from './crypto';
import { DS_PREKEY, SUITE_ID, concatBytes } from './constants';

export interface IdentityPublic {
  ed25519: Uint8Array;
  x25519: Uint8Array;
}

export interface IdentityKeyPair {
  publicKeys: IdentityPublic;
  ed25519Secret: Uint8Array;
  x25519Secret: Uint8Array;
}

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

/** Fixed wire layout for the public identity bundle: ed25519(32) ‖ x25519(32). */
export const IDENTITY_PUBLIC_LEN = ED25519_PUBLIC_LEN + X25519_PUBLIC_LEN; // 64
export const PREKEY_ID_LEN = 16;

const FP_DOMAIN = new TextEncoder().encode('dcs98-chat/identity-fingerprint/v3');
const SN_DOMAIN = new TextEncoder().encode('dcs98-chat/safety-number/v3');

export function generateIdentity(): IdentityKeyPair {
  const ed = ed25519Keygen();
  const x = x25519Keygen();
  return {
    publicKeys: { ed25519: ed.publicKey, x25519: x.publicKey },
    ed25519Secret: ed.secretKey,
    x25519Secret: x.secretKey
  };
}

/** Best-effort wipe of identity secret keys (lock / teardown). Public keys are not secret. */
export function zeroizeIdentity(id: IdentityKeyPair): void {
  zeroize(id.ed25519Secret, id.x25519Secret);
}

export function ed25519Pair(id: IdentityKeyPair): KeyPair {
  return { publicKey: id.publicKeys.ed25519, secretKey: id.ed25519Secret };
}
export function x25519Pair(id: IdentityKeyPair): KeyPair {
  return { publicKey: id.publicKeys.x25519, secretKey: id.x25519Secret };
}

export function encodeIdentityPublic(pub: IdentityPublic): Uint8Array {
  if (pub.ed25519.length !== ED25519_PUBLIC_LEN || pub.x25519.length !== X25519_PUBLIC_LEN) {
    throw new IdentityError('identity public key has wrong component length');
  }
  const out = new Uint8Array(IDENTITY_PUBLIC_LEN);
  out.set(pub.ed25519, 0);
  out.set(pub.x25519, ED25519_PUBLIC_LEN);
  return out;
}

export function decodeIdentityPublic(bytes: Uint8Array): IdentityPublic {
  if (bytes.length !== IDENTITY_PUBLIC_LEN) {
    throw new IdentityError(`identity bundle must be ${IDENTITY_PUBLIC_LEN} bytes, got ${bytes.length}`);
  }
  return { ed25519: bytes.slice(0, ED25519_PUBLIC_LEN), x25519: bytes.slice(ED25519_PUBLIC_LEN, IDENTITY_PUBLIC_LEN) };
}

/** Stable 32-byte fingerprint over the public identity. Basis for contactId + safety number. */
export function identityFingerprint(pub: IdentityPublic): Uint8Array {
  return sha256(concatBytes(FP_DOMAIN, encodeIdentityPublic(pub)));
}

export function contactId(pub: IdentityPublic): string {
  return Buffer.from(identityFingerprint(pub)).toString('hex');
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Order-independent 60-digit (12×5) human safety number for a PAIR of identities. Public aid. */
export function safetyNumber(a: IdentityPublic, b: IdentityPublic): string {
  const fa = identityFingerprint(a);
  const fb = identityFingerprint(b);
  const [lo, hi] = compareBytes(fa, fb) <= 0 ? [fa, fb] : [fb, fa];
  const material = hkdf(concatBytes(lo, hi), SN_DOMAIN, new TextEncoder().encode('digits'), 48);
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const off = i * 4;
    const v = ((material[off] << 24) | (material[off + 1] << 16) | (material[off + 2] << 8) | material[off + 3]) >>> 0;
    groups.push(String(v % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}

// ---------- signed KEM prekeys (v3 — PQ forward secrecy) ----------

/** A responder's signed ML-KEM-1024 prekey. One-time prekeys are consumed on use; a single rotating
 *  last-resort (`isLastResort`) covers availability (FS-degraded — see the handshake spec). */
export interface KemPrekey {
  prekeyId: Uint8Array; // PREKEY_ID_LEN bytes
  isLastResort: boolean;
  publicKey: Uint8Array; // ML-KEM-1024 public (MLKEM_PUBLIC_LEN)
  signature: Uint8Array; // Ed25519 over the canonical signed message (DS_PREKEY‖suite‖is_R‖id‖flag‖pk)
}

export interface KemPrekeyKeyPair {
  prekey: KemPrekey;
  secretKey: Uint8Array; // ML-KEM-1024 secret — must be deleted on consumption (durable)
}

/** Canonical message an `is_R` signs to vouch for a prekey (binds suite + identity + id + flag + pk). */
function prekeySignedMessage(isR: Uint8Array, prekeyId: Uint8Array, isLastResort: boolean, pk: Uint8Array): Uint8Array {
  return concatBytes(DS_PREKEY, SUITE_ID, isR, prekeyId, Uint8Array.of(isLastResort ? 1 : 0), pk);
}

export async function generateKemPrekey(identity: IdentityKeyPair, isLastResort = false): Promise<KemPrekeyKeyPair> {
  const kp = await mlkemKeygen();
  const prekeyId = randomBytes(PREKEY_ID_LEN);
  const signature = ed25519Sign(
    prekeySignedMessage(identity.publicKeys.ed25519, prekeyId, isLastResort, kp.publicKey),
    ed25519Pair(identity)
  );
  return { prekey: { prekeyId, isLastResort, publicKey: kp.publicKey, signature }, secretKey: kp.secretKey };
}

/** Verify a prekey's signature under the responder's Ed25519 identity. Reject before any Encap. */
export function verifyKemPrekey(prekey: KemPrekey, isRed25519: Uint8Array): boolean {
  if (prekey.prekeyId.length !== PREKEY_ID_LEN || prekey.publicKey.length !== MLKEM_PUBLIC_LEN) return false;
  return ed25519Verify(
    prekey.signature,
    prekeySignedMessage(isRed25519, prekey.prekeyId, prekey.isLastResort, prekey.publicKey),
    isRed25519
  );
}

/** Canonical fixed-layout encoding of a prekey (for the invite + transcript). */
export const KEM_PREKEY_LEN = PREKEY_ID_LEN + 1 + MLKEM_PUBLIC_LEN + ED25519_SIG_LEN;

export function encodeKemPrekey(p: KemPrekey): Uint8Array {
  if (p.prekeyId.length !== PREKEY_ID_LEN || p.publicKey.length !== MLKEM_PUBLIC_LEN || p.signature.length !== ED25519_SIG_LEN) {
    throw new IdentityError('prekey has wrong component length');
  }
  return concatBytes(p.prekeyId, Uint8Array.of(p.isLastResort ? 1 : 0), p.publicKey, p.signature);
}

export function decodeKemPrekey(bytes: Uint8Array): KemPrekey {
  if (bytes.length !== KEM_PREKEY_LEN) throw new IdentityError(`prekey must be ${KEM_PREKEY_LEN} bytes, got ${bytes.length}`);
  let off = 0;
  const prekeyId = bytes.slice(off, (off += PREKEY_ID_LEN));
  const flag = bytes[off];
  off += 1;
  const publicKey = bytes.slice(off, (off += MLKEM_PUBLIC_LEN));
  const signature = bytes.slice(off, (off += ED25519_SIG_LEN));
  if (flag !== 0 && flag !== 1) throw new IdentityError('invalid is_last_resort flag');
  return { prekeyId, isLastResort: flag === 1, publicKey, signature };
}
