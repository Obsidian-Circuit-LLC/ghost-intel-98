/**
 * Chat invite links (Phase 1, v3) — `dcs98chat://invite/<base64url(payload)>`.
 *
 * The invite is SECRET-grade (whoever holds it can initiate first contact). v3 carries the
 * responder's full identity (Ed25519 + X25519), one signed KEM prekey, and a one-time token — and
 * the WHOLE invite is signed under the responder's Ed25519 identity (`sig_invite`), so an invite-
 * channel MITM can't swap `xs_R`/onion/prekey (gate H-6). TOFU still pins `is_R` via the human safety
 * number. Strict, fail-closed parsing.
 *
 * Payload (fixed-width except onion): version(1) ‖ onionLen(1) ‖ onion ‖ identity(64) ‖ prekey ‖
 *   token(32) ‖ sig_invite(64).
 */
import { ed25519Sign, ed25519Verify, randomBytes, ED25519_SIG_LEN } from './crypto';
import { DS_INVITE, SUITE_ID, concatBytes } from './constants';
import {
  decodeIdentityPublic,
  encodeIdentityPublic,
  decodeKemPrekey,
  encodeKemPrekey,
  verifyKemPrekey,
  ed25519Pair,
  IDENTITY_PUBLIC_LEN,
  KEM_PREKEY_LEN,
  type IdentityKeyPair,
  type IdentityPublic,
  type KemPrekey
} from './identity';

export const INVITE_VERSION = 2;
export const INVITE_TOKEN_LEN = 32;
export const INVITE_PREFIX = 'dcs98chat://invite/';
const MAX_ONION_LEN = 255;
const ONION_V3 = /^[a-z2-7]{56}\.onion$/;

export interface ParsedInvite {
  version: number;
  onion: string;
  responderPublic: IdentityPublic;
  prekey: KemPrekey;
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

export function mintInviteToken(): Uint8Array {
  return randomBytes(INVITE_TOKEN_LEN);
}

/** Canonical message the responder signs over the whole invite. */
function inviteSignedMessage(onion: string, identity: Uint8Array, prekey: Uint8Array, token: Uint8Array): Uint8Array {
  return concatBytes(DS_INVITE, SUITE_ID, new TextEncoder().encode(onion), identity, prekey, token);
}

export function createInvite(params: {
  responder: IdentityKeyPair;
  onion: string;
  prekey: KemPrekey;
  token: Uint8Array;
}): string {
  const { responder, onion, prekey, token } = params;
  if (!isValidOnionV3(onion)) throw new InviteError('invalid v3 onion address');
  if (token.length !== INVITE_TOKEN_LEN) throw new InviteError(`token must be ${INVITE_TOKEN_LEN} bytes`);
  const onionBytes = new TextEncoder().encode(onion);
  if (onionBytes.length > MAX_ONION_LEN) throw new InviteError('onion address too long');

  const identity = encodeIdentityPublic(responder.publicKeys);
  const prekeyBytes = encodeKemPrekey(prekey);
  const sigInvite = ed25519Sign(inviteSignedMessage(onion, identity, prekeyBytes, token), ed25519Pair(responder));

  const payload = new Uint8Array(
    2 + onionBytes.length + IDENTITY_PUBLIC_LEN + KEM_PREKEY_LEN + INVITE_TOKEN_LEN + ED25519_SIG_LEN
  );
  let off = 0;
  payload[off++] = INVITE_VERSION;
  payload[off++] = onionBytes.length;
  payload.set(onionBytes, off); off += onionBytes.length;
  payload.set(identity, off); off += IDENTITY_PUBLIC_LEN;
  payload.set(prekeyBytes, off); off += KEM_PREKEY_LEN;
  payload.set(token, off); off += INVITE_TOKEN_LEN;
  payload.set(sigInvite, off);

  return INVITE_PREFIX + Buffer.from(payload).toString('base64url');
}

export function parseInvite(link: string): ParsedInvite {
  if (typeof link !== 'string' || !link.startsWith(INVITE_PREFIX)) {
    throw new InviteError('not a dcs98 chat invite link');
  }
  // Normalize stray padding/whitespace, then strict canonical re-encode check.
  const b64 = link.slice(INVITE_PREFIX.length).trim().replace(/=+$/, '');
  const payload = new Uint8Array(Buffer.from(b64, 'base64url'));
  if (Buffer.from(payload).toString('base64url') !== b64) throw new InviteError('malformed invite encoding');
  if (payload.length < 2) throw new InviteError('invite payload truncated');

  const version = payload[0];
  if (version !== INVITE_VERSION) throw new InviteError(`unsupported invite version ${version}`);
  const onionLen = payload[1];
  const need = 2 + onionLen + IDENTITY_PUBLIC_LEN + KEM_PREKEY_LEN + INVITE_TOKEN_LEN + ED25519_SIG_LEN;
  if (payload.length !== need) throw new InviteError('invite payload length mismatch');

  let off = 2;
  const onionBytes = payload.slice(off, off + onionLen); off += onionLen;
  const onion = new TextDecoder().decode(onionBytes);
  if (!isValidOnionV3(onion)) throw new InviteError('invalid v3 onion address in invite');

  const identityBytes = payload.slice(off, off + IDENTITY_PUBLIC_LEN); off += IDENTITY_PUBLIC_LEN;
  const prekeyBytes = payload.slice(off, off + KEM_PREKEY_LEN); off += KEM_PREKEY_LEN;
  const token = payload.slice(off, off + INVITE_TOKEN_LEN); off += INVITE_TOKEN_LEN;
  const sigInvite = payload.slice(off, off + ED25519_SIG_LEN);

  const responderPublic = decodeIdentityPublic(identityBytes);
  const prekey = decodeKemPrekey(prekeyBytes);

  // Verify the whole-invite signature, then the prekey signature — both under is_R. Fail-closed.
  if (!ed25519Verify(sigInvite, inviteSignedMessage(onion, identityBytes, prekeyBytes, token), responderPublic.ed25519)) {
    throw new InviteError('invite signature invalid');
  }
  if (!verifyKemPrekey(prekey, responderPublic.ed25519)) {
    throw new InviteError('invite prekey signature invalid');
  }

  return { version, onion, responderPublic, prekey, token };
}
