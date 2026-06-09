import { describe, it, expect } from 'vitest';
import { ReconnectRateLimiter } from '../src/main/chat/reconnect-gate';
import {
  initiatorHandshake,
  responderHandshake,
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

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

describe('ReconnectRateLimiter (Task 2.5 / N-3) — pure unit', () => {
  it('reserved bucket (recognized ids) is not starved by an unrecognized-id flood', () => {
    let tick = 0;
    const rl = new ReconnectRateLimiter({ now: () => tick });
    // A garbage flood of UNrecognized ids: these go to the tighter bucket and saturate IT, but must
    // not consume the reserved bucket's capacity.
    for (let i = 0; i < 1000; i++) rl.admit({ recognized: false, fp: `g${i}` });
    // A recognized id (legit reconnect / strand recovery) still passes — its bucket was untouched.
    expect(rl.admit({ recognized: true, fp: 'legit' }).allowed).toBe(true);
  });

  it('dedup: a replayed identical Msg1 fingerprint does not reuse reserved capacity', () => {
    const rl = new ReconnectRateLimiter({ now: () => 0 });
    expect(rl.admit({ recognized: true, fp: 'same' }).allowed).toBe(true);
    expect(rl.admit({ recognized: true, fp: 'same' }).allowed).toBe(false); // deduped (anti-replay)
  });

  it('seen-set is sized >= reserved window (eviction cannot out-pace the bucket)', () => {
    const rl = new ReconnectRateLimiter({ now: () => 0 });
    expect(rl.seenSetSize).toBeGreaterThanOrEqual(rl.reservedWindow);
  });

  it('reserved bucket admits up to its windowed count, then refuses within the window', () => {
    let tick = 0;
    const rl = new ReconnectRateLimiter({ now: () => tick });
    let admitted = 0;
    for (let i = 0; i < rl.reservedWindow + 5; i++) {
      if (rl.admit({ recognized: true, fp: `r${i}` }).allowed) admitted++;
    }
    expect(admitted).toBe(rl.reservedWindow);
    // Advance the logical window → capacity refreshes.
    tick += 1;
    expect(rl.admit({ recognized: true, fp: 'after-window' }).allowed).toBe(true);
  });

  it('tighter bucket admits far fewer than the reserved bucket within a window', () => {
    const rl = new ReconnectRateLimiter({ now: () => 0 });
    expect(rl.tighterWindow).toBeLessThan(rl.reservedWindow);
    let admitted = 0;
    for (let i = 0; i < rl.tighterWindow + 50; i++) {
      if (rl.admit({ recognized: false, fp: `u${i}` }).allowed) admitted++;
    }
    expect(admitted).toBe(rl.tighterWindow);
  });

  it('M-1: constructing with tighterWindow >= reservedWindow throws', () => {
    expect(() => new ReconnectRateLimiter({ now: () => 0, reservedWindow: 8, tighterWindow: 8 })).toThrow(/tighterWindow must be < reservedWindow/);
    expect(() => new ReconnectRateLimiter({ now: () => 0, reservedWindow: 8, tighterWindow: 16 })).toThrow(/tighterWindow must be < reservedWindow/);
    // A correctly-ordered config does NOT throw.
    expect(() => new ReconnectRateLimiter({ now: () => 0, reservedWindow: 32, tighterWindow: 8 })).not.toThrow();
  });

  it('M-3: a NaN-returning now() does NOT allow-all — admissions fail closed (DoS gate stays armed)', () => {
    const rl = new ReconnectRateLimiter({ now: () => Number.NaN });
    // Recognized path: must be denied (not silently admitted) even far below the window count.
    for (let i = 0; i < 100; i++) {
      expect(rl.admit({ recognized: true, fp: `n${i}` }).allowed).toBe(false);
    }
    // Unrecognized path: likewise denied.
    for (let i = 0; i < 100; i++) {
      expect(rl.admit({ recognized: false, fp: `m${i}` }).allowed).toBe(false);
    }
    // Infinity is also non-finite → fail closed.
    const rlInf = new ReconnectRateLimiter({ now: () => Number.POSITIVE_INFINITY });
    expect(rlInf.admit({ recognized: true, fp: 'inf' }).allowed).toBe(false);
  });

  it('is deterministic: no internal clock — identical injected ticks give identical decisions', () => {
    const seq = () => {
      const rl = new ReconnectRateLimiter({ now: () => 0 });
      const out: boolean[] = [];
      for (let i = 0; i < rl.reservedWindow + 3; i++) out.push(rl.admit({ recognized: true, fp: `d${i}` }).allowed);
      return out;
    };
    expect(seq()).toEqual(seq());
  });
});

// ---- handshake wiring: a reconnect Msg1 carrying a last-resort prekey_id is rejected ----

function makePinStore(): ContactPinStore & {
  setReconnectKey(cid: string, rgk: Uint8Array): void;
  setRgkConfirmed(cid: string, v: boolean): void;
} {
  const map = new Map<string, IdentityPublic>();
  const rgks = new Map<string, Uint8Array>();
  const confirmed = new Map<string, boolean>();
  return {
    async get(ed) { return map.get(hex(ed)) ?? null; },
    async pin(peer) { map.set(hex(peer.ed25519), peer); },
    async getReconnectKey(cid) { return rgks.get(cid) ?? null; },
    async isRgkConfirmed(cid) { return confirmed.get(cid) ?? false; },
    setReconnectKey(cid, rgk) { rgks.set(cid, rgk); },
    setRgkConfirmed(cid, v) { confirmed.set(cid, v); }
  };
}

function makeInviteStore(responder: IdentityKeyPair): ResponderInviteStore & {
  issueFirstContact(): Promise<{ prekey: KemPrekey; token: Uint8Array }>;
  bindContact(prekeyId: Uint8Array, cid: string): void;
  registerLastResort(prekeyId: Uint8Array): void;
} {
  const map = new Map<string, { prekey: KemPrekey; secretKey: Uint8Array; token: Uint8Array | null }>();
  const pidToCid = new Map<string, string>();
  const lastResortIds = new Set<string>();
  return {
    async issueFirstContact() {
      const { prekey, secretKey } = await generateKemPrekey(responder);
      const { randomBytes } = await import('../src/main/chat/crypto');
      const token = randomBytes(32);
      map.set(hex(prekey.prekeyId), { prekey, secretKey, token });
      return { prekey, token };
    },
    bindContact(prekeyId, cid) { pidToCid.set(hex(prekeyId), cid); },
    registerLastResort(prekeyId) { lastResortIds.add(hex(prekeyId)); },
    async lookup(prekeyId) { return map.get(hex(prekeyId)) ?? null; },
    async consume(prekeyId) { map.delete(hex(prekeyId)); },
    async release() {},
    async issueNext() {
      const { prekey, secretKey } = await generateKemPrekey(responder);
      map.set(hex(prekey.prekeyId), { prekey, secretKey, token: null });
      return prekey;
    },
    async identifyContact(prekeyId) { return pidToCid.get(hex(prekeyId)) ?? null; },
    async offerCurrent(cid) {
      for (const [pid, c] of pidToCid) {
        if (c !== cid) continue;
        const rec = map.get(pid);
        if (rec) return { prekey: rec.prekey, secretKey: rec.secretKey };
      }
      const { prekey, secretKey } = await generateKemPrekey(responder);
      map.set(hex(prekey.prekeyId), { prekey, secretKey, token: null });
      pidToCid.set(hex(prekey.prekeyId), cid);
      return { prekey, secretKey };
    },
    async isLastResortId(prekeyId) { return lastResortIds.has(hex(prekeyId)); }
  };
}

/** Establish a pin + RGK, then reconnect using a LAST-RESORT prekey_id. R must reject it before any
 *  asymmetric work — a reconnect is never INITIATED with a last-resort id. */
async function runReconnectWithLastResortId(): Promise<void> {
  const initiatorId = generateIdentity();
  const responderId = generateIdentity();
  const invites = makeInviteStore(responderId);
  const contacts = makePinStore();
  const { prekey, token } = await invites.issueFirstContact();

  const [fa, fb] = createPipe();
  const [rFirst] = await Promise.all([
    responderHandshake(fb, { identity: responderId, invites, contacts }),
    initiatorHandshake(fa, { identity: initiatorId, responderPublic: responderId.publicKeys, prekey, token, mode: 'first_contact' })
  ]);
  const cid = contactId(initiatorId.publicKeys);
  contacts.setReconnectKey(cid, rFirst.reconnectGateKey as Uint8Array);
  contacts.setRgkConfirmed(cid, true);

  // A signed last-resort prekey, indexed to the contact and flagged as last-resort in the store.
  const lastResort = await generateKemPrekey(responderId, true);
  invites.bindContact(lastResort.prekey.prekeyId, cid);
  invites.registerLastResort(lastResort.prekey.prekeyId);
  // Make it look up too (so the reject must come from the kind check, not a plain unknown-prekey path).
  const lr = lastResort;
  const invitesWithLr: ResponderInviteStore = {
    ...invites,
    async lookup(prekeyId) {
      if (hex(prekeyId) === hex(lr.prekey.prekeyId)) return { prekey: lr.prekey, secretKey: lr.secretKey, token: null };
      return invites.lookup(prekeyId);
    }
  };

  const [ra, rb] = createPipe();
  const [rSettled, iSettled] = await Promise.allSettled([
    responderHandshake(rb, { identity: responderId, invites: invitesWithLr, contacts }),
    initiatorHandshake(ra, {
      identity: initiatorId, responderPublic: responderId.publicKeys,
      prekey: lastResort.prekey, mode: 'reconnect', reconnectGateKey: rFirst.reconnectGateKey as Uint8Array
    })
  ]);
  // The responder must have rejected. Surface its error (the one carrying the last-resort/kind message).
  if (rSettled.status === 'rejected') throw rSettled.reason;
  // If R somehow resolved, fail loudly via the initiator side.
  if (iSettled.status === 'rejected') throw iSettled.reason;
  throw new Error('expected responder to reject a last-resort reconnect prekey_id, but both sides resolved');
}

describe('handshake — reject a reconnect Msg1 carrying a last-resort prekey_id (N-3)', () => {
  it('handshake rejects a reconnect Msg1 carrying a last-resort prekey_id', async () => {
    await expect(runReconnectWithLastResortId()).rejects.toThrow(/last-resort|prekey kind/i);
  });
});

const DENY_ALL = { admit: () => ({ allowed: false }) } as unknown as ReconnectRateLimiter;

/** First contact, then a reconnect. `confirmRgk` decides whether R enforces the mac_R gate (gated path,
 *  NOT rate-limited) or stays unconfirmed (ungated path, IS rate-limited). Returns the settled results. */
async function runReconnect(confirmRgk: boolean): Promise<{ rStatus: string; iStatus: string; rReason?: unknown }> {
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
  contacts.setRgkConfirmed(cid, confirmRgk);

  const [ra, rb] = createPipe();
  const [rSettled, iSettled] = await Promise.allSettled([
    responderHandshake(rb, { identity: responderId, invites, contacts, rateLimiter: DENY_ALL }),
    initiatorHandshake(ra, {
      identity: initiatorId, responderPublic: responderId.publicKeys, prekey: rotation,
      mode: 'reconnect', reconnectGateKey: rFirst.reconnectGateKey as Uint8Array
    })
  ]);
  return {
    rStatus: rSettled.status,
    iStatus: iSettled.status,
    rReason: rSettled.status === 'rejected' ? rSettled.reason : undefined
  };
}

describe('handshake — rate-limiter wiring (N-3)', () => {
  it('UNGATED reconnect (unconfirmed contact) is rejected when the injected limiter denies', async () => {
    const { rStatus, rReason } = await runReconnect(false);
    expect(rStatus).toBe('rejected');
    expect(String((rReason as Error).message)).toMatch(/rate-limited/i);
  });

  it('GATED reconnect (confirmed mac_R) is NOT rate-limited — a deny-all limiter does not block it', async () => {
    const { rStatus, iStatus } = await runReconnect(true);
    expect(rStatus).toBe('fulfilled'); // mac_R-enforced path bypasses the limiter entirely
    expect(iStatus).toBe('fulfilled');
  });
});
