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
} {
  const map = new Map<string, { prekey: KemPrekey; secretKey: Uint8Array; token: Uint8Array | null }>();
  return {
    async issueFirstContact() {
      const { prekey, secretKey } = await generateKemPrekey(responder);
      const token = randomBytes(32);
      map.set(hex(prekey.prekeyId), { prekey, secretKey, token });
      return { prekey, token };
    },
    async lookup(prekeyId) {
      return map.get(hex(prekeyId)) ?? null;
    },
    async consume(prekeyId) {
      map.delete(hex(prekeyId)); // one-time
    },
    async issueNext() {
      const { prekey, secretKey } = await generateKemPrekey(responder);
      map.set(hex(prekey.prekeyId), { prekey, secretKey, token: null });
      return prekey;
    }
  };
}

function makePinStore(): ContactPinStore {
  const map = new Map<string, IdentityPublic>();
  return {
    async get(ed) {
      return map.get(hex(ed)) ?? null;
    },
    async pin(peer) {
      map.set(hex(peer.ed25519), peer);
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
