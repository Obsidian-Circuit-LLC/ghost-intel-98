/**
 * Chat handshake (Phase 1, v3) — interactive PQ-hybrid mutually-authenticated key exchange.
 *
 * ⚠ EXPERIMENTAL — the construction (see docs/superpowers/specs/...-v3.md) is PENDING formal
 *   verification (ProVerif/CryptoVerif, docs/superpowers/formal/). This implementation is for
 *   functional testing only; it is NOT yet a verified-secure handshake. Do not rely on it for real
 *   adversarial threat models until the formal-verification gate passes.
 *
 * Initiator I (dialer/invitee) ⇄ Responder R (inviter/listener). Produces a forward-secret root key
 * + session id consumed by session.ts. Hybrid: X25519 (es/ee/se) ⊕ ML-KEM-1024 (ss_pre to R's signed
 * prekey, ss_I to I's per-handshake ephemeral). Token `mac_T` pre-gate rejects unauthenticated Msg1
 * before any asymmetric op; verify-before-encap; durable one-time prekey/token consumption.
 */
import {
  x25519Keygen, x25519Ecdh, mlkemKeygen, mlkemEncapsulate, mlkemDecapsulate,
  ed25519Sign, ed25519Verify, hkdf, sha256, hmacSha256, aeadSeal, aeadOpen,
  zeroize, constantTimeEqual,
  X25519_PUBLIC_LEN, MLKEM_PUBLIC_LEN, MLKEM_CT_LEN, ED25519_PUBLIC_LEN, ED25519_SIG_LEN,
  AEAD_NONCE_LEN
} from './crypto';
import {
  encodeIdentityPublic, encodeKemPrekey, decodeKemPrekey, verifyKemPrekey, ed25519Pair, x25519Pair,
  KEM_PREKEY_LEN, PREKEY_ID_LEN,
  type IdentityKeyPair, type IdentityPublic, type KemPrekey
} from './identity';
import {
  PROTO_LABEL, SUITE_ID, DS_HS_INIT, DS_HS_RESP, DS_MAC_T, DS_MAC_R,
  MIX_INIT, MIX_ES, MIX_SSPRE, MIX_EE, MIX_SE, MIX_SSI, DRV_HK1, DRV_HK2, DRV_ROOT, DRV_SID,
  RECONNECT_GATE,
  concatBytes
} from './constants';
import { Session } from './session';
import { FrameDecoder, FrameType, encodeFrame } from './wire';
import type { ChatStream } from './transport';

export type HandshakeMode = 'first_contact' | 'reconnect';
const MODE_FIRST = 0;
const MODE_RECONNECT = 1;
const NONCE0 = new Uint8Array(AEAD_NONCE_LEN);
const TOKEN_LEN = 32;
const MAC_LEN = 32;
const ID_PT_LEN = X25519_PUBLIC_LEN + ED25519_PUBLIC_LEN + ED25519_SIG_LEN; // xs_I‖is_I‖Sig_I

export class HandshakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandshakeError';
  }
}

// ---- responder-side stores (injected; durable impls live in the persistence layer) ----
export interface ResponderInviteStore {
  /** Full prekey record + secret for a prekeyId R issued; `token` set only for first-contact invites.
   *  Null if unknown or already consumed. */
  lookup(prekeyId: Uint8Array): Promise<{ prekey: KemPrekey; secretKey: Uint8Array; token: Uint8Array | null } | null>;
  /** Durably consume a one-time prekey/token (no-op for last-resort). Must fsync before returning. */
  consume(prekeyId: Uint8Array): Promise<void>;
  /** Release a reservation taken by lookup() when the handshake aborts before consume(). */
  release(prekeyId: Uint8Array): Promise<void>;
  /** A fresh signed prekey to hand the peer for next time (rotation). */
  issueNext(): Promise<KemPrekey>;
  /** Which contact (cid) a given prekeyId was issued to; null if unknown. Cheap index lookup — no
   *  crypto, no reservation — used by the reconnect pre-gate before any asymmetric work (rev-4 §3). */
  identifyContact(prekeyId: Uint8Array): Promise<string | null>;
}
export interface ContactPinStore {
  get(peerEd25519: Uint8Array): Promise<IdentityPublic | null>;
  pin(peer: IdentityPublic): Promise<void>;
  /** The per-contact reconnect gate key (RGK), or null if none held (rev-4 §3). */
  getReconnectKey(cid: string): Promise<Uint8Array | null>;
  /** Whether R has already verified one valid mac_R from this contact (the enforcement-bootstrap
   *  flag). R enforces the mac_R pre-gate only once this is true → no mid-handshake lockout. */
  isRgkConfirmed(cid: string): Promise<boolean>;
}

export interface InitiatorOpts {
  identity: IdentityKeyPair;
  responderPublic: IdentityPublic;
  prekey: KemPrekey;          // from the invite (first contact) or stored rotation (reconnect)
  token?: Uint8Array;         // present iff first_contact
  mode: HandshakeMode;
  /** Per-contact reconnect gate key (RGK), if held. On a reconnect, I ALWAYS includes mac_R whenever
   *  it holds an RGK for the contact (rev-4 §3). Ignored on first_contact. */
  reconnectGateKey?: Uint8Array;
}
export interface ResponderOpts {
  identity: IdentityKeyPair;
  invites: ResponderInviteStore;
  contacts: ContactPinStore;
}

export interface HandshakeResult {
  session: Session;
  peer: IdentityPublic;
  /** R's rotation prekey for next time (initiator only) — caller persists it. */
  nextPrekey?: KemPrekey;
  mode: HandshakeMode;
  /** Per-contact reconnect gate key (32 bytes) — persisted by the engine for future reconnect DoS-pre-gating. */
  reconnectGateKey?: Uint8Array;
  /** Responder-only: a valid mac_R was verified on this reconnect Msg1. The engine reads this to set
   *  the contact's rgkPeerConfirmed flag (Task 3.1). Undefined/false otherwise. */
  peerMacRVerified?: boolean;
}

// ---- small framed I/O over a ChatStream (one Handshake frame at a time) ----
class HandshakeIO {
  private decoder = new FrameDecoder();
  private q: Uint8Array[] = [];
  private waiter: ((f: Uint8Array) => void) | null = null;
  private failure: Error | null = null;
  private rejectWaiter: ((e: Error) => void) | null = null;
  private detached = false;

  constructor(private stream: ChatStream) {
    stream.onData((chunk) => {
      // Once the handshake is done (detach()), this subscriber MUST go inert: the established
      // Connection owns the stream now, and a post-handshake Msg frame here would otherwise be
      // swallowed as "unexpected" (the transport fans every chunk to all subscribers, so the
      // Connection still gets its own copy — but a live HandshakeIO would keep failing + retaining).
      if (this.failure || this.detached) return;
      try {
        for (const f of this.decoder.push(chunk)) {
          if (f.type !== FrameType.Handshake) throw new HandshakeError(`unexpected frame ${f.type} during handshake`);
          if (this.waiter) { const w = this.waiter; this.waiter = null; this.rejectWaiter = null; w(f.payload); }
          else this.q.push(f.payload);
        }
      } catch (e) {
        this.fail(e as Error);
      }
    });
    stream.onClose(() => this.fail(new HandshakeError('stream closed during handshake')));
  }

  /** Stop processing once the handshake has produced a Session — the Connection takes over the stream.
   *  The protocol strictly alternates (no pipelining), so no session bytes are buffered here at this
   *  point; assert that invariant so a future change that breaks it is caught loudly. */
  detach(): void {
    this.detached = true;
    if (this.q.length > 0) throw new HandshakeError('handshake buffered unexpected post-handshake frames');
  }

  private fail(e: Error): void {
    this.failure = e;
    if (this.rejectWaiter) { const r = this.rejectWaiter; this.rejectWaiter = null; this.waiter = null; r(e); }
  }

  send(payload: Uint8Array): void {
    this.stream.send(encodeFrame(FrameType.Handshake, payload));
  }

  recv(): Promise<Uint8Array> {
    if (this.failure) return Promise.reject(this.failure);
    const next = this.q.shift();
    if (next) return Promise.resolve(next);
    return new Promise((resolve, reject) => { this.waiter = resolve; this.rejectWaiter = reject; });
  }
}

// ---- byte cursor for fixed-width parsing ----
class Cursor {
  off = 0;
  constructor(private buf: Uint8Array) {}
  take(n: number): Uint8Array {
    if (this.off + n > this.buf.length) throw new HandshakeError('handshake message truncated');
    const s = this.buf.slice(this.off, this.off + n);
    this.off += n;
    return s;
  }
  byte(): number {
    return this.take(1)[0];
  }
  rest(): Uint8Array {
    return this.take(this.buf.length - this.off);
  }
}

function mixKey(ck: Uint8Array, secret: Uint8Array, label: Uint8Array): Uint8Array {
  return hkdf(secret, ck, label, 32); // secret = IKM, ck = salt (crypto-audit H-1)
}
function h(...parts: Uint8Array[]): Uint8Array {
  return sha256(concatBytes(...parts));
}

async function initiatorHandshakeImpl(stream: ChatStream, opts: InitiatorOpts): Promise<HandshakeResult> {
  const { identity, responderPublic, prekey, mode } = opts;
  const firstContact = mode === 'first_contact';
  if (firstContact && (!opts.token || opts.token.length !== TOKEN_LEN)) {
    throw new HandshakeError('first_contact requires a 32-byte token');
  }
  if (!verifyKemPrekey(prekey, responderPublic.ed25519)) throw new HandshakeError('responder prekey signature invalid');

  const io = new HandshakeIO(stream);
  const xeI = x25519Keygen();
  const ekI = await mlkemKeygen();
  const enc = await mlkemEncapsulate(prekey.publicKey); // (ct_pre, ss_pre)
  const modeByte = Uint8Array.of(firstContact ? MODE_FIRST : MODE_RECONNECT);

  const th0 = h(PROTO_LABEL, SUITE_ID, modeByte);
  const th1 = h(
    th0, ROLE_I, ROLE_R, encodeIdentityPublic(responderPublic), prekey.prekeyId,
    Uint8Array.of(prekey.isLastResort ? 1 : 0), prekey.publicKey, prekey.signature, xeI.publicKey, ekI.publicKey, enc.cipherText
  );

  let ck = hkdf(PROTO_LABEL, th1, MIX_INIT, 32);
  const es = x25519Ecdh(xeI, responderPublic.x25519);
  ck = mixKey(ck, es, MIX_ES);
  ck = mixKey(ck, enc.sharedSecret, MIX_SSPRE);
  const hk1 = hkdf(ck, th1, DRV_HK1, 32);

  const sigI = ed25519Sign(concatBytes(DS_HS_INIT, th1), ed25519Pair(identity));
  const idPayload = concatBytes(identity.publicKeys.x25519, identity.publicKeys.ed25519, sigI);
  const aad = firstContact ? sha256(opts.token as Uint8Array) : new Uint8Array(0);
  const cIdI = aeadSeal(hk1, NONCE0, idPayload, aad);
  const macT = firstContact ? hmacSha256(sha256(opts.token as Uint8Array), concatBytes(DS_MAC_T, th1)) : new Uint8Array(0);

  // Reconnect gate slot (rev-4 §3): I ALWAYS sends mac_R whenever it holds an RGK for the contact.
  // mac_R is keyed over the Msg1 CLEARTEXT (NOT th1: th1 binds R's prekey block, which is consumed/gone
  // in the strand-recovery case — the gate must run before R touches the prekey). A 1-byte presence flag
  // lets an RGK-less initiator (the bootstrap fail-open case) send an empty slot unambiguously before cIdI.
  let macRSlot: Uint8Array = new Uint8Array(0);
  if (!firstContact) {
    const rgk = opts.reconnectGateKey;
    if (rgk) {
      const macRInput = concatBytes(DS_MAC_R, th0, prekey.prekeyId, xeI.publicKey, ekI.publicKey, enc.cipherText);
      macRSlot = concatBytes(Uint8Array.of(1), hmacSha256(rgk, macRInput));
    } else {
      macRSlot = Uint8Array.of(0);
    }
  }

  io.send(concatBytes(modeByte, xeI.publicKey, ekI.publicKey, prekey.prekeyId, enc.cipherText, macT, macRSlot, cIdI));
  const th2 = h(th1, cIdI);

  // ---- Msg2 ----
  const msg2 = new Cursor(await io.recv());
  const xeR = msg2.take(X25519_PUBLIC_LEN);
  const ctI = msg2.take(MLKEM_CT_LEN);
  const nextPrekeyBytes = msg2.take(KEM_PREKEY_LEN);
  const cConfR = msg2.rest();

  const ssI = await mlkemDecapsulate(ctI, ekI.secretKey);
  ck = mixKey(ck, x25519Ecdh(xeI, xeR), MIX_EE);
  ck = mixKey(ck, x25519Ecdh(x25519Pair(identity), xeR), MIX_SE);
  ck = mixKey(ck, ssI, MIX_SSI);
  const th3 = h(th2, xeR, ctI, nextPrekeyBytes);
  const hk2 = hkdf(ck, th3, DRV_HK2, 32);

  let confPt: Uint8Array;
  try {
    confPt = aeadOpen(hk2, NONCE0, cConfR, new Uint8Array(0));
  } catch {
    throw new HandshakeError('Msg2 confirmation failed to open');
  }
  const sigR = confPt.slice(0, ED25519_SIG_LEN);
  if (!ed25519Verify(sigR, concatBytes(DS_HS_RESP, th3), responderPublic.ed25519)) {
    throw new HandshakeError('responder signature invalid');
  }
  const nextPrekey = decodeKemPrekey(nextPrekeyBytes);
  if (!verifyKemPrekey(nextPrekey, responderPublic.ed25519)) throw new HandshakeError('rotation prekey signature invalid');

  const th4 = h(th3, cConfR);
  const rk = hkdf(ck, th4, DRV_ROOT, 32);
  const sid = hkdf(ck, th4, DRV_SID, 16);
  const session = new Session(sid, rk, 'initiator');

  const reconnectGateKey = hkdf(rk, sid, RECONNECT_GATE, 32);
  zeroize(xeI.secretKey, ekI.secretKey, es, enc.sharedSecret, ssI, ck, hk1, hk2, rk);
  io.detach(); // hand the stream to the Connection; stop this handshake reader (avoids dropping Msg1)
  return { session, peer: responderPublic, nextPrekey, mode, reconnectGateKey };
}

async function responderHandshakeImpl(stream: ChatStream, opts: ResponderOpts): Promise<HandshakeResult> {
  const { identity, invites, contacts } = opts;
  const io = new HandshakeIO(stream);

  // ---- Msg1 ----
  const msg1 = new Cursor(await io.recv());
  const modeByte = msg1.byte();
  if (modeByte !== MODE_FIRST && modeByte !== MODE_RECONNECT) throw new HandshakeError('bad mode');
  const firstContact = modeByte === MODE_FIRST;
  const xeI = msg1.take(X25519_PUBLIC_LEN);
  const ekIpub = msg1.take(MLKEM_PUBLIC_LEN);
  const prekeyId = msg1.take(PREKEY_ID_LEN);
  const ctPre = msg1.take(MLKEM_CT_LEN);
  const macT = firstContact ? msg1.take(MAC_LEN) : new Uint8Array(0);
  // Reconnect gate slot: 1-byte presence flag, then 32-byte mac_R when present (mirrors the initiator).
  let macR: Uint8Array = new Uint8Array(0);
  let macRPresent = false;
  if (!firstContact) {
    macRPresent = msg1.byte() === 1;
    if (macRPresent) macR = msg1.take(MAC_LEN);
  }
  const cIdI = msg1.rest();

  const th0 = h(PROTO_LABEL, SUITE_ID, Uint8Array.of(modeByte));

  // ---- Reconnect mac_R pre-gate + enforcement bootstrap (rev-4 §3) ----
  // Runs BEFORE lookup()/mlkemDecapsulate()/ECDH. mac_R is keyed over the Msg1 CLEARTEXT (NOT th1 —
  // th1 binds R's prekey block, consumed/gone in strand recovery; the gate must run before R touches
  // the prekey). R ENFORCES the gate only after it has already verified one valid mac_R from this
  // contact (rgkPeerConfirmed) → it never enforces against a peer it hasn't seen pass the gate (no
  // lockout). Until confirmed it fails open, but verifies a present mac_R cheaply so a valid one flips
  // the flag (peerMacRVerified). An attacker can't forge a valid mac_R (HMAC under the secret RGK).
  let peerMacRVerified = false;
  if (!firstContact) {
    const cid = await invites.identifyContact(prekeyId);
    const rgk = cid ? await contacts.getReconnectKey(cid) : null;
    const confirmed = cid ? await contacts.isRgkConfirmed(cid) : false;
    // Fail-CLOSED guard (defense-in-depth): a confirmed contact MUST have a usable RGK. If the store
    // ever returned confirmed=true with rgk=null (a future store-writer bug), the `if (rgk)` gate below
    // would silently FALL THROUGH to the ungated path and FAIL OPEN. Close the gate here instead.
    // Note: this close (and the confirmed-bad-mac close inside the gate) happens BEFORE lookup(), whereas
    // an unknown/consumed prekey closes AFTER lookup() — the two are timing-distinguishable. That is an
    // accepted property of a cheap DoS pre-gate, not a leak of the RGK or any per-attempt secret.
    if (confirmed && !rgk) throw new HandshakeError('reconnect gate failed (confirmed contact missing RGK)');
    if (rgk) {
      const macRInput = concatBytes(DS_MAC_R, th0, prekeyId, xeI, ekIpub, ctPre);
      const expect = hmacSha256(rgk, macRInput);
      const ok = macRPresent && constantTimeEqual(macR, expect);
      if (confirmed) {
        // Enforce: a confirmed peer MUST present a valid mac_R. Cheap close before any asymmetric op.
        if (!ok) throw new HandshakeError('reconnect gate failed (mac_R missing or invalid)');
        peerMacRVerified = true;
      } else if (ok) {
        // Bootstrap: not yet enforcing, but a valid mac_R is observed → signal it so the engine confirms.
        peerMacRVerified = true;
      }
    }
  }

  const rec = await invites.lookup(prekeyId);
  if (!rec) throw new HandshakeError('unknown or consumed prekey');
  const { prekey, secretKey, token } = rec;
  try {

  const th1 = h(
    th0, ROLE_I, ROLE_R, encodeIdentityPublic(identity.publicKeys), prekey.prekeyId,
    Uint8Array.of(prekey.isLastResort ? 1 : 0), prekey.publicKey, prekey.signature, xeI, ekIpub, ctPre
  );

  // Token pre-gate (first_contact) — one HMAC, BEFORE any asymmetric op.
  if (firstContact) {
    if (!token) throw new HandshakeError('no token bound to this prekey');
    const expect = hmacSha256(sha256(token), concatBytes(DS_MAC_T, th1));
    if (!constantTimeEqual(macT, expect)) throw new HandshakeError('token MAC mismatch');
  }

  let ck = hkdf(PROTO_LABEL, th1, MIX_INIT, 32);
  const ssPre = await mlkemDecapsulate(ctPre, secretKey);
  ck = mixKey(ck, x25519Ecdh(x25519Pair(identity), xeI), MIX_ES);
  ck = mixKey(ck, ssPre, MIX_SSPRE);
  const hk1 = hkdf(ck, th1, DRV_HK1, 32);

  const aad = firstContact ? sha256(token as Uint8Array) : new Uint8Array(0);
  let idPayload: Uint8Array;
  try {
    idPayload = aeadOpen(hk1, NONCE0, cIdI, aad);
  } catch {
    throw new HandshakeError('Msg1 identity payload failed to open (bad token or tamper)');
  }
  if (idPayload.length !== ID_PT_LEN) throw new HandshakeError('bad identity payload length');
  const xsI = idPayload.slice(0, X25519_PUBLIC_LEN);
  const isI = idPayload.slice(X25519_PUBLIC_LEN, X25519_PUBLIC_LEN + ED25519_PUBLIC_LEN);
  const sigI = idPayload.slice(X25519_PUBLIC_LEN + ED25519_PUBLIC_LEN);
  if (!ed25519Verify(sigI, concatBytes(DS_HS_INIT, th1), isI)) throw new HandshakeError('initiator signature invalid');
  const peer: IdentityPublic = { ed25519: isI, x25519: xsI };

  if (firstContact) {
    await contacts.pin(peer);
  } else {
    const pinned = await contacts.get(isI);
    if (!pinned || !constantTimeEqual(encodeIdentityPublic(pinned), encodeIdentityPublic(peer))) {
      throw new HandshakeError('peer identity does not match pinned contact (possible MITM)');
    }
  }
  await invites.consume(prekeyId); // durable; verify-before-encap satisfied below

  const th2 = h(th1, cIdI);

  // ---- Msg2 (only after all checks pass) ----
  const xeR = x25519Keygen();
  const encI = await mlkemEncapsulate(ekIpub); // (ct_I, ss_I)
  const nextPrekey = await invites.issueNext();
  const nextPrekeyBytes = encodeKemPrekey(nextPrekey);

  ck = mixKey(ck, x25519Ecdh(xeR, xeI), MIX_EE);
  ck = mixKey(ck, x25519Ecdh(xeR, xsI), MIX_SE);
  ck = mixKey(ck, encI.sharedSecret, MIX_SSI);
  const th3 = h(th2, xeR.publicKey, encI.cipherText, nextPrekeyBytes);
  const hk2 = hkdf(ck, th3, DRV_HK2, 32);
  const sigR = ed25519Sign(concatBytes(DS_HS_RESP, th3), ed25519Pair(identity));
  const cConfR = aeadSeal(hk2, NONCE0, sigR, new Uint8Array(0));

  io.send(concatBytes(xeR.publicKey, encI.cipherText, nextPrekeyBytes, cConfR));
  const th4 = h(th3, cConfR);
  const rk = hkdf(ck, th4, DRV_ROOT, 32);
  const sid = hkdf(ck, th4, DRV_SID, 16);
  const session = new Session(sid, rk, 'responder');

  const reconnectGateKey = hkdf(rk, sid, RECONNECT_GATE, 32);
  zeroize(xeR.secretKey, secretKey, ssPre, encI.sharedSecret, ck, hk1, hk2, rk);
  io.detach(); // hand the stream to the Connection; stop this handshake reader (avoids dropping Msg1)
  return { session, peer, mode: firstContact ? 'first_contact' : 'reconnect', reconnectGateKey, peerMacRVerified };
  } catch (e) {
    // Abort before durable consume() ⇒ release the one-time-prekey reservation so a failed/forged Msg1
    // can't strand it (consume() already cleared it on the success path, so this is then a no-op).
    await invites.release(prekeyId);
    throw e;
  }
}

const ROLE_I = new TextEncoder().encode('I');
const ROLE_R = new TextEncoder().encode('R');

/** Public entry points: on ANY failure, close the stream so the peer's pending recv rejects rather
 *  than hanging — fail-closed teardown of a broken handshake. */
export async function initiatorHandshake(stream: ChatStream, opts: InitiatorOpts): Promise<HandshakeResult> {
  try {
    return await initiatorHandshakeImpl(stream, opts);
  } catch (e) {
    try { stream.close(); } catch { /* already closed */ }
    throw e;
  }
}
export async function responderHandshake(stream: ChatStream, opts: ResponderOpts): Promise<HandshakeResult> {
  try {
    return await responderHandshakeImpl(stream, opts);
  } catch (e) {
    try { stream.close(); } catch { /* already closed */ }
    throw e;
  }
}
