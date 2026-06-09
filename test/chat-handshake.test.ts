import { describe, it, expect } from 'vitest';
import {
  initiatorHandshake,
  responderHandshake,
  HandshakeError,
  type ResponderInviteStore,
  type ContactPinStore,
  type HandshakeResult
} from '../src/main/chat/handshake';
import { createPipe } from '../src/main/chat/transport';
import {
  generateIdentity,
  generateKemPrekey,
  contactId,
  type IdentityKeyPair,
  type IdentityPublic,
  type KemPrekey
} from '../src/main/chat/identity';
import { encodeEnvelope, decodeEnvelope } from '../src/main/chat/session';
import { randomBytes, sha256, ed25519Sign, MLKEM_CT_LEN, X25519_PUBLIC_LEN, MLKEM_PUBLIC_LEN } from '../src/main/chat/crypto';
import { ed25519Pair, encodeKemPrekey } from '../src/main/chat/identity';
import { HEADER_LEN } from '../src/main/chat/wire';
import { MIX_INIT, PROTO_LABEL, SUITE_ID, DS_HS_REJECT, HS_REJECT, concatBytes } from '../src/main/chat/constants';
import type { ChatStream } from '../src/main/chat/transport';

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

/** In-memory responder invite store: prekeyId → {prekey, secret, token}. */
function makeInviteStore(responder: IdentityKeyPair): ResponderInviteStore & {
  issueFirstContact(): Promise<{ prekey: KemPrekey; token: Uint8Array }>;
  bindContact(prekeyId: Uint8Array, cid: string): void;
} {
  const map = new Map<string, { prekey: KemPrekey; secretKey: Uint8Array; token: Uint8Array | null }>();
  const pidToCid = new Map<string, string>();
  return {
    async issueFirstContact() {
      const { prekey, secretKey } = await generateKemPrekey(responder);
      const token = randomBytes(32);
      map.set(hex(prekey.prekeyId), { prekey, secretKey, token });
      return { prekey, token };
    },
    bindContact(prekeyId, cid) {
      pidToCid.set(hex(prekeyId), cid);
    },
    async lookup(prekeyId) {
      return map.get(hex(prekeyId)) ?? null;
    },
    async consume(prekeyId) {
      map.delete(hex(prekeyId)); // one-time
    },
    async release() { /* no reservation tracking in this in-memory test store */ },
    async issueNext() {
      const { prekey, secretKey } = await generateKemPrekey(responder);
      map.set(hex(prekey.prekeyId), { prekey, secretKey, token: null });
      return prekey;
    },
    async identifyContact(prekeyId) {
      return pidToCid.get(hex(prekeyId)) ?? null;
    },
    async offerCurrent(cid) {
      // Re-offer the contact's current still-live prekey (no consume); else mint one and index it.
      for (const [pid, c] of pidToCid) {
        if (c !== cid) continue;
        const rec = map.get(pid);
        if (rec) return { prekey: rec.prekey, secretKey: rec.secretKey };
      }
      const { prekey, secretKey } = await generateKemPrekey(responder);
      map.set(hex(prekey.prekeyId), { prekey, secretKey, token: null });
      pidToCid.set(hex(prekey.prekeyId), cid);
      return { prekey, secretKey };
    }
  };
}

function makePinStore(): ContactPinStore & {
  setReconnectKey(cid: string, rgk: Uint8Array): void;
  setRgkConfirmed(cid: string, v: boolean): void;
} {
  const map = new Map<string, IdentityPublic>();
  const rgks = new Map<string, Uint8Array>();
  const confirmed = new Map<string, boolean>();
  return {
    async get(ed) {
      return map.get(hex(ed)) ?? null;
    },
    async pin(peer) {
      map.set(hex(peer.ed25519), peer);
    },
    async getReconnectKey(cid) {
      return rgks.get(cid) ?? null;
    },
    async isRgkConfirmed(cid) {
      return confirmed.get(cid) ?? false;
    },
    setReconnectKey(cid, rgk) {
      rgks.set(cid, rgk);
    },
    setRgkConfirmed(cid, v) {
      confirmed.set(cid, v);
    }
  };
}

async function bothExchange(iSession: { encrypt: (e: Uint8Array) => Uint8Array }, rSession: { decrypt: (s: Uint8Array) => Uint8Array }, text: string): Promise<string> {
  const content = decodeEnvelope(rSession.decrypt(iSession.encrypt(encodeEnvelope({ type: 'text', text }))));
  if (content.type !== 'text') throw new Error('expected text content');
  return content.text;
}

describe('chat handshake (v3, EXPERIMENTAL) — first contact', () => {
  it('both sides derive matching sessions, authenticate each other, and exchange messages', async () => {
    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const invites = makeInviteStore(responderId);
    const contacts = makePinStore();
    const { prekey, token } = await invites.issueFirstContact();

    const [sa, sb] = createPipe();
    const [rRes, iRes] = await Promise.all([
      responderHandshake(sb, { identity: responderId, invites, contacts }),
      initiatorHandshake(sa, {
        identity: initiatorId,
        responderPublic: responderId.publicKeys,
        prekey,
        token,
        mode: 'first_contact'
      })
    ]);

    // mutual authentication: each learned the other's real identity
    expect(contactId(rRes.peer)).toBe(contactId(initiatorId.publicKeys));
    expect(contactId(iRes.peer)).toBe(contactId(responderId.publicKeys));

    // matching sessions ⇒ the key schedule agreed end-to-end
    expect(await bothExchange(iRes.session, rRes.session, 'hello from I')).toBe('hello from I');
    expect(await bothExchange(rRes.session, iRes.session, 'hello from R')).toBe('hello from R');

    // responder pinned the initiator; initiator got a rotation prekey
    expect(await contacts.get(initiatorId.publicKeys.ed25519)).not.toBeNull();
    expect(iRes.nextPrekey).toBeDefined();
  });

  it('rejects a wrong token (mac_T pre-gate fails)', async () => {
    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const invites = makeInviteStore(responderId);
    const contacts = makePinStore();
    const { prekey } = await invites.issueFirstContact();

    const [sa, sb] = createPipe();
    const results = await Promise.allSettled([
      responderHandshake(sb, { identity: responderId, invites, contacts }),
      initiatorHandshake(sa, {
        identity: initiatorId,
        responderPublic: responderId.publicKeys,
        prekey,
        token: randomBytes(32), // WRONG token
        mode: 'first_contact'
      })
    ]);
    expect(results[0].status).toBe('rejected'); // responder rejects at the mac_T gate
  });

  it('rejects an unknown / consumed prekey', async () => {
    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const invites = makeInviteStore(responderId);
    const contacts = makePinStore();
    // a prekey signed by the responder but never registered in the store
    const { prekey } = await generateKemPrekey(responderId);

    const [sa, sb] = createPipe();
    const results = await Promise.allSettled([
      responderHandshake(sb, { identity: responderId, invites, contacts }),
      initiatorHandshake(sa, {
        identity: initiatorId,
        responderPublic: responderId.publicKeys,
        prekey,
        token: randomBytes(32),
        mode: 'first_contact'
      })
    ]);
    expect(results[0].status).toBe('rejected');
  });
});

describe('chat handshake (v3) — reconnect', () => {
  it('reconnects against a pinned contact using the rotation prekey', async () => {
    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const invites = makeInviteStore(responderId);
    const contacts = makePinStore();
    const { prekey, token } = await invites.issueFirstContact();

    // first contact establishes the pin + hands a rotation prekey
    const [fa, fb] = createPipe();
    const [, iFirst] = await Promise.all([
      responderHandshake(fb, { identity: responderId, invites, contacts }),
      initiatorHandshake(fa, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey, token, mode: 'first_contact' })
    ]);
    const rotation = iFirst.nextPrekey as KemPrekey;

    // reconnect: no token, mode reconnect, using the rotation prekey
    const [ra, rb] = createPipe();
    const [rRes, iRes] = await Promise.all([
      responderHandshake(rb, { identity: responderId, invites, contacts }),
      initiatorHandshake(ra, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey: rotation, mode: 'reconnect' })
    ]);
    expect(contactId(rRes.peer)).toBe(contactId(initiatorId.publicKeys));
    expect(await bothExchange(iRes.session, rRes.session, 'reconnected')).toBe('reconnected');
  });

  /** Wrap a ChatStream so its FIRST non-empty outbound frame has its payload byte 0 transformed by
   *  `mut`. The responder sends exactly one handshake frame (the Msg2/Reject reply), so this lands on
   *  the hs_type discriminant — letting a test flip it to an unknown value before the initiator parses. */
  function tamperFirstReplyByte(inner: ChatStream, mut: (b: number) => number): ChatStream {
    let done = false;
    return {
      send(data: Uint8Array): void {
        if (!done && data.length > HEADER_LEN) {
          done = true;
          const copy = data.slice();
          copy[HEADER_LEN] = mut(copy[HEADER_LEN]) & 0xff;
          inner.send(copy);
          return;
        }
        inner.send(data);
      },
      onData(cb) { inner.onData(cb); },
      onClose(cb) { inner.onClose(cb); },
      close() { inner.close(); },
      get closed() { return inner.closed; }
    };
  }

  /** Run first_contact then a reconnect, tampering the responder reply's hs_type byte via `mut`.
   *  Returns the initiator's settled promise so the test can assert it rejects. */
  async function runReconnectWithTamperedReply(mut: (b: number) => number): Promise<unknown> {
    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const invites = makeInviteStore(responderId);
    const contacts = makePinStore();
    const { prekey, token } = await invites.issueFirstContact();

    const [fa, fb] = createPipe();
    const [, iFirst] = await Promise.all([
      responderHandshake(fb, { identity: responderId, invites, contacts }),
      initiatorHandshake(fa, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey, token, mode: 'first_contact' })
    ]);
    const rotation = iFirst.nextPrekey as KemPrekey;

    const [ra, rb] = createPipe();
    const tamperedRb = tamperFirstReplyByte(rb, mut);
    const [, iRes] = await Promise.allSettled([
      responderHandshake(tamperedRb, { identity: responderId, invites, contacts }),
      initiatorHandshake(ra, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey: rotation, mode: 'reconnect' })
    ]);
    if (iRes.status === 'rejected') throw iRes.reason;
    return iRes.value;
  }

  it('initiator rejects an unknown hs_type in the responder reply', async () => {
    await expect(runReconnectWithTamperedReply(() => 0x7f))
      .rejects.toThrow(/hs_type|unexpected reply/i);
  });

  it('rejects reconnect when the peer identity is not pinned', async () => {
    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const invites = makeInviteStore(responderId);
    const contacts = makePinStore(); // empty — initiator never pinned
    const rotation = (await invites.issueNext()) as KemPrekey;

    const [ra, rb] = createPipe();
    const results = await Promise.allSettled([
      responderHandshake(rb, { identity: responderId, invites, contacts }),
      initiatorHandshake(ra, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey: rotation, mode: 'reconnect' })
    ]);
    expect(results[0].status).toBe('rejected'); // not pinned → MITM hard-fail
  });
});

describe('chat handshake — reconnect gate key (RGK)', () => {
  it('both sides derive a 32-byte reconnectGateKey that is byte-equal', async () => {
    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const invites = makeInviteStore(responderId);
    const contacts = makePinStore();
    const { prekey, token } = await invites.issueFirstContact();

    const [sa, sb] = createPipe();
    const [rRes, iRes] = await Promise.all([
      responderHandshake(sb, { identity: responderId, invites, contacts }),
      initiatorHandshake(sa, {
        identity: initiatorId,
        responderPublic: responderId.publicKeys,
        prekey,
        token,
        mode: 'first_contact'
      })
    ]);

    // Both results must carry a 32-byte reconnectGateKey
    expect(iRes.reconnectGateKey).toBeDefined();
    expect(rRes.reconnectGateKey).toBeDefined();
    expect(iRes.reconnectGateKey!.length).toBe(32);
    expect(rRes.reconnectGateKey!.length).toBe(32);

    // The two sides must agree on the RGK (same rk + sid inputs)
    expect(hex(iRes.reconnectGateKey!)).toBe(hex(rRes.reconnectGateKey!));
  });
});

describe('chat handshake — mac_R gate + enforcement bootstrap (rev-4 §3)', () => {
  /**
   * Drive a full first_contact (to establish the pin + rotation prekey + RGK), then a reconnect with
   * the mac_R gate active. The knobs express the four bootstrap behaviors:
   *  - correctRGK: I holds the matching RGK (default true)
   *  - initiatorHasRGK: I holds any RGK at all (if false, I sends no mac_R — keyless reconnect)
   *  - forgedMacR: I holds a WRONG (attacker) RGK so its mac_R fails verify on R
   *  - rStartsConfirmed: whether R already has rgkPeerConfirmed set for this contact
   *  - rHasRGK: whether R's store returns an RGK for the (resolved) cid (default true). When false,
   *    the cid still resolves but getReconnectKey returns null → R runs ungated.
   */
  async function runReconnect(opts: {
    correctRGK?: boolean;
    initiatorHasRGK?: boolean;
    forgedMacR?: boolean;
    rStartsConfirmed: boolean;
    rHasRGK?: boolean;
  }): Promise<{ rRes: import('../src/main/chat/handshake').HandshakeResult; iRes: import('../src/main/chat/handshake').HandshakeResult; rConfirmedAfter: boolean }> {
    const initiatorHasRGK = opts.initiatorHasRGK ?? true;
    const correctRGK = opts.correctRGK ?? true;
    const forgedMacR = opts.forgedMacR ?? false;
    const rHasRGK = opts.rHasRGK ?? true;

    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const invites = makeInviteStore(responderId);
    const contacts = makePinStore();
    const { prekey, token } = await invites.issueFirstContact();

    // first contact — establishes pin + rotation prekey + a shared RGK on both sides
    const [fa, fb] = createPipe();
    const [rFirst, iFirst] = await Promise.all([
      responderHandshake(fb, { identity: responderId, invites, contacts }),
      initiatorHandshake(fa, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey, token, mode: 'first_contact' })
    ]);
    const rotation = iFirst.nextPrekey as KemPrekey;
    const cid = contactId(initiatorId.publicKeys);
    invites.bindContact(rotation.prekeyId, cid);

    // Seed R's view: it holds the real RGK for this contact (unless rHasRGK is false), confirmed per the knob.
    const realRGK = rFirst.reconnectGateKey as Uint8Array;
    if (rHasRGK) contacts.setReconnectKey(cid, realRGK);
    contacts.setRgkConfirmed(cid, opts.rStartsConfirmed);

    // I's view: the RGK it presents on reconnect (correct, forged, or none).
    let initiatorRGK: Uint8Array | undefined;
    if (initiatorHasRGK) {
      initiatorRGK = forgedMacR || !correctRGK ? randomBytes(32) : (iFirst.reconnectGateKey as Uint8Array);
    }

    const [ra, rb] = createPipe();
    const [rRes, iRes] = await Promise.all([
      responderHandshake(rb, { identity: responderId, invites, contacts }),
      initiatorHandshake(ra, {
        identity: initiatorId,
        responderPublic: responderId.publicKeys,
        prekey: rotation,
        mode: 'reconnect',
        reconnectGateKey: initiatorRGK
      })
    ]);
    return { rRes, iRes, rConfirmedAfter: !!rRes.peerMacRVerified };
  }

  it('I sends mac_R whenever it holds RGK; an unconfirmed R accepts it ungated and confirms', async () => {
    const { rConfirmedAfter } = await runReconnect({ correctRGK: true, rStartsConfirmed: false });
    expect(rConfirmedAfter).toBe(true); // R signalled the valid mac_R so the engine sets rgkPeerConfirmed
  });

  it('a CONFIRMED R rejects a wrong/missing mac_R at the pre-gate (before asymmetric work)', async () => {
    await expect(runReconnect({ correctRGK: false, rStartsConfirmed: true }))
      .rejects.toThrow(/mac_R|reconnect gate/i);
  });

  it('an UNCONFIRMED R does NOT require mac_R (fail open): a keyless I still completes ungated', async () => {
    const { iRes } = await runReconnect({ initiatorHasRGK: false, rStartsConfirmed: false });
    expect(iRes.session).toBeTruthy(); // no lockout — the rev-4 bootstrap safety property
  });

  it('an attacker cannot flip rgkPeerConfirmed with a forged mac_R', async () => {
    const { rConfirmedAfter } = await runReconnect({ forgedMacR: true, rStartsConfirmed: false });
    expect(rConfirmedAfter).toBe(false); // forged mac_R fails verify → flag stays false
  });

  it('gated happy path: a CONFIRMED R + valid mac_R passes the gate AND the handshake COMPLETES', async () => {
    const { rRes, iRes, rConfirmedAfter } = await runReconnect({ correctRGK: true, rStartsConfirmed: true });
    expect(rConfirmedAfter).toBe(true); // gate enforced and passed
    // a REAL session on both sides — not just the flag: exchange messages both directions
    expect(iRes.session).toBeTruthy();
    expect(rRes.session).toBeTruthy();
    expect(await bothExchange(iRes.session, rRes.session, 'reconnect hello I')).toBe('reconnect hello I');
    expect(await bothExchange(rRes.session, iRes.session, 'reconnect hello R')).toBe('reconnect hello R');
  });

  it('cid resolves but getReconnectKey returns null → ungated (no enforce), handshake COMPLETES', async () => {
    // rStartsConfirmed:true would normally enforce, but with no RGK the fail-closed guard would fire —
    // so this case (cid resolves, store has no RGK) must be UNCONFIRMED to take the ungated path.
    const { iRes, rRes } = await runReconnect({ rHasRGK: false, rStartsConfirmed: false });
    expect(iRes.session).toBeTruthy();
    expect(rRes.session).toBeTruthy();
    expect(await bothExchange(iRes.session, rRes.session, 'ungated hello')).toBe('ungated hello');
  });
});

describe('chat handshake — in-band reconnect recovery (Reject→retry, HIGH-1 / F-5)', () => {
  /**
   * Set up a pinned contact + a rotation prekey + a shared RGK, then DURABLY CONSUME the rotation
   * prekey in R's store before the reconnect (the HIGH-1 strand: R consumed the one-time prekey after
   * a dropped stream, before I persisted the next rotation). On the reconnect, R's lookup() returns
   * null while identifyContact() still resolves the cid → R must take the Reject recovery path.
   *
   * `wrapResponderStream` lets a test tamper/capture/replay the Reject frame.
   * `responderLookupAlwaysNull` forces R to reject on EVERY attempt (drives the double-reject cap).
   */
  async function setupConsumedReconnect(): Promise<{
    initiatorId: IdentityKeyPair;
    responderId: IdentityKeyPair;
    invites: ReturnType<typeof makeInviteStore>;
    contacts: ReturnType<typeof makePinStore>;
    rotation: KemPrekey;
    initiatorRGK: Uint8Array;
    cid: string;
  }> {
    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const invites = makeInviteStore(responderId);
    const contacts = makePinStore();
    const { prekey, token } = await invites.issueFirstContact();

    const [fa, fb] = createPipe();
    const [rFirst, iFirst] = await Promise.all([
      responderHandshake(fb, { identity: responderId, invites, contacts }),
      initiatorHandshake(fa, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey, token, mode: 'first_contact' })
    ]);
    const rotation = iFirst.nextPrekey as KemPrekey;
    const cid = contactId(initiatorId.publicKeys);
    invites.bindContact(rotation.prekeyId, cid);
    contacts.setReconnectKey(cid, rFirst.reconnectGateKey as Uint8Array);
    contacts.setRgkConfirmed(cid, true);
    return { initiatorId, responderId, invites, contacts, rotation, initiatorRGK: iFirst.reconnectGateKey as Uint8Array, cid };
  }

  /** Wrap R's stream with an outbound-frame transform applied to each handshake payload (post HEADER). */
  function wrapResponderStream(inner: ChatStream, onSend: (payload: Uint8Array) => Uint8Array | null): ChatStream {
    return {
      send(data: Uint8Array): void {
        if (data.length > HEADER_LEN) {
          const header = data.slice(0, HEADER_LEN);
          const payload = data.slice(HEADER_LEN);
          const out = onSend(payload);
          if (out === null) return; // swallow this frame
          inner.send(concatBytes(header, out));
          return;
        }
        inner.send(data);
      },
      onData(cb) { inner.onData(cb); },
      onClose(cb) { inner.onClose(cb); },
      close() { inner.close(); },
      get closed() { return inner.closed; }
    };
  }

  async function runReconnectWithConsumedPrekey(): Promise<{ iRes: HandshakeResult; rRes: HandshakeResult }> {
    const { initiatorId, responderId, invites, contacts, rotation, initiatorRGK } = await setupConsumedReconnect();
    // The strand: R durably consumed the rotation prekey before I retried.
    await invites.consume(rotation.prekeyId);

    const [ra, rb] = createPipe();
    const [rRes, iRes] = await Promise.all([
      responderHandshake(rb, { identity: responderId, invites, contacts }),
      initiatorHandshake(ra, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey: rotation, mode: 'reconnect', reconnectGateKey: initiatorRGK })
    ]);
    return { iRes, rRes };
  }

  it('reconnect self-heals when the rotation prekey was already consumed (Reject→retry)', async () => {
    const { iRes, rRes } = await runReconnectWithConsumedPrekey();
    expect(iRes.session).toBeTruthy();
    expect(iRes.usedOfferedPrekey).toBe(true);
    // a REAL completed session against the offered prekey, both directions
    expect(await bothExchange(iRes.session, rRes.session, 'healed I')).toBe('healed I');
    expect(await bothExchange(rRes.session, iRes.session, 'healed R')).toBe('healed R');
  });

  /**
   * Drive the LAST-RESORT recovery gate (Task 2.4 review, H-3). The strand is the same as the normal
   * recovery test, except R's offerCurrent is stubbed to return a LAST-RESORT prekey (FS-degraded:
   * reusable, not one-time). Spec §2/H-3 + the proven ProVerif model REFUSE to auto-continue on such an
   * offer; recovery requires an explicit allowLastResortRecovery opt-in on the initiator.
   */
  async function runReconnectLastResortReject(allowLastResortRecovery: boolean): Promise<{ iRes: HandshakeResult; rRes: HandshakeResult }> {
    const { initiatorId, responderId, invites, contacts, rotation, initiatorRGK, cid } = await setupConsumedReconnect();
    await invites.consume(rotation.prekeyId);
    // Mint a signed LAST-RESORT prekey, index it to the contact, and force offerCurrent to return it so
    // R answers the strand with a last-resort offer (and accepts the retry against it when opted in).
    const lastResort = await generateKemPrekey(responderId, true);
    invites.bindContact(lastResort.prekey.prekeyId, cid);
    // The store must be able to look the offered prekey up + decapsulate against it on the retry accept.
    const lastResortInvites: ResponderInviteStore = {
      ...invites,
      async lookup(prekeyId) {
        if (hex(prekeyId) === hex(lastResort.prekey.prekeyId)) {
          return { prekey: lastResort.prekey, secretKey: lastResort.secretKey, token: null };
        }
        return invites.lookup(prekeyId);
      },
      async offerCurrent() {
        return { prekey: lastResort.prekey, secretKey: lastResort.secretKey };
      }
    };

    const [ra, rb] = createPipe();
    const [rResSettled, iResSettled] = await Promise.allSettled([
      responderHandshake(rb, { identity: responderId, invites: lastResortInvites, contacts }),
      initiatorHandshake(ra, {
        identity: initiatorId, responderPublic: responderId.publicKeys, prekey: rotation,
        mode: 'reconnect', reconnectGateKey: initiatorRGK, allowLastResortRecovery
      })
    ]);
    if (iResSettled.status === 'rejected') throw iResSettled.reason;
    if (rResSettled.status === 'rejected') throw rResSettled.reason;
    return { iRes: iResSettled.value, rRes: rResSettled.value };
  }

  it('refuses a last-resort Reject offer when allowLastResortRecovery is unset (no silent FS-degraded session, H-3)', async () => {
    await expect(runReconnectLastResortReject(false)).rejects.toThrow(/last-resort|opt-in/i);
  });

  it('recovers against a last-resort Reject offer when allowLastResortRecovery is opted in (FS-degraded, by choice)', async () => {
    const { iRes, rRes } = await runReconnectLastResortReject(true);
    expect(iRes.session).toBeTruthy();
    expect(iRes.usedOfferedPrekey).toBe(true);
    expect(await bothExchange(iRes.session, rRes.session, 'lr I')).toBe('lr I');
    expect(await bothExchange(rRes.session, iRes.session, 'lr R')).toBe('lr R');
  });

  async function runReconnectWithForgedReject(): Promise<HandshakeResult> {
    const { initiatorId, responderId, invites, contacts, rotation, initiatorRGK } = await setupConsumedReconnect();
    await invites.consume(rotation.prekeyId);

    const [ra, rb] = createPipe();
    // Flip a byte in the Reject's trailing Sig_R_reject (last 64 bytes) so verification fails.
    const tampered = wrapResponderStream(rb, (payload) => {
      if (payload[0] !== HS_REJECT) return payload;
      const copy = payload.slice();
      copy[copy.length - 1] ^= 0x01;
      return copy;
    });
    const [, iRes] = await Promise.allSettled([
      responderHandshake(tampered, { identity: responderId, invites, contacts }),
      initiatorHandshake(ra, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey: rotation, mode: 'reconnect', reconnectGateKey: initiatorRGK })
    ]);
    if (iRes.status === 'rejected') throw iRes.reason;
    return iRes.value;
  }

  it('initiator rejects a forged Reject (bad Sig_R_reject)', async () => {
    await expect(runReconnectWithForgedReject()).rejects.toThrow(/reject signature|invalid/i);
  });

  /**
   * Capture a GENUINE Reject from dial A (against rotationA), then replay it verbatim as the response
   * to dial B (a fresh Msg1 against rotationB). I reconstructs TH_R0 from dial B's own Msg1 cleartext,
   * which differs from dial A's → the captured Sig_R_reject (bound to TH_R0(A)) fails verification.
   */
  async function runReplayRejectOntoDifferentMsg1(): Promise<HandshakeResult> {
    // Dial A — capture a real Reject.
    const A = await setupConsumedReconnect();
    await A.invites.consume(A.rotation.prekeyId);
    let capturedReject: Uint8Array | null = null;
    const [aRa, aRb] = createPipe();
    const aWrapped = wrapResponderStream(aRb, (payload) => {
      if (payload[0] === HS_REJECT && !capturedReject) capturedReject = payload.slice();
      return payload;
    });
    await Promise.allSettled([
      responderHandshake(aWrapped, { identity: A.responderId, invites: A.invites, contacts: A.contacts }),
      initiatorHandshake(aRa, { identity: A.initiatorId, responderPublic: A.responderId.publicKeys, prekey: A.rotation, mode: 'reconnect', reconnectGateKey: A.initiatorRGK })
    ]);
    if (!capturedReject) throw new Error('test setup: no Reject captured from dial A');

    // Dial B — a fresh reconnect; R is forced to answer with the CAPTURED (dial-A) Reject.
    const B = await setupConsumedReconnect();
    await B.invites.consume(B.rotation.prekeyId);
    const [bRa, bRb] = createPipe();
    const bWrapped = wrapResponderStream(bRb, (payload) => {
      if (payload[0] === HS_REJECT) return capturedReject; // splice dial-A's Reject onto dial B
      return payload;
    });
    const [, iRes] = await Promise.allSettled([
      responderHandshake(bWrapped, { identity: B.responderId, invites: B.invites, contacts: B.contacts }),
      initiatorHandshake(bRa, { identity: B.initiatorId, responderPublic: B.responderId.publicKeys, prekey: B.rotation, mode: 'reconnect', reconnectGateKey: B.initiatorRGK })
    ]);
    if (iRes.status === 'rejected') throw iRes.reason;
    return iRes.value;
  }

  it('a Reject is bound to THIS Msg1 (TH_R0): replaying it onto a different Msg1 is rejected', async () => {
    await expect(runReplayRejectOntoDifferentMsg1()).rejects.toThrow(/reject signature|invalid/i);
  });

  /**
   * Force R to reject on EVERY attempt (its store's lookup always returns null) so the retry ALSO gets
   * a Reject. The initiator's one-retry-per-dial cap must turn the second Reject into a hard fail.
   */
  async function runReconnectDoubleReject(): Promise<HandshakeResult> {
    const { initiatorId, responderId, invites, contacts, rotation, initiatorRGK } = await setupConsumedReconnect();
    // lookup ALWAYS null → R rejects the first Msg1 AND the retry's Msg1.
    const alwaysReject: ResponderInviteStore = { ...invites, async lookup() { return null; } };

    const [ra, rb] = createPipe();
    const [, iRes] = await Promise.allSettled([
      responderHandshake(rb, { identity: responderId, invites: alwaysReject, contacts }),
      initiatorHandshake(ra, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey: rotation, mode: 'reconnect', reconnectGateKey: initiatorRGK })
    ]);
    if (iRes.status === 'rejected') throw iRes.reason;
    return iRes.value;
  }

  it('a second Reject in one dial is a hard fail (one-retry-per-dial cap)', async () => {
    await expect(runReconnectDoubleReject()).rejects.toThrow(/reconnect failed|fresh invite/i);
  });
});

describe('chat handshake — guards', () => {
  it('initiator rejects a prekey not signed by the responder', async () => {
    const initiatorId = generateIdentity();
    const responderId = generateIdentity();
    const imposter = generateIdentity();
    const { prekey } = await generateKemPrekey(imposter); // signed by the wrong identity
    const [sa] = createPipe();
    await expect(
      initiatorHandshake(sa, {
        identity: initiatorId,
        responderPublic: responderId.publicKeys,
        prekey,
        token: randomBytes(32),
        mode: 'first_contact'
      })
    ).rejects.toThrow(HandshakeError);
  });
});
