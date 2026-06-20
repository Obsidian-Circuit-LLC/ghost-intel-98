import { describe, it, expect } from 'vitest';
import { encodeFrame, FrameDecoder, FRAME } from '../src/main/offensive/confinement/win-pipe';

describe('win-pipe frame codec', () => {
  it('round-trips a control request across arbitrary chunk boundaries', () => {
    const payload = Buffer.from(JSON.stringify({ op: 'applyScope', proxyPort: 54321, allowCidrs: ['203.0.113.0/24'] }));
    const wire = encodeFrame(FRAME.REQUEST, payload);
    const dec = new FrameDecoder();
    const out: { type: number; body: Buffer }[] = [];
    // feed one byte at a time — proves the decoder buffers partial headers + bodies
    for (const b of wire) out.push(...dec.push(Buffer.from([b])));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe(FRAME.REQUEST);
    expect(JSON.parse(out[0].body.toString())).toEqual({ op: 'applyScope', proxyPort: 54321, allowCidrs: ['203.0.113.0/24'] });
  });

  it('decodes multiple frames coalesced in one chunk, in order', () => {
    const a = encodeFrame(FRAME.STDOUT, Buffer.from('hello'));
    const b = encodeFrame(FRAME.EXIT, Buffer.from(JSON.stringify({ code: 0 })));
    const dec = new FrameDecoder();
    const out = dec.push(Buffer.concat([a, b]));
    expect(out.map((f) => f.type)).toEqual([FRAME.STDOUT, FRAME.EXIT]);
    expect(out[0].body.toString()).toBe('hello');
  });

  it('rejects an absurd length prefix rather than buffering unbounded', () => {
    const dec = new FrameDecoder();
    const bad = Buffer.alloc(5);
    bad.writeUInt8(FRAME.STDOUT, 0);
    bad.writeUInt32LE(0x7fffffff, 1); // ~2GB — must be refused
    expect(() => dec.push(bad)).toThrow(/frame too large/);
  });
});
