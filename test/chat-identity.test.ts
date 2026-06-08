import { describe, it, expect } from 'vitest';
import {
  generateIdentity,
  zeroizeIdentity,
  encodeIdentityPublic,
  decodeIdentityPublic,
  identityFingerprint,
  contactId,
  safetyNumber,
  generateKemPrekey,
  verifyKemPrekey,
  encodeKemPrekey,
  decodeKemPrekey,
  IdentityError,
  IDENTITY_PUBLIC_LEN,
  KEM_PREKEY_LEN,
  type IdentityPublic
} from '../src/main/chat/identity';

describe('chat identity (v3)', () => {
  it('generates an Ed25519+X25519 identity (no static ML-KEM)', () => {
    const id = generateIdentity();
    expect(id.publicKeys.ed25519.length).toBe(32);
    expect(id.publicKeys.x25519.length).toBe(32);
    expect(id.ed25519Secret.length).toBe(32);
    expect(id.x25519Secret.length).toBe(32);
    expect((id as unknown as { mlkem768Secret?: unknown }).mlkem768Secret).toBeUndefined();
    expect(IDENTITY_PUBLIC_LEN).toBe(64);
  });

  it('encodes/decodes the 64-byte public identity round-trip', () => {
    const { publicKeys } = generateIdentity();
    const enc = encodeIdentityPublic(publicKeys);
    expect(enc.length).toBe(IDENTITY_PUBLIC_LEN);
    const dec = decodeIdentityPublic(enc);
    expect(Array.from(dec.ed25519)).toEqual(Array.from(publicKeys.ed25519));
    expect(Array.from(dec.x25519)).toEqual(Array.from(publicKeys.x25519));
  });

  it('rejects wrong-length bundle / components', () => {
    expect(() => decodeIdentityPublic(new Uint8Array(63))).toThrow(IdentityError);
    const bad: IdentityPublic = { ed25519: new Uint8Array(31), x25519: new Uint8Array(32) };
    expect(() => encodeIdentityPublic(bad)).toThrow(IdentityError);
  });

  it('fingerprint stable + distinct; contactId is 64 hex chars', () => {
    const a = generateIdentity().publicKeys;
    const b = generateIdentity().publicKeys;
    expect(Array.from(identityFingerprint(a))).toEqual(Array.from(identityFingerprint(a)));
    expect(contactId(a)).toHaveLength(64);
    expect(contactId(a)).not.toBe(contactId(b));
  });

  it('safety number order-independent, stable, 12×5 digits, changes on identity change', () => {
    const a = generateIdentity().publicKeys;
    const b = generateIdentity().publicKeys;
    const c = generateIdentity().publicKeys;
    expect(safetyNumber(a, b)).toBe(safetyNumber(b, a));
    expect(safetyNumber(a, b)).toMatch(/^(\d{5} ){11}\d{5}$/);
    expect(safetyNumber(a, b)).not.toBe(safetyNumber(a, c));
  });

  it('zeroizeIdentity wipes secrets, leaves public keys', () => {
    const id = generateIdentity();
    const pub = Array.from(id.publicKeys.ed25519);
    zeroizeIdentity(id);
    expect(Array.from(id.ed25519Secret)).toEqual(new Array(32).fill(0));
    expect(Array.from(id.x25519Secret)).toEqual(new Array(32).fill(0));
    expect(Array.from(id.publicKeys.ed25519)).toEqual(pub);
  });
});

describe('chat KEM prekeys (v3)', () => {
  it('generates a signed prekey that verifies under the identity', async () => {
    const id = generateIdentity();
    const { prekey, secretKey } = await generateKemPrekey(id);
    expect(prekey.publicKey.length).toBe(1568);
    expect(secretKey.length).toBe(3168);
    expect(prekey.isLastResort).toBe(false);
    expect(verifyKemPrekey(prekey, id.publicKeys.ed25519)).toBe(true);
  });

  it('marks a last-resort prekey and still verifies', async () => {
    const id = generateIdentity();
    const { prekey } = await generateKemPrekey(id, true);
    expect(prekey.isLastResort).toBe(true);
    expect(verifyKemPrekey(prekey, id.publicKeys.ed25519)).toBe(true);
  });

  it('rejects a prekey under the wrong identity or with a tampered field', async () => {
    const id = generateIdentity();
    const other = generateIdentity();
    const { prekey } = await generateKemPrekey(id);
    expect(verifyKemPrekey(prekey, other.publicKeys.ed25519)).toBe(false); // wrong signer
    const tampered = { ...prekey, isLastResort: !prekey.isLastResort }; // flip signed flag
    expect(verifyKemPrekey(tampered, id.publicKeys.ed25519)).toBe(false);
    const tamperedPk = { ...prekey, publicKey: (() => { const p = prekey.publicKey.slice(); p[0] ^= 1; return p; })() };
    expect(verifyKemPrekey(tamperedPk, id.publicKeys.ed25519)).toBe(false);
  });

  it('encodes/decodes a prekey round-trip', async () => {
    const id = generateIdentity();
    const { prekey } = await generateKemPrekey(id, true);
    const enc = encodeKemPrekey(prekey);
    expect(enc.length).toBe(KEM_PREKEY_LEN);
    const dec = decodeKemPrekey(enc);
    expect(dec.isLastResort).toBe(true);
    expect(Array.from(dec.prekeyId)).toEqual(Array.from(prekey.prekeyId));
    expect(verifyKemPrekey(dec, id.publicKeys.ed25519)).toBe(true);
  });

  it('rejects a wrong-length encoded prekey', () => {
    expect(() => decodeKemPrekey(new Uint8Array(KEM_PREKEY_LEN - 1))).toThrow(IdentityError);
  });
});
