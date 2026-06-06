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
import { encodeEnvelope, decodeEnvelope } from './session';
import { createInvite, parseInvite } from './invite';
import { contactId, type IdentityKeyPair, type IdentityPublic } from './identity';
import type { PrekeyStore } from './prekey-store';
import type { ContactStore } from './contact-store';
import type { MessageStore, ChatMessage } from './message-store';

export type ContactStatus = 'online' | 'connecting' | 'offline';
export interface ChatEngineEvents {
  onMessage?(contactId: string, message: ChatMessage): void;
  onContactStatus?(contactId: string, status: ContactStatus): void;
  onDelivery?(contactId: string, messageId: string, state: 'sent' | 'delivered'): void;
}
export interface ChatEngineDeps {
  identity: IdentityKeyPair;
  transport: Transport;
  prekeys: PrekeyStore;
  contacts: ContactStore;
  messages: MessageStore;
  now(): number;
  newId(): string;
  events?: ChatEngineEvents;
}

export class ChatEngine {
  private conns = new Map<string, Connection>();
  private sendSeq = new Map<string, number>();
  private recvSeq = new Map<string, number>();
  private pendingAcks = new Map<string, string>(); // `${cid}:${counter}` → messageId

  constructor(private readonly d: ChatEngineDeps) {}

  async start(): Promise<void> {
    this.d.transport.onConnection((stream) => { void this.acceptInbound(stream); });
    await this.d.transport.start();
  }
  async stop(): Promise<void> {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
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
        this.d.events?.onContactStatus?.(cid, 'offline');
      }
    });
    this.conns.set(cid, conn);
    this.d.events?.onContactStatus?.(cid, 'online');
  }

  private async onIncoming(cid: string, envelope: Uint8Array): Promise<void> {
    let text: string;
    try {
      text = decodeEnvelope(envelope).text;
    } catch {
      return; // malformed content — drop (the connection layer already validated framing/auth)
    }
    const id = this.d.newId();
    const seq = (this.recvSeq.get(cid) ?? 0) + 1;
    this.recvSeq.set(cid, seq);
    const message: ChatMessage = { id, direction: 'in', seq, ts: this.d.now(), text, state: 'received' };
    await this.d.messages.append(cid, message);
    this.d.events?.onMessage?.(cid, message);
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
