import { describe, it, expect } from 'vitest';
import {
  createInvite,
  parseInvite,
  mintInviteToken,
  isValidOnionV3,
  InviteError,
  INVITE_PREFIX,
  INVITE_TOKEN_LEN
} from '../src/main/chat/invite';
import { generateIdentity, generateKemPrekey, type IdentityKeyPair, type KemPrekey } from '../src/main/chat/identity';

const ONION = `${'a'.repeat(56)}.onion`;

function sample(): { responder: IdentityKeyPair; prekey: KemPrekey; token: Uint8Array; link: string } {
  const responder = generateIdentity();
  const { prekey } = generateKemPrekey(responder);
  const token = mintInviteToken();
  const link = createInvite({ responder, onion: ONION, prekey, token });
  return { responder, prekey, token, link };
}

function payloadOf(link: string): Uint8Array {
  return new Uint8Array(Buffer.from(link.slice(INVITE_PREFIX.length), 'base64url'));
}
function relink(payload: Uint8Array): string {
  return INVITE_PREFIX + Buffer.from(payload).toString('base64url');
}

describe('chat invite links (v3)', () => {
  it('round-trips onion, responder identity, prekey, token', () => {
    const { responder, prekey, token, link } = sample();
    expect(link.startsWith(INVITE_PREFIX)).toBe(true);
    const p = parseInvite(link);
    expect(p.version).toBe(2);
    expect(p.onion).toBe(ONION);
    expect(Array.from(p.token)).toEqual(Array.from(token));
    expect(Array.from(p.responderPublic.ed25519)).toEqual(Array.from(responder.publicKeys.ed25519));
    expect(Array.from(p.responderPublic.x25519)).toEqual(Array.from(responder.publicKeys.x25519));
    expect(Array.from(p.prekey.prekeyId)).toEqual(Array.from(prekey.prekeyId));
  });

  it('validates v3 onion shape', () => {
    expect(isValidOnionV3(ONION)).toBe(true);
    expect(isValidOnionV3('short.onion')).toBe(false);
    expect(isValidOnionV3(`${'A'.repeat(56)}.onion`)).toBe(false);
  });

  it('rejects bad onion / wrong-length token on create', () => {
    const responder = generateIdentity();
    const { prekey } = generateKemPrekey(responder);
    expect(() => createInvite({ responder, onion: 'nope.onion', prekey, token: mintInviteToken() })).toThrow(InviteError);
    expect(() => createInvite({ responder, onion: ONION, prekey, token: new Uint8Array(16) })).toThrow(InviteError);
  });

  it('rejects a tampered xs_R (whole-invite signature catches it)', () => {
    const { link } = sample();
    const payload = payloadOf(link);
    // xs_R sits inside the identity bundle: after version(1)+onionLen(1)+onion(62)+ed25519(32).
    const xsROffset = 2 + 56 + 32; // onion is 56 chars + '.onion' = 62; ed25519 is 32 → xs_R starts here
    payload[xsROffset + 6] ^= 0x01; // flip an x25519 byte (offset within onion handled below)
    expect(() => parseInvite(relink(payload))).toThrow(InviteError);
  });

  it('rejects a tampered onion / token (signature catches it)', () => {
    const { link } = sample();
    const p1 = payloadOf(link);
    p1[3] ^= 0x01; // flip an onion byte
    expect(() => parseInvite(relink(p1))).toThrow(InviteError);
    const p2 = payloadOf(link);
    p2[p2.length - 1 - 64] ^= 0x01; // flip a token byte (token is just before the 64-byte sig)
    expect(() => parseInvite(relink(p2))).toThrow(InviteError);
  });

  it('accepts a link with trailing padding / whitespace', () => {
    const { link } = sample();
    expect(() => parseInvite(`${link}==`)).not.toThrow();
    expect(parseInvite(`${link}\n`).onion).toBe(ONION);
  });

  it('rejects malformed links: bad prefix, bad base64, truncation, version', () => {
    expect(() => parseInvite('https://example.com/x')).toThrow(InviteError);
    expect(() => parseInvite(`${INVITE_PREFIX}!!!`)).toThrow(InviteError);
    expect(() => parseInvite(`${INVITE_PREFIX}AAAA`)).toThrow(InviteError);
    const { link } = sample();
    const payload = payloadOf(link);
    payload[0] = 1; // wrong version
    expect(() => parseInvite(relink(payload))).toThrow(InviteError);
    const truncated = relink(payload.slice(0, payload.length - 10));
    expect(() => parseInvite(truncated)).toThrow(InviteError);
  });

  it('exposes INVITE_TOKEN_LEN = 32', () => {
    expect(INVITE_TOKEN_LEN).toBe(32);
  });
});
