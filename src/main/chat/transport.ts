/**
 * Chat transport seam (Phase 1, Stage 2).
 *
 * The protocol layers (handshake, session, wire) only ever see a `ChatStream` — a bidirectional
 * byte pipe. This interface is what makes the whole stack testable without real Tor: the production
 * implementation is a Tor onion service + SOCKS dial (bundled C-tor; arti deferred per Stage 0), and
 * the test implementation is an in-memory pipe. Nothing above this file knows which it is.
 *
 * `Transport` is the node-level object: it publishes our onion service (inbound) and dials peers
 * (outbound). Both bind/connect only over loopback in the real impl (the no-firewall-prompt
 * invariant) — but that detail lives in the C-tor implementation, not here.
 */

/** A bidirectional byte stream between two peers. Framing/encryption live above this. */
export interface ChatStream {
  /** Queue bytes to the peer. No-op after close. */
  send(data: Uint8Array): void;
  /** Subscribe to inbound bytes. Multiple subscribers each receive every chunk. */
  onData(cb: (data: Uint8Array) => void): void;
  /** Subscribe to stream close (local or remote). Fires at most once. */
  onClose(cb: () => void): void;
  /** Close the stream; idempotent. */
  close(): void;
  readonly closed: boolean;
}

export interface Transport {
  /** Dial a peer's `.onion`; resolves to a stream once connected, rejects on failure. */
  dial(onion: string): Promise<ChatStream>;
  /** Register the handler for inbound connections (the onion-service target). Call before start(). */
  onConnection(handler: (stream: ChatStream) => void): void;
  /** Our published onion address, or null before start()/publish completes. */
  onionAddress(): string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

// ---- In-memory implementation (tests / the protocol integration harness) ----

/** One endpoint of an in-memory pipe. Bytes sent here surface on the paired endpoint's onData. */
class InMemoryStream implements ChatStream {
  private dataCbs: Array<(d: Uint8Array) => void> = [];
  private closeCbs: Array<() => void> = [];
  private _closed = false;
  peer: InMemoryStream | null = null;

  get closed(): boolean {
    return this._closed;
  }

  send(data: Uint8Array): void {
    if (this._closed || !this.peer || this.peer._closed) return;
    // Copy so the caller can reuse its buffer; deliver async to model real stream semantics
    // (a send never re-enters the sender's stack synchronously).
    const copy = data.slice();
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer._closed) return;
      for (const cb of peer.dataCbs) cb(copy);
    });
  }

  onData(cb: (d: Uint8Array) => void): void {
    this.dataCbs.push(cb);
  }

  onClose(cb: () => void): void {
    if (this._closed) {
      cb();
      return;
    }
    this.closeCbs.push(cb);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    for (const cb of this.closeCbs) cb();
    this.closeCbs = [];
    const peer = this.peer;
    if (peer && !peer._closed) queueMicrotask(() => peer.close());
  }
}

/** Create a connected pair of in-memory streams (a duplex pipe). */
export function createPipe(): [ChatStream, ChatStream] {
  const a = new InMemoryStream();
  const b = new InMemoryStream();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** A shared in-memory "Tor network": maps onion → that node's inbound handler, so one node's dial()
 *  reaches another node's onConnection(). Lets two full chat engines run end-to-end in a test. */
export class InMemoryNetwork {
  private nodes = new Map<string, (stream: ChatStream) => void>();

  register(onion: string, handler: (stream: ChatStream) => void): void {
    this.nodes.set(onion, handler);
  }

  unregister(onion: string): void {
    this.nodes.delete(onion);
  }

  connect(onion: string): ChatStream {
    const handler = this.nodes.get(onion);
    if (!handler) throw new TransportError(`no in-memory node at ${onion}`);
    const [dialer, listener] = createPipe();
    queueMicrotask(() => handler(listener)); // deliver the inbound end async
    return dialer;
  }
}

/** Transport backed by an InMemoryNetwork. `onion` is a caller-assigned label (no real Tor). */
export class InMemoryTransport implements Transport {
  private handler: ((stream: ChatStream) => void) | null = null;
  private started = false;

  constructor(
    private readonly net: InMemoryNetwork,
    private readonly onion: string
  ) {}

  dial(onion: string): Promise<ChatStream> {
    if (!this.started) return Promise.reject(new TransportError('transport not started'));
    try {
      return Promise.resolve(this.net.connect(onion));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  onConnection(handler: (stream: ChatStream) => void): void {
    this.handler = handler;
  }

  onionAddress(): string | null {
    return this.started ? this.onion : null;
  }

  start(): Promise<void> {
    if (!this.handler) return Promise.reject(new TransportError('onConnection must be set before start'));
    this.net.register(this.onion, this.handler);
    this.started = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.net.unregister(this.onion);
    this.started = false;
    return Promise.resolve();
  }
}
