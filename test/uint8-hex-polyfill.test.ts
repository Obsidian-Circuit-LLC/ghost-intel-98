import { describe, it, expect } from 'vitest';
import '../src/renderer/lib/uint8-hex-polyfill';

// pdfjs-dist 5.x calls Uint8Array.prototype.toHex() (absent in Electron 33's Chromium).
// These assert the polyfill's implementations are spec-correct; on a runtime that already
// has the natives, they validate the natives instead — either way the contract holds.
type HexU8 = Uint8Array & { toHex(): string; toBase64(o?: { alphabet?: string }): string };
type HexCtor = typeof Uint8Array & {
  fromHex(s: string): Uint8Array;
  fromBase64(s: string, o?: { alphabet?: string }): Uint8Array;
};

describe('Uint8Array hex/base64 polyfill', () => {
  it('toHex / fromHex round-trip', () => {
    const u = new Uint8Array([0, 1, 15, 16, 128, 255]) as HexU8;
    expect(u.toHex()).toBe('00010f1080ff');
    expect(Array.from((Uint8Array as HexCtor).fromHex('00010f1080ff'))).toEqual([0, 1, 15, 16, 128, 255]);
  });

  it('toBase64 / fromBase64 round-trip', () => {
    const u = new Uint8Array([104, 105]) as HexU8; // "hi"
    expect(u.toBase64()).toBe('aGk=');
    expect(Array.from((Uint8Array as HexCtor).fromBase64('aGk='))).toEqual([104, 105]);
  });

  it('base64url alphabet drops padding and uses -_', () => {
    const u = new Uint8Array([251, 255, 191]) as HexU8;
    const b64url = u.toBase64({ alphabet: 'base64url' });
    expect(b64url).not.toContain('=');
    expect(b64url).not.toMatch(/[+/]/);
    expect(Array.from((Uint8Array as HexCtor).fromBase64(b64url, { alphabet: 'base64url' }))).toEqual([251, 255, 191]);
  });

  it('throws (does not silently corrupt) on malformed hex/base64 (red-team M3/H2)', () => {
    const C = Uint8Array as HexCtor;
    expect(() => C.fromHex('abc')).toThrow();      // odd length
    expect(() => C.fromHex('zz')).toThrow();       // non-hex chars
    expect(() => C.fromHex(' a b')).toThrow();     // hex: whitespace is invalid (no skip)
    expect(() => C.fromBase64('@@@@')).toThrow();  // outside alphabet
    expect(() => C.fromBase64('YQYQY')).toThrow(); // length % 4 === 1
  });

  it('base64 SKIPS ASCII whitespace like the native method (line-wrapped XFA PDF data)', () => {
    const C = Uint8Array as HexCtor;
    expect(Array.from(C.fromBase64('SGVs\nbG8='))).toEqual([72, 101, 108, 108, 111]); // "Hello"
    expect(Array.from(C.fromBase64('aG k='))).toEqual([104, 105]); // "hi" with a space
  });

  it('handles a large buffer without blowing the call stack', () => {
    const big = new Uint8Array(200_000).fill(65) as HexU8;
    const hex = big.toHex();
    expect(hex.length).toBe(400_000);
    expect(big.toBase64().length).toBeGreaterThan(0);
  });
});
