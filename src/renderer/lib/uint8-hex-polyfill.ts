/**
 * Polyfill for the TC39 "Uint8Array to/from base64 and hex" methods.
 *
 * pdfjs-dist 5.x calls `Uint8Array.prototype.toHex()` (and friends) internally. Those
 * methods landed in Chromium ~140, but Electron 33 ships Chromium 130 — so on the
 * shipping build pdf.js throws `a.toHex is not a function` and the viewer can't render
 * a PDF. This installs spec-faithful implementations only when the runtime lacks them,
 * so it becomes a no-op the day the bundled Chromium gains them natively.
 *
 * Imported first in the renderer entry (main.tsx) so it is in place before any module
 * that might touch these methods is evaluated.
 */

type SetResult = { read: number; written: number };

const proto = Uint8Array.prototype as unknown as {
  toHex?: () => string;
  toBase64?: (opts?: { alphabet?: 'base64' | 'base64url' }) => string;
  setFromHex?: (hex: string) => SetResult;
  setFromBase64?: (b64: string, opts?: { alphabet?: 'base64' | 'base64url' }) => SetResult;
};
const ctor = Uint8Array as unknown as {
  fromHex?: (hex: string) => Uint8Array;
  fromBase64?: (b64: string, opts?: { alphabet?: 'base64' | 'base64url' }) => Uint8Array;
};

const HEX = '0123456789abcdef';

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, configurable: true, writable: true, enumerable: false });
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    out += HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  // Match the native method's contract: throw on odd length / non-hex rather than silently
  // truncating or coercing NaN→0 (which would corrupt data on the PDF path — red-team M3).
  if (hex.length % 2 !== 0) throw new SyntaxError('Uint8Array.fromHex: string must have an even length');
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new SyntaxError('Uint8Array.fromHex: invalid hex character');
  const len = hex.length >> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToBase64(bytes: Uint8Array, urlSafe: boolean): string {
  let bin = '';
  const CHUNK = 0x8000; // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(bin);
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

function base64ToBytes(b64: string, urlSafe: boolean): Uint8Array {
  // Match native semantics: SKIP ASCII whitespace (the spec's default), then reject anything
  // still outside the alphabet / of invalid length with a SyntaxError. Stripping whitespace is
  // load-bearing — pdfjs feeds line-wrapped base64 from XFA <image> elements through fromBase64,
  // which native tolerates; an over-strict throw here breaks real PDFs (red-team regression).
  const stripped = b64.replace(/[\t\n\f\r ]/g, '');
  const alphabet = urlSafe ? /^[A-Za-z0-9\-_]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/;
  if (!alphabet.test(stripped)) throw new SyntaxError('Uint8Array.fromBase64: invalid base64 character');
  let s = (urlSafe ? stripped.replace(/-/g, '+').replace(/_/g, '/') : stripped).replace(/=+$/, '');
  if (s.length % 4 === 1) throw new SyntaxError('Uint8Array.fromBase64: invalid base64 length');
  while (s.length % 4 !== 0) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

if (typeof proto.toHex !== 'function') {
  define(Uint8Array.prototype, 'toHex', function toHex(this: Uint8Array): string {
    return bytesToHex(this);
  });
}

if (typeof ctor.fromHex !== 'function') {
  define(Uint8Array, 'fromHex', (hex: string): Uint8Array => hexToBytes(hex));
}

if (typeof proto.setFromHex !== 'function') {
  define(Uint8Array.prototype, 'setFromHex', function setFromHex(this: Uint8Array, hex: string): SetResult {
    const src = hexToBytes(hex);
    const written = Math.min(src.length, this.length);
    this.set(src.subarray(0, written));
    return { read: written * 2, written };
  });
}

if (typeof proto.toBase64 !== 'function') {
  define(Uint8Array.prototype, 'toBase64', function toBase64(this: Uint8Array, opts?: { alphabet?: string }): string {
    return bytesToBase64(this, opts?.alphabet === 'base64url');
  });
}

if (typeof ctor.fromBase64 !== 'function') {
  define(Uint8Array, 'fromBase64', (b64: string, opts?: { alphabet?: string }): Uint8Array =>
    base64ToBytes(b64, opts?.alphabet === 'base64url'));
}

if (typeof proto.setFromBase64 !== 'function') {
  define(Uint8Array.prototype, 'setFromBase64', function setFromBase64(this: Uint8Array, b64: string, opts?: { alphabet?: string }): SetResult {
    const src = base64ToBytes(b64, opts?.alphabet === 'base64url');
    const written = Math.min(src.length, this.length);
    this.set(src.subarray(0, written));
    return { read: written, written };
  });
}
