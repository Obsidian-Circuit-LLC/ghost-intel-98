// test/plugin-tor-egress.test.ts
import { describe, it, expect, vi } from 'vitest';
import { socksConnect, SocksBlockedError } from '../src/main/plugins/tor-egress';

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
});
