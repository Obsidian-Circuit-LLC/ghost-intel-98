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
import { generateIdentity } from '../src/main/chat/identity';

const ONION = `${'a'.repeat(56)}.onion`; // valid v3 onion shape (base32 a-z2-7)

function sampleInvite(): string {
  return createInvite({ onion: ONION, identityPublic: generateIdentity().publicKeys, token: mintInviteToken() });
}

describe('chat invite links', () => {
  it('round-trips onion, identity, and token', () => {
    const id = generateIdentity().publicKeys;
    const token = mintInviteToken();
    const link = createInvite({ onion: ONION, identityPublic: id, token });
    expect(link.startsWith(INVITE_PREFIX)).toBe(true);

    const parsed = parseInvite(link);
    expect(parsed.onion).toBe(ONION);
    expect(parsed.version).toBe(1);
    expect(Array.from(parsed.token)).toEqual(Array.from(token));
    expect(Array.from(parsed.identityPublic.ed25519)).toEqual(Array.from(id.ed25519));
    expect(Array.from(parsed.identityPublic.mlkem768)).toEqual(Array.from(id.mlkem768));
  });

  it('mints 32-byte tokens that vary', () => {
    const a = mintInviteToken();
    const b = mintInviteToken();
    expect(a.length).toBe(INVITE_TOKEN_LEN);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('validates v3 onion shape', () => {
    expect(isValidOnionV3(ONION)).toBe(true);
    expect(isValidOnionV3('tooshort.onion')).toBe(false);
    expect(isValidOnionV3(`${'a'.repeat(56)}.com`)).toBe(false);
    expect(isValidOnionV3(`${'A'.repeat(56)}.onion`)).toBe(false); // uppercase not base32 lc
    expect(isValidOnionV3(`${'1'.repeat(56)}.onion`)).toBe(false); // '1' not in base32 a-z2-7
  });

  it('rejects a bad onion or wrong-length token on create', () => {
    const id = generateIdentity().publicKeys;
    expect(() => createInvite({ onion: 'nope.onion', identityPublic: id, token: mintInviteToken() })).toThrow(InviteError);
    expect(() => createInvite({ onion: ONION, identityPublic: id, token: new Uint8Array(16) })).toThrow(InviteError);
  });

  it('rejects malformed links: bad prefix, bad base64, truncation, version, tampered length', () => {
    expect(() => parseInvite('https://example.com/x')).toThrow(InviteError);
    expect(() => parseInvite(`${INVITE_PREFIX}!!!not base64!!!`)).toThrow(InviteError);
    expect(() => parseInvite(`${INVITE_PREFIX}AAAA`)).toThrow(InviteError); // decodes but too short

    // Flip the version byte of a valid invite.
    const link = sampleInvite();
    const payload = new Uint8Array(Buffer.from(link.slice(INVITE_PREFIX.length), 'base64url'));
    payload[0] = 2; // unsupported version
    const badVer = INVITE_PREFIX + Buffer.from(payload).toString('base64url');
    expect(() => parseInvite(badVer)).toThrow(InviteError);

    // Truncate the payload (length mismatch).
    const truncated = INVITE_PREFIX + Buffer.from(payload.slice(0, payload.length - 5)).toString('base64url');
    expect(() => parseInvite(truncated)).toThrow(InviteError);
  });

  it('rejects an invite whose embedded identity bundle is corrupt', () => {
    const link = sampleInvite();
    const payload = new Uint8Array(Buffer.from(link.slice(INVITE_PREFIX.length), 'base64url'));
    // onionLen is at byte 1; corrupt it so the declared length no longer matches → mismatch throw
    payload[1] = payload[1] + 1;
    const bad = INVITE_PREFIX + Buffer.from(payload).toString('base64url');
    expect(() => parseInvite(bad)).toThrow(InviteError);
  });
});
