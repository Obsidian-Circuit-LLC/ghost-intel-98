/**
 * Chat invite links (Phase 1) — the out-of-band token a user sends to start a 1:1 contact.
 *
 * Format: `dcs98chat://invite/<base64url(payload)>` where payload is:
 *   byte 0            version
 *   byte 1            onion length (uint8)
 *   bytes 2..         onion address (UTF-8, v3 `.onion`)
 *   next 1248 bytes   inviter identity bundle (ed25519‖x25519‖ml-kem768)
 *   final 32 bytes    one-time invite token
 *
 * The link is SECRET-grade — whoever holds it can initiate first contact. The one-time token
 * authenticates that first connection; the engine marks it consumed after a successful handshake
 * (one-time semantics live in the store, not in this pure codec). This module only
 * encodes/decodes/validates structure and rejects malformed input fail-closed.
 */
import { randomBytes } from './crypto';
import { decodeIdentityPublic, encodeIdentityPublic, IDENTITY_PUBLIC_LEN, type IdentityPublic } from './identity';

export const INVITE_VERSION = 1;
export const INVITE_TOKEN_LEN = 32;
export const INVITE_PREFIX = 'dcs98chat://invite/';
const MAX_ONION_LEN = 255;
const ONION_V3 = /^[a-z2-7]{56}\.onion$/;

export interface ParsedInvite {
  version: number;
  onion: string;
  identityPublic: IdentityPublic;
  token: Uint8Array;
}

export class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteError';
  }
}

export function isValidOnionV3(s: string): boolean {
  return ONION_V3.test(s);
}

/** A fresh 32-byte one-time invite token. The engine persists it as pending and consumes it on the
 *  first successful handshake. */
export function mintInviteToken(): Uint8Array {
  return randomBytes(INVITE_TOKEN_LEN);
}

export function createInvite(params: { onion: string; identityPublic: IdentityPublic; token: Uint8Array }): string {
  const { onion, identityPublic, token } = params;
  if (!isValidOnionV3(onion)) throw new InviteError('invalid v3 onion address');
  if (token.length !== INVITE_TOKEN_LEN) throw new InviteError(`token must be ${INVITE_TOKEN_LEN} bytes`);
  const onionBytes = new TextEncoder().encode(onion);
  if (onionBytes.length > MAX_ONION_LEN) throw new InviteError('onion address too long');
  const idBytes = encodeIdentityPublic(identityPublic); // throws on bad component lengths

  const payload = new Uint8Array(2 + onionBytes.length + IDENTITY_PUBLIC_LEN + INVITE_TOKEN_LEN);
  payload[0] = INVITE_VERSION;
  payload[1] = onionBytes.length;
  let off = 2;
  payload.set(onionBytes, off);
  off += onionBytes.length;
  payload.set(idBytes, off);
  off += IDENTITY_PUBLIC_LEN;
  payload.set(token, off);

  return INVITE_PREFIX + Buffer.from(payload).toString('base64url');
}

export function parseInvite(link: string): ParsedInvite {
  if (typeof link !== 'string' || !link.startsWith(INVITE_PREFIX)) {
    throw new InviteError('not a dcs98 chat invite link');
  }
  const b64 = link.slice(INVITE_PREFIX.length);
  // Strict base64url: decode then re-encode and compare, so malformed/padded input is rejected
  // rather than silently truncated (Buffer's base64 decode is lenient).
  const payload = new Uint8Array(Buffer.from(b64, 'base64url'));
  if (Buffer.from(payload).toString('base64url') !== b64) {
    throw new InviteError('malformed invite encoding');
  }
  if (payload.length < 2) throw new InviteError('invite payload truncated');

  const version = payload[0];
  if (version !== INVITE_VERSION) throw new InviteError(`unsupported invite version ${version}`);
  const onionLen = payload[1];
  const need = 2 + onionLen + IDENTITY_PUBLIC_LEN + INVITE_TOKEN_LEN;
  if (payload.length !== need) throw new InviteError('invite payload length mismatch');

  const onion = new TextDecoder().decode(payload.slice(2, 2 + onionLen));
  if (!isValidOnionV3(onion)) throw new InviteError('invalid v3 onion address in invite');

  const idStart = 2 + onionLen;
  const identityPublic = decodeIdentityPublic(payload.slice(idStart, idStart + IDENTITY_PUBLIC_LEN));
  const token = payload.slice(idStart + IDENTITY_PUBLIC_LEN);

  return { version, onion, identityPublic, token };
}
