// test/plugin-tor-egress.test.ts
import { describe, it, expect, vi } from 'vitest';
import { socksConnect, SocksBlockedError } from '../src/main/plugins/tor-egress';
// Override timers globally so the 15 s handshake deadline does not block the overflow test.
vi.useFakeTimers();

// A fake duplex: records writes, lets the test push reply bytes via emit('data').
function fakeSock() {
  const listeners: Record<string, ((d?: unknown) => void)[]> = {};
  return {
    writes: [] as Uint8Array[],
    on(ev: string, fn: (d?: unknown) => void) { (listeners[ev] ??= []).push(fn); return this; },
    once(ev: string, fn: (d?: unknown) => void) { (listeners[ev] ??= []).push(fn); return this; },
    removeListener() { return this; },
    write(b: Uint8Array) { this.writes.push(b); return true; },
    emit(ev: string, d?: unknown) { (listeners[ev] ?? []).forEach((f) => f(d)); },
    destroy: vi.fn()
  };
}

describe('socksConnect', () => {
  it('runs greeting → userpass auth → CONNECT and resolves on success', async () => {
    const s = fakeSock();
    const p = socksConnect(s as never, { host: 'example.com', port: 443, user: 'u', pass: 'p' });
    s.emit('data', Uint8Array.of(0x05, 0x02));           // method selection: userpass
    await Promise.resolve();
    s.emit('data', Uint8Array.of(0x01, 0x00));           // auth OK
    await Promise.resolve();
    s.emit('data', Uint8Array.of(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0)); // CONNECT success (IPv4 bnd)
    await expect(p).resolves.toBeUndefined();
    expect(s.writes.length).toBe(3); // greeting, auth, connect
  });
  it('maps a CONNECT failure (REP!=0) to SocksBlockedError (Tor exit refused)', async () => {
    const s = fakeSock();
    const p = socksConnect(s as never, { host: 'x.onion', port: 80, user: 'u', pass: 'p' });
    s.emit('data', Uint8Array.of(0x05, 0x02)); await Promise.resolve();
    s.emit('data', Uint8Array.of(0x01, 0x00)); await Promise.resolve();
    s.emit('data', Uint8Array.of(0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0)); // REP=5 connection refused
    await expect(p).rejects.toBeInstanceOf(SocksBlockedError);
  });
  it('rejects (not blocked) if auth is refused', async () => {
    const s = fakeSock();
    const p = socksConnect(s as never, { host: 'x', port: 80, user: 'u', pass: 'p' });
    s.emit('data', Uint8Array.of(0x05, 0x02)); await Promise.resolve();
    s.emit('data', Uint8Array.of(0x01, 0x01)); // auth FAIL
    await expect(p).rejects.toThrow(/auth/i);
  });

  it('rejects with a plain Error (not SocksBlockedError) when > 512 bytes arrive during the handshake', async () => {
    // The buffer cap is a protocol/abuse guard — a misbehaving proxy that floods the socket
    // during the handshake must not be treated as a normal Tor-exit refusal (SocksBlockedError).
    // The test uses fake timers (vi.useFakeTimers at module scope) so the 15 s deadline is never
    // fired; the overflow is triggered synchronously by the first data emission.
    const s = fakeSock();
    const p = socksConnect(s as never, { host: 'example.com', port: 80, user: 'u', pass: 'p' });
    // Push 513 bytes of garbage in one shot — exceeds the 512-byte cap.
    s.emit('data', Buffer.alloc(513, 0xff));
    await expect(p).rejects.toSatisfy((e: unknown) => e instanceof Error && !(e instanceof SocksBlockedError));
    await expect(p).rejects.toThrow(/overflow/i);
  });
});
