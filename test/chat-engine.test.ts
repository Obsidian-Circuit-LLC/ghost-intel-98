import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { ChatEngine, type ChatEngineEvents, type QuarantineSink } from '../src/main/chat/engine';
import { InMemoryNetwork, InMemoryTransport, type Transport, type ChatStream } from '../src/main/chat/transport';
import { PrekeyStore } from '../src/main/chat/prekey-store';
import { ContactStore } from '../src/main/chat/contact-store';
import { MessageStore } from '../src/main/chat/message-store';
import { GroupStore } from '../src/main/chat/group-store';
import { generateIdentity, contactId, type IdentityKeyPair } from '../src/main/chat/identity';

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ONION_A = `${'a'.repeat(56)}.onion`;
const ONION_B = `${'b'.repeat(56)}.onion`;

async function makeEngine(
  net: InMemoryNetwork,
  onion: string,
  identity: IdentityKeyPair,
  events: ChatEngineEvents,
  quarantine?: QuarantineSink,
  contactsUpdateDelayMs = 0
): Promise<ChatEngine> {
  const dir = await mkdtemp(join(tmpdir(), 'dcs98-eng-'));
  let n = 0;
  const contacts = new ContactStore(join(dir, 'contacts.json'));
  if (contactsUpdateDelayMs > 0) {
    // Widen the post-handshake window between responderHandshake resolving and attach() — to prove the
    // handshake→session handoff no longer loses a message the peer sends in that gap (regression guard).
    const realUpdate = contacts.update.bind(contacts);
    (contacts as unknown as { update: typeof contacts.update }).update = async (...a: Parameters<typeof contacts.update>) => {
      await new Promise((r) => setTimeout(r, contactsUpdateDelayMs));
      return realUpdate(...a);
    };
  }
  const engine = new ChatEngine({
    identity,
    transport: new InMemoryTransport(net, onion),
    prekeys: new PrekeyStore(join(dir, 'prekeys.json'), identity),
    contacts,
    messages: new MessageStore(join(dir, 'messages')),
    groups: new GroupStore(join(dir, 'groups.json')),
    groupMessages: new MessageStore(join(dir, 'gmsgs'), undefined, /^[0-9a-f]{32}$/),
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

  it('does NOT lose the peer\'s first message sent in the post-handshake handoff gap (regression)', async () => {
    const net = new InMemoryNetwork();
    const idA = generateIdentity();
    const idB = generateIdentity();
    const aMsgs: { cid: string; text: string }[] = [];
    // A is the RESPONDER (B accepts the invite → B dials A). Force A's post-handshake
    // contacts.update to be slow so the gap between responderHandshake resolving and attach() is wide.
    const a = await makeEngine(net, ONION_A, idA, { onMessage: (cid, m) => aMsgs.push({ cid, text: m.text }) }, undefined, 50);
    const b = await makeEngine(net, ONION_B, idB, {});
    await a.start();
    await b.start();

    const link = await a.createInvite();
    const cidA_onB = await b.acceptInvite(link); // resolves once B (initiator) has attached
    const cidB_onA = contactId(idB.publicKeys);
    // Send IMMEDIATELY — no flush — so B's message hits A while A is still inside the widened gap.
    await b.send(cidA_onB, 'first message in the gap');
    await flush(120); // let A's delayed update finish + the message route

    // Pre-fix: the orphaned handshake reader swallowed this frame → aMsgs empty + ratchet desync.
    expect(aMsgs).toEqual([{ cid: cidB_onA, text: 'first message in the gap' }]);

    // And the channel is still healthy afterwards (no counter desync / teardown).
    await a.send(cidB_onA, 'reply after the gap');
    await flush(20);
    const bHist = await b.history(cidA_onB);
    expect(bHist.some((m) => m.text === 'reply after the gap')).toBe(true);

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

  it('group (fan-out): invite propagates, messages route both ways into group history', async () => {
    const aGroupMsgs: { groupId: string; sender?: string; text: string }[] = [];
    const bInvites: string[] = [];
    const bGroupMsgs: { groupId: string; sender?: string; text: string }[] = [];
    const { a, b, cidB_onA, cidA_onB } = await pair({
      aEv: { onGroupMessage: (groupId, m) => aGroupMsgs.push({ groupId, sender: m.sender, text: m.text }) },
      bEv: {
        onGroupInvite: (groupId) => bInvites.push(groupId),
        onGroupMessage: (groupId, m) => bGroupMsgs.push({ groupId, sender: m.sender, text: m.text })
      }
    });

    // A creates a group containing B; the invite should reach B and auto-create the same group there.
    const groupId = await a.createGroup('case-team', [cidB_onA]);
    await flush(30);
    expect(bInvites).toContain(groupId);
    const bGroups = await b.listGroups();
    expect(bGroups.find((g) => g.groupId === groupId)?.name).toBe('case-team');
    // B's local member view is [A]
    expect(bGroups.find((g) => g.groupId === groupId)?.memberIds).toEqual([cidA_onB]);

    // A → group; B receives it attributed to A
    await a.sendGroup(groupId, 'team, sync at 1500');
    await flush(30);
    expect(bGroupMsgs).toEqual([{ groupId, sender: cidA_onB, text: 'team, sync at 1500' }]);

    // B → group; A receives it attributed to B
    await b.sendGroup(groupId, 'ack');
    await flush(30);
    expect(aGroupMsgs).toEqual([{ groupId, sender: cidB_onA, text: 'ack' }]);

    // both sides persist the group history (own + peer messages)
    const aHist = await a.groupHistory(groupId);
    expect(aHist.map((m) => `${m.direction}:${m.text}`)).toEqual(['out:team, sync at 1500', 'in:ack']);

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

describe('ChatEngine — reconnect hardening (handshake v4, Task 3.1) RGK wiring', () => {
  /** A richer harness that exposes each engine's stores + a controllable logical clock so the RGK
   *  persistence / confirmation / rate-limiter wiring can be asserted directly. */
  async function makeNode(net: InMemoryNetwork, onion: string, identity: IdentityKeyPair, events: ChatEngineEvents = {}, transport?: Transport): Promise<{
    engine: ChatEngine;
    contacts: ContactStore;
    prekeys: PrekeyStore;
    tick: () => number;
    setTick: (n: number) => void;
  }> {
    const dir = await mkdtemp(join(tmpdir(), 'dcs98-rgk-'));
    let n = 0;
    let clock = 1717000000000;
    const contacts = new ContactStore(join(dir, 'contacts.json'));
    const prekeys = new PrekeyStore(join(dir, 'prekeys.json'), identity);
    const engine = new ChatEngine({
      identity,
      transport: transport ?? new InMemoryTransport(net, onion),
      prekeys,
      contacts,
      messages: new MessageStore(join(dir, 'messages')),
      groups: new GroupStore(join(dir, 'groups.json')),
      groupMessages: new MessageStore(join(dir, 'gmsgs'), undefined, /^[0-9a-f]{32}$/),
      now: () => clock,
      newId: () => `${onion[0]}-${(n += 1)}`,
      events
    });
    return { engine, contacts, prekeys, tick: () => clock, setTick: (v: number) => { clock = v; } };
  }

  it('persists an RGK on the establishing handshake (both roles) and reconnects on demand', async () => {
    const net = new InMemoryNetwork();
    const idA = generateIdentity();
    const idB = generateIdentity();
    const aMsgs: { cid: string; text: string }[] = [];
    const A = await makeNode(net, ONION_A, idA, { onMessage: (cid, m) => aMsgs.push({ cid, text: m.text }) });
    const B = await makeNode(net, ONION_B, idB);
    await A.engine.start();
    await B.engine.start();

    const link = await A.engine.createInvite();
    const cidA_onB = await B.engine.acceptInvite(link); // B initiator, A responder
    await flush(20);
    const cidB_onA = contactId(idB.publicKeys);

    // Initiator (B) persisted an RGK for A.
    expect((await B.contacts.getById(cidA_onB))?.reconnectGateKey).not.toBeNull();
    // Responder (A) persisted an RGK for B too.
    expect((await A.contacts.getById(cidB_onA))?.reconnectGateKey).not.toBeNull();

    // Force a reconnect: drop B's live conn, then send → B must re-dial + reconnect-handshake A.
    B.engine.dropConnections();
    await B.engine.send(cidA_onB, 'after reconnect');
    await flush(40);
    expect(aMsgs.map((m) => m.text)).toContain('after reconnect');

    await A.engine.stop();
    await B.engine.stop();
  });

  it('sets rgkPeerConfirmed only after the responder verifies a valid mac_R, gating the NEXT reconnect', async () => {
    const net = new InMemoryNetwork();
    const idA = generateIdentity();
    const idB = generateIdentity();
    const A = await makeNode(net, ONION_A, idA);
    const B = await makeNode(net, ONION_B, idB);
    await A.engine.start();
    await B.engine.start();

    const link = await A.engine.createInvite();
    const cidA_onB = await B.engine.acceptInvite(link);
    await flush(20);
    const cidB_onA = contactId(idB.publicKeys);

    // After first contact, A (responder) has NOT yet seen a mac_R (first_contact carries none).
    expect(await A.contacts.isRgkConfirmed(cidB_onA)).toBe(false);

    // Reconnect: B now holds an RGK so it sends a valid mac_R; A verifies it and flips the confirm flag.
    B.engine.dropConnections();
    await B.engine.send(cidA_onB, 'reconnect 1');
    await flush(40);
    expect(await A.contacts.isRgkConfirmed(cidB_onA)).toBe(true);

    // Now A enforces the gate. A legit B (still holding the same RGK) reconnects again successfully.
    B.engine.dropConnections();
    await B.engine.send(cidA_onB, 'reconnect 2 gated');
    await flush(40);
    const aHist = await A.engine.history(cidB_onA);
    expect(aHist.some((m) => m.text === 'reconnect 2 gated')).toBe(true);

    await A.engine.stop();
    await B.engine.stop();
  });

  it('issueNext is called WITH the cid: the responder issuance index resolves the rotation pid → cid', async () => {
    const net = new InMemoryNetwork();
    const idA = generateIdentity();
    const idB = generateIdentity();
    const A = await makeNode(net, ONION_A, idA); // A is responder → A.prekeys gets the issuance index
    const B = await makeNode(net, ONION_B, idB);
    await A.engine.start();
    await B.engine.start();

    const link = await A.engine.createInvite();
    const cidA_onB = await B.engine.acceptInvite(link);
    await flush(20);
    const cidB_onA = contactId(idB.publicKeys);

    // B (initiator) stored the rotation prekey A minted. A's prekey-store issuance index must resolve
    // that pid back to B's cid — proving issueNext was called WITH the cid on the responder rotation path.
    const rotation = (await B.contacts.getById(cidA_onB))?.nextPrekey;
    expect(rotation).toBeTruthy();
    const resolved = await A.prekeys.identifyContact(rotation!.prekeyId);
    expect(resolved).toBe(cidB_onA);

    await A.engine.stop();
    await B.engine.stop();
  });

  it('a fresh re-pin (new invite) clears RGK + rgkPeerConfirmed (resetReconnectEpoch)', async () => {
    const net = new InMemoryNetwork();
    const idA = generateIdentity();
    const idB = generateIdentity();
    const A = await makeNode(net, ONION_A, idA);
    const B = await makeNode(net, ONION_B, idB);
    await A.engine.start();
    await B.engine.start();

    const link1 = await A.engine.createInvite();
    const cidA_onB = await B.engine.acceptInvite(link1);
    await flush(20);

    // Drive a reconnect so B's side has an RGK and A confirms it — establishes a populated epoch.
    B.engine.dropConnections();
    await B.engine.send(cidA_onB, 'establish epoch');
    await flush(40);
    expect((await B.contacts.getById(cidA_onB))?.reconnectGateKey).not.toBeNull();

    // Manually mark B's stored confirm flag so we can prove the re-pin clears it (the initiator side's
    // epoch reset is what we exercise — B re-accepts a fresh invite for the SAME identity A).
    await B.contacts.update(cidA_onB, { rgkPeerConfirmed: true });
    expect((await B.contacts.getById(cidA_onB))?.rgkPeerConfirmed).toBe(true);

    // A mints a brand-new first-contact invite; B accepts it again (same identity → re-pin path).
    const link2 = await A.engine.createInvite();
    const cidA_onB2 = await B.engine.acceptInvite(link2);
    expect(cidA_onB2).toBe(cidA_onB);
    await flush(20);

    // The re-pin must have reset the epoch: confirm flag cleared, and a fresh RGK installed.
    expect((await B.contacts.getById(cidA_onB))?.rgkPeerConfirmed).toBe(false);
    expect((await B.contacts.getById(cidA_onB))?.reconnectGateKey).not.toBeNull();

    await A.engine.stop();
    await B.engine.stop();
  });

  // ---- harness: drop the responder→initiator direction on ONE dial, mid-handshake ----
  // Wraps a real Transport and, on the FIRST dial after `armDrop()`, hands back a ChatStream that
  // (a) lets the initiator's outbound bytes (Msg1) reach the responder normally, but (b) SWALLOWS every
  // inbound byte from the responder (so the initiator never receives Msg2), then (c) closes the stream
  // shortly after — so the initiator's handshake throws `stream closed during handshake` AFTER the
  // responder has already received Msg1, completed, and (under the C-1 bug) rotated/persisted its RGK.
  // This is the exact half-completed-reconnect interleaving C-1 broke.
  class DropResponderDirectionOnceTransport implements Transport {
    private armed = false;
    constructor(private readonly inner: Transport) {}
    armDrop(): void { this.armed = true; }
    onConnection(handler: (s: ChatStream) => void): void { this.inner.onConnection(handler); }
    onionAddress(): string | null { return this.inner.onionAddress(); }
    start(): Promise<void> { return this.inner.start(); }
    stop(): Promise<void> { return this.inner.stop(); }
    async dial(onion: string): Promise<ChatStream> {
      const real = await this.inner.dial(onion);
      if (!this.armed) return real;
      this.armed = false; // one-shot
      let dataCb: ((d: Uint8Array) => void) | null = null;
      // Subscribe to the real stream but DISCARD inbound bytes — the responder's Msg2 never surfaces.
      real.onData(() => { /* dropped: responder→initiator direction is severed */ });
      // After a couple of macrotasks (Msg1 delivered to R, R replies + resolves), close the initiator
      // side so its handshake reader fails instead of hanging forever.
      setTimeout(() => { try { real.close(); } catch { /* already closed */ } }, 30);
      const wrapper: ChatStream = {
        get closed() { return real.closed; },
        send: (d) => real.send(d), // outbound (Msg1) still reaches the responder
        onData: (cb) => { dataCb = cb; void dataCb; }, // captured but never invoked
        onClose: (cb) => real.onClose(cb),
        close: () => real.close()
      };
      return wrapper;
    }
  }

  it('a reconnect interrupted after R sends Msg2 but before I processes it does NOT lock I out (RGK stays stable; C-1 regression)', async () => {
    const net = new InMemoryNetwork();
    const idA = generateIdentity();
    const idB = generateIdentity();
    const aMsgs: { cid: string; text: string }[] = [];
    const A = await makeNode(net, ONION_A, idA, { onMessage: (cid, m) => aMsgs.push({ cid, text: m.text }) }); // A = responder (R)
    const dropTransport = new DropResponderDirectionOnceTransport(new InMemoryTransport(net, ONION_B));
    const B = await makeNode(net, ONION_B, idB, {}, dropTransport); // B = initiator (I)
    await A.engine.start();
    await B.engine.start();

    const link = await A.engine.createInvite();
    const cidA_onB = await B.engine.acceptInvite(link); // first_contact: installs the STABLE epoch RGK on both
    await flush(20);
    const cidB_onA = contactId(idB.publicKeys);

    const rgkBefore = (await B.contacts.getById(cidA_onB))?.reconnectGateKey;
    expect(rgkBefore).not.toBeNull();

    // Bootstrap the confirm flag with one clean reconnect, so A is ENFORCING the gate before the
    // interrupted attempt (this is the regime where a desync would be fatal — a cheap-close lockout).
    B.engine.dropConnections();
    await B.engine.send(cidA_onB, 'clean reconnect (confirm A)');
    await flush(40);
    expect(await A.contacts.isRgkConfirmed(cidB_onA)).toBe(true);

    // Now the HALF-COMPLETED reconnect: drop R→I so B's handshake throws after A completed.
    B.engine.dropConnections();
    dropTransport.armDrop();
    await expect(B.engine.send(cidA_onB, 'doomed mid-flight reconnect')).rejects.toBeTruthy();
    await flush(60);

    // B never persisted anything from the failed handshake → it still holds the SAME stable RGK.
    const rgkAfter = (await B.contacts.getById(cidA_onB))?.reconnectGateKey;
    expect(rgkAfter).toEqual(rgkBefore);

    // The crux: the NEXT reconnect from B must STILL SUCCEED. Under the C-1 bug A rotated its RGK on the
    // half-completed attempt while B kept RGK0 → B's mac_R would fail A's enforced gate → permanent
    // cheap-close lockout. With the fix (A's RGK stable), B's RGK0 mac_R still matches → success.
    B.engine.dropConnections();
    await B.engine.send(cidA_onB, 'recovery reconnect must succeed');
    await flush(60);
    const aHist = await A.engine.history(cidB_onA);
    expect(aHist.some((m) => m.text === 'recovery reconnect must succeed')).toBe(true);

    await A.engine.stop();
    await B.engine.stop();
  });
});
