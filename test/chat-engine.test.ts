import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { ChatEngine, type ChatEngineEvents, type QuarantineSink } from '../src/main/chat/engine';
import { InMemoryNetwork, InMemoryTransport } from '../src/main/chat/transport';
import { PrekeyStore } from '../src/main/chat/prekey-store';
import { ContactStore } from '../src/main/chat/contact-store';
import { MessageStore } from '../src/main/chat/message-store';
import { generateIdentity, contactId, type IdentityKeyPair } from '../src/main/chat/identity';

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ONION_A = `${'a'.repeat(56)}.onion`;
const ONION_B = `${'b'.repeat(56)}.onion`;

async function makeEngine(
  net: InMemoryNetwork,
  onion: string,
  identity: IdentityKeyPair,
  events: ChatEngineEvents,
  quarantine?: QuarantineSink
): Promise<ChatEngine> {
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
    quarantine,
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

describe('ChatEngine — file transfer (Phase 2) over the in-memory network', () => {
  /** Deterministic pseudo-file. */
  const makeFile = (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = (i * 17 + 5) & 0xff;
    return out;
  };

  async function pair(events: { aEv?: ChatEngineEvents; bEv?: ChatEngineEvents; bSink?: QuarantineSink }): Promise<{
    a: ChatEngine; b: ChatEngine; cidA_onB: string; cidB_onA: string;
  }> {
    const net = new InMemoryNetwork();
    const idA = generateIdentity();
    const idB = generateIdentity();
    const a = await makeEngine(net, ONION_A, idA, events.aEv ?? {});
    const b = await makeEngine(net, ONION_B, idB, events.bEv ?? {}, events.bSink);
    await a.start();
    await b.start();
    const link = await a.createInvite();
    const cidA_onB = await b.acceptInvite(link);
    await flush(20);
    return { a, b, cidA_onB, cidB_onA: contactId(idB.publicKeys) };
  }

  it('streams a multi-chunk file A→B; B quarantines verified bytes and records a complete file message', async () => {
    const quarantined: { name: string; mime: string; data: Uint8Array }[] = [];
    const bStatuses: { transferId: string; status: string }[] = [];
    const sink: QuarantineSink = async ({ name, mime, data }) => {
      quarantined.push({ name, mime, data });
      return `/quarantine/${name}`;
    };
    const { a, b, cidB_onA, cidA_onB } = await pair({
      bEv: { onFileStatus: (_c, transferId, status) => bStatuses.push({ transferId, status }) },
      bSink: sink
    });

    const payload = makeFile(128 * 1024 * 2 + 777); // 3 chunks
    const msgId = await a.sendFile(cidB_onA, 'evidence.bin', 'application/octet-stream', payload);
    await flush(60);

    // B received + verified + quarantined the exact bytes
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].name).toBe('evidence.bin');
    expect(Array.from(quarantined[0].data)).toEqual(Array.from(payload));
    expect(bStatuses.some((s) => s.status === 'complete')).toBe(true);

    // B history shows a complete inbound file message with the quarantine pointer
    const bHist = await b.history(cidA_onB);
    const fileMsg = bHist.find((m) => m.kind === 'file');
    expect(fileMsg?.file?.status).toBe('complete');
    expect(fileMsg?.file?.quarantinePath).toBe('/quarantine/evidence.bin');
    expect(fileMsg?.file?.size).toBe(payload.length);

    // A's own copy is marked complete + delivered (offer was acked)
    const aHist = await a.history(cidB_onA);
    const aFile = aHist.find((m) => m.id === msgId);
    expect(aFile?.file?.status).toBe('complete');
    expect(aFile?.state).toBe('delivered');

    await a.stop();
    await b.stop();
  });

  it('sends a single-chunk file correctly', async () => {
    const got: Uint8Array[] = [];
    const sink: QuarantineSink = async ({ data }) => { got.push(data); return '/q/x'; };
    const { a, b, cidB_onA } = await pair({ bSink: sink });
    const payload = makeFile(2048);
    await a.sendFile(cidB_onA, 'small.txt', 'text/plain', payload);
    await flush(40);
    expect(got).toHaveLength(1);
    expect(Array.from(got[0])).toEqual(Array.from(payload));
    await a.stop();
    await b.stop();
  });

  it('refuses to send an empty file', async () => {
    const { a, b, cidB_onA } = await pair({});
    await expect(a.sendFile(cidB_onA, 'empty', '', new Uint8Array(0))).rejects.toBeTruthy();
    await a.stop();
    await b.stop();
  });

  it('stall sweep does not disturb a completed transfer (no false-fail of finished files)', async () => {
    const sink: QuarantineSink = async () => '/q/done';
    const { a, b, cidB_onA, cidA_onB } = await pair({ bSink: sink });
    await a.sendFile(cidB_onA, 'done.bin', '', makeFile(4096));
    await flush(40);
    // With no in-flight receivers, sweeping anything (even maxIdle 0) must be a harmless no-op.
    await b.sweepStalledTransfers(0);
    const fileMsg = (await b.history(cidA_onB)).find((m) => m.kind === 'file');
    expect(fileMsg?.file?.status).toBe('complete'); // NOT flipped to 'failed'
    await a.stop();
    await b.stop();
  });
});
