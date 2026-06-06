import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { ChatEngine, type ChatEngineEvents } from '../src/main/chat/engine';
import { InMemoryNetwork, InMemoryTransport } from '../src/main/chat/transport';
import { PrekeyStore } from '../src/main/chat/prekey-store';
import { ContactStore } from '../src/main/chat/contact-store';
import { MessageStore } from '../src/main/chat/message-store';
import { generateIdentity, contactId, type IdentityKeyPair } from '../src/main/chat/identity';

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ONION_A = `${'a'.repeat(56)}.onion`;
const ONION_B = `${'b'.repeat(56)}.onion`;

async function makeEngine(net: InMemoryNetwork, onion: string, identity: IdentityKeyPair, events: ChatEngineEvents): Promise<ChatEngine> {
  const dir = await mkdtemp(join(tmpdir(), 'dcs98-eng-'));
  let n = 0;
  const engine = new ChatEngine({
    identity,
    transport: new InMemoryTransport(net, onion),
    prekeys: new PrekeyStore(join(dir, 'prekeys.json'), identity),
    contacts: new ContactStore(join(dir, 'contacts.json')),
    messages: new MessageStore(join(dir, 'messages')),
    now: () => 1717000000000 + n,
    newId: () => `${onion[0]}-${(n += 1)}`,
    events
  });
  return engine;
}

describe('ChatEngine — end-to-end over the in-memory network (EXPERIMENTAL stack)', () => {
  it('invite → first-contact handshake → message both ways → delivery acks → persisted history', async () => {
    const net = new InMemoryNetwork();
    const idA = generateIdentity();
    const idB = generateIdentity();

    const aMsgs: { cid: string; text: string }[] = [];
    const bMsgs: { cid: string; text: string }[] = [];
    const bDeliveries: { id: string; state: string }[] = [];

    const a = await makeEngine(net, ONION_A, idA, { onMessage: (cid, m) => aMsgs.push({ cid, text: m.text }) });
    const b = await makeEngine(net, ONION_B, idB, {
      onMessage: (cid, m) => bMsgs.push({ cid, text: m.text }),
      onDelivery: (_cid, id, state) => bDeliveries.push({ id, state })
    });

    await a.start();
    await b.start();

    // A invites; B accepts (B dials A → A responder handshake)
    const link = await a.createInvite();
    const cidA_onB = await b.acceptInvite(link); // contactId of A, as seen by B
    expect(cidA_onB).toBe(contactId(idA.publicKeys));
    await flush();

    const cidB_onA = contactId(idB.publicKeys);

    // B → A
    const m1 = await b.send(cidA_onB, 'hello A, it is B');
    await flush(20);
    expect(aMsgs).toEqual([{ cid: cidB_onA, text: 'hello A, it is B' }]);
    // A auto-acked → B sees delivered
    expect(bDeliveries.some((d) => d.id === m1 && d.state === 'delivered')).toBe(true);

    // A → B (A already has a live connection from the inbound handshake)
    await a.send(cidB_onA, 'hi B, A here');
    await flush(20);
    expect(bMsgs).toEqual([{ cid: cidA_onB, text: 'hi B, A here' }]);

    // history persisted on both sides
    const aHist = await a.history(cidB_onA);
    expect(aHist.map((m) => `${m.direction}:${m.text}`)).toEqual(['in:hello A, it is B', 'out:hi B, A here']);
    const bHist = await b.history(cidA_onB);
    expect(bHist.find((m) => m.id === m1)?.state).toBe('delivered');

    await a.stop();
    await b.stop();
  });

  it('rejects an invite dialed with the wrong token (handshake fails, no contact created)', async () => {
    const net = new InMemoryNetwork();
    const idA = generateIdentity();
    const idB = generateIdentity();
    const a = await makeEngine(net, ONION_A, idA, {});
    const b = await makeEngine(net, ONION_B, idB, {});
    await a.start();
    await b.start();

    const link = await a.createInvite();
    // Corrupt the token region of the link → mac_T mismatch on A's side → handshake aborts.
    const tampered = link.slice(0, -8) + (link.slice(-8) === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA');
    await expect(b.acceptInvite(tampered)).rejects.toBeTruthy();

    await a.stop();
    await b.stop();
  });
});
