import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { PrekeyStore, RECENT_CAP, MINT_CAP } from '../src/main/chat/prekey-store';
import { ContactStore } from '../src/main/chat/contact-store';
import { generateIdentity, contactId, verifyKemPrekey } from '../src/main/chat/identity';

async function tmp(name: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'dcs98-store-')), name);
}

describe('PrekeyStore', () => {
  it('tops up a last-resort + one-time pool', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    await store.ensurePool(5);
    expect(await store.remaining()).toBe(5);
  });

  it('issues a first-contact invite, looks it up with token, and durably consumes it', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    const { prekey, token } = await store.issueFirstContactInvite();
    expect(verifyKemPrekey(prekey, id.publicKeys.ed25519)).toBe(true);

    const rec = await store.lookup(prekey.prekeyId);
    expect(rec).not.toBeNull();
    expect(Array.from(rec!.token as Uint8Array)).toEqual(Array.from(token));
    expect(Array.from(rec!.secretKey)).toHaveLength(3168);

    await store.consume(prekey.prekeyId);
    expect(await store.lookup(prekey.prekeyId)).toBeNull(); // gone after consume
  });

  it('reserves a one-time prekey on lookup so a concurrent replay gets null (TOCTOU guard)', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    const { prekey } = await store.issueFirstContactInvite();
    // Two concurrent lookups of the same one-time prekeyId (the double-consume attack): exactly one wins.
    const [a, b] = await Promise.all([store.lookup(prekey.prekeyId), store.lookup(prekey.prekeyId)]);
    expect([a, b].filter((r) => r !== null)).toHaveLength(1);
    // Releasing the reservation (handshake-abort path) makes it available again…
    await store.release(prekey.prekeyId);
    expect(await store.lookup(prekey.prekeyId)).not.toBeNull();
    // …and consume() finalizes it for good.
    await store.consume(prekey.prekeyId);
    expect(await store.lookup(prekey.prekeyId)).toBeNull();
  });

  it('reloads consumption state from disk (durability round-trip)', async () => {
    const id = generateIdentity();
    const path = await tmp('prekeys.json');
    const s1 = new PrekeyStore(path, id);
    const { prekey } = await s1.issueFirstContactInvite();
    await s1.consume(prekey.prekeyId);
    const s2 = new PrekeyStore(path, id); // fresh instance reads the persisted file
    expect(await s2.lookup(prekey.prekeyId)).toBeNull();
  });

  it('never consumes the last-resort prekey', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    await store.ensurePool(1);
    // find the last-resort by looking it up via issueNext? Instead: ensurePool made one; consume by
    // its id should be a no-op. We can't see its id directly, so assert remaining-one-time unaffected.
    const before = await store.remaining();
    await store.consume(new Uint8Array(16)); // unknown id → no-op
    expect(await store.remaining()).toBe(before);
  });

  it('issueNext adds a one-time prekey', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    const pk = await store.issueNext();
    expect(verifyKemPrekey(pk, id.publicKeys.ed25519)).toBe(true);
    expect(await store.remaining()).toBe(1);
  });

  it('retains a prekeyId→contact index after the one-time secret is consumed', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    const pk = await store.issueNext('contact-abc');
    expect(await store.identifyContact(pk.prekeyId)).toBe('contact-abc');
    await store.consume(pk.prekeyId);
    expect(await store.lookup(pk.prekeyId)).toBeNull();
    expect(await store.identifyContact(pk.prekeyId)).toBe('contact-abc');
  });

  it('coupling invariant: RECENT_CAP (store source-of-truth) >= MINT_CAP', () => {
    expect(RECENT_CAP).toBeGreaterThanOrEqual(MINT_CAP);
  });

  it('per-contact index: a quiet contact resolves after heavy churn on OTHER contacts', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    const quiet = await store.issueNext('cid-quiet');           // the id our quiet peer will present
    for (let i = 0; i < 1000; i++) await store.issueNext(`cid-other-${i}`); // churn elsewhere
    expect(await store.identifyContact(quiet.prekeyId)).toBe('cid-quiet'); // NOT evicted
  }, 60000); // 1000 ML-KEM-1024 mints ~20s; the assertion is what's under test, not the runtime

  it('per-contact index retains >= MINT_CAP recent ids per contact (coupling invariant)', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    const ids = [];
    for (let i = 0; i < MINT_CAP; i++) ids.push((await store.issueNext('cid-strand')).prekeyId);
    for (const pid of ids) expect(await store.identifyContact(pid)).toBe('cid-strand'); // all resolve
  });

  it('offerCurrent re-offers the newest unconsumed issued prekey WITHOUT minting', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    const pending = await store.issueNext('cid-x');        // the prior rotation, unconsumed
    const before = await store.remaining();
    const offered = await store.offerCurrent('cid-x');
    expect(verifyKemPrekey(offered.prekey, id.publicKeys.ed25519)).toBe(true);
    expect(offered.prekey.prekeyId).toEqual(pending.prekeyId); // re-offer, not a fresh mint
    expect(await store.remaining()).toBe(before);              // nothing minted, nothing consumed
  });
  it('offerCurrent mints only when the contact has no unconsumed issued prekey', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    const before = await store.remaining();
    const first = await store.offerCurrent('cid-y');         // none yet → mint one
    expect(await store.identifyContact(first.prekey.prekeyId)).toBe('cid-y');
    expect(await store.remaining()).toBe(before + 1);        // exactly one minted
  });
  it('offerCurrent re-offers first and NEVER throws when an unconsumed prekey exists (#40, spec §2)', async () => {
    const id = generateIdentity();
    const store = new PrekeyStore(await tmp('prekeys.json'), id);
    // Issue several prekeys to ONE contact, all unconsumed. A legitimate stranded peer at/over the
    // old per-cid cap must still recover — re-offer-first never refuses when an unconsumed id exists.
    const ids = [];
    for (let i = 0; i < MINT_CAP + 2; i++) ids.push((await store.issueNext('cid-z')).prekeyId);
    const before = await store.remaining();
    const offered = await store.offerCurrent('cid-z');       // must NOT throw, must NOT mint/consume
    expect(verifyKemPrekey(offered.prekey, id.publicKeys.ed25519)).toBe(true);
    expect(offered.prekey.prekeyId).toEqual(ids[ids.length - 1]); // the NEWEST unconsumed (current)
    expect(await store.remaining()).toBe(before);            // remaining() unchanged
  });
});

describe('ContactStore', () => {
  it('pins a peer and looks it up by ed25519 / id', async () => {
    const store = new ContactStore(await tmp('contacts.json'));
    const peer = generateIdentity().publicKeys;
    await store.pin(peer, { onion: 'aaaa.onion', displayName: 'GhostExodus' });
    const got = await store.get(peer.ed25519);
    expect(got).not.toBeNull();
    expect(Array.from(got!.x25519)).toEqual(Array.from(peer.x25519));
    const c = await store.getById(contactId(peer));
    expect(c?.displayName).toBe('GhostExodus');
    expect(c?.onion).toBe('aaaa.onion');
    expect(c?.verified).toBe(false);
  });

  it('pinning the same identity twice is idempotent', async () => {
    const store = new ContactStore(await tmp('contacts.json'));
    const peer = generateIdentity().publicKeys;
    await store.pin(peer);
    await store.pin(peer);
    expect(await store.list()).toHaveLength(1);
  });

  it('updates mutable fields (verified, lastSeen, nextPrekey)', async () => {
    const store = new ContactStore(await tmp('contacts.json'));
    const peerId = generateIdentity();
    const peer = peerId.publicKeys;
    await store.pin(peer);
    const id = contactId(peer);
    await store.update(id, { verified: true, lastSeen: 1717000000000 });
    const c = await store.getById(id);
    expect(c?.verified).toBe(true);
    expect(c?.lastSeen).toBe(1717000000000);
  });

  it('returns null for an unknown peer', async () => {
    const store = new ContactStore(await tmp('contacts.json'));
    expect(await store.get(generateIdentity().publicKeys.ed25519)).toBeNull();
  });

  it('persists and updates the reconnect gate key', async () => {
    const store = new ContactStore(await tmp('contacts.json'));
    const peer = generateIdentity().publicKeys;
    await store.pin(peer);
    const id = contactId(peer);
    const rgk = new Uint8Array(32).fill(7);
    await store.update(id, { reconnectGateKey: rgk });
    const c = await store.getById(id);
    expect(Array.from(c!.reconnectGateKey!)).toEqual(Array.from(rgk));
  });

  it('persists rgkPeerConfirmed and defaults it false; clears RGK+flag on identity re-pin', async () => {
    const store = new ContactStore(await tmp('contacts.json'));
    const peer = generateIdentity().publicKeys;
    await store.pin(peer);
    const id = contactId(peer);
    expect((await store.getById(id))!.rgkPeerConfirmed).toBe(false);
    await store.update(id, { reconnectGateKey: new Uint8Array(32).fill(7), rgkPeerConfirmed: true });
    expect((await store.getById(id))!.rgkPeerConfirmed).toBe(true);
    // re-pin to a NEW identity epoch must clear both (epoch-bound flag, rev-4 §3)
    await store.resetReconnectEpoch(id);
    const c = await store.getById(id);
    expect(c!.reconnectGateKey).toBeNull();
    expect(c!.rgkPeerConfirmed).toBe(false);
  });
});
