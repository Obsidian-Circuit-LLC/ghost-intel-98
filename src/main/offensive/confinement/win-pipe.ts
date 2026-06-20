/** Frame protocol for the dcs98-confine SYSTEM-service named pipe. [type:u8][len:u32le][payload]. */
export const FRAME = { REQUEST: 0x01, RESPONSE: 0x02, STDOUT: 0x10, STDERR: 0x11, EXIT: 0x12 } as const;
/** Hard cap on a single frame so a hostile/corrupt peer can't drive unbounded buffering. Control JSON is
 *  tiny; stdout/stderr are chunked by the service well under this. */
const MAX_FRAME = 4 * 1024 * 1024;

export function encodeFrame(type: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt8(type, 0);
  head.writeUInt32LE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

export interface Frame { type: number; body: Buffer; }

/** Streaming decoder: feed it chunks, get back whole frames. Buffers partial headers/bodies across chunks. */
export class FrameDecoder {
  private buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Frame[] = [];
    for (;;) {
      if (this.buf.length < 5) break;
      const len = this.buf.readUInt32LE(1);
      if (len > MAX_FRAME) throw new Error(`win-pipe: frame too large (${len})`);
      if (this.buf.length < 5 + len) break;
      out.push({ type: this.buf.readUInt8(0), body: this.buf.subarray(5, 5 + len) });
      this.buf = this.buf.subarray(5 + len);
    }
    return out;
  }
}

/** Control requests the app sends to the service. */
export type ControlRequest =
  | { op: 'applyScope'; proxyPort: number; allowCidrs: string[]; sid: string; filters: unknown[] }
  | { op: 'spawn'; scopeId: string; cmd: string; args: string[] }
  | { op: 'kill'; pid: number }
  | { op: 'clearScope'; scopeId: string }
  | { op: 'status' };
export type ControlResponse =
  | { ok: true; scopeId?: string; pid?: number; status?: { enabled: boolean; engineSid: string | null } }
  | { ok: false; error: string };
