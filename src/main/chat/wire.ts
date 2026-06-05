/**
 * Chat wire framing — the lowest layer of the P2P chat transport (Phase 1).
 *
 * Length-prefixed binary frames over the (Tor onion) TCP stream. Pure + synchronous: no crypto,
 * no I/O, no time, no RNG — fully deterministic and unit-testable. Higher layers (handshake,
 * session) sit on top and own encryption; this layer only delimits frames and enforces a hard
 * size cap so a hostile peer can't make us buffer unbounded data.
 *
 * Frame layout (big-endian):
 *   byte 0      version (WIRE_VERSION)
 *   byte 1      type    (FrameType)
 *   bytes 2..5  payload length (uint32)
 *   bytes 6..   payload (length bytes)
 *
 * Frame types are a FIXED, strict set — an unknown frame type is a protocol violation and is
 * rejected (fail-closed). Forward-compatible content lives INSIDE a `Msg` payload as a versioned
 * typed envelope (see envelope.ts in a later step), not in the frame type.
 */

export const WIRE_VERSION = 1;
/** Hard cap on a single frame's payload. Bounds per-frame buffering against a hostile peer.
 *  Text fits easily; Phase 2 file transfer chunks each chunk into its own frame under this cap. */
export const MAX_FRAME_PAYLOAD = 1024 * 1024; // 1 MiB
export const HEADER_LEN = 6;

export enum FrameType {
  Handshake = 1,
  Msg = 2,
  Ack = 3,
  Ping = 4,
  Close = 5
}

const KNOWN_TYPES: ReadonlySet<number> = new Set([
  FrameType.Handshake,
  FrameType.Msg,
  FrameType.Ack,
  FrameType.Ping,
  FrameType.Close
]);

export interface Frame {
  type: FrameType;
  payload: Uint8Array;
}

/** Thrown on any wire-level protocol violation (bad version, unknown type, oversize). The caller
 *  treats this as fatal for the connection and tears the session down — never as recoverable. */
export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

/** Serialize one frame. Throws on an unknown type or an over-cap payload (never emit what we'd
 *  reject on decode). */
export function encodeFrame(type: FrameType, payload: Uint8Array): Uint8Array {
  if (!KNOWN_TYPES.has(type)) throw new FrameError(`unknown frame type ${type}`);
  if (payload.length > MAX_FRAME_PAYLOAD) {
    throw new FrameError(`frame payload ${payload.length} exceeds max ${MAX_FRAME_PAYLOAD}`);
  }
  const out = new Uint8Array(HEADER_LEN + payload.length);
  out[0] = WIRE_VERSION;
  out[1] = type;
  const len = payload.length;
  out[2] = (len >>> 24) & 0xff;
  out[3] = (len >>> 16) & 0xff;
  out[4] = (len >>> 8) & 0xff;
  out[5] = len & 0xff;
  out.set(payload, HEADER_LEN);
  return out;
}

/**
 * Streaming frame decoder. TCP is a byte stream: a `push()` may carry several frames, a partial
 * frame, or a frame split across many pushes. The decoder buffers the remainder and returns every
 * complete frame available, validating the cap on the DECLARED length before waiting for bytes (so
 * a hostile declared length is rejected immediately, not after buffering).
 */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);

  /** Feed received bytes; returns any newly-complete frames. Throws FrameError (fatal) on a
   *  protocol violation. */
  push(chunk: Uint8Array): Frame[] {
    if (chunk.length > 0) {
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }

    const frames: Frame[] = [];
    let offset = 0;
    for (;;) {
      if (this.buf.length - offset < HEADER_LEN) break; // not even a full header yet
      const version = this.buf[offset];
      if (version !== WIRE_VERSION) throw new FrameError(`unsupported wire version ${version}`);
      const type = this.buf[offset + 1];
      if (!KNOWN_TYPES.has(type)) throw new FrameError(`unknown frame type ${type}`);
      const len =
        (((this.buf[offset + 2] << 24) |
          (this.buf[offset + 3] << 16) |
          (this.buf[offset + 4] << 8) |
          this.buf[offset + 5]) >>> 0); // >>> 0 → unsigned 32-bit
      if (len > MAX_FRAME_PAYLOAD) {
        throw new FrameError(`frame payload ${len} exceeds max ${MAX_FRAME_PAYLOAD}`);
      }
      if (this.buf.length - offset - HEADER_LEN < len) break; // payload not fully arrived
      const start = offset + HEADER_LEN;
      const payload = this.buf.slice(start, start + len);
      frames.push({ type: type as FrameType, payload });
      offset = start + len;
    }

    // Keep only the unconsumed tail (a partial next frame).
    this.buf = offset === 0 ? this.buf : this.buf.slice(offset);
    return frames;
  }

  /** Bytes currently buffered awaiting completion — for tests / backpressure introspection. */
  get pending(): number {
    return this.buf.length;
  }
}
