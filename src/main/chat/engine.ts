/**
 * Chat engine (Phase 1) — ties identity + Transport + handshake + stores + Connection into one
 * object the IPC layer drives. EXPERIMENTAL (the handshake is pending formal verification).
 *
 * Responsibilities: publish our onion (via Transport) + accept inbound (responder handshake → wrap
 * in Connection → persist/route); create invites; accept invites (initiator handshake, first
 * contact); send (outbox → encrypt → frame), dial-on-demand reconnect; surface message/presence/
 * delivery events. Transport + stores are INJECTED so the whole flow is testable over the in-memory
 * network without real Tor.
 */
import { Connection } from './connection';
import type { Transport, ChatStream } from './transport';
import { initiatorHandshake, responderHandshake } from './handshake';
import { ReconnectRateLimiter } from './reconnect-gate';
import { encodeEnvelope, decodeEnvelope, TRANSFER_ID_LEN, GROUP_ID_LEN, type MessageContent } from './session';
import { chunkFile, FileReceiver } from './transfer';
import { randomBytes } from './crypto';
import { createInvite, parseInvite } from './invite';
import { contactId, type IdentityKeyPair, type IdentityPublic } from './identity';
import type { PrekeyStore } from './prekey-store';
import type { ContactStore } from './contact-store';
import { ContactError } from './contact-store';
/** The mutable-field patch shape ContactStore.update accepts — derived so the engine's RGK-persistence
 *  patches stay in lockstep with the store's signature (3.1-a/b). */
type ContactPatch = Parameters<ContactStore['update']>[1];
import type { MessageStore, ChatMessage, ChatFileMeta, FileStatus } from './message-store';
import type { GroupStore, ChatGroup } from './group-store';

export type ContactStatus = 'online' | 'connecting' | 'offline';

/** Caller-supplied sink for a fully received + hash-verified file. Implemented by the electron
 *  service (writes to a quarantine dir under dataRoot); injected so the engine stays fs-free. Returns
 *  the quarantine path recorded in history. The user must then explicitly save it elsewhere. */
export type QuarantineSink = (params: {
  contactId: string;
  transferId: string;
  name: string;
  mime: string;
  data: Uint8Array;
}) => Promise<string>;

/** Bound on concurrent inbound transfers held in memory (each up to MAX_FILE_BYTES) — DoS guard. */
const MAX_ACTIVE_RECEIVERS = 8;
/** Yield to the event loop every N chunks while sending a large file (avoid starving the loop). */
const SEND_YIELD_EVERY = 16;

export interface ChatEngineEvents {
  onMessage?(contactId: string, message: ChatMessage): void;
  onContactStatus?(contactId: string, status: ContactStatus): void;
  onDelivery?(contactId: string, messageId: string, state: 'sent' | 'delivered'): void;
  onFileStatus?(
    contactId: string,
    transferId: string,
    status: FileStatus,
    progress?: { received: number; total: number }
  ): void;
  onGroupMessage?(groupId: string, message: ChatMessage): void;
  onGroupInvite?(groupId: string): void;
}
export interface ChatEngineDeps {
  identity: IdentityKeyPair;
  transport: Transport;
  prekeys: PrekeyStore;
  contacts: ContactStore;
  messages: MessageStore;
  groups: GroupStore;
  groupMessages: MessageStore; // keyed by groupId (32-hex), not contactId
  now(): number;
  newId(): string;
  quarantine?: QuarantineSink;
  events?: ChatEngineEvents;
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const unhex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, 'hex'));

export class ChatEngine {
  private conns = new Map<string, Connection>();
  private sendSeq = new Map<string, number>();
  private recvSeq = new Map<string, number>();
  private pendingAcks = new Map<string, string>(); // `${cid}:${counter}` → messageId
  // in-flight inbound transfers keyed by transferId(hex)
  private receivers = new Map<string, { cid: string; rx: FileReceiver; msgId: string; lastActivity: number }>();
  // ONE GLOBAL (across-dials) reconnect rate-limiter for the responder's UNGATED reconnect branch
  // (Task 2.5 / 3.1-e). Injected `now` reuses the engine's own clock — NO new Date.now() call site —
  // so the gate stays deterministic/mockable; the tick affects only allow/deny, never any key/transcript.
  private readonly reconnectLimiter = new ReconnectRateLimiter({ now: () => this.d.now() });

  constructor(private readonly d: ChatEngineDeps) {}

  async start(): Promise<void> {
    this.d.transport.onConnection((stream) => { void this.acceptInbound(stream); });
    await this.d.transport.start();
  }
  async stop(): Promise<void> {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.receivers.clear(); // drop in-flight transfer buffers (zeroize-by-GC)
    await this.d.transport.stop();
  }

  onionAddress(): string | null {
    return this.d.transport.onionAddress();
  }

  /** Test/diagnostic hook (3.1-h): close every live connection without tearing down the transport, so a
   *  subsequent send/sendFile re-dials and exercises the dial-on-demand reconnect path. The onClose
   *  handler each Connection carries removes it from `conns` and emits offline. */
  dropConnections(): void {
    for (const c of [...this.conns.values()]) c.close();
    this.conns.clear();
  }

  /** Mint a first-contact invite link to hand out-of-band. */
  async createInvite(): Promise<string> {
    const onion = this.d.transport.onionAddress();
    if (!onion) throw new Error('chat transport not ready (no onion address yet)');
    const { prekey, token } = await this.d.prekeys.issueFirstContactInvite();
    return createInvite({ responder: this.d.identity, onion, prekey, token });
  }

  /** Accept an invite (we are the initiator): dial, first-contact handshake, pin, attach. */
  async acceptInvite(link: string): Promise<string> {
    const inv = parseInvite(link);
    const stream = await this.d.transport.dial(inv.onion);
    const res = await initiatorHandshake(stream, {
      identity: this.d.identity,
      responderPublic: inv.responderPublic,
      prekey: inv.prekey,
      token: inv.token,
      mode: 'first_contact'
    });
    const cid = contactId(res.peer);
    await this.d.contacts.pin(res.peer, { onion: inv.onion });
    // (3.1-f) A fresh first_contact invite restarts the RGK epoch: clear any prior RGK + confirm flag
    // BEFORE installing this handshake's RGK, so the new epoch starts with rgkPeerConfirmed=false (the
    // epoch-bound invariant). pin() refuses an identity CHANGE (MITM guard), so a successful re-pin is
    // always the SAME identity re-accepting a fresh invite — exactly the "restart this contact's RGK
    // epoch" case. resetReconnectEpoch throws on an unknown contact, so it only runs once the row exists.
    // (review I-1a) Narrow the swallow: only the expected absent-row case (ContactError, thrown when the
    // contact row doesn't exist yet) is benign here — a genuine store-write I/O fault is a DIFFERENT
    // error and MUST propagate, since silently swallowing it could leave rgkPeerConfirmed stale-true into
    // the new epoch (violating the epoch-bound invariant, spec §3).
    await this.d.contacts.resetReconnectEpoch(cid).catch((e) => { if (!(e instanceof ContactError)) throw e; });
    // (3.1-a) Persist the RGK from this completed handshake (initiator role also returns one). This is
    // the legitimate first_contact epoch establishment — the one place the engine writes the RGK.
    // (review I-1b) Belt-and-suspenders: ALWAYS clear rgkPeerConfirmed in the SAME patch that installs
    // the new first_contact RGK, so the epoch-bound invariant holds atomically even if the reset write
    // above failed (first_contact legitimately starts unconfirmed).
    const patch: ContactPatch = { lastSeen: this.d.now(), rgkPeerConfirmed: false };
    if (res.nextPrekey) patch.nextPrekey = res.nextPrekey;
    if (res.reconnectGateKey) patch.reconnectGateKey = res.reconnectGateKey;
    await this.d.contacts.update(cid, patch);
    this.attach(cid, stream, res.session);
    return cid;
  }

  /** Send a text message; queues to history + outbox, dialing on demand if not connected. */
  async send(contactId_: string, text: string): Promise<string> {
    const id = this.d.newId();
    const seq = (this.sendSeq.get(contactId_) ?? 0) + 1;
    this.sendSeq.set(contactId_, seq);
    await this.d.messages.append(contactId_, { id, direction: 'out', seq, ts: this.d.now(), text, state: 'queued' });

    let conn = this.conns.get(contactId_);
    if (!conn || conn.closed) conn = await this.connect(contactId_);
    const counter = conn.sendMessage(encodeEnvelope({ type: 'text', text }));
    this.pendingAcks.set(`${contactId_}:${counter}`, id);
    await this.d.messages.updateState(contactId_, id, 'sent');
    this.d.events?.onDelivery?.(contactId_, id, 'sent');
    return id;
  }

  /** Send a file: record a file message, then stream the offer + ordered chunks over the session.
   *  Each chunk is its own AEAD-sealed Msg frame. Returns the message id. */
  async sendFile(contactId_: string, name: string, mime: string, data: Uint8Array): Promise<string> {
    const transferId = randomBytes(TRANSFER_ID_LEN);
    const tidHex = hex(transferId);
    const { offer, chunks } = chunkFile({ transferId, name, mime, data });

    const id = this.d.newId();
    const seq = (this.sendSeq.get(contactId_) ?? 0) + 1;
    this.sendSeq.set(contactId_, seq);
    const file: ChatFileMeta = { transferId: tidHex, name, size: data.length, mime, status: 'transferring' };
    await this.d.messages.append(contactId_, {
      id, direction: 'out', seq, ts: this.d.now(), kind: 'file', text: name, file, state: 'queued'
    });

    let conn = this.conns.get(contactId_);
    if (!conn || conn.closed) conn = await this.connect(contactId_);

    // The offer's ack maps to this message's delivery state (like a text message).
    const offerCounter = conn.sendMessage(encodeEnvelope(offer));
    this.pendingAcks.set(`${contactId_}:${offerCounter}`, id);
    await this.d.messages.updateState(contactId_, id, 'sent');
    this.d.events?.onDelivery?.(contactId_, id, 'sent');

    for (let i = 0; i < chunks.length; i += 1) {
      conn.sendMessage(encodeEnvelope(chunks[i]));
      if (i % SEND_YIELD_EVERY === SEND_YIELD_EVERY - 1) await Promise.resolve();
    }

    // From the sender's view the transfer is done once every chunk is queued on the wire.
    await this.d.messages.patchFile(contactId_, id, { status: 'complete' });
    this.d.events?.onFileStatus?.(contactId_, tidHex, 'complete');
    return id;
  }

  history(contactId_: string): Promise<ChatMessage[]> {
    return this.d.messages.list(contactId_);
  }

  // ---- groups (Phase 3, client-side fan-out) ----

  private myContactId(): string {
    return contactId(this.d.identity.publicKeys);
  }

  /** Create a group of existing contacts (memberIds = the OTHER participants, hex contactIds). Mints a
   *  groupId, stores it locally, and broadcasts a group-invite carrying the full participant set so
   *  each member converges on the same group. */
  async createGroup(name: string, memberIds: string[]): Promise<string> {
    const me = this.myContactId();
    const others = [...new Set(memberIds)].filter((id) => id !== me);
    const groupId = hex(randomBytes(GROUP_ID_LEN));
    await this.d.groups.create({ groupId, name, memberIds: others, creator: me, createdAt: this.d.now() });
    await this.broadcastGroupInvite(groupId, name, others);
    return groupId;
  }

  listGroups(): Promise<ChatGroup[]> {
    return this.d.groups.list();
  }
  groupHistory(groupId: string): Promise<ChatMessage[]> {
    return this.d.groupMessages.list(groupId);
  }

  /** (Re)send the group-invite to every member — used on create and when membership changes. The
   *  invite's member list is the FULL participant set (others ∪ me) so each recipient can reconcile. */
  async broadcastGroupInvite(groupId: string, name: string, others: string[]): Promise<void> {
    const participants = [...new Set([...others, this.myContactId()])];
    const memberIdBytes = participants.map(unhex);
    const gidBytes = unhex(groupId);
    await Promise.all(
      others.map(async (memberCid) => {
        try {
          const conn = await this.ensureConn(memberCid);
          conn.sendMessage(encodeEnvelope({ type: 'group-invite', groupId: gidBytes, name, memberIds: memberIdBytes }));
        } catch {
          /* member unreachable right now — they'll miss this invite (fan-out best-effort) */
        }
      })
    );
  }

  /** Fan-out a group message: encrypt it separately over each reachable member's 1:1 session. Records
   *  one outbound row in the group history; per-member delivery is best-effort (no group acks in v1). */
  async sendGroup(groupId: string, text: string): Promise<string> {
    const g = await this.d.groups.get(groupId);
    if (!g) throw new Error('unknown group');
    const id = this.d.newId();
    const seq = (this.sendSeq.get(groupId) ?? 0) + 1;
    this.sendSeq.set(groupId, seq);
    await this.d.groupMessages.append(groupId, {
      id, direction: 'out', seq, ts: this.d.now(), kind: 'text', text, sender: this.myContactId(), state: 'sent'
    });
    const gidBytes = unhex(groupId);
    await Promise.all(
      g.memberIds.map(async (memberCid) => {
        try {
          const conn = await this.ensureConn(memberCid);
          conn.sendMessage(encodeEnvelope({ type: 'group-text', groupId: gidBytes, text }));
        } catch {
          /* unreachable member — fan-out is best-effort; mesh-incomplete is a known limitation */
        }
      })
    );
    return id;
  }

  /** Get a live connection to a contact, dialing on demand. */
  private async ensureConn(cid: string): Promise<Connection> {
    const c = this.conns.get(cid);
    if (c && !c.closed) return c;
    return this.connect(cid);
  }

  // ---- internals ----
  private async connect(cid: string): Promise<Connection> {
    const c = await this.d.contacts.getById(cid);
    if (!c?.onion || !c.nextPrekey) throw new Error('cannot reconnect: no onion / rotation prekey for contact');
    this.d.events?.onContactStatus?.(cid, 'connecting');
    const stream = await this.d.transport.dial(c.onion);
    // (3.1-d) Dial-on-demand reconnect orchestration: pass the stored RGK so I sends mac_R whenever it
    // holds one for this contact (the responder reads getReconnectKey/isRgkConfirmed via the
    // ContactPinStore it was given). undefined when no RGK is held yet (bootstrap fail-open).
    const res = await initiatorHandshake(stream, {
      identity: this.d.identity,
      responderPublic: c.identity,
      prekey: c.nextPrekey,
      mode: 'reconnect',
      reconnectGateKey: c.reconnectGateKey ?? undefined
    });
    // Attach (subscribe the Connection to the stream) SYNCHRONOUSLY before any await, so a message the
    // peer sends right after the handshake isn't lost in the gap before we're listening: the handshake
    // reader has detached, and the transport does not buffer for a late subscriber.
    this.attach(cid, stream, res.session);
    // (3.1-a, review C-1) Persist the rotation prekey + lastSeen only. The RGK is STABLE — derived once
    // at first_contact and NEVER rotated per reconnect (rev-4 spec §3). The handshake returns a freshly
    // derived reconnectGateKey on every reconnect too, but the engine DISCARDS it and keeps the stable
    // first_contact RGK: rotating it desyncs I and R on a half-completed reconnect (Msg2 dropped in
    // flight — R completes + would-rotate while I throws before persisting), re-introducing the HIGH-1
    // permanent cheap-close lockout this workstream exists to fix.
    const patch: ContactPatch = { lastSeen: this.d.now() };
    if (res.nextPrekey) patch.nextPrekey = res.nextPrekey;
    await this.d.contacts.update(cid, patch);
    return this.conns.get(cid) as Connection;
  }

  private async acceptInbound(stream: ChatStream): Promise<void> {
    try {
      const res = await responderHandshake(stream, {
        identity: this.d.identity,
        invites: this.d.prekeys,
        contacts: this.d.contacts,
        rateLimiter: this.reconnectLimiter // (3.1-e) the one global ungated-reconnect DoS bound
      });
      const cid = contactId(res.peer); // peer already pinned inside the handshake
      // Attach SYNCHRONOUSLY before the await below — otherwise the peer's first message can arrive in
      // the gap before the Connection subscribes and be lost (the handshake reader has detached; the
      // transport doesn't replay for late subscribers). See the handshake→session handoff fix.
      this.attach(cid, stream, res.session);
      // (3.1-a/b, review C-1) Persist the RGK ONLY on first_contact — that is the legitimate epoch
      // establishment. The RGK is STABLE and is NEVER overwritten on a reconnect (rev-4 spec §3); doing
      // so would desync I and R on a half-completed reconnect and re-introduce the HIGH-1 lockout. The
      // confirm flip is SEPARATE from the RGK and MUST still happen on reconnect: when R verified a valid
      // mac_R, flip rgkPeerConfirmed — the enforcement-bootstrap, from now on R ENFORCES the mac_R gate
      // for this contact. .catch() guards the brief window where the row isn't fully written.
      const patch: ContactPatch = { lastSeen: this.d.now() };
      if (res.mode === 'first_contact' && res.reconnectGateKey) patch.reconnectGateKey = res.reconnectGateKey;
      if (res.peerMacRVerified) patch.rgkPeerConfirmed = true;
      await this.d.contacts.update(cid, patch).catch(() => { /* not yet a full contact row */ });
    } catch {
      try { stream.close(); } catch { /* already closed */ }
    }
  }

  private attach(cid: string, stream: ChatStream, session: ConstructorParameters<typeof Connection>[1]): void {
    this.conns.get(cid)?.close(); // replace any stale connection
    const conn = new Connection(stream, session, {
      onMessage: (env) => { void this.onIncoming(cid, env); },
      onAck: (counter) => this.onAck(cid, counter),
      onClose: () => {
        if (this.conns.get(cid) === conn) this.conns.delete(cid);
        void this.failTransfersFor(cid); // interrupted inbound transfers can't complete on this link
        this.d.events?.onContactStatus?.(cid, 'offline');
      }
    });
    this.conns.set(cid, conn);
    this.d.events?.onContactStatus?.(cid, 'online');
  }

  private async onIncoming(cid: string, envelope: Uint8Array): Promise<void> {
    let content: MessageContent;
    try {
      content = decodeEnvelope(envelope);
    } catch {
      return; // malformed content — drop (the connection layer already validated framing/auth)
    }
    switch (content.type) {
      case 'text':
        return this.onIncomingText(cid, content.text);
      case 'file-offer':
        return this.onFileOffer(cid, content);
      case 'file-chunk':
        return this.onFileChunk(cid, content);
      case 'group-text':
        return this.onGroupText(cid, content);
      case 'group-invite':
        return this.onGroupInvite(cid, content);
    }
  }

  private async onGroupText(cid: string, content: Extract<MessageContent, { type: 'group-text' }>): Promise<void> {
    const groupId = hex(content.groupId);
    const g = await this.d.groups.get(groupId);
    if (!g) return; // unknown group (no invite seen yet) — drop rather than auto-join
    // Authz (defence-in-depth; not true access control — a removed member keeps a working 1:1 ratchet,
    // so real revocation means rotating the groupId): only accept group messages from a current member
    // (the creator is implicitly a member). A paired-but-non-member contact can't inject into a group.
    if (cid !== g.creator && !g.memberIds.includes(cid)) return;
    const id = this.d.newId();
    const seq = (this.recvSeq.get(groupId) ?? 0) + 1;
    this.recvSeq.set(groupId, seq);
    const message: ChatMessage = { id, direction: 'in', seq, ts: this.d.now(), kind: 'text', text: content.text, sender: cid, state: 'received' };
    await this.d.groupMessages.append(groupId, message);
    this.d.events?.onGroupMessage?.(groupId, message);
  }

  private async onGroupInvite(cid: string, content: Extract<MessageContent, { type: 'group-invite' }>): Promise<void> {
    const groupId = hex(content.groupId);
    const me = this.myContactId();
    // CLAMP the inviter's claimed roster to contacts we ALREADY trust — never persist arbitrary
    // peer-supplied fingerprints. The inviter cid is by construction a paired contact (the frame
    // arrived over an authenticated 1:1 session), so it's always allowed.
    const known = new Set((await this.d.contacts.list()).map((c) => c.contactId));
    const clamped = content.memberIds.map(hex).filter((id) => id !== me && known.has(id));
    if (cid !== me && !clamped.includes(cid)) clamped.push(cid);

    const existing = await this.d.groups.get(groupId);
    if (!existing) {
      // New group: auto-create with the inviter recorded as creator (the authz anchor).
      const created = await this.d.groups.create({ groupId, name: content.name, memberIds: clamped, creator: cid, createdAt: this.d.now() }).catch(() => false);
      if (created) this.d.events?.onGroupInvite?.(groupId);
      return;
    }
    // Existing group: only the creator or a current member may mutate it — drop a hijack attempt.
    // Only the creator may rename; non-creator members may only ADD members (union), never rename.
    if (cid !== existing.creator && !existing.memberIds.includes(cid)) return;
    await this.d.groups.update(groupId, {
      memberIds: clamped,
      name: cid === existing.creator ? content.name : undefined
    });
  }

  private async onIncomingText(cid: string, text: string): Promise<void> {
    const id = this.d.newId();
    const seq = (this.recvSeq.get(cid) ?? 0) + 1;
    this.recvSeq.set(cid, seq);
    const message: ChatMessage = { id, direction: 'in', seq, ts: this.d.now(), kind: 'text', text, state: 'received' };
    await this.d.messages.append(cid, message);
    this.d.events?.onMessage?.(cid, message);
  }

  private async onFileOffer(cid: string, offer: Extract<MessageContent, { type: 'file-offer' }>): Promise<void> {
    const key = hex(offer.transferId);
    if (this.receivers.has(key)) return; // duplicate offer — ignore
    if (this.receivers.size >= MAX_ACTIVE_RECEIVERS) return; // memory-bound: drop excess concurrent transfers
    let rx: FileReceiver;
    try {
      rx = new FileReceiver(offer); // throws on an inconsistent/oversize offer → ignore
    } catch {
      return;
    }
    const id = this.d.newId();
    const seq = (this.recvSeq.get(cid) ?? 0) + 1;
    this.recvSeq.set(cid, seq);
    const file: ChatFileMeta = { transferId: key, name: offer.name, size: offer.size, mime: offer.mime, status: 'transferring' };
    const message: ChatMessage = { id, direction: 'in', seq, ts: this.d.now(), kind: 'file', text: offer.name, file, state: 'received' };
    this.receivers.set(key, { cid, rx, msgId: id, lastActivity: this.d.now() });
    await this.d.messages.append(cid, message);
    this.d.events?.onMessage?.(cid, message);
    this.d.events?.onFileStatus?.(cid, key, 'transferring', rx.progress);
    if (rx.complete) await this.finishTransfer(key); // robustness (we never SEND empty files)
  }

  private async onFileChunk(cid: string, chunk: Extract<MessageContent, { type: 'file-chunk' }>): Promise<void> {
    const key = hex(chunk.transferId);
    const entry = this.receivers.get(key);
    if (!entry || entry.cid !== cid) return; // unknown / foreign transfer — drop
    entry.lastActivity = this.d.now();
    try {
      entry.rx.accept(chunk);
    } catch {
      await this.failTransfer(key); // tamper / oversize / conflicting dup → fail-closed
      return;
    }
    this.d.events?.onFileStatus?.(cid, key, 'transferring', entry.rx.progress);
    if (entry.rx.complete) await this.finishTransfer(key);
  }

  private async finishTransfer(key: string): Promise<void> {
    const entry = this.receivers.get(key);
    if (!entry) return;
    this.receivers.delete(key);
    let data: Uint8Array;
    try {
      data = entry.rx.assemble(); // verifies the whole-file hash before releasing bytes
    } catch {
      await this.markFailed(entry.cid, entry.msgId, key);
      return;
    }
    let quarantinePath: string | null = null;
    try {
      quarantinePath = this.d.quarantine
        ? await this.d.quarantine({ contactId: entry.cid, transferId: key, name: entry.rx.offer.name, mime: entry.rx.offer.mime, data })
        : null;
    } catch {
      await this.markFailed(entry.cid, entry.msgId, key);
      return;
    }
    await this.d.messages.patchFile(entry.cid, entry.msgId, { status: 'complete', quarantinePath });
    this.d.events?.onFileStatus?.(entry.cid, key, 'complete', entry.rx.progress);
  }

  private async failTransfer(key: string): Promise<void> {
    const entry = this.receivers.get(key);
    if (!entry) return;
    this.receivers.delete(key);
    await this.markFailed(entry.cid, entry.msgId, key);
  }

  private async markFailed(cid: string, msgId: string, key: string): Promise<void> {
    await this.d.messages.patchFile(cid, msgId, { status: 'failed' }).catch(() => { /* row may be gone */ });
    this.d.events?.onFileStatus?.(cid, key, 'failed');
  }

  /** Fail every in-flight inbound transfer for a contact (its connection dropped mid-transfer). */
  private async failTransfersFor(cid: string): Promise<void> {
    for (const [key, entry] of [...this.receivers]) {
      if (entry.cid !== cid) continue;
      this.receivers.delete(key);
      await this.markFailed(cid, entry.msgId, key);
    }
  }

  /** Reap inbound transfers idle longer than maxIdleMs — bounds memory against a stalled / slow-loris
   *  peer that opens an offer (holding a receiver slot + buffer) but withholds chunks. Driven by the
   *  service on a timer; the engine stays time-free (now is injected). */
  async sweepStalledTransfers(maxIdleMs: number): Promise<void> {
    const cutoff = this.d.now() - maxIdleMs;
    for (const [key, entry] of [...this.receivers]) {
      if (entry.lastActivity > cutoff) continue;
      this.receivers.delete(key);
      await this.markFailed(entry.cid, entry.msgId, key);
    }
  }

  private onAck(cid: string, counter: number): void {
    const key = `${cid}:${counter}`;
    const id = this.pendingAcks.get(key);
    if (!id) return;
    this.pendingAcks.delete(key);
    void this.d.messages.updateState(cid, id, 'delivered');
    this.d.events?.onDelivery?.(cid, id, 'delivered');
  }
}

export type { IdentityPublic };
export type { FileStatus, ChatFileMeta } from './message-store';
