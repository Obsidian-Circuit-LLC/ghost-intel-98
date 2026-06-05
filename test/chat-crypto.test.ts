import { describe, it, expect } from 'vitest';
import {
  x25519Keygen,
  x25519Ecdh,
  ed25519Keygen,
  ed25519Sign,
  ed25519Verify,
  mlkemKeygen,
  mlkemEncapsulate,
  mlkemDecapsulate,
  aeadSeal,
  aeadOpen,
  hkdf,
  sha256,
  randomBytes,
  constantTimeEqual,
  zeroize,
  CryptoError,
  X25519_PUBLIC_LEN,
  X25519_SECRET_LEN,
  ED25519_SIG_LEN,
  MLKEM768_PUBLIC_LEN,
  MLKEM768_SECRET_LEN,
  MLKEM768_CT_LEN,
  SHARED_SECRET_LEN,
  AEAD_KEY_LEN,
  AEAD_NONCE_LEN
} from '../src/main/chat/crypto';

describe('chat crypto primitives', () => {
  it('X25519 keygen produces correctly-sized keys and ECDH agrees both directions', () => {
    const a = x25519Keygen();
    const b = x25519Keygen();
    expect(a.publicKey.length).toBe(X25519_PUBLIC_LEN);
    expect(a.secretKey.length).toBe(X25519_SECRET_LEN);
    const ab = x25519Ecdh(a, b.publicKey);
    const ba = x25519Ecdh(b, a.publicKey);
    expect(ab.length).toBe(SHARED_SECRET_LEN);
    expect(Array.from(ab)).toEqual(Array.from(ba)); // shared secret matches
  });

  it('X25519 distinct pairs yield distinct shared secrets', () => {
    const a = x25519Keygen();
    const b = x25519Keygen();
    const c = x25519Keygen();
    expect(constantTimeEqual(x25519Ecdh(a, b.publicKey), x25519Ecdh(a, c.publicKey))).toBe(false);
  });

  it('X25519 rejects a wrong-length peer key', () => {
    const a = x25519Keygen();
    expect(() => x25519Ecdh(a, new Uint8Array(31))).toThrow(CryptoError);
  });

  it('Ed25519 sign/verify accepts a good signature and rejects tampering', () => {
    const kp = ed25519Keygen();
    const msg = new TextEncoder().encode('transcript bytes');
    const sig = ed25519Sign(msg, kp);
    expect(sig.length).toBe(ED25519_SIG_LEN);
    expect(ed25519Verify(sig, msg, kp.publicKey)).toBe(true);

    const tampered = new Uint8Array(msg);
    tampered[0] ^= 0x01;
    expect(ed25519Verify(sig, tampered, kp.publicKey)).toBe(false);

    const other = ed25519Keygen();
    expect(ed25519Verify(sig, msg, other.publicKey)).toBe(false); // wrong key
    expect(ed25519Verify(new Uint8Array(64), msg, kp.publicKey)).toBe(false); // garbage sig
  });

  it('ML-KEM-768 keygen/encapsulate/decapsulate agree on the shared secret', () => {
    const kp = mlkemKeygen();
    expect(kp.publicKey.length).toBe(MLKEM768_PUBLIC_LEN);
    expect(kp.secretKey.length).toBe(MLKEM768_SECRET_LEN);
    const { cipherText, sharedSecret } = mlkemEncapsulate(kp.publicKey);
    expect(cipherText.length).toBe(MLKEM768_CT_LEN);
    expect(sharedSecret.length).toBe(SHARED_SECRET_LEN);
    const recovered = mlkemDecapsulate(cipherText, kp.secretKey);
    expect(Array.from(recovered)).toEqual(Array.from(sharedSecret));
  });

  it('ML-KEM-768 rejects wrong-length public key / ciphertext', () => {
    const kp = mlkemKeygen();
    expect(() => mlkemEncapsulate(new Uint8Array(10))).toThrow(CryptoError);
    expect(() => mlkemDecapsulate(new Uint8Array(10), kp.secretKey)).toThrow(CryptoError);
  });

  it('AEAD seals + opens, and rejects tamper / wrong nonce / wrong AAD', () => {
    const key = randomBytes(AEAD_KEY_LEN);
    const nonce = randomBytes(AEAD_NONCE_LEN);
    const aad = new TextEncoder().encode('session-id-7');
    const pt = new TextEncoder().encode('hello over tor');
    const sealed = aeadSeal(key, nonce, pt, aad);
    expect(Array.from(aeadOpen(key, nonce, sealed, aad))).toEqual(Array.from(pt));

    const tampered = new Uint8Array(sealed);
    tampered[0] ^= 0x01;
    expect(() => aeadOpen(key, nonce, tampered, aad)).toThrow(CryptoError);

    const wrongNonce = randomBytes(AEAD_NONCE_LEN);
    expect(() => aeadOpen(key, wrongNonce, sealed, aad)).toThrow(CryptoError);

    const wrongAad = new TextEncoder().encode('session-id-8');
    expect(() => aeadOpen(key, nonce, sealed, wrongAad)).toThrow(CryptoError);
  });

  it('AEAD rejects malformed key/nonce lengths and too-short ciphertext', () => {
    expect(() => aeadSeal(new Uint8Array(31), new Uint8Array(AEAD_NONCE_LEN), new Uint8Array(1))).toThrow(CryptoError);
    expect(() => aeadSeal(new Uint8Array(AEAD_KEY_LEN), new Uint8Array(11), new Uint8Array(1))).toThrow(CryptoError);
    expect(() => aeadOpen(new Uint8Array(AEAD_KEY_LEN), new Uint8Array(AEAD_NONCE_LEN), new Uint8Array(4))).toThrow(CryptoError);
  });

  it('HKDF is deterministic and info-separated', () => {
    const ikm = randomBytes(32);
    const salt = randomBytes(16);
    const k1 = hkdf(ikm, salt, new TextEncoder().encode('chat-msg'), 32);
    const k2 = hkdf(ikm, salt, new TextEncoder().encode('chat-msg'), 32);
    const k3 = hkdf(ikm, salt, new TextEncoder().encode('chat-ack'), 32);
    expect(k1.length).toBe(32);
    expect(Array.from(k1)).toEqual(Array.from(k2)); // deterministic
    expect(constantTimeEqual(k1, k3)).toBe(false); // different info → different key
  });

  it('sha256 has a known length and is stable', () => {
    const h = sha256(new TextEncoder().encode('x'));
    expect(h.length).toBe(32);
    expect(Array.from(h)).toEqual(Array.from(sha256(new TextEncoder().encode('x'))));
  });

  it('constantTimeEqual + zeroize behave', () => {
    const a = Uint8Array.from([1, 2, 3]);
    const b = Uint8Array.from([1, 2, 3]);
    expect(constantTimeEqual(a, b)).toBe(true);
    expect(constantTimeEqual(a, Uint8Array.from([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(a, Uint8Array.from([1, 2]))).toBe(false);
    zeroize(a, b);
    expect(Array.from(a)).toEqual([0, 0, 0]);
    expect(Array.from(b)).toEqual([0, 0, 0]);
  });
});
