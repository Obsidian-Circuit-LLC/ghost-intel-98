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
/** Byte cap on a decoded envelope body, enforced BEFORE UTF-8 decoding so a hostile peer can't force
 *  a ~1 MiB string allocation per frame (crypto-audit). UTF-8 ≤ ~4 bytes/char, so this comfortably
 *  covers MAX_MESSAGE_TEXT chars. */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** Force a reconnect/rehandshake well before the JS-safe-integer counter limit (audit: keeps the
 *  nonce/counter exact and bounds a never-dropped connection's lack of PCS). */
export const MAX_MESSAGES_PER_SESSION = 0x100000000; // 2^32

enum ContentType {
  Text = 1
}

export type MessageContent = { type: 'text'; text: string };

/** Serialize a typed envelope: [version, contentType, ...utf8(content)]. Versioned + type-tagged so
 *  Phases 2–4 add content types without a wire break. */
export function encodeEnvelope(content: MessageContent): Uint8Array {
  if (content.type !== 'text') throw new SessionError(`unsupported content type ${(content as { type: string }).type}`);
  if (content.text.length > MAX_MESSAGE_TEXT) throw new SessionError('message text exceeds cap');
  const body = new TextEncoder().encode(content.text);
  const out = new Uint8Array(2 + body.length);
  out[0] = ENVELOPE_VERSION;
  out[1] = ContentType.Text;
  out.set(body, 2);
  return out;
}

/** Parse + validate a decrypted envelope. Content-type allowlist = text only in Phase 1; unknown
 *  types are rejected (not silently dropped — the caller treats it as a protocol error). Text is
 *  returned faithfully; display sanitization (no-HTML, control chars) happens at the IPC boundary. */
export function decodeEnvelope(bytes: Uint8Array): MessageContent {
  if (bytes.length < 2) throw new SessionError('envelope truncated');
  if (bytes.length - 2 > MAX_MESSAGE_BYTES) throw new SessionError('message body exceeds byte cap');
  if (bytes[0] !== ENVELOPE_VERSION) throw new SessionError(`unsupported envelope version ${bytes[0]}`);
  if (bytes[1] !== ContentType.Text) throw new SessionError(`unsupported content type ${bytes[1]}`);
  const text = new TextDecoder().decode(bytes.slice(2));
  if (text.length > MAX_MESSAGE_TEXT) throw new SessionError('message text exceeds cap');
  return { type: 'text', text };
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
