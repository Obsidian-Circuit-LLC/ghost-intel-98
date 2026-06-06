/**
 * Chat session (Phase 1) — the per-message symmetric ratchet + AEAD that protects messages AFTER
 * the handshake establishes a root key. Forward secrecy: each message advances a per-direction
 * chain key and the previous key is zeroized, so a later compromise can't recover earlier messages.
 *
 * Scope: in-order, within a single connection (the onion stream is reliable TCP). Loss happens only
 * across disconnects, and a reconnect runs a fresh handshake → fresh root key → fresh Session, which
 * is where post-compromise healing comes from. So there is no skipped-key store here; an out-of-order
 * or replayed counter is rejected fail-closed.
 *
 * The root key + session id are INPUTS (produced by handshake.ts, which is frozen only after the
 * formalist/crypto-auditor gate). This module is pure + deterministic given those inputs and is
 * itself in scope for that crypto gate.
 */
import {
  aeadOpen,
  aeadSeal,
  hkdf,
  zeroize,
  AEAD_KEY_LEN,
  AEAD_NONCE_LEN,
  AEAD_TAG_LEN
} from './crypto';

export type Role = 'initiator' | 'responder';

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

// ---- typed message envelope (the decrypted `Msg` payload) ----

export const ENVELOPE_VERSION = 1;
export const MAX_MESSAGE_TEXT = 16 * 1024; // chars; Phase 2 attachments use their own chunk frames
/** Byte cap on a decoded TEXT envelope body, enforced BEFORE UTF-8 decoding so a hostile peer can't
 *  force a ~1 MiB string allocation per frame (crypto-audit). UTF-8 ≤ ~4 bytes/char, so this
 *  comfortably covers MAX_MESSAGE_TEXT chars. File content types carry their own (larger) caps. */
export const MAX_MESSAGE_BYTES = 64 * 1024;

// ---- file transfer wire sizes (Phase 2) ----
export const TRANSFER_ID_LEN = 16; // random per-transfer id (caller-supplied; not derived here)
export const FILE_HASH_LEN = 32; // sha256 of the whole file, bound in the offer + verified on assemble
export const CHUNK_SIZE = 128 * 1024; // payload bytes per FileChunk; each chunk is its own Msg frame
export const MAX_FILE_BYTES = 64 * 1024 * 1024; // 64 MiB hard cap on a single transfer
export const MAX_FILENAME_LEN = 255; // UTF-8 bytes
export const MAX_MIME_LEN = 128; // UTF-8 bytes
export const MAX_CHUNK_COUNT = Math.ceil(MAX_FILE_BYTES / CHUNK_SIZE); // bound for index/count validation
/** Byte cap on a decoded file-chunk body: transferId + index + at most one CHUNK_SIZE payload. Sits
 *  well under MAX_FRAME_PAYLOAD (1 MiB) even after AEAD + counter + frame overhead. */
const MAX_CHUNK_BODY = TRANSFER_ID_LEN + 4 + CHUNK_SIZE;
/** Byte cap on a decoded file-offer body: fixed prefix + bounded name + bounded mime. */
const MAX_OFFER_BODY = TRANSFER_ID_LEN + FILE_HASH_LEN + 4 + 4 + 2 + MAX_FILENAME_LEN + 2 + MAX_MIME_LEN;
const OFFER_FIXED_PREFIX = TRANSFER_ID_LEN + FILE_HASH_LEN + 4 + 4 + 2; // up to and including nameLen

// ---- group chat wire sizes (Phase 3, client-side fan-out) ----
export const GROUP_ID_LEN = 16; // random group coordinate (caller-minted)
export const CONTACT_ID_LEN = 32; // sha256 identity fingerprint = the contactId bytes
export const MAX_GROUP_NAME = 128; // UTF-8 bytes
export const MAX_GROUP_MEMBERS = 64; // bounds a group-invite member list
const MAX_GROUP_TEXT_BODY = GROUP_ID_LEN + MAX_MESSAGE_BYTES;
const MAX_GROUP_INVITE_BODY = GROUP_ID_LEN + 2 + MAX_GROUP_NAME + 2 + MAX_GROUP_MEMBERS * CONTACT_ID_LEN;

/** Force a reconnect/rehandshake well before the JS-safe-integer counter limit (audit: keeps the
 *  nonce/counter exact and bounds a never-dropped connection's lack of PCS). */
export const MAX_MESSAGES_PER_SESSION = 0x100000000; // 2^32

enum ContentType {
  Text = 1,
  FileOffer = 2,
  FileChunk = 3,
  GroupText = 4,
  GroupInvite = 5
}

export type MessageContent =
  | { type: 'text'; text: string }
  | {
      type: 'file-offer';
      transferId: Uint8Array;
      hash: Uint8Array;
      name: string;
      size: number;
      mime: string;
      chunkCount: number;
    }
  | { type: 'file-chunk'; transferId: Uint8Array; index: number; data: Uint8Array }
  | { type: 'group-text'; groupId: Uint8Array; text: string }
  | { type: 'group-invite'; groupId: Uint8Array; name: string; memberIds: Uint8Array[] };

const textEnc = new TextEncoder();

/** Prepend the [version, contentType] envelope header to a serialized body. */
function frameEnvelope(type: ContentType, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + body.length);
  out[0] = ENVELOPE_VERSION;
  out[1] = type;
  out.set(body, 2);
  return out;
}

/** Serialize a typed envelope: [version, contentType, ...body]. Versioned + type-tagged so Phases
 *  2–4 add content types without a wire break. Text bodies are UTF-8; file bodies are binary. */
export function encodeEnvelope(content: MessageContent): Uint8Array {
  switch (content.type) {
    case 'text': {
      if (content.text.length > MAX_MESSAGE_TEXT) throw new SessionError('message text exceeds cap');
      return frameEnvelope(ContentType.Text, textEnc.encode(content.text));
    }
    case 'file-offer':
      return frameEnvelope(ContentType.FileOffer, encodeFileOfferBody(content));
    case 'file-chunk':
      return frameEnvelope(ContentType.FileChunk, encodeFileChunkBody(content));
    case 'group-text':
      return frameEnvelope(ContentType.GroupText, encodeGroupTextBody(content));
    case 'group-invite':
      return frameEnvelope(ContentType.GroupInvite, encodeGroupInviteBody(content));
    default:
      throw new SessionError(`unsupported content type ${(content as { type: string }).type}`);
  }
}

function encodeGroupTextBody(c: Extract<MessageContent, { type: 'group-text' }>): Uint8Array {
  if (c.groupId.length !== GROUP_ID_LEN) throw new SessionError('bad groupId length');
  if (c.text.length > MAX_MESSAGE_TEXT) throw new SessionError('message text exceeds cap');
  const text = textEnc.encode(c.text);
  const body = new Uint8Array(GROUP_ID_LEN + text.length);
  body.set(c.groupId, 0);
  body.set(text, GROUP_ID_LEN);
  return body;
}

function encodeGroupInviteBody(c: Extract<MessageContent, { type: 'group-invite' }>): Uint8Array {
  if (c.groupId.length !== GROUP_ID_LEN) throw new SessionError('bad groupId length');
  if (c.memberIds.length > MAX_GROUP_MEMBERS) throw new SessionError('too many group members');
  for (const id of c.memberIds) if (id.length !== CONTACT_ID_LEN) throw new SessionError('bad member id length');
  const name = textEnc.encode(c.name);
  if (name.length === 0 || name.length > MAX_GROUP_NAME) throw new SessionError('group name length out of range');
  const body = new Uint8Array(GROUP_ID_LEN + 2 + name.length + 2 + c.memberIds.length * CONTACT_ID_LEN);
  const dv = new DataView(body.buffer);
  let o = 0;
  body.set(c.groupId, o); o += GROUP_ID_LEN;
  dv.setUint16(o, name.length); o += 2;
  body.set(name, o); o += name.length;
  dv.setUint16(o, c.memberIds.length); o += 2;
  for (const id of c.memberIds) { body.set(id, o); o += CONTACT_ID_LEN; }
  return body;
}

function encodeFileOfferBody(c: Extract<MessageContent, { type: 'file-offer' }>): Uint8Array {
  if (c.transferId.length !== TRANSFER_ID_LEN) throw new SessionError('bad transferId length');
  if (c.hash.length !== FILE_HASH_LEN) throw new SessionError('bad file hash length');
  if (!Number.isInteger(c.size) || c.size < 0 || c.size > MAX_FILE_BYTES) throw new SessionError('file size out of range');
  if (!Number.isInteger(c.chunkCount) || c.chunkCount < 0 || c.chunkCount > MAX_CHUNK_COUNT) throw new SessionError('chunkCount out of range');
  const name = textEnc.encode(c.name);
  const mime = textEnc.encode(c.mime);
  if (name.length === 0 || name.length > MAX_FILENAME_LEN) throw new SessionError('file name length out of range');
  if (mime.length > MAX_MIME_LEN) throw new SessionError('mime length out of range');
  const body = new Uint8Array(OFFER_FIXED_PREFIX + name.length + 2 + mime.length);
  const dv = new DataView(body.buffer);
  let o = 0;
  body.set(c.transferId, o); o += TRANSFER_ID_LEN;
  body.set(c.hash, o); o += FILE_HASH_LEN;
  dv.setUint32(o, c.size); o += 4;
  dv.setUint32(o, c.chunkCount); o += 4;
  dv.setUint16(o, name.length); o += 2;
  body.set(name, o); o += name.length;
  dv.setUint16(o, mime.length); o += 2;
  body.set(mime, o);
  return body;
}

function encodeFileChunkBody(c: Extract<MessageContent, { type: 'file-chunk' }>): Uint8Array {
  if (c.transferId.length !== TRANSFER_ID_LEN) throw new SessionError('bad transferId length');
  if (!Number.isInteger(c.index) || c.index < 0 || c.index >= MAX_CHUNK_COUNT) throw new SessionError('chunk index out of range');
  if (c.data.length === 0 || c.data.length > CHUNK_SIZE) throw new SessionError('chunk size out of range');
  const body = new Uint8Array(TRANSFER_ID_LEN + 4 + c.data.length);
  const dv = new DataView(body.buffer);
  body.set(c.transferId, 0);
  dv.setUint32(TRANSFER_ID_LEN, c.index);
  body.set(c.data, TRANSFER_ID_LEN + 4);
  return body;
}

/** Parse + validate a decrypted envelope. Content-type allowlist = {text, file-offer, file-chunk};
 *  unknown types are rejected (not silently dropped — the caller treats it as a protocol error). Each
 *  type enforces its own byte cap BEFORE allocating. Text/name/mime display sanitization (no-HTML,
 *  control chars) happens later at the IPC boundary. */
export function decodeEnvelope(bytes: Uint8Array): MessageContent {
  if (bytes.length < 2) throw new SessionError('envelope truncated');
  if (bytes[0] !== ENVELOPE_VERSION) throw new SessionError(`unsupported envelope version ${bytes[0]}`);
  const type = bytes[1];
  const body = bytes.subarray(2);
  switch (type) {
    case ContentType.Text: {
      if (body.length > MAX_MESSAGE_BYTES) throw new SessionError('message body exceeds byte cap');
      const text = new TextDecoder().decode(body);
      if (text.length > MAX_MESSAGE_TEXT) throw new SessionError('message text exceeds cap');
      return { type: 'text', text };
    }
    case ContentType.FileOffer:
      return decodeFileOfferBody(body);
    case ContentType.FileChunk:
      return decodeFileChunkBody(body);
    case ContentType.GroupText:
      return decodeGroupTextBody(body);
    case ContentType.GroupInvite:
      return decodeGroupInviteBody(body);
    default:
      throw new SessionError(`unsupported content type ${type}`);
  }
}

function decodeGroupTextBody(body: Uint8Array): MessageContent {
  if (body.length > MAX_GROUP_TEXT_BODY) throw new SessionError('group message body exceeds cap');
  if (body.length < GROUP_ID_LEN) throw new SessionError('group message truncated');
  const groupId = body.slice(0, GROUP_ID_LEN);
  const text = new TextDecoder().decode(body.subarray(GROUP_ID_LEN));
  if (text.length > MAX_MESSAGE_TEXT) throw new SessionError('message text exceeds cap');
  return { type: 'group-text', groupId, text };
}

function decodeGroupInviteBody(body: Uint8Array): MessageContent {
  if (body.length > MAX_GROUP_INVITE_BODY) throw new SessionError('group invite body exceeds cap');
  if (body.length < GROUP_ID_LEN + 2) throw new SessionError('group invite truncated');
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let o = 0;
  const groupId = body.slice(o, o + GROUP_ID_LEN); o += GROUP_ID_LEN;
  const nameLen = dv.getUint16(o); o += 2;
  if (nameLen === 0 || nameLen > MAX_GROUP_NAME) throw new SessionError('group name length out of range');
  if (o + nameLen + 2 > body.length) throw new SessionError('group invite truncated (name)');
  const name = new TextDecoder().decode(body.subarray(o, o + nameLen)); o += nameLen;
  const count = dv.getUint16(o); o += 2;
  if (count > MAX_GROUP_MEMBERS) throw new SessionError('too many group members');
  if (o + count * CONTACT_ID_LEN !== body.length) throw new SessionError('group invite length mismatch');
  const memberIds: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) { memberIds.push(body.slice(o, o + CONTACT_ID_LEN)); o += CONTACT_ID_LEN; }
  return { type: 'group-invite', groupId, name, memberIds };
}

function decodeFileOfferBody(body: Uint8Array): MessageContent {
  if (body.length > MAX_OFFER_BODY) throw new SessionError('file offer body exceeds cap');
  if (body.length < OFFER_FIXED_PREFIX) throw new SessionError('file offer truncated');
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let o = 0;
  const transferId = body.slice(o, o + TRANSFER_ID_LEN); o += TRANSFER_ID_LEN;
  const hash = body.slice(o, o + FILE_HASH_LEN); o += FILE_HASH_LEN;
  const size = dv.getUint32(o); o += 4;
  const chunkCount = dv.getUint32(o); o += 4;
  const nameLen = dv.getUint16(o); o += 2;
  if (nameLen === 0 || nameLen > MAX_FILENAME_LEN) throw new SessionError('file name length out of range');
  if (o + nameLen + 2 > body.length) throw new SessionError('file offer truncated (name)');
  const name = new TextDecoder().decode(body.subarray(o, o + nameLen)); o += nameLen;
  const mimeLen = dv.getUint16(o); o += 2;
  if (mimeLen > MAX_MIME_LEN) throw new SessionError('mime length out of range');
  if (o + mimeLen !== body.length) throw new SessionError('file offer length mismatch');
  const mime = new TextDecoder().decode(body.subarray(o, o + mimeLen));
  if (size > MAX_FILE_BYTES) throw new SessionError('file size exceeds cap');
  if (chunkCount > MAX_CHUNK_COUNT) throw new SessionError('chunkCount out of range');
  const expected = size === 0 ? 0 : Math.ceil(size / CHUNK_SIZE);
  if (chunkCount !== expected) throw new SessionError('chunkCount inconsistent with size');
  return { type: 'file-offer', transferId, hash, name, size, mime, chunkCount };
}

function decodeFileChunkBody(body: Uint8Array): MessageContent {
  if (body.length > MAX_CHUNK_BODY) throw new SessionError('file chunk body exceeds cap');
  if (body.length < TRANSFER_ID_LEN + 4 + 1) throw new SessionError('file chunk truncated');
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const transferId = body.slice(0, TRANSFER_ID_LEN);
  const index = dv.getUint32(TRANSFER_ID_LEN);
  const data = body.slice(TRANSFER_ID_LEN + 4);
  if (data.length > CHUNK_SIZE) throw new SessionError('chunk size out of range');
  if (index >= MAX_CHUNK_COUNT) throw new SessionError('chunk index out of range');
  return { type: 'file-chunk', transferId, index, data };
}

// ---- symmetric ratchet ----

const RATCHET_SALT = new Uint8Array(0);
const INFO_MSG = new TextEncoder().encode('dcs98-chat/ratchet/msg');
const INFO_CHAIN = new TextEncoder().encode('dcs98-chat/ratchet/chain');
const INFO_I2R = new TextEncoder().encode('dcs98-chat/chain/i2r');
const INFO_R2I = new TextEncoder().encode('dcs98-chat/chain/r2i');

/** One ratchet step: derive this message's key and the next chain key from the current chain key.
 *  Exported for unit testing the FS construction. Pure. */
export function chainStep(chainKey: Uint8Array): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  return {
    messageKey: hkdf(chainKey, RATCHET_SALT, INFO_MSG, AEAD_KEY_LEN),
    nextChainKey: hkdf(chainKey, RATCHET_SALT, INFO_CHAIN, 32)
  };
}

function nonceFromCounter(counter: number): Uint8Array {
  const nonce = new Uint8Array(AEAD_NONCE_LEN); // 12; first 4 bytes zero
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  nonce[4] = (hi >>> 24) & 0xff;
  nonce[5] = (hi >>> 16) & 0xff;
  nonce[6] = (hi >>> 8) & 0xff;
  nonce[7] = hi & 0xff;
  nonce[8] = (lo >>> 24) & 0xff;
  nonce[9] = (lo >>> 16) & 0xff;
  nonce[10] = (lo >>> 8) & 0xff;
  nonce[11] = lo & 0xff;
  return nonce;
}

function writeCounter(buf: Uint8Array, off: number, counter: number): void {
  buf.set(nonceFromCounter(counter).subarray(4), off); // reuse the 8-byte big-endian encoding
}

function readCounter(buf: Uint8Array, off: number): number {
  const hi =
    ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
  const lo =
    ((buf[off + 4] << 24) | (buf[off + 5] << 16) | (buf[off + 6] << 8) | buf[off + 7]) >>> 0;
  return hi * 0x100000000 + lo;
}

/** AAD binds session id + direction + counter, so a frame can't be replayed in the other direction
 *  or in another session. */
function aadFor(sessionId: Uint8Array, dir: number, counter: number): Uint8Array {
  const aad = new Uint8Array(sessionId.length + 1 + 8);
  aad.set(sessionId, 0);
  aad[sessionId.length] = dir;
  writeCounter(aad, sessionId.length + 1, counter);
  return aad;
}

const DIR_I2R = 0;
const DIR_R2I = 1;

/**
 * A live session's encrypt/decrypt state. Construct from the handshake's root key + session id and
 * the local role. Sealed message layout (the `Msg` frame payload): counter(8) ‖ AEAD(ct‖tag).
 */
export class Session {
  private sendChain: Uint8Array;
  private recvChain: Uint8Array;
  private sendCounter = 0;
  private recvCounter = 0;
  private readonly sendDir: number;
  private readonly recvDir: number;

  constructor(private readonly sessionId: Uint8Array, rootKey: Uint8Array, role: Role) {
    if (rootKey.length !== 32) throw new SessionError('root key must be 32 bytes');
    const i2r = hkdf(rootKey, sessionId, INFO_I2R, 32);
    const r2i = hkdf(rootKey, sessionId, INFO_R2I, 32);
    if (role === 'initiator') {
      this.sendChain = i2r;
      this.recvChain = r2i;
      this.sendDir = DIR_I2R;
      this.recvDir = DIR_R2I;
    } else {
      this.sendChain = r2i;
      this.recvChain = i2r;
      this.sendDir = DIR_R2I;
      this.recvDir = DIR_I2R;
    }
  }

  /** Encrypt one plaintext envelope → sealed `Msg` payload. Advances + zeroizes the send chain. */
  encrypt(plaintext: Uint8Array): Uint8Array {
    if (this.sendCounter >= MAX_MESSAGES_PER_SESSION) {
      throw new SessionError('session message cap reached — reconnect to rekey');
    }
    const { messageKey, nextChainKey } = chainStep(this.sendChain);
    zeroize(this.sendChain);
    this.sendChain = nextChainKey;
    const counter = this.sendCounter;
    this.sendCounter += 1;
    const aad = aadFor(this.sessionId, this.sendDir, counter);
    const sealed = aeadSeal(messageKey, nonceFromCounter(counter), plaintext, aad);
    zeroize(messageKey);
    const out = new Uint8Array(8 + sealed.length);
    writeCounter(out, 0, counter);
    out.set(sealed, 8);
    return out;
  }

  /** Decrypt a sealed `Msg` payload → plaintext envelope. Strict in-order; rejects replay, gaps, and
   *  auth failures fail-closed. The receive chain only advances AFTER a successful open, so a forged
   *  frame can't desync the ratchet. */
  decrypt(framePayload: Uint8Array): Uint8Array {
    if (framePayload.length < 8 + AEAD_TAG_LEN) throw new SessionError('sealed message too short');
    const counter = readCounter(framePayload, 0);
    if (counter < this.recvCounter) throw new SessionError('replayed message');
    if (counter !== this.recvCounter) throw new SessionError('out-of-order message');
    if (counter >= MAX_MESSAGES_PER_SESSION) throw new SessionError('session message cap reached');

    const { messageKey, nextChainKey } = chainStep(this.recvChain);
    const aad = aadFor(this.sessionId, this.recvDir, counter);
    let plaintext: Uint8Array;
    try {
      plaintext = aeadOpen(messageKey, nonceFromCounter(counter), framePayload.subarray(8), aad);
    } catch (err) {
      zeroize(messageKey, nextChainKey); // discard; do NOT advance recv chain on failure
      throw new SessionError('message authentication failed');
    }
    zeroize(this.recvChain, messageKey);
    this.recvChain = nextChainKey;
    this.recvCounter += 1;
    return plaintext;
  }

  /** Wipe live key state (called on session teardown / vault lock). */
  destroy(): void {
    zeroize(this.sendChain, this.recvChain);
  }
}
