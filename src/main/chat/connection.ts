/**
 * Chat connection (Phase 1, Stage 2) — binds a transport `ChatStream` to an established `Session`
 * and speaks the framed wire protocol: encrypt+frame outgoing messages, decode+decrypt incoming,
 * app-level acks, and presence pings. Fail-closed: any frame/auth error tears the connection down.
 *
 * The handshake that produces the `Session` is injected via the `SessionEstablisher` seam (deferred
 * impl — handshake.ts), so this layer is testable now with two paired `Session`s over an in-memory
 * pipe. The per-contact dial/redial/backoff lifecycle is the ConnectionManager's job (later); a
 * `Connection` models exactly one live link.
 */
import type { ChatStream } from './transport';
import { FrameDecoder, FrameType, FrameError, encodeFrame } from './wire';
import { Session, SessionError } from './session';
import type { Role } from './session';

/** The handshake seam: given a fresh stream + role + peer locator, run the handshake and return a
 *  ready Session (+ the session id). Implemented by handshake.ts once frozen + verified. */
export interface SessionEstablisher {
  establish(stream: ChatStream, role: Role, peer: { onion: string }): Promise<Session>;
}

export interface ConnectionEvents {
  /** A decrypted message envelope (caller decodes via session.decodeEnvelope). */
  onMessage?(envelope: Uint8Array): void;
  /** Peer acked one of our sent messages (by its per-direction counter). */
  onAck?(counter: number): void;
  /** Any inbound frame — used for presence/keepalive. */
  onActivity?(): void;
  /** Connection closed (local error, peer close, or stream close). */
  onClose?(reason: string): void;
}

function readCounter(buf: Uint8Array, off: number): number {
  const hi = ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
  const lo = ((buf[off + 4] << 24) | (buf[off + 5] << 16) | (buf[off + 6] << 8) | buf[off + 7]) >>> 0;
  return hi * 0x100000000 + lo;
}

function counterBytes(counter: number): Uint8Array {
  const b = new Uint8Array(8);
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  b[0] = (hi >>> 24) & 0xff; b[1] = (hi >>> 16) & 0xff; b[2] = (hi >>> 8) & 0xff; b[3] = hi & 0xff;
  b[4] = (lo >>> 24) & 0xff; b[5] = (lo >>> 16) & 0xff; b[6] = (lo >>> 8) & 0xff; b[7] = lo & 0xff;
  return b;
}

export class Connection {
  private readonly decoder = new FrameDecoder();
  private _closed = false;

  constructor(
    private readonly stream: ChatStream,
    private readonly session: Session,
    private readonly events: ConnectionEvents = {}
  ) {
    stream.onData((chunk) => this.onData(chunk));
    stream.onClose(() => this.shutdown('stream-closed'));
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Encrypt + frame a plaintext envelope and send it. Returns the message's per-direction counter
   *  (so the caller can map a later ack to its outbox entry). */
  sendMessage(envelope: Uint8Array): number {
    if (this._closed) throw new ConnectionClosedError();
    const sealed = this.session.encrypt(envelope);
    this.stream.send(encodeFrame(FrameType.Msg, sealed));
    return readCounter(sealed, 0);
  }

  /** Presence keepalive. */
  sendPing(): void {
    if (this._closed) return;
    this.stream.send(encodeFrame(FrameType.Ping, new Uint8Array(0)));
  }

  /** Graceful local close: tell the peer, then tear down. */
  close(): void {
    if (this._closed) return;
    try {
      this.stream.send(encodeFrame(FrameType.Close, new Uint8Array(0)));
    } catch {
      /* stream may already be gone */
    }
    this.shutdown('local-close');
  }

  private onData(chunk: Uint8Array): void {
    if (this._closed) return;
    let frames;
    try {
      frames = this.decoder.push(chunk);
    } catch (err) {
      // FrameError = wire-protocol violation → fatal.
      this.shutdown(`frame-error: ${(err as FrameError).message}`);
      return;
    }
    for (const f of frames) {
      if (this._closed) return;
      this.events.onActivity?.();
      switch (f.type) {
        case FrameType.Msg: {
          let plaintext: Uint8Array;
          try {
            plaintext = this.session.decrypt(f.payload);
          } catch (err) {
            // SessionError = replay / out-of-order / auth failure → fatal (possible tampering).
            this.shutdown(`session-error: ${(err as SessionError).message}`);
            return;
          }
          const counter = readCounter(f.payload, 0);
          this.events.onMessage?.(plaintext);
          // app-level ack referencing the delivered message's counter
          if (!this._closed) this.stream.send(encodeFrame(FrameType.Ack, counterBytes(counter)));
          break;
        }
        case FrameType.Ack: {
          if (f.payload.length >= 8) this.events.onAck?.(readCounter(f.payload, 0));
          break;
        }
        case FrameType.Ping:
          break; // presence handled by onActivity above
        case FrameType.Close:
          this.shutdown('peer-close');
          return;
        case FrameType.Handshake:
          // No handshake frames expected on an established connection.
          this.shutdown('unexpected-handshake-frame');
          return;
        default:
          this.shutdown('unknown-frame');
          return;
      }
    }
  }

  private shutdown(reason: string): void {
    if (this._closed) return;
    this._closed = true;
    this.session.destroy();
    try {
      this.stream.close();
    } catch {
      /* already closed */
    }
    this.events.onClose?.(reason);
  }
}

export class ConnectionClosedError extends Error {
  constructor() {
    super('connection is closed');
    this.name = 'ConnectionClosedError';
  }
}
