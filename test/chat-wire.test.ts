import { describe, it, expect } from 'vitest';
import {
  FrameType,
  FrameDecoder,
  FrameError,
  encodeFrame,
  WIRE_VERSION,
  HEADER_LEN,
  MAX_FRAME_PAYLOAD
} from '../src/main/chat/wire';

// Wire framing is the lowest chat-transport layer: pure, deterministic, no crypto/IO.
function bytes(...n: number[]): Uint8Array {
  return new Uint8Array(n);
}

describe('chat wire framing', () => {
  it('round-trips a single frame of each type', () => {
    for (const type of [FrameType.Handshake, FrameType.Msg, FrameType.Ack, FrameType.Ping, FrameType.Close]) {
      const payload = bytes(1, 2, 3, 4, 5);
      const dec = new FrameDecoder();
      const frames = dec.push(encodeFrame(type, payload));
      expect(frames).toHaveLength(1);
      expect(frames[0].type).toBe(type);
      expect(Array.from(frames[0].payload)).toEqual([1, 2, 3, 4, 5]);
      expect(dec.pending).toBe(0);
    }
  });

  it('round-trips an empty payload (ping/ack/close)', () => {
    const dec = new FrameDecoder();
    const frames = dec.push(encodeFrame(FrameType.Ping, new Uint8Array(0)));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.length).toBe(0);
  });

  it('decodes multiple frames delivered in one chunk', () => {
    const a = encodeFrame(FrameType.Msg, bytes(10));
    const b = encodeFrame(FrameType.Ack, bytes(20, 21));
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    const frames = new FrameDecoder().push(merged);
    expect(frames.map((f) => f.type)).toEqual([FrameType.Msg, FrameType.Ack]);
    expect(Array.from(frames[1].payload)).toEqual([20, 21]);
  });

  it('reassembles a frame split across multiple pushes (partial header + partial payload)', () => {
    const frame = encodeFrame(FrameType.Msg, bytes(7, 8, 9, 10));
    const dec = new FrameDecoder();
    // Drip one byte at a time; only the final byte completes the frame.
    let out: ReturnType<FrameDecoder['push']> = [];
    for (let i = 0; i < frame.length; i += 1) {
      out = dec.push(frame.slice(i, i + 1));
      if (i < frame.length - 1) expect(out).toHaveLength(0);
    }
    expect(out).toHaveLength(1);
    expect(Array.from(out[0].payload)).toEqual([7, 8, 9, 10]);
    expect(dec.pending).toBe(0);
  });

  it('retains a trailing partial frame without emitting a phantom', () => {
    const whole = encodeFrame(FrameType.Msg, bytes(1, 2, 3));
    const partial = encodeFrame(FrameType.Msg, bytes(9, 9, 9)).slice(0, 4); // header + 0 payload bytes
    const merged = new Uint8Array(whole.length + partial.length);
    merged.set(whole, 0);
    merged.set(partial, whole.length);
    const dec = new FrameDecoder();
    const frames = dec.push(merged);
    expect(frames).toHaveLength(1);
    expect(dec.pending).toBe(partial.length); // the partial is buffered, not lost or mis-emitted
  });

  it('rejects a frame whose DECLARED length exceeds the cap (before buffering the body)', () => {
    // header only: version, Msg, length = MAX+1
    const len = MAX_FRAME_PAYLOAD + 1;
    const header = bytes(
      WIRE_VERSION,
      FrameType.Msg,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff
    );
    const dec = new FrameDecoder();
    expect(() => dec.push(header)).toThrow(FrameError);
  });

  it('refuses to encode an over-cap payload', () => {
    expect(() => encodeFrame(FrameType.Msg, new Uint8Array(MAX_FRAME_PAYLOAD + 1))).toThrow(FrameError);
  });

  it('rejects an unknown frame type on encode and on decode', () => {
    expect(() => encodeFrame(99 as FrameType, bytes(1))).toThrow(FrameError);
    const bad = bytes(WIRE_VERSION, 99, 0, 0, 0, 0);
    expect(() => new FrameDecoder().push(bad)).toThrow(FrameError);
  });

  it('rejects an unsupported wire version', () => {
    const bad = bytes(WIRE_VERSION + 1, FrameType.Msg, 0, 0, 0, 0);
    expect(() => new FrameDecoder().push(bad)).toThrow(FrameError);
  });

  it('encodes the documented header layout', () => {
    const f = encodeFrame(FrameType.Msg, bytes(0xaa, 0xbb));
    expect(f[0]).toBe(WIRE_VERSION);
    expect(f[1]).toBe(FrameType.Msg);
    expect([f[2], f[3], f[4], f[5]]).toEqual([0, 0, 0, 2]); // big-endian length = 2
    expect(f.length).toBe(HEADER_LEN + 2);
  });
});
