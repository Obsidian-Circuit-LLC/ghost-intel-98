import { describe, it, expect } from 'vitest';
import {
  generateIdentity,
  encodeIdentityPublic,
  decodeIdentityPublic,
  identityFingerprint,
  contactId,
  safetyNumber,
  IdentityError,
  IDENTITY_PUBLIC_LEN,
  type IdentityPublic
} from '../src/main/chat/identity';

describe('chat identity', () => {
  it('generates an identity with correctly-sized components', () => {
    const id = generateIdentity();
    expect(id.publicKeys.ed25519.length).toBe(32);
    expect(id.publicKeys.x25519.length).toBe(32);
    expect(id.publicKeys.mlkem768.length).toBe(1184);
    expect(id.ed25519Secret.length).toBe(32);
    expect(id.x25519Secret.length).toBe(32);
  });

  it('encodes/decodes the public identity bundle round-trip', () => {
    const { publicKeys } = generateIdentity();
    const enc = encodeIdentityPublic(publicKeys);
    expect(enc.length).toBe(IDENTITY_PUBLIC_LEN);
    const dec = decodeIdentityPublic(enc);
    expect(Array.from(dec.ed25519)).toEqual(Array.from(publicKeys.ed25519));
    expect(Array.from(dec.x25519)).toEqual(Array.from(publicKeys.x25519));
    expect(Array.from(dec.mlkem768)).toEqual(Array.from(publicKeys.mlkem768));
  });

  it('rejects a wrong-length bundle on decode and bad components on encode', () => {
    expect(() => decodeIdentityPublic(new Uint8Array(IDENTITY_PUBLIC_LEN - 1))).toThrow(IdentityError);
    const bad: IdentityPublic = { ed25519: new Uint8Array(31), x25519: new Uint8Array(32), mlkem768: new Uint8Array(1184) };
    expect(() => encodeIdentityPublic(bad)).toThrow(IdentityError);
  });

  it('fingerprint is stable for the same identity and distinct across identities', () => {
    const a = generateIdentity().publicKeys;
    const b = generateIdentity().publicKeys;
    expect(Array.from(identityFingerprint(a))).toEqual(Array.from(identityFingerprint(a)));
    expect(identityFingerprint(a).length).toBe(32);
    expect(contactId(a)).toHaveLength(64); // hex of 32 bytes
    expect(contactId(a)).not.toBe(contactId(b));
  });

  it('safety number is order-independent, stable, and formatted as 12 groups of 5 digits', () => {
    const a = generateIdentity().publicKeys;
    const b = generateIdentity().publicKeys;
    const ab = safetyNumber(a, b);
    const ba = safetyNumber(b, a);
    expect(ab).toBe(ba); // both peers compute the same number regardless of order
    expect(safetyNumber(a, b)).toBe(ab); // stable
    expect(ab).toMatch(/^(\d{5} ){11}\d{5}$/); // 12 groups of 5 digits
  });

  it('safety number changes if either identity changes (MITM / key-swap detection)', () => {
    const a = generateIdentity().publicKeys;
    const b = generateIdentity().publicKeys;
    const c = generateIdentity().publicKeys; // imposter
    expect(safetyNumber(a, b)).not.toBe(safetyNumber(a, c));
  });
});
