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
  type IdentityKeyPair, type IdentityPublic, type KemPrekey, type KemPrekeyKeyPair
} from './identity';
import {
  PROTO_LABEL, SUITE_ID, DS_HS_INIT, DS_HS_RESP, DS_HS_REJECT, DS_MAC_T, DS_MAC_R,
  MIX_INIT, MIX_ES, MIX_SSPRE, MIX_EE, MIX_SE, MIX_SSI, DRV_HK1, DRV_HK2, DRV_ROOT, DRV_SID,
  RECONNECT_GATE, HS_MSG2, HS_REJECT,
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
  /** Offer a CURRENT signed prekey for in-band reconnect recovery (HIGH-1) WITHOUT consuming it. Used
   *  on the Reject path when a presented rotation prekey resolved to a cid but is already consumed
   *  (the strand). Re-offers the contact's still-live prekey (or mints one under a per-cid cap); the
   *  returned prekey is consumed only if/when I completes the retry handshake against it (Task 1.2-R). */
  offerCurrent(cid: string): Promise<KemPrekeyKeyPair>;
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
  /** Opt-in to recovering against a LAST-RESORT offered prekey on the in-band reconnect Reject path
   *  (Task 2.4, H-3). Default false/undefined = REFUSE: a Reject offering a last-resort prekey throws
   *  an opt-in-required HandshakeError rather than silently establishing a forward-secrecy-degraded
   *  session. This matches the spec (§2/H-3) and the proven ProVerif model, which only auto-retries on
   *  the is_last_resort=FALSE branch (chat-handshake-reconnect.pv). When true, I retries against the
   *  last-resort prekey as it does for a normal one (FS-degraded session, caller's explicit choice). */
  allowLastResortRecovery?: boolean;
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
  /** Initiator-only: this session was established via the in-band reconnect recovery path — R sent an
   *  authenticated Reject (the presented rotation prekey was already consumed) and I retried against
   *  the offered prekey (HIGH-1 self-heal, Task 2.4). Undefined/false on the normal path. */
  usedOfferedPrekey?: boolean;
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

/** A verified Reject the responder returned on a reconnect attempt (HIGH-1 recovery, Task 2.4): the
 *  presented prekey resolved to this contact but was already consumed, so R offered a current one. */
interface RejectOutcome {
  kind: 'reject';
  offered: KemPrekey;
}
type AttemptOutcome = HandshakeResult | RejectOutcome;

async function initiatorHandshakeImpl(stream: ChatStream, opts: InitiatorOpts): Promise<HandshakeResult> {
  const { identity, responderPublic, mode } = opts;
  const firstContact = mode === 'first_contact';
  if (firstContact && (!opts.token || opts.token.length !== TOKEN_LEN)) {
    throw new HandshakeError('first_contact requires a 32-byte token');
  }

  const io = new HandshakeIO(stream);
  const modeByte = Uint8Array.of(firstContact ? MODE_FIRST : MODE_RECONNECT);
  const th0 = h(PROTO_LABEL, SUITE_ID, modeByte);

  // One Msg1→reply round against a given prekey. Returns a completed HandshakeResult (HS_MSG2) or a
  // VERIFIED RejectOutcome (HS_REJECT). Fresh ephemerals each call so a retry never reuses xe_I/ek_I.
  // `usedOfferedPrekey` is threaded onto the result so the caller's retry session is tagged.
  const runAttempt = async (prekey: KemPrekey, usedOfferedPrekey: boolean): Promise<AttemptOutcome> => {
    if (!verifyKemPrekey(prekey, responderPublic.ed25519)) throw new HandshakeError('responder prekey signature invalid');

    const xeI = x25519Keygen();
    const ekI = await mlkemKeygen();
    const enc = await mlkemEncapsulate(prekey.publicKey); // (ct_pre, ss_pre)

    // Secret-hygiene (Task 2.4 review, I-1): from here on EVERY exit — return OR throw, on the Reject
    // branch, the Msg2 branch, or any reject-branch validation throw — must wipe this attempt's
    // ephemeral secrets. The try/finally below guarantees that; ssI/hk2/rk only exist on the Msg2
    // path, so they are declared here (undefined until assigned) and zeroized only when defined
    // (zeroize() calls Uint8Array.fill and would throw on undefined). Fresh ephemerals each call ⇒ a
    // retry never reuses these.
    let es: Uint8Array | undefined;
    let ck: Uint8Array | undefined;
    let hk1: Uint8Array | undefined;
    let ssI: Uint8Array | undefined;
    let hk2: Uint8Array | undefined;
    let rk: Uint8Array | undefined;
    try {
    const th1 = h(
      th0, ROLE_I, ROLE_R, encodeIdentityPublic(responderPublic), prekey.prekeyId,
      Uint8Array.of(prekey.isLastResort ? 1 : 0), prekey.publicKey, prekey.signature, xeI.publicKey, ekI.publicKey, enc.cipherText
    );

    ck = hkdf(PROTO_LABEL, th1, MIX_INIT, 32);
    es = x25519Ecdh(xeI, responderPublic.x25519);
    ck = mixKey(ck, es, MIX_ES);
    ck = mixKey(ck, enc.sharedSecret, MIX_SSPRE);
    hk1 = hkdf(ck, th1, DRV_HK1, 32);

    const sigI = ed25519Sign(concatBytes(DS_HS_INIT, th1), ed25519Pair(identity));
    const idPayload = concatBytes(identity.publicKeys.x25519, identity.publicKeys.ed25519, sigI);
    const aad = firstContact ? sha256(opts.token as Uint8Array) : new Uint8Array(0);
    const cIdI = aeadSeal(hk1, NONCE0, idPayload, aad);
    const macT = firstContact ? hmacSha256(sha256(opts.token as Uint8Array), concatBytes(DS_MAC_T, th1)) : new Uint8Array(0);

    // TH_R0 = H(MIX_INIT ‖ TH0 ‖ prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre) — the Msg1 CLEARTEXT transcript,
    // used below to reconstruct/verify Sig_R_reject on a Reject (F-5: TH_R0, NOT TH1 — TH1 binds R's
    // prekey block, gone in the strand case). NB: this is distinct from the mac_R input layout (Task
    // 2.2), which flattens the same fields directly under DS_MAC_R; only the Reject signature folds them
    // through TH_R0 (matching the proven model's thR0).
    const thR0 = h(MIX_INIT, th0, prekey.prekeyId, xeI.publicKey, ekI.publicKey, enc.cipherText);
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

    // ---- Responder reply (Msg2 or Reject) ----
    const reply = new Cursor(await io.recv());
    // Typed responder reply (rev-4 Task 2.3): read the hs_type discriminant first and branch. The same
    // byte is folded into th3 below so Sig_R covers it — a flipped type breaks the signature check.
    const hsType = reply.byte();
    if (hsType === HS_REJECT) {
      // ---- Reject recovery (Task 2.4): verify Sig_R_reject over TH_R0, then return the offered prekey
      // for the caller to retry against. Reject never reaches a session on this attempt. ----
      if (firstContact) throw new HandshakeError('unexpected reject on first_contact');
      const offeredBytes = reply.take(KEM_PREKEY_LEN);
      const isLastByte = reply.byte();
      const sigReject = reply.rest();
      if (sigReject.length !== ED25519_SIG_LEN) throw new HandshakeError('reject signature malformed');
      if (isLastByte !== 0 && isLastByte !== 1) throw new HandshakeError('reject is_last_resort flag invalid');
      // Sig_R_reject = Sign(is_R, DS_HS_REJECT ‖ TH_R0 ‖ offered_prekey ‖ is_last_resort), TH_R0 from
      // THIS attempt's Msg1 cleartext (replaying a Reject onto a different Msg1 ⇒ TH_R0 mismatch ⇒ fail).
      if (!ed25519Verify(sigReject, concatBytes(DS_HS_REJECT, thR0, offeredBytes, Uint8Array.of(isLastByte)), responderPublic.ed25519)) {
        throw new HandshakeError('reject signature invalid');
      }
      const offered = decodeKemPrekey(offeredBytes);
      // Defensive: the signed flag must agree with the offered prekey's own flag, and the offered
      // prekey must itself be signed by R (verify-before-use).
      if ((offered.isLastResort ? 1 : 0) !== isLastByte) throw new HandshakeError('reject is_last_resort flag mismatch');
      if (!verifyKemPrekey(offered, responderPublic.ed25519)) throw new HandshakeError('offered prekey signature invalid');
      // Last-resort recovery gate (Task 2.4 review, H-3): a last-resort prekey is forward-secrecy-
      // degraded (it is not one-time — it can be reused across handshakes). The spec (§2/H-3) and the
      // proven ProVerif model both REFUSE to auto-continue on a last-resort offer: the model only
      // retries on the is_last_resort=FALSE branch. Default refuse; require explicit opt-in. The engine
      // (Task 3.x) catches this and can surface H-3 / offer the opt-in before re-dialing.
      if (isLastByte === 1 && !opts.allowLastResortRecovery) {
        throw new HandshakeError('reconnect offered a last-resort (forward-secrecy-degraded) prekey — opt-in required; request a fresh invite');
      }
      return { kind: 'reject', offered };
    }
    if (hsType !== HS_MSG2) {
      throw new HandshakeError('unknown hs_type in responder reply');
    }

    // ---- Msg2 ----
    const xeR = reply.take(X25519_PUBLIC_LEN);
    const ctI = reply.take(MLKEM_CT_LEN);
    const nextPrekeyBytes = reply.take(KEM_PREKEY_LEN);
    const cConfR = reply.rest();

    ssI = await mlkemDecapsulate(ctI, ekI.secretKey);
    ck = mixKey(ck, x25519Ecdh(xeI, xeR), MIX_EE);
    ck = mixKey(ck, x25519Ecdh(x25519Pair(identity), xeR), MIX_SE);
    ck = mixKey(ck, ssI, MIX_SSI);
    const th3 = h(th2, Uint8Array.of(hsType), xeR, ctI, nextPrekeyBytes);
    hk2 = hkdf(ck, th3, DRV_HK2, 32);

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
    rk = hkdf(ck, th4, DRV_ROOT, 32);
    const sid = hkdf(ck, th4, DRV_SID, 16);
    const session = new Session(sid, rk, 'initiator');

    const reconnectGateKey = hkdf(rk, sid, RECONNECT_GATE, 32);
    return { session, peer: responderPublic, nextPrekey, mode, reconnectGateKey, usedOfferedPrekey };
    } finally {
      // I-1: wipe THIS attempt's ephemeral secrets on EVERY exit (return or throw, from any branch —
      // Reject, Msg2, or any validation throw in between). es/ck/hk1 are always set by the time any
      // throw past key-gen can occur; ssI/hk2/rk only on the Msg2 path. Guard each (zeroize() →
      // Uint8Array.fill, which throws on undefined). xeI/ekI/enc are created before the try.
      zeroize(xeI.secretKey, ekI.secretKey, enc.sharedSecret);
      if (es) zeroize(es);
      if (ck) zeroize(ck);
      if (hk1) zeroize(hk1);
      if (ssI) zeroize(ssI);
      if (hk2) zeroize(hk2);
      if (rk) zeroize(rk);
    }
  };

  // First attempt against the presented prekey. On HS_REJECT, retry ONCE against the offered prekey
  // (one-retry-per-dial cap): a SECOND Reject (the retry also rejected) is a hard fail — no infinite
  // loop, no further attempts on this dial. (Reject on first_contact is impossible — handled above.)
  let outcome = await runAttempt(opts.prekey, false);
  if ('kind' in outcome) {
    const retry = await runAttempt(outcome.offered, true);
    if ('kind' in retry) {
      throw new HandshakeError('reconnect failed — request a fresh invite');
    }
    outcome = retry;
  }

  io.detach(); // hand the stream to the Connection; stop this handshake reader (avoids dropping Msg1)
  return outcome;
}

async function responderHandshakeImpl(stream: ChatStream, opts: ResponderOpts): Promise<HandshakeResult> {
  const { identity, invites, contacts } = opts;
  const io = new HandshakeIO(stream);

  // R answers each Msg1 it receives on this dial. Normally one round (accept → Msg2). On the HIGH-1
  // recovery path R answers an unresolvable-but-known prekey with a Reject (offering a current prekey)
  // and LOOPS to await the initiator's retry Msg1 (the SAME dial owns the stream). The one-retry-per-
  // dial cap lives on the INITIATOR (it sends at most one retry, then closes).
  //
  // I-2 (Task 2.4 review): R MUST also bound its OWN per-dial Reject signing. For an UNCONFIRMED
  // contact the mac_R pre-gate fails open by design, so it does not cut off pre-sign; an attacker who
  // knows a consumed-but-indexed prekeyId could otherwise drive unbounded Reject iterations, each
  // producing a fresh ed25519 Sig_R_reject (TH_R0 changes with the attacker's fresh ephemerals every
  // iteration, so offerCurrent's per-cid MINT cap does not bound the SIGNING). Cap rejects per dial at
  // a small constant: the legitimate flow sends exactly ONE reject per dial, so 2 leaves a safe margin.
  // NOTE: this counter bounds a SINGLE dial's loop only. GLOBAL bounding of ungated reconnect attempts
  // across many dials is Task 2.5's rate-limiter.
  const MAX_REJECTS_PER_DIAL = 2;
  let rejectCount = 0;
  for (;;) {
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
  let cid: string | null = null;
  if (!firstContact) {
    cid = await invites.identifyContact(prekeyId);
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
  if (!rec) {
    // HIGH-1 in-band recovery (Task 2.4): on a RECONNECT where the presented prekey is gone (consumed/
    // stale) but it still resolves to a known contact (cid), R has not lost the relationship — the
    // initiator just raced R's durable consume (the strand). Instead of closing (permanent
    // unreachability without a fresh out-of-band invite), send an AUTHENTICATED Reject offering a
    // current prekey, bound to THIS Msg1 via TH_R0, and abort WITHOUT consuming anything. The gate
    // (mac_R) has already been satisfied above. first_contact / unknown-cid still hard-fail.
    if (!firstContact && cid) {
      // I-2: bound per-dial Reject signing BEFORE minting/signing. The mac_R gate above fails open for
      // an unconfirmed contact, so without this an attacker driving repeated stale Msg1s on one dial
      // would extract unbounded ed25519 signatures (asymmetric work). The legitimate self-heal sends
      // exactly one reject per dial; exceeding the cap is abuse → close the stream.
      if (++rejectCount > MAX_REJECTS_PER_DIAL) {
        throw new HandshakeError('reconnect: too many recovery rejects on one dial');
      }
      const offeredKp = await invites.offerCurrent(cid);
      const offered = offeredKp.prekey;
      // TH_R0 = H(MIX_INIT ‖ TH0 ‖ prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre) — the Msg1 CLEARTEXT transcript
      // (F-5: NOT TH1, which binds R's now-consumed prekey block). Same th0 the mac_R gate used.
      const thR0 = h(MIX_INIT, th0, prekeyId, xeI, ekIpub, ctPre);
      const offeredBytes = encodeKemPrekey(offered);
      const isLastByte = Uint8Array.of(offered.isLastResort ? 1 : 0);
      // Sig_R_reject = Sign(is_R, DS_HS_REJECT ‖ TH_R0 ‖ offered_prekey ‖ is_last_resort). DS_HS_REJECT
      // is DISTINCT from DS_HS_RESP (accept) so an accept Sig_R can never be lifted onto a reject frame.
      const sigReject = ed25519Sign(concatBytes(DS_HS_REJECT, thR0, offeredBytes, isLastByte), ed25519Pair(identity));
      io.send(concatBytes(Uint8Array.of(HS_REJECT), offeredBytes, isLastByte, sigReject));
      // Reject consumes NOTHING: offerCurrent neither consumes nor reserves; the offered prekey is
      // consumed only if/when I completes the retry handshake against it. Loop to await I's retry Msg1
      // (against the offered prekey, which now resolves → accept). If I gives up (one-retry cap) it
      // closes the stream → the next io.recv() rejects and the dial ends.
      continue;
    }
    throw new HandshakeError('unknown or consumed prekey');
  }
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
  // Typed responder reply (rev-4 Task 2.3): a 1-byte hs_type discriminant lets R answer a reconnect
  // Msg1 with either an accept (HS_MSG2) or a recovery Reject (HS_REJECT, Task 2.4). Fold the SAME byte
  // into th3 BEFORE Sig_R so the type can't be flipped on the wire (Sig_R covers DS_HS_RESP‖th3).
  const hsType = Uint8Array.of(HS_MSG2);
  const th3 = h(th2, hsType, xeR.publicKey, encI.cipherText, nextPrekeyBytes);
  const hk2 = hkdf(ck, th3, DRV_HK2, 32);
  const sigR = ed25519Sign(concatBytes(DS_HS_RESP, th3), ed25519Pair(identity));
  const cConfR = aeadSeal(hk2, NONCE0, sigR, new Uint8Array(0));

  io.send(concatBytes(hsType, xeR.publicKey, encI.cipherText, nextPrekeyBytes, cConfR));
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
  } // end per-Msg1 loop (only re-entered via `continue` on the recovery-Reject path)
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
