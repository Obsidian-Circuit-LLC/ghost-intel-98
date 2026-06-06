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
import { encodeEnvelope, decodeEnvelope, TRANSFER_ID_LEN, type MessageContent } from './session';
import { chunkFile, FileReceiver } from './transfer';
import { randomBytes } from './crypto';
import { createInvite, parseInvite } from './invite';
import { contactId, type IdentityKeyPair, type IdentityPublic } from './identity';
import type { PrekeyStore } from './prekey-store';
import type { ContactStore } from './contact-store';
import type { MessageStore, ChatMessage, ChatFileMeta, FileStatus } from './message-store';

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
}
export interface ChatEngineDeps {
  identity: IdentityKeyPair;
  transport: Transport;
  prekeys: PrekeyStore;
  contacts: ContactStore;
  messages: MessageStore;
  now(): number;
  newId(): string;
  quarantine?: QuarantineSink;
  events?: ChatEngineEvents;
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

export class ChatEngine {
  private conns = new Map<string, Connection>();
  private sendSeq = new Map<string, number>();
  private recvSeq = new Map<string, number>();
  private pendingAcks = new Map<string, string>(); // `${cid}:${counter}` → messageId
  // in-flight inbound transfers keyed by transferId(hex)
  private receivers = new Map<string, { cid: string; rx: FileReceiver; msgId: string; lastActivity: number }>();

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
    if (res.nextPrekey) await this.d.contacts.update(cid, { nextPrekey: res.nextPrekey, lastSeen: this.d.now() });
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

  // ---- internals ----
  private async connect(cid: string): Promise<Connection> {
    const c = await this.d.contacts.getById(cid);
    if (!c?.onion || !c.nextPrekey) throw new Error('cannot reconnect: no onion / rotation prekey for contact');
    this.d.events?.onContactStatus?.(cid, 'connecting');
    const stream = await this.d.transport.dial(c.onion);
    const res = await initiatorHandshake(stream, {
      identity: this.d.identity,
      responderPublic: c.identity,
      prekey: c.nextPrekey,
      mode: 'reconnect'
    });
    if (res.nextPrekey) await this.d.contacts.update(cid, { nextPrekey: res.nextPrekey, lastSeen: this.d.now() });
    this.attach(cid, stream, res.session);
    return this.conns.get(cid) as Connection;
  }

  private async acceptInbound(stream: ChatStream): Promise<void> {
    try {
      const res = await responderHandshake(stream, {
        identity: this.d.identity,
        invites: this.d.prekeys,
        contacts: this.d.contacts
      });
      const cid = contactId(res.peer); // peer already pinned inside the handshake
      await this.d.contacts.update(cid, { lastSeen: this.d.now() }).catch(() => { /* not yet a full contact row */ });
      this.attach(cid, stream, res.session);
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
    }
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
