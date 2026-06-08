import { describe, it, expect } from 'vitest';
import {
  initiatorHandshake,
  responderHandshake,
  HandshakeError,
  type ResponderInviteStore,
  type ContactPinStore
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
import { randomBytes } from '../src/main/chat/crypto';

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
